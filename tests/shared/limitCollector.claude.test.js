'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { claudeCommandCandidates, createLimitsCollector, fetchClaudeLimits, mapClaudeCliUsageToProvider, mapClaudeUsageToProvider } = require('../../src/shared/limitCollector');

function fakeSpawnForClaudeUsage(expectedCommand = 'claude.cmd') {
  return (command, args) => {
    assert.equal(command, expectedCommand);
    assert.deepEqual(args, ['/usage']);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      child.stdout.emit('data', Buffer.from([
        'Current session',
        '95% left',
        'Resets 6pm',
        'Current week',
        '80% left',
        'Resets Jun 18'
      ].join('\n')));
      child.emit('close', 0);
    });
    return child;
  };
}

test('Claude limits fall back to direct CLI usage on Windows when OAuth usage is unavailable', async () => {
  const provider = await fetchClaudeLimits({}, {
    platform: 'win32',
    now: () => Date.parse('2026-06-11T00:00:00Z'),
    claudeCredentialPath: 'C:\\Users\\Javis\\.claude\\.credentials.json',
    stat: async () => ({ mtimeMs: 1 }),
    readFile: async () => JSON.stringify({
      claudeAiOauth: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.parse('2026-06-12T00:00:00Z')
      }
    }),
    fetch: async () => ({
      ok: false,
      status: 500
    }),
    existsSync: () => false,
    spawn: fakeSpawnForClaudeUsage()
  });

  assert.equal(provider.provider, 'claude');
  assert.equal(provider.status, 'ok');
  assert.equal(provider.source, 'cli');
  assert.equal(provider.windows[0].kind, 'session');
  assert.equal(provider.windows[0].usedPercent, 5);
  assert.equal(provider.windows[1].kind, 'weekly');
  assert.equal(provider.windows[1].usedPercent, 20);
});

test('Claude source rate limiting does not launch the slow CLI fallback', async () => {
  let cliCalls = 0;
  await assert.rejects(fetchClaudeLimits({}, {
    platform: 'darwin',
    now: () => Date.parse('2026-06-11T00:00:00Z'),
    claudeCredentialPath: '/tmp/claude-credentials.json',
    stat: async () => ({ mtimeMs: 1 }),
    readFile: async () => JSON.stringify({
      claudeAiOauth: {
        accessToken: 'access-token',
        expiresAt: Date.parse('2026-06-12T00:00:00Z')
      }
    }),
    fetch: async () => ({ ok: false, status: 429 }),
    runClaudeUsageCli: async () => {
      cliCalls += 1;
      return '';
    }
  }), (error) => error.status === 'sourceRateLimited');

  assert.equal(cliCalls, 0);
});

test('createLimitsCollector refreshes Claude at five-minute cadence and keeps the last success through 429', async () => {
  let now = Date.parse('2026-06-11T00:00:00Z');
  let calls = 0;
  const collector = createLimitsCollector({
    limitProviders: 'claude',
    limitsRefreshMs: 60_000
  }, {
    now: () => now,
    providerFetchers: {
      claude: async () => {
        calls += 1;
        if (calls > 1) {
          const error = new Error(calls === 2 ? 'Claude usage rate limited' : 'Claude signed out');
          error.status = calls === 2 ? 'sourceRateLimited' : 'unauthorized';
          throw error;
        }
        return {
          provider: 'claude',
          accountKey: 'sha256:claude-a',
          status: 'ok',
          source: 'oauth',
          updatedAt: new Date(now).toISOString(),
          windows: [{ kind: 'session', usedPercent: 42, resetsAt: '2026-06-11T05:00:00Z' }]
        };
      }
    }
  });

  const first = await collector.snapshot(true);
  now += 60_000;
  const cached = await collector.snapshot(true);
  now += 4 * 60_000;
  const rateLimited = await collector.snapshot(true);
  now += 60_000;
  const backedOff = await collector.snapshot(true);
  now += 4 * 60_000;
  const unauthorized = await collector.snapshot(true);
  now += 30_000;
  const stillUnauthorized = await collector.snapshot(true);

  assert.equal(calls, 3);
  for (const summary of [first, cached, rateLimited, backedOff]) {
    assert.equal(summary.providers[0].status, 'ok');
    assert.equal(summary.providers[0].windows[0].usedPercent, 42);
  }
  assert.equal(unauthorized.providers[0].status, 'unauthorized');
  assert.equal(stillUnauthorized.providers[0].status, 'unauthorized');
});

