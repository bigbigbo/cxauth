import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getPaths } from "../src/paths.ts";
import { FileLock, loadRegistry, saveRegistry } from "../src/registry.ts";
import { makeEnv } from "./helpers.ts";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cxauth-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

test("paths respect env overrides", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  expect(paths.cxauthHome).toBe(path.resolve(root, "cxauth-home"));
  expect(paths.codexHome).toBe(path.resolve(root, "codex-home"));
  expect(paths.globalAuth).toBe(path.resolve(root, "codex-home", "auth.json"));
  expect(paths.registry).toBe(path.resolve(root, "cxauth-home", "registry.json"));
});

test("registry round trip uses private permissions", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  const registry = await loadRegistry(paths);
  registry.activeAccount = "main";
  registry.accounts.main = { name: "main" } as never;
  await saveRegistry(paths, registry);

  const loaded = await loadRegistry(paths);
  expect(loaded.activeAccount).toBe("main");
  expect(loaded.accounts.main.name).toBe("main");
  expect((await stat(paths.registry)).mode & 0o777).toBe(0o600);
  expect((await stat(paths.cxauthHome)).mode & 0o777).toBe(0o700);
});

test("file lock rejects a second holder", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  const first = new FileLock(paths.lock);
  const second = new FileLock(paths.lock);
  await first.acquire();
  try {
    await expect(second.acquire({ timeoutMs: 50, pollMs: 10 })).rejects.toThrow("timed out waiting for lock");
  } finally {
    await first.release();
  }
});
