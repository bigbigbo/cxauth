import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeAuthSnapshot } from "../src/auth.ts";
import { main } from "../src/cli.ts";
import { addSnapshot, switchAccount } from "../src/commands.ts";
import { getPaths } from "../src/paths.ts";
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
