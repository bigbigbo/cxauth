import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { AuthSnapshotError, extractMetadata, normalizeAuthSnapshot, readAuthSnapshot, writeAuthSnapshot } from "./auth.ts";
import { probeStatus, runDeviceLogin, validateLoginStatus } from "./codex.ts";
import { getPaths } from "./paths.ts";
import { FileLock, atomicWriteBytes, ensureStorage, loadRegistry, pathExists, saveRegistry } from "./registry.ts";
import type { AccountEntry, AccountStatus, Paths } from "./types.ts";

export class CommandError extends Error {}

type CommandOptions = {
  paths?: Paths;
};

function nowIso(): string {
  return new Date().toISOString();
}

function defaultLimit() {
  return { display: "unknown", unit: "unknown" as const, value: null, raw: "" };
}

function defaultStatus(): AccountStatus {
  return {
    weeklyLimit: defaultLimit(),
    fiveHourLimit: defaultLimit(),
    weeklyResetAt: null,
    fiveHourResetAt: null,
    checkedAt: null,
    source: null,
    rawSnippet: "",
    state: "not_checked",
  };
}

function validateName(name: string): void {
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new CommandError("account name must be a simple path-safe string");
  }
}

function accountAuthPath(paths: Paths, name: string): string {
  return path.join(paths.accountsDir, name, "auth.json");
}

export async function addSnapshot(name: string, auth: unknown, options: CommandOptions = {}): Promise<AccountEntry> {
  const paths = options.paths ?? getPaths();
  validateName(name);
  await ensureStorage(paths);
  const metadata = extractMetadata(auth);
  const lock = new FileLock(paths.lock);
  await lock.acquire();

  try {
    const registry = await loadRegistry(paths);
    if (registry.accounts[name]) throw new CommandError(`account already exists: ${name}`);
    for (const account of Object.values(registry.accounts)) {
      if (metadata.email !== "unknown" && account.email === metadata.email) {
        throw new CommandError(`email is already saved under account: ${account.name}`);
      }
    }

    const authPath = accountAuthPath(paths, name);
    await writeAuthSnapshot(authPath, auth);
    const createdAt = nowIso();
    const account: AccountEntry = {
      name,
      email: metadata.email,
      chatgptAccountId: metadata.chatgptAccountId,
      planType: metadata.planType,
      authPath,
      createdAt,
      updatedAt: createdAt,
      lastUsedAt: null,
      status: defaultStatus(),
      notes: "",
    };
    registry.accounts[name] = account;
    await saveRegistry(paths, registry);
    return account;
  } finally {
    await lock.release();
  }
}

export async function addViaDeviceLogin(
  name: string,
  options: CommandOptions & { codexBin?: string; timeoutMs?: number } = {},
): Promise<AccountEntry> {
  const paths = options.paths ?? getPaths();
  const auth = await runDeviceLogin({ paths, codexBin: options.codexBin, timeoutMs: options.timeoutMs });
  return addSnapshot(name, auth, { paths });
}

export async function importFromFile(
  name: string,
  filePath: string,
  options: CommandOptions = {},
): Promise<AccountEntry> {
  const paths = options.paths ?? getPaths();
  validateName(name);
  const resolved = path.resolve(filePath);
  let raw: unknown;
  try {
    raw = JSON.parse(await Bun.file(resolved).text());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CommandError(`file not found: ${resolved}`);
    }
    throw new CommandError(`invalid JSON in ${resolved}`);
  }
  const auth = normalizeAuthSnapshot(raw);
  return addSnapshot(name, auth, { paths });
}

export async function switchAccount(
  name: string,
  options: CommandOptions & { validator?: () => Promise<boolean> } = {},
): Promise<{ name: string; validated: boolean; backupPath: string }> {
  const paths = options.paths ?? getPaths();
  await ensureStorage(paths);
  const lock = new FileLock(paths.lock);
  await lock.acquire();

  try {
    const registry = await loadRegistry(paths);
    const account = registry.accounts[name];
    if (!account) throw new CommandError(`unknown account: ${name}`);
    await readAuthSnapshot(account.authPath);
    const backupPath = path.join(paths.backupsDir, "auth.json.bak");
    if (await pathExists(paths.globalAuth)) {
      await atomicWriteBytes(backupPath, await Bun.file(paths.globalAuth).bytes(), 0o600);
    }
    await writeAuthSnapshot(paths.globalAuth, await readAuthSnapshot(account.authPath));
    const validated = options.validator ? await options.validator() : true;
    account.lastUsedAt = nowIso();
    account.updatedAt = nowIso();
    registry.activeAccount = name;
    await saveRegistry(paths, registry);
    return { name, validated, backupPath };
  } finally {
    await lock.release();
  }
}

async function globalAuthMetadata(paths: Paths) {
  if (!(await pathExists(paths.globalAuth))) return null;

  try {
    return extractMetadata(await readAuthSnapshot(paths.globalAuth));
  } catch (error) {
    if (error instanceof AuthSnapshotError) return null;
    throw error;
  }
}

