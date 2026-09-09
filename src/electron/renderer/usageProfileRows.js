'use strict';

(function exposeUsageProfileRows(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorUsageProfileRows = api;
})(typeof window !== 'undefined' ? window : null, function createUsageProfileRowsApi() {
  function profileMetadataMap(profiles) {
    const result = new Map();
    for (const profile of (Array.isArray(profiles) ? profiles : [])) {
      if (!profile?.id || !profile?.client || !profile?.label) continue;
      result.set(profile.id, profile);
    }
    return result;
  }

  function profileRowsForClient(period, profiles, client, options = {}) {
    const metadata = profileMetadataMap(profiles);
    const clientLabel = options.clientLabel || client;
    const color = options.color || '#49a3b0';
    return Object.entries(period?.profiles || {})
      .filter(([id, value]) => Number(value) > 0 && metadata.get(id)?.client === client)
      .map(([id, value]) => ({
        key: `profile:${id}`,
        name: `${clientLabel} · ${metadata.get(id).label}`,
        subtitle: 'Usage profile',
        value: Number(value),
        cost: Number(period?.profileCosts?.[id] || 0),
        cacheReadTokens: Number(period?.profileCacheReads?.[id] || 0),
        cacheWriteTokens: Number(period?.profileCacheWrites?.[id] || 0),
        outputTokens: Number(period?.profileOutputs?.[id] || 0),
        color,
        stale: false,
        client,
        kind: 'profile'
      }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }

  return { profileMetadataMap, profileRowsForClient };
});
