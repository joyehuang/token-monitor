'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { codexCommandCandidates, codexCommandSourceDetail, createLimitsCollector, fetchCodexLimits, mapCodexRateLimitsToProvider } = require('../../src/shared/limitCollector');
const { hashAccountKey } = require('../../src/shared/codexAuth');

function successfulCodexRpcChild() {
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write(line) {
      const message = JSON.parse(String(line));
      const respond = (result) => {
        queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({ id: message.id, result })}\n`));
      };
      if (message.method === 'initialize') respond({});
      if (message.method === 'account/rateLimits/read') {
        respond({
          rateLimits: {
            primary: { usedPercent: 10, resetsAt: '2026-07-10T07:51:20Z', windowDurationMins: 300 },
            secondary: { usedPercent: 2, resetsAt: '2026-07-17T02:51:20Z', windowDurationMins: 10080 }
          }
        });
      }
      if (message.method === 'account/read') respond({ account: { planType: 'plus' } });
    }
  };
  child.kill = () => {};
  return child;
}

function dirent(name, directory = true) {
  return {
    name,
    isDirectory: () => directory
  };
}

test('Codex command candidates include Microsoft Store app installs on Windows', () => {
  const programFiles = 'C:\\Program Files';
  const appxDir = path.win32.join(programFiles, 'WindowsApps');
  const oldAppxPackage = 'OpenAI.Codex_26.601.2237.0_x64__2p2nqsd0c76g0';
  const appxPackage = 'OpenAI.Codex_26.602.4764.0_x64__2p2nqsd0c76g0';
  const expectedResourceCli = path.win32.join(appxDir, appxPackage, 'app', 'resources', 'codex.exe');
  const expectedAppExe = path.win32.join(appxDir, appxPackage, 'app', 'Codex.exe');
  const oldAppExe = path.win32.join(appxDir, oldAppxPackage, 'app', 'Codex.exe');

  const candidates = codexCommandCandidates({
    ProgramFiles: programFiles,
    APPDATA: 'C:\\Users\\Javis\\AppData\\Roaming'
  }, 'win32', {
    readdirSync: (dir) => {
      assert.equal(dir, appxDir);
      return [dirent(oldAppxPackage), dirent(appxPackage), dirent('Other.App_1.0.0_x64__id')];
    }
  });

  assert.equal(candidates.includes(expectedResourceCli), true);
  assert.equal(candidates.includes(expectedAppExe), true);
  assert.ok(candidates.indexOf(expectedResourceCli) < candidates.indexOf(expectedAppExe));
  assert.ok(candidates.indexOf(expectedResourceCli) < candidates.indexOf(oldAppExe));
});

test('Codex command candidates include app-managed local binaries on Windows', () => {
  const localAppData = 'C:\\Users\\Javis\\AppData\\Local';
  const localBin = path.win32.join(localAppData, 'OpenAI', 'Codex', 'bin');
  const packageBin = path.win32.join(
    localAppData,
    'Packages',
    'OpenAI.Codex_2p2nqsd0c76g0',
    'LocalCache',
    'Local',
    'OpenAI',
    'Codex',
    'bin'
  );
  const expectedLocal = path.win32.join(localBin, 'codex.exe');
  const expectedLocalVersioned = path.win32.join(localBin, '716dda49c14d31a0', 'codex.exe');
  const expectedPackage = path.win32.join(packageBin, 'codex.exe');
  const expectedAlias = path.win32.join(localAppData, 'Microsoft', 'WindowsApps', 'codex.exe');
  const impossibleNodeCandidate = path.win32.join(localBin, 'node.exe', 'codex.exe');
  const impossibleCodexExeCandidate = path.win32.join(localBin, 'codex.exe', 'codex.exe');

  const candidates = codexCommandCandidates({
    LOCALAPPDATA: localAppData
  }, 'win32', {
    readdirSync: (dir) => {
      if (dir === localBin) {
        return [
          dirent('716dda49c14d31a0'),
          dirent('codex.exe', false),
          dirent('node.exe', false),
          dirent('rg.exe', false)
        ];
      }
      if (dir === path.win32.join(localAppData, 'Packages')) {
        return [dirent('OpenAI.Codex_2p2nqsd0c76g0'), dirent('Other.App')];
      }
      if (dir === packageBin) return [];
      return [];
    }
  });

  assert.equal(candidates.includes(expectedLocal), true);
  assert.equal(candidates.includes(expectedLocalVersioned), true);
  assert.equal(candidates.includes(expectedPackage), true);
  assert.equal(candidates.includes(impossibleNodeCandidate), false);
  assert.equal(candidates.includes(impossibleCodexExeCandidate), false);
  assert.ok(candidates.indexOf(expectedLocal) < candidates.indexOf(expectedAlias));
});

test('Codex command source detail separates app-managed binaries from CLI commands', () => {
  assert.equal(
    codexCommandSourceDetail('C:\\Users\\Javis\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe', 'win32'),
    'app'
  );
  assert.equal(
    codexCommandSourceDetail('C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.602.4764.0_x64__id\\app\\resources\\codex.exe', 'win32'),
    'app'
  );
  assert.equal(
    codexCommandSourceDetail('C:\\Users\\Javis\\AppData\\Roaming\\npm\\codex.cmd', 'win32'),
    'cli'
  );
  assert.equal(codexCommandSourceDetail('codex.cmd', 'win32'), 'cli');
  assert.equal(codexCommandSourceDetail('/Applications/ChatGPT.app/Contents/Resources/codex', 'darwin'), 'app');
  assert.equal(codexCommandSourceDetail('/Applications/Codex.app/Contents/Resources/codex', 'darwin'), 'app');
});

test('Codex command candidates prefer the ChatGPT embedded binary before legacy app and PATH on macOS', () => {
  const candidates = codexCommandCandidates({ HOME: '/Users/tester', PATH: '/usr/bin' }, 'darwin');

  assert.deepEqual(candidates.slice(0, 5), [
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Users/tester/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Users/tester/Applications/Codex.app/Contents/Resources/codex',
    'codex'
  ]);
});

test('fetchCodexLimits uses the ChatGPT embedded binary when the legacy app is absent', async () => {
  const chatGptCodex = '/Applications/ChatGPT.app/Contents/Resources/codex';
  const spawned = [];
  const provider = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-07-10T03:00:00Z'),
    platform: 'darwin',
    env: { PATH: '/usr/bin' },
    existsSync: (candidate) => candidate === chatGptCodex,
    readFileSync: () => { throw new Error('no auth.json'); },
    spawn: (command) => {
      spawned.push(command);
      return successfulCodexRpcChild();
    }
  });

  assert.deepEqual(spawned, [chatGptCodex]);
  assert.equal(provider.sourceDetail, 'app');
  assert.deepEqual(provider.windows.map((window) => [window.kind, window.usedPercent, window.resetsAt]), [
    ['session', 10, '2026-07-10T07:51:20.000Z'],
    ['weekly', 2, '2026-07-17T02:51:20.000Z']
  ]);
});

test('Codex RPC falls through a broken app binary to the next candidate', async () => {
  const chatGptCodex = '/Applications/ChatGPT.app/Contents/Resources/codex';
  const legacyCodex = '/Applications/Codex.app/Contents/Resources/codex';
  const spawned = [];
  const provider = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-07-10T03:00:00Z'),
    platform: 'darwin',
    env: { PATH: '/usr/bin' },
    existsSync: (candidate) => candidate === chatGptCodex || candidate === legacyCodex,
    readFileSync: () => { throw new Error('no auth.json'); },
    spawn: (command) => {
      spawned.push(command);
      if (command === chatGptCodex) {
        const error = new Error('embedded binary missing');
        error.code = 'ENOENT';
        throw error;
      }
      return successfulCodexRpcChild();
    }
  });

  assert.deepEqual(spawned, [chatGptCodex, legacyCodex]);
  assert.equal(provider.status, 'ok');
  assert.equal(provider.sourceDetail, 'app');
});

test('Codex provider preserves source detail for renderer labels', () => {
  const provider = mapCodexRateLimitsToProvider({
    account: { email: 'user@example.com', planType: 'plus' },
    rateLimits: {
      primary: {
        usedPercent: 12,
        resetsAt: '2026-06-01T00:00:00Z',
        windowDurationMins: 300
      }
    }
  }, {
    source: 'rpc',
    sourceDetail: 'app',
    updatedAt: '2026-06-01T00:00:00Z'
  });

  assert.equal(provider.source, 'rpc');
  assert.equal(provider.sourceDetail, 'app');
  assert.equal(provider.accountEmail, 'user@example.com');
});

test('Codex provider reads quota windows from alternate rate limit ids', () => {
  const provider = mapCodexRateLimitsToProvider({
    account: { email: 'user@example.com', planType: 'plus' },
    rateLimits: { planType: 'plus' },
    rateLimitsByLimitId: {
      'gpt-5.4': {
        primary: {
          usedPercent: 10,
          resetsAt: '2026-06-01T05:00:00Z',
          windowDurationMins: 300
        },
        secondary: {
          usedPercent: 25,
          resetsAt: '2026-06-07T00:00:00Z',
          windowDurationMins: 10080
        }
      }
    }
  }, {
    source: 'rpc',
    sourceDetail: 'app',
    updatedAt: '2026-06-01T00:00:00Z'
  });

  assert.equal(provider.status, 'ok');
  assert.deepEqual(provider.windows.map((window) => window.kind), ['session', 'weekly']);
  assert.equal(provider.windows[0].remainingPercent, 90);
  assert.equal(provider.windows[1].remainingPercent, 75);
});

test('Codex provider keeps successful empty quota reads as ok', () => {
  const provider = mapCodexRateLimitsToProvider({
    account: { email: 'user@example.com', planType: 'plus' },
    rateLimits: { planType: 'plus' },
    rateLimitsByLimitId: {}
  }, {
    source: 'rpc',
    sourceDetail: 'app',
    updatedAt: '2026-06-01T00:00:00Z'
  });

  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountLabel, 'Plus');
  assert.deepEqual(provider.windows, []);
});

test('Codex provider supports managed-account source detail', () => {
  const provider = mapCodexRateLimitsToProvider({
    account: { email: 'managed@example.com', planType: 'plus' },
    rateLimits: {
      primary: {
        usedPercent: 8,
        resetsAt: '2026-06-01T00:00:00Z',
        windowDurationMins: 300
      }
    }
  }, {
    source: 'rpc',
    sourceDetail: 'managed',
    accountKey: 'sha256:managed',
    updatedAt: '2026-06-01T00:00:00Z'
  });

  assert.equal(provider.sourceDetail, 'managed');
  assert.equal(provider.accountKey, 'sha256:managed');
  assert.equal(provider.accountEmail, 'managed@example.com');
});

function codexPayload(email, sourceDetail) {
  return {
    account: { email, planType: 'plus' },
    rateLimits: { primary: { usedPercent: 12, resetsAt: '2026-06-01T05:00:00Z', windowDurationMins: 300 } },
    sourceDetail
  };
}

function codexProvider(accountKey, accountEmail, remainingPercent, updatedAt) {
  return {
    provider: 'codex',
    accountKey,
    accountEmail,
    accountLabel: 'Plus',
    status: 'ok',
    source: 'rpc',
    sourceDetail: 'managed',
    updatedAt,
    windows: [
      {
        kind: 'session',
        usedPercent: 100 - remainingPercent,
        remainingPercent,
        resetsAt: '2026-06-01T05:00:00Z',
        windowMinutes: 300
      }
    ]
  };
}

function makeIdToken(payload) {
  const seg = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${seg({ alg: 'none' })}.${seg(payload)}.`;
}

// The live account's auth.json is never read in tests unless a test opts in.
const noLiveAuth = { readFileSync: () => { throw new Error('no auth.json'); } };

function codexOAuthUsageTestDeps({ usageResponse, usageStatus = 200, usageRequests = [] }) {
  const idToken = makeIdToken({ email: 'live@example.com', chatgpt_account_id: 'acct_live' });
  return {
    env: { PATH: '/usr/bin', CODEX_HOME: '/tmp/token-monitor-codex/live' },
    codexAuthPath: '/tmp/token-monitor-codex/live/auth.json',
    readFileSync: (file) => {
      if (String(file).endsWith('auth.json')) {
        return JSON.stringify({ tokens: { access_token: 'access-token', id_token: idToken } });
      }
      if (String(file).endsWith('config.toml')) {
        return 'chatgpt_base_url = "https://chatgpt.com/backend-api/"\n';
      }
      throw new Error(`unexpected read ${file}`);
    },
    fetch: async (url, options) => {
      if (url.endsWith('/wham/usage')) {
        usageRequests.push({ url, options });
        return {
          ok: usageStatus >= 200 && usageStatus < 300,
          status: usageStatus,
          json: async () => usageResponse
        };
      }
      if (url.endsWith('/wham/rate-limit-reset-credits')) {
        return { ok: true, status: 200, json: async () => ({ available_count: 0, credits: [] }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }
  };
}

test('fetchCodexLimits returns one provider per managed Codex account', async () => {
  const seenHomes = [];
  const providers = await fetchCodexLimits({
    codexManagedAccounts: [
      { id: 'one', email: 'one@example.com', homePath: '/tmp/token-monitor-codex/one' },
      { id: 'two', email: 'two@example.com', homePath: '/tmp/token-monitor-codex/two' }
    ]
  }, {
    now: () => Date.parse('2026-06-01T00:00:00Z'),
    env: { PATH: '/usr/bin' },
    readCodexRpc: async (deps) => {
      // No live login configured in this scenario; only the managed homes resolve.
      if (!deps.env.CODEX_HOME) throw Object.assign(new Error('Codex account not configured'), { status: 'notConfigured' });
      seenHomes.push(deps.env.CODEX_HOME);
      const email = deps.env.CODEX_HOME.endsWith('/one') ? 'one@example.com' : 'two@example.com';
      return codexPayload(email);
    }
  });

  assert.deepEqual(seenHomes, ['/tmp/token-monitor-codex/one', '/tmp/token-monitor-codex/two']);
  assert.equal(providers.length, 2);
  assert.deepEqual(providers.map((provider) => provider.accountEmail), ['one@example.com', 'two@example.com']);
  assert.deepEqual(providers.map((provider) => provider.sourceDetail), ['managed', 'managed']);
});

test('createLimitsCollector retains recent Codex quota windows across one empty refresh', async () => {
  let now = Date.parse('2026-06-01T00:00:00Z');
  let calls = 0;
  const collector = createLimitsCollector({
    limitProviders: 'codex',
    limitsRefreshMs: 60_000
  }, {
    now: () => now,
    providerFetchers: {
      codex: async () => {
        calls += 1;
        const provider = codexProvider('sha256:codex-a', 'a@example.com', 80, new Date(now).toISOString());
        return calls === 1 ? provider : { ...provider, windows: [] };
      }
    }
  });

  const first = await collector.snapshot(true);
  now = Date.parse('2026-06-01T00:05:00Z');
  const second = await collector.snapshot(true);

  assert.equal(first.providers[0].windows.length, 1);
  assert.equal(second.providers[0].windows.length, 1);
  assert.equal(second.providers[0].windows[0].remainingPercent, 80);
  assert.equal(second.providers[0].updatedAt, '2026-06-01T00:00:00.000Z');
});

test('createLimitsCollector confirms a new Codex reset across three refreshes', async () => {
  const previous = codexProvider('sha256:codex-a', 'a@example.com', 16, '2026-06-14T10:25:00.000Z');
  previous.windows[0].resetsAt = '2026-06-14T14:51:20.000Z';
  const alternate = codexProvider('sha256:codex-a', 'a@example.com', 90, '2026-06-14T10:41:00.000Z');
  alternate.windows[0].resetsAt = '2026-06-14T15:22:06.000Z';
  let calls = 0;
  const collector = createLimitsCollector({
    limitProviders: 'codex',
    limitsRefreshMs: 60_000,
    initialLimits: {
      updatedAt: '2026-06-14T10:25:00.000Z',
      refreshMs: 60_000,
      providers: [previous]
    }
  }, {
    now: () => Date.parse('2026-06-14T10:41:00.000Z'),
    providerFetchers: {
      codex: async () => {
        calls += 1;
        return calls <= 3 ? alternate : previous;
      }
    }
  });

  const first = await collector.snapshot(true);
  const second = await collector.snapshot(true);
  const third = await collector.snapshot(true);
  const fourth = await collector.snapshot(true);

  assert.equal(first.providers[0].windows[0].usedPercent, 84);
  assert.equal(second.providers[0].windows[0].usedPercent, 84);
  assert.equal(second.providers[0].windows[0].resetsAt, '2026-06-14T14:51:20.000Z');
  assert.equal(third.providers[0].windows[0].usedPercent, 10);
  assert.equal(third.providers[0].windows[0].remainingPercent, 90);
  assert.equal(third.providers[0].windows[0].resetsAt, '2026-06-14T15:22:06.000Z');
  assert.equal(fourth.providers[0].windows[0].usedPercent, 10);
  assert.equal(fourth.providers[0].windows[0].resetsAt, '2026-06-14T15:22:06.000Z');
});

test('fetchCodexLimits skips disabled managed Codex accounts', async () => {
  const seenHomes = [];
  const providers = await fetchCodexLimits({
    codexManagedAccounts: [
      { id: 'one', email: 'one@example.com', homePath: '/tmp/token-monitor-codex/one', enabled: true },
      { id: 'two', email: 'two@example.com', homePath: '/tmp/token-monitor-codex/two', enabled: false }
    ]
  }, {
    now: () => Date.parse('2026-06-01T00:00:00Z'),
    env: { PATH: '/usr/bin' },
    readCodexRpc: async (deps) => {
      if (!deps.env.CODEX_HOME) throw Object.assign(new Error('Codex account not configured'), { status: 'notConfigured' });
      seenHomes.push(deps.env.CODEX_HOME);
      return codexPayload('one@example.com');
    }
  });

  assert.deepEqual(seenHomes, ['/tmp/token-monitor-codex/one']);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].accountEmail, 'one@example.com');
});

test('fetchCodexLimits keeps the live system account visible alongside managed accounts', async () => {
  const seenHomes = [];
  const providers = await fetchCodexLimits({
    codexManagedAccounts: [
      { id: 'two', email: 'two@example.com', homePath: '/tmp/token-monitor-codex/two' }
    ]
  }, {
    now: () => Date.parse('2026-06-01T00:00:00Z'),
    env: { PATH: '/usr/bin' },
    ...noLiveAuth,
    readCodexRpc: async (deps) => {
      const home = deps.env.CODEX_HOME || '<live>';
      seenHomes.push(home);
      return home === '<live>'
        ? codexPayload('live@example.com', 'app')
        : codexPayload('two@example.com');
    }
  });

  // The live login (the account the Codex app uses) is probed first and stays visible.
  assert.deepEqual(seenHomes, ['<live>', '/tmp/token-monitor-codex/two']);
  assert.deepEqual(providers.map((provider) => provider.accountEmail), ['live@example.com', 'two@example.com']);
  assert.deepEqual(providers.map((provider) => provider.sourceDetail), ['app', 'managed']);
});

test('fetchCodexLimits does not show the live account twice when it is also managed', async () => {
  const providers = await fetchCodexLimits({
    codexManagedAccounts: [
      { id: 'a', email: 'a@example.com', homePath: '/tmp/token-monitor-codex/a' }
    ]
  }, {
    now: () => Date.parse('2026-06-01T00:00:00Z'),
    env: { PATH: '/usr/bin' },
    ...noLiveAuth,
    readCodexRpc: async (deps) => codexPayload('a@example.com', deps.env.CODEX_HOME ? undefined : 'app')
  });

  assert.equal(providers.length, 1);
  assert.equal(providers[0].accountEmail, 'a@example.com');
  assert.equal(providers[0].sourceDetail, 'app');
});

test('fetchCodexLimits dedups the live account against the same managed account by account id (no email needed)', async () => {
  const sharedKey = hashAccountKey('acct_shared');
  const idToken = makeIdToken({ chatgpt_account_id: 'acct_shared' }); // no email claim
  const providers = await fetchCodexLimits({
    codexManagedAccounts: [
      { id: 'm', email: '', accountKey: sharedKey, homePath: '/tmp/token-monitor-codex/m' }
    ]
  }, {
    now: () => Date.parse('2026-06-01T00:00:00Z'),
    env: { PATH: '/usr/bin' },
    codexAuthPath: '/fake/.codex/auth.json',
    readFileSync: () => JSON.stringify({ tokens: { id_token: idToken } }),
    readCodexRpc: async (deps) => ({
      account: { planType: 'plus' },
      rateLimits: { primary: { usedPercent: 3, resetsAt: '2026-06-01T05:00:00Z', windowDurationMins: 300 } },
      sourceDetail: deps.env.CODEX_HOME ? undefined : 'app'
    })
  });

  assert.equal(providers.length, 1);
  assert.equal(providers[0].accountKey, sharedKey);
  assert.equal(providers[0].sourceDetail, 'app'); // the live representation is kept
});

test('fetchCodexLimits fills the live account email from auth.json when the RPC omits it', async () => {
  const idToken = makeIdToken({ email: 'live@example.com', chatgpt_account_id: 'acct_live' });
  const providers = await fetchCodexLimits({
    codexManagedAccounts: [
      { id: 'm', email: 'managed@example.com', accountKey: 'sha256:managed', homePath: '/tmp/token-monitor-codex/m' }
    ]
  }, {
    now: () => Date.parse('2026-06-01T00:00:00Z'),
    env: { PATH: '/usr/bin' },
    codexAuthPath: '/fake/.codex/auth.json',
    readFileSync: (p) => {
      assert.equal(p, '/fake/.codex/auth.json');
      return JSON.stringify({ tokens: { id_token: idToken } });
    },
    readCodexRpc: async (deps) => {
      // Live RPC returns no email (the real-world bug); managed home returns its own.
      if (!deps.env.CODEX_HOME) {
        return { account: { planType: 'plus' }, rateLimits: { primary: { usedPercent: 2, resetsAt: '2026-06-01T05:00:00Z', windowDurationMins: 300 } }, sourceDetail: 'app' };
      }
      return codexPayload('managed@example.com');
    }
  });

  const live = providers.find((provider) => provider.sourceDetail === 'app');
  assert.ok(live, 'live account should be present');
  assert.equal(live.accountEmail, 'live@example.com');
  assert.match(live.accountKey, /^sha256:[0-9a-f]{64}$/);
});

test('fetchCodexLimits keeps live RPC when a recent session snapshot has a different future reset anchor', async () => {
  const providers = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-06-01T00:05:00Z'),
    env: { PATH: '/usr/bin' },
    ...noLiveAuth,
    readCodexRpc: async () => ({
      account: { email: 'live@example.com', planType: 'plus' },
      rateLimits: {
        primary: { usedPercent: 53, resetsAt: '2026-06-01T05:00:00Z', windowDurationMins: 300 },
        secondary: { usedPercent: 53, resetsAt: '2026-06-07T00:00:00Z', windowDurationMins: 10080 }
      },
      sourceDetail: 'app'
    }),
    readCodexSessionRateLimits: () => ({
      timestampMs: Date.parse('2026-06-01T00:04:00Z'),
      rateLimits: {
        plan_type: 'prolite',
        primary: { used_percent: 4, resets_at: '2026-06-01T05:30:00Z', window_minutes: 300 },
        secondary: { used_percent: 2, resets_at: '2026-06-08T00:00:00Z', window_minutes: 10080 }
      }
    })
  });

  assert.equal(providers.accountEmail, 'live@example.com');
  assert.equal(providers.accountLabel, 'Plus');
  assert.deepEqual(providers.windows.map((window) => [window.kind, window.usedPercent, window.remainingPercent, window.windowMinutes]), [
    ['session', 53, 47, 300],
    ['weekly', 53, 47, 10080]
  ]);
  assert.equal(providers.windows[0].resetsAt, '2026-06-01T05:00:00.000Z');
});

