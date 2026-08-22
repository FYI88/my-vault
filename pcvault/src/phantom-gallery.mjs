// phantom-gallery.mjs — vanilla JS port of Framer's PhantomInfiniteGallery
// https://framer.com/m/PhantomInfiniteGallery-KBne.js@99C8ioUWN1y8Bj2XYLwl
//
// Faithful to the original: an infinite draggable grid whose cells sit on a
// 3D arc (they curve away toward the edges), each cell bordered and captioned
// (bold uppercase title on the left, a datum on the right), with parallax,
// inertia/throw, and press-to-zoom. Zero dependencies, strict-CSP-safe —
// images are the caller's own `blob:` thumbnails, never a remote CDN.
//
// Item shape (vault adaptation of the Framer `{ title, image, year }` contract):
//   { id, thumbUrl, title, meta, name }
//   - thumbUrl: background image (blob/data URL)
//   - title:    short display name (already shortened by the caller)
//   - meta:     right-hand caption (year for photos, size for docs)
//   - name:     full name — used only for the hover tooltip
//
// Options mirror Framer's property controls 1:1 (cellSize, gap, cellPadding,
// border {width,style,color,showTop/Bottom/Left/Right}, hoverColor, arcAmount,
// arcMaxAngleDeg, arcAxis, edgeFade, parallax*, inertia/throw*, zoomValue).

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const toRad = (deg) => deg * Math.PI / 180;

// ---- device-pixel crispness ----
// At fractional display scales (125%/150%), 1px CSS borders land between
// device pixels and alias into thin/cracked lines. Size borders in whole
// device pixels so the thin separation lines stay crisp at any DPR.
const dpr = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
const snapPx = (v) => { const d = dpr(); return Math.round(v * d) / d; };
const crispBorder = (w = 1) => Math.max(1, Math.round(w * dpr())) / dpr();

// ---- keep the view stable when the cell size changes (zoom pinning) ----
function computePinnedOffset(prevSize, nextSize, pivot, prevOffset) {
  const wx = (pivot.x - prevOffset.x) / prevSize;
  const wy = (pivot.y - prevOffset.y) / prevSize;
  return { x: pivot.x - wx * nextSize, y: pivot.y - wy * nextSize };
}

// ---- 3D arc transform per cell (the signature "phantom" curve) ----
function calcArcTransform({ cellCenterX, cellCenterY, viewportW, viewportH, arcAxis, arcMaxAngleDeg, arcAmount }) {
  const maxAngle = toRad(arcMaxAngleDeg) * clamp(arcAmount, 0, 1);
  if (maxAngle === 0) return { z: 0, yawDeg: 0, pitchDeg: 0, edgeFactor: 0 };
  if (arcAxis === 'horizontal') {
    const dx = (cellCenterX - viewportW / 2) / (viewportW / 2); // -1..1
    const angle = dx * maxAngle;
    const radius = viewportW / (2 * Math.sin(Math.max(0.001, maxAngle)));
    const z = -radius * (Math.cos(angle) - 1);
    const yawDeg = -(angle * 180) / Math.PI;
    const edgeFactor = Math.min(1, Math.abs(dx));
    return { z, yawDeg, pitchDeg: 0, edgeFactor };
  }
  const dy = (cellCenterY - viewportH / 2) / (viewportH / 2);
  const angle = dy * maxAngle;
  const radius = viewportH / (2 * Math.sin(Math.max(0.001, maxAngle)));
  const z = -radius * (Math.cos(angle) - 1);
  const pitchDeg = angle * 180 / Math.PI;
  const edgeFactor = Math.min(1, Math.abs(dy));
  return { z, yawDeg: 0, pitchDeg, edgeFactor };
}

/**
 * Create a PhantomInfiniteGallery inside `container`.
 *
 * @param {HTMLElement} container — fixed-size host (e.g. 100% × 100%)
 * @param {Object} opts — see the header for the full option list
 * @returns {{ destroy():void, setItems(items:Array):void }}
 */
