// journal.mjs — the journal data model, pure and DOM-free so it runs in Node
// (tests) and the renderer identically.
//
// A whole year lives in ONE vault record (kind:'journal'). Its decrypted payload
// is a year blob keyed by local date string "YYYY-MM-DD":
//
//   { v: 1, year: 2026, days: { "2026-08-20": { text, mood, updatedAt } } }
//
// Date keys are LOCAL calendar dates, never instants — an entry written just
// before midnight must stay on the day it was written, and must not drift when
// the machine's timezone changes between sessions.

export const JOURNAL_BLOB_VERSION = 1;

// "YYYY-MM-DD" for a Date, in the machine's local timezone.
export function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey() {
  return dateKey(new Date());
}

// The calendar year a "YYYY-MM-DD" key belongs to (for binning entries into
// their year record).
export function yearKey(key) {
  return parseInt(key.slice(0, 4), 10);
}

export function yearOf(d) {
  return d.getFullYear();
}

export function emptyYear(year) {
  return { v: JOURNAL_BLOB_VERSION, year, days: {} };
}

// Parse a decrypted year blob; tolerate legacy/missing fields by returning a
// usable empty structure instead of throwing.
export function parseYearJSON(json) {
  try {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    const year = o && typeof o.year === 'number' ? o.year : yearOf(new Date());
    const days = o && o.days && typeof o.days === 'object' ? o.days : {};
    return { v: o && o.v ? o.v : JOURNAL_BLOB_VERSION, year, days };
  } catch (e) {
    return emptyYear(yearOf(new Date()));
  }
}

export function serializeYear(blob) {
  return JSON.stringify(blob);
}

// Consecutive filled days ending today or yesterday. A streak only counts days
// that actually have an entry — the day you're currently on can still extend a
// streak from yesterday, so a gap of one unfilled day that ISN'T today/yesterday
// breaks it.
export function calcStreak(dayKeys) {
  const set = new Set(dayKeys);
  if (!set.size) return 0;
  const today = new Date();
  const todayK = dateKey(today);
  // anchor at today; if today has no entry, fall back to yesterday (the streak
  // may still be alive and today just isn't written yet)
  let cursor = today;
  if (!set.has(todayK)) {
    cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (!set.has(dateKey(cursor))) return 0;
  }
  let streak = 0;
  while (set.has(dateKey(cursor))) {
    streak++;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  return streak;
}

// Word count buckets → plant growth stage. 0 = no plant (bare soil).
export function entryWordCount(text) {
  if (!text) return 0;
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

// Growth stage 0..4 for a word count (mapped to sprout → plant → full → bloom).
export function growthStage(wordCount) {
  if (wordCount <= 0) return 0;
  if (wordCount <= 5) return 1;
  if (wordCount <= 20) return 2;
  if (wordCount <= 60) return 3;
  return 4;
}

// The day keys of a year, sorted ascending (for the garden layout and search).
export function sortedDayKeys(blob) {
  return Object.keys(blob.days).sort();
}

// Search a year blob: keys whose entry text (or mood) contains the query.
export function searchYear(blob, query) {
  const q = query.trim().toLowerCase();
  if (!q) return sortedDayKeys(blob);
  const out = [];
  for (const [k, entry] of Object.entries(blob.days)) {
    const text = (entry && entry.text ? entry.text : '').toLowerCase();
    const mood = (entry && entry.mood ? entry.mood : '').toLowerCase();
    if (text.includes(q) || mood.includes(q)) out.push(k);
  }
  return out.sort();
}
