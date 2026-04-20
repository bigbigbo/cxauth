import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractMetadata, readAuthSnapshot } from "./auth.ts";
import { ensurePrivateDir } from "./registry.ts";
import type { AccountStatus, LimitValue, Paths, StatusState } from "./types.ts";

const DEFAULT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const RAW_SNIPPET_LIMIT = 2_000;
type FetchImpl = typeof fetch;

function nowIso(): string {
  return new Date().toISOString();
}

function unknownLimit(raw = ""): LimitValue {
  return { display: "unknown", unit: "unknown", value: null, raw };
}

function failedStatus(state: StatusState, source: string, rawSnippet: string): AccountStatus {
  return {
    weeklyLimit: unknownLimit(),
    fiveHourLimit: unknownLimit(),
    checkedAt: nowIso(),
    source,
    rawSnippet: rawSnippet.slice(-RAW_SNIPPET_LIMIT),
    state,
  };
}

export function stripTerminalControl(input: string): string {
  return input.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function percentLimit(labels: string[], output: string): LimitValue {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\-/g, "[- ]");
    const match = new RegExp(`(?:${escaped})\\s*[:=]?\\s*(\\d{1,3})%`, "i").exec(output);
    if (match) {
      const value = Math.max(0, Math.min(100, Number(match[1])));
      return { display: `${value}%`, unit: "percent", value, raw: match[0] };
    }
  }
  return unknownLimit();
}

