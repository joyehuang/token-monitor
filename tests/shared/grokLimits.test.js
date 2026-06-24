'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  grokCredential,
  readAuthJson,
  parseGrokBilling,
  fetchGrokLimits,
  parseLimitProviders
} = require('../../src/shared/limitCollector');

function writeAuthJson(homeDir, entries) {
  const filePath = path.join(homeDir, 'auth.json');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(entries));
  return filePath;
}

test('parseLimitProviders includes grok in the default provider set', () => {
  assert.deepEqual(
    parseLimitProviders(),
    ['claude', 'codex', 'cursor', 'antigravity', 'opencode', 'deepseek', 'minimax', 'grok']
  );
});

test('grokCredential reads GROK_BEARER_TOKEN from env', () => {
  const c = grokCredential({ GROK_BEARER_TOKEN: 'eyJtest.eyJ.signature' }, {});
  assert.equal(c.token, 'eyJtest.eyJ.signature');
  assert.equal(c.source, 'env');
});

test('grokCredential strips quotes from env value', () => {
  const c = grokCredential({ GROK_BEARER_TOKEN: ' "eyJquoted.signature" ' }, {});
  assert.equal(c.token, 'eyJquoted.signature');
  assert.equal(c.source, 'env');
});

test('grokCredential reads from explicit grokBearerToken option', () => {
  const c = grokCredential({}, { grokBearerToken: 'eyJexplicit' });
  assert.equal(c.token, 'eyJexplicit');
  assert.equal(c.source, 'settings');
});

test('grokCredential returns null when nothing is configured', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-test-'));
  const c = grokCredential({}, { grokHome: path.join(tmp, 'no-such-dir') });
  assert.equal(c, null);
});

test('readAuthJson prefers OIDC scope entries', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-auth-'));
  writeAuthJson(home, {
    'https://auth.x.ai::client': { key: 'eyJ-oidc.signature' },
    'https://accounts.x.ai/sign-in': { key: 'eyJ-legacy.signature' }
  });
  const c = readAuthJson({}, { grokHome: home });
  assert.equal(c.token, 'eyJ-oidc.signature');
  assert.equal(c.source, 'auth.json-oidc');
});

test('readAuthJson falls back to legacy /sign-in when no OIDC entry', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-auth-'));
  writeAuthJson(home, {
    'https://accounts.x.ai/sign-in': { key: 'eyJ-legacy.signature' }
  });
  const c = readAuthJson({}, { grokHome: home });
  assert.equal(c.token, 'eyJ-legacy.signature');
  assert.equal(c.source, 'auth.json-legacy');
});

test('readAuthJson falls back to any entry with a non-empty key', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-auth-'));
  writeAuthJson(home, {
    'custom-scope://example': { key: 'eyJ-custom.signature' }
  });
  const c = readAuthJson({}, { grokHome: home });
  assert.equal(c.token, 'eyJ-custom.signature');
  assert.match(c.source, /^auth\.json:/);
});

test('readAuthJson returns null when file is missing', () => {
  const c = readAuthJson({}, { grokHome: path.join(os.tmpdir(), 'grok-missing-' + Date.now()) });
  assert.equal(c, null);
});

test('readAuthJson returns null when file contains invalid JSON', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-bad-'));
  fs.writeFileSync(path.join(home, 'auth.json'), 'not json');
  assert.equal(readAuthJson({}, { grokHome: home }), null);
});

test('readAuthJson returns null when no entry has a non-empty key', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-empty-'));
  writeAuthJson(home, { 'scope://x': { key: '' } });
  assert.equal(readAuthJson({}, { grokHome: home }), null);
});

test('parseGrokBilling produces a single monthly window from a typical response', () => {
  const body = {
    config: {
      monthlyLimit: 100,
      used: 67,
      onDemandCap: 50,
      onDemandUsed: 5,
      billingPeriodEnd: '2026-07-01T00:00:00Z',
      billingPeriodStart: '2026-06-01T00:00:00Z'
    }
  };
  const windows = parseGrokBilling(body);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].kind, 'session');
  assert.equal(windows[0].label, 'Monthly');
  assert.equal(windows[0].usedPercent, 67);
  assert.equal(windows[0].resetsAt, '2026-07-01T00:00:00.000Z');
});

test('parseGrokBilling throws when monthly window cannot be built', () => {
  // monthlyLimit present but 0 → no usable window
  const body = { config: { monthlyLimit: 0, used: 0, onDemandCap: 100, onDemandUsed: 200 } };
  assert.throws(() => parseGrokBilling(body), /no monthly quota/);
});

test('fetchGrokLimits returns notConfigured when no credential is available', async () => {
  const r = await fetchGrokLimits(
    {},
    { env: {}, grokHome: path.join(os.tmpdir(), 'grok-nonexistent-' + Date.now()), now: () => 1_716_350_000_000 }
  );
  assert.equal(r.provider, 'grok');
  assert.equal(r.status, 'notConfigured');
  assert.deepEqual(r.windows, []);
});

