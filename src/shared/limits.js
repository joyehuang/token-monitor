'use strict';

const DEFAULT_LIMITS_REFRESH_MS = 5 * 60 * 1000;
const VALID_PROVIDERS = new Set(['claude', 'codex', 'cursor', 'antigravity', 'opencode', 'deepseek', 'minimax', 'grok', 'copilot', 'kiro']);
const VALID_STATUSES = new Set(['ok', 'disabled', 'notConfigured', 'unauthorized', 'rateLimited', 'sourceRateLimited', 'unavailable', 'error']);
const VALID_SOURCES = new Set(['oauth', 'cli', 'web', 'rpc', 'local', 'api']);
const VALID_SOURCE_DETAILS = new Set(['app', 'cli', 'managed', 'unknown']);
const WINDOW_ORDER = ['session', 'weekly', 'billing'];
const CODEX_TRANSIENT_WINDOW_RETENTION_MS = 10 * 60 * 1000;
const CODEX_RESET_ANCHOR_TOLERANCE_MS = 2 * 1000;
const CODEX_ACTIVE_WINDOW_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const CODEX_TRANSITION_CONFIRMATIONS = 3;

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/[%,$]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeProviderId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!VALID_PROVIDERS.has(raw)) return null;
  return raw;
}

function normalizeStatus(value) {
  const raw = String(value || '').trim();
  return VALID_STATUSES.has(raw) ? raw : 'error';
}

function normalizeSource(value) {
  const raw = String(value || '').trim().toLowerCase();
  return VALID_SOURCES.has(raw) ? raw : '';
}

function normalizeSourceDetail(value) {
  const raw = String(value || '').trim().toLowerCase();
  return VALID_SOURCE_DETAILS.has(raw) ? raw : '';
}

function normalizeAccountLabel(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 32 || raw.includes('@') || /^https?:\/\//i.test(raw)) return '';
  const clean = raw.replace(/[^a-z0-9 +._-]/gi, '').replace(/\s+/g, ' ').trim();
  return clean.length <= 32 ? clean : '';
}

function normalizeAccountName(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 64 || raw.includes('@') || /^https?:\/\//i.test(raw)) return '';
  const clean = raw.replace(/[^a-z0-9 ._-]/gi, '').replace(/\s+/g, ' ').trim();
  return clean.length <= 64 ? clean : '';
}

function normalizeAccountEmail(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw.length > 254 || !raw.includes('@')) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : '';
}

function normalizeWindowKind(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[_\s-]+/g, '');
  if (raw === 'session') return 'session';
  if (raw === 'weekly') return 'weekly';
  if (raw === 'billing' || raw === 'billingcycle' || raw === 'monthly') return 'billing';
  return null;
}

function normalizeWindowLabel(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 32) return '';
  const clean = raw.replace(/[^a-z0-9 +._/-]/gi, '').replace(/\s+/g, ' ').trim();
  return clean.length <= 32 ? clean : '';
}

function normalizeIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  let date;
  if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value < 20_000_000_000 ? value * 1000 : value);
  } else {
    date = new Date(String(value));
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberOrNull(value) {
  const number = asNumber(value);
  return number === null ? null : number;
}

function percentFromWindow(input, used, limit) {
  const explicit = numberOrNull(input.usedPercent ?? input.used_percent ?? input.utilization ?? input.percent);
  if (explicit !== null) return clamp(explicit, 0, 100);
  if (used !== null && limit !== null && limit > 0) return clamp((used / limit) * 100, 0, 100);
  return null;
}

function normalizeLimitWindow(input) {
  if (!input || typeof input !== 'object') return null;
  const kind = normalizeWindowKind(input.kind || input.type || input.name || input.window || input.windowKind);
  if (!kind) return null;
  const used = numberOrNull(input.used);
  const limit = numberOrNull(input.limit);
  const remaining = numberOrNull(input.remaining);
  const usedPercent = percentFromWindow(input, used, limit);
  return {
    kind,
    label: normalizeWindowLabel(input.label || input.displayLabel || input.title),
    used,
    limit,
    remaining,
    usedPercent,
    remainingPercent: usedPercent === null ? null : Number((100 - usedPercent).toFixed(3)),
    resetsAt: normalizeIsoTimestamp(input.resetsAt ?? input.resets_at ?? input.resetAt ?? input.reset_at),
    windowMinutes: numberOrNull(input.windowMinutes ?? input.window_minutes ?? input.windowDurationMins),
    resetDescription: input.resetDescription ? String(input.resetDescription) : '',
    showMeter: input.showMeter !== false && input.meter !== false
  };
}

function normalizeProviderBalance(input) {
  if (!input || typeof input !== 'object') return null;
  const amount = numberOrNull(input.amount);
  const currency = String(input.currency || '').trim().toUpperCase().slice(0, 8) || null;
  if (amount === null && !currency) return null;
  return {
    amount,
    currency,
    todaySpend: numberOrNull(input.todaySpend),
    monthSpend: numberOrNull(input.monthSpend),
    monthSinceTracking: Boolean(input.monthSinceTracking)
  };
}

function normalizeResetCreditExpirations(input) {
  const raw = input?.expirations ?? input?.expirationTimes ?? input?.expiresAtList ?? input?.expires_at_list ?? input?.credits;
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const expirations = [];
  for (const value of raw) {
    if (value && typeof value === 'object') {
      const status = String(value.status || '').toLowerCase();
      if (status && status !== 'available') continue;
    }
    const sourceValue = value && typeof value === 'object'
      ? value.expiresAt ?? value.expires_at ?? value.nextExpiresAt ?? value.next_expires_at
      : value;
    const normalized = normalizeIsoTimestamp(sourceValue);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    expirations.push(normalized);
  }
  expirations.sort((a, b) => Date.parse(a) - Date.parse(b));
  return expirations;
}

function normalizeProviderResetCredits(input) {
  if (!input || typeof input !== 'object') return null;
  const available = numberOrNull(
    input.availableCount
    ?? input.available_count
    ?? input.available
    ?? input.remainingCount
    ?? input.remaining_count
  );
  const nextExpiresAt = normalizeIsoTimestamp(
    input.nextExpiresAt
    ?? input.next_expires_at
    ?? input.nextExpirationAt
    ?? input.next_expiration_at
    ?? input.expiresAt
    ?? input.expires_at
  );
  const expirations = normalizeResetCreditExpirations(input);
  const firstExpiration = expirations[0] || null;
  const effectiveNextExpiresAt = [nextExpiresAt, firstExpiration]
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null;
  if (available === null && !effectiveNextExpiresAt && expirations.length === 0) return null;
  return {
    availableCount: available === null ? null : Math.max(0, Math.floor(available)),
    nextExpiresAt: effectiveNextExpiresAt,
    ...(expirations.length > 0 ? { expirations } : {})
  };
}

function normalizeRegion(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'cn' || raw === 'en' || raw === 'global') return raw;
  return raw.length <= 16 ? raw : '';
}

function normalizeLimitProvider(input) {
  if (!input || typeof input !== 'object') return null;
  const provider = normalizeProviderId(input.provider);
  if (!provider) return null;
  const windows = Array.isArray(input.windows)
    ? input.windows.map(normalizeLimitWindow).filter(Boolean)
    : [];
  windows.sort((a, b) => WINDOW_ORDER.indexOf(a.kind) - WINDOW_ORDER.indexOf(b.kind));
  return {
    provider,
    accountKey: input.accountKey ? String(input.accountKey) : '',
    accountLabel: normalizeAccountLabel(input.accountLabel),
    accountName: normalizeAccountName(input.accountName ?? input.accountLogin ?? input.login),
    accountEmail: normalizeAccountEmail(input.accountEmail ?? input.email),
    status: normalizeStatus(input.status),
    source: normalizeSource(input.source),
    sourceDetail: normalizeSourceDetail(input.sourceDetail ?? input.source_detail),
    updatedAt: normalizeIsoTimestamp(input.updatedAt) || normalizeIsoTimestamp(input.checkedAt),
    windows,
    balanceUsd: numberOrNull(input.balanceUsd),
    balance: normalizeProviderBalance(input.balance),
    resetCredits: normalizeProviderResetCredits(input.resetCredits ?? input.rateLimitResetCredits ?? input.rate_limit_reset_credits),
    region: normalizeRegion(input.region)
  };
}

