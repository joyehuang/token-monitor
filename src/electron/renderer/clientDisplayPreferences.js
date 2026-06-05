'use strict';

(function exposeClientDisplayPreferences(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorClientDisplayPreferences = api;
})(typeof window !== 'undefined' ? window : null, function createClientDisplayPreferencesApi() {
  function normalizeId(value) {
    return String(value || '').trim().toLowerCase();
  }

  function clientIds(clients) {
    return (clients || [])
      .map((client) => normalizeId(typeof client === 'string' ? client : client?.id))
      .filter(Boolean);
  }

  function csvItems(value) {
    return Array.isArray(value) ? value : String(value || '').split(',');
  }

  function hasCustomDisplayOrder(value) {
    return csvItems(value).some((item) => normalizeId(item));
  }

  function defaultClientDisplayPreferences() {
    return { clientDisplayOrder: '', hiddenClients: '' };
  }

  function normalizeClientDisplayOrder(value, clients) {
    const known = clientIds(clients);
    const knownSet = new Set(known);
    const seen = new Set();
    const order = [];
    for (const item of csvItems(value)) {
      const id = normalizeId(item);
      if (!knownSet.has(id) || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    for (const id of known) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    return order;
  }

  function normalizeHiddenClients(value, clients) {
    const knownSet = new Set(clientIds(clients));
    const seen = new Set();
    const hidden = [];
    for (const item of csvItems(value)) {
      const id = normalizeId(item);
      if (!knownSet.has(id) || seen.has(id)) continue;
      seen.add(id);
      hidden.push(id);
    }
    return hidden.join(',');
  }

  function orderedClients(clients, value) {
    const byId = new Map((clients || []).map((client) => [normalizeId(client?.id), client]));
    return normalizeClientDisplayOrder(value, clients).map((id) => byId.get(id)).filter(Boolean);
  }

  function moveClientDisplayOrder(value, clients, clientId, direction) {
    const order = normalizeClientDisplayOrder(value, clients);
    const from = order.indexOf(normalizeId(clientId));
    const offset = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const to = from + offset;
    if (from < 0 || offset === 0 || to < 0 || to >= order.length) return order.join(',');
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    return order.join(',');
  }

  function reorderClientDisplayOrder(value, clients, clientId, targetIndex) {
    const order = normalizeClientDisplayOrder(value, clients);
    const from = order.indexOf(normalizeId(clientId));
    if (from < 0) return order.join(',');
    const to = Math.max(0, Math.min(order.length - 1, Number(targetIndex) || 0));
    if (from === to) return order.join(',');
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    return order.join(',');
  }

  function applyClientDisplayPreferences(rows, orderValue, hiddenValue, clients) {
    const hidden = new Set(normalizeHiddenClients(hiddenValue, clients).split(',').filter(Boolean));
    const visible = (rows || []).filter((row) => !hidden.has(normalizeId(row?.key)));
    if (!hasCustomDisplayOrder(orderValue)) return visible;

    const orderIndex = new Map(normalizeClientDisplayOrder(orderValue, clients).map((id, index) => [id, index]));
    const fallbackIndex = Number.MAX_SAFE_INTEGER;
    return visible.slice().sort((a, b) => {
      const aIndex = orderIndex.has(normalizeId(a?.key)) ? orderIndex.get(normalizeId(a?.key)) : fallbackIndex;
      const bIndex = orderIndex.has(normalizeId(b?.key)) ? orderIndex.get(normalizeId(b?.key)) : fallbackIndex;
      return aIndex - bIndex;
    });
  }

  function hasClientDisplayPreferences(orderValue, hiddenValue, clients) {
    const hasKnownOrder = normalizeClientDisplayOrder(orderValue, clients).some((id) => {
      return csvItems(orderValue).some((item) => normalizeId(item) === id);
    });
    return hasKnownOrder || normalizeHiddenClients(hiddenValue, clients).length > 0;
  }

  return {
    applyClientDisplayPreferences,
    defaultClientDisplayPreferences,
    hasClientDisplayPreferences,
    hasCustomDisplayOrder,
    moveClientDisplayOrder,
    normalizeClientDisplayOrder,
    normalizeHiddenClients,
    orderedClients,
    reorderClientDisplayOrder
  };
});
