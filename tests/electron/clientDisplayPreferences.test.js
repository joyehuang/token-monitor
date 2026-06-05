'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyClientDisplayPreferences,
  defaultClientDisplayPreferences,
  hasClientDisplayPreferences,
  moveClientDisplayOrder,
  normalizeClientDisplayOrder,
  normalizeHiddenClients,
  orderedClients,
  reorderClientDisplayOrder
} = require('../../src/electron/renderer/clientDisplayPreferences');

const clients = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'hermes', label: 'Hermes' },
  { id: 'opencode', label: 'OpenCode' }
];

test('normalizeClientDisplayOrder drops invalid entries and appends missing clients', () => {
  assert.deepEqual(
    normalizeClientDisplayOrder('hermes,unknown,hermes,codex', clients),
    ['hermes', 'codex', 'claude', 'opencode']
  );
});

test('normalizeHiddenClients keeps only known hidden clients', () => {
  assert.equal(normalizeHiddenClients('opencode,unknown,opencode,claude', clients), 'opencode,claude');
});

test('orderedClients returns client objects in the saved display order', () => {
  assert.deepEqual(
    orderedClients(clients, 'hermes,codex').map((client) => client.id),
    ['hermes', 'codex', 'claude', 'opencode']
  );
});

test('moveClientDisplayOrder swaps a client with its neighbor only when possible', () => {
  assert.equal(
    moveClientDisplayOrder('claude,codex,hermes,opencode', clients, 'hermes', 'up'),
    'claude,hermes,codex,opencode'
  );
  assert.equal(
    moveClientDisplayOrder('claude,codex,hermes,opencode', clients, 'claude', 'up'),
    'claude,codex,hermes,opencode'
  );
});

test('reorderClientDisplayOrder moves a client to a target index', () => {
  assert.equal(
    reorderClientDisplayOrder('claude,codex,hermes,opencode', clients, 'hermes', 0),
    'hermes,claude,codex,opencode'
  );
  assert.equal(
    reorderClientDisplayOrder('claude,codex,hermes,opencode', clients, 'claude', 99),
    'codex,hermes,opencode,claude'
  );
  assert.equal(
    reorderClientDisplayOrder('claude,codex,hermes,opencode', clients, 'unknown', 1),
    'claude,codex,hermes,opencode'
  );
});

test('applyClientDisplayPreferences preserves usage sort until a custom order is saved', () => {
  const rows = [
    { key: 'claude', value: 300 },
    { key: 'codex', value: 100 },
    { key: 'hermes', value: 20 }
  ];

  assert.deepEqual(
    applyClientDisplayPreferences(rows, '', 'codex', clients).map((row) => row.key),
    ['claude', 'hermes']
  );
});

test('applyClientDisplayPreferences applies custom order and hides selected clients', () => {
  const rows = [
    { key: 'claude', value: 300 },
    { key: 'codex', value: 100 },
    { key: 'gemini', value: 50 },
    { key: 'hermes', value: 20 }
  ];

  assert.deepEqual(
    applyClientDisplayPreferences(rows, 'hermes,codex', 'claude', clients).map((row) => row.key),
    ['hermes', 'codex', 'gemini']
  );
});

test('hasClientDisplayPreferences detects custom order or hidden clients', () => {
  assert.equal(hasClientDisplayPreferences('', '', clients), false);
  assert.equal(hasClientDisplayPreferences('unknown', '', clients), false);
  assert.equal(hasClientDisplayPreferences('', 'unknown', clients), false);
  assert.equal(hasClientDisplayPreferences('hermes,codex', '', clients), true);
  assert.equal(hasClientDisplayPreferences('', 'opencode', clients), true);
});

test('defaultClientDisplayPreferences clears custom display state', () => {
  assert.deepEqual(defaultClientDisplayPreferences(), {
    clientDisplayOrder: '',
    hiddenClients: ''
  });
});
