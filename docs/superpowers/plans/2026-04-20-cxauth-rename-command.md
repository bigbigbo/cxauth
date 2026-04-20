# Rename Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `cxauth rename <old-name> <new-name>` so users can change saved account names without re-adding accounts.

**Architecture:** Implement rename as a registry mutation under the existing lock. The command moves the account directory, updates the registry key and account metadata, and updates `activeAccount` when the renamed account is active.

**Tech Stack:** Bun, TypeScript, Bun test runner, Node `fs/promises`.

---

### Task 1: Command Behavior

**Files:**
- Modify: `src/commands.ts`
- Test: `tests/commands.test.ts`

- [x] **Step 1: Add tests**

Cover successful rename, active account rename, duplicate destination, unknown source, and same-name rejection.

- [x] **Step 2: Implement `renameAccount`**

Use the existing `FileLock`, `validateName`, `loadRegistry`, and `saveRegistry` helpers. Move `~/.cxauth/accounts/<old-name>` to `~/.cxauth/accounts/<new-name>`, update `account.name`, `account.authPath`, `account.updatedAt`, registry keys, and `activeAccount`.

### Task 2: CLI And Docs

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`
- Test: `tests/cli.test.ts`

- [x] **Step 1: Add CLI route**

Add usage text and command dispatch for `cxauth rename <old-name> <new-name>`.

- [x] **Step 2: Add CLI tests**

Verify the command returns `0`, prints `renamed <old> to <new>`, and the list output shows the new name.

- [x] **Step 3: Update README**

Add the command to the usage block.

### Task 3: Verification

**Files:**
- Modify: implementation files from prior tasks

- [x] **Step 1: Run full tests**

Run: `bun test`

Expected: all tests pass.

- [x] **Step 2: Smoke test local CLI**

Use a temporary `CXAUTH_HOME` and `CODEX_HOME` to add fixture snapshots through tests only; no manual real-account mutation is required for this command.

## Self-Review

- Spec coverage: The plan covers rename behavior, active account handling, conflict handling, CLI routing, docs, and tests.
- Placeholder scan: No TBD/TODO placeholders are present.
- Type consistency: The plan uses existing `AccountEntry`, `Registry`, `Paths`, and command helper names.
