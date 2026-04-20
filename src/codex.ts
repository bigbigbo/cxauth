import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { readAuthSnapshot } from "./auth.ts";
import { ensurePrivateDir } from "./registry.ts";
import type { AccountStatus, LimitValue, Paths } from "./types.ts";

function nowIso(): string {
  return new Date().toISOString();
}

function unknownLimit(): LimitValue {
  return { display: "unknown", unit: "unknown", value: null, raw: "" };
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
    rawSnippet: output.slice(-2_000),
    state: weeklyLimit.display !== "unknown" || fiveHourLimit.display !== "unknown" ? "ok" : "parse_failed",
  };
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

async function readUntilLimit(stream: ReadableStream<Uint8Array>, timeoutMs: number): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        reader.read(),
        Bun.sleep(remaining).then(() => ({ done: true, value: undefined }) as ReadableStreamReadResult<Uint8Array>),
      ]);
      if (result.done) break;
      output += decoder.decode(result.value, { stream: true });
      const lower = output.toLowerCase();
      if (lower.includes("weekly") || lower.includes("five-hour") || lower.includes("5h")) break;
    }
  } finally {
    reader.releaseLock();
  }

  return output;
}

export async function probeStatus(
  authPath: string,
  options: { paths: Paths; codexBin?: string; scriptBin?: string; timeoutMs?: number },
): Promise<AccountStatus> {
  await readAuthSnapshot(authPath);
  await ensurePrivateDir(options.paths.tmpDir);
  const tempHome = await mkdtemp(path.join(options.paths.tmpDir, "probe-"));

  try {
    await chmod(tempHome, 0o700);
    await Bun.write(path.join(tempHome, "auth.json"), Bun.file(authPath));
    const proc = Bun.spawn(
      [options.scriptBin ?? "script", "-q", "-t", "0", "/dev/null", options.codexBin ?? "codex", "--no-alt-screen"],
      {
        env: { ...process.env, CODEX_HOME: tempHome } as Record<string, string>,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    proc.stdin.write(new TextEncoder().encode("/status\n"));
    const [stdout, stderr] = await Promise.all([
      readUntilLimit(proc.stdout, options.timeoutMs ?? 20_000),
      readUntilLimit(proc.stderr, options.timeoutMs ?? 20_000),
    ]);
    proc.stdin.write(new TextEncoder().encode("/quit\n"));
    proc.stdin.end();
    const parsed = parseStatusOutput(`${stdout}\n${stderr}`);
    const lower = parsed.rawSnippet.toLowerCase();
    if (parsed.state === "parse_failed" && lower.includes("authentication required")) {
      parsed.state = "auth_expired";
    }
    await Promise.race([
      proc.exited,
      Bun.sleep(250).then(async () => {
        proc.kill();
        return proc.exited;
      }),
    ]);
    return parsed;
  } catch (error) {
    return {
      weeklyLimit: unknownLimit(),
      fiveHourLimit: unknownLimit(),
      checkedAt: nowIso(),
      source: "/status",
      rawSnippet: error instanceof Error ? error.message.slice(-2_000) : "",
      state: "timeout",
    };
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
}
