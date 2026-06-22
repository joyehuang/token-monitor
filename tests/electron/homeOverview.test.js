'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  homeActivityHeatmapLayout,
  homeLimitAccounts,
  homeModelRows,
  homeActivityWheelRoute,
  homeActivityScrollTarget,
  homeActivityScrollRecord,
  homeTrendSummary
} = require('../../src/electron/renderer/homeOverview');

test('Home activity heatmap is a scaled copy of the dashboard heatmap', () => {
  assert.deepEqual(homeActivityHeatmapLayout(), { cell: 9, gap: 3, radius: 2 });

  const rendererDir = path.join(__dirname, '../../src/electron/renderer');
  const css = fs.readFileSync(path.join(rendererDir, 'styles.css'), 'utf8');
  const dashboardCss = fs.readFileSync(path.join(rendererDir, 'dashboard.css'), 'utf8');
  const rule = (source, selector) => {
    const start = source.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `missing CSS rule: ${selector}`);
    return source.slice(start, source.indexOf('}', start) + 1);
  };
  const fill = (source, selector) => /fill:\s*([^;]+);/.exec(rule(source, selector))?.[1];
  const levels = [
    ['.home-activity-canvas .heat', '.heat.lvl-0'],
    ['.home-activity-canvas .heat.lvl-1', '.heat.lvl-1'],
    ['.home-activity-canvas .heat.lvl-2', '.heat.lvl-2'],
    ['.home-activity-canvas .heat.lvl-3', '.heat.lvl-3'],
    ['.home-activity-canvas .heat.lvl-4', '.heat.lvl-4']
  ];

  for (const [homeSelector, dashboardSelector] of levels) {
    assert.equal(fill(css, homeSelector), fill(dashboardCss, dashboardSelector));
  }
  assert.doesNotMatch(rule(css, '.home-activity-scroll'), /padding-block/);
  assert.match(rule(css, '.home-activity-canvas .heat-month'), /fill:\s*rgba\(var\(--line-rgb\), 0\.5\)/);
});