test('fetchGrokLimits returns ok with monthly window from JSON billing response', async () => {
  const body = {
    config: {
      monthlyLimit: 100,
      used: 67,
      billingPeriodEnd: '2026-07-01T00:00:00Z'
    }
  };
  let capturedAuth = '';
  const r = await fetchGrokLimits(
    { grokBearerToken: 'eyJsecret.signature' },
    {
      env: {},
      now: () => 1_716_350_000_000,
      fetch: async (url, init) => {
        assert.equal(url, 'https://cli-chat-proxy.grok.com/v1/billing');
        capturedAuth = init.headers.Authorization;
        return { status: 200, ok: true, json: async () => body };
      }
    }
  );
  assert.equal(r.provider, 'grok');
  assert.equal(r.status, 'ok');
  assert.equal(r.accountLabel, 'SuperGrok');
  assert.match(r.accountKey, /^sha256:/);
  assert.equal(capturedAuth, 'Bearer eyJsecret.signature');
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].label, 'Monthly');
  assert.equal(r.windows[0].usedPercent, 67);
  assert.equal(r.windows[0].resetsAt, '2026-07-01T00:00:00.000Z');
  assert.ok(!JSON.stringify(r).includes('eyJsecret'));
});

test('fetchGrokLimits maps HTTP 401 to unauthorized', async () => {
  const r = await fetchGrokLimits(
    { grokBearerToken: 'eyJ' },
    { env: {}, fetch: async () => ({ status: 401, ok: false, json: async () => ({}) }) }
  );
  assert.equal(r.status, 'unauthorized');
  assert.deepEqual(r.windows, []);
});

test('fetchGrokLimits maps non-2xx (non-auth) to unavailable', async () => {
  const r = await fetchGrokLimits(
    { grokBearerToken: 'eyJ' },
    { env: {}, fetch: async () => ({ status: 500, ok: false, json: async () => ({}) }) }
  );
  assert.equal(r.status, 'unavailable');
});

test('fetchGrokLimits maps a body missing config to unavailable', async () => {
  const r = await fetchGrokLimits(
    { grokBearerToken: 'eyJ' },
    { env: {}, fetch: async () => ({ status: 200, ok: true, json: async () => ({}) }) }
  );
  assert.equal(r.status, 'unavailable');
  assert.deepEqual(r.windows, []);
});

test('fetchGrokLimits maps fetch network error to unavailable', async () => {
  const r = await fetchGrokLimits(
    { grokBearerToken: 'eyJ' },
    { env: {}, fetch: async () => { throw new Error('ECONNREFUSED'); } }
  );
  assert.equal(r.status, 'unavailable');
});

test('fetchGrokLimits prefers explicit grokBearerToken over env', async () => {
  let capturedAuth = '';
  await fetchGrokLimits(
    { grokBearerToken: 'eyJsettings' },
    {
      env: { GROK_BEARER_TOKEN: 'eyJenv' },
      fetch: async (_url, init) => {
        capturedAuth = init.headers.Authorization;
        return { status: 200, ok: true, json: async () => ({ config: { monthlyLimit: 1, used: 0 } }) };
      }
    }
  );
  assert.equal(capturedAuth, 'Bearer eyJsettings');
});

test('fetchGrokLimits prefers env over ~/.grok/auth.json', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-fallback-'));
  writeAuthJson(home, { 'https://auth.x.ai::client': { key: 'eyJfromfile.signature' } });
  let capturedAuth = '';
  await fetchGrokLimits(
    {},
    {
      env: { GROK_BEARER_TOKEN: 'eyJenv' },
      grokHome: home,
      fetch: async (_url, init) => {
        capturedAuth = init.headers.Authorization;
        return { status: 200, ok: true, json: async () => ({ config: { monthlyLimit: 1, used: 0 } }) };
      }
    }
  );
  assert.equal(capturedAuth, 'Bearer eyJenv');
});

test('fetchGrokLimits falls back to ~/.grok/auth.json when no env or settings', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-fallback-'));
  writeAuthJson(home, { 'https://auth.x.ai::client': { key: 'eyJfromfile.signature' } });
  let capturedAuth = '';
  await fetchGrokLimits(
    {},
    {
      env: {},
      grokHome: home,
      fetch: async (_url, init) => {
        capturedAuth = init.headers.Authorization;
        return { status: 200, ok: true, json: async () => ({ config: { monthlyLimit: 1, used: 0 } }) };
      }
    }
  );
  assert.equal(capturedAuth, 'Bearer eyJfromfile.signature');
});

test('fetchGrokLimits returns notConfigured when real ~/.grok/auth.json has no usable key', async () => {
  // Point grokHome at a directory that does NOT contain an auth.json. This
  // is the only way to deterministically get notConfigured — any other path
  // could read the user's real ~/.grok/auth.json and return ok.
  const r = await fetchGrokLimits(
    {},
    { env: {}, grokHome: path.join(os.tmpdir(), 'grok-definitely-missing-' + Date.now() + '-' + Math.random()) }
  );
  assert.equal(r.status, 'notConfigured');
});