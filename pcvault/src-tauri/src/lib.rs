//! Tauri backend for My Vault.
//!
//! Mirrors the Electron main process (`main.js`) IPC surface 1:1 so the
//! renderer (`src/renderer.js`) works unchanged through the same
//! `window.vaultAPI` contract, backed by `__TAURI__.core.invoke` instead of
//! `ipcRenderer.invoke`.
//!
//! Desktop vs Android:
//!   - Desktop: the vault file lives in a user-picked folder. Every path the
//!     renderer hands us must have been minted by one of our own dialogs (or
//!     derived from the folder it picked). Nothing else reaches the filesystem.
//!   - Android: there is no "pick a folder" model. The vault lives in the
//!     app's private internal storage (`app_data_dir()`), which the renderer
//!     never sees (same SEC-004 rule). "Open a vault file" uses the SAF file
//!     picker and copies the chosen `.cvault` into internal storage; backup
//!     and item-export use SAF save dialogs. `reveal` is a harmless no-op.
//! The command *names* are identical on both platforms so `src/tauri-bridge.js`
//! stays unchanged.
//!
//! All commands are marked `#[tauri::command]` and only the ones listed in
//! `capabilities/default.json` are exposed.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// True when running on Android (runtime flag so one source serves both shells).
fn is_mobile() -> bool {
    cfg!(target_os = "android")
}

// ---- trusted-path state ----------------------------------------------------

/// The one vault file this shell reads/writes, plus the two dialog-minted
/// destinations (backup copy, item export). All held in main-process memory
/// only — the renderer never carries a copy (SEC-004 parity).
struct VaultState {
    vault_path: Mutex<Option<PathBuf>>,
    last_copy_dst: Mutex<Option<PathBuf>>,
    last_export_dst: Mutex<Option<PathBuf>>,
    bg_file: Mutex<Option<PathBuf>>, // copied custom lock-screen background
}

impl Default for VaultState {
    fn default() -> Self {
        Self {
            vault_path: Mutex::new(None),
            last_copy_dst: Mutex::new(None),
            last_export_dst: Mutex::new(None),
            bg_file: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Settings {
    vault_path: Option<String>,
    bg_file: Option<String>,
}

fn settings_file(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("app config dir")
        .join("settings.json")
}

/// On Android the vault always lives at a fixed spot in internal storage.
/// Returns the vault file path (not the folder).
fn mobile_vault_path(app: &AppHandle) -> Option<PathBuf> {
    if !is_mobile() {
        return None;
    }
    let dir = app.path().app_data_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("myvault.cvault"))
}

fn load_vault_path(app: &AppHandle, state: &State<VaultState>) {
    if let Some(m) = mobile_vault_path(app) {
        *state.vault_path.lock().unwrap() = Some(m);
    }
    let file = settings_file(app);
    if let Ok(raw) = fs::read_to_string(&file) {
        if let Ok(s) = serde_json::from_str::<Settings>(&raw) {
            if let Some(p) = s.vault_path {
                if !p.is_empty() {
                    *state.vault_path.lock().unwrap() = Some(PathBuf::from(p));
                }
            }
            if let Some(b) = s.bg_file {
                if !b.is_empty() {
                    *state.bg_file.lock().unwrap() = Some(PathBuf::from(b));
                }
            }
        }
    }
}

fn save_vault_path(app: &AppHandle, state: &State<VaultState>) {
    let file = settings_file(app);
    let vault = state.vault_path.lock().unwrap().clone();
    let bg = state.bg_file.lock().unwrap().clone();
    let settings = Settings {
        vault_path: vault.map(|p| p.to_string_lossy().into_owned()),
        bg_file: bg.map(|p| p.to_string_lossy().into_owned()),
    };
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(file, serde_json::to_string(&settings).unwrap_or_default());
}

// ---- commands ---------------------------------------------------------------

/// Return the remembered vault path (renderer keeps no copy of it).
#[tauri::command]
fn get_last_path(app: AppHandle, state: State<'_, VaultState>) -> Option<String> {
    if let Some(m) = mobile_vault_path(&app) {
        return Some(m.to_string_lossy().into_owned());
    }
    state
        .vault_path
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn forget_path(app: AppHandle, state: State<'_, VaultState>) -> bool {
    // On Android "forget" just resets the fixed internal path (no-op storage).
    if !is_mobile() {
        *state.vault_path.lock().unwrap() = None;
        save_vault_path(&app, &state);
    }
    true
}

/// Pick where the vault lives. Desktop: a folder; Android: internal storage.
/// Folder picking (blocking_pick_folder) doesn't exist on the Android target,
/// so each platform's body is #[cfg]'-gated rather than branched at runtime.
#[tauri::command]
async fn pick_folder(app: AppHandle, state: State<'_, VaultState>) -> Result<Option<String>, String> {
    // Android: the vault always lives in internal storage (no folder dialog).
    #[cfg(target_os = "android")]
    {
        let _ = app;
        if let Some(m) = mobile_vault_path(&app) {
            let dir = m.parent().unwrap_or(&m).to_path_buf();
            *state.vault_path.lock().unwrap() = Some(m);
            return Ok(Some(dir.to_string_lossy().into_owned()));
        }
        return Ok(None);
    }

    #[cfg(not(target_os = "android"))]
    {
        let picked = app
            .dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned());
        if let Some(folder) = picked {
            let vault = PathBuf::from(&folder).join("myvault.cvault");
            *state.vault_path.lock().unwrap() = Some(vault);
            save_vault_path(&app, &state);
            return Ok(Some(folder));
        }
        Ok(None)
    }
}

/// Pick an existing vault file to open. Desktop: open in place. Android: SAF
/// picker, then copy the chosen `.cvault` into internal storage.
#[tauri::command]
async fn pick_vault_file(app: AppHandle, state: State<'_, VaultState>) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("My Vault file", &["cvault"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok());
    match picked {
        Some(path) if is_mobile() => {
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            let vault = mobile_vault_path(&app)
                .ok_or_else(|| "internal storage unavailable".to_string())?;
            let _ = fs::create_dir_all(vault.parent().unwrap_or(Path::new(".")));
            fs::write(&vault, &bytes).map_err(|e| e.to_string())?;
            *state.vault_path.lock().unwrap() = Some(vault.clone());
            return Ok(Some(vault.to_string_lossy().into_owned()));
        }
        Some(path) => {
            let path = path.to_string_lossy().into_owned();
            *state.vault_path.lock().unwrap() = Some(PathBuf::from(&path));
            save_vault_path(&app, &state);
            return Ok(Some(path));
        }
        None => Ok(None),
    }
}

/// Save-as copy (backup) target — mints `last_copy_dst`.
#[tauri::command]
async fn save_copy_as(app: AppHandle, state: State<'_, VaultState>, suggested_name: Option<String>) -> Result<Option<String>, String> {
    let default = suggested_name.unwrap_or_else(|| "my-vault-backup.cvault".to_string());
    let picked = app
        .dialog()
        .file()
        .add_filter("My Vault file", &["cvault"])
        .set_file_name(&default)
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned());
    if let Some(path) = picked {
        *state.last_copy_dst.lock().unwrap() = Some(PathBuf::from(&path));
        return Ok(Some(path));
    }
    Ok(None)
}

/// Save-as dialog for exporting a decrypted copy of an item — mints `last_export_dst`.
#[tauri::command]
async fn save_file_as(app: AppHandle, state: State<'_, VaultState>, suggested_name: Option<String>) -> Result<Option<String>, String> {
    let default = suggested_name.unwrap_or_else(|| "export.bin".to_string());
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default)
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned());
    if let Some(path) = picked {
        *state.last_export_dst.lock().unwrap() = Some(PathBuf::from(&path));
        return Ok(Some(path));
    }
    Ok(None)
}

