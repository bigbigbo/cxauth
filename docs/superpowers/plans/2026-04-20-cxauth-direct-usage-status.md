# Direct Usage Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cxauth status` read Codex quota data through the same ChatGPT backend usage API used by openai/codex.

**Architecture:** Replace the current TUI `/status` subprocess probe with a direct HTTP usage probe. The probe reads `tokens.access_token` and account id from each saved ChatGPT `auth.json`, calls `https://chatgpt.com/backend-api/wham/usage`, maps primary and secondary window `used_percent` values into remaining `5H` and `WEEKLY` table fields, and preserves the current best-effort failure states.

**Tech Stack:** Bun, TypeScript, built-in `fetch`, Bun test runner.

---

### Task 1: Add Direct Usage Payload Parsing

**Files:**
- Modify: `src/codex.ts`
- Test: `tests/codex.test.ts`

- [x] **Step 1: Write parser tests**

Add tests that pass a representative `/wham/usage` payload with `primary_window` and `secondary_window`, then assert `fiveHourLimit`, `weeklyLimit`, `source`, and `state`.

- [x] **Step 2: Implement payload helpers**

Add small helpers in `src/codex.ts` to map `used_percent`, `limit_window_seconds`, and `reset_at` into the existing `LimitValue` and `AccountStatus` shapes. The displayed value is remaining quota, calculated as `100 - used_percent`.

- [x] **Step 3: Run focused tests**

Run: `bun test tests/codex.test.ts`

Expected: parser tests pass without needing network.

### Task 2: Replace TUI Probe With Usage API Probe

**Files:**
- Modify: `src/codex.ts`
- Test: `tests/codex.test.ts`

- [x] **Step 1: Write probe tests with stub fetch**

Add tests that call `probeStatus(authPath, { fetchImpl })` and verify request URL, `Authorization`, `ChatGPT-Account-Id`, success mapping, and `401` to `auth_expired`.

- [x] **Step 2: Implement auth extraction**

Read the auth snapshot, require `tokens.access_token`, and use `tokens.account_id` with fallback to metadata extraction when available.

- [x] **Step 3: Implement HTTP probe**

Call `https://chatgpt.com/backend-api/wham/usage` by default, support timeout via `AbortSignal.timeout`, parse JSON, and map HTTP/JSON errors to existing status states.

- [x] **Step 4: Keep public command behavior stable**

Keep `cxauth status [name] [--timeout <seconds>]` and the existing registry fields unchanged so `list`, `switch`, and saved registry files remain compatible.

### Task 3: Update Docs And Verify

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-04-20-cxauth-bun-typescript-migration-design.md`

- [x] **Step 1: Update status docs**

Replace the TUI `/status` explanation with the direct ChatGPT backend usage API explanation and keep the best-effort caveat.

- [x] **Step 2: Run full tests**

Run: `bun test`

Expected: all tests pass.

- [x] **Step 3: Smoke test CLI**

Run: `cxauth status <one saved account> --timeout 30`

Expected: the account row shows percent values or a meaningful auth/network failure state.

## Self-Review

- Spec coverage: The plan covers the approved direct API design, token/account id extraction, API parsing, error mapping, docs, and tests.
- Placeholder scan: No TBD/TODO placeholders are present.
- Type consistency: The plan keeps existing `AccountStatus`, `LimitValue`, and CLI command names unchanged.
