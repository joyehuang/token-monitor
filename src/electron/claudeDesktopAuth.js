'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLAUDE_DESKTOP_AUTH_HELPER_FLAG = '--claude-desktop-auth-helper';
const CLAUDE_DESKTOP_USER_DATA_PREFIX = '--claude-desktop-user-data=';
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

function claudeDesktopUserDataCandidates(env = process.env, deps = {}) {
  const readdirSync = deps.readdirSync || fs.readdirSync;
  const candidates = [];
  if (env.APPDATA) candidates.push(path.join(env.APPDATA, 'Claude'));
  if (env.LOCALAPPDATA) {
    const packagesDir = path.join(env.LOCALAPPDATA, 'Packages');
    let packageNames = [];
    try {
      packageNames = readdirSync(packagesDir).filter((name) => /^Claude_/i.test(name));
    } catch (_) {}
    for (const packageName of packageNames) {
      candidates.push(path.join(packagesDir, packageName, 'LocalCache', 'Roaming', 'Claude'));
    }
  }
  return [...new Set(candidates)];
}

function findClaudeDesktopUserData(env = process.env, deps = {}) {
  const existsSync = deps.existsSync || fs.existsSync;
  return claudeDesktopUserDataCandidates(env, deps).find((candidate) => (
    existsSync(path.join(candidate, 'config.json'))
    && existsSync(path.join(candidate, 'Local State'))
  )) || null;
}

function helperUserDataFromArgs(argv = process.argv) {
  const value = argv.find((arg) => String(arg).startsWith(CLAUDE_DESKTOP_USER_DATA_PREFIX));
  return value ? value.slice(CLAUDE_DESKTOP_USER_DATA_PREFIX.length) : '';
}

function tokenCacheEntries(config, decryptString) {
  const entries = [];
  for (const key of ['oauth:tokenCacheV2', 'oauth:tokenCache']) {
    const encrypted = config?.[key];
    if (!encrypted) continue;
    try {
      const decrypted = decryptString(Buffer.from(encrypted, 'base64'));
      const cache = JSON.parse(decrypted);
      for (const [identity, value] of Object.entries(cache || {})) {
        entries.push({ identity, value, version: key });
      }
    } catch (_) {}
  }
  return entries;
}

function selectClaudeDesktopCredentials(config, decryptString) {
  const entries = tokenCacheEntries(config, decryptString).filter(({ identity, value }) => (
    identity.startsWith(`${CLAUDE_OAUTH_CLIENT_ID}:`) && value?.token
  ));
  const selected = entries.find(({ identity }) => identity.includes('user:sessions:claude_code')) || entries[0];
  if (!selected) return null;
  return {
    accessToken: String(selected.value.token),
    expiresAt: selected.value.expiresAt ?? null,
    subscriptionType: selected.value.subscriptionType ?? '',
    rateLimitTier: selected.value.rateLimitTier ?? '',
    identity: `desktop:${selected.identity}`
  };
}

function readClaudeDesktopCredentialsInHelper(userData, safeStorage, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  if (!userData || !safeStorage?.isEncryptionAvailable()) return null;
  const config = JSON.parse(readFileSync(path.join(userData, 'config.json'), 'utf8'));
  return selectClaudeDesktopCredentials(config, (buffer) => safeStorage.decryptString(buffer));
}

function readClaudeDesktopCredentials({ app, env = process.env, spawnImpl = spawn, timeoutMs = 6000 } = {}) {
  const userData = findClaudeDesktopUserData(env);
  if (!userData || !app) return Promise.resolve(null);
  const args = [
    ...(app.isPackaged ? [] : [app.getAppPath()]),
    CLAUDE_DESKTOP_AUTH_HELPER_FLAG,
    `${CLAUDE_DESKTOP_USER_DATA_PREFIX}${userData}`
  ];
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude Desktop credential helper timed out'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Claude Desktop credential helper exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim() || 'null'));
      } catch (_) {
        reject(new Error('Claude Desktop credential helper returned invalid output'));
      }
    });
  });
}

module.exports = {
  CLAUDE_DESKTOP_AUTH_HELPER_FLAG,
  claudeDesktopUserDataCandidates,
  findClaudeDesktopUserData,
  helperUserDataFromArgs,
  readClaudeDesktopCredentials,
  readClaudeDesktopCredentialsInHelper,
  selectClaudeDesktopCredentials
};
