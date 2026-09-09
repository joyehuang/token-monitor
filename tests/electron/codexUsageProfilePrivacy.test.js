'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('configured private profiles never expose transcript filenames in watcher IPC reasons', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared', 'collector.js'), 'utf8');
  const callback = source.match(/watcher\.on\('all', ([\s\S]*?)\);/)[1];
  const reasons = [];
  const build = new Function('privateRoots', 'scheduleTick', 'path', `return (${callback});`);
  const filename = '/private/work/sessions/rollout-secret-session.jsonl';
  build([{ id: 'codex-work' }], (reason) => reasons.push(reason), path)('change', filename);
  assert.deepEqual(reasons, ['watch:change:usage-metadata']);
  assert.doesNotMatch(JSON.stringify(reasons), /secret-session|private\/work/);
  build([], (reason) => reasons.push(reason), path)('change', filename);
  assert.equal(reasons[1], 'watch:change:rollout-secret-session.jsonl');
});

test('renderer settings redact Codex usage source paths and generic updates cannot replace them', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'electron', 'main.js'), 'utf8');
  assert.match(source, /codexUsageProfiles:\s*\(settings\?\.codexUsageProfiles \|\| \[\]\)\.map\(\(\{ id, label, enabled \}\)/);
  assert.match(source, /delete normalizedPatch\.codexUsageProfiles;/);
  assert.match(source, /codexUsageProfiles:\s*normalizeCodexUsageProfileSettings\(settings\.codexUsageProfiles\)/);
  assert.doesNotMatch(source, /codexUsageProfiles:\s*patch\.codexUsageProfiles/);
});