function normalizeRefreshMs(value) {
  const parsed = asNumber(value);
  return parsed && parsed > 0 ? Math.round(parsed) : DEFAULT_LIMITS_REFRESH_MS;
}

function normalizeLimitsSummary(input) {
  const source = input && typeof input === 'object' ? input : {};
  const providers = Array.isArray(source.providers)
    ? source.providers.map(normalizeLimitProvider).filter(Boolean)
    : [];
  return {
    updatedAt: normalizeIsoTimestamp(source.updatedAt),
    refreshMs: normalizeRefreshMs(source.refreshMs),
    providers
  };
}

function statusRank(status) {
  if (status === 'ok') return 3;
  if (status === 'rateLimited') return 2;
  if (status === 'sourceRateLimited' || status === 'unauthorized' || status === 'unavailable' || status === 'error') return 1;
  return 0;
}

function timestampMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function isProviderStale(provider, summary, device, staleAfterMs, nowMs) {
  if (device?.stale) return true;
  const updatedAt = timestampMs(provider.updatedAt || summary.updatedAt);
  if (!updatedAt) return false;
  const threshold = Math.max(normalizeRefreshMs(summary.refreshMs) * 2, Number(staleAfterMs || 0));
  return threshold > 0 ? nowMs - updatedAt > threshold : false;
}

function providerAggregateKey(provider) {
  return `${provider.provider}:${provider.accountKey || provider.status}`;
}

function isConfiguredProvider(provider) {
  return Boolean(provider.accountKey && provider.status !== 'notConfigured' && provider.status !== 'disabled');
}

function providerCollapseKey(provider) {
  if ((provider.provider === 'codex' || provider.provider === 'opencode') && isConfiguredProvider(provider)) {
    return providerAggregateKey(provider);
  }
  return provider.provider;
}

function providerWindowRank(provider) {
  if (provider?.provider !== 'codex') return 0;
  return Array.isArray(provider.windows) && provider.windows.length > 0 ? 1 : 0;
}

function codexProviderIdentityKeys(provider) {
  if (provider?.provider !== 'codex') return [];
  if (provider.accountKey) return [`key:${provider.accountKey}`];
  return provider.accountEmail ? [`email:${provider.accountEmail}`] : [];
}

function hasProviderWindows(provider) {
  return Array.isArray(provider?.windows) && provider.windows.length > 0;
}

function windowUsedPercent(window) {
  if (window?.usedPercent === null || window?.usedPercent === undefined) return null;
  const value = Number(window?.usedPercent);
  return Number.isFinite(value) ? value : null;
}

function earlierResetWindow(first, second) {
  const firstReset = timestampMs(first?.resetsAt);
  const secondReset = timestampMs(second?.resetsAt);
  if (firstReset && secondReset && firstReset !== secondReset) return firstReset < secondReset ? first : second;
  return first;
}

// Codex's upstream usage endpoint can intermittently return different non-empty
// quota snapshots for the same authenticated account. Within one active quota
// cycle usage is monotonic, so keep the stricter observed window until its reset
// passes. This prevents a transient alternate snapshot from turning 84% used
// into 10% used (and changing the reset anchor) on the next refresh.
function stableCodexWindow(previous, current, nowMs, transition = {}) {
  if (!previous) return current;
  if (!current) {
    const previousReset = timestampMs(previous.resetsAt);
    return previousReset && previousReset <= nowMs ? null : previous;
  }

  const previousReset = timestampMs(previous.resetsAt);
  const currentReset = timestampMs(current.resetsAt);
  const previousUsed = windowUsedPercent(previous);
  const currentUsed = windowUsedPercent(current);

  if (previousReset && previousReset <= nowMs) return current;
  if (currentReset && currentReset <= nowMs && (!previousReset || previousReset > nowMs)) return previous;

  const sameReset = previousReset && currentReset
    && Math.abs(previousReset - currentReset) <= CODEX_RESET_ANCHOR_TOLERANCE_MS;
  const bothFuture = previousReset > nowMs && currentReset > nowMs;
  if (transition.acceptCurrent) return current;
  if (transition.keepPrevious) return previous;
  if (sameReset || bothFuture || (!previousReset && !currentReset)) {
    if (previousUsed !== null && currentUsed !== null && previousUsed !== currentUsed) {
      return previousUsed > currentUsed ? previous : current;
    }
    return bothFuture ? earlierResetWindow(previous, current) : current;
  }

  if (previousReset > nowMs && !currentReset) return previous;
  if (!previousReset && currentReset > nowMs) {
    if (previousUsed !== null && currentUsed !== null && previousUsed > currentUsed) return previous;
    return current;
  }
  return current;
}

