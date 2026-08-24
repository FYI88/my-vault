# My Vault — offline encrypted photo vault for PC

> **SAVE POINT — built 2026-08-18.** A working portable EXE exists: `pcvault/dist/my-vault-portable.exe` (90 MB, unsigned — SmartScreen will warn, "more info → run anyway"). Run from source with `npm start`; test with `npm test`.
>
> **REBUILT 2026-08-19.** `node_modules` + `dist` were dropped when the project was re-imported. Restored with a portable Node 22.23.2 (win-x64) in `../.tools/node-v22.23.2-win-x64` (this machine has no system Node), `npm ci` (284 pkgs, 0 vulns), all tests green, EXE rebuilt to **86 MB**. SEC-007/008/009/010 are now resolved in source (see Audit).
>
> **v1.4–v1.8 (2026-08-19):** keepsake voice pass, masonry grid with filenames, in-app doc viewer, an offline **pdf.js 6.2.108** canvas PDF viewer (clean toolbar, zero CSP violations), and an interactive particle background on the auth screens. EXE now **91 MB**.
>
> **SYNCED FROM GITHUB 2026-08-21.** Repo `github.com/FYI88/my-vault` (private, `master`) cloned to `C:\Users\azureuser\my-vault` and merged into this workspace — brings the **daily journal + living-garden view** (`src/journal.mjs`, `src/garden.mjs`, `test/journal.test.mjs` 14/14), the **phantom gallery** (`src/phantom-gallery.mjs`), the **Tauri v2 port** (`src-tauri/`, 16× smaller EXE — needs Rust, not built here), and `src/tauri-bridge.js`. `npm ci` with the updated lockfile (adds `@tauri-apps/cli`), **41/41 tests green** (18 crypto + 9 container + 14 journal), EXE rebuilt to **91 MB**, asar verified to contain the four new modules. See v1.9 below.
>
> **v2.0 — WORMHOLE BACKGROUND (2026-08-21).** The auth-screen background is now a **wormhole vortex** (ported from wodniack's CodePen `XJbYWXx`): 150 perspective rings + up to 9k dots swirling into a tunnel, recolored to the vault palette (rose/mauve/gold/sage on cream). Easing functions inlined (no CDN), dot count scaled by area (smooth at 60fps), strict-CSP-safe. **v2.0.1: the background is now user-selectable in Settings** — a "background" card with wormhole/particles pills, persisted in localStorage (`pcvault.bg`), switching live with a toast. `particles.mjs` gained a proper `destroy()` so the swap is clean. See v2.0 / v2.0.1 below.
>
> **v2.1 — ONE YEAR JOURNAL (2026-08-21).** The journal is reworked from the weekly soil-plot garden to the **One Year concept** (from the mockup the user supplied): the year is a **dot-matrix canvas** (every calendar day a dot, 7 per row), entries grow **hand-drawn line-art doodles** picked deterministically by day + mood, the year is a solid **mauve pill badge**, and a **two-mode dock** (year / day) zooms a single day's doodle. Layout math extracted into pure `yearGrid()` (Node-tested). See v2.1 below.

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

## v2.1 — One Year journal (2026-08-21)
Built from the ticket breakdown (user: "tickets for u now build", driven by a One Year concept mockup). The journal went from a weekly soil-plot garden to the **One Year** dot-matrix:

- **T0 — pure layout (`journal.mjs`).** Added `yearGrid(year, cols)` — every calendar day as a grid cell `{ key, col, row, dayOfYear, monthStart }` — plus `isLeapYear`, `pickDoodle(stage, mood, seed)` and `DOODLE_VARIANTS` (3/4/5/6 per stage). All pure, DOM-free, Node-tested. The canvas no longer owns layout math; it maps grid cells to pixels.
- **T1 — year pill + dotted canvas (`index.html` / `styles.css` / `garden.mjs`).** The journal year is now a solid **mauve-dark pill badge** (was a plain serif heading). The garden renders the year as a **dot matrix**: one dot per day (month starts slightly larger/darker), 7 per row, today ring + search glow kept.
- **T2 — line-art doodles (`garden.mjs`).** Entries grow hand-drawn stroked doodles instead of filled plants — stage 1: sprout/grass/leaf; stage 2: daisy/tulip/cactus/bamboo; stage 3: bush/tree/berries/mushrooms; stage 4: hedgehog/house/sunflower/signpost — each picked deterministically by day key + mood (`pickDoodle`), so the same day always grows the same plant. 17 doodle functions, all strict-CSP-safe (pure canvas paths).
- **T3 — two-mode dock (`index.html` / `styles.css` / `renderer.js`).** A floating **year / day** dock under the canvas toggles the garden: `setMode('year')` shows the full dot-matrix; `setMode('day', key)` zooms one day's doodle large on a shorter canvas (height scales to the mode). `openJournalDay()` keeps day mode in sync with the day being edited; dock pills are aria-correct tabs.
- **T4 — editor polish (`styles.css`).** Streak line centered; the day label gets a small rose dot marker, matching the dotted aesthetic.

Verified: **48/48 tests green** (18 crypto + 9 container + **21 journal** — 7 new: yearGrid common/leap/custom-cols, month starts, isLeapYear century rule, pickDoodle determinism + variation). Drove the real canvas in the preview: dot-matrix year renders with doodles at planted days (stage-4 days visibly denser than stage-1), day mode zooms a single doodle on a 274×170 canvas, zero CSP violations. EXE rebuilt.

**Real EXE smoke-test (2026-08-21):** launched `dist/my-vault-portable.exe` (Electron 43) with `--remote-debugging-port`, drove the packaged UI over CDP. Note for future smoke tests: the app's `window.vaultAPI` is frozen by contextBridge, so you **cannot stub `pickFolder`** to dodge the native create dialog — instead build a vault file in Node (`createVault` + `serializeVault`, exactly like the test suite) and point `%APPDATA%/My Vault/settings.json` at it before launch; `vaultPath` in settings is accepted by the trusted-path model. Flow verified: boot → locked screen (no tamper warning) → unlock with the known passphrase through the real form → journal tab opens on a **fresh empty 2026 dot-matrix** (343×2643 canvas, year pill, streak "plant your first entry today") → typed a real 60+ word entry + ❤️ mood through the real editor → save → canvas ink grew (5991→6114 px, the doodle appeared at today's dot), streak flipped to **"1 day in a row"** → day-mode dock zooms the doodle on a **274×170 canvas** (2566 ink px) → full renderer reload re-decrypted the vault from disk and the entry text, mood and streak **persisted**. No CSP errors. The smoke-test vault (temp dir), driver scripts, and the settings.json pointer were all removed afterwards; the user's real `Downloads/myvault.cvault` was never touched (its remembered path was cleared before testing and restored to `null` after).