test('fetchCodexLimits keeps the higher usage when RPC and session snapshots share a reset window', async () => {
  const provider = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-06-01T00:05:00Z'),
    env: { PATH: '/usr/bin' },
    ...noLiveAuth,
    readCodexRpc: async () => ({
      account: { planType: 'plus' },
      rateLimits: {
        primary: { usedPercent: 32, resetsAt: '2026-06-01T05:00:00Z', windowDurationMins: 300 },
        secondary: { usedPercent: 12, resetsAt: '2026-06-07T00:00:00Z', windowDurationMins: 10080 }
      },
      sourceDetail: 'app'
    }),
    readCodexSessionRateLimits: () => ({
      timestampMs: Date.parse('2026-06-01T00:04:00Z'),
      rateLimits: {
        primary: { used_percent: 30, resets_at: '2026-06-01T05:00:00Z', window_minutes: 300 },
        secondary: { used_percent: 10, resets_at: '2026-06-07T00:00:00Z', window_minutes: 10080 }
      }
    })
  });

  assert.deepEqual(provider.windows.map((window) => [window.kind, window.usedPercent]), [
    ['session', 32],
    ['weekly', 12]
  ]);
});

test('fetchCodexLimits accepts a lower percentage after RPC advances to a new reset cycle', async () => {
  const provider = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-06-01T05:05:00Z'),
    env: { PATH: '/usr/bin' },
    ...noLiveAuth,
    readCodexRpc: async () => ({
      account: { planType: 'plus' },
      rateLimits: {
        primary: { usedPercent: 2, resetsAt: '2026-06-01T10:00:00Z', windowDurationMins: 300 }
      },
      sourceDetail: 'app'
    }),
    readCodexSessionRateLimits: () => ({
      timestampMs: Date.parse('2026-06-01T05:04:00Z'),
      rateLimits: {
        primary: { used_percent: 98, resets_at: '2026-06-01T05:00:00Z', window_minutes: 300 }
      }
    })
  });

  assert.equal(provider.windows[0].usedPercent, 2);
  assert.equal(provider.windows[0].resetsAt, '2026-06-01T10:00:00.000Z');
});

