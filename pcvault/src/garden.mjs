// garden.mjs — the journal's "living garden" renderer. A pure 2D canvas, no
// image assets, no network, no eval — strict-CSP-safe like particles.mjs.
//
// The garden is laid out as weeks: 7 plots per row, days flowing in month
// order. Each plot is one calendar day; writing an entry grows a plant there:
//
//   stage 0  empty day      → a bare soil mound
//   stage 1  sprout         → a short stem + two seed-leaves
//   stage 2  young plant    → taller stem + several leaves
//   stage 3  full plant     → branching leaves, leafy crown
//   stage 4  flowering      → a bloom on top (rose/mauve by mood) or a bud
//
// A mood emoji gives the plant a flower; no mood at full growth = a closed bud.
// The palette mirrors styles.css (cream soil, sage stems/leaves, rose/mauve
// blooms, gold centers).

import { growthStage, dateKey, yearOf, entryWordCount } from './journal.mjs';

// vault palette
const SOIL = '#e9dcd8';          // --border (tilled cream earth)
const SOIL_DARK = '#d6c4bd';     // deeper soil for month starts / empty-day rim
const STEM = '#6f7a5c';          // --sage-dark
const LEAF = '#a3ad8f';          // --sage
const LEAF_DARK = '#7a8a68';     // between sage and sage-dark
const BLOOM_ROSE = '#c47b83';    // --rose-dark
const BLOOM_MAUVE = '#a98aa0';   // --mauve
const BLOOM_GOLD = '#e7c86b';    // --gold
const TODAY = '#c47b83';         // today ring
const MATCH = '#e7c86b';         // search-match glow

const PLOTS_PER_ROW = 7; // a week
const GAP = 8;

