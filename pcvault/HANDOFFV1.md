# HANDOFF V1 — Gallery & Media Viewer Features

This file documents the **PhantomInfiniteGallery** (Framer port) and **Immersive Media Viewer** features implemented in this session. Use this to restore or migrate these features to another environment.

---

## 1. PhantomInfiniteGallery (Framer Port)

A vanilla JS port of the Framer `PhantomInfiniteGallery` component, optimized for offline use and strict CSP compliance.

### Files Modified

#### `src/phantom-gallery.mjs`
- Full rewrite implementing frameless rounded tiles, grid-level tilt, device-pixel crispness, and adaptive vignette
- Key features:
  - **Frameless tiles**: `border-radius:14px`, no borders, no captions, soft shadow `0 15px 35px rgba(74,63,66,0.18)`
  - **Grid tilt**: Whole-grid `rotateX/rotateY ±12°` following cursor position instead of per-cell arc
  - **Device-pixel snapping**: `snapPx()` and `crispBorder()` ensure crisp lines at any display scale (125%/150%)
  - **Adaptive vignette**: Dark edges on dark backgrounds, soft shadow on light backgrounds
  - **Ghost treatment**: Subtle blur/desat/brightness on images (`blur(0.6px) saturate(0.9) brightness(0.95)`), sharpens on hover
  - **No per-cell arc**: Removed `arcTransform()`; tilt handled on `gridEl` transform

#### `src/renderer.js`
- Gallery initialization config (lines ~661–678):
```js
state.phantomGallery = createPhantomGallery($('phantomGallery'), {
  backgroundColor: '#fbf6f3', // vault cream
  cellSize: 240,
  gap: 20,
  parallaxStrength: 0.06,
  parallaxEase: 0.12,
  throwFriction: 0.92,
  onItemClick: (item) => openItem(item.id),
});
```
- Added `document.body.classList.toggle('gallery-mode', state.galleryMode)` to `toggleGallery()` function

#### `src/styles.css`
- `.phantom-gallery` class (lines 334–340):
```css
/* ----- phantom infinite gallery ----- */
.phantom-gallery{
  width:100%; height:calc(100vh - 120px);
  margin-top:0.5rem;
  /* no border-radius: a radius would clip the separation lines at the corners */
  overflow:hidden; position:relative;
  user-select:none; -webkit-user-select:none;
}
.gallery-mode .phantom-gallery{
  margin:0.4rem 0 0; height:calc(100vh - 138px);
}
```
- `.gallery-mode` rules (lines 334–340):
```css
body.gallery-mode{ padding:0; }
body.gallery-mode .wrap{ max-width:none; padding:1.1rem 1.25rem 0; }
```

---

## 2. Immersive Media Viewer

Full-bleed media viewer with HUD bars, zoom, drag, play overlay, and keyboard navigation.

### Files Modified

#### `src/index.html`
- Rewritten viewer markup (lines ~341–385):
  - `.viewer-stage` (full-bleed dark stage)
  - `.viewer-top` HUD bar (back/title/date/fullscreen/export/delete chip)
  - `.viewer-bottom` HUD bar (prev/next + "N of M")
  - `.viewer-play` big rose play button for paused video
  - `.viewer-count` element
  - Navigation buttons: `#viewerPrevBtn`, `#viewerNextBtn`, `#viewerFullscreenBtn`

#### `src/styles.css`
- Viewer styles (lines ~341–472):
  - `.item-overlay` (fixed full-bleed dark background)
  - `.viewer-stage` (flex centering, image/video sizing)
  - `.viewer-play` (rose play button with backdrop-filter)
  - `.viewer-hud`, `.viewer-top`, `.viewer-bottom` (HUD styling)
  - `.viewer-title-wrap`, `.viewer-title`, `.viewer-date` (title styling)
  - `.hud-btn`, `.hud-chip` (button/chip styling)
  - `.viewer-count` (count styling)
  - `.viewer-err` (error styling)
  - Viewer-specific PDF/text/document styling (lines ~428–472)

#### `src/renderer.js`
- Viewer logic (lines ~953–1285):
  - `openItem(id)` function: handles photo/video/PDF/text rendering
  - `closeItemOverlay()` function
  - Keyboard navigation: Esc, ←, →, F keys
  - Zoom: wheel zoom 1–5×, dblclick fit/100%
  - Drag pan: pointermove handlers
  - Play overlay: `#viewerPlay` click handler
  - Auto-hide chrome: `pokeChrome()` with 2500ms timeout
  - URL cleanup and lock() cleanup

---

## 3. Build & Verification

- **Tests**: `npm test` passes 27/27 (18 crypto + 9 container tests)
- **Harness**: `preview-harness.cjs` passes 9/9 checks (boot, import, chrome, zoom, esc, nav, play, galOk, csp)
- **EXE**: `dist\my-vault-portable.exe` rebuilt and verified (contains all changes)
- **Stale processes**: 4 old instances killed from Temp directory

---

## 4. Next Steps for User

1. Run `dist\my-vault-portable.exe`
2. If anything looks wrong, describe in 2–3 words (e.g., "arc too strong", "lines too faint", "ghost too subtle")
3. To tweak:
   - Gallery tile size: change `cellSize: 240` in `renderer.js`
   - Ghost effect: toggle `C.ghostImages` in `renderer.js` config
   - Arc strength: adjust `arcAmount`/`arcMaxAngleDeg` in `renderer.js` config
   - Line color: change `borderColor` in `renderer.js` config

*End of HANDOFF V1*