fn same_path(a: &Path, b: &Path) -> bool {
    a == b
}

/// The renderer composes a path like `<folder>/myvault.cvault`. We only ever
/// trust paths equal to the vault file the picker (or internal storage) minted.
fn vault_matches(state: &State<'_, VaultState>, candidate: &str) -> bool {
    match state.vault_path.lock().unwrap().clone() {
        Some(v) => same_path(Path::new(candidate), &v),
        None => false,
    }
}

/// Write an exported plaintext copy (explicit user action only).
#[tauri::command]
fn write_file(state: State<'_, VaultState>, file_path: String, bytes_b64: String) -> Result<bool, String> {
    let export = state.last_export_dst.lock().unwrap().clone();
    match export {
        Some(dst) if same_path(Path::new(&file_path), &dst) => {
            let bytes = BASE64.decode(&bytes_b64).map_err(|e| e.to_string())?;
            // SAF save dialogs on Android may hand back a target the OS
            // expects us to (over)write; ensure its parent exists.
            if let Some(parent) = dst.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::write(&dst, bytes).map_err(|e| e.to_string())?;
            Ok(true)
        }
        _ => Err("forbidden path".into()),
    }
}

/// Read a whole file as bytes (base64 over IPC — simple, works with the
/// renderer's `Uint8Array` contract).
#[tauri::command]
fn read_file(state: State<'_, VaultState>, file_path: String) -> Result<String, String> {
    if !vault_matches(&state, &file_path) {
        return Err("forbidden path".into());
    }
    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    Ok(BASE64.encode(bytes))
}

/// Atomic write: temp file in the same dir + rename, so a crash mid-write never
/// leaves a truncated vault file. If the rename fails the temp file is unlinked
/// (no orphaned copy lingers — SEC-008 parity).
#[tauri::command]
fn write_file_atomic(
    state: State<'_, VaultState>,
    file_path: String,
    bytes_b64: String,
) -> Result<bool, String> {
    if !vault_matches(&state, &file_path) {
        return Err("forbidden path".into());
    }
    let bytes = BASE64.decode(&bytes_b64).map_err(|e| e.to_string())?;
    let tmp = format!(
        "{file_path}.tmp-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    match fs::rename(&tmp, &file_path) {
        Ok(_) => Ok(true),
        Err(e) => {
            let _ = fs::remove_file(&tmp); // best-effort cleanup
            Err(e.to_string())
        }
    }
}

