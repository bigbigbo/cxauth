# cxauth Design

## Summary

`cxauth` is a local CLI for managing multiple ChatGPT-backed Codex accounts on one machine. It provides three core behaviors:

1. Add and store multiple ChatGPT login snapshots for Codex.
2. Switch the globally active Codex account by atomically replacing `~/.codex/auth.json`.
3. Query each account's quota state on a best-effort basis through Codex's ChatGPT backend usage endpoint.

The first version supports only ChatGPT login accounts. API key accounts are explicitly out of scope.

## Goals

- Make Codex account switching global, so plain `codex` and existing workflows pick up the selected account immediately.
- Replace manual `auth.json` copying with a repeatable CLI workflow.
- Support account creation through `codex login --device-auth` instead of manual snapshot handling.
- Show each saved account's latest known quota state with clear freshness and health metadata.

## Non-Goals

- Support API key login accounts.
- Depend on reverse-engineering private ChatGPT web pages as the primary quota source.
- Change Codex's own login protocol.
- Provide always-accurate quota numbers when Codex does not expose them cleanly.

## Constraints and Assumptions

- The machine already has a working `codex` CLI installed.
- The active global Codex credentials are read from `~/.codex/auth.json` when file storage is used.
- ChatGPT login via `codex login --device-auth` produces credentials equivalent in usability to normal browser login.
- Codex exposes account rate limits through its ChatGPT backend usage endpoint, which is also rendered by the TUI `/status` surface.
- Quota extraction is best-effort. If parsing fails, account switching must still work.

## User Experience

### Commands

- `cxauth add <name>`
  - Create a new ChatGPT-backed Codex account snapshot using device auth.
- `cxauth list`
  - List all saved accounts, the active account, and the latest known quota state.
- `cxauth switch <name>`
  - Make the selected account globally active by replacing `~/.codex/auth.json`.
- `cxauth status [name]`
  - Refresh quota information for one account or all accounts.
- `cxauth current`
  - Show the globally active account.
- `cxauth remove <name>`
  - Remove a saved account that is not currently active.

### Display Shape

`cxauth list` should prioritize quick switching decisions. The table includes:

- `name`
- `email`
- `plan`
- `active`
- `weekly`
- `5h`
- `last_checked`
- `health`

Example:

```text
NAME      EMAIL                PLAN  ACTIVE  WEEKLY_LEFT  5H_LEFT  LAST_CHECKED        HEALTH
main      a@example.com        plus  *       62%      15%      2026-04-20 14:32   ok
backup-1  b@example.com        plus          100%     unknown  2026-04-20 14:28   ok
backup-2  c@example.com        plus          unknown  unknown  never               not_checked
```

## Architecture

The tool is a standalone local CLI with four responsibilities:

1. Manage saved account snapshots under its own private storage root.
2. Safely read and replace the globally active Codex auth file.
3. Launch isolated Codex login and status probe flows without polluting the current global session.
4. Maintain a registry that tracks account metadata, probe results, and the currently selected account.

The design intentionally separates:

- `saved account state`, owned by `cxauth`
- `global active auth state`, owned by Codex but rewritten by `cxauth`
- `quota probe state`, which is disposable and isolated

This keeps switching reliable even if quota parsing breaks.

## Storage Layout

The tool stores all of its own state under `~/.cxauth/`.

```text
~/.cxauth/
  registry.json
  backups/
    auth.json.bak
  accounts/
    <name>/
      auth.json
```

### `registry.json`

Top-level fields:

- `version`
- `activeAccount`
- `accounts`

Each account entry contains:

- `name`
- `email`
- `chatgptAccountId`
- `planType`
- `authPath`
- `createdAt`
- `updatedAt`
- `lastUsedAt`
- `status`
- `notes`

Each `status` object contains:

- `weeklyLimit`
- `fiveHourLimit`
- `checkedAt`
- `source`
- `rawSnippet`
- `state`

Each limit value is stored as a structured object:

- `display`
- `unit`
- `value`
- `raw`

Example:

```json
{
  "display": "62%",
  "unit": "percent",
  "value": 62,
  "raw": "weekly 62%"
}
```

`state` is one of:

- `ok`
- `not_checked`
- `auth_expired`
- `parse_failed`
- `timeout`

## Account Creation Flow

`cxauth add <name>` uses device auth by default.

### Steps

1. Validate that `<name>` is not already present.
2. Create a temporary Codex home directory under `~/.cxauth/tmp/...`.
3. Write minimal config into that temporary home to force CLI auth storage to file, not keyring.
4. Run `codex login --device-auth` with `CODEX_HOME` set to the temporary home.
5. Wait for successful login completion.
6. Read the temporary `auth.json`.
7. Extract metadata from the stored tokens, including email, account id, and plan type when available.
8. Persist the file as `~/.cxauth/accounts/<name>/auth.json`.
9. Insert the metadata into `registry.json`.
10. Optionally run one initial quota probe and persist the result.

### Failure Handling

- If device auth is cancelled or times out, the command exits without creating an account entry.
- If `auth.json` is missing after login completes, the command fails and preserves enough diagnostic output for debugging.
- If extracted email already belongs to another saved account, the command warns and refuses to overwrite by default.
- Temporary directories are cleaned after success and best-effort cleaned after failure.

## Global Switch Flow

