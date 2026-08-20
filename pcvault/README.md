<div align="center">

# 🔐 My Vault

**A fully offline encrypted photo & document vault for Windows.**

One encrypted file holds everything — photos, videos, documents, PDFs.
Nothing ever leaves your PC. No cloud. No network. Just you and your files.

[![Version](https://img.shields.io/badge/version-1.8-blue)]()
[![Platform](https://img.shields.io/badge/platform-Windows-0078d4)]()
[![License](https://img.shields.io/badge/license-private-red)]()
[![Electron](https://img.shields.io/badge/Electron-43-47848f)]()

---

</div>

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Double-layer encryption** | Passphrase → PBKDF2 600k → KEK → DEK. Seed-based recovery key. All keys non-extractable via WebCrypto. |
| **Per-item keys** | Every file gets its own 256-bit AES-GCM key. Delete a record = cryptographic delete. |
| **BIP-39 recovery** | 12-word recovery seed, shown once, never stored. Lose your passphrase? The words are your way back. |
| **Tamper detection** | Deterministic sample of records on every unlock. Any byte flip = vault stays locked. |
| **Any file type** | Photos, videos, documents, PDFs, text files — the crypto doesn't care what the bytes are. |
| **EXIF stripping** | Photos re-encoded through canvas before encryption. GPS data, camera info — all gone. |
| **In-app PDF viewer** | Offline pdf.js canvas renderer with page navigation, zoom, and zero CSP violations. |
| **In-app text viewer** | Read `.txt`, `.md`, `.json`, `.csv`, `.js`, `.css`, `.html` files inside the vault. |
| **Masonry grid** | Responsive column layout (2/3/4/5 cols) with real aspect ratios and decrypted filenames. |
| **Phantom gallery** | Infinite draggable gallery with 3D arc perspective, inertia physics, and press-to-zoom. Press `G` to toggle. |
| **Drag reorder** | Rearrange your files by dragging. Order persists across sessions. |
| **Name search** | Search by decrypted filename. Case-insensitive, instant, zero-disk. |
| **Drag-and-drop import** | Drop files onto the grid or gallery. They're encrypted and added instantly. |
| **Video playback** | Watch videos inside the vault with in-app `<video>` controls. |
| **Auto-lock** | Idle timer (off / 1 / 5 / 15 min) + manual lock + lock on close. |
| **Particle background** | Interactive constellation animation on auth screens — mouse-grab and click-push. |
| **Portable EXE** | Single-file distribution, no installer needed. Just run it. |

## 🔒 Security Model

```
Passphrase ──→ PBKDF2-SHA-256 (600k iterations) ──→ KEK ──┐
                                                            ├──→ wraps DEK (32-byte AES-256-GCM key)
Recovery Words ──→ PBKDF2 ──→ Seed KEK ────────────────────┘

DEK ──→ wraps each file's unique 256-bit item key
              │
              ├── Photo: re-encoded through canvas (EXIF stripped)
              ├── Video: stored byte-for-byte
              ├── Document: stored byte-for-byte  
              └── PDF: stored byte-for-byte
```

- **Non-extractable keys** — all crypto via `SubtleCrypto`, never leaves the secure context
- **Plaintext wiped** — raw buffers zeroed immediately after use
- **Tamper check** — deterministic round-robin sample of 3 records on every unlock
- **No network** — the app never makes an HTTP request; zero telemetry, zero calls home
- **Secure IPC** — main process validates all file paths against dialog-minted trusted paths

## 📸 Screenshots

> *Coming soon — welcome screen with particle background, masonry grid, phantom gallery, PDF viewer, and settings.*

## 🚀 Quick Start

### Run from source

```bash
# Clone
git clone https://github.com/FYI88/my-vault.git
cd my-vault/pcvault

# Install dependencies
npm ci

# Run the app (Electron)
npm start
```

### Build the portable EXE (Electron)

```bash
npm run dist
# → dist/my-vault-portable.exe (87 MB)
```

### Build the installer (Tauri — requires Rust + VS Build Tools)

```bash
npm install -D @tauri-apps/cli
npx tauri build
# → src-tauri/target/release/bundle/nsis/My Vault_1.8.0_x64-setup.exe (3.3 MB)
# → src-tauri/target/release/bundle/msi/My Vault_1.8.0_x64_en-US.msi (3.9 MB)
```

### Run tests

```bash
npm test
# → 27/27 tests pass (18 crypto + 9 container)
```

### Run the dev server (browser preview)

```bash
npm run dev
# → http://localhost:8779/
```

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop shell** | Electron 43 **and** Tauri v2 (Rust) — same frontend, two backends |
| **Crypto** | WebCrypto API (PBKDF2, AES-GCM, HKDF) |
| **PDF rendering** | pdf.js 6.2.108 (vendored, legacy build, main-thread) |
| **Fonts** | DM Serif Display, Cormorant Garamond, JetBrains Mono (bundled offline) |
| **Particles** | Native canvas (no library, no CDN) |
| **Gallery** | Vanilla JS port of PhantomInfiniteGallery (Framer) |
| **Build** | electron-builder (portable) + tauri-cli (NSIS/MSI) |
| **Testing** | Node.js test runner (27 tests) |

## 📁 Project Structure

```
pcvault/
├── main.js                  # Electron main process (secure app:// scheme, IPC)
├── preload.js               # contextBridge → window.vaultAPI
├── server.mjs               # Dev server with CSP headers
├── package.json
├── build/                   # App icons (SVG + generated PNGs + ICO)
├── src/
│   ├── index.html           # Main HTML (shared by both shells)
│   ├── styles.css           # All styling (vault palette + animations)
│   ├── renderer.js          # UI + vault lifecycle (shell-agnostic)
│   ├── tauri-bridge.js      # Maps window.vaultAPI → Tauri invoke (Tauri only)
│   ├── vault-crypto.mjs     # Pure crypto core (PBKDF2, AES-GCM, BIP-39)
│   ├── container.mjs        # .cvault file format (CVLT magic + records)
│   ├── bip39-words.mjs      # 2048 BIP-39 words
│   ├── particles.mjs        # Interactive particle background
│   ├── phantom-gallery.mjs  # Infinite draggable gallery
│   ├── fonts/               # Bundled offline fonts
│   └── vendor/pdfjs/        # Vendored pdf.js 6.2.108
├── src-tauri/               # Tauri v2 (Rust) backend — same IPC contract
│   ├── src/lib.rs           # All 13 commands: dialogs, atomic writes, settings
│   ├── tauri.conf.json      # Window, CSP, NSIS/MSI bundle config
│   ├── capabilities/        # Tauri permission model
│   └── icons/               # App icons
├── test/
│   ├── crypto.test.mjs      # 18 crypto tests
│   └── container.test.mjs   # 9 container tests
└── audit/                   # Security audit findings
```

## 🛡️ Security Audit

All findings from the 2026-08-18 audit are **resolved**:

| ID | Finding | Status |
|----|---------|--------|
| SEC-001 | Trusted-path IPC for file operations | ✅ Resolved |
| SEC-002 | Secure `app://` scheme for WebCrypto | ✅ Resolved |
| SEC-003 | CSP headers (no `unsafe-eval`/`unsafe-inline`) | ✅ Resolved |
| SEC-004 | Vault path only in main process | ✅ Resolved |
| SEC-005 | Video/document metadata preserved | ⚠️ Accepted |
| SEC-006 | Import guard (files > 2 GB skipped) | ✅ Resolved |
| SEC-007 | Tamper-sample plaintext not wiped | ✅ Resolved |
| SEC-008 | Orphaned `.tmp-*` on failed rename | ✅ Resolved |
| SEC-009 | Dev server security headers | ✅ Resolved |
| SEC-010 | No record-count cap on parse | ✅ Resolved |

## ⚠️ Known Limitations

- **Windows only** (for now)
- **No HEIC support** — Chromium can't decode it; convert to JPEG first
- **JPEG re-encoding is lossy** (q0.92) — small quality cost for EXIF stripping
- **Unsigned EXE** — SmartScreen warning on first run (code signing costs money)
- **No notes feature yet** — the crypto already supports any file type
- **Tauri IPC uses base64** for file bytes (simple, ~33% overhead on large vaults; fine for personal scale)

## ⚡ Electron vs Tauri

The vault ships with **two desktop backends** sharing the exact same frontend (`src/`) and crypto core. The renderer talks to whichever shell via the same `window.vaultAPI` contract — Electron's preload or Tauri's `tauri-bridge.js`.

| | **Electron** | **Tauri** |
|---|---|---|
| **EXE size** | 87 MB | **5.4 MB** (16× smaller) |
| **Installer** | portable EXE, no installer | NSIS setup (3.3 MB) + MSI (3.9 MB) |
| **RAM (idle)** | ~280 MB | **~29 MB** (10× lighter) |
| **Runtime** | Bundles Chromium + Node | Uses system **WebView2** (built into Win 10/11) |
| **Backend** | JavaScript (Node) | Rust |
| **Startup** | Slower (spawns Chromium) | Faster (single small process) |
| **Dev tools** | Chrome DevTools, first-class | WebView2 DevTools |

**When to pick which:** Tauri wins on size, RAM, and startup — great for distribution. Electron wins on maturity and a JavaScript-only stack (no Rust toolchain needed to build). The crypto story is identical in both since it runs on WebCrypto in the renderer.

## 🗺️ Roadmap

- [ ] Windows Hello biometric unlock
- [ ] Text notes feature
- [ ] `--verify` CLI tool
- [x] ~~NSIS installer~~ (done via Tauri — MSI too)
- [ ] macOS / Linux support (Tauri makes this mostly config work)
- [ ] "Move vault file" (relocate without losing history)

## 📄 License

Private — not for distribution. Built with ❤️ using Electron and WebCrypto.

---

<div align="center">

**Built with [Codebuff](https://codebuff.com)** 🤖

</div>
