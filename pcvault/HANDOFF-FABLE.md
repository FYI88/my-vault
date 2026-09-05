# HANDOFF-FABLE — My Vault UI polish pass (for Fable 5)

Read THIS file plus only the files it names. Do not crawl the repo. Goal: UI polish, zero behavior or crypto changes. Branch `master` @ `6394d43` (pre-fable checkpoint, pushed) plus uncommitted Fable batch 2 on top. Section 8 lists what already landed — read it before proposing anything that touches the same selectors. Batch 2 added ~120 lines to `renderer.js`, so §3 line anchors below it drift upward; grep the function name when an anchor misses.

## 0. Run it (2 min)

1. `cd pcvault` then `npm start` — Electron loads `src/index.html`
2. Create vault, unlock, open Vault / Journal / Secrets tabs
3. Quit fully from tray between CSS edits — Electron caches `styles.css`, `Ctrl+R` is not enough
4. Static checks: `node --check src/renderer.js` plus boot harness `node C:/Users/HP/AppData/Local/Temp/opencode/bootcheck.mjs` (expect `BOOT OK`, ignore the typeless-package warning)

## 1. Files that matter (only these)

- `src/index.html` (499 lines) — all markup, element IDs below
- `src/renderer.js` (3039 lines) — all UI logic, all crypto calls (WebCrypto, no deps)
- `src/styles.css` (1221 lines) — all styling, cream default plus `body.theme-mono`
- `src/vault-crypto.mjs` — READ ONLY: PBKDF2 600k, AES-256-GCM, BIP-39, key wrap. Do not touch.
- `src/container.mjs` — READ ONLY: `.cvault` file format. Do not touch.
- `main.js`, `preload.js` — Electron bridge (`window.vaultAPI`). Do not touch unless the task says so.
- Gallery modules (`phantom-gallery.mjs`, `phantom-gallery-v2.mjs`, `drift-wall.mjs`, `wormhole.mjs`, `particles.mjs`) — out of scope, do not restyle.

## 2. Invariants — DO NOT BREAK (5)

1. No network, no eval, no `new Function`, no inline event handlers — strict CSP.
2. `manifest.prefs` rides PLAINTEXT in the file header — UI prefs only (theme, gallery style). Never put DOB, secrets, or journal text there.
3. PII lives only in encrypted records: files (`photo`/`video`/`doc`), journal (`kind=journal`), secrets (`kind=secret`), life DOB (`kind=life`, name `__life__`). Plaintext caches (`nameCache`, `journalCache`, `secretsCache`, `lifeCache`) are wiped in `lock()` (`renderer.js:520`).
4. Photos re-encode through canvas on import (EXIF strip, `stripExif`, `renderer.js:642`). Clipboard copies auto-clear in 30 s (`copyWithClear`, `renderer.js:974`).
5. Frameless window: page draws traffic lights plus Win controls, IPC via `data-win` attrs (`initWindowControls`, `renderer.js:2502`).

## 3. UI map (selectors + code anchors)

- Screens: `#screen-welcome #screen-create #screen-seed #screen-locked #screen-unlocked #screen-settings`, switched by `show(name)` (`renderer.js:154`). Sidebar `#sidebarTray` delegates `data-action` clicks; `#addFilesBtn` has its own direct listener.
- Tabs (Phase 1 `.v-tabs`): markup `index.html:122-129` (`#vaultTabs` + `#vaultTabsInd` + 3 `.v-tab` with `aria-selected`). Sliding pill logic `activeTabBtn/setTabsSelected/placeTabsIndicator` (`renderer.js:1809-1830`); screens switch in `showVaultTab/showJournalTab/showSecretsTab` (`renderer.js:1832-1872`). Indicator measures layout — hidden tabs read zero width, so placement snaps on `show(unlocked)`, resize, `fonts.ready`, and animates only on click. Arrow keys cycle tabs. Shortcuts: `Ctrl+1/2/3`, `Ctrl+Tab`.
- Journal toolbar: `#journalYearPrev #journalYearBtn #journalYearNext`, ring SVG `#journalYearRing` (static blood-black `#5c0909` progress arc) + `#journalYearComet` (bright `#e5383b` pulse ping-ponging inside the filled arc only, rAF loop `startRingSweep/stopRingSweep`, `renderer.js:1620-1650`). Loop must stop on lock and tab switch. Label `#journalYearLabel`.
- Year-progress sub-page (inside `#journalPane`): `#journalYearProgress`, close `#yearProgressClose`, stats `#yearProgressStats`, 53-dot grid `#yearWeeksGrid`, `Esc` closes (`toggleYearProgress`, `renderer.js:1615`).
- Life-weeks block (spec: `C:/Users/HP/Documents/BRAINSTORMING AND QUESTIONS/life-weeks-page.md`): intro `#lifeIntro #lifeDobIntro #lifeVisualizeBtn`; editor `#lifeMain #lifeDobInput #lifeExpectancyInput(1-130) #lifeClearBtn`; stat cards `#lsLived #lsLeft #lsTotal #lsTotalLabel #lsAge #lsPct #lsBday #lsEnds`; decade ruler `#lifeDecades` (green `#00c853` glow fill); grid `#lifeWeeksGrid` (lived black, current `#6ee7b7`, future white, ring every 520th, built once per DOB and cached via `dataset.key`). Logic `getLifeData/saveLifeData/clearLifeData` (`renderer.js:1087-1125`), render in `renderYearProgress` (`renderer.js:1652`).
- Secrets tab: composer `#secretsLabel #secretsCategoryPills #secretsUsername #secretsSecret(+#secretsRevealBtn) #secretsUrl #secretsNotes #secretsSaveBtn #secretsCancelBtn`; filter `#secretsFilterPills`; search `#secretsSearchInput`; list `#secretsList`. Row actions: eye toggle (lucide SVG icons, never emoji), copy user, copy secret, edit, delete with confirm. Logic `renderer.js:889-1080`.
- Viewer `#itemOverlay`: stage `#viewerStage` (`#itemImg #itemVideo #viewerPlay #itemPdf #itemText #itemDocInfo`), HUD `#viewerTop #viewerBottom`, `#viewerCount`. Zoom/pan state, chrome auto-fade 2.5 s (`renderer.js:80-140`). `Esc` closes, arrows move, `f` fullscreen, `Delete` armed-delete.
- Shortcuts help: generated by `ensureHelpOverlay` (`renderer.js:283`), toggle `Ctrl+?`. Full map lives in the global `keydown` handler at end of `wire()` (`wire()`, `renderer.js:2540`).
- Settings cards: `#idlePills #themePills #fontPills #bgPills #galleryStylePills(+#pgGridSettings) #chromePills`, forms `#changeForm #rotateForm`, `#revealBtn #backupBtn`.