test('Claude limits read Windows Credential Manager credentials when credential files are absent', async () => {
  const provider = await fetchClaudeLimits({}, {
    platform: 'win32',
    now: () => Date.parse('2026-06-11T00:00:00Z'),
    claudeCredentialPath: 'C:\\Users\\Javis\\.claude\\.credentials.json',
    stat: async () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
    readWindowsCredentialSecret: async (service, targets) => {
      assert.equal(service, 'Claude Code-credentials');
      assert.equal(targets.includes('Claude Code-credentials'), true);
      return JSON.stringify({
        claudeAiOauth: {
          accessToken: 'credential-manager-token',
          refreshToken: 'credential-manager-refresh',
          expiresAt: Date.parse('2026-06-12T00:00:00Z'),
          subscriptionType: 'max',
          rateLimitTier: 'default_claude_max_5x'
        }
      });
    },
    fetch: async (_url, options) => {
      assert.equal(options.headers.authorization, 'Bearer credential-manager-token');
      return {
        ok: true,
        json: async () => ({
          five_hour: {
            utilization: 12,
            resets_at: '2026-06-11T05:00:00Z'
          }
        })
      };
    }
  });

  assert.equal(provider.provider, 'claude');
  assert.equal(provider.status, 'ok');
  assert.equal(provider.source, 'oauth');
  assert.equal(provider.accountLabel, 'Max 5x');
  assert.equal(provider.windows[0].usedPercent, 12);
});

test('Claude limits read the Windows Desktop token when CLI credentials are absent', async () => {
  const provider = await fetchClaudeLimits({}, {
    platform: 'win32',
    now: () => Date.parse('2026-06-11T00:00:00Z'),
    claudeCredentialPath: 'C:\\Users\\Javis\\.claude\\.credentials.json',
    stat: async () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
    readWindowsCredentialSecret: async () => '',
    readClaudeDesktopCredentials: async () => ({
      accessToken: 'desktop-token',
      expiresAt: Date.parse('2026-06-12T00:00:00Z'),
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_5x',
      identity: 'desktop:account'
    }),
    fetch: async (_url, options) => {
      assert.equal(options.headers.authorization, 'Bearer desktop-token');
      return {
        ok: true,
        json: async () => ({
          five_hour: {
            utilization: 21,
            resets_at: '2026-06-11T05:00:00Z'
          }
        })
      };
    }
  });

  assert.equal(provider.provider, 'claude');
  assert.equal(provider.status, 'ok');
  assert.equal(provider.accountLabel, 'Max 5x');
  assert.equal(provider.windows[0].usedPercent, 21);
});

test('Claude OAuth usage mapping accepts camelCase response fields', async () => {
  const provider = await fetchClaudeLimits({}, {
    platform: 'linux',
    now: () => Date.parse('2026-06-11T00:00:00Z'),
    claudeCredentialPath: '/tmp/claude-credentials.json',
    stat: async () => ({ mtimeMs: 1 }),
    readFile: async () => JSON.stringify({
      claudeAiOauth: {
        accessToken: 'access-token',
        expiresAt: Date.parse('2026-06-12T00:00:00Z')
      }
    }),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        fiveHour: {
          utilization: 34,
          resetsAt: '2026-06-11T05:00:00Z'
        },
        sevenDay: {
          utilization: 56,
          resetsAt: '2026-06-18T00:00:00Z'
        }
      })
    })
  });

  assert.equal(provider.windows[0].kind, 'session');
  assert.equal(provider.windows[0].usedPercent, 34);
  assert.equal(provider.windows[0].resetsAt, '2026-06-11T05:00:00.000Z');
  assert.equal(provider.windows[1].kind, 'weekly');
  assert.equal(provider.windows[1].usedPercent, 56);
  assert.equal(provider.windows[1].resetsAt, '2026-06-18T00:00:00.000Z');
});

