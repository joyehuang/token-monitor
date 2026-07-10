'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  claudeDesktopUserDataCandidates,
  findClaudeDesktopUserData,
  helperUserDataFromArgs,
  selectClaudeDesktopCredentials
} = require('../../src/electron/claudeDesktopAuth');

test('Claude Desktop candidates include classic and MSIX user data', () => {
  const candidates = claudeDesktopUserDataCandidates({
    APPDATA: 'C:\\Users\\Joye\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\Joye\\AppData\\Local'
  }, {
    readdirSync: () => ['Other_app', 'Claude_publisher-id']
  });

  assert.deepEqual(candidates, [
    path.join('C:\\Users\\Joye\\AppData\\Roaming', 'Claude'),
    path.join('C:\\Users\\Joye\\AppData\\Local', 'Packages', 'Claude_publisher-id', 'LocalCache', 'Roaming', 'Claude')
  ]);
});

test('findClaudeDesktopUserData requires config and Local State', () => {
  const env = { LOCALAPPDATA: 'C:\\Local' };
  const expected = path.join('C:\\Local', 'Packages', 'Claude_pkg', 'LocalCache', 'Roaming', 'Claude');
  const found = findClaudeDesktopUserData(env, {
    readdirSync: () => ['Claude_pkg'],
    existsSync: (value) => value === path.join(expected, 'config.json') || value === path.join(expected, 'Local State')
  });
  assert.equal(found, expected);
});

test('selectClaudeDesktopCredentials prefers the Code-scoped V2 token', () => {
  const legacyIdentity = '9d1c250a-e61b-44d9-88ed-5944d1962f5e:org:https://api.anthropic.com:user:inference user:profile';
  const codeIdentity = `${legacyIdentity} user:sessions:claude_code`;
  const config = {
    'oauth:tokenCache': Buffer.from('legacy').toString('base64'),
    'oauth:tokenCacheV2': Buffer.from('v2').toString('base64')
  };
  const credentials = selectClaudeDesktopCredentials(config, (buffer) => JSON.stringify(
    buffer.toString() === 'v2'
      ? { [codeIdentity]: { token: 'desktop-token', refreshToken: 'unused', expiresAt: 123, subscriptionType: 'max', rateLimitTier: 'max_5x' } }
      : { [legacyIdentity]: { token: 'legacy-token' } }
  ));

  assert.deepEqual(credentials, {
    accessToken: 'desktop-token',
    expiresAt: 123,
    subscriptionType: 'max',
    rateLimitTier: 'max_5x',
    identity: `desktop:${codeIdentity}`
  });
  assert.equal(Object.hasOwn(credentials, 'refreshToken'), false);
});

test('helperUserDataFromArgs reads the dedicated helper argument', () => {
  assert.equal(
    helperUserDataFromArgs(['token-monitor', '--claude-desktop-user-data=C:\\Claude Data']),
    'C:\\Claude Data'
  );
});
