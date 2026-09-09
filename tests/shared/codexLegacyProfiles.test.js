'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateDevices } = require('../../src/shared/usage');

test('mixed-version history preserves an explicit legacy bucket without guessing account identity', () => {
  const old = { deviceId: 'old', allTime: { totalTokens: 100, clients: { codex: 100 }, clientCosts: { codex: 1 }, clientModels: { codex: { model: 100 } } } };
  const current = { deviceId: 'new', usageProfiles: [{ id: 'codex-personal', client: 'codex', label: 'Personal' }, { id: 'codex-work', client: 'codex', label: 'Work' }], allTime: { totalTokens: 80, clients: { codex: 80 }, profiles: { 'codex-personal': 20, 'codex-work': 30 }, clientCosts: { codex: 0.8 }, profileCosts: { 'codex-personal': 0.2, 'codex-work': 0.3 }, clientModels: { codex: { model: 80 } }, profileModels: { 'codex-personal': { model: 20 }, 'codex-work': { model: 30 } } } };
  const before = JSON.stringify([old, current]);
  const result = aggregateDevices([old, current], 0);
  const p = result.periods.allTime;
  assert.deepEqual(p.profiles, { 'codex-legacy': 130, 'codex-personal': 20, 'codex-work': 30 });
  assert.equal(Object.values(p.profiles).reduce((a, b) => a + b, 0), p.clients.codex);
  assert.ok(Math.abs(p.profileCosts['codex-legacy'] - 1.3) < 1e-9);
  assert.equal(p.profileModels['codex-legacy'].model, 130);
  assert.equal(JSON.stringify([old, current]), before);
  assert.equal(result.usageProfiles.filter((x) => x.id === 'codex-legacy').length, 1);
  assert.deepEqual(aggregateDevices(result.devices, 0).periods.allTime.profiles, p.profiles);
});

test('old-only installs keep the existing empty profile shape', () => {
  const result = aggregateDevices([{ deviceId: 'old', usageProfiles: {}, allTime: { clients: { codex: 100 }, totalTokens: 100 } }], 0);
  assert.deepEqual(result.periods.allTime.profiles, {});
  assert.deepEqual(result.usageProfiles, []);
});
