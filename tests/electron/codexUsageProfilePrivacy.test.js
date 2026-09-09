'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('renderer settings redact Codex usage source paths and generic updates cannot replace them', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'electron', 'main.js'), 'utf8');
  assert.match(source, /codexUsageProfiles:\s*\(settings\?\.codexUsageProfiles \|\| \[\]\)\.map\(\(\{ id, label, enabled \}\)/);
  assert.match(source, /delete normalizedPatch\.codexUsageProfiles;/);
  assert.match(source, /codexUsageProfiles:\s*normalizeCodexUsageProfileSettings\(settings\.codexUsageProfiles\)/);
  assert.doesNotMatch(source, /codexUsageProfiles:\s*patch\.codexUsageProfiles/);
});
