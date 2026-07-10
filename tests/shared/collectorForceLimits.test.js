'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate the shared data dir so startCollector's persisted collector-anchor.json
// does not write the real user data dir during the suite.
const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-force-limits-'));
process.env.TOKEN_MONITOR_SHARED_DIR = sharedDir;
process.on('exit', () => { try { fs.rmSync(sharedDir, { recursive: true, force: true }); } catch (_) {} });

function fakeTokscaleSpawn() {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({ totalTokens: 0, costUsd: 0 })));
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

test('manual collector tick can force the limits snapshot', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = fakeTokscaleSpawn();

  const limitCollectorPath = require.resolve('../../src/shared/limitCollector');
  const collectorPath = require.resolve('../../src/shared/collector');
  const limitCollector = require(limitCollectorPath);
  const originalCreateLimitsCollector = limitCollector.createLimitsCollector;
  const snapshotForces = [];
  limitCollector.createLimitsCollector = () => ({
    snapshot: async (force = false) => {
      snapshotForces.push(Boolean(force));
      return { updatedAt: new Date().toISOString(), refreshMs: 300000, providers: [] };
    }
  });
  delete require.cache[collectorPath];

  try {
    const { startCollector } = require(collectorPath);
    const updates = [];
    const handle = startCollector({
      clients: 'claude',
      allTimeSince: '2024-01-01',
      commandTimeoutMs: 1000,
      deviceId: 'test-device',
      agentVersion: 'test',
      intervalMs: 60000,
      watchEnabled: false,
      watchDebounceMs: 10,
      limitsEnabled: true,
      onUpdate: (summary, reason) => updates.push({ summary, reason })
    });

    await waitForUpdates(updates, 1);
    await handle.tick('manual', { forceLimits: true });
    await waitForUpdates(updates, 2);
    handle.stop();

    assert.deepEqual(snapshotForces.slice(0, 2), [false, true]);
  } finally {
    childProcess.spawn = originalSpawn;
    limitCollector.createLimitsCollector = originalCreateLimitsCollector;
    delete require.cache[collectorPath];
  }
});