export function createPhantomGallery(container, opts = {}) {
  const C = Object.assign({
    cellSize: 200, gap: 12, cellPadding: 10,
    backgroundColor: '#000000', textColor: '#808080',
    borderColor: '#FFFFFF',
    hoverColor: '#FF5588',
    arcAmount: 0.6, arcMaxAngleDeg: 28, arcAxis: 'horizontal', edgeFade: 0.25,
    parallaxEnabled: true, parallaxStrength: 0.1, parallaxEase: 0.12, parallaxWhileDragging: false,
    inertiaEnabled: true, throwFriction: 0.92, throwVelocityScale: 1, throwMinSpeed: 80, throwMaxSpeed: 2500,
    zoomValue: 0.7,
    idleColor: 'rgba(0, 0, 0, 0.1)',
    onItemClick: null,
  }, opts);

  const border = Object.assign({
    width: 1, style: 'solid', color: C.borderColor,
    showTop: false, showBottom: true, showLeft: true, showRight: true,
  }, opts.border || {});

  // ---- state ----
  let items = C.items || [];
  const off = { x: 0, y: 0 };          // base offset (lerped)
  const targetOff = { x: 0, y: 0 };    // target base offset
  const inertia = { x: 0, y: 0 };      // inertia delta
  const mouseOff = { x: 0, y: 0 };     // parallax offset
  const targetMouseOff = { x: 0, y: 0 };
  let cellSize = C.cellSize;
  let targetCellSize = C.cellSize;
  let dragging = false;
  let pressing = false;
  let raf = 0;
  let lastTime = performance.now();
  const velocity = { x: 0, y: 0 };
  const lastMove = { x: 0, y: 0, t: 0 };
  let inertiaActive = false;
  const pressPos = { x: 0, y: 0 };
  let startOff = { x: 0, y: 0 };
  let pressTimer = null;
  let dragOccurred = false; // the pointer actually dragged since pointerdown
  let zoomOccurred = false; // the press-hold zoom fired since pointerdown
  let viewport = { w: 0, h: 0 };

  // ---- DOM setup ----
  // width:100% but NOT height:100% — the caller's stylesheet owns the height.
  // Forcing height:100% clobbers .phantom-gallery's fixed height and collapses
  // the container to 0px when the parent has no intrinsic height.
  container.style.cssText = `width:100%;background:${C.backgroundColor};position:relative;overflow:hidden;touch-action:none;cursor:grab;user-select:none;perspective:1000px;transform-style:preserve-3d;`;
  const gridEl = document.createElement('div');
  gridEl.style.cssText = 'position:absolute;width:100%;height:100%;transform-style:preserve-3d;';
  container.appendChild(gridEl);
  // edge-fade vignette (Framer's dark radial)
  const vignette = document.createElement('div');
  vignette.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.8) 90%, rgba(0,0,0,1) 100%);';
  container.appendChild(vignette);

  // ---- viewport tracking ----
  const ro = new ResizeObserver(([entry]) => {
    const r = entry.contentRect;
    viewport = { w: r.width, h: r.height };
  });
  ro.observe(container);

  // ---- grid cell cache ----
  const cellEls = new Map(); // key → { el, img, t, m }
  const GRID = 20; // 20×20 infinite grid

  function cellKey(x, y) { return `${x},${y}`; }

  function makeCell() {
    const el = document.createElement('div');
    el.className = 'pgal-cell';
    const bw = crispBorder(border.width) + 'px';
    const bLine = (on) => on ? `${bw} ${border.style} ${border.color}` : 'none';
    el.style.cssText =
      'position:absolute;box-sizing:border-box;display:flex;flex-direction:column;' +
      'transform-style:preserve-3d;will-change:transform,opacity,left,top;cursor:pointer;' +
      'transition:background-color 0.3s ease;';
    el.style.backgroundColor = C.idleColor;
    el.style.borderTop = bLine(border.showTop);
    el.style.borderLeft = bLine(border.showLeft);
    el.style.borderRight = bLine(border.showRight);
    el.style.borderBottom = bLine(border.showBottom);

    const img = document.createElement('div');
    img.style.cssText = `flex:1;min-height:0;background-size:cover;background-position:center;border-radius:4px;margin-bottom:${C.gap}px;`;

    const cap = document.createElement('div');
    cap.style.cssText = `display:flex;justify-content:space-between;align-items:center;gap:8px;color:${C.textColor};font-size:12px;font-family:'JetBrains Mono',monospace;line-height:1.4;`;
    const t = document.createElement('span');
    t.style.cssText = 'font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;';
    const m = document.createElement('span');
    m.style.cssText = 'opacity:0.72;white-space:nowrap;flex-shrink:0;';
    cap.appendChild(t);
    cap.appendChild(m);

    el.appendChild(img);
    el.appendChild(cap);

    el.addEventListener('mouseenter', () => { el.style.backgroundColor = C.hoverColor; });
    el.addEventListener('mouseleave', () => { el.style.backgroundColor = C.idleColor; });

    return { el, img, t, m };
  }

  function updateCells() {
    const cellW = cellSize;
    const pitch = cellW; // faithful: cells touch; the 1px borders separate them
    const sx = Math.floor(-off.x / pitch) - 5;
    const sy = Math.floor(-off.y / pitch) - 5;
    const needed = new Set();
    const vw = viewport.w || 1;
    const vh = viewport.h || 1;

    for (let y = sy; y < sy + GRID; y++) {
      for (let x = sx; x < sx + GRID; x++) {
        const k = cellKey(x, y);
        needed.add(k);
        let cell = cellEls.get(k);
        if (!cell) {
          cell = makeCell();
          gridEl.appendChild(cell.el);
          cellEls.set(k, cell);
        }

        const left = x * pitch + off.x + inertia.x + mouseOff.x;
        const top = y * pitch + off.y + inertia.y + mouseOff.y;
        const { z, yawDeg, pitchDeg, edgeFactor } = calcArcTransform({
          cellCenterX: left + cellW / 2,
          cellCenterY: top + cellW / 2,
          viewportW: vw, viewportH: vh,
          arcAxis: C.arcAxis, arcMaxAngleDeg: C.arcMaxAngleDeg, arcAmount: C.arcAmount,
        });
        const scale = 1 - C.edgeFade * (edgeFactor * edgeFactor);
        const opacity = 1 - 0.4 * (edgeFactor * C.arcAmount);

        const el = cell.el;
        el.style.left = snapPx(left) + 'px';
        el.style.top = snapPx(top) + 'px';
        el.style.width = snapPx(cellW) + 'px';
        el.style.height = snapPx(cellW) + 'px';
        el.style.padding = C.cellPadding + 'px';
        el.style.transform = `translate3d(0, 0, ${z}px) rotateY(${yawDeg}deg) rotateX(${pitchDeg}deg) scale(${scale})`;
        el.style.opacity = String(opacity);

        const idx = Math.abs((x + y * 3) % (items.length || 1));
        const item = items[idx] || null;
        el._item = item;
        if (item) {
          cell.img.style.backgroundImage = item.thumbUrl ? `url("${item.thumbUrl}")` : 'none';
          cell.t.textContent = item.title || item.name || '';
          cell.m.textContent = (item.meta != null ? item.meta : (item.year != null ? item.year : '')) || '';
          el.title = item.name || item.title || '';
        } else {
          cell.img.style.backgroundImage = 'none';
          cell.t.textContent = '';
          cell.m.textContent = '';
          el.title = '';
        }
      }
    }
    for (const [k, cell] of cellEls) {
      if (!needed.has(k)) { cell.el.remove(); cellEls.delete(k); }
    }
  }

  // ---- RAF loop ----
  function tick() {
    raf = 0;
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    // lerp cell size
    cellSize = lerp(cellSize, targetCellSize, 0.15);
    if (Math.abs(cellSize - targetCellSize) < 0.05) cellSize = targetCellSize;

    // lerp base offset (not while dragging)
    if (!dragging) {
      off.x = lerp(off.x, targetOff.x, 0.15);
      off.y = lerp(off.y, targetOff.y, 0.15);
      if (Math.abs(off.x - targetOff.x) < 0.1) off.x = targetOff.x;
      if (Math.abs(off.y - targetOff.y) < 0.1) off.y = targetOff.y;
    }

    // inertia
    if (C.inertiaEnabled && inertiaActive) {
      const f = Math.pow(C.throwFriction, dt * 60);
      velocity.x *= f;
      velocity.y *= f;
      const speed = Math.hypot(velocity.x, velocity.y);
      if (speed < 1) {
        const dir = Math.atan2(velocity.y, velocity.x);
        velocity.x = Math.cos(dir) * 0.0001;
        velocity.y = Math.sin(dir) * 0.0001;
      }
      inertia.x += velocity.x * dt;
      inertia.y += velocity.y * dt;
    }

    // parallax
    const parallaxOn = C.parallaxEnabled && (C.parallaxWhileDragging || !dragging);
    if (parallaxOn) {
      mouseOff.x = lerp(mouseOff.x, targetMouseOff.x, C.parallaxEase);
      mouseOff.y = lerp(mouseOff.y, targetMouseOff.y, C.parallaxEase);
    } else {
      mouseOff.x = lerp(mouseOff.x, 0, C.parallaxEase);
      mouseOff.y = lerp(mouseOff.y, 0, C.parallaxEase);
    }

    updateCells();
    raf = requestAnimationFrame(tick);
  }

  // ---- pointer handlers ----
  function commitInertia() {
    off.x += inertia.x;
    off.y += inertia.y;
    targetOff.x = off.x;
    targetOff.y = off.y;
    inertia.x = 0;
    inertia.y = 0;
    inertiaActive = false;
  }

  function onDown(e) {
    if (inertiaActive || inertia.x !== 0 || inertia.y !== 0) commitInertia();
    pressing = true;
    dragging = false;
    dragOccurred = false;
    zoomOccurred = false;
    container.setPointerCapture(e.pointerId);
    lastMove.x = e.clientX;
    lastMove.y = e.clientY;
    lastMove.t = performance.now();
    velocity.x = 0;
    velocity.y = 0;
    pressPos.x = e.clientX;
    pressPos.y = e.clientY;
    startOff = { x: off.x, y: off.y };

    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!dragging && pressing) {
        const rect = container.getBoundingClientRect();
        const pivot = { x: rect.width / 2, y: rect.height / 2 };
        const vis = { x: off.x + inertia.x, y: off.y + inertia.y };
        const newSize = cellSize * C.zoomValue;
        const pinned = computePinnedOffset(cellSize, newSize, pivot, vis);
        zoomOccurred = true;
        targetCellSize = newSize;
        targetOff.x = pinned.x;
        targetOff.y = pinned.y;
      }
    }, 120);
  }

  function onMove(e) {
    if (pressing) {
      const now = performance.now();
      const dt = Math.max(0.001, (now - lastMove.t) / 1000);
      const dx = e.clientX - lastMove.x;
      const dy = e.clientY - lastMove.y;
      const vx = clamp((dx / dt) * C.throwVelocityScale, -C.throwMaxSpeed, C.throwMaxSpeed);
      const vy = clamp((dy / dt) * C.throwVelocityScale, -C.throwMaxSpeed, C.throwMaxSpeed);
      velocity.x = vx * 0.6 + velocity.x * 0.4;
      velocity.y = vy * 0.6 + velocity.y * 0.4;
      lastMove.x = e.clientX;
      lastMove.y = e.clientY;
      lastMove.t = now;
    }

    // parallax target (suppressed while pressing/dragging, like the original)
    if (C.parallaxEnabled && !pressing && container.getBoundingClientRect) {
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      targetMouseOff.x = (rect.width / 2 - mx) * C.parallaxStrength;
      targetMouseOff.y = (rect.height / 2 - my) * C.parallaxStrength;
    }

    if (!pressing) return;
    const dx = e.clientX - pressPos.x;
    const dy = e.clientY - pressPos.y;
    if (!dragging && Math.hypot(dx, dy) > 4) {
      dragging = true;
      dragOccurred = true;
      container.style.cursor = 'grabbing';
      startOff = { x: off.x, y: off.y };
    }
    if (dragging) {
      const nx = startOff.x + dx;
      const ny = startOff.y + dy;
      off.x = nx; off.y = ny;
      targetOff.x = nx; targetOff.y = ny;
    }
  }

  function onUp() {
    pressing = false;
    container.style.cursor = 'grab';
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    const speed = Math.hypot(velocity.x, velocity.y);
    if (C.inertiaEnabled && speed >= C.throwMinSpeed) {
      inertiaActive = true;
    } else {
      inertiaActive = false;
      inertia.x = 0;
      inertia.y = 0;
    }
    dragging = false;
    // zoom back in, center-pinned
    const rect = container.getBoundingClientRect();
    const pivot = { x: rect.width / 2, y: rect.height / 2 };
    const vis = { x: off.x + inertia.x, y: off.y + inertia.y };
    const pinned = computePinnedOffset(cellSize, C.cellSize, pivot, vis);
    targetMouseOff.x = 0;
    targetMouseOff.y = 0;
    targetCellSize = C.cellSize;
    targetOff.x = pinned.x;
    targetOff.y = pinned.y;
  }

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
  container.addEventListener('pointerleave', () => { targetMouseOff.x = 0; targetMouseOff.y = 0; });

  // click-to-open: pointer capture retargets the synthesized `click` to the
  // container (nearest common ancestor), so per-cell click listeners never fire.
  // Resolve the cell under the pointer instead, and ignore clicks that followed
  // a real drag or a press-hold zoom.
  function onClickCell(e) {
    if (!C.onItemClick || dragOccurred || zoomOccurred) return;
    const at = document.elementFromPoint(e.clientX, e.clientY);
    const cell = at && at.closest ? at.closest('.pgal-cell') : null;
    if (cell && cell._item) C.onItemClick(cell._item);
  }
  container.addEventListener('click', onClickCell);

  // ---- start ----
  raf = requestAnimationFrame(tick);

  // ---- public API ----
  return {
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
      container.removeEventListener('click', onClickCell);
      container.innerHTML = '';
    },
    setItems(newItems) {
      items = newItems || [];
      for (const [, cell] of cellEls) cell.el.remove();
      cellEls.clear();
    },
  };
}
