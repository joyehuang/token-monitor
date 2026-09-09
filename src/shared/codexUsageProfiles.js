'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { emptyPeriod, mergePeriods, startOfLocalWeek } = require('./usage');

const PERSONAL_PROFILE = Object.freeze({ id: 'codex-personal', client: 'codex', label: 'Personal' });
const MAX_FILES = 10000;
const MAX_BYTES_PER_FILE_PER_SCAN = 16 * 1024 * 1024;
const MAX_BYTES_PER_PROFILE_PER_SCAN = 32 * 1024 * 1024;
const MAX_JSONL_LINE_BYTES = 1024 * 1024;
// Version 1 could persist offsets beyond the bytes actually read when a short
// final read reused a buffer containing an old newline. Rebuild those entries
// rather than trusting a poisoned incremental position.
const CACHE_VERSION = 2;

function safeId(value, fallback = 'work') {
  const id = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const normalized = id || fallback;
  return normalized.startsWith('codex-') ? normalized : `codex-${normalized}`;
}

function safeLabel(value) {
  return String(value || 'Work').replace(/[\r\n\t]/g, ' ').trim().slice(0, 48) || 'Work';
}

function parseProfileSetting(value) {
  if (Array.isArray(value)) return value;
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeCodexUsageProfileSettings(value) {
  const result = [];
  const seenIds = new Set([PERSONAL_PROFILE.id]);
  for (const raw of parseProfileSetting(value)) {
    if (!raw || typeof raw !== 'object') continue;
    const profilePath = String(raw.path || raw.home || raw.root || '').trim();
    if (!profilePath || !path.isAbsolute(profilePath)) continue;
    let id = safeId(raw.id || raw.label);
    if (id === PERSONAL_PROFILE.id) id = 'codex-work';
    const baseId = id;
    let suffix = 2;
    while (seenIds.has(id)) id = `${baseId}-${suffix++}`;
    seenIds.add(id);
    result.push({
      id,
      label: safeLabel(raw.label),
      path: profilePath,
      enabled: raw.enabled !== false
    });
  }
  return result;
}

function canonicalPath(value, fsImpl = fs) {
  const resolved = path.resolve(String(value || ''));
  try { return fsImpl.realpathSync(resolved); } catch (_) { return resolved; }
}

function codexRootFor(value, fsImpl = fs) {
  const resolved = path.resolve(String(value || ''));
  if (path.basename(resolved) === '.codex' || path.basename(canonicalPath(resolved, fsImpl)) === '.codex') return resolved;
  try {
    if (fsImpl.statSync(path.join(resolved, 'sessions')).isDirectory()) return resolved;
  } catch (_) {}
  return path.join(resolved, '.codex');
}

// This is deliberately a local-only configuration shape. Callers must pass only
// publicProfileMetadata() into collector summaries or IPC/Hub payloads.
function normalizeCodexUsageProfiles(value, options = {}) {
  const fsImpl = options.fs || fs;
  const personalRoot = canonicalPath(path.join(options.homeDir || os.homedir(), '.codex'), fsImpl);
  const seenRoots = new Set([personalRoot]);
  const seenIds = new Set([PERSONAL_PROFILE.id]);
  const profiles = [];
  for (const raw of parseProfileSetting(value)) {
    if (!raw || typeof raw !== 'object' || raw.enabled === false) continue;
    const configuredPath = String(raw.path || raw.home || raw.root || '').trim();
    if (!configuredPath || !path.isAbsolute(configuredPath)) continue;
    const root = codexRootFor(configuredPath, fsImpl);
    const canonicalRoot = canonicalPath(root, fsImpl);
    if (seenRoots.has(canonicalRoot)) continue;
    let id = safeId(raw.id || raw.label);
    if (id === PERSONAL_PROFILE.id) id = 'codex-work';
    let suffix = 2;
    const baseId = id;
    while (seenIds.has(id)) id = `${baseId}-${suffix++}`;
    seenRoots.add(canonicalRoot);
    seenIds.add(id);
    profiles.push({ id, client: 'codex', label: safeLabel(raw.label), root, canonicalRoot });
  }
  return profiles;
}

function publicProfileMetadata(profiles, includePersonal = true) {
  const result = includePersonal ? [{ ...PERSONAL_PROFILE }] : [];
  for (const profile of profiles || []) result.push({ id: profile.id, client: 'codex', label: profile.label });
  return result;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function fileIdentity(profileId, filePath, stat) {
  const physical = stat && Number(stat.ino) > 0
    ? `${stat.dev || 0}:${stat.ino}:${stat.birthtimeMs || 0}`
    : canonicalPath(filePath);
  return hash(`${profileId}\0${physical}`);
}

function rootFingerprint(profile) {
  return hash(`${profile.id}\0${profile.canonicalRoot || profile.root}`);
}

function profileConfigFingerprint(value, options = {}) {
  return hash(normalizeCodexUsageProfiles(value, options).map((profile) => [profile.id, profile.label, profile.canonicalRoot]).sort().map((item) => JSON.stringify(item)).join('|'));
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function usageComponents(value) {
  if (!value || typeof value !== 'object') return null;
  const hasUsage = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'total_tokens'].some((key) => Object.prototype.hasOwnProperty.call(value, key));
  if (!hasUsage) return null;
  const cacheReadTokens = num(value.cached_input_tokens);
  const inputTokens = Math.max(0, num(value.input_tokens) - cacheReadTokens);
  const outputTokens = num(value.output_tokens);
  const reasoningTokens = Math.min(outputTokens, num(value.reasoning_output_tokens));
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens: 0,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens
  };
}

function emptyTotals() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0 };
}

