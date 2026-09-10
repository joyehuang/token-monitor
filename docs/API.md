# API

The hub exposes a small JSON HTTP API.

## Authentication

All endpoints except `/api/health` require the configured shared secret.

Use either:

```http
Authorization: Bearer <secret>
```

or:

```http
X-Token-Monitor-Secret: <secret>
```

## `GET /api/health`

Health check. Does not require authentication.

Example response:

```json
{
  "ok": true,
  "role": "hub",
  "version": 1,
  "deviceCount": 2,
  "secretRequired": true,
  "now": "2026-05-18T00:00:00.000Z"
}
```

## `POST /api/ingest`

Posts one device usage summary.

The Node hub accepts a body up to 4 MB and answers `413 payload_too_large` above
that. `periods.*.sessions` is the only part of the payload that grows without
bound (one entry per conversation, kept forever in `allTime`), so senders cap it
at the 500 most recently used sessions per period. Every total is stored beside
`sessions` rather than derived from it, so the cap never changes a reported
number — only the tail of the session list is omitted.

Example payload:

```json
{
  "deviceId": "macbook",
  "hostname": "macbook.local",
  "platform": "darwin-arm64",
  "updatedAt": "2026-05-18T00:00:00.000Z",
  "agentVersion": "0.3.0",
  "agentRuntime": "headless-agent",
  "trackedClients": ["codex"],
  "usageProfiles": [
    { "id": "codex-personal", "client": "codex", "label": "Personal" },
    { "id": "codex-work", "client": "codex", "label": "Work" }
  ],
  "today": {
    "totalTokens": 1234,
    "costUsd": 0.01,
    "cacheReadTokens": 1100,
    "cacheWriteTokens": 0,
    "outputTokens": 34,
    "clients": {
      "codex": 1234
    },
    "clientCosts": {
      "codex": 0.01
    },
    "clientCacheReads": {
      "codex": 1100
    },
    "clientCacheWrites": {
      "codex": 0
    },
    "clientOutputs": {
      "codex": 34
    },
    "models": {
      "gpt-5": 1234
    },
    "modelCosts": {
      "gpt-5": 0.01
    },
    "modelCacheReads": {
      "gpt-5": 1100
    },
    "modelCacheWrites": {
      "gpt-5": 0
    },
    "modelOutputs": {
      "gpt-5": 34
    },
    "clientModels": {
      "codex": {
        "gpt-5": 1234
      }
    },
    "profiles": { "codex-personal": 700, "codex-work": 534 },
    "profileModels": {
      "codex-personal": { "gpt-5": 700 },
      "codex-work": { "gpt-5": 534 }
    },
    "clientModelCosts": {
      "codex": {
        "gpt-5": 0.01
      }
    },
    "sessions": {
      "codex:rollout-2026-05-30T11-44-50-abc": {
        "client": "codex",
        "sessionId": "rollout-2026-05-30T11-44-50-abc",
        "totalTokens": 1234,
        "costUsd": 0.01,
        "messageCount": 3,
        "inputTokens": 100,
        "outputTokens": 34,
        "cacheReadTokens": 1100,
        "cacheWriteTokens": 0,
        "reasoningTokens": 0,
        "startedAt": "2026-05-30T03:44:50.000Z",
        "lastUsedAt": "2026-05-30T04:07:32.679Z",
        "models": {
          "gpt-5": 1234
        },
        "modelCosts": {
          "gpt-5": 0.01
        },
        "providers": {
          "openai": 1234
        }
      }
    }
  },
  "week": {
    "totalTokens": 3456,
    "costUsd": 0.03,
    "clients": {},
    "clientCosts": {}
  },
  "month": {
    "totalTokens": 4567,
    "costUsd": 0.04,
    "clients": {},
    "clientCosts": {}
  },
  "allTime": {
    "totalTokens": 8901,
    "costUsd": 0.08,
    "clients": {},
    "clientCosts": {}
  },
  "periodWindows": {
    "today": { "key": "2026-05-18", "endsAt": "2026-05-19T00:00:00.000Z" },
    "week": { "key": "2026-05-18", "endsAt": "2026-05-25T00:00:00.000Z" },
    "month": { "key": "2026-05", "endsAt": "2026-06-01T00:00:00.000Z" }
  },
  "limits": {
    "updatedAt": "2026-05-18T00:00:00.000Z",
    "refreshMs": 300000,
    "providers": [
      {
        "provider": "claude",
        "accountKey": "sha256:...",
        "status": "ok",
        "updatedAt": "2026-05-18T00:00:00.000Z",
        "windows": [
          {
            "kind": "session",
            "usedPercent": 42,
            "remainingPercent": 58,
            "resetsAt": "2026-05-18T05:00:00.000Z"
          },
          {
            "kind": "weekly",
            "usedPercent": 20,
            "remainingPercent": 80,
            "resetsAt": "2026-05-25T00:00:00.000Z"
          }
        ]
      }
    ]
  }
}
```

