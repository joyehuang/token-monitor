'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const collectorPath = require.resolve('../../src/shared/collector');

function freshCollector() {
  delete require.cache[collectorPath];
  return require(collectorPath);
}

function dateDir(homeDir, date) {
  return path.join(
    homeDir,
    '.codex',
    'sessions',
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  );
}

function waitForCondition(predicate, timeoutMs = 2000) {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for condition'));
      }
    }, 5);
  });
}

function recordingSpawn(calls) {
  return (_bin, args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({
        entries: [{ client: 'codex', sessionId: 's1', model: 'gpt-test', input: 50, output: 0, cost: 0 }]
      })));
      child.emit('close', 0);
    });
    return child;
  };
}

test('Codex live-session snapshot detects size growth without an mtime change', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-codex-size-'));
  const now = new Date(2026, 7, 27, 22, 0, 0);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const oldDay = new Date(now);
  oldDay.setDate(oldDay.getDate() - 2);
  const todayDir = dateDir(homeDir, now);
  const yesterdayDir = dateDir(homeDir, yesterday);
  const oldDir = dateDir(homeDir, oldDay);
  fs.mkdirSync(todayDir, { recursive: true });
  fs.mkdirSync(yesterdayDir, { recursive: true });
  fs.mkdirSync(oldDir, { recursive: true });
  const activeFile = path.join(todayDir, 'rollout-active.jsonl');
  const overnightFile = path.join(yesterdayDir, 'rollout-overnight.jsonl');
  const oldFile = path.join(oldDir, 'rollout-old.jsonl');
  fs.writeFileSync(activeFile, '{}\n');
  fs.writeFileSync(overnightFile, '{}\n');
  fs.writeFileSync(oldFile, '{}\n');

  try {
    const { codexLiveSessionSizeSnapshot, fileSizeSnapshotChanged } = freshCollector();
    const before = codexLiveSessionSizeSnapshot(homeDir, now);
    assert.equal(before.has(activeFile), true);
    assert.equal(before.has(overnightFile), true);
    assert.equal(before.has(oldFile), false);
    assert.equal(fileSizeSnapshotChanged(before, before), false);

    const unchangedMtime = fs.statSync(activeFile).mtime;
    fs.appendFileSync(activeFile, '{"more":true}\n');
    fs.utimesSync(activeFile, unchangedMtime, unchangedMtime);
    const after = codexLiveSessionSizeSnapshot(homeDir, now);
    assert.equal(fileSizeSnapshotChanged(before, after), true);
  } finally {
    delete require.cache[collectorPath];
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('Windows Codex size polling schedules a today-only collector tick', async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-codex-poll-'));
  const todayDir = dateDir(homeDir, new Date());
  const sharedDir = path.join(homeDir, 'shared');
  fs.mkdirSync(todayDir, { recursive: true });
  const activeFile = path.join(todayDir, 'rollout-active.jsonl');
  fs.writeFileSync(activeFile, '{}\n');

  const originalHomedir = os.homedir;
  const originalSharedDir = process.env.TOKEN_MONITOR_SHARED_DIR;
  os.homedir = () => homeDir;
  process.env.TOKEN_MONITOR_SHARED_DIR = sharedDir;

  const chokidar = require('chokidar');
  const originalWatch = chokidar.watch;
  chokidar.watch = () => ({ on: () => {}, close: () => {} });

  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  const calls = [];
  childProcess.spawn = recordingSpawn(calls);

  let handle = null;
  try {
    const { startCollector } = freshCollector();
    const updates = [];
    handle = startCollector({
      clients: 'codex',
      allTimeSince: '2024-01-01',
      commandTimeoutMs: 1000,
      deviceId: 'test-device',
      agentVersion: 'test',
      platform: 'win32',
      homeDir,
      intervalMs: 60 * 60 * 1000,
      watchEnabled: true,
      watchDebounceMs: 10,
      watchPollIntervalMs: 20,
      limitsEnabled: false,
      historyEnabled: false,
      wslScanEnabled: false,
      onUpdate: (_summary, reason) => updates.push(reason)
    });

    await waitForCondition(() => updates.length === 1);
    assert.equal(calls.length, 4);

    const unchangedMtime = fs.statSync(activeFile).mtime;
    fs.appendFileSync(activeFile, '{"more":true}\n');
    fs.utimesSync(activeFile, unchangedMtime, unchangedMtime);

    await waitForCondition(() => updates.length === 2);
    assert.equal(updates[1], 'watch:size:codex');
    assert.equal(calls.length, 5, 'size-triggered refresh should scan only --today');
    assert.ok(calls[4].includes('--today'));
  } finally {
    if (handle) handle.stop();
    childProcess.spawn = originalSpawn;
    chokidar.watch = originalWatch;
    os.homedir = originalHomedir;
    if (originalSharedDir === undefined) delete process.env.TOKEN_MONITOR_SHARED_DIR;
    else process.env.TOKEN_MONITOR_SHARED_DIR = originalSharedDir;
    delete require.cache[collectorPath];
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