function codexTransitionCandidate(previous, current, nowMs) {
  if (!previous || !current) return null;
  const previousReset = timestampMs(previous.resetsAt);
  const currentReset = timestampMs(current.resetsAt);
  const previousUsed = windowUsedPercent(previous);
  const currentUsed = windowUsedPercent(current);
  if (previousReset <= nowMs || currentReset <= nowMs) return null;
  if (Math.abs(previousReset - currentReset) <= CODEX_RESET_ANCHOR_TOLERANCE_MS) return null;
  if (previousUsed === null || currentUsed === null || currentUsed >= previousUsed) return null;
  return currentReset;
}

function sameCodexReset(first, second) {
  return Boolean(first && second && Math.abs(first - second) <= CODEX_RESET_ANCHOR_TOLERANCE_MS);
}

function reconcileCodexTransition(transitionState, key, previous, current, nowMs, observedKeys) {
  if (!(transitionState instanceof Map) || !key) return {};
  const previousReset = timestampMs(previous?.resetsAt);
  const currentReset = timestampMs(current?.resetsAt);
  let state = transitionState.get(key);

  if (state?.acceptedResetMs && (!sameCodexReset(state.acceptedResetMs, previousReset) || previousReset <= nowMs)) {
    transitionState.delete(key);
    state = null;
  }

  const acceptedResetMs = state?.acceptedResetMs || 0;
  if (acceptedResetMs) {
    observedKeys.add(key);
    if (sameCodexReset(acceptedResetMs, currentReset)) {
      transitionState.set(key, { acceptedResetMs });
      return {};
    }
  }

  const candidateReset = codexTransitionCandidate(previous, current, nowMs);
  if (!candidateReset) {
    if (acceptedResetMs) {
      transitionState.set(key, { acceptedResetMs });
      return { keepPrevious: true };
    }
    transitionState.delete(key);
    return {};
  }

  observedKeys.add(key);
  const confirmations = state?.pendingResetMs
    && sameCodexReset(state.pendingResetMs, candidateReset)
    ? state.confirmations + 1
    : 1;
  if (confirmations >= CODEX_TRANSITION_CONFIRMATIONS) {
    transitionState.set(key, { acceptedResetMs: candidateReset });
    return { acceptCurrent: true };
  }
  transitionState.set(key, {
    ...(acceptedResetMs ? { acceptedResetMs } : {}),
    pendingResetMs: candidateReset,
    confirmations
  });
  return acceptedResetMs ? { keepPrevious: true } : {};
}

function mergeStableCodexWindows(previousProvider, currentProvider, nowMs, transitionState, observedKeys) {
  const identity = codexProviderIdentityKeys(currentProvider)[0] || '';
  const previousByKind = new Map(previousProvider.windows.map((window) => [window.kind, window]));
  const currentByKind = new Map(currentProvider.windows.map((window) => [window.kind, window]));
  const kinds = new Set([...previousByKind.keys(), ...currentByKind.keys()]);
  return Array.from(kinds, (kind) => {
    const previousWindow = previousByKind.get(kind);
    const currentWindow = currentByKind.get(kind);
    const transitionKey = identity ? `${identity}:${kind}` : '';
    const transition = reconcileCodexTransition(
      transitionState,
      transitionKey,
      previousWindow,
      currentWindow,
      nowMs,
      observedKeys
    );
    return stableCodexWindow(previousWindow, currentWindow, nowMs, transition);
  })
    .filter(Boolean)
    .sort((a, b) => WINDOW_ORDER.indexOf(a.kind) - WINDOW_ORDER.indexOf(b.kind));
}

