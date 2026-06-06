'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererDir = path.join(__dirname, '..', '..', 'src', 'electron', 'renderer');

function readRendererFile(name) {
  return fs.readFileSync(path.join(rendererDir, name), 'utf8');
}

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} function should exist`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.notEqual(end, -1, `${nextName} function should follow ${name}`);
  return source.slice(start, end);
}

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule should exist`);
  return match[1];
}

test('preference drag only selects sortable rows, not nested controls', () => {
  const body = functionBody(readRendererFile('app.js'), 'preferenceRows', 'preferenceOrder');
  assert.match(body, /\.tool-preference-row\[data-client\]/);
  assert.match(body, /\.limit-provider-row\[data-provider\]/);
  assert.match(body, /\.view-preference-row\[data-view\]/);
  assert.doesNotMatch(body, /querySelectorAll\(`\\\[data-\$\{attr\}\\\]`\)/);
});

test('preference drag does not animate row transforms during pointer movement', () => {
  const app = readRendererFile('app.js');
  const css = readRendererFile('styles.css');
  assert.doesNotMatch(app, /animatePreferenceOrderChange/);
  assert.doesNotMatch(app, /translateY\(/);
  assert.doesNotMatch(cssRule(css, '.tool-preference-row'), /transform/);
  assert.doesNotMatch(cssRule(css, '.view-preference-row'), /transform/);
  assert.doesNotMatch(cssRule(css, '.settings-panel .limit-provider-row'), /transform/);
  assert.doesNotMatch(cssRule(css, '.preference-order-handle'), /transition:\s*transform/);
});

test('tool preference controls use compact header actions without icon-only legends', () => {
  const html = readRendererFile('index.html');
  const group = html.match(/<div class="settings-group">\s*<div class="settings-group-header settings-tools-header">[\s\S]*?<div id="clientDisplayList"/)?.[0] || '';
  assert.match(group, /<div class="settings-group-header settings-tools-header">/);
  assert.match(group, /<div class="tool-header-actions">/);
  assert.match(group, /class="tool-header-action"/);
  assert.doesNotMatch(group, /<div class="settings-actions tool-settings-actions">/);
  assert.doesNotMatch(group, /class="tool-preference-head"/);
  assert.doesNotMatch(group, /tool-preference-legend-/);

  const css = readRendererFile('styles.css');
  assert.match(cssRule(css, '.tool-preference-row'), /grid-template-columns:\s*minmax\(0,\s*1fr\) repeat\(4,\s*22px\)/);
  assert.match(cssRule(css, '.tool-preference-actions'), /display:\s*contents/);
  assert.doesNotMatch(css, /\.tool-preference-head/);
  assert.doesNotMatch(css, /\.tool-preference-legend-/);
});

test('tool preference rows include compact per-tool pin controls', () => {
  const body = functionBody(readRendererFile('app.js'), 'renderToolPreferences', 'renderLimitProviderCheckboxes');
  assert.match(body, /tool-pin-button/);
  assert.match(body, /settings\.tools\.pinClient/);
  assert.match(body, /settings\.tools\.unpinClient/);
  assert.match(body, /onClientPinnedToggle/);
});

test('view preferences use compact visibility and order controls', () => {
  const html = readRendererFile('index.html');
  const group = html.match(/<div class="settings-group">\s*<div class="settings-group-header settings-views-header">[\s\S]*?<div id="viewDisplayList"/)?.[0] || '';
  assert.match(group, /<div class="settings-group-header settings-views-header">/);
  assert.match(group, /<div class="tool-header-actions">/);
  assert.match(group, /id="resetViewDisplayOrderButton"/);
  assert.match(group, /id="showAllViewsButton"/);
  assert.doesNotMatch(group, /class="view-preference-head"/);

  const body = functionBody(readRendererFile('app.js'), 'renderViewPreferences', 'renderToolPreferences');
  assert.match(body, /view-preference-row/);
  assert.match(body, /settings\.views\.hideView/);
  assert.match(body, /settings\.views\.showView/);
  assert.match(body, /createPreferenceOrderHandle\(\{ kind: 'view'/);
});

test('renderer applies the first visible view on cold startup only', () => {
  const app = readRendererFile('app.js');
  const body = functionBody(app, 'applyInitialBreakdownPreference', 'syncSettingsForm');
  assert.match(body, /initialBreakdownPreferenceApplied/);
  assert.match(body, /preferFirst:\s*true/);
  assert.match(body, /preferredViewId/);

  const syncBody = functionBody(app, 'syncSettingsForm', 'enabledClientSet');
  assert.match(syncBody, /applyInitialBreakdownPreference\(\)/);
});
