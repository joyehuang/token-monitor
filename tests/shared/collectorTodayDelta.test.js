'use strict';

// Watch-triggered ticks scan only --today and derive week/month/allTime exactly from
// the last full-scan anchor (issue #15 follow-up): one tokscale spawn per watch
// tick instead of four, with no loss of accuracy.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const collectorPath = require.resolve('../../src/shared/collector');

function freshCollector() {
  delete require.cache[collectorPath];
  return require(collectorPath);
}

function recordingSpawn(calls, tokens = 50) {
  return (_bin, args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({
        entries: [{ client: 'claude', sessionId: 's1', model: 'claude-opus-4-8', input: tokens, output: 0, cost: tokens / 100 }]
      })));
      child.emit('close', 0);
    });
    return child;
  };
}

function waitForUpdates(updates, count) {
  if (updates.length >= count) return Promise.resolve();
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (updates.length >= count) {
        clearInterval(interval);
        resolve();
      }
    }, 5);
  });
}

const baseOptions = {
  clients: 'claude',
  allTimeSince: '2024-01-01',
  commandTimeoutMs: 1000,
  deviceId: 'test-device',
  agentVersion: 'test',
  limitsEnabled: false
};

test('collectUsageOnce with a valid anchor runs a single --today scan and derives the broader periods', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  const calls = [];
  childProcess.spawn = recordingSpawn(calls, 50);
  try {
    const { collectUsageOnce, localTodayKey } = freshCollector();
    const { emptyPeriod } = require('../../src/shared/usage');
    const anchor = {
      dateKey: localTodayKey(),
      today: { ...emptyPeriod(), totalTokens: 30, clients: { claude: 30 } },
      week: { ...emptyPeriod(), totalTokens: 80, clients: { claude: 80 } },
      month: { ...emptyPeriod(), totalTokens: 100, clients: { claude: 100 } },
      allTime: { ...emptyPeriod(), totalTokens: 1000, clients: { claude: 1000 } }
    };
    const summary = await collectUsageOnce({ ...baseOptions, todayOnlyAnchor: anchor });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('--today'));
    assert.equal(summary.today.totalTokens, 50);
    assert.equal(summary.week.totalTokens, 100);
    assert.equal(summary.month.totalTokens, 120);
    assert.equal(summary.allTime.totalTokens, 1020);
    assert.equal(summary.month.clients.claude, 120);
  } finally {
    childProcess.spawn = originalSpawn;
    delete require.cache[collectorPath];
  }
});

test('collectUsageOnce ignores a stale anchor from a previous day and runs the full scan', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  const calls = [];
  childProcess.spawn = recordingSpawn(calls, 50);
  try {
    const { collectUsageOnce } = freshCollector();
    const { emptyPeriod } = require('../../src/shared/usage');
    const anchor = { dateKey: '2020-01-01', today: emptyPeriod(), week: emptyPeriod(), month: emptyPeriod(), allTime: emptyPeriod() };
    await collectUsageOnce({ ...baseOptions, todayOnlyAnchor: anchor });
    assert.equal(calls.length, 4);
  } finally {
    childProcess.spawn = originalSpawn;
    delete require.cache[collectorPath];
  }
});

test('startCollector: watch ticks reuse the full-scan anchor, manual ticks rescan everything', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  const calls = [];
  childProcess.spawn = recordingSpawn(calls, 50);
  // Use an isolated shared data dir so the test doesn't pick up a real
  // collector-anchor.json left by the actual app (anchor persistence).
  const tmpShared = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-shared-'));
  const originalSharedDir = process.env.TOKEN_MONITOR_SHARED_DIR;
  process.env.TOKEN_MONITOR_SHARED_DIR = tmpShared;
  try {
    const { startCollector } = freshCollector();
    const updates = [];
    const handle = startCollector({
      ...baseOptions,
      intervalMs: 60 * 60 * 1000,
      watchEnabled: false,
      watchDebounceMs: 10,
      historyEnabled: false,
      onUpdate: (summary, reason) => updates.push({ summary, reason })
    });

    await waitForUpdates(updates, 1);
    const fullScans = calls.length;
    assert.equal(fullScans, 4);

    await handle.tick('watch:change:file.jsonl', { todayOnly: true });
    await waitForUpdates(updates, 2);
    assert.equal(calls.length, fullScans + 1);
    // Same fake data both rounds: delta is zero, broader periods match the anchor.
    assert.equal(updates[1].summary.week.totalTokens, updates[0].summary.week.totalTokens);
    assert.equal(updates[1].summary.month.totalTokens, updates[0].summary.month.totalTokens);
    assert.equal(updates[1].summary.allTime.totalTokens, updates[0].summary.allTime.totalTokens);
    assert.equal(updates[1].summary.today.totalTokens, 50);

    await handle.tick('manual');
    await waitForUpdates(updates, 3);
    assert.equal(calls.length, fullScans + 1 + 4);

    handle.stop();
  } finally {
    childProcess.spawn = originalSpawn;
    if (originalSharedDir === undefined) delete process.env.TOKEN_MONITOR_SHARED_DIR;
    else process.env.TOKEN_MONITOR_SHARED_DIR = originalSharedDir;
    fs.rmSync(tmpShared, { recursive: true, force: true });
    delete require.cache[collectorPath];
  }
});
