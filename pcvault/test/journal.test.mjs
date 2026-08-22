// journal.test.mjs — the journal data model must round-trip losslessly, keep
// local calendar dates stable, compute streaks correctly, and bucket entries
// into plant-growth stages.
import assert from 'node:assert/strict';
import {
  dateKey, todayKey, yearKey, yearOf, emptyYear, parseYearJSON, serializeYear,
  calcStreak, entryWordCount, growthStage, sortedDayKeys, searchYear,
  yearGrid, isLeapYear, pickDoodle, DOODLE_VARIANTS, monthCells, exportYearMarkdown,
} from '../src/journal.mjs';

let passTests = 0, failTests = 0;
async function t(name, fn) {
  passTests++;
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failTests++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

await t('year blob round-trips losslessly', () => {
  const blob = {
    v: 1, year: 2026,
    days: {
      '2026-08-20': { text: 'walked by the river', mood: '🌿', updatedAt: 1724000000000 },
      '2026-08-21': { text: 'quiet day', mood: '', updatedAt: 1724086400000 },
    },
  };
  const json = serializeYear(blob);
  const parsed = parseYearJSON(json);
  assert.deepEqual(parsed, blob);
});

await t('parseYearJSON tolerates missing days/v and returns a usable empty blob', () => {
  const parsed = parseYearJSON('{}');
  assert.equal(typeof parsed.year, 'number');
  assert.deepEqual(parsed.days, {});
  assert.equal(parsed.v, 1);
});

await t('parseYearJSON rejects garbage JSON safely', () => {
  const parsed = parseYearJSON('{not json');
  assert.equal(typeof parsed.year, 'number');
  assert.deepEqual(parsed.days, {});
});

await t('dateKey is a zero-padded local calendar date', () => {
  assert.equal(dateKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(dateKey(new Date(2026, 7, 20)), '2026-08-20');
  assert.equal(dateKey(new Date(2026, 11, 31)), '2026-12-31');
});

await t('yearKey extracts the calendar year from a day key', () => {
  assert.equal(yearKey('2026-08-20'), 2026);
  assert.equal(yearKey('2025-12-31'), 2025);
});

await t('emptyYear returns an empty blob for a given year', () => {
  const b = emptyYear(2026);
  assert.equal(b.year, 2026);
  assert.deepEqual(b.days, {});
});

await t('streak counts consecutive filled days ending today', () => {
  const today = todayKey();
  const d = new Date();
  const keys = [];
  for (let i = 0; i < 3; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
    keys.push(dateKey(day));
  }
  assert.equal(calcStreak(keys), 3);
});

await t('streak survives a missing today if yesterday is filled (today not yet written)', () => {
  const d = new Date();
  const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  const dayBefore = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 2);
  assert.equal(calcStreak([dateKey(yesterday), dateKey(dayBefore)]), 2);
});

await t('a gap in the middle breaks the streak', () => {
  const d = new Date();
  const k = (n) => dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));
  // today, yesterday, day-before, then a gap, then day-before-that
  const keys = [k(0), k(1), k(2), k(4)];
  assert.equal(calcStreak(keys), 3);
});

await t('empty year → streak 0', () => {
  assert.equal(calcStreak([]), 0);
});

await t('entryWordCount trims whitespace and counts words', () => {
  assert.equal(entryWordCount(''), 0);
  assert.equal(entryWordCount('   '), 0);
  assert.equal(entryWordCount('hello world'), 2);
  assert.equal(entryWordCount(' one two three four '), 4);
});

await t('growthStage buckets word counts into plant stages', () => {
  assert.equal(growthStage(0), 0);
  assert.equal(growthStage(1), 1);
  assert.equal(growthStage(5), 1);
  assert.equal(growthStage(6), 2);
  assert.equal(growthStage(20), 2);
  assert.equal(growthStage(21), 3);
  assert.equal(growthStage(60), 3);
  assert.equal(growthStage(61), 4);
});

await t('sortedDayKeys returns keys ascending', () => {
  const blob = { year: 2026, days: { '2026-03-01': {}, '2026-01-01': {}, '2026-02-01': {} } };
  assert.deepEqual(sortedDayKeys(blob), ['2026-01-01', '2026-02-01', '2026-03-01']);
});

await t('searchYear matches entry text case-insensitively', () => {
  const blob = {
    year: 2026,
    days: {
      '2026-01-01': { text: 'RIVER walk', mood: '' },
      '2026-01-02': { text: 'quiet', mood: '🌿' },
    },
  };
  assert.deepEqual(searchYear(blob, 'river'), ['2026-01-01']);
  assert.deepEqual(searchYear(blob, '🌿'), ['2026-01-02']);
  assert.deepEqual(searchYear(blob, ''), ['2026-01-01', '2026-01-02']);
  assert.deepEqual(searchYear(blob, 'zzz'), []);
});