test('startCollector refreshes limits independently without rescanning usage and stops its limits timer', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  let usageScans = 0;
  const spawn = fakeTokscaleSpawn();
  childProcess.spawn = (...args) => {
    usageScans += 1;
    return spawn(...args);
  };

  const limitCollectorPath = require.resolve('../../src/shared/limitCollector');
  const collectorPath = require.resolve('../../src/shared/collector');
  const limitCollector = require(limitCollectorPath);
  const originalCreateLimitsCollector = limitCollector.createLimitsCollector;
  let limitsSnapshots = 0;
  let collectorInitialLimits = null;
  limitCollector.createLimitsCollector = (collectorOptions) => {
    collectorInitialLimits = collectorOptions.initialLimits;
    return {
      snapshot: async () => {
        limitsSnapshots += 1;
        return {
          updatedAt: `2026-06-14T09:0${limitsSnapshots}:00.000Z`,
          refreshMs: 60000,
          providers: [{
            provider: 'codex',
            status: 'ok',
            updatedAt: `2026-06-14T09:0${limitsSnapshots}:00.000Z`,
            windows: []
          }]
        };
      }
    };
  };
  delete require.cache[collectorPath];
  const limitsCachePath = path.join(sharedDir, 'independent-limits-cache.json');
  fs.writeFileSync(limitsCachePath, JSON.stringify({
    updatedAt: '2026-06-14T09:00:00.000Z',
    refreshMs: 60000,
    providers: []
  }));
  let nextLimitsTimerId = 1;
  let scheduledLimitsTimer = null;
  let clearedLimitsTimerId = null;
  const setLimitsTimeout = (callback, delay) => {
    scheduledLimitsTimer = { id: nextLimitsTimerId, callback, delay };
    nextLimitsTimerId += 1;
    return scheduledLimitsTimer.id;
  };
  const clearLimitsTimeout = (id) => {
    clearedLimitsTimerId = id;
    if (scheduledLimitsTimer?.id === id) scheduledLimitsTimer = null;
  };
  let handle;

  try {
    const { startCollector } = require(collectorPath);
    const updates = [];
    let resolveInitialUpdate;
    const initialUpdate = new Promise((resolve) => { resolveInitialUpdate = resolve; });
    handle = startCollector({
      clients: 'claude',
      allTimeSince: '2024-01-01',
      commandTimeoutMs: 1000,
      deviceId: 'test-device',
      agentVersion: 'test',
      intervalMs: 300000,
      limitsRefreshMs: 60000,
      limitsCachePath,
      watchEnabled: false,
      watchDebounceMs: 10,
      limitsEnabled: true,
      setLimitsTimeout,
      clearLimitsTimeout,
      onUpdate: (summary, reason) => {
        updates.push({ summary, reason });
        if (updates.length === 1) resolveInitialUpdate();
      }
    });

    await initialUpdate;
    await new Promise((resolve) => setImmediate(resolve));
    const usageScansAfterInitialTick = usageScans;
    assert.equal(limitsSnapshots, 1);
    assert.equal(collectorInitialLimits.updatedAt, '2026-06-14T09:00:00.000Z');
    assert.equal(scheduledLimitsTimer.delay, 60000);
    assert.equal(JSON.parse(fs.readFileSync(limitsCachePath, 'utf8')).updatedAt, '2026-06-14T09:01:00.000Z');

    const firstLimitsTimer = scheduledLimitsTimer;
    scheduledLimitsTimer = null;
    await firstLimitsTimer.callback();

    assert.equal(limitsSnapshots, 2);
    assert.equal(usageScans, usageScansAfterInitialTick);
    assert.equal(updates.at(-1).reason, 'limits');
    assert.equal(updates.at(-1).summary.limitsOnly, true);
    assert.equal(updates.at(-1).summary.limits.updatedAt, '2026-06-14T09:02:00.000Z');
    assert.equal(JSON.parse(fs.readFileSync(limitsCachePath, 'utf8')).updatedAt, '2026-06-14T09:02:00.000Z');

    const timerScheduledAfterRefresh = scheduledLimitsTimer;
    handle.stop();
    assert.equal(clearedLimitsTimerId, timerScheduledAfterRefresh.id);
    assert.equal(scheduledLimitsTimer, null);
    const countsAfterStop = {
      limitsSnapshots,
      usageScans,
      updates: updates.length
    };
    await timerScheduledAfterRefresh.callback();

    assert.deepEqual({
      limitsSnapshots,
      usageScans,
      updates: updates.length
    }, countsAfterStop);
  } finally {
    handle?.stop();
    childProcess.spawn = originalSpawn;
    limitCollector.createLimitsCollector = originalCreateLimitsCollector;
    delete require.cache[collectorPath];
  }
});

test('startCollector does not run a limits-only refresh during a full usage tick', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  let blockNextSpawn = false;
  let resolveBlockedSpawn;
  const blockedSpawn = new Promise((resolve) => { resolveBlockedSpawn = resolve; });
  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.kill = () => {};
    const finish = () => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({ totalTokens: 0, costUsd: 0 })));
      child.emit('close', 0);
    };
    if (blockNextSpawn) {
      blockNextSpawn = false;
      resolveBlockedSpawn(finish);
    } else {
      setImmediate(finish);
    }
    return child;
  };

  const limitCollectorPath = require.resolve('../../src/shared/limitCollector');
  const collectorPath = require.resolve('../../src/shared/collector');
  const limitCollector = require(limitCollectorPath);
  const originalCreateLimitsCollector = limitCollector.createLimitsCollector;
  let limitsSnapshots = 0;
  limitCollector.createLimitsCollector = () => ({
    snapshot: async () => {
      limitsSnapshots += 1;
      return { updatedAt: new Date().toISOString(), refreshMs: 60000, providers: [] };
    }
  });
  delete require.cache[collectorPath];
  let scheduledLimitsTimer = null;
  let handle;

  try {
    const { startCollector } = require(collectorPath);
    const updates = [];
    handle = startCollector({
      clients: 'claude',
      allTimeSince: '2024-01-01',
      commandTimeoutMs: 1000,
      deviceId: 'test-device',
      agentVersion: 'test',
      intervalMs: 300000,
      limitsRefreshMs: 60000,
      limitsCachePath: path.join(sharedDir, 'serialized-limits-cache.json'),
      watchEnabled: false,
      watchDebounceMs: 10,
      limitsEnabled: true,
      setLimitsTimeout: (callback, delay) => {
        scheduledLimitsTimer = { callback, delay };
        return scheduledLimitsTimer;
      },
      clearLimitsTimeout: () => { scheduledLimitsTimer = null; },
      onUpdate: (summary, reason) => updates.push({ summary, reason })
    });

    await waitForUpdates(updates, 1);
    assert.equal(limitsSnapshots, 1);
    blockNextSpawn = true;
    const fullTick = handle.tick('manual');
    const releaseSpawn = await blockedSpawn;
    const timer = scheduledLimitsTimer;
    scheduledLimitsTimer = null;
    await timer.callback();

    assert.equal(limitsSnapshots, 1);
    assert.equal(updates.some(({ reason }) => reason === 'limits'), false);

    releaseSpawn();
    await fullTick;
    assert.equal(limitsSnapshots, 2);
    assert.equal(updates.at(-1).reason, 'manual');
  } finally {
    handle?.stop();
    childProcess.spawn = originalSpawn;
    limitCollector.createLimitsCollector = originalCreateLimitsCollector;
    delete require.cache[collectorPath];
  }
});