test('fetchCodexLimits uses a recent session snapshot after the RPC reset window has expired', async () => {
  const provider = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-06-01T05:05:00Z'),
    env: { PATH: '/usr/bin' },
    ...noLiveAuth,
    readCodexRpc: async () => ({
      account: { planType: 'plus' },
      rateLimits: {
        primary: { usedPercent: 98, resetsAt: '2026-06-01T05:00:00Z', windowDurationMins: 300 }
      },
      sourceDetail: 'app'
    }),
    readCodexSessionRateLimits: () => ({
      timestampMs: Date.parse('2026-06-01T05:04:00Z'),
      rateLimits: {
        primary: { used_percent: 2, resets_at: '2026-06-01T10:00:00Z', window_minutes: 300 }
      }
    })
  });

  assert.equal(provider.windows[0].usedPercent, 2);
  assert.equal(provider.windows[0].resetsAt, '2026-06-01T10:00:00.000Z');
});

test('fetchCodexLimits ignores old Codex session rate-limit snapshots', async () => {
  const providers = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-06-01T01:00:00Z'),
    env: { PATH: '/usr/bin' },
    ...noLiveAuth,
    readCodexRpc: async () => ({
      account: { email: 'live@example.com', planType: 'plus' },
      rateLimits: {
        primary: { usedPercent: 53, resetsAt: '2026-06-01T05:00:00Z', windowDurationMins: 300 }
      },
      sourceDetail: 'app'
    }),
    readCodexSessionRateLimits: () => ({
      timestampMs: Date.parse('2026-06-01T00:00:00Z'),
      rateLimits: {
        primary: { used_percent: 4, resets_at: '2026-06-01T05:30:00Z', window_minutes: 300 }
      }
    })
  });

  assert.equal(providers.windows[0].usedPercent, 53);
  assert.equal(providers.windows[0].remainingPercent, 47);
  assert.equal(providers.windows[0].resetsAt, '2026-06-01T05:00:00.000Z');
});