test('Claude OAuth usage mapping preserves fractional percentage utilization values', async () => {
  let cliCalls = 0;
  const provider = await fetchClaudeLimits({}, {
    platform: 'darwin',
    now: () => Date.parse('2026-06-11T00:00:00Z'),
    claudeCredentialPath: '/tmp/claude-credentials.json',
    stat: async () => ({ mtimeMs: 1 }),
    readFile: async () => JSON.stringify({
      claudeAiOauth: {
        accessToken: 'access-token',
        expiresAt: Date.parse('2026-06-12T00:00:00Z')
      }
    }),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        fiveHour: {
          utilization: 0.99,
          resetsAt: '2026-06-11T08:00:00Z'
        },
        sevenDay: {
          utilization: 0,
          resetsAt: '2026-06-18T10:00:00Z'
        }
      })
    }),
    runClaudeUsageCli: async () => {
      cliCalls += 1;
      return '';
    }
  });

  assert.equal(provider.source, 'oauth');
  assert.equal(provider.sourceDetail, '');
  assert.equal(provider.windows[0].usedPercent, 0.99);
  assert.equal(provider.windows[0].remainingPercent, 99.01);
  assert.equal(provider.windows[1].usedPercent, 0);
  assert.equal(provider.windows[1].remainingPercent, 100);
  assert.equal(cliCalls, 0);
});

test('Claude OAuth usage preserves an inactive five-hour window with no reset timestamp', () => {
  const provider = mapClaudeUsageToProvider({
    five_hour: { utilization: 0, resets_at: null },
    seven_day: { utilization: 12, resets_at: '2026-06-18T10:00:00Z' }
  });
  const session = provider.windows.find((window) => window.kind === 'session');

  assert.equal(session.usedPercent, 0);
  assert.equal(session.remainingPercent, 100);
  assert.equal(session.resetsAt, null);
  assert.equal(session.resetDescription, '');
});

test('Claude OAuth usage does not treat a used five-hour window with a missing reset as inactive data', () => {
  const provider = mapClaudeUsageToProvider({
    five_hour: { utilization: 1, resets_at: null }
  });
  const session = provider.windows.find((window) => window.kind === 'session');

  assert.equal(session.usedPercent, 1);
  assert.equal(session.remainingPercent, 99);
  assert.equal(session.resetsAt, null);
});

test('Claude limits keep successful OAuth quota on macOS instead of replacing it with CLI', async () => {
  let cliCalls = 0;
  const provider = await fetchClaudeLimits({}, {
    platform: 'darwin',
    now: () => Date.parse('2026-06-11T00:00:00Z'),
    claudeCredentialPath: '/tmp/claude-credentials.json',
    stat: async () => ({ mtimeMs: 1 }),
    readFile: async () => JSON.stringify({
      claudeAiOauth: {
        accessToken: 'access-token',
        expiresAt: Date.parse('2026-06-12T00:00:00Z')
      }
    }),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        fiveHour: {
          utilization: 100,
          resetsAt: '2026-06-11T08:00:00Z'
        },
        sevenDay: {
          utilization: 0,
          resetsAt: '2026-06-18T10:00:00Z'
        }
      })
    }),
    runClaudeUsageCli: async () => {
      cliCalls += 1;
      return [
        'Current session',
        '1% used',
        'Resets 3:59pm',
        'Current week',
        '0% used',
        'Resets Jun 19'
      ].join('\n');
    }
  });

  assert.equal(provider.source, 'oauth');
  assert.equal(provider.sourceDetail, '');
  assert.equal(provider.windows[0].usedPercent, 100);
  assert.equal(provider.windows[0].remainingPercent, 0);
  assert.equal(provider.windows[1].usedPercent, 0);
  assert.equal(provider.windows[1].remainingPercent, 100);
  assert.equal(cliCalls, 0);
});

