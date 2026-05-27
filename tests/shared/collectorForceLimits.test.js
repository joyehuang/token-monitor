'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');

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