test('fetchCodexLimits retries empty Codex quota reads on the same RPC session', async () => {
  const { EventEmitter } = require('node:events');
  let spawns = 0;
  let rateLimitReads = 0;
  const providers = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-06-01T00:00:00Z'),
    env: { PATH: '/usr/bin' },
    codexCommand: 'codex',
    codexEmptyQuotaRetryDelayMs: 0,
    ...noLiveAuth,
    spawn: () => {
      spawns += 1;
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        write(line) {
          const message = JSON.parse(String(line));
          const respond = (result) => {
            queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({ id: message.id, result })}\n`));
          };
          if (message.method === 'initialize') respond({});
          if (message.method === 'account/rateLimits/read') {
            rateLimitReads += 1;
            respond(rateLimitReads === 1
              ? {
                  rateLimits: { planType: 'plus' },
                  rateLimitsByLimitId: {}
                }
              : {
                  rateLimits: {
                    primary: {
                      usedPercent: 4,
                      resetsAt: '2026-06-01T05:00:00Z',
                      windowDurationMins: 300
                    }
                  }
                });
          }
          if (message.method === 'account/read') respond({ account: { email: 'live@example.com', planType: 'plus' } });
        }
      };
      child.kill = () => {};
      return child;
    }
  });

  assert.equal(spawns, 1);
  assert.equal(rateLimitReads, 2);
  assert.equal(providers.status, 'ok');
  assert.equal(providers.accountLabel, 'Plus');
  assert.equal(providers.windows[0].remainingPercent, 96);
});

test('fetchCodexLimits does not retry usage-based Codex plans without quota windows', async () => {
  const { EventEmitter } = require('node:events');
  const cases = [
    { planType: 'enterprise_cbp_usage_based', label: 'Enterprise' },
    { planType: 'self serve business usage based', label: 'Business' }
  ];

  for (const { planType, label } of cases) {
    let spawns = 0;
    let rateLimitReads = 0;
    const providers = await fetchCodexLimits({}, {
      now: () => Date.parse('2026-06-01T00:00:00Z'),
      env: { PATH: '/usr/bin' },
      codexCommand: 'codex',
      codexEmptyQuotaRetryDelayMs: 0,
      ...noLiveAuth,
      spawn: () => {
        spawns += 1;
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdin = {
          write(line) {
            const message = JSON.parse(String(line));
            const respond = (result) => {
              queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({ id: message.id, result })}\n`));
            };
            if (message.method === 'initialize') respond({});
            if (message.method === 'account/rateLimits/read') {
              rateLimitReads += 1;
              respond({
                rateLimits: { planType },
                rateLimitsByLimitId: {}
              });
            }
            if (message.method === 'account/read') respond({ account: { email: 'live@example.com', planType } });
          }
        };
        child.kill = () => {};
        return child;
      }
    });

    assert.equal(spawns, 1);
    assert.equal(rateLimitReads, 1);
    assert.equal(providers.status, 'ok');
    assert.equal(providers.accountLabel, label);
    assert.deepEqual(providers.windows, []);
  }
});

