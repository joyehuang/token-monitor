'use strict';

// Grok (xAI) SuperGrok subscription usage lookup.
//
// Endpoint: https://cli-chat-proxy.grok.com/v1/billing
// Auth: Bearer token from ~/.grok/auth.json (written by `grok login`) or
//       GROK_BEARER_TOKEN env var.
//
// Field shape and auth pattern mirror TokenTracker's grok-limits.js (same
// endpoint, same `config: { monthlyLimit, used, billingPeriodEnd }` envelope).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeLimitProvider } = require('./limits');
const { hashKey } = require('./hashKey');

const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing';
const GROK_KEY_NAMES = ['GROK_BEARER_TOKEN'];
const GROK_OIDC_PREFIX = 'https://auth.x.ai::';
const GROK_LEGACY_SCOPE = 'https://accounts.x.ai/sign-in';

function resolveGrokHome(env = process.env) {
  if (typeof env.TOKENTRACKER_GROK_HOME === 'string' && env.TOKENTRACKER_GROK_HOME.trim()) {
    return path.resolve(env.TOKENTRACKER_GROK_HOME.trim());
  }
  if (typeof env.GROK_HOME === 'string' && env.GROK_HOME.trim()) {
    return path.resolve(env.GROK_HOME.trim());
  }
  return path.join(os.homedir(), '.grok');
}

function cleanSecret(value) {
  let raw = value;
  if (typeof raw !== 'string') return '';
  raw = raw.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

// Read ~/.grok/auth.json. Prefer OIDC scope (SuperGrok), fall back to legacy
// /sign-in, then fall back to any entry with a non-empty `key` field.
// Returns { token, source, path } or null. Synchronous — uses fs.readFileSync
// because auth.json is tiny and the only async entry point (limitCollector)
// just needs the data ready before issuing the HTTP fetch.
function readAuthJson(env = process.env, deps = {}) {
  const home = deps.grokHome || resolveGrokHome(env);
  const filePath = path.join(home, 'auth.json');
  let raw;
  try {
    raw = (deps.readFileSync || fs.readFileSync)(filePath, 'utf8');
  } catch (_) {
    return null;
  }
  let root;
  try { root = JSON.parse(raw); } catch (_) { return null; }
  if (!root || typeof root !== 'object') return null;
  const entries = Object.entries(root).filter(([, v]) => v && typeof v === 'object'
    && typeof v.key === 'string' && v.key.trim() !== '');
  const oidc = entries.find(([scope]) => scope.startsWith(GROK_OIDC_PREFIX));
  const legacy = entries.find(([scope]) => scope === GROK_LEGACY_SCOPE || scope.includes('/sign-in'));
  const picked = oidc || legacy || entries[0];
  if (!picked) return null;
  const [scope, entry] = picked;
  return {
    token: entry.key.trim(),
    source: oidc ? 'auth.json-oidc' : legacy ? 'auth.json-legacy' : `auth.json:${scope}`,
    path: filePath
  };
}

function grokCredential(env = process.env, options = {}) {
  // Priority: explicit settings > env > ~/.grok/auth.json (auto).
  // The widget GUI no longer exposes a token field; env var and auth.json
  // cover headless / CLI flows.
  if (options && options.grokBearerToken) {
    const raw = cleanSecret(options.grokBearerToken);
    if (raw) return { token: raw, source: 'settings' };
  }
  for (const name of GROK_KEY_NAMES) {
    const raw = cleanSecret(env[name]);
    if (raw) return { token: raw, source: 'env' };
  }
  return readAuthJson(env, options);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' && value !== null && 'val' in value) return numberOrNull(value.val);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return n;
}

function normalizeIsoReset(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ts = Date.parse(value.trim());
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : null;
}

// Build a single window spec from a (used, limit) pair. Returns null when
// limit is missing/zero or used is unknown.
function buildWindow(label, used, limit, resetsAt) {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return {
    kind: 'session',
    label,
    usedPercent: clampPercent((used / limit) * 100),
    resetsAt,
    windowMinutes: null,
    showMeter: true
  };
}

// Parse the JSON body returned by GET /v1/billing into the single monthly
// quota window. The API also returns on-demand usage, but token-monitor's
// "Session / Weekly" UI model doesn't have a clean place for an auxiliary
// "On-demand" meter alongside "Monthly", so we drop it. TokenTracker's
// dashboard renders both; ours collapses to the primary subscription.
function parseGrokBilling(body) {
  const config = body && body.config;
  if (!config || typeof config !== 'object') {
    const err = new Error('Grok billing response missing config');
    err.status = 'unavailable';
    throw err;
  }
  const monthlyLimit = numberOrNull(config.monthlyLimit);
  const used = numberOrNull(config.used);
  const resetAt = normalizeIsoReset(config.billingPeriodEnd);

  const monthly = buildWindow('Monthly', used, monthlyLimit, resetAt);
  if (!monthly) {
    const err = new Error('Grok billing response has no monthly quota');
    err.status = 'unavailable';
    throw err;
  }
  return [monthly];
}

async function fetchGrokLimits(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const now = (deps.now || Date.now)();
  const updatedAt = new Date(now).toISOString();
  const credential = grokCredential(env, { ...options, ...(deps.grokHome ? { grokHome: deps.grokHome } : {}) });
  if (!credential) {
    return normalizeLimitProvider({
      provider: 'grok',
      source: 'web',
      status: 'notConfigured',
      updatedAt,
      windows: []
    });
  }
  try {
    const fetchFn = deps.fetch || fetch;
    const response = await fetchFn(GROK_BILLING_URL, {
      headers: {
        Authorization: `Bearer ${credential.token}`,
        Accept: 'application/json'
      }
    });
    if (response.status === 401 || response.status === 403) {
      return normalizeLimitProvider({
        provider: 'grok',
        source: 'web',
        status: 'unauthorized',
        updatedAt,
        windows: []
      });
    }
    if (!response.ok) {
      return normalizeLimitProvider({
        provider: 'grok',
        source: 'web',
        status: 'unavailable',
        updatedAt,
        windows: []
      });
    }
    const body = await response.json();
    const windows = parseGrokBilling(body);
    return normalizeLimitProvider({
      provider: 'grok',
      accountKey: hashKey('grok', credential.token),
      accountLabel: 'SuperGrok',
      source: 'web',
      status: 'ok',
      updatedAt,
      windows
    });
  } catch (error) {
    return normalizeLimitProvider({
      provider: 'grok',
      source: 'web',
      status: error && error.status ? error.status : 'unavailable',
      updatedAt,
      windows: []
    });
  }
}

module.exports = {
  GROK_BILLING_URL,
  GROK_KEY_NAMES,
  GROK_OIDC_PREFIX,
  GROK_LEGACY_SCOPE,
  resolveGrokHome,
  readAuthJson,
  grokCredential,
  parseGrokBilling,
  fetchGrokLimits
};