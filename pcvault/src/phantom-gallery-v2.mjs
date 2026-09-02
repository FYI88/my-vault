// phantom-gallery-v2.mjs — vanilla port of the supplied "Infinite Gallery Wall"
// demo (Documents/phantom-infinite-gallery-v5.html): an infinite draggable wall
// of photos on a 3D curve, with hold-to-zoom, inertia throw, cursor parallax,
// rounded-corner cards (image on top, caption row below it), faint straight
// divider lines through the gutters, and a blur-ghost hover. Adapted to the
// vault: tiles show the caller's own `blob:` thumbnails + short title/meta
// captions, and clicks open items. Zero dependencies, strict-CSP-safe — every
// style is applied through CSSOM (el.style.*), never an inline style
// attribute, and there is no eval and no remote URL.
//
// v5 deltas vs v4 (ported 1:1): tiles are portrait cards (TILE_W 200 × TILE_H
// 230, so the image area comes out square under the caption row); the caption
// is a flex row BELOW the image (not overlaid on it); hover scales the card
// (1.02) and zooms the photo (1.06); the divider grid is drawn as straight
// two-point segments (project both endpoints through the same perspective
// math — no bow sampling); no zoom HUD (the vault hide it — hold-to-zoom +
// drag + parallax all still work).
//
// The demo's "Edit gallery" CMS panel is NOT ported: in the demo it edits
// generated art + localStorage; in the vault the items are the user's own
// encrypted files and are edited through the vault UI, not a canvas gallery.
//
// Item contract (shared with phantom-gallery.mjs and drift-wall.mjs):
//   { id, thumbUrl, title, meta, name }
//   - thumbUrl: background image (blob/data URL)
//   - title:    short display name (already shortened by the caller)
//   - meta:     right-hand caption (year for photos, size for docs)
//   - name:     full name — used only for the hover tooltip
//
// API mirrors the other galleries:
//   createPhantomGalleryV2(container, opts) -> { destroy(), setItems(items) }
//
// The wall is a base grid (cols × rows, rows chosen to cover the item count)
// replicated 3×3 so dragging wraps seamlessly in both axes. The camera wraps
// modulo the base grid size, so the wall is infinite in every direction. The
// divider lines are replicated and projected with the same math so they stay
// glued to the tile gutters at any zoom/pan (see projectPoint below).

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Create the v5 Infinite Gallery Wall inside `container`.
 *
 * @param {HTMLElement} container — fixed-size host (e.g. .phantom-gallery)
 * @param {Object} opts
 * @returns {{ destroy():void, setItems(items:Array):void }}
 */