await t('yearGrid covers every day of a common year ascending', () => {
  const g = yearGrid(2026); // not a leap year
  assert.equal(g.length, 365);
  assert.equal(g[0].key, '2026-01-01');
  assert.equal(g[364].key, '2026-12-31');
  assert.equal(g[0].col, 0);
  assert.equal(g[0].row, 0);
  assert.equal(g[7].row, 1); // a new week
  assert.equal(g[364].col, 364 % 7);
});

await t('yearGrid covers 366 days in a leap year', () => {
  assert.equal(yearGrid(2024).length, 366);
  assert.equal(yearGrid(2024)[365].key, '2024-12-31');
});

await t('yearGrid flags month starts', () => {
  const g = yearGrid(2026);
  const starts = g.filter((c) => c.monthStart).map((c) => c.key);
  assert.deepEqual(starts, [
    '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01',
    '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01',
  ]);
});

await t('yearGrid honors a custom column count', () => {
  const g = yearGrid(2026, 10);
  assert.equal(g[0].col, 0);
  assert.equal(g[9].col, 9);
  assert.equal(g[10].col, 0);
  assert.equal(g[10].row, 1);
});

await t('isLeapYear handles the century rule', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(2000), true); // divisible by 400
  assert.equal(isLeapYear(1900), false); // divisible by 100 but not 400
});

await t('pickDoodle is deterministic and within the stage variant range', () => {
  for (const stage of [1, 2, 3, 4]) {
    const n = DOODLE_VARIANTS[stage];
    for (const seed of ['2026-01-01', '2026-06-15', '2026-12-31']) {
      for (const mood of ['', '🌸', '❤️']) {
        const a = pickDoodle(stage, mood, seed);
        const b = pickDoodle(stage, mood, seed);
        assert.ok(a >= 0 && a < n, `variant ${a} out of range for stage ${stage}`);
        assert.equal(a, b, 'same inputs must pick the same doodle');
      }
    }
  }
});

await t('pickDoodle varies with mood and seed', () => {
  // not guaranteed for every input, but these specific ones must differ
  const a = pickDoodle(4, '🌸', '2026-03-14');
  const b = pickDoodle(4, '❤️', '2026-03-14');
  const c = pickDoodle(4, '🌸', '2026-03-15');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

await t('monthCells pads leading weekdays and keeps 7 per row', () => {
  // August 2026 starts on a Saturday (2026-08-01 is a Saturday)
  const weeks = monthCells(2026, 7);
  assert.equal(new Date(2026, 7, 1).getDay(), 6); // sanity: Sat
  assert.equal(weeks[0].length, 7);
  assert.equal(weeks[0][0].day, null); // Sun
  assert.equal(weeks[0][6].day, 1);    // Sat = Aug 1
  const flat = weeks.flat().filter((c) => c.day !== null);
  assert.equal(flat.length, 31);
  assert.equal(flat[0].key, '2026-08-01');
  assert.equal(flat[30].key, '2026-08-31');
});

await t('monthCells pads the trailing week of a short month', () => {
  // February 2026 has 28 days and starts on a Sunday
  const weeks = monthCells(2026, 1);
  assert.equal(new Date(2026, 1, 1).getDay(), 0); // Sun
  assert.equal(weeks[0][0].day, 1);
  const flat = weeks.flat().filter((c) => c.day !== null);
  assert.equal(flat.length, 28);
  assert.equal(weeks[weeks.length - 1].length, 7);
});

await t('exportYearMarkdown renders a readable year document', () => {
  const blob = {
    v: 1, year: 2026,
    days: {
      '2026-08-21': { text: 'quiet day', mood: '🌱', updatedAt: 1 },
      '2026-08-20': { text: 'walked by the river\n\nlong walk.', mood: '', updatedAt: 2 },
    },
  };
  const md = exportYearMarkdown(blob, (k) => k);
  assert.ok(md.startsWith('# 2026\n'));
  assert.ok(md.includes('## 2026-08-20'));
  assert.ok(md.includes('## 2026-08-21'));
  assert.ok(md.indexOf('2026-08-20') < md.indexOf('2026-08-21')); // ascending
  assert.ok(md.includes('_mood 🌱_'));
  assert.ok(md.includes('walked by the river'));
});

await t('exportYearMarkdown handles an empty year', () => {
  assert.equal(exportYearMarkdown(emptyYear(2026)), '# 2026\n');
});

console.log(`\n${passTests - failTests}/${passTests} passed`);
process.exit(failTests ? 1 : 0);