test('a slow limits-only update does not block a full usage tick', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = fakeTokscaleSpawn();

  const limitCollectorPath = require.resolve('../../src/shared/limitCollector');
  const collectorPath = require.resolve('../../src/shared/collector');
  const limitCollector = require(limitCollectorPath);
  const originalCreateLimitsCollector = limitCollector.createLimitsCollector;
  limitCollector.createLimitsCollector = () => ({
    snapshot: async () => ({ updatedAt: new Date().toISOString(), refreshMs: 60000, providers: [] })
  });
  delete require.cache[collectorPath];
  let scheduledLimitsTimer = null;
  let releaseLimitsUpdate;
  const limitsUpdateGate = new Promise((resolve) => { releaseLimitsUpdate = resolve; });
  let resolveLimitsUpdateStarted;
  const limitsUpdateStarted = new Promise((resolve) => { resolveLimitsUpdateStarted = resolve; });
  let handle;

  try {
    const { startCollector } = require(collectorPath);
    const updates = [];
    handle = startCollector({
      clients: 'claude',
      allTimeSince: '2024-01-01',
      commandTimeoutMs: 1000,
      deviceId: 'test-device',
      agentVersion: 'test',
      intervalMs: 300000,
      limitsRefreshMs: 60000,
      limitsCachePath: path.join(sharedDir, 'slow-update-limits-cache.json'),
      watchEnabled: false,
      watchDebounceMs: 10,
      limitsEnabled: true,
      setLimitsTimeout: (callback, delay) => {
        scheduledLimitsTimer = { callback, delay };
        return scheduledLimitsTimer;
      },
      clearLimitsTimeout: () => { scheduledLimitsTimer = null; },
      onUpdate: (summary, reason) => {
        updates.push({ summary, reason });
        if (reason === 'limits') {
          resolveLimitsUpdateStarted();
          return limitsUpdateGate;
        }
      }
    });

    await waitForUpdates(updates, 1);
    const timer = scheduledLimitsTimer;
    scheduledLimitsTimer = null;
    const limitsRefresh = timer.callback();
    await limitsUpdateStarted;

    let timeout;
    try {
      await Promise.race([
        handle.tick('manual'),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('full tick blocked by limits update')), 1000);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
    assert.equal(updates.at(-1).reason, 'manual');

    releaseLimitsUpdate();
    await limitsRefresh;
  } finally {
    releaseLimitsUpdate();
    handle?.stop();
    childProcess.spawn = originalSpawn;
    limitCollector.createLimitsCollector = originalCreateLimitsCollector;
    delete require.cache[collectorPath];
  }
});

test('collectUsageOnce returns empty usage without spawning tokscale when clients is empty', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  let spawnCalls = 0;
  childProcess.spawn = () => {
    spawnCalls += 1;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({ totalTokens: 100, costUsd: 1 })));
      child.emit('close', 0);
    });
    return child;
  };

  const collectorPath = require.resolve('../../src/shared/collector');
  delete require.cache[collectorPath];

  try {
    const { collectUsageOnce } = require(collectorPath);
    const summary = await collectUsageOnce({
      clients: '',
      allTimeSince: '2024-01-01',
      commandTimeoutMs: 1000,
      deviceId: 'test-device',
      agentVersion: 'test',
      limitsEnabled: false
    });

    assert.equal(spawnCalls, 0);
    assert.deepEqual(summary.trackedClients, []);
    assert.equal(summary.today.totalTokens, 0);
    assert.equal(summary.month.totalTokens, 0);
    assert.equal(summary.allTime.totalTokens, 0);
  } finally {
    childProcess.spawn = originalSpawn;
    delete require.cache[collectorPath];
  }
});