The hub normalizes records before storing them.

`trackedClients` is optional but recommended for agents and widgets. When it is present, the hub treats omitted clients as intentionally not collected in this payload and preserves their previous usage for that device. This keeps "tracking" as "collect future data" rather than "hide existing history".

`usageProfiles` is optional public metadata (`id`, `client`, and display `label` only). Periods may include `profiles`, `profileCosts`, `profileCacheReads`, `profileCacheWrites`, `profileOutputs`, `profileModels`, and `profileModelCosts`. Additional-profile sessions are keyed by `client:profileId:sessionId`, carry `profileId`, and replace the source session id with a stable profile-scoped hash at the parse boundary; the default `codex-personal` source deliberately keeps the legacy `client:sessionId` key for compatibility. Source paths are configuration-only and must never appear in this wire shape. Additional Codex profiles set `detailAvailable: false`, so transcript detail cannot cross from a work log source into the existing personal-session detail flow.

`week` is the device-local calendar week starting Monday (ISO-8601) and is required for current fork agents/widgets. For compatibility with upstream clients that send only `today`/`month`/`allTime`, the hub reconstructs an omitted `week` from full daily `history` plus the live `today` period. Until history is available, it uses `today` as the truthful lower bound and applies later same-day deltas, so an omitted field can never make Week smaller than Today. An explicitly supplied `week` always remains authoritative.

`periodWindows` is optional. Agents and widgets stamp each snapshot with the UTC instant its `today`/`week`/`month` windows end, computed in the device's own local time (`endsAt` = next local midnight for `today`, next local Monday for `week`, next local month start for `month`). `key` is the device-local reference for the window: the day for `today`, the week's own Monday (`YYYY-MM-DD`) for `week`, the month for `month` — all three are calendar windows. The hub uses it to expire a device's `today`/`week`/`month` from the aggregate once `now >= endsAt`, so a device that goes offline before re-posting does not keep contributing a stale day/week/month snapshot (`allTime` never expires). Payloads without `periodWindows` fall back to a UTC day/week/month comparison against `updatedAt`.

`limits` is optional. Agents and widgets include it when AI Tool Limits detection is enabled. Raw OAuth credentials, access tokens, refresh tokens, and provider response bodies must never be sent.

`limits.providers[].provider` is one of `claude`, `codex`, `cursor`, `antigravity`, `opencode`, or `deepseek`.
`limits.providers[].accountKey` is a stable hashed account identifier (`sha256:…`) used to dedupe the same account across devices. `limits.providers[].accountEmail` and `limits.providers[].accountLabel` (plan, e.g. `Plus`) MAY be sent to the authenticated hub so devices can show which account each limit belongs to — this is why Codex can report multiple accounts. The hub ingest is protected by the shared `secret`; the **public** stats endpoints (`publicLimits`) strip `accountKey`, `accountEmail`, and `accountLabel` so no account identifiers are ever exposed publicly.
`limits.providers[].source` is one of `oauth`, `cli`, `web`, `rpc`, `local`, or `api`; `local` means the value was read from an on-disk store such as OpenCode Go usage from `opencode.db`, and `api` means a provider HTTP API authenticated by an API key (DeepSeek).
`limits.providers[].balanceUsd` is an optional prepaid credit balance in USD (OpenCode Zen); `null` when the provider has no balance concept or none could be read. A genuine `0` (no remaining credit) is distinct from `null`.
`limits.providers[].balance` is an optional native-currency prepaid balance block `{ amount, currency, todaySpend, monthSpend, monthSinceTracking }` used by pay-as-you-go providers (DeepSeek). `amount` is the spendable balance in the account's own currency (e.g. `CNY`/`USD`); `todaySpend`/`monthSpend` are derived from balance history (paid drawdown only); `monthSinceTracking` is `true` until a full month of history has accrued. `null` when not applicable. DeepSeek uses `source: "api"` with an empty `windows` array (it has no rate-limit windows).
`windows[].kind` is `session`, `weekly`, or `billing`.

## `GET /api/stats`

Returns aggregate stats for the widget.

Response includes:

