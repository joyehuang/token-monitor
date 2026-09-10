(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TokenMonitorAccountOverview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function accountRows(stats, providers = [], now = Date.now()) {
    const rows = new Map();
    for (const provider of providers) {
      const key = provider.accountKey || 'unknown-quota';
      rows.set(key, { key, label: provider.accountName || 'Unlinked account', provider, periods: {}, sources: [], updatedAt: '' });
    }
    for (const device of stats?.devices || []) {
      for (const profile of device.usageProfiles || []) {
        const key = profile.accountKey || `unknown:${device.deviceId}:${profile.id}`;
        if (!rows.has(key)) rows.set(key, { key, label: profile.accountName || `${profile.label} · unlinked`, provider: null, periods: {}, sources: [], updatedAt: '' });
        const row = rows.get(key);
        if (profile.accountName) row.label = profile.accountName;
        row.sources.push(`${profile.label} · ${device.deviceId}${device.stale ? ' (stale)' : ''}`);
        if (device.updatedAt > row.updatedAt) row.updatedAt = device.updatedAt;
        for (const name of ['today', 'week', 'month', 'allTime']) {
          const ends = Date.parse(device.periodWindows?.[name]?.endsAt || '');
          if (Number.isFinite(ends) && ends <= now) continue;
          const value = device.periods?.[name]?.profiles?.[profile.id];
          if (typeof value === 'number') row.periods[name] = (row.periods[name] || 0) + value;
        }
      }
    }
    return [...rows.values()];
  }
  return { accountRows };
});
