// wormhole.mjs — offline "wormhole" vortex background for the auth screens.
// Ported from wodniack's CodePen "Wormhole" (https://codepen.io/wodniack/pen/XJbYWXx)
// with three changes to fit this app:
//   1. The pen imports easing-utils from the esm.sh CDN — here the easing
//      functions are inlined (zero network, strict-CSP-safe, no eval).
//   2. The pen spawns 20,000 dots (heavy, laggy). Here the count scales with
//      the canvas area and is capped, so it stays smooth at 60fps.
//   3. Recolored from teal-on-black to the vault palette (rose/mauve/gold on
//      the cream ground). The vortex tunnel + swirl physics are unchanged.
//
// API matches particles.mjs so renderer.js can swap them: initWormhole(canvas)
// returns { setActive(on), resize() }.

// --- tune the look here ---
const CFG = {
  totalDiscs: 150,        // perspective rings
  dotDensity: 4200,       // one dot per this many px²
  minDots: 800,           // never fewer than this, even on tiny windows
  maxDots: 9000,          // hard cap — keeps the frame cheap on big screens
  colors: [               // vault palette, in the pen's spirit (deep + light)
    [196, 123, 131],      // --rose-dark
    [169, 138, 160],      // --mauve
    [201, 168, 106],      // --gold
    [138, 154, 123],      // --sage
    [124, 101, 116],      // --mauve-dark
  ],
  ringAlpha: 0.10,        // stroke alpha of the perspective rings
  ringColor: [124, 101, 116], // mauve-dark for the rings
  dotSpeed: 0.001,        // per-frame swirl advance (pen uses 0.001)
  discSpeed: 0.0003,      // ring drift (pen uses 0.0003)
  dotRadius: 1.2,         // base dot radius in CSS px
};

function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
function easeOutExpo(p) { return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p); }
function easeInExpo(p) { return p <= 0 ? 0 : Math.pow(2, 10 * (p - 1)); }
function linear(p) { return p; }

function tweenValue(start, end, p, ease) {
  const delta = end - start;
  const fn =
    ease === 'outCubic' ? easeOutCubic :
    ease === 'outExpo' ? easeOutExpo :
    ease === 'inExpo' ? easeInExpo : linear;
  return start + delta * fn(p);
}

export function initWormhole(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { setActive() {}, resize() {} };

  let w = 0, h = 0, dpi = 1;
  let discs = [], dots = [];
  let active = false;
  let raf = 0;
  let destroyed = false;

  function setCanvasSize() {
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    dpi = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpi);
    canvas.height = Math.round(h * dpi);
  }

  function tweenDisc(disc) {
    const startX = w * 0.5;
    const startY = h * 0;
    const startW = w * 1;
    const startH = h * 1;
    const scaleX = tweenValue(1, 0, disc.p, 'outCubic');
    const scaleY = tweenValue(1, 0, disc.p, 'outExpo');
    disc.sx = scaleX;
    disc.sy = scaleY;
    disc.w = startW * scaleX;
    disc.h = startH * scaleY;
    disc.x = startX;
    disc.y = startY + disc.p * startH * 1;
  }

  function setDiscs() {
    discs = [];
    for (let i = 0; i < CFG.totalDiscs; i++) {
      const disc = { p: i / CFG.totalDiscs, a: 0 };
      tweenDisc(disc);
      discs.push(disc);
    }
  }

  function setDots() {
    dots = [];
    const target = Math.max(CFG.minDots, Math.min(CFG.maxDots, (w * h) / CFG.dotDensity));
    const n = Math.round(target);
    for (let i = 0; i < n; i++) {
      const disc = discs[Math.floor(discs.length * Math.random())];
      const c = CFG.colors[Math.floor(CFG.colors.length * Math.random())];
      dots.push({
        d: disc,
        a: 0,
        c: `rgb(${c[0]}, ${c[1]}, ${c[2]})`,
        p: Math.random(),
        o: Math.random(),
      });
    }
  }

  function setGraphics() {
    setDiscs();
    setDots();
  }

  function drawDiscs() {
    ctx.strokeStyle = `rgba(${CFG.ringColor[0]}, ${CFG.ringColor[1]}, ${CFG.ringColor[2]}, ${CFG.ringAlpha})`;
    ctx.lineWidth = 1;
    for (const disc of discs) {
      ctx.beginPath();
      ctx.globalAlpha = disc.a;
      ctx.ellipse(disc.x, disc.y + disc.h, disc.w, disc.h, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.closePath();
    }
  }

  function drawDots() {
    for (const dot of dots) {
      const { d, p, c, o } = dot;
      const _p = d.sx * d.sy;
      const newA = dot.a + Math.PI * 2 * p;
      const x = d.x + Math.cos(newA) * d.w;
      const y = d.y + Math.sin(newA) * d.h;
      ctx.fillStyle = c;
      ctx.globalAlpha = d.a * o;
      ctx.beginPath();
      ctx.arc(x, y + d.h, CFG.dotRadius + _p * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.closePath();
    }
  }

  function moveDiscs() {
    for (const disc of discs) {
      disc.p = (disc.p + CFG.discSpeed) % 1;
      tweenDisc(disc);
      const p = disc.sx * disc.sy;
      let a = 1;
      if (p < 0.01) {
        a = Math.pow(Math.min(p / 0.01, 1), 3);
      } else if (p > 0.2) {
        a = 1 - Math.min((p - 0.2) / 0.8, 1);
      }
      disc.a = a;
    }
  }

  function moveDots() {
    for (const dot of dots) {
      const v = tweenValue(0, CFG.dotSpeed, 1 - dot.d.sx * dot.d.sy, 'inExpo');
      dot.p = (dot.p + v) % 1;
    }
  }

  function tick() {
    if (!active || destroyed) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpi, dpi);
    moveDiscs();
    moveDots();
    drawDiscs();
    drawDots();
    ctx.restore();
    raf = requestAnimationFrame(tick);
  }

  function setActive(on) {
    if (destroyed) return;
    active = !!on;
    if (active) {
      if (!raf) raf = requestAnimationFrame(tick);
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function resize() {
    setCanvasSize();
    setGraphics();
  }

  setCanvasSize();
  setGraphics();

  return {
    setActive,
    resize,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      active = false;
    },
  };
}
