# My Vault — offline encrypted photo vault for PC

> **SECURITY AUDIT — 2026-08-26.** Full strix 1.5.3 agent scan (semgrep + gitleaks + ast-grep SAST, plus authz / injection / web-input / dependency / runtime agents) ran against the whole codebase and found **zero vulnerabilities** — `findings.sarif` 0 results. SAST tools pre-baked into a custom sandbox image (`strix-sandbox-tools:1.3.0`, built from `~/.strix/Dockerfile.sandbox` — Kali's apt can't install semgrep/etc.). Combined with the Aug 18–21 audit (0 critical), **all 10 SEC findings are resolved in current source** (SEC-005 stays a documented design tradeoff: videos/docs keep metadata by design).
>
> **SAVE POINT — built 2026-08-18.** A working portable EXE exists: `pcvault/dist/my-vault-portable.exe` (90 MB, unsigned — SmartScreen will warn, "more info → run anyway"). Run from source with `npm start`; test with `npm test`.
>
> **REBUILT 2026-08-19.** `node_modules` + `dist` were dropped when the project was re-imported. Restored with a portable Node 22.23.2 (win-x64) in `../.tools/node-v22.23.2-win-x64` (this machine has no system Node), `npm ci` (284 pkgs, 0 vulns), all tests green, EXE rebuilt to **86 MB**. SEC-007/008/009/010 are now resolved in source (see Audit).
>
> **v1.4–v1.8 (2026-08-19):** keepsake voice pass, masonry grid with filenames, in-app doc viewer, an offline **pdf.js 6.2.108** canvas PDF viewer (clean toolbar, zero CSP violations), and an interactive particle background on the auth screens. EXE now **91 MB**.
>
> **SYNCED FROM GITHUB 2026-08-21.** Repo `github.com/FYI88/my-vault` (private, `master`) cloned to `C:\Users\azureuser\my-vault` and merged into this workspace — brings the **daily journal + living-garden view** (`src/journal.mjs`, `src/garden.mjs`, `test/journal.test.mjs` 14/14), the **phantom gallery** (`src/phantom-gallery.mjs`), the **Tauri v2 port** (`src-tauri/`, 16× smaller EXE — needs Rust, not built here), and `src/tauri-bridge.js`. `npm ci` with the updated lockfile (adds `@tauri-apps/cli`), **41/41 tests green** (18 crypto + 9 container + 14 journal), EXE rebuilt to **91 MB**, asar verified to contain the four new modules. See v1.9 below.
>
> **v2.0 — WORMHOLE BACKGROUND (2026-08-21).** The auth-screen background is now a **wormhole vortex** (ported from wodniack's CodePen `XJbYWXx`): 150 perspective rings + up to 9k dots swirling into a tunnel, recolored to the vault palette (rose/mauve/gold/sage on cream). Easing functions inlined (no CDN), dot count scaled by area (smooth at 60fps), strict-CSP-safe. **v2.0.1: the background is now user-selectable in Settings** — a "background" card with wormhole/particles pills, persisted in localStorage (`pcvault.bg`), switching live with a toast. `particles.mjs` gained a proper `destroy()` so the swap is clean. See v2.0 / v2.0.1 below.

## What it is
A fully offline Windows desktop vault (Electron) for personal photos. One encrypted file (`myvault.cvault`) holds the whole vault; the app never touches the network. The crypto core is **ported function-by-function from the verified phone vault** in `cyclev2.html` (feature 37 + Phase-6 hardening, security-reviewed): same PBKDF2 600k → KEK → non-extractable DEK layering, same 12-word BIP-39 seed (shown once, never stored), same per-item keys wrapped by the DEK (delete = cryptographic delete), same deterministic tamper sample on unlock, same passphrase strength gate (refuse < 3), same EXIF stripping before encryption.

**Design is byte-for-byte the phone vault's** (user: "it's not the same design or font… fix that"): exact palette (`--cream/--card/--rose/--rose-dark/--mauve/--mauve-dark/--sage/--sage-dark/--gold/--text/--text-soft/--border/--shadow` from `cyclev2.html`), the same three fonts — **DM Serif Display** (italic titles), **Cormorant Garamond** (body), **JetBrains Mono** (micro labels) — **bundled offline** into `src/fonts/` (15 woff2 files + `fonts.css`, generated from Google Fonts' css2 endpoint, URLs rewritten to local; `sed` fix applied: the generated `url(./fonts/…)` was relative to `fonts/` itself, so it 404'd until rewritten to `url(./…)`), the phone's vault-screen vocabulary (`.vault-wordmark`, `.vault-sub`, `.vault-input`, `.vault-btn`, `.vault-error`, `.vault-ok`, `.vault-meter`, `.vault-seed-grid/chip/n`, `.vault-tamper`, `.vault-photo-grid/cell`, `.vault-pill`, `.vault-sec-card/title`, `#toast`), the phone's `.add-btn` buttons (mauve-dark filled, JetBrains Mono uppercase), and lucide inline SVG icons via the phone's `ic()`/`ICON_PATHS` (no emoji — the phone is deliberately emoji-free). Removed: my first-draft `♥⚙🔒` emoji, system fonts, and the off-palette styling. Fonts verified loading in-app (`[vault] fonts loaded: true true true` — DM Serif checked italic, since every DM Serif rule is italic). The 3-col photo grid, seed chips with rose-dark numbered spans, rose-dark errors + sage-dark ok lines, and the tamper banner all match the phone.

## Verified (all green)
- `node test/crypto.test.mjs` — **18/18**: create → unlock (pass + seed) → item round-trip → tamper detection (name flip + photo-byte flip) → cursor round-robin → change passphrase (old dies, seed survives) → rotate seed (old words die) → strength gate.
- `node test/container.test.mjs` — **9/9**: serialize→parse lossless, magic, garbage/truncated/empty rejected, video/doc raw bytes kept, record-count cap (SEC-010).
- App boots under Electron (`PCVAULT_DEBUG=1` → `[vault] boot ok — welcome screen`, zero renderer errors, stays alive).
- `my-vault-portable.exe` built and launches (verified process tree).

## Files
- `main.js` — main process: secure `app://` scheme (so `crypto.subtle` works — `file://` is not a secure context), window, IPC (pick folder/file, read, **atomic write** temp+rename, copy, reveal).
- `preload.js` — contextBridge → `window.vaultAPI` (sandboxed, no nodeIntegration).
- `src/vault-crypto.mjs` — pure ESM crypto core (Node + browser). No DOM/IDB/fs.
- `src/bip39-words.mjs` — 2048 words extracted verbatim from `cyclev2.html`.
- `src/container.mjs` — the file format: `CVLT` magic + version + header JSON + length-prefixed records (raw ciphertext bytes after each record JSON; no b64 bloat).
- `src/index.html` / `src/styles.css` / `src/renderer.js` — UI + vault lifecycle. System fonts only (fully offline; the phone app's Google Fonts were NOT reused).
- `src/particles.mjs` — native-canvas interactive particle background for the auth screens (ported from `BACKGROUNDANN`, no CDN).
- `src/vendor/pdfjs/` — offline pdf.js **6.2.108 legacy build** (`pdf.min.mjs` + `pdf.worker.min.mjs`) with `cmaps/` + `standard_fonts/` for the canvas PDF viewer (Apache-2.0, `LICENSE` + Foxit/Liberation licenses included). Pinned in `devDependencies`; vendored under `src/` because the build ships `src/**/*` only.
- `test/` — both node suites.
- `dist/my-vault-portable.exe` — the deliverable.

## Security model (parity with the phone vault)
- Passphrase → PBKDF2-SHA-256 **600k** → KEK → wraps the 32-byte DEK; DEK also wrapped by the seed-derived KEK. All keys **non-extractable**.
- Every photo: fresh random 256-bit item key; photo + filename AES-256-GCM under it; item key wrapped by the DEK and stored with the record → deleting a record destroys its key (cryptographic delete).
- Photos are re-encoded through a canvas before encryption (EXIF/GPS never written, orientation baked) — **full resolution kept** (the phone capped at 1400px; this is a personal archive).
- Tamper check on every unlock: deterministic round-robin sample of 3 records (photos checked on their actual bytes); any failure → stays locked + loud warning, nothing shown.
- Plaintext/raw-key buffers zeroed right after use (`vaultWipeRaw`), matching the phone's wipe discipline.
- Auto-lock: idle timer (off/1/5/15 min, default 5) + manual lock + lock on close. Object URLs revoked on lock.
- Vault path lives **only** in main's `userData/settings.json` — the renderer keeps no copy (`pcvault.lastPath` removed; boot asks main via `vault:getLastPath`, stale bookmarks are cleared via `vault:forgetPath`) — SEC-004 resolved.
- Decoy passphrase / fingerprint / sync deliberately NOT ported (personal offline PC vault; all cheap to add later — see Next).

## Build & run
- `npm start` — run from source. `PCVAULT_DEBUG=1 npm start` prints renderer console to stdout.
- **Toolchain:** this machine has no system Node — prepend the portable copy to PATH when running from `pcvault/`: `export PATH="$(pwd)/../.tools/node-v22.23.2-win-x64:$PATH"`.
- `npm test` — both suites.
- `npm run dist` — rebuild `dist/my-vault-portable.exe`.
- Vault file location: chosen at creation via folder picker; remembered (`pcvault.lastPath` in localStorage). Backup = settings → "back up a copy…" (or just copy the `.cvault` file — it's self-contained).
- Note: the portable EXE is unsigned → Windows SmartScreen shows a warning the first time. Fix for a future release: code-sign (costs money) or accept the warning.

## v1.1 — videos + documents + any file type (shipped 2026-08-18)
The vault now takes **any file** (user: "lets add videos too… and docs… if its easy lets do it"). The container + crypto were already generic (bytes in → bytes out), so this was pure UI work: the `+ add files` button (accept removed), records carry `mime` + `size`, and kind-aware views — images are still **EXIF-stripped** (canvas re-encode, as the phone), videos + docs are stored **byte-for-byte as-is** (no transcoding; a video's embedded metadata, if any, is preserved — honest caveat). Grid: image cells hydrate to real thumbnails, video cells get a **seek-frame thumbnail** (hidden `<video>` → canvas → thumb, 15s timeout fallback) with a play badge, doc cells stay an icon (no lazy decrypt). Item view: photo → `<img>`, video → **in-app `<video controls>` via blob URL** (CSP needed `media-src 'self' blob:` — caught while writing the integration test), doc → name/size/type + an **export a copy…** button on every item (save dialog → decrypt → write plaintext — the only explicit plaintext-to-disk path, user-triggered). Records keep the phone's `photo`/`photoIv` field names for all kinds so container + tamper code are untouched; tamper check verifies photo bytes but videos/docs via the item-key unwrap + name (cheap — a flipped byte in the wrapped key or JSON still trips it). `vault:saveFileAs` + `vault:writeFile` IPC added; `lock()` now also stops the video player and clears the doc view.

**Verified beyond the node suites (26 tests: 18 crypto + 8 container):** a full browser integration run drove the REAL UI in the preview webview with a mocked file layer — create → seed (12 chips) → enter → add a PDF + a real canvas-generated PNG through the actual file-input handler → grid shows one icon cell + one hydrated thumbnail (the decrypted, EXIF-stripped PNG) → doc view shows name/size → then the tamper E2E: lock → flip a byte in the in-memory photo ciphertext → correct passphrase → **stays locked + tamper warning shown** → flip it back → unlocks clean. The packaged EXE was verified to contain the new strings (`+ add files`, `media-src`, `videoThumbUrl`).

## v1.2 — drag-and-drop grid reordering (shipped 2026-08-18)
Native HTML5 DnD on the grid: cells are `draggable`, a drag shows a rose `drop-before`/`drop-after` inset marker (pointer's left/right half of the target cell decides), dropping on empty space moves the item to the end, and `dragend`/`dragleave` clear the marks. Reorder mutates `state.items` (the array order IS the file order) then `renderGrid()` + `saveVault()` — persisted in the container, so it survives reload. Coexists with drag-to-import: a drop whose `dataTransfer.types` includes `Files` is left to the file handler (verified both paths). **Thumbnail cache added to make reorders instant:** `state.thumbCache` (id → object URL) is filled on first hydration and reused by `renderGrid`, so a re-render after a drop never re-decrypts a photo; cleared with the object URLs on lock. Verified in the browser harness with synthetic DragEvents: drop-before mark set, [doc, photo] → [photo, doc], file re-saved, photo cell re-rendered from cache with its `<img>` intact; file-import drag still adds a new cell. EXE rebuilt (03:46) and verified to contain `wireReorder`/`thumbCache`.

## v1.3 — name search (shipped 2026-08-18)
Inline search row on the unlocked screen (`.vault-search`, focus ring in mauve, lucide search + × icons): typing filters the grid live to files whose **decrypted name** contains the query (case-insensitive), with a `X of Y files` count line and a `nothing matches that name` empty state. File names are encrypted, so the index is **decrypted lazily in memory** — `ensureNames()` decrypts every name exactly once into `state.nameCache` (a shared in-flight promise; tampered records cache `''` and match nothing), and `filteredItems()` filters on it. `renderGrid` is now async with a **stale-render guard** (`renderSeq`) so a slow first decrypt can't overwrite a newer query's result; the thumbnail cache keeps re-renders instant. `Escape` clears + blurs, the × clears, and **lock() wipes the whole plaintext index** (`nameCache.clear()`, `namesReady = null`, query + input cleared) — search state exists only while unlocked, nothing touches disk. Verified in the browser harness with 4 docs: `paris` → 1 cell + `1 of 4 files` + all 4 names cached (decrypt-once), `zzz` → no-match state, clear → 4 cells, lock → cache 0 + input empty. EXE rebuilt (03:52) and verified to contain the new code.

## v1.3.1 — cream title bar (2026-08-18)
The native Windows title bar (black under OS dark mode) is replaced with a hidden bar + `titleBarOverlay`: the close/maximize/minimize buttons stay native but sit on a cream band (`#f2eae5`, slightly darker than `--cream #fbf6f3`; symbols in `--text #4a3f42`). The `.win-drag` strip (40px, `-webkit-app-region:drag`) makes the band draggable and double-click-maximizable. Window `backgroundColor` aligned to `--cream`. To flip the band to exactly the app color, change `titleBarOverlay.color` in `main.js` to `#fbf6f3`.

## v1.3.2 — app icon + friendly browser-preview message (2026-08-18)
- **Logo** (final, user-picked): `build/icon.svg` — the wordmark "Vault" (capital V, Vanguard-style treatment) in the app's own bundled **Cormorant Garamond Semibold**, cream on a mauve-dark rounded ground. Favicon is the rasterized 32px PNG (`src/favicon.png`).
- **Icon pipeline** (`scripts/make-icon.js`): renders `build/icon.svg` with offscreen Chromium (no ImageMagick needed — uses the project's own Electron). Captures a single 256×256 PNG, then downscales to 16/32/48/64/128/256 via `nativeImage.resize`, plus a multi-size `build/icon.ico` (all 6 sizes). Run: `npx electron scripts/make-icon.js`. To change the logo, edit `build/icon.svg` (use `url(./<font>.woff2)` for bundled fonts) and re-run the script.
- **Wiring:** `main.js` BrowserWindow `icon` (dev, `existsSync`-guarded), `package.json` `build.win.icon` (packaged EXE), `<link rel="icon">` in `src/index.html` (rasterized PNG for the browser page).
- **Browser-preview fix**: the dev-server page (plain browser, no Electron bridge) used to die on boot with `Cannot read properties of undefined (reading 'getLastPath')`. `boot()` now detects a missing `window.vaultAPI` and shows the welcome screen with a clear toast ("this page runs inside the My Vault desktop app") instead of a cryptic TypeError; the welcome buttons no-op gracefully too.
- **Note**: after any icon or title bar change, rebuild with `npm run dist` to pick it up in the EXE.

## v1.4 — keepsake voice pass (2026-08-19)
Every user-facing string rewritten into one warm, personal voice (the user's /planning pass). Removed the security-lecture tone, the Oxford commas, and the em-dash overuse:
- "pick a passphrase — no one else should know it" → "choose a passphrase you'll remember".
- "your 12 words" / "recovery seed" / "rotate my 12 words" consolidated to **"recovery words"** everywhere (seed screen, recovery form, change-passphrase, rotate). One deliberate exception: the change-passphrase error still says "enter all 12 words…" because that is a count, not a name.
- Tamper banner softened from a scare into a calm, actionable line ("the vault couldn't be verified… if you have a backup copy, put it back").
- "keepsake" dropped as the item-title placeholder and item-error noun (it leaked onto PDFs and videos too); the item view now shows an empty title until the real name decrypts.
- Import toasts joined with ", " instead of " — "; "tap again to delete" → "click again to delete" (desktop, not touch).
- `vault-crypto.mjs`'s two user-visible error strings updated too (they surface through changePass): "those words don't check out — order and spelling matter" → "those words don't look right. check the order and spelling."; "the seed words don't unlock this vault" → "those words don't unlock this vault".

Pure copy — no behavior, crypto, or schema change. Verified: 27/27 tests still green; welcome, create, locked, seed and settings screens render the new copy in the preview with zero CSP violations. EXE rebuilt.

## v1.5 — masonry grid with filenames (2026-08-19)
The unlocked grid is now a **masonry** (CSS columns: 2/3/4/5 at 560/900/1200px breakpoints) instead of a uniform square grid:
- **Real aspect ratios** — thumbnails are no longer `object-fit:cover`-cropped to 1:1. `img{ width:100%; height:auto }` keeps each photo/video's true shape (the thumb pipeline already preserved aspect ratio, so this was layout-only).
- **Filename under every cell** — a `.cell-name` caption (JetBrains Mono, truncated with ellipsis, full name on hover via `title`) sits under every cell. `renderGrid` now `await ensureNames()` so captions decrypt once and show the real name; docs finally read as "icon + name" instead of an anonymous square.
- **Reorder kept working** — the drop marker flipped from left/right to **top/bottom** (`e.clientY` vs the cell's vertical midpoint) since columns stack vertically; array order is still the file order, and re-render still reuses the thumbnail cache.
- Cell DOM is now `media` + `caption`; hydration only swaps the `.cell-media` contents so the caption survives.
- Hardening: `ensureNames`/`renderGrid` bail if locked mid-decrypt (no plaintext name cached across a lock).

Verified live in the preview: imported a real 300×200 PNG + a `.txt` through the actual `handleFiles` path → 2 columns, the photo cell rendered 191×128 (3:2, uncropped), both cells carried their names and were draggable, zero CSP violations. 27/27 tests still green. EXE rebuilt.

## v1.6 — in-app document viewer (2026-08-19)
Docs now open inside the vault instead of only exporting:
- **PDF** — rendered in an `<iframe>` via the bundled Chromium PDF viewer (a `blob:` URL of the decrypted bytes). CSP gained `frame-src blob:` (meta + `main.js` CSP_HEADER + `server.mjs`); `object-src 'none'` is unchanged.
- **Text** (txt/md/csv/json/xml/js/css/html and any `text/*`) — decoded in-page (UTF-8 + UTF-16 BOM sniffing) and shown in a scrollable `.item-text` `<pre>`; content is assigned via `textContent` only, never `innerHTML`, so a malicious file cannot inject markup. Files over 200 KB preview the first 200 KB with a "showing the first…" note.
- **Everything else** (Word/Excel/zip/etc.) — keeps the icon + name + size + export fallback.
- Blob URLs are tracked in `state.urls` and revoked on lock; `openItem`/`lock` clear the iframe `src` and text pane.

Known caveat (resolved in v1.7): Chromium's embedded PDF viewer injected inline styles that the strict `style-src 'self'` blocked, lightly mis-styling its toolbar. v1.7 replaced the iframe with an offline pdf.js canvas viewer.

Verified live in the preview: imported a real `notes.txt` + a generated `doc.pdf` through `handleFiles` → the text pane shows "hello from the vault…" and the PDF iframe renders the page ("Hello from the vault") from a `blob:` URL. 27/27 tests green. EXE rebuilt.

## v1.7 — pdf.js canvas PDF viewer, zero CSP violations (2026-08-19)
The PDF path swapped from Chromium's embedded iframe viewer to an **offline pdf.js rendering to canvas**, giving the in-app viewer a clean, self-styled toolbar and **zero CSP violations**:

- **Vendored pdf.js 6.2.108 (legacy build)** into `src/vendor/pdfjs/`: `pdf.min.mjs` + `pdf.worker.min.mjs`, plus `cmaps/` (CJK character maps) and `standard_fonts/` (standard 14 fonts via Liberation). The **legacy** build is used because the modern build calls `Uint8Array.prototype.toHex()`, which the preview webview (Chromium 130) lacks; legacy ships a polyfill and works on both Electron 33 (preview) and Electron 43 (the app).
- **Main-thread "fake worker"**: importing `pdf.worker.min.mjs` sets `globalThis.pdfjsWorker`, which pdf.js detects and runs on the main thread — no Web Worker, no `worker-src`, no eval. Parsing runs on the UI thread (fine for personal docs).
- **Canvas + own toolbar**: `#itemPdf` is now a toolbar (`prev / page X of Y / next`, `zoom − % +` in 0.5–3× steps) over a scrollable canvas. Pages render DPR-aware (devicePixelRatio), so text is crisp. Paging cancels the in-flight render (handles `RenderingCancelledException`) with a stale-render guard; `closePdf()` destroys the loading task on lock/back/delete (`pdf.js` v6 moved `destroy()` onto the loading task, not the proxy).
- **CSP tightened**: removed `frame-src blob:` (no iframe left), added `connect-src 'self'` for the same-origin cmap + standard-font `fetch`es (meta + `main.js` `CSP_HEADER` + `server.mjs`). No `unsafe-eval`/`unsafe-inline` anywhere.
- **Item-view fix**: `itemImg`/`itemVideo` now start hidden and are shown only for their kind — the empty `<video controls>` used to render a stray 300×150 box beside photos and PDFs (squeezing the viewer to 70px).

Not bundled (rare in personal docs; export still covers them): the WASM color/image decoders (`wasm/`, `image_decoders/`, `iccs/`), so JPEG2000/JBIG2 images and ICC-managed color in a PDF fall back to pdf.js's simpler paths. Password-protected PDFs error the same as any unreadable file.

Verified live in the preview through the real `handleFiles` → `openItem` path: a generated `hello.pdf` encrypted as a doc record renders "Hello from pdf.js" to a 375×180 (DPR 1.25) canvas, the toolbar shows `page 1 of 1` / `100%` with correct disabled states, zoom-in → `125%` (canvas grows), cmap + Liberation font fetches return 200, and the console shows **zero CSP violations** (only the expected "fake worker" + missing-vaultAPI warnings). 27/27 tests green. EXE rebuilt (91 MB; asar verified to contain the vendored pdf.js + cmaps + fonts).

## v1.8 — interactive particle background on the auth screens (2026-08-19)
The login flow (welcome / create / locked / seed) now carries the animated, interactive particle background from `BACKGROUNDANN` behind the card:

- **`src/particles.mjs`** — a pure native-canvas port of BACKGROUNDANN's no-CDN version (no particles.js, no network, no eval — strict-CSP-safe). Drifting dots + connecting lines, mouse **grab** (lines reach toward the cursor) and click **push** (spawns particles).
- **Recolored to the vault**: rose-dark + mauve particles on the cream ground with subtle link lines (0.2 alpha) — not the demo's black-on-white.
- **Placement + gating**: a fixed `#authBg` canvas at `z-index:0` behind `.wrap` (`z-index:1`), `pointer-events:none` (interaction comes from window listeners). `renderer.js` `show()` calls `particles.setActive()` so it runs only on welcome/create/locked/seed and pauses on the grid/item/settings screens.
- **Always animates**: the `prefers-reduced-motion` check was removed — particles always animate and respond to mouse regardless of the OS accessibility setting.

Verified in the preview: particles render behind the welcome card (screenshot — mauve/rose constellation), the animated loop advances and the mouse-grab adds lines, and the console stays clean. 27/27 tests green. EXE rebuilt (91 MB; asar verified to contain `src/particles.mjs`).

**Real EXE smoke-test (2026-08-19):** launched `dist/my-vault-portable.exe` (Electron 43), opened a temporary empty vault and reached the actual locked screen. The packaged `#authBg` canvas was present at 1353×953 while `screen-locked` was active. Canvas pixel hash changed from 878490360 to 508419348 over 1.5 seconds, confirming the packaged animation loop works. No CSP-related console entries. The temporary smoke-test vault was removed after the check.

## v1.9 — journal, phantom gallery + Tauri port (pulled from GitHub 2026-08-21)
Synced from the private repo (see top SAVE POINT). Features the user built upstream and pushed:

- **Daily journal** (`src/journal.mjs` + `src/garden.mjs`): encrypted per-year journal blobs stored as `journal`-kind records (never shown in the vault grid/search/gallery — `vaultItems()` filters them), with a living-garden canvas view (`createGarden`) where daily word counts grow plants, plus streaks (`calcStreak`) and case-insensitive search (`searchYear`). 14 new node tests cover round-trips, streak edge cases, growth stages and search.
- **Phantom gallery** (`src/phantom-gallery.mjs`): infinite draggable gallery with 3D arc perspective, inertia physics, and press-to-zoom (`G` toggles) alongside the masonry grid.
- **Tauri v2 port** (`src-tauri/`): same frontend on a Rust backend, ~16× smaller EXE. **Not buildable on this machine** (no Rust toolchain) — Electron remains the local deliverable.
- `src/tauri-bridge.js`: side-effect module so the frontend can run under Tauri's IPC as well as Electron's `window.vaultAPI`.
- `package.json` now also runs `test/journal.test.mjs` in `npm test` and pins `@tauri-apps/cli` in devDependencies.

Verified: `npm ci` clean (0 vulns), **41/41 tests green**, EXE rebuilt (91 MB) and the packaged `app.asar` contains `garden.mjs` / `journal.mjs` / `phantom-gallery.mjs` / `tauri-bridge.js`; dev server boots the new renderer with zero console errors (all four modules import cleanly in the browser preview).

## v2.0 — wormhole vortex background (2026-08-21)
The auth-screen background (welcome / create / locked / seed) is now a **wormhole vortex**, replacing the particle field (user: "let's try this one" → wodniack's CodePen `XJbYWXx`):

- **`src/wormhole.mjs`** — port of the pen with three changes: (1) the pen imports `easing-utils` from the esm.sh CDN — the easing functions (`outCubic` / `outExpo` / `inExpo` / `linear`) are **inlined**, so it stays zero-network and strict-CSP-safe; (2) the pen spawns **20,000 dots** (laggy) — here the count scales with canvas area (`dotDensity` 4200 px², `minDots` 800, `maxDots` 9000) so it stays smooth at 60fps; (3) **recolored from teal-on-black to the vault palette** — rose-dark / mauve / gold / sage dots + mauve-dark perspective rings on the cream ground, matching the keepsake look.
- Same API as `particles.mjs` (`initWormhole(canvas)` → `{ setActive, resize, destroy }`), so `renderer.js` swapped one import + one call (`initParticles` → `initWormhole`, line 11 / 57 / 1395). The `#authBg` canvas, `AUTH_SCREENS` gating in `show()`, and `pointer-events:none` CSS are unchanged.
- **`src/particles.mjs` is kept** as a fallback — to restore the old background, change the `wormhole.mjs` import back to `particles.mjs` and `initWormhole` → `initParticles`.
- Always animates regardless of OS reduced-motion (same policy as the particles fix).

Verified in the preview: canvas animates (pixel samples move over time), screenshot shows the vortex rings + palette dots behind the welcome card, zero CSP violations, only the expected browser-mode warning. **41/41 tests green** (pure UI swap). EXE rebuilt (91 MB); `app.asar` verified to contain `wormhole.mjs` (and still `particles.mjs`).

## v2.0.1 — background picker in Settings (2026-08-21)
The background is now **user-selectable** (user: "make it changeable in the settings — from this to the particles"):

- New "background" card in Settings (`index.html`) with two `vault-pills`: **wormhole** (default) and **particles**, matching the auto-lock pill pattern. Choice persists in localStorage (`LS_BG = 'pcvault.bg'`), rendered on boot and when settings opens (`renderBgPills()`).
- `renderer.js` imports both `initWormhole` and `initParticles`; `mountBackground()` destroys the current controller and mounts the chosen one on the same `#authBg` canvas, re-activating it if the current screen is in the background set. Pill clicks persist + remount + toast ("background: wormhole").
- `settings` was added to the background-active screen set, so the settings screen **previews the background live** while you pick.
- `particles.mjs` now exposes a real `destroy()` (removes its window listeners + cancels rAF) so switching back and forth never leaks listeners or stale loops — matched the wormhole's API.

Verified in the preview: clicking the particles pill mounts particles and the canvas content changes (pixel sample 16 vs wormhole's 73 after settling), clicking back restores the wormhole, the `on` pill tracks the stored choice, and the console stays clean. **41/41 tests green**. EXE rebuilt (~90 MB; asar contains `wormhole.mjs` + `particles.mjs`, packaged renderer has the picker code, packaged index.html has both pills).

## Audit (2026-08-18 re-run, /auditme)
Second full audit pass — same threat model (offline personal vault; device thief + shared-household user + casual file recipient). Prior 6 findings re-verified: SEC-001/002/003/004/006 still resolved (no regressions), SEC-005 still open (accepted). OSV check live this run: 240 pinned deps, zero known CVEs. Live dynamic pass: Electron shell boots clean (zero CSP violations); dev-server page observed in browser (zero CSP violations, zero third-party). Dev-server traversal probes: raw `../` and `%2e%2e` collapsed by the WHATWG URL parser (404), `%5c` backslash variant blocked by the `startsWith(root)` boundary (403). Four new INFO findings added to `findings.json` (SEC-007 tamper-sample plaintext not wiped, SEC-008 orphaned `.tmp-*` on failed rename, SEC-009 dev server lacks security headers, SEC-010 no record-count cap on parseVault). All four are now **resolved in source**: SEC-007 (`vault-crypto.mjs` wipes the sampled plaintext), SEC-008 (`main.js` unlinks the tmp file on failed rename), SEC-009 (`server.mjs` sends the CSP + nosniff headers), SEC-010 (`container.mjs` `MAX_RECORDS = 100000` + a 9th container test). Only SEC-005 remains open (accepted). Note: `findings.json` statuses for 007–010 still say `open` and should be flipped to `resolved` on the next audit re-run.

## v2.9.14 — custom lock-screen background (image or video) (2026-08-24)
Settings → background now offers **image** and **video** alongside wormhole/particles. Picking one opens a native file dialog (images: png/jpg/webp/gif/bmp/svg; videos: mp4/webm/mov/mkv/avi); the chosen file is **copied into `userData/background/`** (main process) so the vault stays self-contained even if the original moves — only that copy's bytes are ever handed to the renderer, as a blob URL (CSP already allows `img-src blob:`/`media-src blob:`). The renderer never touches the file system. Choice persisted in localStorage (`pcvault.bg` = wormhole | particles | image | video), matching the other pills. In mono theme the media background gets the same grayscale/invert treatment as the canvas. A "remove" button resets to wormhole and deletes the copy (vault:clearBackground). The packaged EXE was smoke-tested via CDP with a seeded image: `<img>` mounted with a blob src, canvas hidden, choose/remove row shown — then cleaned up.

## v2.9.15 — PhantomInfiniteGallery v2 as a third gallery style (2026-08-24)

Per user request ("add this for the grid too as an option phantom-infinite-gallery-v2 in documents"), the supplied `Documents/phantom-infinite-gallery-v2.html` demo is now a selectable gallery style alongside phantom and drift.

- **`src/phantom-gallery-v2.mjs` (new)** — a faithful vanilla port of the demo (infinite draggable wall on a 3D curve, hold-to-zoom, inertia throw, cursor parallax, blur-ghost hover, and the zoom HUD − / % / + / Reset). Same controller contract as the other galleries: `createPhantomGalleryV2(host, opts)` → `{ destroy, setItems }`, items `{ id, thumbUrl, title, meta, name }` (tiles show the caller's **own blob: thumbnails**, not the demo's generative art), `onItemClick` opens items. All styling via CSSOM — no inline style attributes, no eval, no remote URLs (strict-CSP-safe).
- **Camera math ported 1:1** — `mulberry32` wrap, cursor-anchored zoom, `friction 0.945` momentum, `parallax*`, `curveMaxAngle 14°` / `curveDepth 70`, seamless wrap modulo the base grid. The base grid is `cols × rows` (rows = ceil(items/cols), capped at 40) replicated 3×3 so a large vault still shows everything but never spawns tens of thousands of tiles.
- **Adapted to the vault** — the wall wrapper is full-size (not the demo's 0×0) so it's a real hit-test surface, matching phantom-gallery's verified-in-app `elementFromPoint` click resolution. Late-hydrating thumbnails are picked up per-frame (in-place mutation, no rebuild — the drift-wall dark-tile bug doesn't apply).
- **Wiring (`renderer.js` / `index.html`)** — a third pill **phantom v2** in Settings → gallery style, `galleryStyleChoice()` / `adoptGalleryStyleIntoFile()` accept `'phantom-v2'` (rides in `manifest.prefs.galleryStyle` like the others), `makeGalleryController()` builds it on `#phantomGallery` (`ground: #171014` to match the stage; accent stays the demo's `#9fd3ff`), toast label map. `vault-crypto.mjs` default stays `'phantom'`.

**Verified:** syntax clean, **52/52 tests green**, and live in the preview webview — 180 tiles for 18 items (5×4 base × 9 replicas) with `rotateY(14deg)` curve transforms, real `blob:` thumbnails on visible tiles (zero CSP violations; only `data:` URLs are correctly blocked, same as the other galleries), captions (short title + year/size), HUD zoom +/Reset and the hold-to-zoom gesture, drag moves the camera, late hydration shows without a rebuild, and `destroy()` clears the host. Note: click-to-open can't be exercised in the preview webview (Chromium 130 doesn't hit-test 3D-rotated elements via `elementFromPoint` — the existing phantom gallery fails identically there) but uses the same pattern that's smoke-tested working in the packaged EXE.

**REBUILT + verified in the packaged EXE (2026-08-24, 94.8 MB):** `npm run dist` clean; `app.asar` contains `src/phantom-gallery-v2.mjs`, the updated `src/renderer.js` and `src/index.html` (phantom v2 pill). No runtime smoke-test this round (the click path needs the packaged app's Chromium; the preview verified everything else).

## v2.9.16 — phantom gallery replaced with the v4 "Infinite Gallery Wall" (2026-08-24)

Per user request ("replace the phantom grid with the v4 version in Documents"), the **phantom v2** gallery style is now a faithful port of `Documents/phantom-infinite-gallery-v4.html`. The v2/v4 style keeps the same `phantom-v2` pref value, so vaults that already saved it keep working — only the visuals and labels changed.

- **`src/phantom-gallery-v2.mjs` (rewritten)** — the wall now includes the **v4 SVG divider grid**: one faint stroke line runs through every gutter (right + below each cell), replicated 3×3 like the tiles. `projectPoint()` replicates both CSS effects that a plain SVG line doesn't get for free — the transform-origin residual shift `halfW·(1−scale)` and the `perspective` divide `P/(P−z)` — so the grid stays **pixel-locked to the tile gutters at any zoom/pan**. Horizontal gutters are sampled at 6 points so they get the same real curve the tiles get; vertical gutters (fixed worldX) stay straight. Lines are `1px` `stroke-width` with `vector-effect: non-scaling-stroke`, laid under the wall in a pointer-events-none SVG.
- **Tile transform upgraded to the v4 form** — `translate3d(sx − halfW·scale, sy − halfH·scale, z) rotateY(angle) scale(scale · (P−z)/P)`: the extra `(P−z)/P` size-compensation term keeps edge tiles constant-size on the curve instead of shrinking under the perspective divide. `curveDepth` raised 70 → 90, `gap` 34 → 20 to match the demo.
- **Renderer wiring unchanged** — only the module body, the pill label ("phantom v2" → **"phantom v4"**), the toast label, and the comment changed. `galleryStyleChoice()` / `adoptGalleryStyleIntoFile()` / `makeGalleryController()` still key off `'phantom-v2'`.

**Verified:** 52/52 tests green (18 crypto + 9 container + 25 journal). Live in the preview webview — mounted the wall with 8 blob-thumb items: **90 tiles + 180 divider paths** for the 2×5 base grid, curve transforms (`rotateY(14deg) scale(0.947)` at the edges), captions + HUD (100% → 121% → 82% via +/−, Reset back), 1200px drag pans the camera with the grid glued to the tiles, `setItems` re-sizes, `destroy()` leaves zero DOM. Zero CSP violations, zero module errors (only the pre-existing welcome-screen background recursion noise).

**REBUILT (2026-08-24, 94.8 MB):** `npm run dist` clean; `app.asar` (232 entries) contains `src/phantom-gallery-v2.mjs`, `src/renderer.js`, `src/index.html`. No runtime smoke-test of the click path (same preview-webview limitation as before — `elementFromPoint` doesn't hit-test 3D-rotated elements in Chromium 130; the pattern is unchanged from the v2 round and remains clickable in the packaged EXE).

## v2.9.17 — gallery goes fullscreen immersive (no more "video box") + fade-in + prompt-master (2026-08-24)

Per user report ("it looks like a video being played… white and then edges and corners with the gallery phantom thing"), the phantom v4 wall no longer looks like a floating dark video box on the light page — it now fills the whole window, and the mount flicker + harsh SVG gutters were fixed.

- **Fullscreen stage** — `body.gallery-mode` now hides the tabs/search/file-line/action-sidebar (`.wrap` padding zeroed, page background `#171014`, `overflow:hidden`), and `#phantomGallery` becomes `position:fixed; inset:0; z-index:160` — under the transparent 34px titlebar (z-200) so the window controls stay live and the dark stage bleeds through. Exit via the new floating **exit gallery** pill (bottom-right, z-900, frosted), **Esc**, or **G** (renderer): `toggleGallery()` shows/hides the pill, Esc wired.
- **Position guard in all three gallery modules** — phantom-gallery.mjs / phantom-gallery-v2.mjs / drift-wall.mjs previously forced `container.style.position='relative'` inline, which **overrode** the stylesheet's gallery-mode `fixed` and silently kept them as light boxes. Each now does `removeProperty('position')` + fall back to relative only when computed is `static`. Verified in preview: all three mount `fixed` in gallery mode.
- **No white "buffering" flash** — v2 (`phantom-gallery-v2.mjs`) now fades the wall in: opacity 0 (set with transition disabled + forced reflow so it doesn't animate from the previous frame's 1), then 1 once a real thumb lands or after 700ms (doc tiles).
- **Grid lines softened** — divider-grid stroke `rgba(255,255,255,0.09)` → `0.05` so the v4 SVG gutters read as a faint texture, not stuck-on corners/edges.
- **HUD nudged** below the 34px titlebar (`top:48px`) in fullscreen.

**Verified:** 52/52 tests green, syntax clean; live in the preview — phantom/drift/v2 all stay `fixed` full-bleed in gallery mode (measured computed style), page chrome hidden, titlebar + traffic lights still clickable, pill at bottom-right, wall fades in (0 → 1 with no flicker-out), drag/zoom/HUD wrap intact, `destroy()` leaves zero DOM. Screenshots confirm the immersive look.

**prompt-master installed (2026-08-24):** cloned `nidhinjs/prompt-master` into `~/.claude/skills/prompt-master` (SKILL.md v1.8.0 + references/) — a Claude skill for writing precise prompts for any AI tool. Activates only when asked to write/improve a prompt; no app side effects.

**REBUILT (2026-08-24, 94.8 MB):** `npm run dist` clean; asar contains the updated modules + HTML/CSS.

## v2.9.18 — phantom gallery updated to the v5 wall (cards, straight grid lines) (2026-08-24)

Per user request ("update the code of the phantom gallery with this new version phantom-infinite-gallery-v5"), `src/phantom-gallery-v2.mjs` is now a port of `Documents/phantom-infinite-gallery-v5.html`. The prior v2.9.17 immersive fullscreen + hidden-on-hover titlebar + no-HUD work is preserved.

- **Card tiles** — `TILE_W 200 × TILE_H 230` (was 210×150): the image area is now a **rounded (6px) square** with the caption as a flex row **below** it (not overlaid). Hover scales the card 1.02 and zooms the photo 1.06 (blur ghost 0.85).
- **Straight divider lines** — `projectPoint()` keeps the transform-origin residual shift + perspective divide so the gutters stay pixel-locked, but `pathFor()` now draws **two-point segments** (project each endpoint, one `M… L…`) instead of the v4 bow-sampling — tiles are flat planes that rotate, so a straight gutter line is the correct same interpretation.
- **No zoom HUD** — the v5 demo ships WITHOUT −/%/+/Reset; the renderer's `showHud:false` is now the module default (hold-to-zoom, drag + inertia, parallax intact). The floating **exit gallery** pill + Esc remain the ways out. (`showHud` / `accent` options are gone from the module.)
- The demo's "Edit gallery" **CMS panel is not ported** — in the demo it edits generated art held in localStorage; in the vault the items are encrypted files edited through the vault UI.

**Verified:** 52/52 tests green; preview shows rounded card tiles with captions below (`PHOTO 3 · 2022`), 180 straight two-point gutter paths glued to the gutters, hover card/photo zoom, wall fade-in, no HUD buttons, titlebar hidden at rest + full-opacity on hover of the top strip, host stays `fixed` full-bleed, `destroy()` clean.

**REBUILT + LOCKED-FILE FIX (2026-08-24, 94.8 MB):** the portable build had been hanging on "output file locked for writing (maybe virus scanner)" — the real cause was a **stale running `my-vault-portable.exe` (PID 5220) holding the output path**; closing it + removing the stale EXE let `npm run dist` finish in seconds. asar (232 entries) confirmed to contain the updated modules + CSS/HTML. `package.json` left untouched (no sign overrides; the envar `CSC_IDENTITY_AUTO_DISCOVERY=false` was only a test).

## v2.9.19 — phantom wall grid x:y + scale settings (2026-08-24)

Per user request ("add a x:y and grid scale picker in settings of the grid wall or this phantom gallery"), the phantom v4 (v5 wall) gallery now has settings:

- **Settings UI** — under the gallery-style pills (shown only when **phantom v4** is the active style): a **grid** row with two number inputs (`columns 1–16 × rows 0–30`, rows empty = auto = fill by item count) and a **grid scale** slider (50–250%, tile + gap sizes, default 100%).
- **Prefs travel with the vault** — `manifest.prefs.pgCols / pgRows / pgScale`, same pattern as `galleryStyle`; applied on unlock and to an open gallery live (rebuild on change), persisted debounced (300ms) via `saveVault()`.
- **Module** — `createPhantomGalleryV2` gained `cols / fixedRows / tileScale`; base-cell cap 400 (×9 replicas) so a huge manual grid can't spawn tens of thousands of tiles; rows/cols clamped (16×30 max, product ≤ 400). `TILE_W/H` + gap scale with `tileScale` (min 40/46px).

**Verified:** 52/52 tests green; module with `cols:6, fixedRows:3, tileScale:1.4` → 162 tiles (300px×322px) + 324 two-point divider paths, settings block hidden for phantom/drift and revealed for phantom-v4, inputs populate from prefs, `destroy()` clean.

**REBUILT (2026-08-24, 94.8 MB):** portable build finished in seconds (stale running instance was the past lock).

## v2.9.20 — drag-and-drop import fixed (works anywhere on the window) (2026-08-24)

Per user report ("i cant seem to drag and drop pics or videos or anything"), file import by drag-and-drop is fixed:

- **Root cause:** the UI promises "drop them anywhere on this window", but file drops were only handled on `#grid` and `#phantomGallery`. Dropping on the padding, header, sidebar or journal pane fell through to Electron, which **navigated the window to the file** (blank/white, nothing imported) — and the grid's own file `drop` handler never called `preventDefault`.
- **Fix (`renderer.js`):** a window-level `dragover` + `drop` pair now accepts file drops **everywhere** when unlocked — `preventDefault()` (so the window never navigates) + `dropEffect:'copy'`, importing via `handleFiles`. Per-element handlers (grid / gallery host) route through the same guarded `handleImportDrop(e)`, with an `e.__vaultImportHandled` flag so one drop can never import twice (grid listener + bubbling window listener). Non-file internal reorder drags are untouched (`hasFiles` gate).
- **Boot recursion fixed too:** `mountBackground()` → `mountCustomBackground()` → `mountBackground()` looped forever (stack-overflow RangeError on every boot in the browser preview, and a wedge risk when a custom bg was chosen without the bridge). `mountBackground` now only branches to the custom path when `window.vaultAPI.getBackground` exists; otherwise it falls through to the animated background. Preview boot console is now completely clean.

**Verified:** 52/52 tests green; preview synthetic drops (real `File` objects via `DataTransfer`): window drop + grid drop + dragover all set `defaultPrevented:true`, internal reorder drags unaffected, single-import flag per event; boot console shows zero exceptions (the long-standing RangeError is gone).

**REBUILT (2026-08-24, 94.8 MB):** also closed two user-open `my-vault-portable.exe` instances that were locking the output path (the recurring "file locked" cause). asar (232 entries) contains the updated renderer.

## v2.9.21 — mono side scrollbar black + journal moods become line icons (2026-08-25)

Two polish fixes:

- **Mono scrollbar.** The page's right-edge scrollbar stayed the mauve tint in the mono theme. Cause: `body.theme-mono ::-webkit-scrollbar-thumb` used a *descendant* combinator, so it matched scrollbars of elements inside body but not the **document's own scrollbar** (which lives on body, not a child of it). Added the direct `body.theme-mono::-webkit-scrollbar-thumb{background:#000;border-color:#000}` selector (kept the descendant form for inner scroll containers) — the side scrollbar is now **black** in mono while cream keeps its mauve tint. Verified live: computed thumb is `rgb(0,0,0)`.
- **Journal moods: emoji → crisp line icons.** The six mood buttons (🌱🌸☀️🌧️🍂❤️) are now lucide-style inline SVG line icons (sprout / flower / sun / cloud-rain / leaf / heart) matching the app's icon language. Moods are stored as **semantic keys** (`growing / blooming / sunny / rainy / quiet / loving`) instead of emoji; `LEGACY_MOOD` maps the old emoji strings to the same key so pre-existing entries keep their mood. The entry list renders each mood as the same icon (with the key as a tooltip), and picker buttons size/center the SVG.

**Verified:** 52/52 tests green; preview — document scrollbar thumb computes `rgb(0,0,0)` in mono, mood row has 6 buttons each holding one SVG (no emoji text) at ~18px, console clean (only the expected browser `vaultAPI`-missing warning).

**REBUILT (2026-08-25, 94.8 MB).**

## v2.9.22 — mono scrollbar fix (root/HTML) + font picker in theme settings (2026-08-26)

Two theme-settings changes:

- **Mono side scrollbar truly black.** The v2.9.21 fix styled `body.theme-mono` and its descendants, but Chromium can attach the viewport scrollbar to `<html>` rather than `<body>`, so the right edge could still show the mauve tint. `applyTheme()` now mirrors the `theme-mono` class onto `document.documentElement`, and CSS adds `html.theme-mono::-webkit-scrollbar*` rules (6px, black thumb, 1px gutter) covering the root scrollbar directly.
- **Font picker (Settings → font).** A new setting under the theme card lets you override the whole-app typeface — `theme default / cormorant / dm serif / jetbrains / gc beluga` — using only the fonts already bundled offline (no downloads). Choice persists in localStorage (`pcvault.font`) and applies live via `applyFont(font)`, which toggles a `font-<choice>` class on `<body>`; CSS drives each with `!important` on `body[X], body[X] *` so the picker wins over every per-element font declaration from either theme.

**Verified:** 52/52 tests green; live preview M-bM-^@M-^T with `theme-mono` mirrored on `<html>`, the viewport scrollbar thumb computes `rgb(0,0,0)` at 6px (was mauve pink at 10px); applying `font-cormorant` gives `"Cormorant Garamond", serif` and `font-jetbrains` gives `"JetBrains Mono", monospace`; console clean (only the expected browser `vaultAPI`-missing warning).

**REBUILT (2026-08-26, 94.8 MB).**

## Known limits / next
- **No notes** — photos only in v1 (the record schema + crypto already support notes; the phone's `vaultAddNote` is trivially portable).
- **No HEIC** — Chromium can't decode it; those files are skipped with a toast. Convert HEIC → JPEG first.
- **Import guard (SEC-006):** files over ~2 GB are skipped with a toast (`N skipped — over 2 GB (too big to encrypt safely)`) — importing buffers the whole file in memory, and a multi-GB file could spike RAM hard enough to crash the app mid-batch and lose the rest of the import.
- Re-encode is lossy JPEG (q0.92) — the EXIF strip has a small quality cost.
- Whole file is rewritten on each change (fine for personal scale).
- Next candidates: notes, Windows Hello unlock, NSIS installer, drag-drop polish, "move vault file" (relocate without losing history), a `--verify` CLI for the file. (App icon already shipped in v1.3.2.)
