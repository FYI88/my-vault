// particles.mjs — offline interactive particle background for the auth screens
// (welcome / create / locked / seed). Ported from BACKGROUNDANN's "pure native
// JavaScript canvas" version (no CDN, no dependencies) and recolored to the
// vault palette. Strict-CSP-safe: plain 2D canvas only — no eval, no network.

// --- tune the look here ---
const COLOR_ROSE = [196, 123, 131];   // --rose-dark
const COLOR_MAUVE = [169, 138, 160];  // --mauve
const CFG = {
  particlesPerArea: 16000,  // one particle per this many px²
  minParticles: 32,
  maxParticles: 110,
  linkDistance: 180,        // px — closer particles get a connecting line
  linkOpacity: 0.2,
  grabDistance: 230,        // px — cursor "grab" radius
  grabOpacity: 0.35,
  particleOpacityMin: 0.3,
  particleOpacityMax: 0.55,
  radiusMin: 1,
  radiusMax: 3,
  maxSpeed: 0.6,            // px per frame (~36 px/s at 60 fps)
  pushCount: 4,             // particles added per click
  hardCap: 170,             // click-spam guard
};

export function initParticles(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { setActive() {}, resize() {} };

  const mouse = { x: null, y: null };
  let particles = [];
  let w = 0, h = 0;
  let active = false;
  let raf = 0;

  const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;

  function targetCount() {
    return Math.round(Math.min(CFG.maxParticles, Math.max(CFG.minParticles, (w * h) / CFG.particlesPerArea)));
  }

  function makeParticle(x, y) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * CFG.maxSpeed;
    return {
      x: x ?? Math.random() * w,
      y: y ?? Math.random() * h,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: CFG.radiusMin + Math.random() * (CFG.radiusMax - CFG.radiusMin),
      color: Math.random() < 0.6 ? COLOR_ROSE : COLOR_MAUVE,
      opacity: CFG.particleOpacityMin + Math.random() * (CFG.particleOpacityMax - CFG.particleOpacityMin),
    };
  }

  function seed() {
    particles = Array.from({ length: targetCount() }, () => makeParticle());
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = targetCount();
    if (particles.length > n) particles.length = n;
    while (particles.length < n) particles.push(makeParticle());
    if (active) draw();
  }

  function step() {
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      p.x = Math.max(0, Math.min(w, p.x));
      p.y = Math.max(0, Math.min(h, p.y));
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    // particle ↔ particle links
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > CFG.linkDistance * CFG.linkDistance) continue;
        const t = 1 - Math.sqrt(d2) / CFG.linkDistance;
        ctx.strokeStyle = rgba(COLOR_MAUVE, CFG.linkOpacity * t);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    // cursor "grab" links
    if (mouse.x !== null && mouse.y !== null) {
      for (const p of particles) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > CFG.grabDistance * CFG.grabDistance) continue;
        const t = 1 - Math.sqrt(d2) / CFG.grabDistance;
        ctx.strokeStyle = rgba(COLOR_ROSE, CFG.grabOpacity * t);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.stroke();
      }
    }
    // dots
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(p.color, p.opacity);
      ctx.fill();
    }
  }

  function tick() {
    raf = 0;
    if (!active) return;
    step();
    draw();
    raf = requestAnimationFrame(tick);
  }

  function setActive(on) {
    if (active === on) return;
    active = on;
    if (on) {
      if (!raf) raf = requestAnimationFrame(tick);
    } else {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      ctx.clearRect(0, 0, w, h);
    }
  }

  function onMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }
  function onLeave() {
    mouse.x = null;
    mouse.y = null;
  }
  function onClick(e) {
    if (!active) return;
    if (particles.length >= CFG.hardCap) return;
    const n = Math.min(CFG.pushCount, CFG.hardCap - particles.length);
    for (let i = 0; i < n; i++) particles.push(makeParticle(e.clientX, e.clientY));
  }

  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('mouseleave', onLeave);
  window.addEventListener('click', onClick);
  window.addEventListener('resize', resize);

  resize();
  seed();

  return { setActive, resize };
}
