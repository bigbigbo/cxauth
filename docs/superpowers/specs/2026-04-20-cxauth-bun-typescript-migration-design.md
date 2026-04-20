# cxauth Bun + TypeScript Migration Design

## Summary

`cxauth` will be migrated from the current Python implementation to a Bun + TypeScript CLI. The product behavior remains the same:

1. Manage multiple ChatGPT-backed Codex `auth.json` snapshots.
2. Globally switch Codex accounts by atomically replacing `~/.codex/auth.json`.
3. Refresh quota state by calling Codex's ChatGPT backend usage endpoint with the saved account token.

The existing Python code stays available in git history as a reference implementation, but the working implementation will be replaced by Bun + TypeScript.

## Goals

- Use Bun as the runtime, package manager, test runner, and local CLI runner.
- Use TypeScript for all application code and tests.
- Keep the existing `~/.cxauth/` storage format compatible so previously saved accounts do not need migration.
- Preserve the existing CLI commands and user-facing behavior.
- Remove the Python package, Python tests, and Python install flow from the active codebase.
- Keep the quota probe dependency footprint small by using built-in `fetch` instead of native PTY packages.

## Non-Goals

- Change the account registry schema.
- Change the `~/.codex/auth.json` switching strategy.
- Add API key account support.
- Add reverse-engineering of ChatGPT web analytics as a primary quota source.
- Maintain Python and TypeScript implementations in parallel.
- Reimplement Codex's full app-server rate-limit protocol. The first implementation reads the default `codex` usage payload only.

## Constraints and Assumptions

- The machine has Bun available. Current local version checked during design: `1.3.7`.
- The machine has a working `codex` CLI available.
- The user wants Bun + TypeScript as the active implementation, not Python.
- The quota probe uses the default ChatGPT backend URL `https://chatgpt.com/backend-api/wham/usage`, matching openai/codex's backend-client path for ChatGPT auth.
- Saved auth snapshots contain sensitive tokens and must remain private.
- Quota probing is still best-effort. Switching must work even when quota parsing fails.

## User Experience

The command surface remains:

- `cxauth add <name>`
- `cxauth list`
- `cxauth switch <name>`
- `cxauth status [name]`
- `cxauth current`
- `cxauth remove <name>`

Development commands become:

```bash
bun install
bun test
bun run src/cli.ts --version
```

Local global registration uses Bun package linking:

```bash
bun link --global
cxauth --version
```

If the previously installed Python editable package still owns `cxauth`, the migration verification must detect that with `which cxauth` and remove or override the Python entrypoint before claiming global install success.

## Architecture

The Bun implementation uses small TypeScript modules with the same behavioral boundaries as the Python version:

- `src/cli.ts`
  - CLI argument parsing, output formatting, process exit codes.
- `src/paths.ts`
  - Resolve `CXAUTH_HOME`, `CODEX_HOME`, `~/.cxauth`, and `~/.codex`.
- `src/registry.ts`
  - Registry load/save, atomic JSON writes, private file permissions, mutation lock.
- `src/auth.ts`
  - Auth snapshot validation, JWT payload decoding, token-safe metadata extraction.
- `src/commands.ts`
  - Application commands for add, list, switch, current, status, remove.
- `src/codex.ts`
  - Codex subprocess integration, device login, login validation, quota probing, output parsing.

The package root will contain:

- `package.json`
- `tsconfig.json`
- `bun.lock`
- `README.md`
- `src/**/*.ts`
- `tests/**/*.test.ts`

The Python package files will be removed from the active tree:

- `pyproject.toml`
- `src/cxauth/**/*.py`
- `tests/*.py`

## Storage Compatibility

The migration keeps the existing storage layout:

```text
~/.cxauth/
  registry.json
  backups/
    auth.json.bak
  accounts/
    <name>/
      auth.json
```

The TypeScript implementation will read and write the same `registry.json` shape:

- `version`
- `activeAccount`
- `accounts`

Each account entry keeps:

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

Each status entry keeps:

- `weeklyLimit`
- `fiveHourLimit`
- `checkedAt`
- `source`
- `rawSnippet`
- `state`