/// Copy file (backup) — vault → the dialog-minted backup destination.
#[tauri::command]
fn copy_file(
    state: State<'_, VaultState>,
    src: String,
    dst: String,
) -> Result<bool, String> {
    if !vault_matches(&state, &src) {
        return Err("forbidden path".into());
    }
    let copy_dst = state.last_copy_dst.lock().unwrap().clone();
    match copy_dst {
        Some(d) if same_path(Path::new(&dst), &d) => {
            fs::copy(&src, &d).map_err(|e| e.to_string())?;
            Ok(true)
        }
        _ => Err("forbidden path".into()),
    }
}

/// Reveal the vault file in the system file manager (no-op on Android, where
/// the vault lives in private internal storage).
#[tauri::command]
async fn reveal(app: AppHandle, state: State<'_, VaultState>, file_path: String) -> Result<(), String> {
    if is_mobile() {
        return Ok(());
    }
    match state.vault_path.lock().unwrap().clone() {
        Some(v) if same_path(Path::new(&file_path), &v) => {
            app.opener().reveal_item_in_dir(&v).map_err(|e| e.to_string())?;
            Ok(())
        }
        _ => Err("forbidden path".into()),
    }
}

/// Validate that a chosen vault location is a real folder (create flow only).
#[tauri::command]
fn is_dir(state: State<'_, VaultState>, p: String) -> bool {
    if is_mobile() {
        return true; // internal storage is always a valid, present dir
    }
    let vault = state.vault_path.lock().unwrap().clone();
    match vault {
        Some(v) => {
            let dir = v.parent().unwrap_or(Path::new(""));
            same_path(Path::new(&p), dir) && dir.is_dir()
        }
        None => false,
    }
}

#[tauri::command]
fn exists(state: State<'_, VaultState>, p: String) -> bool {
    if !vault_matches(&state, &p) {
        return false;
    }
    Path::new(&p).exists()
}

// ---- custom lock-screen background (image or video) ------------------------
// Mirrors Electron's main.js: the picked file is copied into the app's
// `background/` dir so the vault stays self-contained; only those bytes are
// ever returned to the renderer (SEC-004 parity). Works on both desktop and
// Android (app data dir). The renderer never touches the file system.

fn bg_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("background");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn is_img(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "svg")
}
fn is_vid(ext: &str) -> bool {
    matches!(ext, "mp4" | "webm" | "mov" | "mkv" | "avi")
}

/// Pick an image or video and copy it into the app's background dir. Returns
/// the kind ('image' | 'video') or null if canceled/unusable.
#[tauri::command]
async fn pick_background(app: AppHandle, state: State<'_, VaultState>) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"])
        .add_filter("Videos", &["mp4", "webm", "mov", "mkv", "avi"])
        .blocking_pick_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None); // canceled
    };
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !is_img(&ext) && !is_vid(&ext) {
        return Ok(None);
    }
    let dst = bg_dir(&app)?.join(format!("bg.{ext}"));
    fs::copy(&path, &dst).map_err(|e| e.to_string())?;
    *state.bg_file.lock().unwrap() = Some(dst);
    save_vault_path(&app, &state);
    Ok(Some(if is_img(&ext) { "image" } else { "video" }.to_string()))
}

/// Remove the custom background (fall back to the animated ones).
#[tauri::command]
fn clear_background(app: AppHandle, state: State<'_, VaultState>) -> bool {
    if let Some(p) = state.bg_file.lock().unwrap().take() {
        let _ = fs::remove_file(&p);
    }
    save_vault_path(&app, &state);
    true
}

#[derive(Serialize)]
struct BgInfo {
    kind: String,
    bytes: String, // base64
    name: String,
}

/// Bytes of the copied background file + its kind, for the renderer to render
/// as a blob URL. null if none is set or the copy is missing.
#[tauri::command]
fn get_background(state: State<'_, VaultState>) -> Option<BgInfo> {
    let path = state.bg_file.lock().unwrap().clone()?;
    if !path.exists() {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    Some(BgInfo {
        kind: if is_img(&ext) { "image" } else { "video" }.to_string(),
        bytes: BASE64.encode(bytes),
        name: path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string(),
    })
}

// ---- setup -----------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(VaultState::default())
        .setup(|app| {
            let state = app.state::<VaultState>();
            load_vault_path(app.handle(), &state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_last_path,
            forget_path,
            pick_folder,
            pick_vault_file,
            save_copy_as,
            save_file_as,
            write_file,
            read_file,
            write_file_atomic,
            copy_file,
            reveal,
            is_dir,
            exists,
            pick_background,
            clear_background,
            get_background,
        ])
        .run(tauri::generate_context!())
        .expect("error while running My Vault");
}