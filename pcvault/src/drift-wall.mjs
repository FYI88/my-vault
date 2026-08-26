// drift-wall.mjs — vanilla JS port of React Bits' DriftWall
// https://reactbits.dev (DriftWall: a wall of tiles that drift past and tilt
// with the pointer)
//
// Faithful to the original component's behaviour, adapted to the vault:
//   - NO React, NO remote images. Tiles use the caller's own `blob:`/data
//     thumbnails; nothing ever hits the network.
//   - NO <a href> navigation. Tiles are focusable buttons that report the item
//     id through onItemClick — opening stays in the vault's own viewer.
//   - Strict-CSP-safe: every style is applied via el.style / class names in the
//     bundled stylesheet, never inline style="" attributes or unsanctioned CSS.
//   - `prefers-reduced-motion` is honoured (drift pauses, parallax + hover lift
//     disabled — behaviour kept, motion removed).
//
// Item shape (shared with the phantom gallery):
//   { id, thumbUrl, title, name, kind, meta }
//   - thumbUrl: image for the tile (blob/data URL)
//   - id:       identifier reported to onItemClick
//   - title:    short display name (already shortened by the caller)
//   - name:     full name — used for hover/aria tooltip only
//
// Options mirror the component's props; see createDriftWall() default.

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Deterministic pseudo-random per-column speed factor ([0,1), flattened to -1..1)
function columnFactor(index, variance) {
  const pseudo = ((index * 0.6180339887 + 0.35) % 1) * 2 - 1;
  return 1 + variance * pseudo;
}

/**
 * Create a DriftWall inside `container`.
 *
 * @param {HTMLElement} container — fixed-size host (the gallery area)
 * @param {Object} opts — see defaults below
 * @returns {{ destroy():void, setItems(items:Array):void, setContainerHeight(h:number):void }}
 */