`cxauth switch <name>` is intentionally simple and explicit.

### Steps

1. Resolve the target account entry from `registry.json`.
2. Validate that `~/.cxauth/accounts/<name>/auth.json` exists and is readable JSON.
3. Backup the current `~/.codex/auth.json` to `~/.cxauth/backups/auth.json.bak` if it exists.
4. Replace `~/.codex/auth.json` using atomic write semantics.
5. Update `registry.json.activeAccount`.
6. Update the target account's `lastUsedAt`.
7. Run a lightweight validation step such as `codex login status`.

### Failure Handling

- If the target snapshot is unreadable or malformed, refuse to switch.
- If the atomic write fails, restore the previous file from backup.
- If post-switch validation fails, mark the switch as unverified and keep the backup for manual rollback.

## Quota Probe Flow

Quota probing must not silently change the user's global active account.

### Source of Truth

The first version uses Codex's ChatGPT backend usage endpoint, which is the source used by openai/codex's rate-limit client for ChatGPT auth:

```text
GET https://chatgpt.com/backend-api/wham/usage
```

This is preferred over scraping `chatgpt.com/codex/cloud/settings/analytics` because it follows the CLI's own product path and relies on the same authenticated rate-limit state that powers the TUI status line.

### Steps

1. Read the target account's saved `auth.json`.
2. Extract `tokens.access_token`.
3. Extract `tokens.account_id`, falling back to JWT metadata when needed.
4. Send the token as `Authorization: Bearer <token>`.
5. Send the account id as `ChatGPT-Account-Id: <account-id>`.
6. Parse the default `rate_limit` payload.
7. Persist normalized values into `registry.json.accounts[<name>].status`.
8. Record `checkedAt`, `source = "chatgpt-usage"`, and a raw response snippet.

### Parsing Rules

- Map `rate_limit.primary_window.used_percent` to remaining `5h` quota with `100 - used_percent`.
- Map `rate_limit.secondary_window.used_percent` to remaining `weekly` quota with `100 - used_percent`.
- If only one window is found, keep the other as `unknown`.
- If parsing fails, set `state = "parse_failed"` and preserve the snippet.
- If the request is unauthorized, set `state = "auth_expired"`.

### Failure Handling

- If startup or response capture times out, set `state = "timeout"`.
- If auth is expired or Codex cannot read rate limits, set `state = "auth_expired"`.
- Probe failure never mutates the global active account and never blocks switching.

## Current Account Detection

`cxauth current` and `cxauth list` need to identify the globally active account even if `registry.json.activeAccount` is stale.

Matching strategy:

1. Read `~/.codex/auth.json`.
2. Extract stable identifiers such as `chatgpt_account_id` or email from token metadata.
3. Compare against saved account metadata.
4. If matched, prefer the resolved account identity and reconcile `registry.json.activeAccount`.
5. If unmatched, report that the active global auth is unmanaged.

## Data Integrity and Concurrency

- Writes to `registry.json` must be atomic.
- Writes to `~/.codex/auth.json` must use write-to-temp plus rename semantics.
- Commands that mutate global state should use a simple lock file under `~/.cxauth/` to avoid concurrent switch or add operations.
- Read-only commands may proceed without holding the mutation lock.

## Security Considerations

- `auth.json` contains sensitive tokens and must be stored with restrictive file permissions.
- `cxauth` should avoid echoing token-bearing content in logs or terminal output.
- Backups must be treated as sensitive files and stored with the same permissions as the main auth file.
- The first version keeps local plaintext auth snapshots because that matches the user's current manual workflow and is necessary for global file replacement.

## Implementation Boundaries

The codebase should separate these concerns into distinct units:

- CLI argument parsing and command dispatch
- Registry read/write
- Auth snapshot management
- Global auth switching
- Codex login runner
- Usage API probe and response parser

The parser for quota payloads should be standalone and heavily unit-tested because it is the most format-sensitive part of the design.

## Testing Strategy

### Unit Tests

- Registry serialization and upgrade-safe reading
- Active account resolution
- Atomic switch logic
- Usage API parser behavior across known payload variants
- Failure state mapping

### Filesystem Integration Tests

- Add account metadata into temporary `.cxauth` storage
- Switch account with backup and rollback
- Detect unmanaged global auth
- Remove account refusal when account is active

### Manual Acceptance Tests

1. Add a new account via `codex login --device-auth`.
2. Confirm the account appears in `cxauth list`.
3. Switch to that account.
4. Run plain `codex login status` and confirm the selected ChatGPT login is active.
5. Run `cxauth status <name>` and confirm `weekly` is populated when the usage API returns a secondary window.
6. Corrupt a saved snapshot and verify `cxauth switch` fails safely without damaging the active global file.

## Future Extensions

The design leaves room for later additions without reshaping the first version:

- Support API key accounts as a separate auth mode.
- Add a second quota source if the usage API becomes insufficient.
- Add `cxauth refresh <name>` to re-run device auth for an existing account.
- Add shell integration to expose the active account in the prompt.

## Final Recommendation

Build the first version around direct `auth.json` snapshot management with device-auth-based account creation and direct ChatGPT backend usage probing. This matches the user's required global-switch behavior, removes the current manual snapshot workflow, and keeps quota lookup best-effort instead of making the entire tool depend on reverse-engineering a private web page.
