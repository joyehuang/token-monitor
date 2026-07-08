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

test('sync collector pushes local fallback stats when hub ingest fails', () => {
  const main = read('src', 'electron', 'main.js');
  const helper = main.slice(
    main.indexOf('function syncFallbackStatsWithLocalDevice'),
    main.indexOf('function sendPush')
  );
  assert.match(helper, /lastRemoteStats \|\| readRemoteStatsCache\(\)/);
  assert.match(helper, /mergeLocalCollectedDevice\(cachedStats\)/);
  assert.match(helper, /aggregateDevices\(\[lastCollectedDevice\], 0\)/);

  const syncCollector = main.slice(
    main.indexOf('function startSyncCollector'),
    main.indexOf('function startHostCollector')
  );
  assert.match(syncCollector, /console\.log\(`\[sync-collector\] post failed:/);
  assert.match(syncCollector, /const fallbackStats = syncFallbackStatsWithLocalDevice\(\)/);
  assert.match(syncCollector, /reason: 'sync-fallback'/);
  assert.match(syncCollector, /sendPush\(\{ event: 'stats'/);
});
