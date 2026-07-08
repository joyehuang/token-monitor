'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveSessionFile, resolveSessionFiles } = require('../../src/shared/sessionFiles');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tm-home-'));
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

test('resolves a claude session file by walking projects', () => {
  const home = tmpHome();
  try {
    const dir = path.join(home, '.claude', 'projects', '-some-project');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'abc-123.jsonl');
    fs.writeFileSync(file, '{}\n');
    assert.equal(resolveSessionFile('claude', 'abc-123', home), file);
  } finally { cleanup(home); }
});

test('resolves claude session subagent transcripts alongside the main file', () => {
  const home = tmpHome();
  try {
    const dir = path.join(home, '.claude', 'projects', '-some-project');
    fs.mkdirSync(path.join(dir, 'abc-123', 'subagents'), { recursive: true });
    const main = path.join(dir, 'abc-123.jsonl');
    const subagent = path.join(dir, 'abc-123', 'subagents', 'agent-one.jsonl');
    fs.writeFileSync(main, '{}\n');
    fs.writeFileSync(subagent, '{}\n');
    assert.deepEqual(resolveSessionFiles('claude', 'abc-123', home), [main, subagent]);
    assert.equal(resolveSessionFile('claude', 'abc-123', home), main);
  } finally { cleanup(home); }
});

test('resolves a codex rollout via the dated path', () => {
  const home = tmpHome();
  try {
    const id = 'rollout-2026-05-30T11-44-50-019e76fc-0d58';
    const dir = path.join(home, '.codex', 'sessions', '2026', '05', '30');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(file, '{}\n');
    assert.equal(resolveSessionFile('codex', id, home), file);
  } finally { cleanup(home); }
});

test('resolves a codex session via the walk fallback when the id is not a dated rollout', () => {
  const home = tmpHome();
  try {
    const id = 'legacy-session-xyz';
    const dir = path.join(home, '.codex', 'sessions', 'archive');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(file, '{}\n');
    assert.equal(resolveSessionFile('codex', id, home), file);
  } finally { cleanup(home); }
});

test('returns empty string when not found or unknown client', () => {
  const home = tmpHome();
  try {
    assert.equal(resolveSessionFile('claude', 'missing', home), '');
    assert.equal(resolveSessionFile('hermes', 'whatever', home), '');
  } finally { cleanup(home); }
});
