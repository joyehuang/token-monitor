'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

async function badgeModule() {
  return import('../../worker/src/badge.js');
}

test('parseBadgeOptions accepts supported periods and themes', async () => {
  const { parseBadgeOptions } = await badgeModule();
  const url = new URL('https://example.com/api/public/badge.svg?period=month&theme=light');
  assert.deepEqual(parseBadgeOptions(url), { period: 'month', theme: 'light' });
});

test('parseBadgeOptions defaults to today and dark', async () => {
  const { parseBadgeOptions } = await badgeModule();
  const url = new URL('https://example.com/api/public/badge.svg');
  assert.deepEqual(parseBadgeOptions(url), { period: 'today', theme: 'dark' });
});

test('parseBadgeOptions rejects unsupported values', async () => {
  const { parseBadgeOptions } = await badgeModule();
  assert.deepEqual(
    parseBadgeOptions(new URL('https://example.com/api/public/badge.svg?period=year')),
    { error: 'Invalid period: year' }
  );
  assert.deepEqual(
    parseBadgeOptions(new URL('https://example.com/api/public/badge.svg?theme=neon')),
    { error: 'Invalid theme: neon' }
  );
});

test('renderUsageBadge renders only aggregate usage and freshness', async () => {
  const { renderUsageBadge } = await badgeModule();
  const svg = renderUsageBadge({
    updatedAt: '2026-07-12T03:00:00.000Z',
    periods: { today: { totalTokens: 1234567 } },
    devices: [{ deviceId: 'private-device', updatedAt: '2026-07-12T02:30:00.000Z' }]
  });
  assert.match(svg, /1\.23M/);
  assert.match(svg, /1,234,567/);
  assert.match(svg, /SYNCED/);
  assert.match(svg, /2026-07-12 · 02:30 UTC/);
  assert.doesNotMatch(svg, /private-device/);
  assert.match(svg, /^<svg/);
  assert.match(svg, /width="520" height="124"/);
});

test('renderUsageBadge supports light all-time badges and empty data', async () => {
  const { renderUsageBadge } = await badgeModule();
  const svg = renderUsageBadge({ periods: { allTime: { totalTokens: 0 } } }, { period: 'allTime', theme: 'light' });
  assert.match(svg, /All time/);
  assert.match(svg, />0</);
  assert.match(svg, /WAITING FOR DATA/);
  assert.match(svg, /#fcfcfd/);
});

test('renderErrorBadge strips XML-sensitive characters', async () => {
  const { renderErrorBadge } = await badgeModule();
  const svg = renderErrorBadge('<bad & "value">');
  assert.doesNotMatch(svg, /<bad/);
  assert.doesNotMatch(svg, /& "value"/);
});
