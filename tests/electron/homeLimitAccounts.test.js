'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const home = require('../../src/electron/renderer/homeOverview');
const presentation = require('../../src/electron/renderer/limitProviderPresentation');
const { aggregateLimits } = require('../../src/shared/limits');
const weekly = { kind: 'weekly', usedPercent: 50, remainingPercent: 50 };
const providers = [
  { provider: 'codex', accountKey: 'a', accountName: 'personal20x', accountOrder: 0, status: 'ok', sourceDetail: 'readonly', windows: [weekly] },
  { provider: 'codex', accountKey: 'b', accountName: 'agent5x', accountOrder: 1, status: 'ok', sourceDetail: 'readonly', windows: [weekly] },
  { provider: 'codex', accountKey: 'c', accountName: 'workplus', accountOrder: 2, status: 'ok', sourceDetail: 'readonly', windows: [{ kind: 'session', remainingPercent: 70 }, weekly] },
  { provider: 'claude', status: 'ok', windows: [{ kind: 'session', remainingPercent: 90 }, { ...weekly, remainingPercent: 98 }] }
];
const options = { providers, providerOptions: [{ id: 'codex', label: 'Codex' }, { id: 'claude', label: 'Claude' }] };
test('Home expands all configured Codex accounts without evicting Claude, even with limit 3', () => {
  const rows = home.homeLimitAccountsForProviders({ ...options, providers: [...providers].reverse(), limit: 3 });
  assert.deepEqual(rows.map((r) => r.name), ['personal20x', 'agent5x', 'workplus', 'Claude']);
  assert.deepEqual(rows.map((r) => r.windows.map((w) => w.kind)), [['weekly'], ['weekly'], ['session', 'weekly'], ['session', 'weekly']]);
  assert.equal(home.homeLimitAccountsForProviders({ ...options, hiddenProviderIds: ['codex'] }).length, 1);
  assert.equal(home.homeLimitAccountsForProviders({ ...options, enabledProviderIds: ['claude'] }).length, 1);
  assert.deepEqual(home.homeLimitAccountsForProviders({ ...options, providerOptions: [...options.providerOptions].reverse(), sort: 'configured' }).map((r) => r.name), ['Claude', 'personal20x', 'agent5x', 'workplus']);
});
test('viewer receives configured labels and order through aggregation without local bindings or quota summation', () => {
  const at = '2026-09-10T10:00:00.000Z';
  const first = providers.map((p) => ({ ...p, updatedAt: at }));
  const duplicate = { ...first[0], sourceDetail: 'cli', accountName: 'Old login name', accountOrder: undefined, updatedAt: '2026-09-10T10:01:00.000Z' };
  const aggregated = aggregateLimits([{ deviceId: 'host', limits: { providers: first } }, { deviceId: 'viewer', limits: { providers: [duplicate] } }], 0, Date.parse(at));
  const displayed = presentation.dedupeLimitProvidersByAccount(aggregated.providers);
  const rows = home.homeLimitAccountsForProviders({ ...options, providers: displayed });
  assert.deepEqual(rows.map((r) => r.name), ['personal20x', 'agent5x', 'workplus', 'Claude']);
  assert.equal(rows[0].windows[0].remainingPercent, 50);
});
function element() {
  return { children: [], classList: { add() {} }, append(...nodes) { this.children.push(...nodes); }, prepend(node) { this.children.unshift(node); } };
}
const source = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/app.js'), 'utf8');
function renderer(name, deps) {
  const body = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
  return vm.runInNewContext(`(${body})`, deps);
}
function textOf(node) { return [node.textContent || '', ...(node.children || []).map(textOf)].join(' '); }
test('shared Codex window renderer has only applicable windows, without unknown placeholders', () => {
  const render = renderer('renderProviderWindows', {
    document: { createElement: element },
    windowForKind: (p, kind) => p.windows.find((w) => w.kind === kind),
    limitWindowNode: (label) => ({ ...element(), textContent: label })
  });
  for (const provider of providers.slice(0, 3)) {
    const node = render(provider, '#fff');
    assert.equal(node.children.length, provider.windows.length);
    assert.doesNotMatch(textOf(node), /unknown|reset/i);
    assert.equal(textOf(node).includes('Session'), provider.accountName === 'workplus');
  }
});
test('Home renders 401 and request failure visibly, without healthy cached windows', () => {
  for (const status of ['unauthorized', 'unavailable', 'error']) {
    const rows = home.homeLimitAccountsForProviders({ ...options, providers: [{ ...providers[0], status, windows: [] }] });
    assert.equal(rows.length, 1);
    const module = element(); const body = element(); module.append(body);
    const render = renderer('renderHomeLimitModule', {
      document: { createElement: element }, homeModuleShell: () => ({ module, body }),
      homeLimitRows: () => [{ ...rows[0], windows: [weekly] }], t: (s) => s,
      applyHomeListMark() {}, iconKindFor() {}, limitProviderPresentationApi: presentation
    });
    const text = textOf(render());
    assert.match(text, new RegExp(presentation.limitProviderStatusLabel({ provider: 'codex', status }).label));
    assert.doesNotMatch(text, /Weekly|unknown|left/);
  }
});
test('Home retains last known Claude windows as stale when a local unconfigured probe displaces them', () => {
  const fallbackProviders = [providers[3]];
  const rows = home.homeLimitAccountsForProviders({ ...options, providers: [...providers.slice(0, 3), { provider: 'claude', status: 'notConfigured', windows: [] }], fallbackProviders });
  assert.equal(rows.length, 4);
  assert.equal(rows[3].name, 'Claude');
  assert.equal(rows[3].stale, true);
  assert.deepEqual(rows[3].windows.map((w) => w.kind), ['session', 'weekly']);
  for (const status of ['unauthorized', 'unavailable']) {
    const failed = home.homeLimitAccountsForProviders({ ...options, providers: [{ provider: 'claude', status, windows: [] }], fallbackProviders });
    assert.equal(failed[0].status, status);
    assert.deepEqual(failed[0].windows, []);
  }
});