test('Codex exhausted quota remains a live provider with zero remaining window', () => {
  const provider = mapCodexRateLimitsToProvider({
    account: { planType: 'plus' },
    rateLimits: {
      rateLimitReachedType: 'primary',
      primary: {
        usedPercent: 100,
        resetsAt: '2026-06-01T05:00:00Z',
        windowDurationMins: 300
      },
      secondary: {
        usedPercent: 39,
        resetsAt: '2026-06-06T00:00:00Z',
        windowDurationMins: 10080
      }
    }
  }, {
    source: 'rpc',
    sourceDetail: 'app',
    updatedAt: '2026-06-01T00:00:00Z'
  });

  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountLabel, 'Plus');
  assert.equal(provider.windows[0].kind, 'session');
  assert.equal(provider.windows[0].remainingPercent, 0);
  assert.equal(provider.windows[1].kind, 'weekly');
  assert.equal(provider.windows[1].remainingPercent, 61);
});

test('Codex provider preserves manual reset credits from RPC payload', () => {
  const provider = mapCodexRateLimitsToProvider({
    account: { planType: 'plus' },
    rateLimits: {
      primary: {
        usedPercent: 54,
        resetsAt: 1782801999,
        windowDurationMins: 300
      },
      secondary: {
        usedPercent: 8,
        resetsAt: 1783388799,
        windowDurationMins: 10080
      }
    },
    rateLimitResetCredits: {
      availableCount: 2,
      nextExpiresAt: '2026-07-18T23:00:00Z',
      expirations: [
        '2026-07-18T23:00:00Z',
        '2026-07-19T01:00:00Z'
      ]
    }
  }, {
    source: 'rpc',
    sourceDetail: 'app',
    updatedAt: '2026-06-30T00:00:00Z'
  });

  assert.deepEqual(provider.resetCredits, {
    availableCount: 2,
    nextExpiresAt: '2026-07-18T23:00:00.000Z',
    expirations: [
      '2026-07-18T23:00:00.000Z',
      '2026-07-19T01:00:00.000Z'
    ]
  });
});