export async function currentAccount(
  options: CommandOptions = {},
): Promise<{ name: string | null; state: "managed" | "unmanaged" | "missing"; email: string }> {
  const paths = options.paths ?? getPaths();
  const registry = await loadRegistry(paths);
  const metadata = await globalAuthMetadata(paths);
  if (!metadata) return { name: null, state: "missing", email: "unknown" };

  for (const account of Object.values(registry.accounts)) {
    const accountIdMatches = account.chatgptAccountId !== "unknown" && account.chatgptAccountId === metadata.chatgptAccountId;
    const emailMatches = account.email !== "unknown" && account.email === metadata.email;
    if (accountIdMatches || emailMatches) {
      if (registry.activeAccount !== account.name) {
        registry.activeAccount = account.name;
        await saveRegistry(paths, registry);
      }
      return { name: account.name, state: "managed", email: account.email };
    }
  }

  return { name: null, state: "unmanaged", email: metadata.email };
}

export async function listAccounts(options: CommandOptions = {}) {
  const paths = options.paths ?? getPaths();
  const registry = await loadRegistry(paths);
  const current = await currentAccount({ paths });
  return {
    accounts: Object.values(registry.accounts).sort((a, b) => a.name.localeCompare(b.name)),
    activeName: current.name,
    activeState: current.state,
    activeEmail: current.email,
  };
}

export async function removeAccount(name: string, options: CommandOptions = {}): Promise<{ removed: string }> {
  const paths = options.paths ?? getPaths();
  const lock = new FileLock(paths.lock);
  await lock.acquire();

  try {
    const registry = await loadRegistry(paths);
    const current = await currentAccount({ paths });
    if (current.name === name) throw new CommandError("cannot remove the globally active account");
    const account = registry.accounts[name];
    if (!account) throw new CommandError(`unknown account: ${name}`);
    delete registry.accounts[name];
    if (registry.activeAccount === name) registry.activeAccount = null;
    await rm(path.dirname(account.authPath), { recursive: true, force: true });
    await saveRegistry(paths, registry);
    return { removed: name };
  } finally {
    await lock.release();
  }
}

export async function renameAccount(
  oldName: string,
  newName: string,
  options: CommandOptions = {},
): Promise<{ oldName: string; account: AccountEntry }> {
  const paths = options.paths ?? getPaths();
  validateName(oldName);
  validateName(newName);
  if (oldName === newName) throw new CommandError("new account name must be different");
  await ensureStorage(paths);
  const lock = new FileLock(paths.lock);
  await lock.acquire();

  try {
    const registry = await loadRegistry(paths);
    const account = registry.accounts[oldName];
    if (!account) throw new CommandError(`unknown account: ${oldName}`);
    if (registry.accounts[newName]) throw new CommandError(`account already exists: ${newName}`);

    await readAuthSnapshot(account.authPath);
    const oldDir = path.dirname(account.authPath);
    const newDir = path.join(paths.accountsDir, newName);
    if (await pathExists(newDir)) throw new CommandError(`account directory already exists: ${newName}`);

    await rename(oldDir, newDir);
    account.name = newName;
    account.authPath = accountAuthPath(paths, newName);
    account.updatedAt = nowIso();
    delete registry.accounts[oldName];
    registry.accounts[newName] = account;
    if (registry.activeAccount === oldName) registry.activeAccount = newName;
    await saveRegistry(paths, registry);
    return { oldName, account };
  } finally {
    await lock.release();
  }
}

export async function reauthAccount(
  name: string,
  options: CommandOptions & { codexBin?: string; timeoutMs?: number } = {},
): Promise<AccountEntry> {
  const paths = options.paths ?? getPaths();
  await ensureStorage(paths);
  const lock = new FileLock(paths.lock);
  await lock.acquire();

  try {
    const registry = await loadRegistry(paths);
    const account = registry.accounts[name];
    if (!account) throw new CommandError(`unknown account: ${name}`);

    const auth = await runDeviceLogin({ paths, codexBin: options.codexBin, timeoutMs: options.timeoutMs });
    const metadata = extractMetadata(auth);
    await writeAuthSnapshot(account.authPath, auth);

    account.email = metadata.email;
    account.chatgptAccountId = metadata.chatgptAccountId;
    account.planType = metadata.planType;
    account.updatedAt = nowIso();
    account.status = defaultStatus();

    // If this is the active account, also update global auth
    if (registry.activeAccount === name) {
      await writeAuthSnapshot(paths.globalAuth, auth);
    }

    await saveRegistry(paths, registry);
    return account;
  } finally {
    await lock.release();
  }
}

export async function refreshStatus(
  name: string | null,
  options: CommandOptions & { codexBin?: string; timeoutMs?: number } = {},
): Promise<AccountEntry[]> {
  const paths = options.paths ?? getPaths();
  const updated: AccountEntry[] = [];
  const lock = new FileLock(paths.lock);
  await lock.acquire();

  try {
    const registry = await loadRegistry(paths);
    const names = name ? [name] : Object.keys(registry.accounts).sort();
    for (const accountName of names) {
      const account = registry.accounts[accountName];
      if (!account) throw new CommandError(`unknown account: ${accountName}`);
      account.status = await probeStatus(account.authPath, { paths, codexBin: options.codexBin, timeoutMs: options.timeoutMs });
      account.updatedAt = nowIso();
      updated.push(account);
    }
    await saveRegistry(paths, registry);
    return updated;
  } finally {
    await lock.release();
  }
}

export async function defaultSwitchValidator(paths: Paths, codexBin = "codex"): Promise<boolean> {
  return validateLoginStatus({ paths, codexBin });
}