test('Claude successful OAuth keeps plan label without probing CLI', async () => {
  let cliCalls = 0;
  const provider = await fetchClaudeLimits({}, {
    platform: 'darwin',
    now: () => Date.parse('2026-06-11T00:00:00Z'),
    claudeCredentialPath: '/tmp/claude-credentials.json',
    stat: async () => ({ mtimeMs: 1 }),
    readFile: async () => JSON.stringify({
      claudeAiOauth: {
        accessToken: 'access-token',
        expiresAt: Date.parse('2026-06-12T00:00:00Z'),
        subscriptionType: 'max',
        rateLimitTier: 'default_claude_max_5x'
      }
    }),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        fiveHour: {
          utilization: 100,
          resetsAt: '2026-06-11T08:00:00Z'
        },
        sevenDay: {
          utilization: 0,
          resetsAt: '2026-06-18T10:00:00Z'
        }
      })
    }),
    runClaudeUsageCli: async () => {
      cliCalls += 1;
      return [
        'Current session',
        '1% used',
        'Resets 3:59pm',
        'Current week',
        '0% used',
        'Resets Jun 19'
      ].join('\n');
    }
  });

  assert.equal(provider.source, 'oauth');
  assert.equal(provider.sourceDetail, '');
  assert.equal(provider.accountLabel, 'Max 5x');
  assert.equal(provider.windows[0].remainingPercent, 0);
  assert.equal(cliCalls, 0);
});

test('Claude CLI usage parses compact PTY reset lines', () => {
  const provider = mapClaudeCliUsageToProvider([
    'Current session',
    '1% used',
    'Resets4pm(Asia/Hong_Kong)',
    'Current week (all models)',
    '0% used',
    'ResetsJun19at6pm(Asia/Hong_Kong)'
  ].join('\n'), {
    now: new Date('2026-06-13T07:00:00Z'),
    updatedAt: '2026-06-13T07:00:00Z'
  });

  const session = provider.windows.find((window) => window.kind === 'session');
  const weekly = provider.windows.find((window) => window.kind === 'weekly');
  assert.equal(session.resetDescription, 'Resets 4pm');
  assert.equal(weekly.resetDescription, 'Resets Jun 19 at 6pm');
  assert.equal(typeof session.resetsAt, 'string');
  assert.equal(typeof weekly.resetsAt, 'string');
});

test('Claude CLI usage maps out-of-order PTY reset lines by window shape', () => {
  const provider = mapClaudeCliUsageToProvider([
    'Current session',
    '1% used',
    'Current week (all models)',
    '0% used',
    'Resets4pm(Asia/Hong_Kong)',
    'ResetsJun19at6pm(Asia/Hong_Kong)'
  ].join('\n'), {
    now: new Date('2026-06-13T07:00:00Z'),
    updatedAt: '2026-06-13T07:00:00Z'
  });

  const session = provider.windows.find((window) => window.kind === 'session');
  const weekly = provider.windows.find((window) => window.kind === 'weekly');
  assert.equal(session.resetDescription, 'Resets 4pm');
  assert.equal(weekly.resetDescription, 'Resets Jun 19 at 6pm');
  assert.equal(typeof session.resetsAt, 'string');
  assert.equal(typeof weekly.resetsAt, 'string');
});