test('fetchCodexLimits keeps reset credits returned by the Codex RPC reader', async () => {
  const { EventEmitter } = require('node:events');
  const providers = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-06-30T00:00:00Z'),
    env: { PATH: '/usr/bin' },
    codexCommand: 'codex',
    ...noLiveAuth,
    spawn: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        write(line) {
          const message = JSON.parse(String(line));
          const respond = (result) => {
            queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({ id: message.id, result })}\n`));
          };
          if (message.method === 'initialize') respond({});
          if (message.method === 'account/rateLimits/read') {
            respond({
              rateLimits: {
                primary: { usedPercent: 54, resetsAt: '2026-06-30T05:00:00Z', windowDurationMins: 300 },
                secondary: { usedPercent: 8, resetsAt: '2026-07-07T00:00:00Z', windowDurationMins: 10080 }
              },
              rateLimitResetCredits: { availableCount: 2 }
            });
          }
          if (message.method === 'account/read') respond({ account: { email: 'live@example.com', planType: 'plus' } });
        }
      };
      child.kill = () => {};
      return child;
    }
  });

  assert.equal(providers.resetCredits.availableCount, 2);
});

test('fetchCodexLimits augments reset credits expiry from the Codex OAuth endpoint', async () => {
  const idToken = makeIdToken({ email: 'live@example.com', chatgpt_account_id: 'acct_live' });
  const fetches = [];
  const providers = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-06-30T00:00:00Z'),
    env: { PATH: '/usr/bin', CODEX_HOME: '/tmp/token-monitor-codex/live' },
    codexAuthPath: '/tmp/token-monitor-codex/live/auth.json',
    codexCommand: 'codex',
    readFileSync: (file) => {
      if (String(file).endsWith('auth.json')) {
        return JSON.stringify({ tokens: { access_token: 'access-token', id_token: idToken } });
      }
      if (String(file).endsWith('config.toml')) {
        return 'chatgpt_base_url = "https://chatgpt.com/backend-api/"\n';
      }
      throw new Error(`unexpected read ${file}`);
    },
    fetch: async (url, options) => {
      fetches.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          credits: [
            {
              id: 'expired',
              status: 'available',
              expires_at: '2026-06-17T00:39:53Z'
            },
            {
              id: 'later',
              status: 'available',
              expires_at: '2026-07-18T00:39:53.731630Z'
            },
            {
              id: 'earlier',
              status: 'available',
              expires_at: '2026-07-12T04:03:43.263391Z'
            },
            {
              id: 'future-status',
              status: 'future_status',
              expires_at: '2026-07-10T04:03:43Z'
            }
          ],
          available_count: 2
        })
      };
    },
    readCodexRpc: async () => ({
      account: { email: 'live@example.com', planType: 'plus' },
      rateLimits: {
        primary: { usedPercent: 54, resetsAt: '2026-06-30T05:00:00Z', windowDurationMins: 300 }
      },
      rateLimitResetCredits: { availableCount: 2 },
      sourceDetail: 'app'
    })
  });

  const resetCreditsFetch = fetches.find(({ url }) => url.endsWith('/wham/rate-limit-reset-credits'));
  assert.ok(resetCreditsFetch);
  assert.equal(resetCreditsFetch.url, 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits');
  assert.equal(resetCreditsFetch.options.headers.authorization, 'Bearer access-token');
  assert.equal(resetCreditsFetch.options.headers['chatgpt-account-id'], 'acct_live');
  assert.equal(resetCreditsFetch.options.headers['openai-beta'], 'codex-1');
  assert.equal(resetCreditsFetch.options.headers.originator, 'Codex Desktop');
  assert.deepEqual(providers.resetCredits, {
    availableCount: 2,
    nextExpiresAt: '2026-07-12T04:03:43.263Z',
    expirations: [
      '2026-07-12T04:03:43.263Z',
      '2026-07-18T00:39:53.731Z'
    ]
  });
});

test('fetchCodexLimits prefers account-scoped OAuth usage over conflicting RPC and session snapshots', async () => {
  const usageRequests = [];
  const provider = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-07-10T03:55:00Z'),
    ...codexOAuthUsageTestDeps({
      usageRequests,
      usageResponse: {
        plan_type: 'plus',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 69,
            limit_window_seconds: 18_000,
            reset_after_seconds: 14_180,
            reset_at: 1_783_669_880
          },
          secondary_window: {
            used_percent: 11,
            limit_window_seconds: 604_800,
            reset_after_seconds: 600_380,
            reset_at: 1_784_256_680
          }
        }
      }
    }),
    readCodexRpc: async () => ({
      account: { planType: 'plus' },
      rateLimits: {
        primary: { usedPercent: 8, resetsAt: 1_783_671_726, windowDurationMins: 300 },
        secondary: { usedPercent: 1, resetsAt: 1_784_258_526, windowDurationMins: 10080 }
      },
      sourceDetail: 'app'
    }),
    readCodexSessionRateLimits: () => ({
      timestampMs: Date.parse('2026-07-10T03:54:30Z'),
      rateLimits: {
        primary: { used_percent: 97, resets_at: 1_783_672_000, window_minutes: 300 },
        secondary: { used_percent: 22, resets_at: 1_784_258_800, window_minutes: 10080 }
      }
    })
  });

  assert.equal(usageRequests.length, 1);
  assert.equal(usageRequests[0].url, 'https://chatgpt.com/backend-api/wham/usage');
  assert.equal(usageRequests[0].options.headers.authorization, 'Bearer access-token');
  assert.equal(usageRequests[0].options.headers['chatgpt-account-id'], 'acct_live');
  assert.deepEqual(provider.windows.map((window) => [window.kind, window.usedPercent, window.resetsAt]), [
    ['session', 69, '2026-07-10T07:51:20.000Z'],
    ['weekly', 11, '2026-07-17T02:51:20.000Z']
  ]);
});

test('fetchCodexLimits keeps the stricter RPC window when OAuth returns the lower alternate', async () => {
  const provider = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-07-10T03:55:00Z'),
    ...codexOAuthUsageTestDeps({
      usageResponse: {
        plan_type: 'plus',
        rate_limit: {
          primary_window: { used_percent: 8, limit_window_seconds: 18_000, reset_at: 1_783_671_726 },
          secondary_window: { used_percent: 1, limit_window_seconds: 604_800, reset_at: 1_784_258_526 }
        }
      }
    }),
    readCodexRpc: async () => ({
      account: { planType: 'plus' },
      rateLimits: {
        primary: { usedPercent: 69, resetsAt: 1_783_669_880, windowDurationMins: 300 },
        secondary: { usedPercent: 11, resetsAt: 1_784_256_680, windowDurationMins: 10080 }
      },
      sourceDetail: 'app'
    }),
    readCodexSessionRateLimits: () => null
  });

  assert.deepEqual(provider.windows.map((window) => [window.kind, window.usedPercent, window.resetsAt]), [
    ['session', 69, '2026-07-10T07:51:20.000Z'],
    ['weekly', 11, '2026-07-17T02:51:20.000Z']
  ]);
});

test('fetchCodexLimits falls back to RPC when account-scoped OAuth usage fails', async () => {
  const usageRequests = [];
  const provider = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-07-10T03:55:00Z'),
    ...codexOAuthUsageTestDeps({ usageRequests, usageResponse: {}, usageStatus: 503 }),
    readCodexRpc: async () => ({
      account: { planType: 'plus' },
      rateLimits: {
        primary: { usedPercent: 43, resetsAt: '2026-07-10T07:51:20Z', windowDurationMins: 300 },
        secondary: { usedPercent: 7, resetsAt: '2026-07-17T02:51:20Z', windowDurationMins: 10080 }
      },
      sourceDetail: 'app'
    }),
    readCodexSessionRateLimits: () => null
  });

  assert.deepEqual(usageRequests.map(({ url }) => url), ['https://chatgpt.com/backend-api/wham/usage']);
  assert.deepEqual(provider.windows.map((window) => [window.kind, window.usedPercent, window.resetsAt]), [
    ['session', 43, '2026-07-10T07:51:20.000Z'],
    ['weekly', 7, '2026-07-17T02:51:20.000Z']
  ]);
});

test('fetchCodexLimits maps snake_case OAuth usage windows to 5h and weekly resets', async () => {
  const provider = await fetchCodexLimits({}, {
    now: () => Date.parse('2026-07-10T04:00:00Z'),
    ...codexOAuthUsageTestDeps({
      usageResponse: {
        plan_type: 'pro',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 37,
            limit_window_seconds: 18_000,
            reset_after_seconds: 18_000,
            reset_at: 1_783_674_000
          },
          secondary_window: {
            used_percent: 6,
            limit_window_seconds: 604_800,
            reset_after_seconds: 604_800,
            reset_at: 1_784_278_800
          }
        }
      }
    }),
    readCodexRpc: async () => ({
      account: { planType: 'plus' },
      rateLimits: {},
      sourceDetail: 'app'
    }),
    readCodexSessionRateLimits: () => null
  });

  assert.deepEqual(provider.windows.map((window) => ({
    kind: window.kind,
    usedPercent: window.usedPercent,
    remainingPercent: window.remainingPercent,
    resetsAt: window.resetsAt,
    windowMinutes: window.windowMinutes
  })), [
    {
      kind: 'session',
      usedPercent: 37,
      remainingPercent: 63,
      resetsAt: new Date(1_783_674_000 * 1000).toISOString(),
      windowMinutes: 300
    },
    {
      kind: 'weekly',
      usedPercent: 6,
      remainingPercent: 94,
      resetsAt: new Date(1_784_278_800 * 1000).toISOString(),
      windowMinutes: 10080
    }
  ]);
});
