import type { AccountStatus, Paths } from "./types.ts";

export async function runDeviceLogin(): Promise<unknown> {
  throw new Error("codex device login is not wired yet");
}

export async function validateLoginStatus(): Promise<boolean> {
  return true;
}

export async function probeStatus(_authPath: string, _options: { paths: Paths; codexBin?: string; timeoutMs?: number }): Promise<AccountStatus> {
  return {
    weeklyLimit: { display: "unknown", unit: "unknown", value: null, raw: "" },
    fiveHourLimit: { display: "unknown", unit: "unknown", value: null, raw: "" },
    checkedAt: null,
    source: null,
    rawSnippet: "",
    state: "not_checked",
  };
}
