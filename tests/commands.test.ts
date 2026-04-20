import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractMetadata, readAuthSnapshot, writeAuthSnapshot } from "../src/auth.ts";
import { addSnapshot, currentAccount, listAccounts, removeAccount, switchAccount } from "../src/commands.ts";
import { getPaths } from "../src/paths.ts";
import { loadRegistry } from "../src/registry.ts";
import { fakeAuth, makeEnv } from "./helpers.ts";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cxauth-commands-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("add snapshot persists metadata and default status", async () => {
  const paths = getPaths(makeEnv(await tempRoot()));
  const account = await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });
  expect(account.name).toBe("main");
  expect(account.email).toBe("a@example.com");
  expect(account.status.state).toBe("not_checked");
});

test("add snapshot rejects duplicate name and duplicate email", async () => {
  const paths = getPaths(makeEnv(await tempRoot()));
  await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });
  await expect(addSnapshot("main", fakeAuth("b@example.com", "acct_b"), { paths })).rejects.toThrow("account already exists");
  await expect(addSnapshot("backup", fakeAuth("a@example.com", "acct_c"), { paths })).rejects.toThrow("email is already saved");
});

test("switch replaces global auth and updates current", async () => {
  const paths = getPaths(makeEnv(await tempRoot()));
  await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });
  await addSnapshot("backup", fakeAuth("b@example.com", "acct_b"), { paths });
  const result = await switchAccount("backup", { paths, validator: async () => true });
  expect(result.validated).toBe(true);
  expect((await loadRegistry(paths)).activeAccount).toBe("backup");
  expect((await currentAccount({ paths })).name).toBe("backup");
  expect(extractMetadata(await readAuthSnapshot(paths.globalAuth)).email).toBe("b@example.com");
});

test("switch keeps backup when validation fails", async () => {
  const paths = getPaths(makeEnv(await tempRoot()));
  await writeAuthSnapshot(paths.globalAuth, fakeAuth("old@example.com", "acct_old"));
  await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });
  const result = await switchAccount("main", { paths, validator: async () => false });
  expect(result.validated).toBe(false);
  expect(extractMetadata(await readAuthSnapshot(paths.globalAuth)).email).toBe("a@example.com");
  expect(extractMetadata(await readAuthSnapshot(path.join(paths.backupsDir, "auth.json.bak"))).email).toBe("old@example.com");
});

test("remove refuses active account", async () => {
  const paths = getPaths(makeEnv(await tempRoot()));
  await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });
  await switchAccount("main", { paths, validator: async () => true });
  await expect(removeAccount("main", { paths })).rejects.toThrow("cannot remove the globally active account");
});

test("list detects unmanaged global auth", async () => {
  const paths = getPaths(makeEnv(await tempRoot()));
  await writeAuthSnapshot(paths.globalAuth, fakeAuth("outside@example.com", "acct_outside"));
  const listed = await listAccounts({ paths });
  expect(listed.activeName).toBeNull();
  expect(listed.activeState).toBe("unmanaged");
});
