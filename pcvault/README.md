<div align="center">

# My Vault

**Zero-knowledge, offline encrypted photo & document vault with an encrypted journal, secrets vault, and dual Electron + Tauri desktop shells.**

One encrypted file holds everything — photos, videos, documents, PDFs, encrypted journals, and secrets.  
*Nothing ever leaves your PC. No cloud. No network. Just you and your vault.*

<br/>

![Version](https://img.shields.io/badge/Version-2.1.0-107c41?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078d4?style=for-the-badge&logo=windows&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-v2%20(Rust)-24c8db?style=for-the-badge&logo=tauri&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-43.0-47848f?style=for-the-badge&logo=electron&logoColor=white)
![Security](https://img.shields.io/badge/Security-AES--256--GCM-107c41?style=for-the-badge&logo=shield&logoColor=white)

</div>

---

## System Capabilities

| Feature Module | Technical Specification |
|----------------|-------------------------|
| **Immersive Media Viewer** | Full-stage viewer with scroll-wheel zooming, double-click focus, drag-to-pan, `←`/`→` arrow key navigation, `F` key fullscreen, video play overlay, item counter (`1 of N`), and auto-hiding glassmorphic controls. |
| **Encrypted Daily Journal** | Calendar year view over encrypted annual JSON blobs — daily entries, mood icons, streaks, instant search, "On This Day" throwbacks, plus a year-progress ring with an encrypted life-in-weeks view. |
| **Secrets Vault** | Per-row encrypted logins, API keys, SSH keys, phones, cards, and notes. Masked by default, eye-to-reveal, copy auto-clears in 30 s, wiped on lock. |
| **Keyboard Shortcuts** | Full map under `Ctrl+?`: `Ctrl+1/2/3` tabs, `Ctrl+Tab` cycling, `Ctrl+,` settings, `Ctrl+L` lock, `Esc` back-stack, viewer `←/→/F`, journal save and year hop. |
| **Originals Cleanup** | Optional delete-after-verified-import: the vault re-reads itself from disk and trial-decrypts every new record before offering to unlink originals, with a per-file report. |
| **Motion & Privacy** | Reduced-motion toggle (System/Full/Reduced), sliding tab pill, staggered entrances, plus an optional screenshot shield that blinds capture tools. |
| **Interactive Themes** | Toggle between **Constellation Particles** (mouse-interactive particle gravity) and **Dynamic Canvas Wormhole** background rendering with settings customization. |
| **Phantom 3D Gallery** | Infinite draggable 3D arc perspective gallery with inertia physics, custom cream vault palette (`#fbf6f3`), and press-to-zoom. Press `G` to toggle. |
| **In-App Document Engine** | Native offline **pdf.js** rendering with page controls and zoom + rich in-app plaintext editor for `.txt`, `.md`, `.json`, `.csv`, `.js`, `.css`, and `.html`. |
| **Zero-Knowledge Security** | PBKDF2 (600,000 iterations), WebCrypto non-extractable AES-256-GCM keys, BIP-39 12-word recovery seeds, cryptographic single-item deletion, EXIF metadata stripping, tamper-proofing, and zero network calls. |
| **Dual Desktop Shells** | Native support for both **Electron 43** (portable EXE) and **Tauri v2** (Rust backend with 5.4 MB EXE & 29 MB RAM footprint). |
| **Masonry Grid & Search** | Responsive column layout (2–5 columns), drag-and-drop file import, drag reordering, and instant zero-disk filename search. |
| **Auto-Lock & Hardening** | Inactivity auto-lock (1 / 5 / 15 min), manual lock shortcut, background lock on minimize/close, and sample tamper checks on unlock. |

---

DEK ──→ wraps each file's unique 256-bit item key
              │
              ├── Photo: re-encoded through canvas (EXIF stripped)
              ├── Video: stored byte-for-byte
              ├── Document: stored byte-for-byte
              └── PDF: stored byte-for-byte
```

- **Non-extractable WebCrypto keys**: All keys are held in `SubtleCrypto` memory contexts and never exposed to JavaScript scope or disk.
- **Tamper Detection**: Deterministic round-robin sample check on unlock. Any byte flip prevents vault decryption.
- **Zero Disk Leakage**: Files are decrypted on-the-fly into Blob URLs and revoked immediately upon navigation or lock.
- **Cryptographic Deletion**: Deleting a record destroys its unique AES key.

---

## Desktop Runtime Comparison

The vault ships with **two interchangeable desktop backends** using the exact same HTML5/CSS3/JS renderer and crypto engine (`src/`).

| Benchmark Metric | **Electron 43 Shell** | **Tauri v2 (Rust) Shell** |
|------------------|----------------------|---------------------------|
| **Executable Size** | 87 MB | **5.4 MB** *(16× smaller)* |
| **Installer Size** | Portable EXE | **3.3 MB** NSIS / **3.9 MB** MSI |
| **Idle RAM Usage** | ~280 MB | **~29 MB** *(10× lighter)* |
| **Runtime** | Bundled Chromium + Node.js | System WebView2 (Windows 10/11) |
| **Backend Language** | JavaScript (Node.js) | Rust |
| **Startup Speed** | ~1.2s | **< 0.2s** |

---

## Development & Build Guide

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- (Optional for Tauri builds) [Rust toolchain](https://www.rust-lang.org/) & C++ Build Tools

### 1. Repository Setup
```bash
git clone https://github.com/FYI88/my-vault.git
cd my-vault/pcvault
npm ci
```

### 2. Launch Development Shell
```bash
npm start
```

### 3. Browser Preview Server
```bash
npm run dev
# → Local preview available at http://localhost:8779/
```

### 4. Production Build Pipeline
```bash
# Build Portable Electron EXE (dist/my-vault-portable.exe)
npm run dist

# Build Lightweight Tauri Setup (src-tauri/target/release/bundle/nsis/)
npx tauri build
```

### 5. Test Suite Verification
```bash
npm test
# → 41/41 test suite passing (18 WebCrypto + 9 Container + 14 Journal tests)
```

---

## Repository Structure

```text
pcvault/
├── main.js                  # Electron main process (secure app:// protocol, trusted IPC)
├── preload.js               # Electron contextBridge (window.vaultAPI)
├── HANDOFF-FABLE.md         # UI handoff notes for contributors
├── server.mjs               # Dev server with CSP & security headers
├── package.json             # Build targets & scripts
├── build/                   # App icons (SVG, PNG, ICO)
├── src/
│   ├── index.html           # Core HTML layout & viewer stage (shared by both shells)
│   ├── styles.css           # Design tokens, media viewer HUD, & theme styling
│   ├── renderer.js          # Main application lifecycle, viewer HUD, & event wiring
│   ├── vault-crypto.mjs     # WebCrypto engine (PBKDF2, AES-GCM, BIP-39)
│   ├── container.mjs        # .cvault container format encoder/decoder
│   ├── journal.mjs          # Encrypted daily journal & streak manager
│   ├── phantom-gallery.mjs  # 3D infinite draggable gallery physics engine
│   ├── phantom-gallery-v2.mjs # Infinite gallery wall variant
│   ├── drift-wall.mjs       # Drifting gallery wall variant
│   ├── particles.mjs        # Interactive constellation particle engine
│   ├── wormhole.mjs         # Dynamic canvas wormhole background renderer
│   ├── tauri-bridge.js      # Maps window.vaultAPI → Tauri invoke commands
│   ├── bip39-words.mjs      # 2,048 BIP-39 wordlist
│   ├── fonts/               # Offline bundled Google Fonts
│   └── vendor/pdfjs/        # Vendored pdf.js rendering engine
├── src-tauri/               # Tauri v2 Rust backend
│   ├── src/lib.rs           # 13 Rust IPC commands (atomic writes, dialogs, settings)
│   ├── tauri.conf.json      # Tauri app configuration & security capabilities
│   └── capabilities/        # Tauri permissions manifest
└── test/
    ├── crypto.test.mjs      # 18 cryptography unit tests
    ├── container.test.mjs   # 9 vault format unit tests
    └── journal.test.mjs     # 14 journal logic unit tests
```

---

## Security Audit Report

All 10 security audit findings from August 2026 are **fully resolved**:

| Audit Reference | Vulnerability Assessment | Status | Resolution Detail |
|-----------------|--------------------------|--------|-------------------|
| **SEC-001** | Trusted IPC paths | Resolved | Main process enforces dialog-minted path authorization. |
| **SEC-002** | WebCrypto protocol origin | Resolved | Custom `app://` scheme guarantees secure WebCrypto context. |
| **SEC-003** | Content Security Policy | Resolved | Strict CSP headers without `unsafe-eval` or inline scripts. |
| **SEC-004** | Path confidentiality | Resolved | Raw file paths remain isolated in main process. |
| **SEC-005** | Media EXIF retention | Accepted | Photos EXIF-stripped via canvas; raw videos kept intact. |
| **SEC-006** | Large file import guard | Resolved | Skips files > 2 GB to prevent memory exhaustion. |
| **SEC-007** | Memory cleanup | Resolved | Plaintext buffers zeroed immediately after tamper check. |
| **SEC-008** | Atomic rename cleanup | Resolved | Orphaned `.tmp-*` files auto-purged on failure. |
| **SEC-009** | Dev server security headers | Resolved | Added strict security headers to local dev server. |
| **SEC-010** | Record count validation | Resolved | Enforced record upper-bound limits on vault parsing. |

---

## License

Built with **WebCrypto**, **Electron**, and **Tauri**.  
*Private repository — for personal use.*