## 4. Design tokens (use these, add nothing competing)

- Cream: `--cream #fbf6f3 --card #fff --rose-dark #c47b83 --mauve-dark #7a5f74 --sage-dark #6f7a5c --gold-dark #a8853a --text #4a3f42 --text-soft #756568 --border #e9dcd8 --shadow --bg`
- Additive ink and elevation (migrated from Phase 1 kit): `--rose-ink #b3545f --sage-ink #6b7559 --gold-ink #8a6d30 --mauve-ink #8b6681 --rose-fill #b55a64 --border-strong #c4a197 --e1 --e2 --e3` plus motion `--ease --ease-spring --t-fast 120ms --t-med 190ms --t-slow 280ms`
- Mono theme (`body.theme-mono`): near-black on white, GC Beluga Mono 14px, same token names remapped (ink becomes `#111/#555/#666/#2b2b2b`, elevation neutral black). Tab and ring rules carry explicit mono overrides.
- Fonts (bundled offline, never CDN): DM Serif Display italic (display), Cormorant Garamond (body), JetBrains Mono (labels), GC Beluga Mono (mono theme).
- Tabs motion spec: indicator `transform 280ms spring(.34,1.5,.64,1)` plus `width 190ms ease`; press `:active scale(.95)`; all off under `prefers-reduced-motion`.

## 5. Gotchas (learned the hard way)

1. One duplicate `const` anywhere in `renderer.js` = blank app, no login (module fails to parse). Always run `node --check` after edits.
2. Stale CSS: always quit the app fully; the boot harness cannot catch visual regressions.
3. `placeTabsIndicator` on a hidden tablist reads zero — never call it except after visible placement paths listed above.
4. Every rAF loop needs a stop path on `lock()` and tab switch (see `ringSweepRaf` pattern).
5. Life grid is ~4680 nodes — build once per DOB and cache, never rebuild per keystroke.
6. Never store anything sensitive in `localStorage` (legacy `lifeWeeksDOB` keys are migrated into the vault once, then deleted).
7. CSP `style-src 'self'` blocks BOTH `style=` attributes and JS-set `element.style` (verified live in Electron). Animate with classes and keyframes, never inline styles.

## 6. Task for Fable

Polish pass over Vault grid, Journal, Secrets, tabs, and viewer chrome: spacing rhythm, alignment, hover and focus states, empty states, toast placement. Keep every ID, keep all behavior, keep both themes, keep reduced-motion support. No new dependencies, no network, no font changes.

## 7. Done when (15 min verify)

1. `node --check` clean plus harness `BOOT OK` (plus `smoke.mjs` 25/25 in `C:/Users/HP/AppData/Local/Temp/opencode/` — boot, pills, import plus originals offer, photo kind, viewer open plus Esc close, journal save, secret save plus decrypt, life save, tab shortcuts, wrong-passphrase reject, full lock wipe)
2. Unlock, add file, write journal entry, add secret, set DOB — all persist after relock
3. `Ctrl+1/2/3`, `Ctrl+Tab`, `Esc` stack, arrows in viewer all still work
4. Cream plus mono look intentional, no emoji anywhere in UI
5. Commit message style: `style: ...` or `fix: ...`, one concern per commit. Do not push — owner pushes.

## 8. Already applied (do not redo)

