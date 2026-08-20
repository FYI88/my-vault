# My Vault — offline encrypted photo vault for PC

> **SAVE POINT — built 2026-08-18.** A working portable EXE exists: `pcvault/dist/my-vault-portable.exe` (90 MB, unsigned — SmartScreen will warn, "more info → run anyway"). Run from source with `npm start`; test with `npm test`.
>
> **REBUILT 2026-08-19.** `node_modules` + `dist` were dropped when the project was re-imported. Restored with a portable Node 22.23.2 (win-x64) in `../.tools/node-v22.23.2-win-x64` (this machine has no system Node), `npm ci` (284 pkgs, 0 vulns), all tests green, EXE rebuilt to **86 MB**. SEC-007/008/009/010 are now resolved in source (see Audit).
>
> **v1.4–v1.8 (2026-08-19):** keepsake voice pass, masonry grid with filenames, in-app doc viewer, an offline **pdf.js 6.2.108** canvas PDF viewer (clean toolbar, zero CSP violations), and an interactive particle background on the auth screens. EXE now **91 MB**.

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

## Audit (2026-08-18 re-run, /auditme)
Second full audit pass — same threat model (offline personal vault; device thief + shared-household user + casual file recipient). Prior 6 findings re-verified: SEC-001/002/003/004/006 still resolved (no regressions), SEC-005 still open (accepted). OSV check live this run: 240 pinned deps, zero known CVEs. Live dynamic pass: Electron shell boots clean (zero CSP violations); dev-server page observed in browser (zero CSP violations, zero third-party). Dev-server traversal probes: raw `../` and `%2e%2e` collapsed by the WHATWG URL parser (404), `%5c` backslash variant blocked by the `startsWith(root)` boundary (403). Four new INFO findings added to `findings.json` (SEC-007 tamper-sample plaintext not wiped, SEC-008 orphaned `.tmp-*` on failed rename, SEC-009 dev server lacks security headers, SEC-010 no record-count cap on parseVault). All four are now **resolved in source**: SEC-007 (`vault-crypto.mjs` wipes the sampled plaintext), SEC-008 (`main.js` unlinks the tmp file on failed rename), SEC-009 (`server.mjs` sends the CSP + nosniff headers), SEC-010 (`container.mjs` `MAX_RECORDS = 100000` + a 9th container test). Only SEC-005 remains open (accepted). Note: `findings.json` statuses for 007–010 still say `open` and should be flipped to `resolved` on the next audit re-run.

## Known limits / next
- **No notes** — photos only in v1 (the record schema + crypto already support notes; the phone's `vaultAddNote` is trivially portable).
- **No HEIC** — Chromium can't decode it; those files are skipped with a toast. Convert HEIC → JPEG first.
- **Import guard (SEC-006):** files over ~2 GB are skipped with a toast (`N skipped — over 2 GB (too big to encrypt safely)`) — importing buffers the whole file in memory, and a multi-GB file could spike RAM hard enough to crash the app mid-batch and lose the rest of the import.
- Re-encode is lossy JPEG (q0.92) — the EXIF strip has a small quality cost.
- Whole file is rewritten on each change (fine for personal scale).
- Next candidates: notes, Windows Hello unlock, NSIS installer, drag-drop polish, "move vault file" (relocate without losing history), a `--verify` CLI for the file. (App icon already shipped in v1.3.2.)