export function createDriftWall(container, opts = {}) {
  const C = Object.assign({
    columnsMin: 2, // fallback floor when width is unmeasurable; also lower clamp
    columnsMax: 12,
    tileWidth: 200,
    tileHeight: 132,
    gap: 18,
    radius: 14,
    tilt: 16,
    turn: -14,
    roll: 0,
    perspective: 1200,
    depth: 120,
    speed: 42,
    direction: 'up',
    variance: 0.45,
    parallax: 0.6,
    pauseOnHover: false,
    lift: 64,
    fade: 0.6,
    dim: 0.55,
    grayscale: false,
    overlayColor: '#171014', // vault warm near-black, not React Bits' #060010
    onItemClick: null,
    className: '',
  }, opts);

  // ---- state ----
  let items = C.items || [];

  let containerHeight = container.clientHeight || 600;
  let containerWidth = container.clientWidth || 900;
  let activeId = null;         // currently hovered/focused tile "c-offset" id
  let activeCol = -1;
  let wallHovered = false;
  const pointer = { x: 0, y: 0 };        // raw normalized -0.5..0.5
  const pointerDamped = { x: 0, y: 0 };
  const offsets = [];                    // per-column scroll offset
  const velocities = [];                 // per-column eased velocity
  let lastTs = null;
  let raf = 0;
  let reduced = prefersReducedMotion();

  // ---- width-adaptive column count ----
  // The wall's 3D plane is scaled up 1.18× (see applyPlaneTransform) as it recedes
  // into perspective, so more of the container's width is covered than its flat
  // extents suggest. Fit columns to the real covered width: a column is one tile
  // wide plus a gap, and the plane covers roughly width/1.18. Clamp to sane bounds
  // so a few tiles or a thin window never produce a degenerate 1-col wall, and a
  // huge window never spawns dozens of DOM-heavy columns.
  const PLANE_SCALE = 1.18;
  function columnsForWidth(width) {
    const unit = C.tileWidth + C.gap;
    let n = Math.floor((width / PLANE_SCALE) / unit);
    n = Math.max(C.columnsMin, Math.min(C.columnsMax, n));
    return n;
  }
  let cols = columnItems(columnsForWidth(containerWidth));

  // Resolve a column's current tiles. If a column ends up empty we fill it with
  // the head of the list so it never collapses (mirrors the component's guard).
  function columnItems(count) {
    const cols = Array.from({ length: count }, () => []);
    items.forEach((item, i) => cols[i % count].push(item));
    return cols.map((col) => (col.length ? col : items.slice(0, 1)));
  }

  function buildColumnMeta(colsArr) {
    const unit = C.tileHeight + C.gap;
    return colsArr.map((col) => {
      const copyHeight = Math.max(unit, col.length * unit);
      const copies = Math.max(2, Math.ceil((containerHeight * 1.6) / copyHeight) + 1);
      return { copyHeight, copies };
    });
  }
  let colMeta = buildColumnMeta(cols);
  let colEls = []; // per-column track elements

  const baseVelocities = () => {
    const dirSign = C.direction === 'up' ? 1 : -1;
    return cols.map((_, c) => {
      const altSign = c % 2 === 0 ? 1 : -1;
      return C.speed * columnFactor(c, C.variance) * dirSign * altSign;
    });
  };
  let baseVels = baseVelocities();

  // ---- DOM ----
  container.classList.add('drift-wall');
  if (C.className) container.classList.add(C.className);
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'drifting wall of tiles');
  // Only set what the stylesheet can't provide; let CSS classes (.phantom-gallery,
  // .gallery-mode .phantom-gallery) control height/width so the wall fills the
  // viewport correctly. Hardcoding height:100% would collapse the container when
  // the parent has no explicit height.
  // The host owns its position: .phantom-gallery is `relative` by default and
  // flips to `fixed` full-bleed in gallery-mode — never force it inline (inline
  // beats the stylesheet).
  container.style.removeProperty('position');
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  container.style.overflow = 'hidden';
  container.style.perspective = `${C.perspective}px`;
  container.style.perspectiveOrigin = '50% 50%';

  const plane = document.createElement('div');
  plane.className = 'drift-wall__plane';
  plane.style.cssText = 'position:absolute;top:50%;left:50%;display:flex;flex-direction:row;transform-style:preserve-3d;cursor:pointer;transform-origin:50% 50%;will-change:transform;';
  container.appendChild(plane);

  function applyPlaneTransform(px, py) {
    plane.style.transform =
      `translate(-50%, -50%) scale(1.18) ` +
      `rotateX(${C.tilt + py}deg) rotateY(${C.turn + px}deg) rotateZ(${C.roll}deg) ` +
      `translateZ(${-C.depth}px)`;
  }
  applyPlaneTransform(0, 0);

  // CSS variables the stylesheet reads (kept in sync with props)
  function applyCssVars() {
    const s = container.style;
    s.setProperty('--dw-tile-w', `${C.tileWidth}px`);
    s.setProperty('--dw-tile-h', `${C.tileHeight}px`);
    s.setProperty('--dw-gap', `${C.gap}px`);
    s.setProperty('--dw-radius', `${C.radius}px`);
    s.setProperty('--dw-perspective', `${C.perspective}px`);
    s.setProperty('--dw-lift', `${C.lift}px`);
    s.setProperty('--dw-dim', String(C.dim));
    s.setProperty('--dw-gray', C.grayscale ? '1' : '0');
    s.setProperty('--dw-overlay', C.overlayColor);
    s.setProperty('--dw-edge', `${Math.max(0, (1 - C.fade) * 100)}%`);
  }
  applyCssVars();

  function makeTile(item, id, colIndex) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'drift-wall__tile' + (activeId === id ? ' is-active' : '');
    tile.dataset.tileId = id;
    tile.dataset.col = String(colIndex);
    tile.setAttribute('aria-label', item.title || item.name || 'tile');
    tile.title = item.name || item.title || '';

    const inner = document.createElement('span');
    inner.className = 'drift-wall__inner';
    const img = document.createElement('img');
    img.src = item.thumbUrl || '';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    const overlay = document.createElement('span');
    overlay.className = 'drift-wall__overlay';
    overlay.setAttribute('aria-hidden', 'true');
    inner.appendChild(img);
    inner.appendChild(overlay);
    tile.appendChild(inner);

    tile.addEventListener('focus', () => activate(id));
    tile.addEventListener('blur', () => release());
    tile.addEventListener('click', () => { if (C.onItemClick && item.id != null) C.onItemClick(item.id); });
    return tile;
  }

  function buildColumns() {
    plane.textContent = '';
    colEls = [];
    for (let c = 0; c < cols.length; c++) {
      const meta = colMeta[c];
      const colEl = document.createElement('div');
      colEl.className = 'drift-wall__col';
      colEl.style.cssText = `position:relative;width:calc(var(--dw-tile-w) + var(--dw-gap));transform-style:preserve-3d;`;
      const track = document.createElement('div');
      track.className = 'drift-wall__track';
      track.style.cssText = 'display:flex;flex-direction:column;will-change:transform;transform-style:preserve-3d;';
      for (let cp = 0; cp < meta.copies; cp++) {
        for (let ii = 0; ii < cols[c].length; ii++) {
          const item = cols[c][ii];
          const id = `${c}-${cp}-${ii}`;
          const tile = makeTile(item, id, c);
          track.appendChild(tile);
        }
      }
      colEl.appendChild(track);
      plane.appendChild(colEl);
      colEls.push(track);
    }
  }
  function destroyColumns() {
    plane.textContent = '';
    colEls = [];
  }

  // Regenerate columns + metadata for a freshly measured width/height. Used by
  // the resize observer and by setItems so both stay in sync with the layout.
  function rebuildForLayout() {
    cols = columnItems(columnsForWidth(containerWidth));
    colMeta = buildColumnMeta(cols);
    destroyColumns();
    buildColumns();
    resetOffsets();
    baseVels = baseVelocities();
  }

  // ---- reflow on container size ----
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width || containerWidth;
      const h = entry.contentRect.height || containerHeight;
      const wChanged = Math.abs(w - containerWidth) > 1;
      const hChanged = Math.abs(h - containerHeight) > 1;
      if (!wChanged && !hChanged) return;
      containerWidth = w;
      containerHeight = h;
      rebuildForLayout();
    });
    ro.observe(container);
  }

  function resetOffsets() {
    colMeta.forEach((meta, c) => {
      offsets[c] = meta.copyHeight * ((c * 0.37) % 1);
      velocities[c] = 0;
    });
  }
  resetOffsets();

  // ---- animation loop ----
  function animate(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(0.05, Math.max(0, ts - lastTs) / 1000);
    lastTs = ts;

    // pointer parallax (damped), unless reduced motion
    const maxTilt = C.parallax * 8;
    const targetX = reduced ? 0 : pointer.x * maxTilt;
    const targetY = reduced ? 0 : -pointer.y * maxTilt;
    const damp = 1 - Math.exp(-dt / 0.12);
    pointerDamped.x += (targetX - pointerDamped.x) * damp;
    pointerDamped.y += (targetY - pointerDamped.y) * damp;
    applyPlaneTransform(pointerDamped.x, pointerDamped.y);

    for (let c = 0; c < colEls.length; c++) {
      const meta = colMeta[c];
      const el = colEls[c];
      if (!meta || !el) continue;
      if (!reduced) {
        const paused = wallHovered && C.pauseOnHover;
        const factor = paused || activeCol === c ? 0 : 1;
        const target = baseVels[c] * factor;
        const ease = 1 - Math.exp(-dt / (target === 0 ? 0.16 : 0.28));
        velocities[c] += (target - velocities[c]) * ease;
        let next = (offsets[c] ?? 0) + velocities[c] * dt;
        next = ((next % meta.copyHeight) + meta.copyHeight) % meta.copyHeight;
        offsets[c] = next;
        el.style.transform = `translate3d(0, ${-next}px, 0)`;
      } else {
        el.style.transform = `translate3d(0, ${-(offsets[c] ?? 0)}px, 0)`;
      }
    }
    raf = requestAnimationFrame(animate);
  }

  // ---- hover / focus ----
  function setActive(id, col) {
    activeId = id;
    activeCol = col;
    markActive();
  }
  function activate(id) {
    // figure out which column from the stored dataset (set at build time)
    const el = plane.querySelector(`[data-tile-id="${CSS.escape(String(id))}"]`);
    const col = el ? Number(el.dataset.col) : activeCol;
    setActive(id, col);
  }
  function release() {
    activeId = null;
    activeCol = -1;
    markActive();
  }
  function markActive() {
    plane.querySelectorAll('.drift-wall__tile').forEach((t) => {
      t.classList.toggle('is-active', t.dataset.tileId === String(activeId));
    });
  }

  function onPointerMove(e) {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (C.parallax > 0 && !reduced) {
      pointer.x = (e.clientX - rect.left) / rect.width - 0.5;
      pointer.y = (e.clientY - rect.top) / rect.height - 0.5;
    }
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const tile = hit && hit.closest ? hit.closest('[data-tile-id]') : null;
    if (!tile) return;
    const id = tile.dataset.tileId;
    if (id === String(activeId)) return;
    setActive(id, Number(tile.dataset.col));
  }
  function onPointerEnter() { wallHovered = true; }
  function onPointerLeaveWall() {
    wallHovered = false;
    pointer.x = 0; pointer.y = 0;
    release();
  }

  container.addEventListener('pointerenter', onPointerEnter);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerleave', onPointerLeaveWall);

  // reduced-motion listener
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  function onMqChange(e) {
    reduced = e.matches;
    // snap parallax to rest when reduced becomes active
    if (reduced) { pointer.x = 0; pointer.y = 0; pointerDamped.x = 0; pointerDamped.y = 0; applyPlaneTransform(0, 0); }
  }
  if (mq.addEventListener) mq.addEventListener('change', onMqChange);
  else if (mq.addListener) mq.addListener(onMqChange);

  // ---- start ----
  buildColumns();
  resetOffsets();
  baseVels = baseVelocities();
  raf = requestAnimationFrame(animate);

  // ---- public API ----
  return {
    destroy() {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      if (mq.removeEventListener) mq.removeEventListener('change', onMqChange);
      else if (mq.removeListener) mq.removeListener(onMqChange);
      container.removeEventListener('pointerenter', onPointerEnter);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeaveWall);
      container.classList.remove('drift-wall');
      if (C.className) container.classList.remove(C.className);
      container.removeAttribute('role');
      container.removeAttribute('aria-label');
      container.style.cssText = '';
      container.textContent = '';
    },
    setItems(newItems) {
      items = newItems || [];
      rebuildForLayout();
    },
    setContainerHeight(h) {
      containerHeight = h || 600;
      colMeta = buildColumnMeta(cols);
      buildColumns();
    },
    setContainerWidth(w) {
      containerWidth = w || 900;
      rebuildForLayout();
    },
  };
}