function mergeCodexTransientWindows(
  previousInput,
  currentInput,
  nowMs = Date.now(),
  retentionMs = CODEX_TRANSIENT_WINDOW_RETENTION_MS,
  transitionState = null
) {
  const current = normalizeLimitsSummary(currentInput);
  if (!previousInput || !Number.isFinite(Number(retentionMs)) || Number(retentionMs) <= 0) return current;
  const previous = normalizeLimitsSummary(previousInput);
  const currentMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const previousByIdentity = new Map();
  const observedTransitionKeys = new Set();

  for (const provider of previous.providers) {
    if (provider.provider !== 'codex' || provider.status !== 'ok' || !hasProviderWindows(provider)) continue;
    const providerUpdatedAt = timestampMs(provider.updatedAt || previous.updatedAt);
    const ageMs = providerUpdatedAt ? currentMs - providerUpdatedAt : Number.POSITIVE_INFINITY;
    const recent = ageMs >= 0 && ageMs <= Number(retentionMs);
    const hasActiveWindow = ageMs >= 0 && ageMs <= CODEX_ACTIVE_WINDOW_MAX_AGE_MS
      && provider.windows.some((window) => {
        const resetMs = timestampMs(window.resetsAt);
        return resetMs > currentMs && resetMs - currentMs <= CODEX_ACTIVE_WINDOW_MAX_AGE_MS;
      });
    if (!recent && !hasActiveWindow) continue;
    for (const key of codexProviderIdentityKeys(provider)) {
      const existing = previousByIdentity.get(key);
      if (!existing || timestampMs(provider.updatedAt) >= timestampMs(existing.provider.updatedAt)) {
        previousByIdentity.set(key, { provider, recent });
      }
    }
  }

  const merged = {
    ...current,
    providers: current.providers.map((provider) => {
      if (provider.provider !== 'codex' || provider.status !== 'ok') return provider;
      const previousEntry = codexProviderIdentityKeys(provider)
        .map((key) => previousByIdentity.get(key))
        .find(Boolean);
      if (!previousEntry) return provider;
      const previousProvider = previousEntry.provider;
      if (hasProviderWindows(provider)) {
        return {
          ...provider,
          windows: mergeStableCodexWindows(
            previousProvider,
            provider,
            currentMs,
            transitionState,
            observedTransitionKeys
          )
        };
      }
      if (!previousEntry.recent) return provider;
      const retainedWindows = previousProvider.windows
        .map((window) => stableCodexWindow(window, null, currentMs))
        .filter(Boolean);
      if (retainedWindows.length === 0) return provider;
      return {
        ...provider,
        updatedAt: previousProvider.updatedAt || provider.updatedAt,
        windows: retainedWindows.map((window) => ({ ...window }))
      };
    })
  };

  if (transitionState instanceof Map) {
    for (const [key, state] of transitionState) {
      if (observedTransitionKeys.has(key)) continue;
      if (state.acceptedResetMs > currentMs
        && state.acceptedResetMs - currentMs <= CODEX_ACTIVE_WINDOW_MAX_AGE_MS) {
        transitionState.set(key, { acceptedResetMs: state.acceptedResetMs });
      } else {
        transitionState.delete(key);
      }
    }
  }

  return merged;
}

function seedCodexTransitionState(summaryInput) {
  const state = new Map();
  const summary = normalizeLimitsSummary(summaryInput);
  for (const provider of summary.providers) {
    if (provider.provider !== 'codex' || provider.status !== 'ok') continue;
    const identity = codexProviderIdentityKeys(provider)[0] || '';
    if (!identity) continue;
    for (const window of provider.windows) {
      const resetMs = timestampMs(window.resetsAt);
      if (resetMs) state.set(`${identity}:${window.kind}`, { acceptedResetMs: resetMs });
    }
  }
  return state;
}

