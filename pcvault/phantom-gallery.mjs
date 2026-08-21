// phantom-gallery.mjs — vanilla JS port of PhantomInfiniteGallery
//
// Infinite draggable gallery with 3D arc perspective, parallax mouse tracking,
// inertia/throw physics, and press-to-zoom. Zero dependencies, strict-CSP-safe.
// Ported from the Framer component; uses plain DOM + requestAnimationFrame.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const toRad = (deg) => deg * Math.PI / 180;

// ---- device-pixel crispness ----
// At fractional display scales (125%/150%), 1px CSS borders land between
// device pixels and alias into thin/cracked/faded lines. Snap every cell to
// device pixels and size borders in whole device pixels so the white
// separation lines stay crisp at any DPR.
const dpr = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
const snapPx = (v) => { const d = dpr(); return Math.round(v * d) / d; };
const crispBorder = () => Math.max(1, Math.round(dpr())) / dpr();

// ---- compute a stable world-space offset when cell size changes ----
function pinnedOffset(prevSize, nextSize, pivot, prevOff) {
  const wx = (pivot.x - prevOff.x) / prevSize;
  const wy = (pivot.y - prevOff.y) / prevSize;
  return { x: pivot.x - wx * nextSize, y: pivot.y - wy * nextSize };
}

// ---- 3D arc transform per cell ----
function arcTransform(cx, cy, vw, vh, axis, maxAngleDeg, arcAmt) {
  const maxA = toRad(maxAngleDeg) * clamp(arcAmt, 0, 1);
  if (maxA === 0) return { z: 0, yaw: 0, pitch: 0, edge: 0 };
  if (axis === 'horizontal') {
    const dx = (cx - vw / 2) / (vw / 2);
    const a = dx * maxA;
    const r = vw / (2 * Math.sin(Math.max(0.001, maxA)));
    const z = -r * (Math.cos(a) - 1);
    return { z, yaw: -(a * 180) / Math.PI, pitch: 0, edge: Math.min(1, Math.abs(dx)) };
  }
  const dy = (cy - vh / 2) / (vh / 2);
  const a = dy * maxA;
  const r = vh / (2 * Math.sin(Math.max(0.001, maxA)));
  const z = -r * (Math.cos(a) - 1);
  return { z, yaw: 0, pitch: a * 180 / Math.PI, edge: Math.min(1, Math.abs(dy)) };
}

/**
 * Create a PhantomInfiniteGallery inside `container`.
 *
 * @param {HTMLElement} container — must have a fixed size (e.g. 100% × 100%)
 * @param {Object} opts
 * @param {Array<{id:string, thumbUrl:string, name:string, kind:string, meta?:string}>} opts.items
 * @param {number}  [opts.cellSize=200]
 * @param {number}  [opts.gap=12]
 * @param {number}  [opts.cellPadding=10]
 * @param {string}  [opts.backgroundColor='#000000']
 * @param {string}  [opts.textColor='#808080']
 * @param {string}  [opts.borderColor='#ffffff']
 * @param {number}  [opts.borderWidth=1]
 * @param {boolean} [opts.borderTop=false] — reference shows only bottom/left/right
 * @param {string}  [opts.hoverColor='rgba(255,85,136,0.55)']
 * @param {number}  [opts.arcAmount=0.6]
 * @param {number}  [opts.arcMaxAngleDeg=28]
 * @param {'horizontal'|'vertical'} [opts.arcAxis='horizontal']
 * @param {number}  [opts.edgeFade=0.25]
 * @param {boolean} [opts.parallaxEnabled=true]
 * @param {number}  [opts.parallaxStrength=0.1]
 * @param {number}  [opts.parallaxEase=0.12]
 * @param {boolean} [opts.inertiaEnabled=true]
 * @param {number}  [opts.throwFriction=0.92]
 * @param {number}  [opts.throwMinSpeed=80]
 * @param {number}  [opts.throwMaxSpeed=2500]
 * @param {number}  [opts.zoomValue=0.7]
 * @param {function} [opts.onItemClick] — callback(item) when a cell is clicked
 * @returns {{ destroy():void, setItems(items):void }}
 */
