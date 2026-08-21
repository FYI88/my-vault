// journal.test.mjs — the journal data model must round-trip losslessly, keep
// local calendar dates stable, compute streaks correctly, and bucket entries
// into plant-growth stages.
import assert from 'node:assert/strict';
import {
  dateKey, todayKey, yearKey, yearOf, emptyYear, parseYearJSON, serializeYear,
  calcStreak, entryWordCount, growthStage, sortedDayKeys, searchYear,
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

console.log(`\n${passTests - failTests}/${passTests} passed`);
process.exit(failTests ? 1 : 0);
