# Reset Time Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose weekly and 5-hour quota reset times in `cxauth status` and `cxauth list`.

**Architecture:** Extend `AccountStatus` with explicit reset-time fields, parse `reset_at` from the ChatGPT usage payload into ISO timestamps, and render them in new table columns using local absolute time plus a relative countdown.

**Tech Stack:** Bun, TypeScript, Bun test runner.

---

### Task 1: Status Model And Parser

**Files:**
- Modify: `src/types.ts`
- Modify: `src/codex.ts`
- Test: `tests/codex.test.ts`

- [x] **Step 1: Add tests for parsed reset timestamps**
- [x] **Step 2: Extend status types with `weeklyResetAt` and `fiveHourResetAt`**
- [x] **Step 3: Parse `reset_at` into stored timestamps**

### Task 2: CLI Rendering

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli.test.ts`

- [x] **Step 1: Add render helpers for absolute and relative reset time**
- [x] **Step 2: Add `WEEKLY_RESET_AT` and `5H_RESET_AT` columns**
- [x] **Step 3: Add CLI test coverage**

### Task 3: Docs And Verification

**Files:**
- Modify: `README.md`

- [x] **Step 1: Update README quota description**
- [x] **Step 2: Run full tests**
- [x] **Step 3: Smoke test one real account with `cxauth status <name>`**

## Self-Review

- Spec coverage: parser, stored fields, rendering, docs, and verification are covered.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: the plan keeps status naming aligned with existing weekly and 5-hour fields.
