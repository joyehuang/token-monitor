'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { collectUsageOnce, configFingerprint } = require('../../src/shared/collector');
const { emptyPeriod } = require('../../src/shared/usage');

function tokscaleCodex(tokens, session = 'personal-session') {
  return [{ client: 'codex', model: 'gpt-5', sessionId: session, totalTokens: tokens, inputTokens: tokens - 10, outputTokens: 10 }];
}

function workBundle(tokens) {
  const makePeriod = () => {
    const period = emptyPeriod();
    period.totalTokens = tokens;
    period.outputTokens = 20;
    period.clients.codex = tokens;
    period.clientOutputs.codex = 20;
    period.models['gpt-5'] = tokens;
    period.modelOutputs['gpt-5'] = 20;
    period.clientModels.codex = { 'gpt-5': tokens };
    period.profiles['codex-work'] = tokens;
    period.profileOutputs['codex-work'] = 20;
    period.profileModels['codex-work'] = { 'gpt-5': tokens };
    period.sessions['codex:codex-work:same-session'] = {
      client: 'codex', profileId: 'codex-work', sessionId: 'same-session', detailAvailable: false,
      totalTokens: tokens, inputTokens: tokens - 20, outputTokens: 20, models: { 'gpt-5': tokens }, modelCosts: {}
    };
    return period;
  };
  return { today: makePeriod(), week: makePeriod(), month: makePeriod(), allTime: makePeriod() };
}

function workPricingComponents(tokens) {
  const session = {
    profileId: 'codex-work',
    models: { 'gpt-5': { inputTokens: tokens - 20, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } }
  };
  return { today: { 'codex:codex-work:same-session': session }, week: { 'codex:codex-work:same-session': session }, month: { 'codex:codex-work:same-session': session }, allTime: { 'codex:codex-work:same-session': session } };
}

test('collector preserves the Codex total while exposing Personal and Work components', async () => {
  const homeDir = path.join(os.tmpdir(), 'tm-profile-collector-home');
  const result = await collectUsageOnce({
    clients: 'codex',
    allTimeSince: '2024-01-01',
    deviceId: 'device-a',
    now: new Date('2026-09-09T12:00:00Z'),
    homeDir,
    codexUsageProfiles: [{ id: 'codex-work', label: 'Work', path: path.join(os.tmpdir(), 'tm-work-codex') }],
    runTokscale: async () => tokscaleCodex(100, 'same-session'),
    collectCodexProfiles: () => ({
      metadata: [
        { id: 'codex-personal', client: 'codex', label: 'Personal' },
        { id: 'codex-work', client: 'codex', label: 'Work' }
      ],
      status: [{ id: 'codex-work', label: 'Work', state: 'active', files: 1, malformedLines: 0, oversizedLines: 0, pendingFiles: 0 }],
      bundle: workBundle(200),
      pricingComponents: workPricingComponents(200)
    }),
    lookupModelPricing: async () => ({ pricing: { inputCostPerToken: 0.000001, outputCostPerToken: 0.00001 } }),
    wslScanEnabled: false,
    limitsEnabled: false,
    historyEnabled: false
  });
  assert.equal(result.today.totalTokens, 300);
  assert.equal(result.today.clients.codex, 300);
  assert.deepEqual(result.today.profiles, { 'codex-personal': 100, 'codex-work': 200 });
  assert.equal(Object.values(result.today.profiles).reduce((sum, value) => sum + value, 0), result.today.clients.codex);
  assert.equal(result.today.models['gpt-5'], 300);
  assert.equal(result.today.profileCosts['codex-work'], 0.00038);
  assert.equal(result.today.clientCosts.codex, 0.00038);
  assert.equal(result.today.sessions['codex:same-session'].profileId, 'codex-personal');
  assert.equal(result.today.sessions['codex:codex-work:same-session'].detailAvailable, false);
  assert.deepEqual(result.usageProfiles.map((profile) => profile.label), ['Personal', 'Work']);
});

test('today-only delta applies combined Personal and Work changes exactly', async () => {
  const makePeriod = (tokens, personal, work) => {
    const period = emptyPeriod();
    period.totalTokens = tokens;
    period.clients.codex = tokens;
    period.profiles = { 'codex-personal': personal, 'codex-work': work };
    return period;
  };
  const anchor = {
    dateKey: '2026-09-09',
    today: makePeriod(300, 100, 200),
    week: makePeriod(1200, 500, 700),
    month: makePeriod(3000, 1400, 1600),
    allTime: makePeriod(9000, 5000, 4000)
  };
  const bundle = workBundle(230);
  const result = await collectUsageOnce({
    clients: 'codex', allTimeSince: '2024-01-01', deviceId: 'device-a',
    now: new Date('2026-09-09T12:00:00Z'), homeDir: path.join(os.tmpdir(), 'tm-profile-anchor-home'),
    codexUsageProfiles: [{ id: 'codex-work', label: 'Work', path: path.join(os.tmpdir(), 'tm-work-codex-2') }],
    todayOnlyAnchor: anchor,
    runTokscale: async () => tokscaleCodex(120),
    collectCodexProfiles: () => ({ metadata: [], status: [], bundle, pricingComponents: workPricingComponents(230) }),
    lookupModelPricing: async () => ({ pricing: { inputCostPerToken: 0, outputCostPerToken: 0 } }),
    wslScanEnabled: false, limitsEnabled: false, historyEnabled: false
  });
  assert.equal(result.today.totalTokens, 350);
  assert.equal(result.week.totalTokens, 1250);
  assert.equal(result.month.totalTokens, 3050);
  assert.equal(result.allTime.totalTokens, 9050);
  assert.deepEqual(result.week.profiles, { 'codex-personal': 520, 'codex-work': 730 });
});

test('collector anchor fingerprint changes when a profile source changes', () => {
  const first = configFingerprint('codex', '2024-01-01', [{ id: 'codex-work', label: 'Work', path: '/placeholder/one' }], { homeDir: '/placeholder/personal' });
  const second = configFingerprint('codex', '2024-01-01', [{ id: 'codex-work', label: 'Work', path: '/placeholder/two' }], { homeDir: '/placeholder/personal' });
  assert.notEqual(first, second);
});