function pickBetterProvider(current, candidate) {
  if (!current) return candidate;
  if (current.stale !== candidate.stale) return current.stale ? candidate : current;
  const rankDiff = statusRank(candidate.status) - statusRank(current.status);
  if (rankDiff !== 0) return rankDiff > 0 ? candidate : current;
  const windowRankDiff = providerWindowRank(candidate) - providerWindowRank(current);
  if (windowRankDiff !== 0) return windowRankDiff > 0 ? candidate : current;
  return timestampMs(candidate.updatedAt) >= timestampMs(current.updatedAt) ? candidate : current;
}

function aggregateLimits(devices, staleAfterMs = 0, nowMs = Date.now()) {
  const aggregate = { updatedAt: new Date(nowMs).toISOString(), providers: [] };
  const byKey = new Map();
  const providersWithConfiguredAccounts = new Set();
  const providersWithFreshConfiguredAccounts = new Set();
  const providersWithFreshObservations = new Set();

  for (const device of devices || []) {
    const summary = normalizeLimitsSummary(device?.limits);
    for (const provider of summary.providers) {
      const candidate = {
        ...provider,
        sourceDeviceId: String(device?.deviceId || ''),
        stale: isProviderStale(provider, summary, device, staleAfterMs, nowMs)
      };
      if (isConfiguredProvider(provider)) providersWithConfiguredAccounts.add(provider.provider);
      if (!candidate.stale) {
        providersWithFreshObservations.add(provider.provider);
        if (isConfiguredProvider(provider)) providersWithFreshConfiguredAccounts.add(provider.provider);
      }
      const key = providerAggregateKey(provider);
      byKey.set(key, pickBetterProvider(byKey.get(key), candidate));
    }
  }

  // Second pass: collapse by provider name. Same OAuth account on Mac vs Windows
  // hashes to different accountKeys (keychain identity vs file path), so byKey
  // keeps them as separate entries; without this pass the renderer's per-provider
  // Map.set() would arbitrarily overwrite the fresh one with the stale one.
  const byProvider = new Map();
  for (const candidate of byKey.values()) {
    const hasFreshObservation = providersWithFreshObservations.has(candidate.provider);
    if (candidate.stale && hasFreshObservation) continue;
    const configuredProviders = hasFreshObservation
      ? providersWithFreshConfiguredAccounts
      : providersWithConfiguredAccounts;
    if (!isConfiguredProvider(candidate) && configuredProviders.has(candidate.provider)) continue;
    const collapseKey = providerCollapseKey(candidate);
    byProvider.set(collapseKey, pickBetterProvider(byProvider.get(collapseKey), candidate));
  }
  aggregate.providers = Array.from(byProvider.values())
    .sort((a, b) => {
      const providerSort = a.provider.localeCompare(b.provider);
      if (providerSort !== 0) return providerSort;
      const aLabel = a.accountEmail || a.accountName || a.accountLabel || a.accountKey;
      const bLabel = b.accountEmail || b.accountName || b.accountLabel || b.accountKey;
      return aLabel.localeCompare(bLabel);
    });
  return aggregate;
}

function publicLimits(limits) {
  const normalized = normalizeLimitsSummary(limits);
  return {
    updatedAt: normalized.updatedAt,
    refreshMs: normalized.refreshMs,
    providers: normalized.providers.map(({ accountKey, accountEmail, accountName, accountLabel, ...provider }) => provider)
  };
}

// Sync to the authenticated hub carries the full account identity (key, email,
// display name, and plan label) so other devices can show which managed account each limit belongs
// to. Hub ingest is Secret-protected; the PUBLIC surface is still scrubbed by
// publicLimits() above, which drops every account identifier including email.
function syncLimits(limits) {
  const normalized = normalizeLimitsSummary(limits);
  return {
    updatedAt: normalized.updatedAt,
    refreshMs: normalized.refreshMs,
    providers: normalized.providers
  };
}

module.exports = {
  DEFAULT_LIMITS_REFRESH_MS,
  aggregateLimits,
  mergeCodexTransientWindows,
  normalizeLimitProvider,
  normalizeLimitsSummary,
  normalizeLimitWindow,
  publicLimits,
  seedCodexTransitionState,
  syncLimits
};
