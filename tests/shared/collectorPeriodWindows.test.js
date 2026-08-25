'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { computePeriodWindows, collectUsageOnce } = require('../../src/shared/collector');

// endsAt is computed in the device's local time and serialized to UTC, so the
// hub can expire a stale today/week/month snapshot with a plain nowMs < endsAt check.
// Assertions read back the local components so they hold regardless of the test
// runner's timezone.
test('computePeriodWindows returns next local midnight, Monday, and month start', () => {
  const now = new Date(2026, 5, 27, 14, 30, 0); // local 2026-06-27 14:30, a Saturday
  const windows = computePeriodWindows(now);

  assert.equal(windows.today.key, '2026-06-27');
  // The week is keyed by its own Monday, not by the day the snapshot was taken.
  assert.equal(windows.week.key, '2026-06-22');
  assert.equal(windows.month.key, '2026-06');

  const todayEnd = new Date(windows.today.endsAt);
  assert.equal(todayEnd.getFullYear(), 2026);
  assert.equal(todayEnd.getMonth(), 5); // still June (boundary is June 28 00:00 local)
  assert.equal(todayEnd.getDate(), 28);
  assert.equal(todayEnd.getHours(), 0);
  assert.equal(todayEnd.getMinutes(), 0);

  const weekEnd = new Date(windows.week.endsAt);
  assert.equal(weekEnd.getFullYear(), 2026);
  assert.equal(weekEnd.getMonth(), 5);
  assert.equal(weekEnd.getDate(), 29); // next Monday 00:00 local
  assert.equal(weekEnd.getDay(), 1);
  assert.equal(weekEnd.getHours(), 0);

  const monthEnd = new Date(windows.month.endsAt);
  assert.equal(monthEnd.getMonth(), 6); // July
  assert.equal(monthEnd.getDate(), 1);
  assert.equal(monthEnd.getHours(), 0);
});

test('computePeriodWindows wraps the month and week boundaries at year end', () => {
  const windows = computePeriodWindows(new Date(2026, 11, 31, 23, 0, 0)); // local 2026-12-31 23:00, a Thursday
  assert.equal(windows.today.key, '2026-12-31');
  // A week that straddles New Year keeps its own Monday as the key, so the two
  // halves of that week stay one window instead of splitting on the year.
  assert.equal(windows.week.key, '2026-12-28');
  assert.equal(windows.month.key, '2026-12');

  const weekEnd = new Date(windows.week.endsAt);
  assert.equal(weekEnd.getFullYear(), 2027);
  assert.equal(weekEnd.getMonth(), 0);
  assert.equal(weekEnd.getDate(), 4); // Monday 2027-01-04
  assert.equal(weekEnd.getDay(), 1);

  const todayEnd = new Date(windows.today.endsAt);
  assert.equal(todayEnd.getFullYear(), 2027);
  assert.equal(todayEnd.getMonth(), 0); // January
  assert.equal(todayEnd.getDate(), 1);

  const monthEnd = new Date(windows.month.endsAt);
  assert.equal(monthEnd.getFullYear(), 2027);
  assert.equal(monthEnd.getMonth(), 0);
  assert.equal(monthEnd.getDate(), 1);
});

// A single snapshot must carry a single timestamp: updatedAt and periodWindows
// have to come from the same instant, captured before the today scan, so a
// collection that straddles local midnight cannot stamp a today scan from day N
// with a window that ends on day N+1 (issue #37 follow-up).
test('collectUsageOnce stamps updatedAt and periodWindows from one injected clock', async () => {
  const now = new Date(2026, 0, 15, 12, 0, 0); // local 2026-01-15 12:00
  const summary = await collectUsageOnce({
    clients: '',
    deviceId: 'device-a',
    now,
    historyEnabled: false,
    limitsEnabled: false
  });
  assert.equal(summary.updatedAt, now.toISOString());
  assert.deepEqual(summary.periodWindows, computePeriodWindows(now));
});

// tokscale's own --week is a rolling last-7-days window, which would not match the
// calendar week the snapshot is stamped with. The scan has to name the window
// explicitly, or `week` means one thing in periodWindows and another in the data.
test('the week scan asks tokscale for this week Monday, never --week', async () => {
  const now = new Date(2026, 5, 27, 14, 30, 0); // Saturday 2026-06-27
  const calls = [];
  await collectUsageOnce({
    clients: 'claude',
    deviceId: 'device-a',
    now,
    historyEnabled: false,
    limitsEnabled: false,
    wslScanEnabled: false,
    runTokscale: async ({ flags }) => { calls.push(flags); return { entries: [] }; }
  });
  assert.equal(calls.some((flags) => flags.includes('--week')), false);
  const weekCall = calls.find((flags) => flags.includes('--since') && flags[flags.indexOf('--since') + 1] !== '2024-01-01');
  assert.deepEqual(weekCall, ['--since', '2026-06-22']);
});
