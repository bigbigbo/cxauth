# cxauth

`cxauth` manages multiple ChatGPT-backed Codex auth snapshots on one machine.

## Install for local development

```bash
bun install
ln -sf "$(pwd)/src/cli.ts" "$(bun pm bin -g)/cxauth"
cxauth --version
```

The CLI entrypoint has a Bun shebang, so the symlink above registers the local
checkout as the active `cxauth` command during development.

## Commands

```bash
cxauth add main
cxauth list
cxauth switch main
cxauth rename main work
cxauth status
cxauth status main
cxauth current
cxauth remove backup
```

## What switching changes

`cxauth switch <name>` replaces the global Codex auth file at `~/.codex/auth.json`.
After switching, plain `codex` uses the selected account.

Before replacing the file, `cxauth` stores the previous auth at:

```text
~/.cxauth/backups/auth.json.bak
```

## Storage

`cxauth` stores its registry and saved account auth snapshots under:

```text
~/.cxauth/
```

These files contain sensitive tokens. Do not commit, paste, or share them.

## Quota status

`cxauth status` reads the saved account snapshot, calls the same ChatGPT backend
usage endpoint that Codex uses for rate limits, and displays remaining quota.
For example, if the API reports `used_percent: 0`, `cxauth` shows `100%`.
The table also shows weekly and 5-hour reset times in local time, together with
relative countdowns such as `2026-04-27 08:12 (in 6d 0h)`.

Quota lookup is best-effort. If the saved token is expired, the network request
fails, or the response shape changes, switching still works and status will show
`auth_expired`, `timeout`, or `parse_failed`.

## Test

```bash
bun test
```