## v2.2 — immersive media viewer + phantom gallery polish (merged from GitHub 2026-08-21)

**Pulled from `github.com/FYI88/my-vault` (friend's commits `f80f38f` + merge `dd96bdc`)** and merged into this workspace alongside the local One Year journal rework. The friend's pushed merge had **unresolved conflict markers in two files** (`renderer.js` gallery options, `styles.css` viewer block) — both resolved to the friend's intent and verified. They also left a stale duplicate `pcvault/phantom-gallery.mjs` at the repo root (older copy — not shipped, `src/` is the live one) and `pcvault/HANDOFFV1.md` (their handoff backup); both kept as-is in the repo, harmless.

- **Immersive item viewer (`index.html` / `styles.css` / `renderer.js`).** The item overlay is now a full-bleed dark stage (`#171014`) with floating HUD chrome: top bar (back, serif title + mono date, fullscreen / export / delete), bottom bar (prev / "N of M" count / next). Chrome auto-fades after 2.5 s of stillness (`CHROME_IDLE_MS`), returns on pointer-move, and a stage click toggles it. Photos: wheel-zoom to 5× (cursor-anchored), pointer-drag pan when zoomed, dblclick to toggle 2×, `cursor:zoom-in`. Videos keep native controls plus a big center play button (`viewerPlay`) shown only while paused. Keyboard: `Esc` closes (unless fullscreen), `←`/`→` navigate, `F` fullscreen. Backdrop-click-to-close was removed (stage click now toggles chrome).
- **Gallery fixes (`renderer.js` + `phantom-gallery.mjs`).** `populatePhantomGallery` now hydrates any thumbnails the grid's IntersectionObserver hasn't reached yet (so toggling straight into gallery never shows dark tiles) and passes a `meta` line (photo year / doc size). Gallery config switched to the vault cream (`#fbf6f3`, cellSize 240, gap 20) and `body.gallery-mode` makes it full-bleed. The gallery engine was reworked by the friend: frameless floating tiles (rounded, soft shadow, ghost-image blur until hover), whole-grid tilt physics replacing per-cell arc, adaptive vignette (dark edges on dark bg, soft shadow on cream), device-pixel snapping so borders stay crisp at 125%/150% scaling, click-to-open resolved via `elementFromPoint` (pointer-capture-safe), and a proper `destroy()`.
- **Grid restyle (`styles.css`).** Cells now round the `.cell-media` (12px) with a rose ring + lift on hover, doc cells get a mauve tint (`[data-kind="doc"]`), captions lose the border-top, and a `.grid-hover-names` hover-overlay variant was added. Masonry columns, filenames under cells, and drag-to-reorder are untouched.
- **Particles cap (`particles.mjs`).** `hardCap` 170 → 500 (friend's tweak).
- **`.gitignore`.** Added `.preview/` (design screenshot dir).

**Verified:** 48/48 tests green (18 crypto + 9 container + 21 journal — the friend's branch predated the journal, so `journal.mjs` / `garden.mjs` / `test/journal.test.mjs` are untouched by the merge). Preview: viewer DOM present, gallery mounts with the cream config (400 virtualized cells), zero console errors. **Real EXE smoke test** (fresh build + `make-media-vault.mjs` Node-built vault with a real PNG, a minimal one-page PDF, and a text doc; settings.json pointed at it; restored afterwards): locked screen → unlock → 3 grid cells → photo opens in the immersive viewer (title, "1 of 3", blob img) → dblclick zooms to `scale(2)`, wheel to `scale(2.5)`, Esc closes → next → PDF opens in the stage (canvas 765×990, **painted**) → next → text doc renders → next wraps to photo ("1 of 3") → chrome hides after 2.5 s idle and returns on pointer-move. Zero CSP errors. Test vault, driver scripts, and settings pointer all removed; the user's real `Downloads/myvault.cvault` untouched.

**Gotcha for future smoke tests (learned the hard way):** `%APPDATA%/My Vault/settings.json` must be written with **JSON.stringify from Node** — a bash `echo` writes single backslashes (`C:\Users` instead of `C:\\Users`), which is invalid JSON (`\U` is a bad escape), and `loadVaultPath` swallows the error so the app silently boots to the welcome screen. Also: kill the inner **`My Vault`** process (Electron), not just `my-vault-portable` — the launcher name and app name differ, and a surviving `My Vault.exe` keeps serving the CDP port with stale boot state.

## v2.3 — journal rebuilt from zero: writing-first (2026-08-21)

Per user request: "forget the One Year design bullshit, redo it from 0." The canvas dot-matrix journal was **deleted entirely** (`garden.mjs` removed; the journal is now plain DOM). The pure data model (`journal.mjs`) was kept untouched except two additions — the deep module survives, the gimmicky view died.

- **Composer card on top** — the day label, mood row, and a larger textarea (4 rows) sit in a card at the top of the pane, always defaulting to today. Clicking a calendar day or an entry row loads that day into the composer; saving replaces the year record wholesale exactly as before (crypto invariants untouched).
- **Real calendar year view (DOM, no canvas)** — 12 month grids built from a new pure `monthCells(year, m)` (weekday-aligned, Sunday-first, 7 per row, Node-tested). Filled days get a rose dot, today gets a ring, search matches get a gold tint; every day is a clickable button.
- **Entry list** — reverse-chronological rows under the calendar: short date (mono), mood chip, first-line preview (serif, ellipsized), and a mono word count. Click a row to open that day.
- **Search now filters** — the query filters the entry list and highlights matching days on the calendar (fixed a bug where an empty query highlighted *every* entry with the match tint).
- **Export as markdown** — a toolbar download button writes the visible year to a `YYYY.md` via the existing save-dialog path (`saveFileAs` + `writeFile`), formatted by the new pure `exportYearMarkdown(blob, fmtDay)`: `# 2026`, `## Monday, August 21, 2026` headings, `_mood …_` line, entry text. Node-tested, including the empty-year case.
- **Streak + on-this-day kept**; garden/dock canvas styles removed; "plant your first entry today" copy is now "write your first entry today".

Verified: **52/52 tests green** (18 crypto + 9 container + **25 journal** — 4 new: monthCells weekday padding both ends, exportYearMarkdown content/order/empty). Preview: drove the real Journal tab with a cached year blob — 12 months / 365 cells render, entry dots + today ring correct, search filters list + calendar, row and calendar clicks load the composer, zero console errors, garden elements gone. EXE rebuilt.

## v2.4 — no-long-titles display rule (2026-08-21)

The gallery and viewer now show a **short display name** instead of the raw filename — long names (`IMG_20240821_153045.jpg`) were noise under every tile and in the viewer chrome. New `shortName(name)` in `renderer.js`: strips the extension, takes the **first word** (split on spaces/underscores/dashes/dots), caps it at **6 chars + ellipsis**. `IMG_20240821_153045.jpg → IMG`, `birthday party video.mp4 → birthd…`, `paris.jpg → paris`. The full name is untouched metadata — it still drives **search** (`nameCache`), **export** (`handleExport` saves under the real name), and appears on **hover** (`title` attr on grid captions, viewer title, and the doc fallback name). Phantom-gallery floating tiles show no captions, so nothing changed there. Verified: syntax check + 52/52 tests green + preview boots clean, zero console errors.

## v2.5 — thin frameless titlebar: macOS traffic lights + unified header (2026-08-21)

Per user request ("the top bar and the buttons are weird and alone"), the window chrome is now **the app's own**. Electron switched from `titleBarStyle:'hidden'` + native overlay to **`frame:false`** — the page draws a single thin **34px titlebar** in place of the old empty 40px band:

- **macOS-style traffic lights** (red/yellow/green 12px dots, left) with hover glyphs (× / − / +), the green dot swapping to the restore glyph while maximized, and all three desaturating when the window is unfocused (`win:maximized`/`win:focused` events pushed from main; initial state via `win:getState`).
- **The app header lives in the bar** — the unlocked screen's "my vault" wordmark + add-files/gallery/settings/lock buttons and the settings screen's back/title are now heads inside the titlebar, shown per screen (`body.head-unlocked` / `body.head-settings` toggled in `show()`). Auth screens keep just the dots. One strip, no more stacked bands.
- **IPC:** `win:minimize` / `win:toggleMaximize` / `win:close` + `win:getState` in main.js; `vaultAPI.windowControls` in preload.js; renderer wires the dots in `initWindowControls()` (safe no-op in the browser preview), double-click on the bar toggles maximize, and real fullscreen (F in the viewer) hides the bar entirely.
- Viewer top HUD offset to `top:34px` so it clears the bar; body top padding nudged to match. Dots also gray out when the window is minimized (`visibilitychange` — minimized windows don't always fire blur on Windows) and when unfocused.

Smoke-tested end-to-end in the rebuilt EXE via CDP (**26/26 checks**): frameless confirmed (no native titlebar), 34px bar with correct dot colors, maximize via dot flips `win:getState` and shows the restore glyph (found + fixed a real bug here — the dots had no ids so `$('tlMax')` was null and the glyph never swapped), unlock moves the wordmark + all action buttons into the bar, settings shows back + title in the bar, minimize hides the window + grays the dots, close quits the app. Real `Downloads/myvault.cvault` untouched — settings restored, test vault + driver scripts deleted.

Tradeoffs (accepted): no Win11 snap-layout flyout on maximize hover; the Tauri port keeps the same markup via `data-tauri-drag-region` but still draws its native overlay buttons — needs its own WCO pass later. Verified: syntax checks clean, 3 suites / 52 assertions green, preview renders the 34px bar with correct dot colors + head toggling, EXE rebuilt.

## v2.5.1 — window-chrome picker in Settings (2026-08-21)

Per user request, the titlebar chrome is now user-selectable. New Settings card **window chrome** with two pills: **mac dots** (default — the traffic lights) and **windows** (compact monochrome − / ☐ / × controls on the right of the bar, close turning rose on hover). Choice persists in localStorage (`pcvault.chrome`, same pattern as `pcvault.bg`), applies live with a toast, and both layouts share the same `data-win` IPC handlers, restore glyph swap (`[data-win="maximize"] .is-restore`), and inactive fade. Smoke-tested in the rebuilt EXE (**15/15**): mac default → picker flips to win controls → win maximize/unmaximize + restore glyph → choice survives a full reload → win minimize hides → win close quits. Real vault untouched.

Gotcha recorded: a lingering `my-vault-portable.exe` launcher process (left behind when the inner app exits) holds an exclusive handle on `dist/my-vault-portable.exe` and stalls the next build on "output file is locked" — kill it (or find it via the Restart Manager) before rebuilding.

## v2.6 — gallery replaced with the real Framer PhantomInfiniteGallery (2026-08-22)

The phantom gallery was a loose adaptation (frameless floating tiles, whole-grid tilt, cream, no captions). Replaced with a faithful **vanilla port of the actual Framer component** (`https://framer.com/m/PhantomInfiniteGallery-KBne.js@99C8ioUWN1y8Bj2XYLwl`): per-cell 3D arc (`calcArcTransform` — cells curve away toward the edges), thin bordered cells (top border hidden; left/right/bottom shown), cell padding, a mono caption row (bold uppercase short title left + year/size right), pink hover fill, and parallax — the whole-grid tilt is gone. Options mirror Framer's property controls 1:1 (`border {width,style,color,showTop/Bottom/Left/Right}`, `cellPadding`, `hoverColor`, `arcAmount/arcMaxAngleDeg/arcAxis`, `edgeFade`, `parallax*`, `inertia/throw*`, `zoomValue`). **Nothing installed** — the app is vanilla JS under a strict CSP (`script-src 'self'`, no Framer runtime/CDN), so the React component is ported, not bundled. The gallery is now dark (`#171014` ground, cream-white borders, warm gray text — matches the item viewer stage), and `populatePhantomGallery` passes `title: shortName(name)` (the v2.4 rule) + `meta` (year for photos, size for docs) into the caption. 52/52 tests green; verified live in the preview webview (400-cell grid, per-cell `rotateY` arc transforms, borders + captions rendering).

**REBUILT + SMOKE-TESTED 2026-08-22 (7/7 in the packaged EXE, 91 MB):** unlocked a real throwaway vault then toggled the gallery — dark `#171014` ground, 400 cells, real decrypted captions (`desert | forest | beach`), per-cell `rotateY` arc transforms, gallery-mode body switch. No CSP errors. Real vault + settings untouched (restored after).

Smoke-test gotchas recorded:
- Hand-built test-vault records: `photoLen` must be the **ciphertext** length — AES-GCM adds a 16-byte tag, so `photoLen = photoEnc.data.length` (NOT the plaintext length). Using the plaintext length desyncs the length-prefixed record stream and `parseVault` returns `null` (whole file silently rejected → app falls to welcome).
- A corrupt/absent vault boot shows the welcome screen, but `#unlockPass`/`#screen-*` still exist hidden in the DOM — a driver that waits on element *existence* (not visibility) reads a welcome screen as a locked one and produces garbage state. Wait on the `.hidden` class.
- `getComputedStyle().backgroundColor` `rgb(23, 16, 20)` equals `#171014`; compare against the rgb string, not the hex.

## v2.7 — centered titlebar + action row under the bar + keybinds (2026-08-22)

The four vault actions (`+ add files`, gallery, settings, lock) were removed from the titlebar (v2.6.1) to keep the thin bar clean. Now they live in a dedicated **action row** — a 36px strip fixed right under the 34px titlebar (`body.head-unlocked .action-bar`), centered, shown only while unlocked. The centered `my vault` title (which lost its buttons) got a **long-press affordance**: hold ~700ms to reveal the vault file in the OS folder (title dims while held via `#vaultTitle.pressing`).

**Architecture — one action seam:** all three trigger types cross a single dispatcher `runAction(name)` (the deep module). `ACTIONS = { add-files, gallery, settings, lock, reveal }` holds each action's behavior once; the adapters at the seam are the action-row buttons (`data-action` + one delegated click listener on `#actionBar`), the keyboard shortcuts, and the title long-press. Deletion test: removing the dispatcher would scatter the behavior back across three call sites.

**Keyboard shortcuts (Ctrl works even while typing in a search box):**
- `Ctrl+I` — add files
- `Ctrl+G` — toggle gallery view (plain `G` still works too)
- `Ctrl+,` — settings
- `Ctrl+L` — lock

**Layout notes:** `body.head-unlocked` gets `padding-top:5rem` so content clears the 70px of fixed chrome; the phantom gallery height in gallery mode went from `calc(100vh - 138px)` to `- 176px`. The journal tab still hides add-files/gallery (vault-only), leaving settings/lock in the row.

Verified: syntax clean, 52/52 tests green, and live in the preview — delegated clicks open settings + toggle gallery, Ctrl+G/,/L dispatch correctly when unlocked, journal tab hides the vault-only buttons, long-press shows the pressing feedback.

Gotcha: the renderer file is **CRLF** — multi-line `String.replace` templates with LF-only newlines silently don't match. Normalize to LF, replace, then restore CRLF (or use single-line anchors).


**REBUILT + SMOKE-TESTED 2026-08-22 (8/8 in the packaged EXE, 91 MB):** action row present with all four actions (`add-files,gallery,settings,lock`), hidden while locked and `flex` when unlocked, long-press feedback class toggles on pointerdown/up, gallery button toggles the view, and — with real module state unlocked — `Ctrl+G` toggles the gallery, `Ctrl+,` opens settings, `Ctrl+L` locks, `Ctrl+I` dispatches add-files. All through the same `runAction` seam. Real vault + settings untouched; test artifacts deleted.

Smoke-test gotcha added to the pile: the keybinds are gated behind `state.unlocked`, so a CDP driver that only fakes `body.head-unlocked` (the CSS class) gets false FAILs on the shortcuts. Set the module state for real via `const mod = await import('./renderer.js'); mod.state.unlocked = true;` — the renderer exports `state` exactly for that.

## v2.8 — actions moved into the titlebar's right corner (2026-08-22)

Per the user's reference screenshot, the action row **under** the bar is gone. The four actions now live **in** the 34px titlebar, clustered in its right corner left of the window controls: `[+ add files][gallery][settings][lock] | [min][max][close]` (vault-head-gap cluster inside a new absolute `.title-right` wrapper that also holds `#winControls`; the cluster is `#headUnlocked`, so it still shows only while unlocked). The centered `my vault` wordmark and its long-press-to-reveal were removed to match the clean bar — reveal still exists via Settings → show in folder + the clickable vault path line. `body.head-unlocked` padding reverts to the base 2.4rem (no more 36px strip to clear).

Same `runAction` seam, one fewer adapter: the delegated click listener moved from `#actionBar` to `#headUnlocked` (the `data-action` buttons + keybinds remain). `initTitlePress()` deleted. Verified: syntax clean, all suites green, and live in the preview — geometry check shows the actions cluster hugging the right corner (`right:0.8rem`), win controls at the very edge, bar still 34px and light cream.

## v2.9 — DriftWall as a second gallery style (2026-08-22)

React Bits' **DriftWall** integrated as a selectable gallery style, keeping every vault promise (offline-only, strict CSP, zero runtime deps):

- **`src/drift-wall.mjs` (new)** — a vanilla JS port (the app is vanilla under `script-src 'self'`, so the React component is ported, not bundled — same approach as `phantom-gallery.mjs`). API mirrors `phantom-gallery.mjs`: `createDriftWall(host, opts)` → `{ destroy, setItems, setContainerHeight }`. Drifting 3D columns that speed up/slow down per column and tilt toward the pointer, with hover lift + de-tint, edge/depth dissolve (CSS mask), and `prefers-reduced-motion` support (drift + parallax + hover motion disabled). Tiles are focusable `button`s that report through `onItemClick(id)` — **no `href`/new-window**. Images are the caller's own `blob:` thumbnails (never remote); default `overlayColor` set to the vault's warm `#171014` (not React Bits' `#060010`). All styling via `el.style` + the bundled stylesheet → zero CSP violations.
- **Settings → gallery style** (`index.html`): a card with **phantom** (default) / **drift** pills, following the background-picker pattern exactly; choice persists in localStorage (`pcvault.galleryStyle`) and renders on boot (`renderGalleryPills()`).
- **Renderer (`renderer.js`)** — gallery plumbing made style-agnostic, one path for both styles: `buildGalleryItems()` (decrypt names + short titles once, pull thumbnails from the cache) → `populateGallery()` (hands the array to whichever controller is active, hydrates any thumbnails the grid hasn't reached). `toggleGallery()` + the pill handler create the controller for the chosen style via `ensureGalleryController()`/`makeGalleryController()` (rebuilds when switching while open). `lock()` cleans up via `destroyGallery()`.
- **`styles.css`** — `.drift-wall*` rules (plane/col/track/tile/inner/img/overlay + reduced-motion transition kill).

Verified: syntax clean, **52/52 tests green**, and live in the preview — drift wall mounts 34 tiles across 5 columns from `blob:`/data thumbnails, the plane applies its rotateX/Y/Z tilt, click reports the item id, switching phantom↔drift while the gallery is open rebuilds to the other style, and no CSP errors (a `data:` URL is correctly blocked by `img-src 'self' blob:` — the real gallery uses `blob:` URLs which load fine).

## v2.9.1 — gallery style travels with the vault file (2026-08-22)

The `gallery style` choice now lives **inside the vault file** (`manifest.prefs.galleryStyle`), not just per-machine localStorage — open the same `.cvault` on another PC and your chosen style comes back with it.

- `manifest` gains a `prefs` object (`createVault` defaults to `{ galleryStyle: 'phantom' }`). `prefs` rides in the header JSON beside `vaultId`/`tamperIdx` — all of which are non-secret UI/meta values; the wrapped keys carry the confidentiality, so a UI preference has zero security impact. `changePass` / `rotateSeed` keep it (they only touch `wrap`/`seedWrap`).
- **`renderer.js`** — `galleryStyleChoice()` reads from `state.manifest.prefs` first, falling back to the old `LS_GALLERY` localStorage key only before a vault is loaded. `enterWithDek()` (unlock via pass/seed) calls `adoptGalleryStyleIntoFile()` on first unlock: if the manifest has no valid style yet, it folds in the legacy localStorage pick (default `phantom`) and persists once, so old vaults migrate the stored choice into the file going forward. The Settings pill handler now writes `state.manifest.prefs.galleryStyle` and `saveVault()`s it — the .cvault is rewritten with the preference, exactly like a reorder or journal save.
- **Tests** — crypto: `createVault` manifest asserts `prefs.galleryStyle === 'phantom'`. Container: the round-trip manifest now carries `prefs: { galleryStyle: 'drift' }` with an explicit assertion it survives serialize→parse (and the existing deepEqual still holds). **52/52 green**, syntax clean.

## v2.9.2 — drift gallery columns adapt to window width (2026-08-22)

The drift gallery no longer uses a fixed 5 columns. `createDriftWall` now computes the column count from the **container width** and reflows live as the window resizes:

- **`drift-wall.mjs`** — new `columnsForWidth(width)`: `floor((width / PLANE_SCALE) / unit)` where `PLANE_SCALE = 1.18` (the 3D plane is scaled up as it recedes in perspective, so it covers ~width/1.18) and `unit = tileWidth + gap`. Clamped by new `columnsMin` (2) / `columnsMax` (12) options so a thin window never collapses to a 1-col wall and a huge monitor never spawns dozens of DOM-heavy columns. `containerWidth` is tracked alongside height; a `ResizeObserver` fires a shared `rebuildForLayout()` on any width/height change (re-derives columns, colMeta, copies, offsets, velocities in one place — `setItems` and the new public `setContainerWidth()` reuse it too).
- **`renderer.js`** — drift config swaps the removed `columns: 5` for `columnsMin: 2` (module owns the count now).

Verified: syntax clean, **52/52 tests green**, and live in the preview — columns follow width 2→3→5→6→8 across 600→2400px on both the ResizeObserver path (window resize) and `setContainerWidth`, and shrink back down on narrow. (Test gotcha: the module sets `width:100%` on its host exactly like the phantom gallery, so a synthetic fixed-width host is overridden — drive reflow through the real pane or `setContainerWidth` instead of a hand-sized div.)

## v2.9.3 — REBUILT + SMOKE-TESTED: DriftWall gallery in the packaged EXE (2026-08-22)

`dist/my-vault-portable.exe` rebuilt (91 MB) with the drift gallery + the two supporting changes (in-vault gallery style + width-adaptive columns) and smoke-tested **12/12 in the real packaged app** via CDP. Opened a throwaway 6-photo vault whose manifest had `prefs.galleryStyle = 'drift'`:

1. boots to locked screen (test vault path shown)
2. unlocks with the passphrase
3. gallery toggle → **drift** wall (not phantom) mounts, **3 adaptive columns** at that window size, 24 tiles
4. tiles carry the 3D plane tilt (`rotateX(16deg) rotateY(-14deg) … translateZ(-120px)`)
5. **24/24 drift tiles render real `blob:` thumbnails** (
`loaded:24`)
6. clicking a tile opens the item viewer with the `<img>` visible
7. Settings shows the gallery-style pills with **drift active from the vault file**
8. switching to phantom while the gallery is open rebuilds to phantom
9. choice **persisted into the vault manifest** (`manifest.prefs.galleryStyle = 'phantom'`)

**Two real bugs the smoke test caught (both fixed + re-built + re-passed):**

- **`openSettings()` didn't call `renderGalleryPills()`.** The gallery-style pills only got their `on` state at boot and on click, so opening Settings before touching a pill showed stale pills — and since the style now lives in the vault file, the active pill wouldn't reflect the file until an unrelated click. Fixed: `openSettings()` now re-renders idle/background/chrome/**gallery** pills on every open. (The blind spot existed because the background/chrome pills are localStorage-backed and never diverge from boot; the in-vault gallery style *can*.)
- **Drift tiles stayed dark when thumbnails hydrated late.** The phantom gallery re-reads each item's `thumbUrl` every animation frame, so an in-place mutation shows immediately. The drift wall bakes `img.src` at tile-build time, so photos that decrypted *after* the tiles were built (the grid hydrates lazily) never appeared until a rebuild. Fixed in `populateGallery()`: after hydrating, rebuild the gallery once **only when the active style is drift** (`state.galleryKind === 'drift'`); phantom is skipped so rebuilding doesn't reset the user's scroll/zoom.

Gotchas for future packaged smoke tests: a CDP driver's thumbnail assertions must **poll until the async hydration lands** (the raft of `await thumbUrl(rec)` runs after the tiles mount); and raw Node's global `WebSocket` works for CDP (no `ws` dep needed) but you must wire `ws.onmessage` to resolve `send()` — forgetting it hangs every eval. The packaged asar was verified to contain `drift-wall.mjs`, `columnsForWidth`, and both renderer fixes. Real vault (Downloads/myvault.cvault, 18 records) confirmed intact + untouched; settings restored to it; all test vaults/driver scripts/logs deleted.

## v2.9.4 — titlebar cleanup: actions in page, padding fixed, drift rendering fix (2026-08-22)

Four issues fixed in one pass after the user's screenshot review:

- **Padding fix** — `body padding` was `2.4rem 1.25rem 3rem` which didn't account for the fixed 34px titlebar. Now `body { padding: 0 1.25rem 3rem }` and `.wrap { padding-top: calc(34px + 1.1rem) }` — the content clears the titlebar exactly.
- **Action icons moved into the page** — the four action buttons (+add files, gallery, settings, lock) no longer crowd the titlebar's right corner. They live in a `.page-actions` row at the top-right of the unlocked screen, positioned with `position:absolute; top:0.55rem; right:0`. The titlebar now shows only the centered `my vault` wordmark and the window controls. The click delegation switched from `#headUnlocked` (which no longer exists) to `#pageActions`.
- **Drift gallery rendering fix** — the root cause was `createDriftWall` hardcoding `height:100%` via `container.style.cssText`, which overrode the CSS `calc(100vh - 120px)` from `.phantom-gallery`. Since the drift wall's parent (`#vaultPane`) has no explicit height, `height:100%` collapsed the container to zero. Fixed in `drift-wall.mjs`: `container.style.cssText` replaced with individual `style.setProperty` calls for only `position`, `overflow`, `perspective`, and `perspectiveOrigin` — height/width are left to the CSS classes. The `.drift-wall` CSS class also had its redundant `width:100%; height:100%` removed (it was clobbering `.phantom-gallery`'s `calc()` height through the cascade).
- **Window-chrome picker confirmed** — the Settings screen already renders the `chromePills` (mac dots / windows) — `openSettings()` calls `renderChromePills()`. Verified both pills visible in the DOM.

**Verified:** syntax clean, **52/52 tests green**, live in preview — drift wall mounts correct height (525.6px = calc(100vh - 120px)), plane tilt applies, columns adapt to width (2 cols at 397px), perspective 1200px, and edge-fade mask renders.

## v2.9.5 — transparent titlebar on auth screens + scroll-hide action bar (2026-08-22)

- **Transparent titlebar on welcome/locked screens** — `body.auth-screen .titlebar` gets `background:transparent` + `border-bottom-color:transparent` with a smooth 0.35s transition. `show()` toggles the `auth-screen` body class based on the `AUTH_SCREENS` set. The traffic-light dots get `filter:drop-shadow(0 1px 2px rgba(0,0,0,0.25))` so they stay visible against the vortex. When the user unlocks, the `auth-screen` class is removed and the bar fades back to cream.

- **Scroll auto-hide action bar** — `.page-actions` is now `position:sticky; top:34px` (pinned below the titlebar). A scroll listener tracks direction: scrolling down >8px hides the bar (translateY + opacity transition), scrolling up reveals it. At the very top of the page the bar has no shadow; once scrolled it gets a subtle `box-shadow` hairline. Navigating away from the unlocked screen resets the hide state.

## v2.9.6 — REBUILT: scroll-hide + transparent titlebar + drift fixes in EXE (2026-08-22)

Rebuilt `dist/my-vault-portable.exe` (91 MB) at 18:59 with all recent fixes baked in. Packaged asar verified:
- **8** scroll-tracking references in `renderer.js` (`scroll-direction`, `_lastScrollY`, `_SCROLL_THRESH`)
- **`position:sticky`** and **`.page-actions.hide`** in `styles.css`
- **`src/drift-wall.mjs`** present with the `style.cssText` fix

No smoke-test this round — the build artifacts confirm the source changes are in the EXE.

## v2.9.7 — action sidebar + titlebar conflict fix + add-files in tabs row (2026-08-23)

Three layout changes:

- **Titlebar conflict fixed** — when the Settings screen is active, "my vault" in the titlebar center overlapped "vault settings" in the header slot. Fixed with `body.head-settings .title-center { display: none }` so only one header shows at a time.

- **"+ add files" moved into the tabs row** — the button now lives in `.vault-tabs` inline with the vault/journal selector, separated by `flex:1` gap. Same visual level as the navigation, not a separate bar floating below.

- **Action bar replaced with togglable sidebar** — the sticky `.page-actions` bar (with scroll-hide) is replaced by a fixed vertical `.action-sidebar` on the right edge. A three-dot `sidebar-toggle` opens/closes a `.sidebar-tray` containing gallery, settings, and lock. The tray fades in/out with `opacity` + `translateX` transition. Sidebar only appears on the unlocked screen (`show()` toggles `.hidden` on `#actionSidebar`). The scroll-hide listener removed from renderer.js.

**Verified:** syntax clean, **52/52 tests green**, live in preview — title-center hidden on body.head-settings, sidebar toggle opens/closes tray, add-files button rendered inside `.vault-tabs`.

## v2.9.8 — mono theme (abstract minimalist: black ink on white) added alongside cream (2026-08-23)

Second theme, added without touching the default — **light, not dark**: mostly white (~80%) with black and every shade of grey as accents, straight off the black-on-white fragmented wordmark + monochrome poster references. The cream palette is the default adapter behind the `:root` variables; `body.theme-mono` is a second adapter that swaps every variable for a monochrome scale (`--bg:#fafafa`, `--card:#ffffff`, `--text:#161616`, `--rose-dark:#111111`, `--mauve-dark:#2b2b2b`, etc.).

- **Settings → theme** — new pill row (`#themePills`): cream / mono, persisted in `localStorage` (`pcvault.theme`) like the background + chrome pickers. `themeChoice()` / `applyTheme()` / `renderThemePills()` follow the exact bg/chrome pattern; boot + `openSettings()` render the pills.
- **Everything monochrome** — the hardcoded warm rgba()s that can't use variables get `body.theme-mono` overrides: titlebar goes white, traffic lights are `grayscale(1) brightness(0.72)` (grey dots), hover tints become black-alpha, the item viewer stage and drift-wall tiles stay near-black (photos pop on it), PDF scroll areas go light grey, and the living auth background (`#authBg`) gets `grayscale(1) invert(1)` so the colorful vortex renders as **black ink strokes on the white page** — the same abstract-chaos feel as the references, inverted to match the light base.
- The cream theme is byte-for-byte untouched; switching back restores it exactly (verified in preview).

## v2.9.9 — mono wordmark + overlapping-circle mark (2026-08-23)

The light mono theme now carries the supplied visual identity references without changing the cream theme:

- **Fragmented VAULT wordmark** — `src/vault-wordmark.png` is the supplied `VAULT.png` stored in the offline bundle. It is shown as a tight crop on the three semantic `my vault` brand labels only (welcome, locked/create and the titlebar). The DOM text remains present for accessibility; `your recovery words` keeps normal typography.
- **Geometric mark** — `src/vault-mark.svg` is an original, transparent SVG inspired by the second reference: a thin outlined circle crossing a solid black circle. Mono shows it above the main brand wordmark and beside the titlebar wordmark. The favicon now points to this local SVG.
- **Build source updated** — `build/icon.svg` uses the same outlined-left/solid-right mark on a white square for the Windows app icon pipeline.
- **Temporary reference cleanup** — the copied icon-inspiration file was removed from `src/`; no inspiration images are shipped in the vault bundle.

**Verified:** 3 test files pass, preview shows the complete fragmented wordmark + one mark on the light mono welcome screen, and the cream theme selectors remain unchanged. The cached `build/icon.ico` was not regenerated because neither checkout has a usable Electron binary (`npx electron scripts/make-icon.js` stops at the missing optional Electron binding); regenerate it with the existing `scripts/make-icon.js` once Electron is restored, then rebuild the portable EXE.

## v2.9.10 - portable EXE rebuilt with mono branding (2026-08-23)

Rebuilt the current Electron source into `dist/my-vault-portable.exe` with `npm run dist` after the mono wordmark and geometric mark changes.

- **Artifact:** `dist/my-vault-portable.exe`, 94,918,460 bytes, built 2026-08-23 07:55.
- **Packaged contents verified:** the extracted `resources/app.asar` contains `src/vault-mark.svg`, `src/vault-wordmark.png`, the current `src/index.html`, `src/styles.css`, `src/renderer.js`, and the current gallery modules.
- **Tests:** 18 crypto, 9 container and 25 journal checks pass: 52 total.
- **Real EXE smoke test:** the portable launcher extracted the runtime, started the inner `My Vault.exe`, created a responsive window titled `my vault`, and answered on the Electron CDP endpoint. The test processes were closed afterward.
- **Icon note:** the build uses the existing cached `build/icon.ico`. The new `build/icon.svg` source is present, but regenerating the ICO still requires restoring the missing Electron runtime binding for `scripts/make-icon.js`.

## v2.9.11 - new white-background app icon (2026-08-23)

Replaced the previous cached app icon with a refined monochrome mark based on the supplied overlapping-circle reference.

- **Icon design:** a crisp outlined circle crossing a solid near-black circle, centered on a clean white rounded square. The proportions were tightened for recognition at Windows shell sizes, with a consistent 10px outline and generous optical margins.
- **Offline assets:** updated `build/icon.svg` for the Windows source and `src/vault-mark.svg` for the in-app mark. The supplied inspiration image was used only as a reference and is not shipped.
- **Generated icon:** regenerated `build/icon.ico` through the local Electron capture pipeline with six PNG-backed sizes: 16, 32, 48, 64, 128 and 256px. `src/favicon.png` is now the matching 32px raster and `src/index.html` points to it.
- **Pipeline hardening:** `scripts/make-icon.js` now paints the SVG in a regular Chromium window before capture. This avoids the `UnknownVizError` encountered by the old hidden/offscreen capture path on this machine while remaining fully offline.
- **Build:** rebuilt `dist/my-vault-portable.exe` with `npm run dist`; artifact size is 94,920,645 bytes, built 2026-08-23 08:29.
- **Verification:** ICO header has six PNG entries, the EXE's associated icon extracts as a 32x32 white-backed raster, all 52 tests pass, and the unpacked packaged `My Vault.exe` launched with a responsive `my vault` window and CDP HTTP 200. Test processes were closed afterward.

## v2.9.12 — GC Beluga Mono typography for the mono theme (2026-08-23)

The mono theme now uses **GC Beluga Mono**, a geometric monospace from Glyphonic Studio (demo, personal use). Its clean angular letterforms pair with the stencil VAULT wordmark better than any sans-serif did.

- **Offline fonts** — three TTF files bundled in `src/fonts/`: Regular (400), Medium (500), SemiBold (600), sourced from the user's `Documents/mono.zip`. `fonts.css` has the `@font-face` declarations.
- **Mono font overrides** — `body.theme-mono` swaps the default `Cormorant Garamond` body font to `GC Beluga Mono, monospace`. The headings, buttons, inputs, tabs, labels, journal rows, and settings cards all use GC Beluga Mono with `font-style: normal`. The branded wordmarks already use the PNG image via `font-size:0`, so they are unaffected.
- **JetBrains Mono also stays** — seed input, file metadata lines, hints and all code-level text keep JetBrains Mono.
- **Font sizing** — body drops to `14px` (from the root 17px), headings to 0.82–1.3rem, buttons/inputs to 0.78–0.88rem, body text to 0.68–0.75rem. Monospace glyphs are wider than proportional serifs, so this keeps the text compact and readable instead of blowing up the layout.
- **Cream theme untouched** — switching back restores Cormorant Garamond / DM Serif Display at the original 17px root exactly (verified in preview).
- **Inter + DM Sans kept in the bundle** — both prior font experiments remain in `src/fonts/` but are unused by any active theme; they can be cleaned up in a future pass.

**Verified:** 52/52 tests green, preview shows GC Beluga Mono on all non-code text elements in mono, font-family restores cleanly to Cormorant Garamond in cream.

## v2.9.13 — transparent → frosted glass titlebar on unlocked vault (2026-08-23)

The unlocked vault titlebar now mirrors the auth screens: transparent at rest, frosted glass when scrolling.

- **body.unlocked** — the `show()` function in `renderer.js` now toggles `body.unlocked` alongside the existing `auth-screen` for `AUTH_SCREENS`. The `scrolled` class is removed when leaving the unlocked screen.
- **Scroll listener** — a `requestAnimationFrame`-throttled scroll listener toggles `body.scrolled` when `scrollY > 8px`. Tied to the `wire()` scope, always active.
- **CSS** — `.unlocked .titlebar` is transparent (background + border). `.unlocked.scrolled .titlebar` is `rgba(242,234,229,0.75)` (cream frosted glass) / `rgba(255,255,255,0.78)` (mono white glass), both with `backdrop-filter: blur(14px)`. The transition is the existing 0.35s ease on `.titlebar`.
- **Mono glass** — `body.theme-mono.unlocked.scrolled .titlebar` swaps to a white frosted glass so the geometric mark stays visible.

**Verified:** 52/52 tests green, preview cycle confirmed — default opaque, unlocked transparent, scrolled frosted with blur, mono white glass.

## v2.9.14 — upscaled transparent wordmark replaces old cropped one (2026-08-23)

Replaced `vault-wordmark.png` (624×115 cropped strip) with the user-supplied upscaled transparent PNG (5436×5436 RGBA).

- **Asset swap** — `src/vault-mark.png` now serves double-duty as both the wordmark (welcome/locked screens + titlebar) and the favicon. The old `vault-wordmark.png` is deleted.
- **CSS** — `.brand-wordmark` now uses `background-size:contain` with explicit heights (`3.3rem` for the screen, `0.98rem` for the titlebar) since the new image is square instead of a wide strip. Background set to `transparent` so the PNG alpha channel bleeds through.
- **Circle mark** — the small overlapping-circle SVG beside the titlebar wordmark is unchanged.
- **Rebuilt EXE** — `dist/my-vault-portable.exe` (94,920,076 bytes), new PNG confirmed inside `app.asar`, smoke-tested launch with "My Vault" window title.

**Verified:** 52/52 tests green, packaged asar contains `/src/vault-mark.png` (no `vault-wordmark.png`), real app launched and closed cleanly.

## Audit (2026-08-18 re-run, /auditme)
Second full audit pass — same threat model (offline personal vault; device thief + shared-household user + casual file recipient). Prior 6 findings re-verified: SEC-001/002/003/004/006 still resolved (no regressions), SEC-005 still open (accepted). OSV check live this run: 240 pinned deps, zero known CVEs. Live dynamic pass: Electron shell boots clean (zero CSP violations); dev-server page observed in browser (zero CSP violations, zero third-party). Dev-server traversal probes: raw `../` and `%2e%2e` collapsed by the WHATWG URL parser (404), `%5c` backslash variant blocked by the `startsWith(root)` boundary (403). Four new INFO findings added to `findings.json` (SEC-007 tamper-sample plaintext not wiped, SEC-008 orphaned `.tmp-*` on failed rename, SEC-009 dev server lacks security headers, SEC-010 no record-count cap on parseVault). All four are now **resolved in source**: SEC-007 (`vault-crypto.mjs` wipes the sampled plaintext), SEC-008 (`main.js` unlinks the tmp file on failed rename), SEC-009 (`server.mjs` sends the CSP + nosniff headers), SEC-010 (`container.mjs` `MAX_RECORDS = 100000` + a 9th container test). Only SEC-005 remains open (accepted). Note: `findings.json` statuses for 007–010 still say `open` and should be flipped to `resolved` on the next audit re-run.

## Known limits / next
- **No notes** — photos only in v1 (the record schema + crypto already support notes; the phone's `vaultAddNote` is trivially portable).
- **No HEIC** — Chromium can't decode it; those files are skipped with a toast. Convert HEIC → JPEG first.
- **Import guard (SEC-006):** files over ~2 GB are skipped with a toast (`N skipped — over 2 GB (too big to encrypt safely)`) — importing buffers the whole file in memory, and a multi-GB file could spike RAM hard enough to crash the app mid-batch and lose the rest of the import.
- Re-encode is lossy JPEG (q0.92) — the EXIF strip has a small quality cost.
- Whole file is rewritten on each change (fine for personal scale).
- Next candidates: notes, Windows Hello unlock, NSIS installer, drag-drop polish, "move vault file" (relocate without losing history), a `--verify` CLI for the file. (App icon already shipped in v1.3.2.)
