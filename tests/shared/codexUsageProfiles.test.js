'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  collectCodexUsageProfiles,
  normalizeCodexUsageProfiles,
  usageComponents
} = require('../../src/shared/codexUsageProfiles');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tm-codex-profile-'));
}

function writeLines(filePath, lines, trailingNewline = true) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + (trailingNewline ? '\n' : ''));
}

function usageLine(timestamp, total, last = null, type = 'token_count') {
  return {
    timestamp,
    type: 'event_msg',
    payload: { type, info: { total_token_usage: total, last_token_usage: last } }
  };
}

test('usage components keep cached input and reasoning disjoint', () => {
  assert.deepEqual(usageComponents({ input_tokens: 800, cached_input_tokens: 500, output_tokens: 200, reasoning_output_tokens: 80 }), {
    inputTokens: 300,
    outputTokens: 200,
    cacheReadTokens: 500,
    cacheWriteTokens: 0,
    reasoningTokens: 80,
    totalTokens: 1000
  });
});

test('turn.completed usage is counted when no cumulative token_count stream exists', () => {
  const root = tempRoot();
  const file = path.join(root, '.codex', 'sessions', '2026', '09', '09', 'completed.jsonl');
  writeLines(file, [
    { timestamp: '2026-09-09T01:00:00Z', type: 'session_meta', payload: { id: 'completed-only' } },
    { timestamp: '2026-09-09T01:00:01Z', type: 'turn_context', payload: { model: 'gpt-5' } },
    { timestamp: '2026-09-09T01:00:02Z', type: 'turn.completed', usage: { input_tokens: 90, cached_input_tokens: 30, output_tokens: 10 } }
  ]);
  const result = collectCodexUsageProfiles({ profiles: [{ id: 'codex-work', label: 'Work', path: root }], cachePath: null, now: new Date('2026-09-09T12:00:00Z') });
  assert.equal(result.bundle.today.totalTokens, 100);
  fs.rmSync(root, { recursive: true, force: true });
});

test('profile collection uses cumulative totals, ignores duplicates/content, and resumes appends', () => {
  const root = tempRoot();
  const profileHome = path.join(root, 'work-home');
  const file = path.join(profileHome, '.codex', 'sessions', '2026', '09', '09', 'rollout-same.jsonl');
  const cachePath = path.join(root, 'cache.json');
  const firstTotal = { input_tokens: 800, cached_input_tokens: 500, output_tokens: 200, reasoning_output_tokens: 80, total_tokens: 1000 };
  const secondTotal = { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 300, reasoning_output_tokens: 100, total_tokens: 1300 };
  writeLines(file, [
    { timestamp: '2026-09-09T01:00:00.000Z', type: 'session_meta', payload: { id: 'same-session', cwd: '/confidential/project', title: 'private title' } },
    { timestamp: '2026-09-09T01:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5', cwd: '/confidential/project' } },
    { timestamp: '2026-09-09T01:00:02.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'secret work prompt' } },
    usageLine('2026-09-09T01:00:03.000Z', firstTotal, { input_tokens: 99999, output_tokens: 99999 }),
    usageLine('2026-09-09T01:00:03.000Z', firstTotal, { input_tokens: 99999, output_tokens: 99999 }),
    usageLine('2026-09-09T01:00:04.000Z', secondTotal, { input_tokens: 99999, output_tokens: 99999 }, 'turn.completed'),
    { timestamp: '2026-09-09T01:00:05.000Z', type: 'turn.completed', usage: { input_tokens: 300, cached_input_tokens: 100, output_tokens: 50 } },
    '{damaged'
  ]);

  const options = {
    profiles: [{ id: 'codex-work', label: 'Work', path: profileHome }],
    cachePath,
    now: new Date('2026-09-09T12:00:00.000Z'),
    allTimeSince: '2024-01-01'
  };
  const first = collectCodexUsageProfiles(options);
  assert.equal(first.bundle.today.totalTokens, 1300);
  assert.equal(first.bundle.today.cacheReadTokens, 600);
  assert.equal(first.bundle.today.outputTokens, 300);
  assert.equal(first.bundle.today.profiles['codex-work'], 1300);
  assert.equal(first.bundle.today.profileModels['codex-work']['gpt-5'], 1300);
  assert.equal(first.status[0].malformedLines, 1);
  const session = Object.values(first.bundle.today.sessions)[0];
  assert.equal(session.detailAvailable, false);
  assert.match(session.sessionId, /^sha256:[a-f0-9]{24}$/);
  assert.notEqual(session.sessionId, 'same-session');
  assert.equal(session.totalTokens, 1300);
  assert.equal(session.messageCount, 2);

  const cacheText = fs.readFileSync(cachePath, 'utf8');
  assert.doesNotMatch(cacheText, /confidential|private title|secret work prompt|work-home/);

  fs.appendFileSync(file, JSON.stringify(usageLine('2026-09-09T02:00:00.000Z', {
    input_tokens: 1100, cached_input_tokens: 650, output_tokens: 350, reasoning_output_tokens: 110, total_tokens: 1450
  })) + '\n');
  const second = collectCodexUsageProfiles(options);
  assert.equal(second.bundle.today.totalTokens, 1450);
  assert.equal(second.bundle.today.profiles['codex-work'], 1450);
  fs.rmSync(root, { recursive: true, force: true });
});