export function createPhantomGalleryV2(container, opts = {}) {
  const C = Object.assign({
    tileWidth: 200,
    tileHeight: 230,
    imageRadius: 6,
    gap: 20,
    cols: 5,             // base-grid columns (user-settable in Settings: grid x:y)
    fixedRows: 0,        // base-grid rows; 0 = auto (rows = ceil(items/cols)) — user-settable
    tileScale: 1,        // grid scale: multiplies tile + gap sizes (0.5–2.5), user-settable
    maxBaseRows: 40,     // cap the base grid so a huge vault never spawns tens of thousands of tiles/lines
    holdZoom: 0.5,       // press-hold zooms OUT to this scale (the demo's gesture)
    zoomEase: 0.085,
    parallaxStrength: 0.05,
    parallaxMax: 20,
    parallaxEase: 0.08,
    curveMaxAngle: 14,   // degrees of rotateY at the edges
    curveDepth: 90,      // px of translateZ at the edges
    friction: 0.945,     // inertia decay per 16.7ms
    minScale: 0.3,
    maxScale: 1.5,
    gridStroke: 'rgba(255,255,255,0.06)', // divider-grid color (1px, non-scaling) — kept faint so it never reads as artifacts over photos
    ground: '#171014',   // warm near-black — matches the item viewer stage.
    accent: '#9fd3ff',   // not used by the v5 wall (no HUD) — kept for the option shape
    onItemClick: null,
  }, opts);

  const TILE_W = Math.max(40, Math.round(C.tileWidth * C.tileScale));
  const TILE_H = Math.max(46, Math.round(C.tileHeight * C.tileScale));
  const GAP = Math.max(6, Math.round(C.gap * C.tileScale));
  const CELL_W = TILE_W + GAP;
  const CELL_H = TILE_H + GAP;
  const PERSPECTIVE_PX = 1700; // must match the viewport's perspective below

  // ---- state ----
  let items = C.items || [];
  let cols = C.cols;
  let rows = 1;
  let gridW = cols * CELL_W;
  let gridH = rows * CELL_H;
  let tiles = []; // { el, blurEl, sharpEl, tEl, yEl, item, worldX, worldY, lastThumb }
  let lines = []; // { el, w, h, worldX, worldY } — SVG divider paths

  let scale = 1, targetScale = 1;
  let cameraX = 0, cameraY = 0;
  let momentumX = 0, momentumY = 0;
  let cursorX = 0, cursorY = 0;
  let centerX = 0, centerY = 0;
  let parallaxCurX = 0, parallaxCurY = 0;
  let isDown = false, lastX = 0, lastY = 0, samples = [];
  let dragOccurred = false;
  let raf = 0;
  let lastFrame = performance.now();
  let ro = null;
  let mountAt = 0;       // when the current wall was (re)built — for the fade-in
  let wallFaded = false; // true once the wall has faded in (avoids the white "buffering" flash)

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ---- DOM setup ----
  // Only set what the stylesheet can't provide; the host (.phantom-block /
  // gallery-mode) owns width/height AND position (it flips to `fixed` in
  // gallery mode) so we never collapse it to 0 or clobber that with an
  // inline `relative` (inline beats the stylesheet — and a previous mount may
  // have left an inline position behind).
  container.style.removeProperty('position');
  if (getComputedStyle(container).position === 'relative') {
    container.style.position = undefined;
  }
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  container.style.overflow = 'hidden';
  container.style.background = C.ground;
  container.style.userSelect = 'none';
  container.style.webkitUserSelect = 'none';

  const viewport = document.createElement('div');
  viewport.style.position = 'absolute';
  viewport.style.inset = '0';
  viewport.style.perspective = PERSPECTIVE_PX + 'px';
  viewport.style.cursor = 'grab';
  viewport.style.touchAction = 'none';
  viewport.style.zIndex = '0';
  container.appendChild(viewport);

  // Divider grid (v5): an SVG layer under the wall. Lines are positioned by
  // camera math each frame, so they stay glued to the gutters.
  const gridSvg = document.createElementNS(SVG_NS, 'svg');
  gridSvg.style.position = 'absolute';
  gridSvg.style.inset = '0';
  gridSvg.style.width = '100%';
  gridSvg.style.height = '100%';
  gridSvg.style.pointerEvents = 'none';
  gridSvg.style.overflow = 'visible';
  viewport.appendChild(gridSvg);

  const wall = document.createElement('div');
  wall.style.position = 'absolute';
  wall.style.left = '0';
  wall.style.top = '0';
  // Full-size (not the demo's 0×0) so the preserve-3d wrapper is a real
  // hit-test surface — same structure as phantom-gallery's gridEl, verified
  // to resolve elementFromPoint clicks in the packaged app. Tiles are
  // absolutely positioned, so this changes nothing visually.
  wall.style.width = '100%';
  wall.style.height = '100%';
  wall.style.transformStyle = 'preserve-3d';
  viewport.appendChild(wall);

  // edge vignette (from the demo)
  const vignette = document.createElement('div');
  vignette.style.position = 'absolute';
  vignette.style.inset = '0';
  vignette.style.pointerEvents = 'none';
  vignette.style.zIndex = '1';
  vignette.style.background = 'radial-gradient(120% 90% at 50% 45%, transparent 50%, rgba(0,0,0,0.5) 100%)';
  container.appendChild(vignette);

  // ---- viewport tracking ----
  function readViewport() {
    const r = viewport.getBoundingClientRect();
    centerX = r.width / 2;
    centerY = r.height / 2;
  }
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => readViewport());
    ro.observe(viewport);
  }
  readViewport();
  cursorX = centerX;
  cursorY = centerY;

  // ---- build the tile wall ----
  function makeTile(item) {
    const el = document.createElement('div');
    el.className = 'pg2-tile';
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.width = TILE_W + 'px';
    el.style.height = TILE_H + 'px';

    // card (transparent behind the image — the rounded image IS the card)
    const card = document.createElement('div');
    card.style.position = 'absolute';
    card.style.inset = '0';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.transition = 'transform .35s ease';

    // image area: square (TILE_H is TILE_W + the caption row)
    const imgwrap = document.createElement('div');
    imgwrap.style.position = 'relative';
    imgwrap.style.flex = '1';
    imgwrap.style.minHeight = '0';
    imgwrap.style.borderRadius = C.imageRadius + 'px';
    imgwrap.style.overflow = 'hidden';
    imgwrap.style.background = '#000';

    // blur ghost (revealed on hover, from the demo)
    const blur = document.createElement('div');
    blur.style.position = 'absolute';
    blur.style.inset = '0';
    blur.style.backgroundSize = 'cover';
    blur.style.backgroundPosition = 'center';
    blur.style.filter = 'blur(28px)';
    blur.style.transform = 'scale(1.2)';
    blur.style.opacity = '0';
    blur.style.transition = 'opacity .5s ease';
    blur.style.pointerEvents = 'none';

    // sharp face
    const sharp = document.createElement('div');
    sharp.style.position = 'absolute';
    sharp.style.inset = '0';
    sharp.style.backgroundSize = 'cover';
    sharp.style.backgroundPosition = 'center';
    sharp.style.transition = 'transform .5s ease';

    imgwrap.appendChild(blur);
    imgwrap.appendChild(sharp);

    // caption row below the image
    const plate = document.createElement('div');
    plate.style.flex = 'none';
    plate.style.display = 'flex';
    plate.style.justifyContent = 'space-between';
    plate.style.alignItems = 'center';
    plate.style.padding = '7px 2px 9px';
    plate.style.pointerEvents = 'none';
    plate.style.fontFamily = "'JetBrains Mono', monospace";

    const t = document.createElement('span');
    t.style.fontSize = '9px';
    t.style.letterSpacing = '.1em';
    t.style.textTransform = 'uppercase';
    t.style.color = 'rgba(255,255,255,0.68)';
    t.style.whiteSpace = 'nowrap';
    t.style.overflow = 'hidden';
    t.style.textOverflow = 'ellipsis';

    const y = document.createElement('span');
    y.style.fontSize = '9px';
    y.style.letterSpacing = '.06em';
    y.style.color = 'rgba(255,255,255,0.38)';
    y.style.flex = 'none';
    y.style.marginLeft = '8px';
    y.style.whiteSpace = 'nowrap';

    plate.appendChild(t);
    plate.appendChild(y);

    card.appendChild(imgwrap);
    card.appendChild(plate);
    el.appendChild(card);

    el.addEventListener('mouseenter', () => {
      blur.style.opacity = '0.85';
      sharp.style.transform = 'scale(1.06)';
      card.style.transform = 'scale(1.02)';
    });
    el.addEventListener('mouseleave', () => {
      blur.style.opacity = '0';
      sharp.style.transform = 'scale(1)';
      card.style.transform = 'scale(1)';
    });

    el._item = item;

    const tile = { el, blur, sharp, tEl: t, yEl: y, item, lastThumb: undefined };
    applyThumb(tile);
    t.textContent = (item && (item.title || item.name)) || '';
    y.textContent = (item && item.meta != null ? item.meta : '') || '';
    el.title = (item && item.name) || '';
    wall.appendChild(el);
    return tile;
  }

  function applyThumb(tile) {
    const url = tile.item && tile.item.thumbUrl;
    if (url === tile.lastThumb) return;
    tile.lastThumb = url;
    tile.blur.style.backgroundImage = url ? `url("${url}")` : 'none';
    tile.sharp.style.backgroundImage = url ? `url("${url}")` : 'none';
  }

  // ---- divider grid (v5): one SVG path pair per base cell, wrapped 3×3 ----
  function makeLine(w, h, worldX, worldY) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', C.gridStroke);
    p.setAttribute('stroke-width', '1');
    p.setAttribute('vector-effect', 'non-scaling-stroke');
    gridSvg.appendChild(p);
    lines.push({ el: p, w, h, worldX, worldY });
  }

  function rebuild() {
    // tear down existing tiles + lines
    for (const t of tiles) t.el.remove();
    tiles = [];
    for (const ln of lines) ln.el.remove();
    lines = [];

    // fade the wall in: tiles start on a dark ground with faint placeholders,
    // so we keep the wall invisible until real thumbs arrive (or ~0.7s max,
    // for doc tiles that never hydrate). Kills the white "buffering" flash.
    // Set the opacity with the transition OFF and force a reflow first — if
    // the transition is live, the browser animates from the previously
    // rendered value (1) and the wall flickers out before fading in.
    wall.style.transition = 'none';
    wall.style.opacity = '0';
    void wall.offsetWidth; // commit the 0 immediately
    wall.style.transition = 'opacity .5s ease';
    wallFaded = false;
    mountAt = performance.now();

    const n = items.length;
    // clamp cols/rows so a huge manual grid can't spawn tens of thousands of
    // tiles: at most MAX_CELLS base cells (×9 replicas when wrapping).
    const MAX_CELLS = 400;
    cols = Math.max(1, Math.min(16, Math.round(C.cols) || 5));
    const maxRows = Math.max(1, Math.floor(MAX_CELLS / cols));
    const fixedRows = Math.max(0, Math.min(30, Math.round(C.fixedRows) || 0));
    rows = fixedRows > 0
      ? Math.min(fixedRows, maxRows)
      : Math.max(1, Math.min(C.maxBaseRows, maxRows, Math.ceil(n / cols)));
    gridW = cols * CELL_W;
    gridH = rows * CELL_H;

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const baseX = gx * CELL_W - gridW / 2 + CELL_W / 2;
        const baseY = gy * CELL_H - gridH / 2 + CELL_H / 2;
        const idx = (gy * cols + gx) % (n || 1);
        const item = items[idx] || null;
        for (let rx = -1; rx <= 1; rx++) {
          for (let ry = -1; ry <= 1; ry++) {
            const tile = makeTile(item);
            tile.worldX = baseX + rx * gridW;
            tile.worldY = baseY + ry * gridH;
            tiles.push(tile);
          }
        }

        // divider lines through the center of the gutter to the right of and
        // below this cell, wrapped the same way the tiles are (from v5)
        for (let lrx = -1; lrx <= 1; lrx++) {
          for (let lry = -1; lry <= 1; lry++) {
            makeLine(1, CELL_H, baseX + CELL_W / 2 + lrx * gridW, baseY + lry * gridH);
            makeLine(CELL_W, 1, baseX + lrx * gridW, baseY + CELL_H / 2 + lry * gridH);
          }
        }
      }
    }

    // reset the camera so the new grid's wrapping starts centered
    scale = 1; targetScale = 1;
    cameraX = 0; cameraY = 0;
    momentumX = 0; momentumY = 0;
  }

  // ---- pointer input (from the demo) ----
  function onDown(e) {
    isDown = true;
    dragOccurred = false;
    viewport.classList.add('holding');
    viewport.style.cursor = 'grabbing';
    try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const r = viewport.getBoundingClientRect();
    lastX = e.clientX; lastY = e.clientY;
    cursorX = e.clientX - r.left; cursorY = e.clientY - r.top;
    samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    momentumX = 0; momentumY = 0;
    targetScale = C.holdZoom;
  }

  function onMove(e) {
    const r = viewport.getBoundingClientRect();
    cursorX = e.clientX - r.left; cursorY = e.clientY - r.top;
    if (!isDown) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.hypot(dx, dy) > 4) dragOccurred = true;
    cameraX -= dx / scale; cameraY -= dy / scale;
    lastX = e.clientX; lastY = e.clientY;
    samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (samples.length > 6) samples.shift();
  }

  function onUp(e) {
    if (!isDown) return;
    isDown = false;
    viewport.classList.remove('holding');
    viewport.style.cursor = 'grab';
    try { viewport.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    targetScale = 1;
    if (samples.length >= 2) {
      const first = samples[0], last = samples[samples.length - 1];
      const dt = Math.max(1, last.t - first.t);
      momentumX = -((last.x - first.x) / dt) / scale;
      momentumY = -((last.y - first.y) / dt) / scale;
    }
  }

  viewport.addEventListener('pointerdown', onDown);
  viewport.addEventListener('pointermove', onMove);
  viewport.addEventListener('pointerup', onUp);
  viewport.addEventListener('pointercancel', onUp);

  // click-to-open: pointer capture retargets the synthesized `click` to the
  // nearest common ancestor, so per-tile click listeners never fire. Resolve
  // the tile under the pointer instead, and ignore clicks that followed a drag.
  function onClick(e) {
    if (!C.onItemClick || dragOccurred) return;
    const at = document.elementFromPoint(e.clientX, e.clientY);
    const tileEl = at && at.closest ? at.closest('.pg2-tile') : null;
    if (tileEl && tileEl._item) C.onItemClick(tileEl._item);
  }
  viewport.addEventListener('click', onClick);

  // ---- grid line projection (v5): straight two-point segments ----
  // Tiles don't land at plain (sx, sy): (1) the transform-origin sits at the
  // tile's own half-size *before* scaling, so translate3d leaves a residual
  // shift of halfW*(1-scale) once scale != 1, and (2) translateZ(z) is pushed
  // through the ancestor's `perspective`, dividing by (P−z)/P around the
  // viewport center. Each tile is a flat plane that rotates a bit (rotateY)
  // with distance from center, and a gutter line is one straight segment
  // drawn between its two projected endpoints — same interpretation, no
  // bowing/sampling. (from the v5 demo)
  function projectPoint(worldX, worldY, curveRadius) {
    const sx = centerX + (worldX - cameraX) * scale + parallaxCurX;
    const sy = centerY + (worldY - cameraY) * scale + parallaxCurY;

    let angle = -((sx - centerX) / curveRadius) * C.curveMaxAngle;
    if (angle > C.curveMaxAngle) angle = C.curveMaxAngle;
    if (angle < -C.curveMaxAngle) angle = -C.curveMaxAngle;
    const z = C.curveDepth * (Math.abs(angle) / C.curveMaxAngle);

    // (1) same residual shift the browser applies to the tiles
    const trueX = sx + (TILE_W / 2) * (1 - scale);
    const trueY = sy + (TILE_H / 2) * (1 - scale);

    // (2) same perspective divide the browser applies to translateZ(z)
    const persp = PERSPECTIVE_PX / (PERSPECTIVE_PX - z);
    return {
      x: centerX + (trueX - centerX) * persp,
      y: centerY + (trueY - centerY) * persp,
    };
  }

  function pathFor(ln, curveRadius) {
    let p1, p2;
    if (ln.h === 1) {
      p1 = projectPoint(ln.worldX - ln.w / 2, ln.worldY, curveRadius);
      p2 = projectPoint(ln.worldX + ln.w / 2, ln.worldY, curveRadius);
    } else {
      p1 = projectPoint(ln.worldX, ln.worldY - ln.h / 2, curveRadius);
      p2 = projectPoint(ln.worldX, ln.worldY + ln.h / 2, curveRadius);
    }
    return 'M' + p1.x.toFixed(1) + ',' + p1.y.toFixed(1) + ' L' + p2.x.toFixed(1) + ',' + p2.y.toFixed(1);
  }

  // ---- animation loop (from the demo) ----
  function frame(now) {
    raf = 0;
    const dt = Math.min(48, now - lastFrame);
    lastFrame = now;

    const prevScale = scale;
    scale += (targetScale - scale) * C.zoomEase;
    if (Math.abs(scale - targetScale) < 0.0004) scale = targetScale;

    // cursor-anchored zoom (keeps the point under the cursor pinned)
    const wUX = cameraX + (cursorX - centerX) / prevScale;
    const wUY = cameraY + (cursorY - centerY) / prevScale;
    cameraX = wUX - (cursorX - centerX) / scale;
    cameraY = wUY - (cursorY - centerY) / scale;

    // inertia throw
    if (!isDown && (Math.abs(momentumX) > 0.001 || Math.abs(momentumY) > 0.001)) {
      cameraX += momentumX * dt; cameraY += momentumY * dt;
      const f = Math.pow(C.friction, dt / 16.7);
      momentumX *= f; momentumY *= f;
    }

    // seamless wrap
    cameraX = ((cameraX % gridW) + gridW) % gridW;
    cameraY = ((cameraY % gridH) + gridH) % gridH;
    if (cameraX > gridW / 2) cameraX -= gridW;
    if (cameraY > gridH / 2) cameraY -= gridH;

    // cursor parallax
    const tpx = clamp(-(cursorX - centerX) * C.parallaxStrength, -C.parallaxMax, C.parallaxMax);
    const tpy = clamp(-(cursorY - centerY) * C.parallaxStrength, -C.parallaxMax, C.parallaxMax);
    parallaxCurX += (tpx - parallaxCurX) * C.parallaxEase;
    parallaxCurY += (tpy - parallaxCurY) * C.parallaxEase;

    const curveRadius = centerX * 1.1 || 700;

    // v5 tile transform: translate3d + rotateY + scale with the sizeComp
    // (P−z)/P term that keeps edge tiles constant-size on the curve.
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const sx = centerX + (t.worldX - cameraX) * scale + parallaxCurX;
      const sy = centerY + (t.worldY - cameraY) * scale + parallaxCurY;

      let angle = -((sx - centerX) / curveRadius) * C.curveMaxAngle;
      if (angle > C.curveMaxAngle) angle = C.curveMaxAngle;
      if (angle < -C.curveMaxAngle) angle = -C.curveMaxAngle;
      const z = C.curveDepth * (Math.abs(angle) / C.curveMaxAngle);
      const sizeComp = (PERSPECTIVE_PX - z) / PERSPECTIVE_PX;

      t.el.style.transform =
        'translate3d(' + (sx - TILE_W / 2 * scale) + 'px,' + (sy - TILE_H / 2 * scale) + 'px,' + z + 'px)' +
        ' rotateY(' + angle + 'deg)' +
        ' scale(' + (scale * sizeComp) + ')';

      // pick up thumbnails that hydrated after setItems (in-place mutation)
      applyThumb(t);
    }

    for (let j = 0; j < lines.length; j++) {
      lines[j].el.setAttribute('d', pathFor(lines[j], curveRadius));
    }

    if (!wallFaded && (performance.now() - mountAt > 700 || tiles.some((t) => t.lastThumb))) {
      wallFaded = true;
      wall.style.opacity = '1';
    }

    raf = requestAnimationFrame(frame);
  }

  rebuild();
  raf = requestAnimationFrame(frame);

  // ---- public API ----
  return {
    destroy() {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      viewport.removeEventListener('pointerdown', onDown);
      viewport.removeEventListener('pointermove', onMove);
      viewport.removeEventListener('pointerup', onUp);
      viewport.removeEventListener('pointercancel', onUp);
      viewport.removeEventListener('click', onClick);
      container.innerHTML = '';
    },
    setItems(newItems) {
      items = newItems || [];
      rebuild();
    },
  };
}