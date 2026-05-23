import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractMetadata, normalizeAuthSnapshot, readAuthSnapshot, writeAuthSnapshot } from "../src/auth.ts";
import { addSnapshot, currentAccount, importFromFile, listAccounts, reauthAccount, removeAccount, renameAccount, switchAccount } from "../src/commands.ts";
import { getPaths } from "../src/paths.ts";
import { loadRegistry, pathExists } from "../src/registry.ts";
import { fakeAuth, fakeJwt, makeEnv, writeExecutable } from "./helpers.ts";
import { writeFile } from "node:fs/promises";

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
  expect(account.status.weeklyResetAt).toBeNull();
  expect(account.status.fiveHourResetAt).toBeNull();
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

test("rename account moves registry entry and account directory", async () => {
  const paths = getPaths(makeEnv(await tempRoot()));
  await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });

  const renamed = await renameAccount("main", "work", { paths });
  const registry = await loadRegistry(paths);

  expect(renamed.oldName).toBe("main");
  expect(renamed.account.name).toBe("work");
  expect(registry.accounts.main).toBeUndefined();
  expect(registry.accounts.work?.email).toBe("a@example.com");
  expect(registry.accounts.work?.authPath).toBe(path.join(paths.accountsDir, "work", "auth.json"));
  expect(await pathExists(path.join(paths.accountsDir, "main"))).toBe(false);
  expect(await pathExists(path.join(paths.accountsDir, "work", "auth.json"))).toBe(true);
});

test("rename account updates active account pointer", async () => {
  const paths = getPaths(makeEnv(await tempRoot()));
  await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });
  await switchAccount("main", { paths, validator: async () => true });

  await renameAccount("main", "work", { paths });

  expect((await loadRegistry(paths)).activeAccount).toBe("work");
  expect((await currentAccount({ paths })).name).toBe("work");
});

test("rename account rejects invalid source and destination", async () => {
  const paths = getPaths(makeEnv(await tempRoot()));
  await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });
  await addSnapshot("backup", fakeAuth("b@example.com", "acct_b"), { paths });

  await expect(renameAccount("missing", "work", { paths })).rejects.toThrow("unknown account");
  await expect(renameAccount("main", "backup", { paths })).rejects.toThrow("account already exists");
  await expect(renameAccount("main", "main", { paths })).rejects.toThrow("new account name must be different");
});

test("list detects unmanaged global auth", async () => {
  const paths = getPaths(makeEnv(await tempRoot()));
  await writeAuthSnapshot(paths.globalAuth, fakeAuth("outside@example.com", "acct_outside"));
  const listed = await listAccounts({ paths });
  expect(listed.activeName).toBeNull();
  expect(listed.activeState).toBe("unmanaged");
});

test("reauth replaces auth snapshot and updates metadata", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  const newAuth = fakeAuth("updated@example.com", "acct_new");
  const authJson = JSON.stringify(newAuth);
  const fake = await writeExecutable(
    path.join(root, "codex"),
    `
const args = Bun.argv.slice(2);
if (args.join(" ") !== "login --device-auth") process.exit(2);
await Bun.write(process.env.CODEX_HOME + "/auth.json", ${JSON.stringify(authJson)});
console.log("device login complete");
`,
  );
  await addSnapshot("main", fakeAuth("old@example.com", "acct_old"), { paths });

  const account = await reauthAccount("main", { paths, codexBin: fake, timeoutMs: 5_000 });
  expect(account.email).toBe("updated@example.com");
  expect(account.chatgptAccountId).toBe("acct_new");
  expect(account.status.state).toBe("not_checked");

  const registry = await loadRegistry(paths);
  expect(registry.accounts.main.email).toBe("updated@example.com");
  const onDisk = await readAuthSnapshot(registry.accounts.main.authPath);
  expect(extractMetadata(onDisk).email).toBe("updated@example.com");
});

