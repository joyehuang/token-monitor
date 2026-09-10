'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runTokscale, tokscaleCommand } = require('../../src/shared/collector');
const { extractUsageFromTokscale, summaryForWire, aggregateDevices, normalizeDeviceRecord } = require('../../src/shared/usage');

const rows = [
  { client: 'pi', provider: 'openai-codex', model: 'gpt-6-astra', input: 10, output: 2, cost: 0.1 },
  { client: 'pi', provider: 'openai-codex-agent', model: 'gpt-6-astra', input: 20, output: 3, cost: 0.2 }
];

test('Pi provider model sources survive wire and hub without inflating totals or costs', () => {
  const period = extractUsageFromTokscale({ entries: rows });
  assert.equal(period.totalTokens, 35);
  assert.ok(Math.abs(period.costUsd - 0.3) < 1e-10);
  assert.deepEqual(period.models, { 'gpt-6-astra [openai-codex]': 12, 'gpt-6-astra [openai-codex-agent]': 23 });
  const wire = JSON.parse(JSON.stringify(summaryForWire({ deviceId: 'synthetic', today: period, month: period, allTime: period })));
  const aggregate = aggregateDevices([normalizeDeviceRecord(wire)]);
  assert.deepEqual(aggregate.periods.today.models, period.models);
  assert.deepEqual(aggregate.periods.today.modelCosts, period.modelCosts);
  assert.equal(aggregate.periods.today.totalTokens, 35);
  assert.ok(Math.abs(aggregate.periods.today.costUsd - period.costUsd) < 1e-10);
});

test('Pi attribution scan preserves sessions and Windows home flags without double counting', async () => {
  const calls = [];
  const flags = ['--today', '--home', String.raw`C:\Synthetic\Home`];
  const result = await runTokscale({ clients: 'codex,pi,pi', flags, commandTimeoutMs: 1000 }, async (args) => {
    calls.push(args);
    return { entries: args[2] === 'pi' ? rows : [{ client: 'codex', model: 'gpt-6-astra', sessionId: 'synthetic', input: 5, cost: 0.01 }] };
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2], 'codex,pi,pi');
  assert.equal(calls[1][2], 'pi');
  assert.equal(calls[1][4], 'client,provider,model');
  for (const call of calls) assert.deepEqual(call.slice(-3), flags);
  assert.equal(extractUsageFromTokscale(result).totalTokens, 40);
  calls.length = 0;
  await runTokscale({ clients: 'pi', flags: [], commandTimeoutMs: 1000 }, async (args) => { calls.push(args); return { entries: rows }; });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call[2] === 'pi'), 'never invokes an empty all-client scan');
});

test('inherited CODEX_HOME never redirects the default usage source', () => {
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(os.tmpdir(), 'synthetic-agent');
  try {
    const command = tokscaleCommand();
    assert.equal(command.env.CODEX_HOME, undefined);
    assert.equal(process.env.CODEX_HOME, path.join(os.tmpdir(), 'synthetic-agent'));
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
});

test('offline Pi fixture separates a provider switch within the same session and model', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-pi-source-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, '.pi', 'agent', 'sessions', 'synthetic');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fixture.jsonl'), [
    { type: 'session', version: 3, id: 'synthetic-session', timestamp: '2026-09-10T00:00:00Z' },
    ...rows.map((row, index) => ({ type: 'message', id: `synthetic-${index}`, timestamp: '2026-09-10T00:01:00Z', message: {
      role: 'assistant', provider: row.provider, model: row.model, timestamp: 1788998460000,
      usage: { input: row.input, output: row.output, cacheRead: 0, cacheWrite: 0, totalTokens: row.input + row.output }
    } }))
  ].map(JSON.stringify).join('\n') + '\n');
  const command = tokscaleCommand();
  const scan = (args) => JSON.parse(execFileSync(command.bin, [...command.prefixArgs, ...args], { env: command.env, timeout: 30000 }));
  const merged = scan(['--json', '--client', 'pi', '--group-by', 'client,session,model', '--home', home]);
  assert.equal(merged.entries.length, 1, 'legacy grouping merges providers');
  const corrected = extractUsageFromTokscale(await runTokscale({ clients: 'pi', flags: ['--home', home], commandTimeoutMs: 30000 }, scan));
  assert.deepEqual(corrected.models, { 'gpt-6-astra [openai-codex-agent]': 23, 'gpt-6-astra [openai-codex]': 12 });
  assert.equal(corrected.totalTokens, extractUsageFromTokscale(merged).totalTokens);
  assert.equal(Object.keys(corrected.sessions).length, 1, 'original session detail survives');
  assert.ok(Math.abs(corrected.costUsd - extractUsageFromTokscale(merged).costUsd) < 1e-9);
});