test('incomplete JSONL tails wait for a newline and identical session ids stay profile-scoped', () => {
  const root = tempRoot();
  const makeProfile = (name, id, tokens, complete) => {
    const file = path.join(root, name, '.codex', 'sessions', '2026', '09', '09', 'rollout.jsonl');
    writeLines(file, [
      { timestamp: '2026-09-09T01:00:00.000Z', type: 'session_meta', payload: { id: 'same-session' } },
      usageLine('2026-09-09T01:00:01.000Z', { input_tokens: tokens - 10, cached_input_tokens: 0, output_tokens: 10 })
    ], complete);
    return { file, config: { id, label: name === 'one' ? 'Work' : 'Work 2', path: path.join(root, name) } };
  };
  const one = makeProfile('one', 'codex-work', 100, true);
  const two = makeProfile('two', 'codex-work-2', 200, false);
  const options = { profiles: [one.config, two.config], cachePath: path.join(root, 'cache.json'), now: new Date('2026-09-09T12:00:00Z') };
  const before = collectCodexUsageProfiles(options);
  assert.equal(before.bundle.today.totalTokens, 100);
  fs.appendFileSync(two.file, '\n');
  const after = collectCodexUsageProfiles(options);
  assert.equal(after.bundle.today.totalTokens, 300);
  const sessions = Object.values(after.bundle.today.sessions);
  assert.equal(sessions.length, 2);
  assert.equal(new Set(sessions.map((session) => session.sessionId)).size, 2);
  assert.deepEqual(sessions.map((session) => session.totalTokens).sort((a, b) => a - b), [100, 200]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a short read after 64 KiB cannot consume stale-buffer newlines or skip an unfinished event', () => {
  const root = tempRoot();
  const file = path.join(root, '.codex', 'sessions', '2026', '09', '09', 'boundary.jsonl');
  const cachePath = path.join(root, 'cache.json');
  const event = usageLine('2026-09-09T01:00:01.000Z', { input_tokens: 100, output_tokens: 10 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{}\n'.repeat(22000) + JSON.stringify(event));
  const originalSize = fs.statSync(file).size;
  const options = {
    profiles: [{ id: 'codex-work', label: 'Work', path: root }],
    cachePath,
    now: new Date('2026-09-09T12:00:00Z')
  };

  const first = collectCodexUsageProfiles(options);
  assert.equal(first.bundle.today.totalTokens, 0);
  assert.equal(first.status[0].malformedLines, 0);
  const firstEntry = Object.values(JSON.parse(fs.readFileSync(cachePath, 'utf8')).profiles['codex-work'].files)[0];
  assert.equal(firstEntry.offset, Buffer.byteLength('{}\n'.repeat(22000)));
  assert.ok(firstEntry.offset <= originalSize);

  fs.appendFileSync(file, '\n' + '{}\n'.repeat(100));
  const appendedSize = fs.statSync(file).size;
  const afterAppend = collectCodexUsageProfiles(options);
  assert.equal(afterAppend.bundle.today.totalTokens, 110);
  assert.equal(afterAppend.status[0].malformedLines, 0);
  const appendedEntry = Object.values(JSON.parse(fs.readFileSync(cachePath, 'utf8')).profiles['codex-work'].files)[0];
  assert.equal(appendedEntry.offset, appendedSize);
  assert.ok(appendedEntry.offset <= appendedSize);

  const cold = collectCodexUsageProfiles({ ...options, cachePath: null });
  assert.equal(cold.bundle.today.totalTokens, 110);
  fs.rmSync(root, { recursive: true, force: true });
});

test('version 1 caches with potentially poisoned offsets are rebuilt', () => {
  const root = tempRoot();
  const file = path.join(root, '.codex', 'sessions', '2026', '09', '09', 'fresh.jsonl');
  const cachePath = path.join(root, 'cache.json');
  writeLines(file, [usageLine('2026-09-09T01:00:01.000Z', { input_tokens: 100, output_tokens: 10 })]);
  fs.writeFileSync(cachePath, JSON.stringify({
    version: 1,
    profiles: {
      'codex-work': {
        rootFingerprint: 'legacy',
        files: { legacy: { identity: 'legacy', offset: 999999, daily: { '2026-09-09': { totalTokens: 999999 } } } }
      }
    }
  }));

  const result = collectCodexUsageProfiles({
    profiles: [{ id: 'codex-work', label: 'Work', path: root }],
    cachePath,
    now: new Date('2026-09-09T12:00:00Z')
  });
  assert.equal(result.bundle.today.totalTokens, 110);
  assert.equal(JSON.parse(fs.readFileSync(cachePath, 'utf8')).version, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('JSONL parsing preserves UTF-8 characters split across the 64 KiB read boundary', () => {
  const root = tempRoot();
  const file = path.join(root, '.codex', 'sessions', '2026', '09', '09', 'utf8-boundary.jsonl');
  const prefix = '{"type":"ignored","payload":{"message":"';
  const suffix = '"}}\n';
  const padding = 65535 - Buffer.byteLength(prefix);
  assert.ok(padding > 0);
  const splitLine = prefix + 'a'.repeat(padding) + '🙂' + suffix;
  writeLines(file, [
    splitLine.trimEnd(),
    { timestamp: '2026-09-09T01:00:00.000Z', type: 'session_meta', payload: { id: 'utf8-session' } },
    usageLine('2026-09-09T01:00:01.000Z', { input_tokens: 100, output_tokens: 10 })
  ]);

  const result = collectCodexUsageProfiles({
    profiles: [{ id: 'codex-work', label: 'Work', path: root }],
    cachePath: path.join(root, 'cache.json'),
    now: new Date('2026-09-09T12:00:00Z')
  });
  assert.equal(result.bundle.today.totalTokens, 110);
  assert.equal(result.status[0].malformedLines, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('normalization rejects relative paths and deduplicates symlink aliases including Personal', (t) => {
  const root = tempRoot();
  const home = path.join(root, 'personal-home');
  const work = path.join(root, 'work', '.codex');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const alias = path.join(root, 'work-alias');
  try { fs.symlinkSync(work, alias, 'dir'); } catch (_) { t.skip('symlinks unavailable'); return; }
  const profiles = normalizeCodexUsageProfiles([
    { label: 'Personal duplicate', path: home },
    { label: 'Work', path: work },
    { label: 'Alias', path: alias },
    { label: 'Relative', path: 'relative/path' }
  ], { homeDir: home });
  assert.deepEqual(profiles.map(({ id, label }) => ({ id, label })), [{ id: 'codex-work', label: 'Work' }]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('oversized and damaged lines are skipped, and rotation does not double count', () => {
  const root = tempRoot();
  const codexRoot = path.join(root, '.codex');
  const live = path.join(codexRoot, 'sessions', '2026', '09', '09', 'rollout.jsonl');
  const archived = path.join(codexRoot, 'archived_sessions', 'rollout.jsonl');
  writeLines(live, [
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'x'.repeat(5000) } }),
    '{bad',
    { timestamp: '2026-09-09T01:00:00Z', type: 'session_meta', payload: { id: 'rotate-me' } },
    usageLine('2026-09-09T01:00:01Z', { input_tokens: 90, output_tokens: 10 })
  ]);
  const options = {
    profiles: [{ id: 'codex-work', label: 'Work', path: codexRoot }],
    cachePath: path.join(root, 'cache.json'),
    now: new Date('2026-09-09T12:00:00Z'),
    maxLineBytes: 1024
  };
  const before = collectCodexUsageProfiles(options);
  assert.equal(before.bundle.today.totalTokens, 100);
  assert.equal(before.status[0].oversizedLines, 1);
  assert.equal(before.status[0].malformedLines, 1);
  fs.mkdirSync(path.dirname(archived), { recursive: true });
  fs.renameSync(live, archived);
  const after = collectCodexUsageProfiles(options);
  assert.equal(after.bundle.today.totalTokens, 100);
  assert.equal(Object.keys(after.bundle.today.sessions).length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('per-file byte budgets report partial progress instead of blocking on giant files', () => {
  const root = tempRoot();
  const file = path.join(root, '.codex', 'sessions', '2026', '09', '09', 'giant.jsonl');
  writeLines(file, Array.from({ length: 100 }, (_, index) => ({ timestamp: `2026-09-09T01:00:${String(index % 60).padStart(2, '0')}Z`, type: 'ignored', payload: { value: index } })));
  const started = Date.now();
  const result = collectCodexUsageProfiles({
    profiles: [{ id: 'codex-work', label: 'Work', path: root }],
    cachePath: path.join(root, 'cache.json'),
    now: new Date('2026-09-09T12:00:00Z'),
    maxBytesPerFile: 256
  });
  assert.equal(result.status[0].state, 'partial');
  assert.equal(result.status[0].pendingFiles, 1);
  assert.ok(Date.now() - started < 1000);
  fs.rmSync(root, { recursive: true, force: true });
});

test('maxFiles discovery rotates fairly and reports a truthful partial backlog', () => {
  const root = tempRoot();
  const sessions = path.join(root, '.codex', 'sessions', '2026', '09', '09');
  for (let index = 0; index < 3; index += 1) {
    writeLines(path.join(sessions, `${index}.jsonl`), [
      { timestamp: '2026-09-09T01:00:00.000Z', type: 'session_meta', payload: { id: `budget-${index}` } },
      usageLine('2026-09-09T01:00:01.000Z', { input_tokens: 100, output_tokens: 10 })
    ]);
  }
  const options = {
    profiles: [{ id: 'codex-work', label: 'Work', path: root }],
    cachePath: path.join(root, 'cache.json'),
    now: new Date('2026-09-09T12:00:00Z'),
    maxFiles: 2
  };

  const scans = Array.from({ length: 4 }, () => collectCodexUsageProfiles(options));
  assert.equal(scans.at(-1).bundle.today.totalTokens, 330);
  assert.equal(scans.at(-1).status[0].files, 3);
  assert.equal(scans.at(-1).status[0].state, 'partial');
  assert.ok(scans.at(-1).status[0].pendingFiles >= 1);
  assert.equal(scans.at(-1).status[0].truncated, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rotating discovery survives rename, insertion, deletion, and cache reloads', () => {
  const root = tempRoot();
  const sessions = path.join(root, '.codex', 'sessions', '2026', '09', '09');
  const makeFile = (name, sessionId) => {
    const file = path.join(sessions, name);
    writeLines(file, [
      { timestamp: '2026-09-09T01:00:00.000Z', type: 'session_meta', payload: { id: sessionId } },
      usageLine('2026-09-09T01:00:01.000Z', { input_tokens: 100, output_tokens: 10 })
    ]);
    return file;
  };
  const firstPath = makeFile('a.jsonl', 'change-a');
  const renamedPath = makeFile('b.jsonl', 'change-b');
  makeFile('c.jsonl', 'change-c');
  const options = {
    profiles: [{ id: 'codex-work', label: 'Work', path: root }],
    cachePath: path.join(root, 'cache.json'),
    now: new Date('2026-09-09T12:00:00Z'),
    maxFiles: 1
  };

  collectCodexUsageProfiles(options);
  fs.renameSync(renamedPath, path.join(sessions, 'z.jsonl'));
  makeFile('00-new.jsonl', 'change-new');
  for (let index = 0; index < 8; index += 1) collectCodexUsageProfiles(options);
  let result = collectCodexUsageProfiles(options);
  assert.equal(result.bundle.today.totalTokens, 440);

  fs.unlinkSync(firstPath);
  makeFile('aa-newer.jsonl', 'change-newer');
  for (let index = 0; index < 10; index += 1) result = collectCodexUsageProfiles(options);
  // Deleted logs remain as historical anonymous cache aggregates, while the
  // changed directory is still traversed and the new file is not starved.
  assert.equal(result.bundle.today.totalTokens, 550);
  const cacheText = fs.readFileSync(options.cachePath, 'utf8');
  assert.doesNotMatch(cacheText, /\.jsonl|tm-codex-profile|sessions/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('per-profile byte budgets charge actual reads for repeatedly incomplete tails', () => {
  const root = tempRoot();
  const sessions = path.join(root, '.codex', 'sessions', '2026', '09', '09');
  writeLines(path.join(sessions, 'a.jsonl'), ['x'.repeat(300)], false);
  writeLines(path.join(sessions, 'b.jsonl'), ['y'.repeat(300)], false);
  const readTotals = [];
  const options = {
    profiles: [{ id: 'codex-work', label: 'Work', path: root }],
    cachePath: path.join(root, 'cache.json'),
    now: new Date('2026-09-09T12:00:00Z'),
    maxBytesPerFile: 200,
    maxBytesPerProfile: 250,
    maxLineBytes: 1024
  };

  for (let scan = 0; scan < 2; scan += 1) {
    let bytesRead = 0;
    const result = collectCodexUsageProfiles({ ...options, onReadBytes: (value) => { bytesRead += value; } });
    readTotals.push(bytesRead);
    assert.equal(result.status[0].state, 'partial');
    const cachedEntries = Object.values(JSON.parse(fs.readFileSync(options.cachePath, 'utf8')).profiles['codex-work'].files);
    assert.ok(cachedEntries.every((entry) => entry.offset <= entry.size));
  }
  assert.deepEqual(readTotals, [250, 250]);
  fs.rmSync(root, { recursive: true, force: true });
});
