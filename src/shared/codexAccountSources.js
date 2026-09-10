'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { decodeJwtPayload, hashAccountKey } = require('./codexAuth');

// Private local configuration. Only labels and opaque identity keys leave here.
function normalizeAccountSources(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || item.enabled === false || !path.isAbsolute(String(item.path || ''))) return [];
    const id = String(item.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 48);
    const label = String(item.label || 'Account').replace(/[^a-z0-9 ._-]/gi, '').slice(0, 32);
    let root;
    try { root = fs.realpathSync(item.path); } catch (_) { root = path.resolve(item.path); }
    if (!id || seen.has(root)) return [];
    seen.add(root);
    return [{ id, label, path: root, profileIds: [...new Set((Array.isArray(item.profileIds) ? item.profileIds : []).filter((id) => /^(codex|pi)-[a-z0-9_-]+$/.test(id)))], accountKey: /^sha256:[a-f0-9]{64}$/.test(item.accountKey || '') ? item.accountKey : '' }];
  });
}

function readAccountCredential(source, deps = {}) {
  const io = deps.fs || fs;
  const authPath = path.join(source.path, 'auth.json');
  const fail = (status, reason = '') => { const error = new Error(status); error.status = status; error.reason = reason; throw error; };
  let fd;
  try {
    // No symlink following; validate the opened inode as well as its directory.
    const root = io.lstatSync(source.path);
    const stat = io.lstatSync(authPath);
    if (!root.isDirectory() || root.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink()) fail('notConfigured');
    const platform = deps.platform || process.platform;
    const validate = (s, directory = false) => {
      if (platform === 'win32') return; // File readability only; no NTFS ACL claim.
      const uid = deps.uid ?? process.getuid();
      if (s.uid !== uid || (s.mode & (directory ? 0o022 : 0o077))) fail('notConfigured');
    };
    validate(root, true); validate(stat);
    fd = io.openSync(authPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = io.fstatSync(fd);
    validate(opened);
    if (!opened.isFile() || opened.size > 1024 * 1024 || opened.ino !== stat.ino) fail('notConfigured');
    const auth = JSON.parse(io.readFileSync(fd, 'utf8'));
    const accessToken = String(auth?.tokens?.access_token || auth?.access_token || '');
    const payload = decodeJwtPayload(accessToken);
    const identity = payload['https://api.openai.com/auth'] || {};
    const accountId = String(auth?.tokens?.account_id || auth?.account_id || identity.chatgpt_account_id || '');
    if (!accountId || !accessToken) fail('notConfigured');
    if (identity.chatgpt_account_id && identity.chatgpt_account_id !== accountId) fail('unauthorized', 'identityMismatch');
    const accountKey = hashAccountKey(accountId);
    if (source.accountKey && source.accountKey !== accountKey) fail('unauthorized', 'identityMismatch');
    return { accessToken, accountId, accountKey, expired: Number.isFinite(payload.exp) && payload.exp * 1000 <= (deps.now || Date.now)() };
  } catch (error) {
    if (error.status) throw error;
    fail('notConfigured');
  } finally {
    if (fd !== undefined) io.closeSync(fd);
  }
}

function bindUsageProfiles(profiles, sources, deps = {}) {
  const bindings = new Map();
  for (const source of normalizeAccountSources(sources)) {
    let key = source.accountKey;
    try { key = readAccountCredential(source, deps).accountKey; } catch (error) {
      if (error.reason === 'identityMismatch') key = '';
    }
    if (!key) continue;
    for (const id of source.profileIds) {
      const prior = bindings.get(id);
      bindings.set(id, prior && (prior.conflict || prior.key !== key) ? { key: '', label: '', conflict: true } : { key, label: source.label });
    }
  }
  return profiles.map((profile) => {
    const binding = bindings.get(profile.id);
    return binding?.key ? { ...profile, accountKey: binding.key, accountName: binding.label } : profile;
  });
}

module.exports = { normalizeAccountSources, readAccountCredential, bindUsageProfiles };
