'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(rootDir, ...p), 'utf8');

test('settings loader tolerates UTF-8 BOM and preserves invalid files', () => {
  const main = read('src', 'electron', 'main.js');
  assert.match(main, /JSON\.parse\(raw\.replace\(\/\^\\uFEFF\/,\s*''\)\)/);
  assert.match(main, /settings\.invalid-\$\{stamp\}\.json/);
  assert.match(main, /fs\.copyFileSync\(settingsPath,\s*invalidPath\)/);
});

test('sync stats keep a remote cache for disconnected hubs', () => {
  const main = read('src', 'electron', 'main.js');
  assert.match(main, /function remoteStatsCachePath\(\)/);
  assert.match(main, /remote-stats-cache\.json/);
  assert.match(main, /writeRemoteStatsCache\(lastRemoteStats\)/);
  assert.match(main, /const cachedStats = lastRemoteStats \|\| readRemoteStatsCache\(\)/);
  assert.match(main, /lastRemoteStats = mergeLocalCollectedDevice\(cachedStats\)/);
  assert.match(main, /return lastRemoteStats/);
});
