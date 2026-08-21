//! Tauri backend for My Vault.
//!
//! Mirrors the Electron main process (`main.js`) IPC surface 1:1 so the
//! renderer (`src/renderer.js`) works unchanged through the same
//! `window.vaultAPI` contract, backed by `__TAURI__.core.invoke` instead of
//! `ipcRenderer.invoke`.
//!
//! Security model (same as Electron): the renderer is treated as compromised.
//! Every path it can hand us must have been minted by one of our own dialogs
//! (or derived from the folder it picked). Nothing else reaches the filesystem.
//! All commands are marked with `#[tauri::command]` and only the ones listed in
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

// ---- trusted-path state ----------------------------------------------------

/// The one vault file Tauri will read/write, plus the two dialog-minted
/// destinations (backup copy, item export). All held in main-process memory
/// only — the renderer never carries a copy (SEC-004 parity).
struct VaultState {
    vault_path: Mutex<Option<PathBuf>>,
    last_copy_dst: Mutex<Option<PathBuf>>,
    last_export_dst: Mutex<Option<PathBuf>>,
}

impl Default for VaultState {
    fn default() -> Self {
        Self {
            vault_path: Mutex::new(None),
            last_copy_dst: Mutex::new(None),
            last_export_dst: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Settings {
    vault_path: Option<String>,
}

fn settings_file(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("app config dir")
        .join("settings.json")
}

fn load_vault_path(app: &AppHandle, state: &State<VaultState>) {
    let file = settings_file(app);
    if let Ok(raw) = fs::read_to_string(&file) {
        if let Ok(s) = serde_json::from_str::<Settings>(&raw) {
            if let Some(p) = s.vault_path {
                if !p.is_empty() {
                    *state.vault_path.lock().unwrap() = Some(PathBuf::from(p));
                }
            }
        }
    }
}

fn save_vault_path(app: &AppHandle, state: &State<VaultState>) {
    let file = settings_file(app);
    let vault = state.vault_path.lock().unwrap().clone();
    let settings = Settings {
        vault_path: vault.map(|p| p.to_string_lossy().into_owned()),
    };
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(file, serde_json::to_string(&settings).unwrap_or_default());
}

// ---- commands ---------------------------------------------------------------

/// Return the remembered vault path (renderer keeps no copy of it).
#[tauri::command]
fn get_last_path(state: State<'_, VaultState>) -> Option<String> {
    state
        .vault_path
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn forget_path(app: AppHandle, state: State<'_, VaultState>) -> bool {
    *state.vault_path.lock().unwrap() = None;
    save_vault_path(&app, &state);
    true
}

/// Pick a folder (create-time location). The vault file lives inside it.
#[tauri::command]
async fn pick_folder(app: AppHandle, state: State<'_, VaultState>) -> Result<Option<String>, String> {
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

/// Pick an existing vault file to open.
#[tauri::command]
async fn pick_vault_file(app: AppHandle, state: State<'_, VaultState>) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("My Vault file", &["cvault"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned());
    if let Some(path) = picked {
        *state.vault_path.lock().unwrap() = Some(PathBuf::from(&path));
        save_vault_path(&app, &state);
        return Ok(Some(path));
    }
    Ok(None)
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

/// Write an exported plaintext copy (explicit user action only).
#[tauri::command]
fn write_file(state: State<'_, VaultState>, file_path: String, bytes_b64: String) -> Result<bool, String> {
    let export = state.last_export_dst.lock().unwrap().clone();
    match export {
        Some(dst) if same_path(Path::new(&file_path), &dst) => {
            let bytes = BASE64.decode(&bytes_b64).map_err(|e| e.to_string())?;
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
    let vault = state.vault_path.lock().unwrap().clone();
    match vault {
        Some(v) if same_path(Path::new(&file_path), &v) => {
            let bytes = fs::read(&v).map_err(|e| e.to_string())?;
            Ok(BASE64.encode(bytes))
        }
        _ => Err("forbidden path".into()),
    }
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
    let vault = state.vault_path.lock().unwrap().clone();
    match vault {
        Some(v) if same_path(Path::new(&file_path), &v) => {
            let bytes = BASE64.decode(&bytes_b64).map_err(|e| e.to_string())?;
            let tmp = format!(
                "{}.tmp-{}-{}",
                file_path,
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
        _ => Err("forbidden path".into()),
    }
}

/// Copy file (backup).
#[tauri::command]
fn copy_file(
    state: State<'_, VaultState>,
    src: String,
    dst: String,
) -> Result<bool, String> {
    let vault = state.vault_path.lock().unwrap().clone();
    let copy_dst = state.last_copy_dst.lock().unwrap().clone();
    match (vault, copy_dst) {
        (Some(v), Some(d)) if same_path(Path::new(&src), &v) && same_path(Path::new(&dst), &d) => {
            fs::copy(&v, &d).map_err(|e| e.to_string())?;
            Ok(true)
        }
        _ => Err("forbidden path".into()),
    }
}

/// Reveal the vault file in the system file manager.
#[tauri::command]
async fn reveal(app: AppHandle, state: State<'_, VaultState>, file_path: String) -> Result<(), String> {
    let vault = state.vault_path.lock().unwrap().clone();
    match vault {
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
    let vault = state.vault_path.lock().unwrap().clone();
    match vault {
        Some(v) => {
            let dir = v.parent().unwrap_or(Path::new(""));
            if !same_path(Path::new(&p), dir) {
                return false;
            }
            Path::new(&p).is_dir()
        }
        None => false,
    }
}

#[tauri::command]
fn exists(state: State<'_, VaultState>, p: String) -> bool {
    let vault = state.vault_path.lock().unwrap().clone();
    match vault {
        Some(v) if same_path(Path::new(&p), &v) => Path::new(&p).exists(),
        _ => false,
    }
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running My Vault");
}
