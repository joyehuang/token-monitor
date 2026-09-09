'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { profileRowsForClient } = require('../../src/electron/renderer/usageProfileRows');

test('Codex profile rows expose Personal and Work without pretending they are models', () => {
  const rows = profileRowsForClient({
    profiles: { 'codex-personal': 700, 'codex-work': 300 },
    profileCosts: { 'codex-personal': 1.2, 'codex-work': 0 },
    profileCacheReads: { 'codex-personal': 500, 'codex-work': 200 },
    profileOutputs: { 'codex-personal': 100, 'codex-work': 50 }
  }, [
    { id: 'codex-personal', client: 'codex', label: 'Personal' },
    { id: 'codex-work', client: 'codex', label: 'Work' }
  ], 'codex', { clientLabel: 'Codex', color: '#123456' });
  assert.deepEqual(rows.map((row) => [row.name, row.value]), [['Codex · Personal', 700], ['Codex · Work', 300]]);
  assert.ok(rows.every((row) => row.kind === 'profile' && row.client === 'codex'));
});
