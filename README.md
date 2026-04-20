# cxauth

`cxauth` manages multiple ChatGPT-backed Codex auth snapshots on one machine.

## Install for local development

```bash
bun install
bun link --global
```

## Commands

```bash
cxauth add main
cxauth list
cxauth switch main
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

`cxauth status` starts an isolated Codex session with the saved account snapshot,
sends `/status`, and parses values such as `weekly 62%` and `5h 18%`.

The Bun implementation uses the macOS `script` command as its first PTY backend.
Quota parsing is best-effort. If Codex changes the TUI output, switching still works
and status will show `parse_failed`, `timeout`, or `auth_expired`.

## Test

```bash
bun test
```