function addTotals(target, source) {
  for (const key of Object.keys(emptyTotals())) target[key] = num(target[key]) + num(source?.[key]);
  return target;
}

function subtractTotals(current, previous) {
  const result = emptyTotals();
  for (const key of Object.keys(result)) result[key] = Math.max(0, num(current?.[key]) - num(previous?.[key]));
  result.totalTokens = result.inputTokens + result.outputTokens + result.cacheReadTokens + result.cacheWriteTokens;
  return result;
}

function cumulativeWentBackwards(current, previous) {
  if (!previous) return false;
  return ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].some((key) => num(current[key]) < num(previous[key]));
}

function localDayKey(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function freshEntry(profileId, identity) {
  return {
    profileId,
    identity,
    offset: 0,
    size: 0,
    mtimeMs: 0,
    skipOversizedTail: false,
    sessionId: '',
    model: 'unknown',
    firstTimestamp: '',
    lastTimestamp: '',
    cumulative: null,
    sawCumulativeUsage: false,
    recentUsageEvents: [],
    daily: {},
    malformedLines: 0,
    oversizedLines: 0
  };
}

function usageEventId(timestamp, type, usage, model) {
  return hash(JSON.stringify([timestamp || '', type || '', model || '', usage]));
}

function anonymousSessionId(profileId, value) {
  return `sha256:${hash(`${profileId}\0${String(value || '')}`).slice(0, 24)}`;
}

function addUsage(entry, usage, timestamp, model, eventKind, isCumulative) {
  if (!usage || usage.totalTokens <= 0) return;
  const eventId = usageEventId(timestamp, eventKind, usage, model);
  if (!isCumulative && entry.recentUsageEvents.includes(eventId)) return;
  if (!isCumulative) entry.recentUsageEvents = [...entry.recentUsageEvents.slice(-127), eventId];
  const day = localDayKey(timestamp);
  if (!day) return;
  const bucket = entry.daily[day] || (entry.daily[day] = { ...emptyTotals(), messageCount: 0, firstTimestamp: '', lastTimestamp: '', models: {} });
  addTotals(bucket, usage);
  bucket.messageCount += 1;
  if (!bucket.firstTimestamp || timestamp < bucket.firstTimestamp) bucket.firstTimestamp = timestamp;
  if (!bucket.lastTimestamp || timestamp > bucket.lastTimestamp) bucket.lastTimestamp = timestamp;
  const modelName = String(model || entry.model || 'unknown').trim() || 'unknown';
  const modelUsage = bucket.models[modelName] || (bucket.models[modelName] = emptyTotals());
  addTotals(modelUsage, usage);
  if (!entry.firstTimestamp || timestamp < entry.firstTimestamp) entry.firstTimestamp = timestamp;
  if (!entry.lastTimestamp || timestamp > entry.lastTimestamp) entry.lastTimestamp = timestamp;
}

function usageEnvelope(obj) {
  const payload = obj && typeof obj.payload === 'object' ? obj.payload : {};
  const info = payload && typeof payload.info === 'object' ? payload.info : {};
  const type = String(payload.type || obj?.type || '');
  if (type !== 'token_count' && type !== 'turn.completed' && type !== 'turn_completed') return null;
  const totalRaw = info.total_token_usage || payload.total_token_usage || obj.total_token_usage;
  const lastRaw = info.last_token_usage || payload.last_token_usage || payload.usage || obj.usage;
  return { type, total: usageComponents(totalRaw), last: usageComponents(lastRaw) };
}

function processAllowedJson(entry, obj) {
  if (!obj || typeof obj !== 'object') return;
  const payload = obj.payload && typeof obj.payload === 'object' ? obj.payload : {};
  const timestamp = String(obj.timestamp || payload.timestamp || '');
  if (obj.type === 'session_meta') {
    const id = String(payload.id || payload.session_id || '').trim();
    // Additional-profile session ids are used only for stable grouping and
    // deduplication. Hash them at the parse boundary so raw ids never enter the
    // cache, collector state, renderer, or Hub payload.
    if (id) entry.sessionId = anonymousSessionId(entry.profileId, id.slice(0, 200));
  }
  if (obj.type === 'turn_context') {
    const model = String(payload.model || '').trim();
    if (model) entry.model = model.slice(0, 160);
  }
  const envelope = usageEnvelope(obj);
  if (!envelope) return;
  if (envelope.total) {
    const delta = !entry.cumulative || cumulativeWentBackwards(envelope.total, entry.cumulative)
      ? envelope.total
      : subtractTotals(envelope.total, entry.cumulative);
    entry.cumulative = envelope.total;
    entry.sawCumulativeUsage = true;
    addUsage(entry, delta, timestamp, entry.model, envelope.type, true);
  } else if (envelope.last) {
    // Current Codex logs may emit turn.completed beside the authoritative
    // cumulative token_count for the same turn. Once a cumulative stream is
    // present, treating completion usage as additive would double count it.
    if ((envelope.type === 'turn.completed' || envelope.type === 'turn_completed') && (entry.sawCumulativeUsage || entry.cumulative)) return;
    addUsage(entry, envelope.last, timestamp, entry.model, envelope.type, false);
  }
}

function parseFileIncrement(filePath, profileId, existing, stat, options = {}) {
  const identity = fileIdentity(profileId, filePath, stat);
  let entry = existing && existing.identity === identity ? existing : freshEntry(profileId, identity);
  if (stat.size < num(entry.offset) || (stat.size === num(entry.size) && stat.mtimeMs !== Number(entry.mtimeMs || 0))) {
    entry = freshEntry(profileId, identity);
  }
  const startOffset = Math.min(stat.size, num(entry.offset));
  if (startOffset >= stat.size) {
    entry.size = stat.size;
    entry.mtimeMs = stat.mtimeMs;
    return { entry, bytesRead: 0 };
  }

  const maxBytes = options.maxBytesPerFile || MAX_BYTES_PER_FILE_PER_SCAN;
  const endOffset = Math.min(stat.size, startOffset + maxBytes);
  const fd = fs.openSync(filePath, 'r');
  let cursor = startOffset;
  let committedOffset = startOffset;
  let lineStartOffset = startOffset;
  let lineParts = [];
  let lineLength = 0;
  let skipping = Boolean(entry.skipOversizedTail);
  let bytesRead = 0;
  try {
    const chunk = Buffer.alloc(64 * 1024);
    while (cursor < endOffset) {
      const length = Math.min(chunk.length, endOffset - cursor);
      const read = fs.readSync(fd, chunk, 0, length, cursor);
      if (read <= 0) break;
      bytesRead += read;
      let index = 0;
      while (index < read) {
        // `chunk` is reused. Bytes after `read` still belong to an earlier
        // iteration and must never be searched for a newline.
        const relativeNewline = chunk.subarray(index, read).indexOf(0x0a);
        const newline = relativeNewline === -1 ? -1 : index + relativeNewline;
        const segmentEnd = newline === -1 ? read : newline;
        const segmentLength = segmentEnd - index;
        if (!skipping && segmentLength > 0) {
          if (lineLength + segmentLength > (options.maxLineBytes || MAX_JSONL_LINE_BYTES)) {
            entry.oversizedLines += 1;
            lineParts = [];
            lineLength = 0;
            skipping = true;
          } else {
            lineParts.push(Buffer.from(chunk.subarray(index, segmentEnd)));
            lineLength += segmentLength;
          }
        }
        cursor += segmentLength;
        index = segmentEnd;
        if (newline !== -1) {
          cursor += 1;
          index += 1;
          if (!skipping && lineLength > 0) {
            try { processAllowedJson(entry, JSON.parse(Buffer.concat(lineParts, lineLength).toString('utf8').trim())); }
            catch (_) { entry.malformedLines += 1; }
          }
          lineParts = [];
          lineLength = 0;
          skipping = false;
          committedOffset = cursor;
          lineStartOffset = cursor;
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  const observedEnd = Math.min(stat.size, startOffset + bytesRead);
  if (skipping) {
    entry.offset = Math.min(cursor, observedEnd);
    entry.skipOversizedTail = true;
  } else {
    entry.offset = Math.min(lineLength > 0 ? lineStartOffset : committedOffset, observedEnd);
    entry.skipOversizedTail = false;
  }
  entry.size = stat.size;
  entry.mtimeMs = stat.mtimeMs;
  return { entry, bytesRead };
}

function listJsonlFiles(root, options = {}) {
  const fsImpl = options.fs || fs;
  const roots = [path.join(root, 'sessions'), path.join(root, 'archived_sessions')];
  const result = [];
  const seen = new Set();
  const maxFiles = options.maxFiles || MAX_FILES;
  const discoveryRound = num(options.discoveryRound);
  const rotate = (items, amount) => {
    if (items.length < 2) return items;
    const start = amount % items.length;
    return [...items.slice(start), ...items.slice(0, start)];
  };
  const orderedRoots = rotate(roots, discoveryRound);
  const stack = orderedRoots.slice().reverse().map((candidate) => ({ candidate, item: null }));
  let truncated = false;
  while (stack.length && result.length < maxFiles) {
    const node = stack.pop();
    if (node.item && !node.item.isDirectory()) {
      if (!node.item.isFile() || path.extname(node.item.name).toLowerCase() !== '.jsonl') continue;
      const canonical = canonicalPath(node.candidate, fsImpl);
      if (!seen.has(canonical)) { seen.add(canonical); result.push(node.candidate); }
      continue;
    }
    let entries;
    try { entries = fsImpl.readdirSync(node.candidate, { withFileTypes: true }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const containsDirectories = entries.some((item) => item.isDirectory());
    const rotation = containsDirectories ? discoveryRound : discoveryRound * maxFiles;
    const ordered = rotate(entries, rotation);
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const item = ordered[index];
      stack.push({ candidate: path.join(node.candidate, item.name), item });
    }
  }
  if (stack.length || result.length >= maxFiles) truncated = true;
  return { files: result, truncated };
}

function readCache(cachePath) {
  if (!cachePath) return { version: CACHE_VERSION, profiles: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return parsed?.version === CACHE_VERSION && parsed.profiles && typeof parsed.profiles === 'object'
      ? parsed
      : { version: CACHE_VERSION, profiles: {} };
  } catch (_) {
    return { version: CACHE_VERSION, profiles: {} };
  }
}

function writeCache(cachePath, cache) {
  if (!cachePath) return;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const temp = `${cachePath}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(cache)}\n`, 'utf8');
    fs.renameSync(temp, cachePath);
  } catch (_) {
    // Collection remains useful when the cache directory is temporarily
    // read-only; the next tick reparses but the main collector stays alive.
  }
}

function mergeSessionEntries(entries) {
  const sessions = new Map();
  for (const entry of entries) {
    const sessionId = entry.sessionId || `anonymous-${entry.identity.slice(0, 16)}`;
    const current = sessions.get(sessionId);
    if (!current || Object.values(entry.daily || {}).reduce((sum, day) => sum + num(day.totalTokens), 0) > Object.values(current.daily || {}).reduce((sum, day) => sum + num(day.totalTokens), 0)) {
      sessions.set(sessionId, entry);
    }
  }
  return sessions;
}

function addEntryToPeriod(period, entry, profile, predicate) {
  const sessionId = entry.sessionId || `anonymous-${entry.identity.slice(0, 16)}`;
  const session = {
    client: 'codex', profileId: profile.id, sessionId, detailAvailable: false,
    ...emptyTotals(), costUsd: 0, messageCount: 0,
    startedAt: '', lastUsedAt: '', models: {}, modelCosts: {}, providers: { openai: 0 }, modelComponents: {}
  };
  for (const [dayKey, bucket] of Object.entries(entry.daily || {})) {
    if (!predicate(dayKey)) continue;
    addTotals(session, bucket);
    session.messageCount += num(bucket.messageCount);
    if (bucket.firstTimestamp && (!session.startedAt || bucket.firstTimestamp < session.startedAt)) session.startedAt = bucket.firstTimestamp;
    if (bucket.lastTimestamp && (!session.lastUsedAt || bucket.lastTimestamp > session.lastUsedAt)) session.lastUsedAt = bucket.lastTimestamp;
    for (const [model, modelUsage] of Object.entries(bucket.models || {})) {
      const normalized = typeof modelUsage === 'number' ? { ...emptyTotals(), totalTokens: num(modelUsage) } : modelUsage;
      session.models[model] = (session.models[model] || 0) + num(normalized.totalTokens);
      if (!session.modelComponents[model]) session.modelComponents[model] = emptyTotals();
      addTotals(session.modelComponents[model], normalized);
    }
  }
  if (session.totalTokens <= 0) return;
  session.providers.openai = session.totalTokens;
  period.totalTokens += session.totalTokens;
  period.cacheReadTokens += session.cacheReadTokens;
  period.cacheWriteTokens += session.cacheWriteTokens;
  period.outputTokens += session.outputTokens;
  period.clients.codex = (period.clients.codex || 0) + session.totalTokens;
  period.clientCacheReads.codex = (period.clientCacheReads.codex || 0) + session.cacheReadTokens;
  period.clientCacheWrites.codex = (period.clientCacheWrites.codex || 0) + session.cacheWriteTokens;
  period.clientOutputs.codex = (period.clientOutputs.codex || 0) + session.outputTokens;
  period.profiles[profile.id] = (period.profiles[profile.id] || 0) + session.totalTokens;
  period.profileCacheReads[profile.id] = (period.profileCacheReads[profile.id] || 0) + session.cacheReadTokens;
  period.profileCacheWrites[profile.id] = (period.profileCacheWrites[profile.id] || 0) + session.cacheWriteTokens;
  period.profileOutputs[profile.id] = (period.profileOutputs[profile.id] || 0) + session.outputTokens;
  for (const [model, tokens] of Object.entries(session.models)) {
    const components = session.modelComponents[model] || emptyTotals();
    period.models[model] = (period.models[model] || 0) + tokens;
    period.modelCacheReads[model] = (period.modelCacheReads[model] || 0) + num(components.cacheReadTokens);
    period.modelCacheWrites[model] = (period.modelCacheWrites[model] || 0) + num(components.cacheWriteTokens);
    period.modelOutputs[model] = (period.modelOutputs[model] || 0) + num(components.outputTokens);
    if (!period.clientModels.codex) period.clientModels.codex = {};
    period.clientModels.codex[model] = (period.clientModels.codex[model] || 0) + tokens;
    if (!period.profileModels[profile.id]) period.profileModels[profile.id] = {};
    period.profileModels[profile.id][model] = (period.profileModels[profile.id][model] || 0) + tokens;
  }
  period.sessions[`codex:${profile.id}:${sessionId}`] = session;
}

function emptyProfilePeriod() {
  return Object.assign(emptyPeriod(), {
    profiles: {}, profileCosts: {}, profileCacheReads: {}, profileCacheWrites: {}, profileOutputs: {}, profileModels: {}, profileModelCosts: {}
  });
}

function attributeCodexToPersonal(period) {
  if (!period || typeof period !== 'object') return period;
  const tokens = num(period.clients?.codex);
  if (tokens <= 0) return period;
  period.profiles = { ...(period.profiles || {}), [PERSONAL_PROFILE.id]: tokens };
  period.profileCosts = { ...(period.profileCosts || {}), [PERSONAL_PROFILE.id]: Number(period.clientCosts?.codex || 0) };
  period.profileCacheReads = { ...(period.profileCacheReads || {}), [PERSONAL_PROFILE.id]: num(period.clientCacheReads?.codex) };
  period.profileCacheWrites = { ...(period.profileCacheWrites || {}), [PERSONAL_PROFILE.id]: num(period.clientCacheWrites?.codex) };
  period.profileOutputs = { ...(period.profileOutputs || {}), [PERSONAL_PROFILE.id]: num(period.clientOutputs?.codex) };
  period.profileModels = { ...(period.profileModels || {}), [PERSONAL_PROFILE.id]: { ...(period.clientModels?.codex || {}) } };
  period.profileModelCosts = { ...(period.profileModelCosts || {}), [PERSONAL_PROFILE.id]: { ...(period.clientModelCosts?.codex || {}) } };
  const nextSessions = {};
  for (const [key, session] of Object.entries(period.sessions || {})) {
    if (session?.client !== 'codex' || session.profileId) { nextSessions[key] = session; continue; }
    const next = { ...session, profileId: PERSONAL_PROFILE.id };
    nextSessions[`codex:${session.sessionId}`] = next;
  }
  period.sessions = nextSessions;
  return period;
}

function periodsFromEntries(entries, profile, now, allTimeSince) {
  const today = localDayKey(now);
  const week = localDayKey(startOfLocalWeek(now));
  const month = today.slice(0, 7);
  const since = String(allTimeSince || '2024-01-01').slice(0, 10);
  const result = { today: emptyProfilePeriod(), week: emptyProfilePeriod(), month: emptyProfilePeriod(), allTime: emptyProfilePeriod() };
  for (const entry of mergeSessionEntries(entries).values()) {
    addEntryToPeriod(result.today, entry, profile, (day) => day === today);
    addEntryToPeriod(result.week, entry, profile, (day) => day >= week && day <= today);
    addEntryToPeriod(result.month, entry, profile, (day) => day.slice(0, 7) === month && day <= today);
    addEntryToPeriod(result.allTime, entry, profile, (day) => day >= since && day <= today);
  }
  return result;
}

function collectCodexUsageProfiles(options = {}) {
  const profiles = normalizeCodexUsageProfiles(options.profiles, options);
  const cache = readCache(options.cachePath);
  const bundle = { today: emptyProfilePeriod(), week: emptyProfilePeriod(), month: emptyProfilePeriod(), allTime: emptyProfilePeriod() };
  // Local-only sidecar consumed by the collector's pricing step. It contains
  // token components only and is never merged into the public period shape.
  const pricingComponents = { today: {}, week: {}, month: {}, allTime: {} };
  const status = [];
  for (const profile of profiles) {
    const fingerprint = rootFingerprint(profile);
    let cached = cache.profiles[profile.id];
    if (!cached || cached.rootFingerprint !== fingerprint) cached = { rootFingerprint: fingerprint, files: {}, discoveryRound: 0 };
    const discoveryRound = num(cached.discoveryRound);
    let listing;
    try {
      listing = listJsonlFiles(profile.root, { ...options, discoveryRound });
    } catch (error) {
      const state = error.code === 'EACCES' || error.code === 'EPERM' ? 'permission-denied' : 'unreadable';
      status.push({ id: profile.id, label: profile.label, state, files: 0, malformedLines: 0, oversizedLines: 0, pendingFiles: 0 });
      cache.profiles[profile.id] = cached;
      continue;
    }
    cached.discoveryRound = discoveryRound >= Number.MAX_SAFE_INTEGER - 1 ? 0 : discoveryRound + 1;
    let malformedLines = 0;
    let oversizedLines = 0;
    let pendingFiles = 0;
    let processedBytes = 0;
    for (const [fileIndex, filePath] of listing.files.entries()) {
      const totalBudget = options.maxBytesPerProfile || MAX_BYTES_PER_PROFILE_PER_SCAN;
      if (processedBytes >= totalBudget) {
        pendingFiles += listing.files.length - fileIndex;
        break;
      }
      try {
        const stat = fs.statSync(filePath);
        const identity = fileIdentity(profile.id, filePath, stat);
        const parsed = parseFileIncrement(filePath, profile.id, cached.files[identity], stat, {
          ...options,
          maxBytesPerFile: Math.min(options.maxBytesPerFile || MAX_BYTES_PER_FILE_PER_SCAN, totalBudget - processedBytes)
        });
        const next = parsed.entry;
        cached.files[identity] = next;
        // Incomplete tails deliberately leave offset at the beginning of the
        // line so the next append can be parsed. Charge the bytes actually read
        // anyway, otherwise many large tails can bypass the per-profile cap.
        processedBytes += parsed.bytesRead;
        try { if (typeof options.onReadBytes === 'function') options.onReadBytes(parsed.bytesRead); } catch (_) {}
        malformedLines += num(next.malformedLines);
        oversizedLines += num(next.oversizedLines);
        if (next.offset < stat.size) pendingFiles += 1;
      } catch (_) {
        // A file can rotate between listing/stat/read. Keep its prior anonymous
        // cache entry and retry on the next normal collector tick.
        pendingFiles += 1;
      }
    }
    cache.profiles[profile.id] = cached;
    const periods = periodsFromEntries(Object.values(cached.files), profile, options.now ? new Date(options.now) : new Date(), options.allTimeSince);
    for (const name of Object.keys(bundle)) {
      for (const [sessionKey, session] of Object.entries(periods[name].sessions || {})) {
        pricingComponents[name][sessionKey] = {
          profileId: session.profileId,
          models: session.modelComponents || {}
        };
      }
      bundle[name] = mergePeriods(bundle[name], periods[name]);
    }
    if (listing.truncated && pendingFiles === 0) pendingFiles = 1;
    const knownFiles = Object.keys(cached.files).length;
    status.push({
      id: profile.id,
      label: profile.label,
      state: knownFiles || listing.files.length ? (pendingFiles ? 'partial' : 'active') : 'empty',
      files: knownFiles,
      malformedLines,
      oversizedLines,
      pendingFiles,
      truncated: listing.truncated || undefined
    });
  }
  writeCache(options.cachePath, cache);
  return { profiles, metadata: publicProfileMetadata(profiles), bundle, pricingComponents, status };
}

module.exports = {
  PERSONAL_PROFILE,
  attributeCodexToPersonal,
  collectCodexUsageProfiles,
  normalizeCodexUsageProfiles,
  normalizeCodexUsageProfileSettings,
  parseProfileSetting,
  profileConfigFingerprint,
  publicProfileMetadata,
  usageComponents
};
