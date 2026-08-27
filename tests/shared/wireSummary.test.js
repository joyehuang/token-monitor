'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { MAX_WIRE_SESSIONS_PER_PERIOD, summaryForWire, trimPeriodSessions } = require('../../src/shared/usage');

function periodWithSessions(count, { start = 0 } = {}) {
  const sessions = {};
  for (let i = start; i < start + count; i += 1) {
    sessions[`claude:s-${i}`] = {
      client: 'claude',
      sessionId: `s-${i}`,
      totalTokens: 100,
      lastUsedAt: new Date(Date.UTC(2026, 0, 1) + i * 60 * 1000).toISOString()
    };
  }
  return { totalTokens: count * 100, costUsd: 1.5, clients: { claude: count * 100 }, sessions };
}

test('trimPeriodSessions leaves a period under the cap untouched', () => {
  const period = periodWithSessions(5);
  assert.equal(trimPeriodSessions(period, 10), period);
});

test('trimPeriodSessions keeps the most recently used sessions and leaves totals alone', () => {
  const period = periodWithSessions(50);
  const trimmed = trimPeriodSessions(period, 10);
  assert.equal(Object.keys(trimmed.sessions).length, 10);
  assert.ok(trimmed.sessions['claude:s-49'], 'newest session must survive');
  assert.ok(!trimmed.sessions['claude:s-0'], 'oldest session must be dropped');
  assert.equal(trimmed.totalTokens, period.totalTokens);
  assert.equal(trimmed.costUsd, period.costUsd);
  assert.deepEqual(trimmed.clients, period.clients);
});

test('trimPeriodSessions does not mutate the caller’s period', () => {
  const period = periodWithSessions(50);
  trimPeriodSessions(period, 10);
  assert.equal(Object.keys(period.sessions).length, 50);
});

test('summaryForWire caps every period and preserves the rest of the summary', () => {
  const summary = {
    deviceId: 'dev-a',
    hostname: 'host-a',
    trackedClients: ['claude'],
    today: periodWithSessions(3),
    week: periodWithSessions(20),
    month: periodWithSessions(200),
    allTime: periodWithSessions(900)
  };
  const wire = summaryForWire(summary, 100);
  assert.equal(Object.keys(wire.today.sessions).length, 3);
  assert.equal(Object.keys(wire.week.sessions).length, 20);
  assert.equal(Object.keys(wire.month.sessions).length, 100);
  assert.equal(Object.keys(wire.allTime.sessions).length, 100);
  assert.equal(wire.deviceId, 'dev-a');
  assert.equal(wire.hostname, 'host-a');
  assert.deepEqual(wire.trackedClients, ['claude']);
  assert.equal(Object.keys(summary.allTime.sessions).length, 900, 'source summary stays complete');
});

test('summaryForWire tolerates a summary missing periods', () => {
  const wire = summaryForWire({ deviceId: 'dev-a', today: periodWithSessions(1) });
  assert.equal(wire.deviceId, 'dev-a');
  assert.equal(wire.week, undefined);
  assert.ok(MAX_WIRE_SESSIONS_PER_PERIOD > 0);
});