export function parseStatusOutput(rawOutput: string): AccountStatus {
  const output = stripTerminalControl(rawOutput);
  const weeklyLimit = percentLimit(["weekly", "weekly-limit"], output);
  const fiveHourLimit = percentLimit(["5h", "five-hour", "five-hour-limit"], output);
  return {
    weeklyLimit,
    fiveHourLimit,
    checkedAt: nowIso(),
    source: "/status",
    rawSnippet: output.slice(-RAW_SNIPPET_LIMIT),
    state: weeklyLimit.display !== "unknown" || fiveHourLimit.display !== "unknown" ? "ok" : "parse_failed",
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function percentDisplay(value: number): string {
  const normalized = Math.max(0, Math.min(100, value));
  return Number.isInteger(normalized) ? `${normalized}%` : `${Number(normalized.toFixed(1))}%`;
}

function windowMinutes(window: Record<string, unknown>): number | null {
  const seconds = numberValue(window.limit_window_seconds);
  if (seconds === null || seconds <= 0) return null;
  return Math.ceil(seconds / 60);
}

function limitFromWindow(label: string, windowValue: unknown): LimitValue {
  const window = objectRecord(windowValue);
  if (!window) return unknownLimit();

  const usedPercent = numberValue(window.used_percent);
  if (usedPercent === null) return unknownLimit();

  const used = Math.max(0, Math.min(100, usedPercent));
  const value = Math.max(0, Math.min(100, 100 - used));
  const minutes = windowMinutes(window);
  const resetAt = numberValue(window.reset_at);
  const rawParts = [`${label} used=${percentDisplay(used)}`, `left=${percentDisplay(value)}`];
  if (minutes !== null) rawParts.push(`${minutes}m`);
  if (resetAt !== null) rawParts.push(`reset_at=${resetAt}`);

  return {
    display: percentDisplay(value),
    unit: "percent",
    value,
    raw: rawParts.join(" "),
  };
}

function jsonSnippet(value: unknown): string {
  try {
    return JSON.stringify(value).slice(-RAW_SNIPPET_LIMIT);
  } catch {
    return "";
  }
}

export function parseUsagePayload(payload: unknown): AccountStatus {
  const root = objectRecord(payload);
  const rateLimit = objectRecord(root?.rate_limit);
  const fiveHourLimit = limitFromWindow("primary", rateLimit?.primary_window);
  const weeklyLimit = limitFromWindow("secondary", rateLimit?.secondary_window);

  return {
    weeklyLimit,
    fiveHourLimit,
    checkedAt: nowIso(),
    source: "chatgpt-usage",
    rawSnippet: jsonSnippet(payload),
    state: weeklyLimit.display !== "unknown" || fiveHourLimit.display !== "unknown" ? "ok" : "parse_failed",
  };
}

function tokenString(auth: Record<string, unknown>, key: string): string | null {
  const tokens = objectRecord(auth.tokens);
  const value = tokens?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function accountIdFromSnapshot(auth: Record<string, unknown>): string | null {
  const direct = tokenString(auth, "account_id");
  if (direct) return direct;

  const metadata = extractMetadata(auth);
  return metadata.chatgptAccountId !== "unknown" ? metadata.chatgptAccountId : null;
}

function envWithCodexHome(paths: Paths): Record<string, string> {
  return { ...process.env, CODEX_HOME: paths.codexHome } as Record<string, string>;
}

export async function validateLoginStatus(options: { paths: Paths; codexBin?: string }): Promise<boolean> {
  try {
    const proc = Bun.spawn([options.codexBin ?? "codex", "login", "status"], {
      env: envWithCodexHome(options.paths),
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

export async function runDeviceLogin(options: {
  paths: Paths;
  codexBin?: string;
  timeoutMs?: number;
}): Promise<Awaited<ReturnType<typeof readAuthSnapshot>>> {
  await ensurePrivateDir(options.paths.tmpDir);
  const tempHome = await mkdtemp(path.join(options.paths.tmpDir, "login-"));

  try {
    await chmod(tempHome, 0o700);
    await writeFile(path.join(tempHome, "config.toml"), 'preferred_auth_method = "chatgpt"\n', { mode: 0o600 });
    const proc = Bun.spawn([options.codexBin ?? "codex", "login", "--device-auth"], {
      env: { ...process.env, CODEX_HOME: tempHome } as Record<string, string>,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const timeout = setTimeout(() => proc.kill(), options.timeoutMs ?? 600_000);
    const exitCode = await proc.exited;
    clearTimeout(timeout);
    if (exitCode !== 0) throw new Error(`codex device login failed with exit code ${exitCode}`);
    return readAuthSnapshot(path.join(tempHome, "auth.json"));
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
}

export async function probeStatus(
  authPath: string,
  options: { paths: Paths; codexBin?: string; timeoutMs?: number; fetchImpl?: FetchImpl; usageUrl?: string },
): Promise<AccountStatus> {
  let auth: Record<string, unknown>;
  try {
    auth = await readAuthSnapshot(authPath);
  } catch (error) {
    return failedStatus("parse_failed", "chatgpt-usage", error instanceof Error ? error.message : String(error));
  }

  const accessToken = tokenString(auth, "access_token");
  const accountId = accountIdFromSnapshot(auth);
  if (!accessToken || !accountId) {
    const missing = !accessToken && !accountId ? "access token and account id" : !accessToken ? "access token" : "account id";
    return failedStatus("auth_expired", "chatgpt-usage", `auth snapshot is missing ${missing}`);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const usageUrl = options.usageUrl ?? DEFAULT_USAGE_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

  try {
    const response = await fetchImpl(usageUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "ChatGPT-Account-Id": accountId,
        "Content-Type": "application/json",
      },
    });
    const body = await response.text();

    if (response.status === 401 || response.status === 403) {
      return failedStatus("auth_expired", "chatgpt-usage", `GET ${usageUrl} failed: ${response.status}; body=${body}`);
    }
    if (!response.ok) {
      return failedStatus("timeout", "chatgpt-usage", `GET ${usageUrl} failed: ${response.status}; body=${body}`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch (error) {
      return failedStatus("parse_failed", "chatgpt-usage", error instanceof Error ? `${error.message}; body=${body}` : body);
    }

    const parsed = parseUsagePayload(payload);
    parsed.rawSnippet = body.slice(-RAW_SNIPPET_LIMIT);
    return parsed;
  } catch (error) {
    return failedStatus("timeout", "chatgpt-usage", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}