test('Claude command candidates include common Windows CLI install paths before generic commands', () => {
  const localAppData = 'C:\\Users\\Javis\\AppData\\Local';
  const appData = 'C:\\Users\\Javis\\AppData\\Roaming';
  const userProfile = 'C:\\Users\\Javis';

  const candidates = claudeCommandCandidates({
    LOCALAPPDATA: localAppData,
    APPDATA: appData,
    USERPROFILE: userProfile
  }, 'win32');

  const localNpm = 'C:\\Users\\Javis\\AppData\\Local\\npm\\claude.cmd';
  const roamingNpm = 'C:\\Users\\Javis\\AppData\\Roaming\\npm\\claude.cmd';
  const volta = 'C:\\Users\\Javis\\AppData\\Local\\Volta\\tools\\image\\packages\\@anthropic-ai\\claude-code\\bin\\claude.cmd';
  const fnm = 'C:\\Users\\Javis\\AppData\\Local\\fnm_multishells\\claude.cmd';

  assert.equal(candidates.includes(localNpm), true);
  assert.equal(candidates.includes(roamingNpm), true);
  assert.equal(candidates.includes(volta), true);
  assert.equal(candidates.includes(fnm), true);
  assert.ok(candidates.indexOf(roamingNpm) < candidates.indexOf('claude.cmd'));
  assert.ok(candidates.indexOf('claude.cmd') < candidates.indexOf('claude'));
});

test('Claude OAuth usage adds a Fable-only weekly window from the limits array', () => {
  const provider = mapClaudeUsageToProvider({
    five_hour: { utilization: 96, resets_at: '2026-07-02T14:00:00Z' },
    seven_day: { utilization: 22, resets_at: '2026-07-03T10:00:00Z' },
    limits: [
      { kind: 'session', group: 'session', percent: 96, resets_at: '2026-07-02T14:00:00Z', scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 22, resets_at: '2026-07-03T10:00:00Z', scope: null },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 1,
        resets_at: '2026-07-03T09:59:59Z',
        scope: { model: { id: null, display_name: 'Fable' }, surface: null }
      }
    ]
  });

  const weeklies = provider.windows.filter((window) => window.kind === 'weekly');
  assert.equal(weeklies.length, 2);
  // The unscoped "All models" weekly stays first so windowForKind() still resolves it.
  assert.equal(weeklies[0].label, '');
  assert.equal(weeklies[0].usedPercent, 22);
  const fable = weeklies[1];
  assert.equal(fable.label, 'Fable');
  assert.equal(fable.usedPercent, 1);
  assert.equal(fable.resetsAt, '2026-07-03T09:59:59.000Z');
});

test('Claude OAuth usage omits the Fable window when no scoped model limit is present', () => {
  const provider = mapClaudeUsageToProvider({
    five_hour: { utilization: 40, resets_at: '2026-07-02T14:00:00Z' },
    seven_day: { utilization: 10, resets_at: '2026-07-03T10:00:00Z' },
    limits: [
      { kind: 'session', group: 'session', percent: 40, resets_at: '2026-07-02T14:00:00Z', scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 10, resets_at: '2026-07-03T10:00:00Z', scope: null }
    ]
  });

  const weeklies = provider.windows.filter((window) => window.kind === 'weekly');
  assert.equal(weeklies.length, 1);
  assert.equal(weeklies[0].label, '');
});

test('Claude OAuth usage ignores non-Fable scoped weekly limits', () => {
  const provider = mapClaudeUsageToProvider({
    seven_day: { utilization: 10, resets_at: '2026-07-03T10:00:00Z' },
    limits: [
      { kind: 'weekly_all', group: 'weekly', percent: 10, resets_at: '2026-07-03T10:00:00Z', scope: null },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 3,
        resets_at: '2026-07-03T10:00:00Z',
        scope: { model: { id: null, display_name: 'Opus' }, surface: null }
      }
    ]
  });

  const labels = provider.windows.filter((window) => window.kind === 'weekly').map((window) => window.label);
  assert.deepEqual(labels, ['']);
});
