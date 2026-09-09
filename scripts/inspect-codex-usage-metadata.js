#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { parseArgs } = require('../src/shared/config');
const { collectCodexUsageProfiles } = require('../src/shared/codexUsageProfiles');

function anonymousSessionId(value) {
  if (String(value || '').startsWith('sha256:')) return String(value);
  return `sha256:${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)}`;
}

function safePeriod(period) {
  return {
    totalTokens: period?.totalTokens || 0,
    cacheReadTokens: period?.cacheReadTokens || 0,
    cacheWriteTokens: period?.cacheWriteTokens || 0,
    outputTokens: period?.outputTokens || 0,
    profiles: period?.profiles || {},
    models: period?.models || {},
    sessions: Object.values(period?.sessions || {}).map((session) => ({
      profileId: session.profileId || '',
      session: anonymousSessionId(session.sessionId),
      totalTokens: session.totalTokens || 0,
      cacheReadTokens: session.cacheReadTokens || 0,
      outputTokens: session.outputTokens || 0,
      startedAt: session.startedAt || '',
      lastUsedAt: session.lastUsedAt || '',
      models: session.models || {}
    }))
  };
}

const args = parseArgs(process.argv.slice(2));
const profileHome = String(args.profileHome || args['profile-home'] || '');
if (!profileHome) {
  console.error('Usage: node scripts/inspect-codex-usage-metadata.js --profile-home /path/to/codex-home [--label Work]');
  process.exitCode = 2;
} else {
  try {
    const result = collectCodexUsageProfiles({
      profiles: [{ id: args.id || 'codex-work', label: args.label || 'Work', path: profileHome }],
      cachePath: null,
      allTimeSince: args.since || '2024-01-01'
    });
    console.log(JSON.stringify({
      profiles: result.metadata.filter((profile) => profile.id !== 'codex-personal'),
      status: result.status,
      periods: {
        today: safePeriod(result.bundle.today),
        week: safePeriod(result.bundle.week),
        month: safePeriod(result.bundle.month),
        allTime: safePeriod(result.bundle.allTime)
      }
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'error', code: error.code || error.name || 'error' }));
    process.exitCode = 1;
  }
}