- Premium motion layer appended at end of `styles.css` (screens stagger, button lift plus sheen, input halo `--ring`, grid arrival, viewer HUD slides, toast spring, calendar pulse, card hover, tray stagger, help pop, full reduced-motion kill).
- Zero inline `style=` left in `index.html` (CSP drops them); use `.secrets-intro` and `.secrets-footnote`.
- `#yearProgressClose` is the `searchClear` line-X SVG, never the `X` glyph.
- `.vault-input` aligns left globally, centered only under `.screen-center` (auth screens).
- `.vault-pills` wraps (`flex-wrap`), so 5-pill rows stack instead of squeezing.
- `#addFilesBtn` visibility is JS-driven per tab (`showVaultTab` shows, journal and secrets hide) — no CSS needed.

## 9. Backlog (later, not this pass)

- Sidebar overlap with `+ add files` on narrow windows — deferred by owner.
- Add-font button or picker (custom user fonts) — deferred by owner.
- `.grid-fade-imgs` plus `img.is-loaded` opt-in still needs JS (only `.is-loading` shimmer got wired).

## 10. Batch 2 applied (Fable 5.1 motion-plus-hooks, uncommitted)

- `show()` is async with a 160 ms `.leaving` exit plus race guard (`showSeq`); no caller awaits it. Unlock beat: `unlockBeat()` blooms the background 460 ms before the swap; auth forms use `setBusy` plus `shake()` (WAAPI) plus `is-wrong` on failure.
- Tray collapse uses `.collapsed`, never `.hidden` (which is `display:none` and kills fades). Viewer close fades via `.closing` (170 ms); photo open waits `img.decode()`; `viewerNav` passes `next` and `prev` for directional entry.
- Grid: `state.newIds` rise once, `.settled` gates the stagger, decrypting cells shimmer (`.is-loading`), thumbs fade via `setCellMedia` plus `img.is-loaded`. Secrets rows settle once; row delete is two-tap arm (`sure?`), no `confirm()`. Calendar months cascade only on year change (`.animate` flag).
- Dead CSS deleted: `.item-stage` block, mono leftovers, `.page-actions`, `.vault-hint`, `.hover-sim`, `.doc-meta-line`, `.vault-head-spacer`, `.cal-month-label`, one duplicate `#galleryToggleBtn.on`, `.sidebar-tray.hidden` base. Kept `.viewer-stage` selectors inside the old mono pdf-scroll rule.
- V1 motion layer replaced wholesale by v2 (do not re-add v1). V2 pairs with the classes above; reduced-motion kills all of it.
- Win-chrome controls sit clear of the full-height body scrollbar (`.title-right` offset, 10 px cream / 6 px mono).
- Year-weeks grid mirrors the life grid: small auto-fill 10 px boxes, lived black, current emerald, future white.
- `.vault-pills` wraps, so 5-pill rows (font picker) stack instead of squeezing.
- Inner-scroller experiment reverted by owner: `body` scrolls again, `.wrap` is back to padding-only, glass plus both `scrollTo` calls use `window` again. Win-chrome controls keep their scrollbar clearance offset.
- Deviations from the paste: `enterWithDek` and `handleSeedDone` kept their adopt and tamper tails with `unlockBeat()` inserted (no wholesale tail swap); `reducedMotion()` guards `matchMedia` for non-browser harnesses; `shake()` guards `el.animate`; `#secretsPane .vault-input` left-align rule skipped (base `.vault-input` is already left); leftover v1 `.sidebar-tray:not(.hidden)` stagger selectors left dead but harmless.

## 11. Originals (delete-after-import v1, uncommitted)

- Settings `Originals` card (`#originalsPills`, Keep default): after each import batch the app re-reads the vault file from disk and trial-decrypts every new record (`verifyRecordsFromDisk`). Any failure stops everything and names the file.
- Confirm plus result are native main-process dialogs with the honest label (permanent, no recycle bin, does not defeat SSD recovery). Main refuses paths resolving to the vault file itself (`main.js`, `vault:confirmDeleteOriginals` plus `vault:deleteOriginals`, bridged in `preload.js`).
- Only files imported this session are ever offered (`state.pendingOriginals`, wiped on `lock()`); source paths come from Electron `file.path`, never touch disk. Mode switch back to Keep clears the list.
- Kind detection is extension-based (`EXT_MIME`); unknown extensions import as `doc` (icon only, never renders). Keep the map current — `jfif`/`pjpeg`/`avif`/`heic` gaps caused exactly that.

## 12. Motion toggle (uncommitted)

- Settings `Motion` card (`#motionPills`, System default): `LS_MOTION` in `localStorage`, `body.reduce-motion` class mirrors the OS media-query kill-list (plus `.v-tabs-ind`, ring fill, decade fill). `reducedMotion()` is the single gate for JS motion (sweep, shake, beat, exits); `applyMotion()` runs at boot.
- Sandbox lesson: the renderer runs with `sandbox: true`, so `File.path` is always empty there. `+ add files` opens a main-process dialog (`vault:pickFiles`) that returns real paths; bytes cross the bridge and import runs with a parallel paths array. Hidden input plus drag-drop stay as fallbacks that import without paths and are never offered for deletion.