export function createPhantomGallery(container, opts = {}) {
  const C = Object.assign({
    cellSize: 200, gap: 12, cellPadding: 10,
    backgroundColor: '#000000', textColor: '#808080',
    borderColor: '#ffffff', borderWidth: 1, borderTop: false,
    hoverColor: 'rgba(255,85,136,0.55)',
    arcAmount: 0.6, arcMaxAngleDeg: 28, arcAxis: 'horizontal', edgeFade: 0.25,
    parallaxEnabled: true, parallaxStrength: 0.1, parallaxEase: 0.12,
    inertiaEnabled: true, throwFriction: 0.92, throwMinSpeed: 80, throwMaxSpeed: 2500,
    zoomValue: 0.7,
    onItemClick: null,
  }, opts);

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
  let pressPos = { x: 0, y: 0 };
  let startOff = { x: 0, y: 0 };
  let pressTimer = null;
  let dragOccurred = false; // the pointer actually dragged since pointerdown
  let zoomOccurred = false; // the press-hold zoom fired since pointerdown
  let viewport = { w: 0, h: 0 };

  // ---- DOM setup ----
  // width:100% but NOT height:100% — the caller's stylesheet (or a wrapper) owns
  // the height. Forcing height:100% clobbers .phantom-gallery's fixed height and
  // collapses the container to 0px when the parent has no intrinsic height.
  container.style.cssText = `width:100%;background:${C.backgroundColor};position:relative;overflow:hidden;touch-action:none;cursor:grab;user-select:none;perspective:1000px;transform-style:preserve-3d;`;
  const gridEl = document.createElement('div');
  gridEl.style.cssText = 'position:absolute;width:100%;height:100%;transform-style:preserve-3d;';
  container.appendChild(gridEl);
  // edge-fade vignette
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
  const cellEls = new Map(); // key → DOM element
  const GRID = 20; // 20×20 infinite grid

  function cellKey(x, y) { return `${x},${y}`; }

  function makeCell(x, y) {
    const el = document.createElement('div');
    el.className = 'pgal-cell';
    // sharp cells separated by the border line on the bottom/left/right — the
    // reference renders no top border, so tiles read as a clean grid of "ghost"
    // panes floating on the curved screen.
    const bw = (C.borderWidth * crispBorder()) + 'px';
    const bStyle = `${bw} solid ${C.borderColor}`;
    const bTop = C.borderTop ? `border-top:${bStyle};` : '';
    el.style.cssText = `position:absolute;border:0;${bTop}border-bottom:${bStyle};border-left:${bStyle};border-right:${bStyle};background:rgba(0,0,0,0.1);cursor:pointer;transition:background-color 0.3s ease;display:flex;flex-direction:column;box-sizing:border-box;transform-style:preserve-3d;`;
    el.style.padding = C.cellPadding + 'px';
    // image — ghost treatment: a soft blur + desaturation + inner vignette
    // give each photo the dreamy "ghost" look of the reference demo images
    // (the demo photos are dark, blurred art shots). Hover sharpens it.
    const imgWrap = document.createElement('div');
    const ghost = C.ghostImages !== false
      ? 'filter:blur(0.6px) saturate(0.9) brightness(0.95);box-shadow:inset 0 0 24px rgba(0,0,0,0.5);transition:filter 0.3s ease;'
      : '';
    imgWrap.style.cssText = `flex:1;background-size:cover;background-position:center;margin-bottom:${C.gap}px;border-radius:4px;${ghost}`;
    el.appendChild(imgWrap);
    // caption
    const cap = document.createElement('div');
    cap.style.cssText = `color:${C.textColor};font-size:12px;font-family:'JetBrains Mono',monospace;display:flex;justify-content:space-between;align-items:center;`;
    el.appendChild(cap);
    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = 'font-weight:bold;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    cap.appendChild(titleSpan);
    const metaSpan = document.createElement('span');
    metaSpan.style.cssText = 'flex:none;margin-left:6px;';
    cap.appendChild(metaSpan);

    el.addEventListener('mouseenter', () => {
      el.style.backgroundColor = C.hoverColor;
      if (C.ghostImages !== false) el.children[0].style.filter = 'none';
    });
    el.addEventListener('mouseleave', () => {
      el.style.backgroundColor = 'rgba(0,0,0,0.1)';
      if (C.ghostImages !== false) el.children[0].style.filter = '';
    });
    return el;
  }

  function updateCells() {
    const cellW = cellSize;
    const sx = Math.floor(-off.x / cellW) - 5;
    const sy = Math.floor(-off.y / cellW) - 5;
    const needed = new Set();

    for (let y = sy; y < sy + GRID; y++) {
      for (let x = sx; x < sx + GRID; x++) {
        const k = cellKey(x, y);
        needed.add(k);
        let el = cellEls.get(k);
        if (!el) {
          el = makeCell(x, y);
          gridEl.appendChild(el);
          cellEls.set(k, el);
        }
        // position + 3D transform (positions snapped to device pixels so the
        // white separation lines stay crisp at fractional display scales)
        const left = snapPx(x * cellW + off.x + mouseOff.x + inertia.x);
        const top = snapPx(y * cellW + off.y + mouseOff.y + inertia.y);
        const cx = left + cellW / 2;
        const cy = top + cellW / 2;
        const { z, yaw, pitch, edge } = arcTransform(cx, cy, viewport.w || 1, viewport.h || 1, C.arcAxis, C.arcMaxAngleDeg, C.arcAmount);
        const scale = 1 - C.edgeFade * (edge * edge);
        const opacity = 1 - 0.4 * (edge * C.arcAmount);

        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.width = snapPx(cellW) + 'px';
        el.style.height = snapPx(cellW) + 'px';
        el.style.transform = `translate3d(0,0,${z}px) rotateY(${yaw}deg) rotateX(${pitch}deg) scale(${scale})`;
        el.style.opacity = opacity;

        // content
        const idx = Math.abs((x + y * 3) % (items.length || 1));
        const item = items[idx];
        const imgWrap = el.children[0];
        const cap = el.children[1];
        if (item) {
          el._item = item;
          imgWrap.style.backgroundImage = item.thumbUrl ? `url(${item.thumbUrl})` : '';
          cap.children[0].textContent = item.name || 'Untitled';
          cap.children[1].textContent = item.meta || item.kind || '';
        } else {
          el._item = null;
        }
      }
    }
    // remove offscreen cells
    for (const [k, el] of cellEls) {
      if (!needed.has(k)) { el.remove(); cellEls.delete(k); }
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
    if (C.parallaxEnabled && !dragging) {
      mouseOff.x = lerp(mouseOff.x, targetMouseOff.x, C.parallaxEase);
      mouseOff.y = lerp(mouseOff.y, targetMouseOff.y, C.parallaxEase);
    } else if (!C.parallaxEnabled || dragging) {
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
    pressPos = { x: e.clientX, y: e.clientY };
    startOff = { x: off.x, y: off.y };

    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!dragging && pressing) {
        const rect = container.getBoundingClientRect();
        const pivot = { x: rect.width / 2, y: rect.height / 2 };
        const vis = { x: off.x + inertia.x, y: off.y + inertia.y };
        const newSize = cellSize * C.zoomValue;
        const pinned = pinnedOffset(cellSize, newSize, pivot, vis);
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
      const vx = clamp(dx / dt, -C.throwMaxSpeed, C.throwMaxSpeed);
      const vy = clamp(dy / dt, -C.throwMaxSpeed, C.throwMaxSpeed);
      velocity.x = vx * 0.6 + velocity.x * 0.4;
      velocity.y = vy * 0.6 + velocity.y * 0.4;
      lastMove.x = e.clientX;
      lastMove.y = e.clientY;
      lastMove.t = now;
    }

    // parallax (only when not pressing)
    if (C.parallaxEnabled && !pressing && !dragging && container.getBoundingClientRect) {
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
    // zoom back in
    const rect = container.getBoundingClientRect();
    const pivot = { x: rect.width / 2, y: rect.height / 2 };
    const vis = { x: off.x + inertia.x, y: off.y + inertia.y };
    const pinned = pinnedOffset(cellSize, C.cellSize, pivot, vis);
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
      // clear cached cells so they repopulate
      for (const [, el] of cellEls) el.remove();
      cellEls.clear();
    },
  };
}
