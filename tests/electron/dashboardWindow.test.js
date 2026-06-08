'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(rootDir, ...p), 'utf8');

test('preload exposes the dashboard IPC surface', () => {
  const preload = read('src', 'electron', 'preload.js');
  assert.match(preload, /openDashboard: \(\) => ipcRenderer\.invoke\('dashboard:open'\)/);
  assert.match(preload, /getDashboardHistory: \(\) => ipcRenderer\.invoke\('dashboard:getHistory'\)/);
  assert.match(preload, /dashboard: \{/);
  assert.match(preload, /minimize: \(\) => ipcRenderer\.send\('dashboard:minimize'\)/);
  assert.match(preload, /close: \(\) => ipcRenderer\.send\('dashboard:close'\)/);
});

test('main registers dashboard handlers and a sender-scoped close', () => {
  const main = read('src', 'electron', 'main.js');
  assert.match(main, /ipcMain\.handle\('dashboard:open'/);
  assert.match(main, /ipcMain\.handle\('dashboard:getHistory'/);
  assert.match(main, /ipcMain\.on\('dashboard:close'/);
  assert.match(main, /BrowserWindow\.fromWebContents\(event\.sender\)/);
  assert.match(main, /function createDashboardWindow/);
  assert.match(main, /function getDashboardHistory/);
});

test('getDashboardHistory mirrors the local/sync split of fetchStats', () => {
  const main = read('src', 'electron', 'main.js');
  assert.match(main, /aggregateHistory\(localDevice \? \[localDevice\] : \[\], 0\)/);
  assert.match(main, /\/api\/history/);
});

test('dashboard history is gated by the historyEnabled setting', () => {
  const main = read('src', 'electron', 'main.js');
  assert.match(main, /historyEnabled:\s*false/);
  assert.match(main, /historyEnabled:\s*parseBoolean\(patch\.historyEnabled[\s\S]*?,\s*false\)/);
  assert.match(main, /if \(settings\?\.historyEnabled === false\) return aggregateHistory\(\[\], 0\)/);
  assert.match(main, /historyEnabled:\s*settings\.historyEnabled !== false/);
});

test('agent history collection is opt-in by default', () => {
  const agent = read('src', 'agent', 'agent.js');
  const envExample = read('.env.example');
  const readme = read('README.md');
  assert.match(agent, /TOKEN_MONITOR_HISTORY_ENABLED,\s*false\)/);
  assert.match(envExample, /TOKEN_MONITOR_HISTORY_ENABLED=0/);
  assert.match(readme, /TOKEN_MONITOR_HISTORY_ENABLED=/);
});

test('dashboard.html wires the shared modules and the two panels', () => {
  const html = read('src', 'electron', 'renderer', 'dashboard.html');
  assert.match(html, /<link rel="stylesheet" href="styles\.css" \/>/);
  assert.match(html, /<link rel="stylesheet" href="dashboard\.css" \/>/);
  assert.match(html, /<script src="usageCharts\.js"><\/script>/);
  assert.match(html, /<script src="i18n\.js"><\/script>/);
  assert.match(html, /<script src="\.\.\/\.\.\/shared\/currency\.js"><\/script>/);
  assert.match(html, /<script src="dashboard\.js"><\/script>/);
  assert.match(html, /id="trendsTab"/);
  assert.match(html, /id="activityTab"/);
  assert.match(html, /id="dashChart"/);
  assert.match(html, /id="dashHeatmap"/);
  assert.match(html, /id="dashCards"/);
  assert.match(html, /data-control="mode"/);
  assert.match(html, /data-control="stack"/);
  assert.match(html, /id="rangeSelect"/);
});

test('dashboard.css declares chart classes and a flat theme override', () => {
  const css = read('src', 'electron', 'renderer', 'dashboard.css');
  assert.match(css, /\.candle-up/);
  assert.match(css, /\.candle-down/);
  assert.match(css, /\.heat\.lvl-4/);
  assert.match(css, /body\.flat/);
});

test('dashboard.js fetches history over IPC and renders both tabs', () => {
  const js = read('src', 'electron', 'renderer', 'dashboard.js');
  assert.match(js, /window\.tokenMonitor\.getDashboardHistory\(\)/);
  assert.match(js, /charts\.barsChartSvg/);
  assert.match(js, /charts\.candleChartSvg/);
  assert.match(js, /charts\.heatmapSvg/);
  assert.match(js, /updateSettings\(\{ dashboardFlat: state\.flat \}\)/);
  assert.match(js, /dashboard\.minimize\(\)/);
});

test('the trends preview opens the dashboard via IPC', () => {
  const app = read('src', 'electron', 'renderer', 'app.js');
  assert.match(app, /trendsPanel\.addEventListener/);
  assert.match(app, /window\.tokenMonitor\.openDashboard\(\)/);
});

test('renderer removes Trends from available views when history is disabled', () => {
  const app = read('src', 'electron', 'renderer', 'app.js');
  assert.match(app, /state\.settings\?\.historyEnabled === false/);
  assert.match(app, /order\.filter\(\(id\) => id !== 'trends'\)/);
});