test('homeLimitAccounts keeps account windows together and sorts lowest remaining first', () => {
  const rows = homeLimitAccounts([
    {
      key: 'codex:1',
      providerId: 'codex',
      name: 'linus@example.com',
      color: '#49a3b0',
      windows: [
        { kind: 'session', usedPercent: 30 },
        { kind: 'weekly', usedPercent: 5 }
      ]
    },
    {
      key: 'codex:0',
      providerId: 'codex',
      name: 'javis@example.com',
      color: '#49a3b0',
      windows: [
        { kind: 'weekly', usedPercent: 57, resetDescription: '4d 13h' },
        { kind: 'session', usedPercent: 100, resetDescription: '32m' }
      ]
    }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'javis@example.com');
  assert.equal(rows[0].providerId, 'codex');
  assert.equal(rows[0].lowestRemaining, 0);
  assert.deepEqual(rows[0].windows.map((window) => window.kind), ['session', 'weekly']);
  assert.deepEqual(rows[0].windows.map((window) => window.remainingPercent), [0, 43]);
  assert.equal(rows[1].lowestRemaining, 70);
});

test('homeLimitAccounts keeps a real billing remaining percentage fallback', () => {
  const rows = homeLimitAccounts([
    {
      key: 'opencode:0',
      name: 'OpenCode',
      windows: [
        { kind: 'billing', remainingPercent: 93, resetDescription: '15d 16h' },
        { kind: 'balance', showMeter: false, remaining: 20 }
      ]
    }
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].windows.map((window) => ({ kind: window.kind, remainingPercent: window.remainingPercent })), [
    { kind: 'billing', remainingPercent: 93 }
  ]);
});

test('homeModelRows returns one-line token shares without cost fields', () => {
  const rows = homeModelRows([
    { name: 'claude-opus-4-8', value: 34_000_000, cost: 21.96, color: '#cc7c5e' },
    { name: 'gpt-5.5', value: 29_800_000, cost: 25.88, color: '#49a3b0' }
  ], 63_800_000);

  assert.deepEqual(rows, [
    { key: 'claude-opus-4-8', name: 'claude-opus-4-8', value: 34_000_000, share: 34_000_000 / 63_800_000, color: '#cc7c5e' },
    { key: 'gpt-5.5', name: 'gpt-5.5', value: 29_800_000, share: 29_800_000 / 63_800_000, color: '#49a3b0' }
  ]);
  assert.equal(Object.hasOwn(rows[0], 'cost'), false);
});

test('homeTrendSummary returns the peak value and real date anchors', () => {
  const summary = homeTrendSummary([
    { date: '2026-05-07', tokens: 20 },
    { date: '2026-05-23', tokens: 80 },
    { date: '2026-06-20', tokens: 40 }
  ]);

  assert.deepEqual(summary, {
    peak: 80,
    dates: ['2026-05-07', '2026-05-23', '2026-06-20']
  });
});

test('homeActivityWheelRoute lets vertical wheel gestures continue to Home scrolling', () => {
  assert.equal(homeActivityWheelRoute({ deltaX: 2, deltaY: 40 }), 'home-vertical');
  assert.equal(homeActivityWheelRoute({ deltaX: 40, deltaY: 2 }), 'activity-horizontal');
  assert.equal(homeActivityWheelRoute({ deltaX: 0, deltaY: 40, shiftKey: true }), 'activity-horizontal');
});

test('homeActivityScrollTarget pins to the newest (right) edge while following the end', () => {
  // Laid out and overflowing: follow-end lands on the far right.
  assert.equal(homeActivityScrollTarget({ scrollWidth: 700, clientWidth: 300, followEnd: true, savedLeft: null }), 400);
  // Not laid out yet (scrollWidth === clientWidth) → max 0, target 0, but the
  // ResizeObserver re-applies once layout settles, so this is only transient.
  assert.equal(homeActivityScrollTarget({ scrollWidth: 300, clientWidth: 300, followEnd: true, savedLeft: null }), 0);
});

test('homeActivityScrollTarget restores and clamps a saved user position', () => {
  assert.equal(homeActivityScrollTarget({ scrollWidth: 700, clientWidth: 300, followEnd: false, savedLeft: 180 }), 180);
  // A saved offset wider than the current max is clamped, never overshoots.
  assert.equal(homeActivityScrollTarget({ scrollWidth: 700, clientWidth: 300, followEnd: false, savedLeft: 999 }), 400);
  // followEnd false with no saved offset falls back to the end.
  assert.equal(homeActivityScrollTarget({ scrollWidth: 700, clientWidth: 300, followEnd: false, savedLeft: null }), 400);
});

test('homeActivityScrollRecord ignores measurements taken before layout settles', () => {
  // No overflow yet (or panel hidden) → null, so a bogus 0 never overwrites state.
  assert.equal(homeActivityScrollRecord({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }), null);
  assert.equal(homeActivityScrollRecord({ scrollLeft: 0, scrollWidth: 0, clientWidth: 0 }), null);
});

test('homeActivityScrollRecord captures a user scroll and whether it sits at the end', () => {
  assert.deepEqual(homeActivityScrollRecord({ scrollLeft: 180, scrollWidth: 700, clientWidth: 300 }), {
    scrollLeft: 180,
    followEnd: false
  });
  // At (or within 2px of) the far right → keep following the newest column.
  assert.deepEqual(homeActivityScrollRecord({ scrollLeft: 400, scrollWidth: 700, clientWidth: 300 }), {
    scrollLeft: 400,
    followEnd: true
  });
  assert.deepEqual(homeActivityScrollRecord({ scrollLeft: 399, scrollWidth: 700, clientWidth: 300 }), {
    scrollLeft: 399,
    followEnd: true
  });
});