- `periods.today`
- `periods.week`
- `periods.month`
- `periods.allTime`
- `periods.*.clientModels` and `periods.*.clientModelCosts` for preserving model breakdowns when a tracked tool is disabled
- `periods.*.sessions` keyed by `client:sessionId` or `client:profileId:sessionId` for session-level usage; widgets may use `lastUsedAt` for recent-first sorting when present
- `historyPreview.daily[].activeTimeMs`, `historyPreview.monthly[].activeTimeMs`, and `historyPreview.summary.activeTimeMs` when tokscale graph exposes session active-time metrics
- `limits.providers` aggregated by provider account
- `devices`
- stale status for devices that have not reported recently

If multiple devices report the same provider account, the hub keeps the freshest valid limits status for that account. Public Worker stats omit account identifiers.

## `GET /api/devices`

Returns normalized records for all stored devices.

## `DELETE /api/devices/:id`

Deletes one device record from the hub store.

This is useful after renaming a device id.

### Pi provider sources and Codex usage roots

Pi model keys for the recorded providers `openai-codex` and
`openai-codex-agent` include a source suffix, for example
`gpt-6-astra [openai-codex-agent]`. These labels describe session-recorded
providers, not authenticated account identities. Costs still come from
Tokscale's original pricing result. Other clients keep their model keys.

Tokscale cannot group by both session and provider. The collector therefore
runs a serial Pi provider report alongside the session report. Pi numeric
contributions come exclusively from the provider report; the original Pi
sessions remain detail metadata. A session that switched provider may have
mixed provider metadata; its per-provider token split is not inferred.
The daily history graph remains a model-level historical view and does not
claim account/provider separation. All four current period model summaries
retain source separation through both hub implementations.

Usage subprocesses ignore inherited `CODEX_HOME`, keeping the default Codex
source aligned with its default directory and watcher. Use the existing local
`codexUsageProfiles` setting or `TOKEN_MONITOR_CODEX_USAGE_PROFILES` for an
additional Codex home. Profiles identify configured session sources, not
verified accounts. Configure each source once; do not copy sessions between
independently named profiles. These settings do not configure subscription
5-hour/weekly limits, authentication, login, or token refresh.

### Unified account usage and read-only quota (fork)

`usageProfiles[]` may include `accountKey` (only `sha256:<64 hex>`) and a safe
`accountName`. These are explicit local source bindings, not guesses from model
names. Period `profiles` / `profileCosts` also include `pi-openai-codex` and
`pi-openai-codex-agent`; they are subdivisions of Pi totals, never extra usage.
Codex CLI and Pi requests are additive. A repeated configured directory is read
once. Copied logs on separate devices are not automatically deduplicated.
Unknown bindings and WSL homes remain unlinked. Device `periodWindows` accompanies
aggregate device rows so expired calendar token windows are not shown as current.

The private widget setting `codexAccountSources` is an array of
`{id, label, path, profileIds, accountKey?}`. `path` is an explicitly selected
Codex home; `profileIds` binds existing usage sources to that account. The optional
opaque `accountKey` pins the identity and retains a safe association if auth later
expires or disappears; a changed identity is rejected. Conflicting bindings stay
unknown. Never put credentials in this setting. The existing usage-profile rows
have a **Link read-only quota** action, including the default Personal source.
Unlinking revokes that source; removing its usage profile also removes its quota source. The GUI retains `codexReadonlyMode: true` after unlinking the last source, so automatic live RPC does not silently resume.
Extra directory selection still uses the existing usage folder picker. Labels
are local configuration, not emails. Pi bindings require explicit local mapping
based on verified provider identity; a model name is never evidence.

When read-only sources are configured, they replace automatic live Codex RPC
probing; existing managed accounts remain separate unless the same source/key is
already configured. Include Personal explicitly to keep its quota visible.
Read-only sources use existing access tokens with GET to the official usage
endpoint and the existing five-minute quota cache. They never invoke login, RPC,
refresh, token writes, or external profile endpoint configuration. POSIX checks
require current-user ownership, a private auth file and a non-writable-by-others
source directory; symlink auth files are rejected. Windows checks file readability
and regular-file identity, not NTFS ACLs. Missing/expired/401/error samples have
empty windows and accurate status; there is no fallback to another login.

Quota providers use `sourceDetail: "readonly"`, `accountName`, an opaque account
key and no email. Same-key samples across devices are selected by latest check,
never summed. A latest failed check remains failed instead of presenting an older
success as live. Account rows show separate token and quota sampling times and
source devices. Calendar token week starts Monday; quota 5h/weekly reset times
come from the provider. USD estimates are not subscription spending.
