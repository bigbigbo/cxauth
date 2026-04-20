import { constants as fsConstants } from "node:fs";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Paths, Registry } from "./types.ts";

export const REGISTRY_VERSION = 1;

export function emptyRegistry(): Registry {
  return { version: REGISTRY_VERSION, activeAccount: null, accounts: {} };
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function ensurePrivateDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true, mode: 0o700 });
  await chmod(dirPath, 0o700);
}

export async function ensureStorage(paths: Paths): Promise<void> {
  await ensurePrivateDir(paths.cxauthHome);
  await ensurePrivateDir(paths.accountsDir);
  await ensurePrivateDir(paths.backupsDir);
  await ensurePrivateDir(paths.tmpDir);
}

export async function atomicWriteBytes(filePath: string, data: Uint8Array | string, mode = 0o600): Promise<void> {
  await ensurePrivateDir(path.dirname(filePath));
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmpPath, data, { mode });
    await chmod(tmpPath, mode);
    await rename(tmpPath, filePath);
    await chmod(filePath, mode);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

export async function atomicWriteJson(filePath: string, value: unknown, mode = 0o600): Promise<void> {
  await atomicWriteBytes(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

export async function loadRegistry(paths: Paths): Promise<Registry> {
  await ensureStorage(paths);
  if (!(await pathExists(paths.registry))) return emptyRegistry();
  const loaded = JSON.parse(await readFile(paths.registry, "utf8")) as Partial<Registry>;
  return {
    version: loaded.version ?? REGISTRY_VERSION,
    activeAccount: loaded.activeAccount ?? null,
    accounts: loaded.accounts ?? {},
  };
}

export async function saveRegistry(paths: Paths, registry: Registry): Promise<void> {
  await ensureStorage(paths);
  await atomicWriteJson(paths.registry, { ...registry, version: REGISTRY_VERSION }, 0o600);
}

export class FileLock {
  private handle: Awaited<ReturnType<typeof open>> | null = null;

  constructor(private readonly lockPath: string) {}

  async acquire(options: { timeoutMs?: number; pollMs?: number } = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const pollMs = options.pollMs ?? 50;
    const deadline = Date.now() + timeoutMs;
    await mkdir(path.dirname(this.lockPath), { recursive: true, mode: 0o700 });

    while (true) {
      try {
        this.handle = await open(this.lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
        await this.handle.writeFile(`${process.pid}\n`);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() >= deadline) throw new Error(`timed out waiting for lock: ${this.lockPath}`);
        await Bun.sleep(pollMs);
      }
    }
  }

  async release(): Promise<void> {
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
    }
    await rm(this.lockPath, { force: true });
  }
}
