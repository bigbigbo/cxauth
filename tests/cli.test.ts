import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeAuthSnapshot } from "../src/auth.ts";
import { formatResetAtDisplay, main } from "../src/cli.ts";
import { addSnapshot, switchAccount } from "../src/commands.ts";
import { getPaths } from "../src/paths.ts";
import { loadRegistry, saveRegistry } from "../src/registry.ts";
import { fakeAuth, makeEnv } from "./helpers.ts";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cxauth-cli-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localTimestamp(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

async function runCli(argv: string[], root: string) {
  const oldEnv = { CXAUTH_HOME: process.env.CXAUTH_HOME, CODEX_HOME: process.env.CODEX_HOME };
  Object.assign(process.env, makeEnv(root));
  const logs: string[] = [];
  const errors: string[] = [];
  const oldLog = console.log;
  const oldError = console.error;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));

  try {
    const code = await main(argv);
    return { code, stdout: logs.join("\n"), stderr: errors.join("\n") };
  } finally {
    console.log = oldLog;
    console.error = oldError;
    if (oldEnv.CXAUTH_HOME === undefined) delete process.env.CXAUTH_HOME;
    else process.env.CXAUTH_HOME = oldEnv.CXAUTH_HOME;
    if (oldEnv.CODEX_HOME === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = oldEnv.CODEX_HOME;
  }
}

test("list renders account table", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });
  await switchAccount("main", { paths, validator: async () => true });
  const result = await runCli(["list"], root);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("NAME");
  expect(result.stdout).toContain("main");
  expect(result.stdout).toContain("a@example.com");
  expect(result.stdout).toContain("*");
});

test("current reports unmanaged state", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  await writeAuthSnapshot(paths.globalAuth, fakeAuth("outside@example.com", "acct_outside"));
  const result = await runCli(["current"], root);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("unmanaged");
});

test("switch returns nonzero for unknown account", async () => {
  const result = await runCli(["switch", "missing"], await tempRoot());
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("unknown account");
});

test("rename changes saved account name", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });

  const renamed = await runCli(["rename", "main", "work"], root);
  const listed = await runCli(["list"], root);

  expect(renamed.code).toBe(0);
  expect(renamed.stdout).toContain("renamed main to work");
  expect(listed.stdout).toContain("work");
  expect(listed.stdout).not.toContain("main");
});

test("format reset display includes local absolute and relative time", () => {
  const target = "2026-04-27T00:12:00.000Z";
  expect(formatResetAtDisplay(target, Date.parse("2026-04-21T00:12:00.000Z"))).toBe(`${localTimestamp(target)} (in 6d 0h)`);
});

test("list renders reset time columns", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });
  const registry = await loadRegistry(paths);
  registry.accounts.main.status = {
    ...registry.accounts.main.status,
    weeklyLimit: { display: "100%", unit: "percent", value: 100, raw: "" },
    fiveHourLimit: { display: "80%", unit: "percent", value: 80, raw: "" },
    weeklyResetAt: "2026-04-27T00:12:00.000Z",
    fiveHourResetAt: "2026-04-21T03:42:00.000Z",
    checkedAt: "2026-04-21T00:12:00.000Z",
    source: "chatgpt-usage",
    state: "ok",
  };
  await saveRegistry(paths, registry);

  const realNow = Date.now;
  Date.now = () => Date.parse("2026-04-21T00:12:00.000Z");
  try {
    const result = await runCli(["list"], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("WEEKLY_RESET_AT");
    expect(result.stdout).toContain("5H_RESET_AT");
    expect(result.stdout).toContain(`${localTimestamp("2026-04-27T00:12:00.000Z")} (in 6d 0h)`);
    expect(result.stdout).toContain(`${localTimestamp("2026-04-21T03:42:00.000Z")} (in 3h 30m)`);
  } finally {
    Date.now = realNow;
  }
});
