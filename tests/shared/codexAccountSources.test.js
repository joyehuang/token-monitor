'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readAccountCredential, normalizeAccountSources, bindUsageProfiles } = require('../../src/shared/codexAccountSources');
const { fetchCodexLimits, createLimitsCollector } = require('../../src/shared/limitCollector');
const { aggregateLimits, mergeTransientLimitProviders } = require('../../src/shared/limits');
const { aggregateDevices, emptyPeriod, extractUsageFromTokscale, applyPeriodDelta, summaryForWire } = require('../../src/shared/usage');
const { accountRows } = require('../../src/electron/renderer/accountOverview');
const { dedupeLimitProvidersByAccount } = require('../../src/electron/renderer/limitProviderPresentation');
function fixture(t, id = 'synthetic-a', exp = 4102444800) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-account-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const access = `fixture.${Buffer.from(JSON.stringify({ exp, 'https://api.openai.com/auth': { chatgpt_account_id: id } })).toString('base64url')}.fixture`;
  fs.writeFileSync(path.join(root, 'auth.json'), JSON.stringify({ tokens: { access_token: access, account_id: id } }), { mode: 0o600 });
  return { id, label: 'Synthetic', path: root, profileIds: ['codex-personal', 'pi-openai-codex'] };
}
const response = { rate_limit: { primary_window: { used_percent: 25, reset_at: 4102444800, limit_window_seconds: 18000 }, secondary_window: { used_percent: 40, reset_at: 4102444800, limit_window_seconds: 604800 } } };
test('readonly HTTP is pinned, never invokes RPC, credentials unchanged, no private wire fields', async (t) => {
  const source = fixture(t); const file = path.join(source.path, 'auth.json'); const before = fs.readFileSync(file);
  let calls = 0;
  const providers = await fetchCodexLimits({ codexAccountSources: [source] }, {
    readCodexRpc: () => assert.fail('RPC must not run'),
    fetch: async (url, options) => { calls++; assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage'); assert.equal(options.method, 'GET'); return { ok: true, json: async () => response }; }
  });
  assert.equal(calls, 1); assert.equal(providers[0].accountOrder, 0); assert.equal(providers[0].accountName, source.label); assert.equal(providers[0].status, 'ok'); assert.equal(providers[0].windows[0].remainingPercent, 75);
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(providers[0].accountEmail, '');
  const wire = JSON.stringify(providers); assert.ok(!wire.includes(source.path)); assert.ok(!wire.includes('fixture.')); assert.ok(!wire.includes('synthetic-a'));
});
test('expired, unauthorized and identity mismatch do not fall back to another login', async (t) => {
  const source = fixture(t, 'synthetic-expired', 1);
  const noFetch = () => assert.fail('must not request');
  assert.equal((await fetchCodexLimits({ codexAccountSources: [source] }, { fetch: noFetch }))[0].status, 'unauthorized');
  const active = fixture(t);
  const unauthorized = await fetchCodexLimits({ codexAccountSources: [active] }, { fetch: async () => ({ ok: false, status: 401 }) });
  assert.equal(unauthorized[0].status, 'unauthorized'); assert.deepEqual(unauthorized[0].windows, []);
  active.accountKey = `sha256:${'0'.repeat(64)}`;
  assert.equal((await fetchCodexLimits({ codexAccountSources: [active] }, { fetch: noFetch }))[0].status, 'unauthorized');
  assert.equal(bindUsageProfiles([{ id: 'codex-personal', client: 'codex', label: 'Personal' }], [active])[0].accountKey, undefined);
});
test('POSIX private inode and directory checks; Windows readability does not claim ACL validation', (t) => {
  const source = fixture(t); const auth = path.join(source.path, 'auth.json');
  fs.chmodSync(auth, 0o644);
  assert.throws(() => readAccountCredential(source, { platform: 'darwin' }));
  assert.ok(readAccountCredential(source, { platform: 'win32' }).accountKey);
  fs.chmodSync(auth, 0o600); fs.chmodSync(source.path, 0o777);
  assert.throws(() => readAccountCredential(source, { platform: 'darwin' }));
  fs.chmodSync(source.path, 0o700); fs.renameSync(auth, auth + '.real'); fs.symlinkSync(auth + '.real', auth);
  assert.throws(() => readAccountCredential(source));
});
test('duplicate directories and conflicting bindings never duplicate or misattribute usage', (t) => {
  const a = fixture(t, 'a'), b = fixture(t, 'b');
  assert.equal(normalizeAccountSources([a, a]).length, 1);
  const profiles = [{ id: 'codex-personal', client: 'codex', label: 'Personal' }];
  assert.ok(bindUsageProfiles(profiles, [a])[0].accountKey);
  assert.equal(bindUsageProfiles(profiles, [a, b])[0].accountKey, undefined);
});
test('structured Pi provider profile totals survive wire, delta and account aggregation without double counting requests', (t) => {
  const source = fixture(t); const key = readAccountCredential(source).accountKey;
  const period = extractUsageFromTokscale({ rows: [{ client: 'pi', provider: 'openai-codex', model: 'same', totalTokens: 10 }, { client: 'pi', provider: 'openai-codex-agent', model: 'same', totalTokens: 20 }] });
  assert.equal(period.totalTokens, 30); assert.equal(period.profiles['pi-openai-codex'], 10);
  period.profiles['codex-personal'] = 7; period.clients.codex = 7; period.totalTokens += 7;
  const profiles = bindUsageProfiles([{ id: 'codex-personal', client: 'codex', label: 'Personal' }, { id: 'pi-openai-codex', client: 'pi', label: 'Pi' }, { id: 'pi-openai-codex-agent', client: 'pi', label: 'Pi Agent' }], [source]);
  const record = summaryForWire({ deviceId: 'fixture-device', updatedAt: new Date().toISOString(), usageProfiles: profiles, today: period, week: period, month: period, allTime: period });
  const stats = aggregateDevices([record]); const rows = accountRows(stats);
  assert.equal(rows.find((r) => r.key === key).periods.today, 17);
  assert.equal(rows.find((r) => r.key.startsWith('unknown:')).periods.today, 20);
  assert.equal(stats.periods.today.totalTokens, 37);
  assert.equal(applyPeriodDelta(period, period, emptyPeriod()).profiles['pi-openai-codex'], 20);
});
test('quota latest failure remains failure, same opaque key is never summed across devices', () => {
  const key = `sha256:${'1'.repeat(64)}`;
  const old = { provider: 'codex', accountKey: key, source: 'oauth', sourceDetail: 'readonly', status: 'ok', updatedAt: '2026-09-10T10:00:00Z', windows: [{ kind: 'session', usedPercent: 20 }] };
  const failed = { ...old, status: 'unavailable', updatedAt: '2026-09-10T10:01:00Z', windows: [] };
  assert.equal(mergeTransientLimitProviders({ providers: [old] }, { providers: [failed] }).providers[0].status, 'unavailable');
  const limits = aggregateLimits([{ deviceId: 'a', limits: { providers: [old] } }, { deviceId: 'b', limits: { providers: [failed] } }], 600000, Date.parse('2026-09-10T10:01:01Z'));
  assert.equal(limits.providers.length, 1); assert.equal(limits.providers[0].status, 'unavailable'); assert.equal(limits.providers[0].sourceDeviceId, 'b');
  assert.equal(dedupeLimitProvidersByAccount([old, { ...old, accountKey: `sha256:${'2'.repeat(64)}` }]).length, 2);
});
test('readonly quota uses existing polling cache', async (t) => {
  const source = fixture(t); let requests = 0;
  const collector = createLimitsCollector({ limitProviders: 'codex', codexAccountSources: [source] }, { fetch: async () => { requests++; return { ok: true, json: async () => response }; } });
  await collector.snapshot(); await collector.snapshot(); assert.equal(requests, 1);
});

test('unlinking the last readonly source never resumes automatic live RPC', async () => {
  assert.deepEqual(await fetchCodexLimits({ codexReadonlyMode: true, codexAccountSources: [] }, { readCodexRpc: () => assert.fail('unexpected RPC') }), []);
});

test('an unpinned readonly source does not hide a different managed account', async (t) => {
  const source = fixture(t); let rpcCalls = 0;
  const result = await fetchCodexLimits({ codexAccountSources: [source], codexManagedAccounts: [{ id: 'managed-fixture', homePath: path.join(source.path, 'managed') }] }, {
    readCodexRpc: async () => { rpcCalls++; return { rateLimits: { primary: { usedPercent: 5, windowDurationMins: 300 } } }; },
    fetch: async () => ({ ok: true, json: async () => response })
  });
  assert.equal(rpcCalls, 1); assert.equal(result.length, 2);
});
test('readonly weekly-only response stays healthy without manufacturing a session window', async (t) => {
  const source = fixture(t);
  const weeklyOnly = { plan_type: 'pro', rate_limit: { primary_window: { used_percent: 35, reset_at: 4102444800, limit_window_seconds: 604800 } } };
  const providers = await fetchCodexLimits({ codexAccountSources: [source] }, {
    readCodexRpc: () => assert.fail('RPC must not run'),
    fetch: async () => ({ ok: true, json: async () => weeklyOnly })
  });
  assert.equal(providers[0].status, 'ok');
  assert.deepEqual(providers[0].windows.map((window) => window.kind), ['weekly']);
});
