'use strict';

// MiniMax (a.k.a. Minimax / Hailuo AI) Token Plan quota lookup.
//
// Field shape verified against live Token Plan responses (see PR #32 review):
// the array is nested under data.model_remains, and the live response does
// not always carry current_interval_status / current_weekly_status. We
// therefore read whatever percent is present, and only suppress the
// status==3 placeholder lane that cc-switch / CodexBar both guard against.

const { normalizeLimitProvider } = require('./limits');
const { hashKey } = require('./hashKey');

const MINIMAX_KEY_NAMES = ['MINIMAX_TOKEN_PLAN_KEY', 'MINIMAX_API_KEY'];

const MINIMAX_REMAINS_URL_CN = 'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains';
const MINIMAX_REMAINS_URL_EN = 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains';

const MINIMAX_WINDOW_MINUTES_5H = 5 * 60;
const MINIMAX_WINDOW_MINUTES_WEEKLY = 7 * 24 * 60;

function cleanSecret(value) {
  let raw = value;
  if (typeof raw !== 'string') return '';
  raw = raw.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

function minimaxToken(env = process.env, explicitKey = '') {
  const explicit = cleanSecret(explicitKey);
  if (explicit) return explicit;
  for (const name of MINIMAX_KEY_NAMES) {
    const raw = cleanSecret(env[name]);
    if (raw) return raw;
  }
  return '';
}

// Parse a value that arrives as either a JS number or a numeric string into
// a number, or null if it's missing / not numeric. Used for status codes,
// percent fields (the live response sends them as strings), and timestamps —
// same shape, the unit is up to the caller.
function parseNumberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function millisToIso8601(value) {
  const ms = parseNumberOrNull(value);
  if (ms === null) return null;
  // Treat <1e12 as seconds (matches cc-switch's `millis_to_iso8601`).
  const normalized = ms < 1_000_000_000_000 ? ms * 1000 : ms;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// The live endpoint nests model_remains under data, but a handful of proxies
// (and our test fixtures) flatten it. Read the nested shape first, fall back
// to the top level so both representations work.
function readMinimaxRows(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.data && typeof body.data === 'object' && Array.isArray(body.data.model_remains)) {
    return body.data.model_remains;
  }
  if (Array.isArray(body.model_remains)) {
    return body.model_remains;
  }
  return null;
}

// Pull the `general` bucket out of `model_remains`. cc-switch treats
// model_name === 'general' as the coding-plan row; video / voice / other
// models live in the same array and must be ignored.
function selectMinimaxGeneralBucket(body) {
  const rows = readMinimaxRows(body);
  if (!rows) return null;
  return rows.find((row) => row && row.model_name === 'general') || null;
}

// A status==3 lane is the server's "no entitlement here" placeholder; it
// shows up as 100% / null percent depending on the plan. Suppress it so the
// widget doesn't render an empty meter. Matches the CodexBar placeholder
// guard the reviewer cross-checked against.
function isPlaceholderMinimaxLane(item, percentField, statusField) {
  if (!item) return true;
  if (parseNumberOrNull(item[statusField]) !== 3) return false;
  const pct = parseNumberOrNull(item[percentField]);
  return pct === null || pct >= 100;
}

// 5h window: `current_interval_remaining_percent` is "remaining" (0-100).
// Emit whenever a usable percent is present; suppress only the placeholder
// lane above. percents arrive as strings in the live response.
function buildMinimaxSessionWindow(item) {
  if (!item) return null;
  if (isPlaceholderMinimaxLane(item, 'current_interval_remaining_percent', 'current_interval_status')) return null;
  const remainPct = parseNumberOrNull(item.current_interval_remaining_percent);
  if (remainPct === null) return null;
  const used = Math.max(0, Math.min(100, 100 - remainPct));
  return {
    kind: 'session',
    label: '5h',
    usedPercent: used,
    remainingPercent: Math.max(0, Math.min(100, remainPct)),
    resetsAt: millisToIso8601(item.end_time),
    windowMinutes: MINIMAX_WINDOW_MINUTES_5H,
    showMeter: true
  };
}

// Weekly window: same shape as session, gated on the weekly fields.
function buildMinimaxWeeklyWindow(item) {
  if (!item) return null;
  if (isPlaceholderMinimaxLane(item, 'current_weekly_remaining_percent', 'current_weekly_status')) return null;
  const remainPct = parseNumberOrNull(item.current_weekly_remaining_percent);
  if (remainPct === null) return null;
  const used = Math.max(0, Math.min(100, 100 - remainPct));
  return {
    kind: 'weekly',
    label: 'Weekly',
    usedPercent: used,
    remainingPercent: Math.max(0, Math.min(100, remainPct)),
    resetsAt: millisToIso8601(item.weekly_end_time),
    windowMinutes: MINIMAX_WINDOW_MINUTES_WEEKLY,
    showMeter: true
  };
}

// Body must already be the parsed JSON. Returns the windows array, never
// throws. Returns [] when the response lacks the expected shape so the
// collector can still surface the provider row with status 'unavailable'.
function parseMinimaxTiers(body) {
  const item = selectMinimaxGeneralBucket(body);
  if (!item) return [];
  const windows = [];
  const session = buildMinimaxSessionWindow(item);
  if (session) windows.push(session);
  const weekly = buildMinimaxWeeklyWindow(item);
  if (weekly) windows.push(weekly);
  return windows;
}

// Returns the list of base URLs to try, in order. Default order is global
// first (api.minimax.io), then CN (api.minimaxi.com), so a global account
// works without any setting and a CN account is picked up automatically
// when the global endpoint rejects the token — the same fallback CodexBar
// uses. Callers can pin a single region with `minimaxApiHost: 'cn'` /
// `'minimax.io'` / `'en'`.
function minimaxAttemptOrder(options = {}) {
  const pinned = options.minimaxApiHost;
  if (pinned === 'cn') return [MINIMAX_REMAINS_URL_CN];
  if (pinned === 'en' || pinned === 'minimax.io') return [MINIMAX_REMAINS_URL_EN];
  return [MINIMAX_REMAINS_URL_EN, MINIMAX_REMAINS_URL_CN];
}

function minimaxRegionForUrl(url) {
  if (url === MINIMAX_REMAINS_URL_EN) return 'en';
  if (url === MINIMAX_REMAINS_URL_CN) return 'cn';
  return '';
}

// Pick a single URL for callers that want a forced region without retry
// behavior (legacy `minimaxBaseUrl` shape). Default is the global endpoint;
// pass minimaxApiHost: 'cn' to pin to the CN endpoint.
function minimaxBaseUrl(options = {}) {
  const pinned = options.minimaxApiHost;
  if (pinned === 'cn') return MINIMAX_REMAINS_URL_CN;
  return MINIMAX_REMAINS_URL_EN;
}

async function fetchMinimaxLimits(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const now = (deps.now || Date.now)();
  const updatedAt = new Date(now).toISOString();
  const key = minimaxToken(env, options.minimaxApiKey);
  if (!key) {
    return normalizeLimitProvider({
      provider: 'minimax',
      source: 'api',
      status: 'notConfigured',
      updatedAt,
      windows: []
    });
  }
  const fetchJson = deps.fetchJson || (async (u, headers) => {
    const response = await (deps.fetch || fetch)(u, { headers });
    if (!response.ok) {
      const status = response.status === 401 ? 'unauthorized' : response.status === 429 ? 'sourceRateLimited' : 'unavailable';
      const error = new Error(`${u} returned ${response.status}`);
      error.status = status;
      error.statusCode = response.status;
      throw error;
    }
    return response.json();
  });
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  const attempts = minimaxAttemptOrder(options);
  let lastError = null;
  for (const url of attempts) {
    try {
      const data = await fetchJson(url, headers, deps);
      if (!data || typeof data !== 'object') {
        throw Object.assign(new Error('unexpected remains response shape'), { status: 'unavailable' });
      }
      const baseResp = data.base_resp;
      if (baseResp && typeof baseResp === 'object') {
        const statusCode = parseNumberOrNull(baseResp.status_code);
        if (statusCode !== null && statusCode !== 0) {
          const statusMsg = typeof baseResp.status_msg === 'string' ? baseResp.status_msg : 'unknown error';
          // Map auth-shaped errors to 'unauthorized' so the UI surfaces
          // 'Update API key' instead of the generic 'Unavailable'. The endpoint
          // signals auth failures via base_resp.status_msg phrasing ("log in",
          // "cookie", "token", "auth", "key", "expired") rather than the HTTP
          // status, which is always 200. Heuristic but matches the only
          // failure mode observed against the live endpoint (status_code 1004).
          const lower = statusMsg.toLowerCase();
          const looksLikeAuth = /\b(log\s*in|cookie|token|auth|key|expired|invalid)\b/.test(lower);
          const status = looksLikeAuth ? 'unauthorized' : 'unavailable';
          // Auth-shaped base_resp errors also drive the region retry. The
          // endpoint returns 200 OK with status_code: 1004 ("cookie is missing,
          // log in again") when the token belongs to the OTHER region — that's
          // the same signal a 401 carries, just hidden in the body. Set
          // statusCode: 401 so the retry loop in the caller picks it up.
          const retrySignal = looksLikeAuth ? 401 : null;
          throw Object.assign(new Error(`MiniMax error (code ${statusCode}): ${statusMsg}`), {
            status,
            ...(retrySignal !== null ? { statusCode: retrySignal } : {})
          });
        }
      }
      const windows = parseMinimaxTiers(data);
      const accountKey = hashKey('minimax', key);
      return normalizeLimitProvider({
        provider: 'minimax',
        accountKey,
        accountLabel: 'Token Plan',
        source: 'api',
        status: windows.length ? 'ok' : 'unavailable',
        updatedAt,
        windows,
        region: minimaxRegionForUrl(url)
      });
    } catch (error) {
      lastError = error;
      // Only retry when the token was rejected (401/403): that's the "wrong
      // region" signal. Any other error (network, 5xx, malformed JSON) is
      // surfaced immediately so the user sees the real failure.
      const code = Number(error && error.statusCode);
      if (code !== 401 && code !== 403) break;
      // Already tried both regions? Stop.
      if (attempts.indexOf(url) === attempts.length - 1) break;
    }
  }
  return normalizeLimitProvider({
    provider: 'minimax',
    source: 'api',
    status: mapMinimaxErrorStatus(lastError),
    updatedAt,
    windows: []
  });
}

function mapMinimaxErrorStatus(error) {
  const status = error && error.status;
  if (['disabled', 'notConfigured', 'unauthorized', 'rateLimited', 'sourceRateLimited', 'unavailable', 'error'].includes(status)) return status;
  return 'unavailable';
}

module.exports = {
  MINIMAX_KEY_NAMES,
  MINIMAX_REMAINS_URL_CN,
  MINIMAX_REMAINS_URL_EN,
  minimaxToken,
  minimaxAttemptOrder,
  minimaxBaseUrl,
  minimaxRegionForUrl,
  parseMinimaxTiers,
  fetchMinimaxLimits
};