No migration command is needed for the current registry format.

## Codex Integration

### Device Login

`cxauth add <name>` runs:

```bash
CODEX_HOME=<isolated-temp-home> codex login --device-auth
```

The TypeScript implementation will:

1. Create a temporary private Codex home under `~/.cxauth/tmp/`.
2. Write minimal temporary Codex config if needed.
3. Spawn `codex login --device-auth` with inherited stdio so the user can complete login.
4. Read `<temp-home>/auth.json`.
5. Validate it is a ChatGPT auth snapshot.
6. Extract metadata from JWT payloads without printing tokens.
7. Save the snapshot under `~/.cxauth/accounts/<name>/auth.json`.

### Switch Validation

`cxauth switch <name>` still validates with:

```bash
codex login status
```

Validation failure marks the switch as unverified but does not erase the new global auth. The previous auth backup remains available at `~/.cxauth/backups/auth.json.bak`.

### Quota Probe

The Bun implementation calls the same ChatGPT backend usage endpoint that openai/codex uses for account rate limits:

```bash
GET https://chatgpt.com/backend-api/wham/usage
```

The TypeScript code will:

1. Read the target account's saved `auth.json`.
2. Extract `tokens.access_token`.
3. Extract `tokens.account_id`, falling back to JWT metadata when needed.
4. Send `Authorization: Bearer <token>` and `ChatGPT-Account-Id: <account-id>`.
5. Parse `rate_limit.primary_window.used_percent` into remaining `fiveHourLimit` with `100 - used_percent`.
6. Parse `rate_limit.secondary_window.used_percent` into remaining `weeklyLimit` with `100 - used_percent`.
7. Persist normalized quota state to the registry with `source = "chatgpt-usage"`.

If the request is unauthorized, status becomes `auth_expired`. If the request times out or the response shape is not parseable, status becomes `timeout` or `parse_failed`. This must not affect account switching.

## Data Integrity and Security

- `~/.cxauth/` directories use `0700`.
- `registry.json`, account snapshots, and backups use `0600`.
- Writes to registry and global auth use write-to-temp plus rename.
- Mutating commands use a lock file under `~/.cxauth/`.
- CLI output must never include token strings.
- Raw quota snippets are capped and sanitized before storing in `registry.json`.

## Testing Strategy

Use Bun's test runner:

```bash
bun test
```

Tests cover:

- Path resolution with temporary `CXAUTH_HOME` and `CODEX_HOME`.
- Registry round trips, permissions, atomic write behavior, and lock behavior.
- Auth snapshot validation and JWT metadata extraction.
- Command behavior for add, duplicate rejection, switch, current detection, list, remove, and status refresh.
- Codex login integration through fake executable scripts rather than real Codex.
- Usage API parser behavior for primary and secondary windows, parse failures, unauthorized responses, and timeouts.
- CLI output and exit codes.

Manual verification covers:

```bash
bun test
bun run src/cli.ts --version
bun link --global
cxauth --version
CXAUTH_HOME="$(mktemp -d)" CODEX_HOME="$(mktemp -d)" cxauth list
```

Real account verification is manual and explicit:

```bash
cxauth add main
cxauth switch main
cxauth status main
```

These real commands may launch Codex login, replace the user's global Codex auth, or consume quota probe time, so they must not be run silently as part of automated tests.

## Migration Plan at a High Level

1. Replace Python package metadata with Bun package metadata.
2. Recreate the module boundaries in TypeScript.
3. Port tests from `unittest` to `bun:test`.
4. Remove Python source and tests from the active tree.
5. Update README and install instructions.
6. Run Bun tests and CLI smoke checks.
7. Resolve any stale Python `cxauth` global entrypoint before final global verification.

## References

- Bun package executable docs: `https://github.com/oven-sh/bun/blob/main/docs/pm/bunx.mdx`
- Bun child process docs: `https://github.com/oven-sh/bun/blob/main/docs/runtime/child-process.mdx`
- Bun link docs: `https://github.com/oven-sh/bun/blob/main/docs/pm/cli/link.mdx`
- Original cxauth design: `docs/superpowers/specs/2026-04-20-cxauth-design.md`