export function createGarden(canvas, opts) {
  const ctx = canvas.getContext('2d');
  const cfg = {
    todayKey: opts?.todayKey || dateKey(new Date()),
    onDayClick: opts?.onDayClick || null,
    minPlot: 34,
    maxPlot: 56,
  };

  let blob = null;          // the decrypted year blob
  let query = '';           // search filter (lowercased)
  let matches = null;       // Set of day keys matching the query
  let plotSize = cfg.minPlot;
  let layout = null;        // { key, col, row, x, y, dayOfYear }[] — recomputed on resize
  let raf = 0;

  function monthStartKeys(year) {
    const out = new Set();
    for (let m = 0; m < 12; m++) {
      out.add(dateKey(new Date(year, m, 1)));
    }
    return out;
  }

  function computeLayout() {
    if (!blob) { layout = []; return; }
    const year = blob.year;
    const daysInYear = isLeap(year) ? 366 : 365;
    const monthStarts = monthStartKeys(year);
    const arr = [];
    for (let doy = 0; doy < daysInYear; doy++) {
      const d = new Date(year, 0, doy + 1);
      const key = dateKey(d);
      const col = doy % PLOTS_PER_ROW;
      const row = Math.floor(doy / PLOTS_PER_ROW);
      arr.push({
        key, col, row,
        x: col * (plotSize + GAP),
        y: row * (plotSize + GAP),
        monthStart: monthStarts.has(key),
      });
    }
    layout = arr;
  }

  function isLeap(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const containerW = canvas.clientWidth || 640;
    plotSize = Math.max(
      cfg.minPlot,
      Math.min(cfg.maxPlot, Math.floor((containerW - GAP * (PLOTS_PER_ROW - 1)) / PLOTS_PER_ROW))
    );
    computeLayout();
    const rows = layout.length ? layout[layout.length - 1].row + 1 : 1;
    const w = PLOTS_PER_ROW * (plotSize + GAP) - GAP;
    const h = rows * (plotSize + GAP) - GAP;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  // ---- plant drawing ----
  function drawSoil(x, y, s, monthStart) {
    const r = s * 0.42;
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, r);
    ctx.fillStyle = SOIL;
    ctx.fill();
    if (monthStart) {
      ctx.strokeStyle = SOIL_DARK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.08);
      ctx.lineTo(x + s * 0.5, y + s * 0.92);
      ctx.stroke();
    } else {
      // a faint rim so bare plots still read as "a plot waiting"
      ctx.strokeStyle = SOIL_DARK;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function leaf(cx, baseY, s, angle, len, color) {
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(len * 0.5, 0, len * 0.5, len * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawPlant(cx, baseY, s, stage, mood) {
    const top = s * 0.16; // soil margin at plot top
    const bottom = baseY + s * 0.42; // where the stem meets the soil
    const stemLen = (0.28 + stage * 0.16) * s;
    const topY = bottom - stemLen;
    ctx.strokeStyle = STEM;
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, bottom);
    ctx.lineTo(cx, topY);
    ctx.stroke();

    // leaves along the stem — more + wider as the plant grows
    const leafCount = stage <= 1 ? 2 : stage * 2;
    for (let i = 0; i < leafCount; i++) {
      const t = 0.3 + (i / Math.max(1, leafCount - 1)) * 0.7;
      const ly = bottom - stemLen * t;
      const len = (0.22 + stage * 0.1) * s;
      leaf(cx, ly, s, i % 2 === 0 ? -0.9 : Math.PI + 0.9, len, i % 2 === 0 ? LEAF : LEAF_DARK);
    }

    // crown: a bud (no mood) or a bloom (mood)
    if (stage >= 4) {
      if (mood) {
        const color = hashMood(mood) ? BLOOM_ROSE : BLOOM_MAUVE;
        const pr = s * 0.14;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * pr * 0.72, topY + Math.sin(a) * pr * 0.72, pr * 0.55, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(cx, topY, pr * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = BLOOM_GOLD;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.ellipse(cx, topY - s * 0.06, s * 0.1, s * 0.14, 0, 0, Math.PI * 2);
        ctx.fillStyle = BLOOM_MAUVE;
        ctx.fill();
      }
    } else if (stage === 0) {
      // nothing above the soil
    }
  }

  function hashMood(mood) {
    let h = 0;
    for (let i = 0; i < mood.length; i++) h = (h * 31 + mood.charCodeAt(i)) | 0;
    return (h & 1) === 0;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.clientWidth || 640, canvas.clientHeight || 640);
    if (!blob || !layout.length) return;
    const searching = !!query;
    for (const p of layout) {
      const entry = blob.days[p.key];
      const dim = searching && matches && !matches.has(p.key);
      ctx.save();
      if (dim) ctx.globalAlpha = 0.28;
      drawSoil(p.x, p.y, plotSize, p.monthStart);
      if (entry) {
        const stage = growthStage(entryWordCount(entry.text));
        if (stage > 0) {
          drawPlant(p.x + plotSize / 2, p.y + plotSize * 0.55, plotSize, stage, entry.mood);
        }
      }
      // today ring
      if (p.key === cfg.todayKey) {
        ctx.strokeStyle = TODAY;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(p.x + 1, p.y + 1, plotSize - 2, plotSize - 2, plotSize * 0.42);
        ctx.stroke();
      } else if (searching && matches && matches.has(p.key)) {
        ctx.strokeStyle = MATCH;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(p.x + 1, p.y + 1, plotSize - 2, plotSize - 2, plotSize * 0.42);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function dayAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const col = Math.floor(x / (plotSize + GAP));
    const row = Math.floor(y / (plotSize + GAP));
    const hit = layout.find((p) => p.col === col && p.row === row);
    return hit ? hit.key : null;
  }

  function onClick(e) {
    if (!cfg.onDayClick || !blob) return;
    const key = dayAt(e.clientX, e.clientY);
    if (key) cfg.onDayClick(key);
  }

  function setYear(next) {
    blob = next;
    query = '';
    matches = null;
    computeLayout();
    if (canvas.clientWidth) resize(); else scheduleDraw();
  }

  function setQuery(q) {
    query = (q || '').trim().toLowerCase();
    if (query && blob) {
      const set = new Set();
      for (const [k, e] of Object.entries(blob.days)) {
        const text = (e && e.text ? e.text : '').toLowerCase();
        const mood = (e && e.mood ? e.mood : '').toLowerCase();
        if (text.includes(query) || mood.includes(query)) set.add(k);
      }
      matches = set;
    } else {
      matches = null;
    }
    draw();
  }

  function scheduleDraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; resize(); });
  }

  canvas.addEventListener('click', onClick);
  window.addEventListener('resize', scheduleDraw);

  return {
    setYear,
    setQuery,
    resize,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', scheduleDraw);
      canvas.removeEventListener('click', onClick);
      blob = null;
      matches = null;
    },
  };
}