test("reauth also updates global auth for active account", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  const newAuth = fakeAuth("refreshed@example.com", "acct_refreshed");
  const authJson = JSON.stringify(newAuth);
  const fake = await writeExecutable(
    path.join(root, "codex"),
    `
const args = Bun.argv.slice(2);
if (args.join(" ") !== "login --device-auth") process.exit(2);
await Bun.write(process.env.CODEX_HOME + "/auth.json", ${JSON.stringify(authJson)});
console.log("device login complete");
`,
  );
  await addSnapshot("main", fakeAuth("old@example.com", "acct_old"), { paths });
  await switchAccount("main", { paths, validator: async () => true });
  expect(extractMetadata(await readAuthSnapshot(paths.globalAuth)).email).toBe("old@example.com");

  await reauthAccount("main", { paths, codexBin: fake, timeoutMs: 5_000 });
  expect(extractMetadata(await readAuthSnapshot(paths.globalAuth)).email).toBe("refreshed@example.com");
});

test("reauth does not update global auth for inactive account", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  const newAuth = fakeAuth("updated@example.com", "acct_new");
  const authJson = JSON.stringify(newAuth);
  const fake = await writeExecutable(
    path.join(root, "codex"),
    `
const args = Bun.argv.slice(2);
if (args.join(" ") !== "login --device-auth") process.exit(2);
await Bun.write(process.env.CODEX_HOME + "/auth.json", ${JSON.stringify(authJson)});
console.log("device login complete");
`,
  );
  await addSnapshot("active", fakeAuth("a@example.com", "acct_a"), { paths });
  await addSnapshot("standby", fakeAuth("b@example.com", "acct_b"), { paths });
  await switchAccount("active", { paths, validator: async () => true });

  await reauthAccount("standby", { paths, codexBin: fake, timeoutMs: 5_000 });
  // Global auth should still be the active account, not the reauthed one
  expect(extractMetadata(await readAuthSnapshot(paths.globalAuth)).email).toBe("a@example.com");
});

test("reauth rejects unknown account", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  const fake = await writeExecutable(
    path.join(root, "codex"),
    `process.exit(0);`,
  );
  await expect(reauthAccount("missing", { paths, codexBin: fake })).rejects.toThrow("unknown account");
});

test("import from file reads auth.json and adds account", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  const authFile = path.join(root, "my-auth.json");
  const auth = fakeAuth("imported@example.com", "acct_imported");
  await writeFile(authFile, JSON.stringify(auth));

  const account = await importFromFile("myaccount", authFile, { paths });
  expect(account.name).toBe("myaccount");
  expect(account.email).toBe("imported@example.com");
  expect(account.chatgptAccountId).toBe("acct_imported");
  expect(account.status.state).toBe("not_checked");

  const onDisk = await readAuthSnapshot(path.join(paths.accountsDir, "myaccount", "auth.json"));
  expect(extractMetadata(onDisk).email).toBe("imported@example.com");
});

test("import rejects missing file", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  await expect(importFromFile("myaccount", path.join(root, "nonexistent.json"), { paths })).rejects.toThrow("file not found");
});

test("import rejects duplicate name", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  await addSnapshot("main", fakeAuth("a@example.com", "acct_a"), { paths });

  const authFile = path.join(root, "other-auth.json");
  await writeFile(authFile, JSON.stringify(fakeAuth("b@example.com", "acct_b")));
  await expect(importFromFile("main", authFile, { paths })).rejects.toThrow("account already exists");
});

test("import handles flat token format", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  const flatAuth = {
    id_token: fakeJwt({
      email: "flat@example.com",
      sub: "acct_flat",
      "https://api.openai.com/auth": { chatgpt_account_id: "acct_flat", plan_type: "plus" },
    }),
    access_token: "access-flat",
    refresh_token: "refresh-flat",
    account_id: "acct_flat",
    email: "flat@example.com",
    type: "codex",
  };
  const authFile = path.join(root, "flat-auth.json");
  await writeFile(authFile, JSON.stringify(flatAuth));

  const account = await importFromFile("flatuser", authFile, { paths });
  expect(account.name).toBe("flatuser");
  expect(account.email).toBe("flat@example.com");
  expect(account.chatgptAccountId).toBe("acct_flat");
  expect(account.planType).toBe("plus");
});