test('collectUsageOnce includes the normalized tracked client list in summaries', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = fakeTokscaleSpawn();

  const collectorPath = require.resolve('../../src/shared/collector');
  delete require.cache[collectorPath];

  try {
    const { collectUsageOnce } = require(collectorPath);
    const summary = await collectUsageOnce({
      clients: ' Codex, Hermes ',
      allTimeSince: '2024-01-01',
      commandTimeoutMs: 1000,
      deviceId: 'test-device',
      agentVersion: 'test',
      limitsEnabled: false
    });

    assert.deepEqual(summary.trackedClients, ['codex', 'hermes']);
  } finally {
    childProcess.spawn = originalSpawn;
    delete require.cache[collectorPath];
  }
});

test('collectUsageOnce requests session-level tokscale grouping', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  const calls = [];
  childProcess.spawn = (_bin, args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({ entries: [] })));
      child.emit('close', 0);
    });
    return child;
  };

  const collectorPath = require.resolve('../../src/shared/collector');
  delete require.cache[collectorPath];

  try {
    const { collectUsageOnce } = require(collectorPath);
    await collectUsageOnce({
      clients: 'claude',
      allTimeSince: '2024-01-01',
      commandTimeoutMs: 1000,
      deviceId: 'test-device',
      agentVersion: 'test',
      limitsEnabled: false
    });

    assert.equal(calls.length, 4);
    for (const args of calls) {
      const groupIndex = args.indexOf('--group-by');
      assert.notEqual(groupIndex, -1);
      assert.equal(args[groupIndex + 1], 'client,session,model');
    }
  } finally {
    childProcess.spawn = originalSpawn;
    delete require.cache[collectorPath];
  }
});

test('collectUsageOnce enriches session rows with local last-used timestamps', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'token-monitor-sessions-'));
  const claudeSession = 'claude-session-1';
  const codexSession = 'rollout-2026-05-30T11-44-50-abc';
  const claudeDir = path.join(tmp, '.claude', 'projects', 'project');
  const codexDir = path.join(tmp, '.codex', 'sessions', '2026', '05', '30');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, `${claudeSession}.jsonl`), [
    JSON.stringify({ sessionId: claudeSession, timestamp: '2026-05-30T04:00:00.000Z' }),
    JSON.stringify({ sessionId: claudeSession, timestamp: '2026-05-30T04:07:32.679Z' })
  ].join('\n'));
  fs.writeFileSync(path.join(codexDir, `${codexSession}.jsonl`), [
    JSON.stringify({ sessionId: codexSession, timestamp: '2026-05-30T03:45:00.000Z' })
  ].join('\n'));

  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({
        entries: [
          { client: 'claude', sessionId: claudeSession, model: 'claude-opus-4-8', input: 10, output: 2, cost: 0.1 },
          { client: 'codex', sessionId: codexSession, model: 'gpt-5.5', input: 100, output: 20, cost: 1 }
        ]
      })));
      child.emit('close', 0);
    });
    return child;
  };

  const collectorPath = require.resolve('../../src/shared/collector');
  delete require.cache[collectorPath];

  try {
    const { collectUsageOnce } = require(collectorPath);
    const summary = await collectUsageOnce({
      clients: 'claude,codex',
      allTimeSince: '2024-01-01',
      commandTimeoutMs: 1000,
      deviceId: 'test-device',
      agentVersion: 'test',
      limitsEnabled: false,
      homeDir: tmp
    });

    assert.equal(summary.today.sessions[`claude:${claudeSession}`].lastUsedAt, '2026-05-30T04:07:32.679Z');
    assert.equal(summary.today.sessions[`codex:${codexSession}`].lastUsedAt, '2026-05-30T03:45:00.000Z');
    assert.ok(summary.today.sessions[`codex:${codexSession}`].startedAt);
  } finally {
    childProcess.spawn = originalSpawn;
    delete require.cache[collectorPath];
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
