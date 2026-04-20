# cxauth Bun + TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the active Python `cxauth` implementation with a Bun + TypeScript CLI while preserving the existing command behavior and `~/.cxauth` storage format.

**Architecture:** Recreate the current module boundaries in TypeScript: path resolution, registry persistence, auth parsing, command orchestration, Codex subprocess integration, and CLI rendering. Use Bun as runtime, test runner, and package manager; use macOS `script` as the first PTY backend for `/status` probing.

**Tech Stack:** Bun 1.3.7+, TypeScript, `bun:test`, Bun subprocess APIs, Node-compatible `fs`, `path`, `os`, and `crypto` modules.

---

## References

- Migration spec: `docs/superpowers/specs/2026-04-20-cxauth-bun-typescript-migration-design.md`
- Original product spec: `docs/superpowers/specs/2026-04-20-cxauth-design.md`
- Bun package executable docs: `https://github.com/oven-sh/bun/blob/main/docs/pm/bunx.mdx`
- Bun child process docs: `https://github.com/oven-sh/bun/blob/main/docs/runtime/child-process.mdx`
- Bun link docs: `https://github.com/oven-sh/bun/blob/main/docs/pm/cli/link.mdx`

## File Structure

- Remove `pyproject.toml`: Python packaging is no longer active.
- Remove `src/cxauth/**/*.py`: Python implementation is replaced by TypeScript.
- Remove `tests/*.py`: Python unit tests are replaced by Bun tests.
- Create `package.json`: Bun package metadata, scripts, and `cxauth` bin.
- Create `tsconfig.json`: TypeScript strict settings for Bun.
- Create `src/types.ts`: shared registry, account, status, and result types.
- Create `src/paths.ts`: `CXAUTH_HOME`, `CODEX_HOME`, and default path resolution.
- Create `src/registry.ts`: private directories, atomic writes, registry load/save, lock file.
- Create `src/auth.ts`: auth snapshot validation, JWT metadata extraction, snapshot reads/writes.
- Create `src/codex.ts`: Codex subprocesses, device login, login status validation, quota parsing, `script` PTY probe.
- Create `src/commands.ts`: add, list, switch, current, status, remove command behavior.
- Create `src/cli.ts`: executable CLI parser, table rendering, exit codes.
- Create `tests/helpers.ts`: temp homes, fake JWT/auth, fake executable helpers.
- Create `tests/*.test.ts`: Bun unit tests for each module.
- Modify `README.md`: Bun install, usage, storage, status caveats, test commands.
- Modify `.gitignore`: keep Python cache ignores only if useful; add Bun/JS artifacts.

## Task 1: Replace Python Skeleton With Bun Package Skeleton

**Files:**
- Delete: `pyproject.toml`
- Delete: `src/cxauth/__init__.py`
- Delete: `src/cxauth/__main__.py`
- Delete: `src/cxauth/cli.py`
- Delete: `src/cxauth/paths.py`
- Delete: `src/cxauth/registry.py`
- Delete: `src/cxauth/auth.py`
- Delete: `src/cxauth/commands.py`
- Delete: `src/cxauth/codex.py`
- Delete: `tests/__init__.py`
- Delete: `tests/helpers.py`
- Delete: `tests/test_auth.py`
- Delete: `tests/test_cli.py`
- Delete: `tests/test_codex.py`
- Delete: `tests/test_commands.py`
- Delete: `tests/test_registry.py`
- Delete: `tests/test_smoke.py`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/cli.ts`
- Create: `tests/smoke.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Remove Python implementation files**

Run:

```bash
git rm pyproject.toml src/cxauth/__init__.py src/cxauth/__main__.py src/cxauth/cli.py src/cxauth/paths.py src/cxauth/registry.py src/cxauth/auth.py src/cxauth/commands.py src/cxauth/codex.py tests/__init__.py tests/helpers.py tests/test_auth.py tests/test_cli.py tests/test_codex.py tests/test_commands.py tests/test_registry.py tests/test_smoke.py
rmdir src/cxauth
```

Expected: files are staged for deletion and `src/cxauth` is removed if empty.

- [ ] **Step 2: Create Bun package metadata**

Create `package.json`:

```json
{
  "name": "cxauth",
  "version": "0.1.0",
  "description": "Manage multiple ChatGPT-backed Codex auth snapshots",
  "type": "module",
  "bin": {
    "cxauth": "./src/cli.ts"
  },
  "scripts": {
    "test": "bun test",
    "start": "bun run src/cli.ts"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2023",
    "strict": true,
    "types": ["bun-types"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Add initial CLI entrypoint and smoke test**

Create `src/cli.ts`:

```ts
#!/usr/bin/env bun

export const VERSION = "0.1.0";

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  if (argv.includes("--version")) {
    console.log(VERSION);
    return 0;
  }

  console.log("cxauth");
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
```

Create `tests/smoke.test.ts`:

```ts
import { expect, test } from "bun:test";
import { main, VERSION } from "../src/cli.ts";

test("version exits successfully", async () => {
  expect(VERSION).toBe("0.1.0");
  expect(await main(["--version"])).toBe(0);
});
```

Make the CLI entrypoint executable:

```bash
chmod +x src/cli.ts
```

- [ ] **Step 4: Update ignore rules**

Replace `.gitignore` with:

```gitignore
node_modules/
bun.lockb
dist/
coverage/
*.tsbuildinfo

__pycache__/
*.py[cod]
*.egg-info/
.pytest_cache/
.mypy_cache/
.ruff_cache/
```

- [ ] **Step 5: Install Bun dev dependencies**

Run:

```bash
bun install
```

Expected: Bun creates or updates `bun.lock` and installs `@types/bun`.

- [ ] **Step 6: Run smoke tests**

Run:

```bash
bun test
```

Expected: one passing smoke test.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json bun.lock .gitignore src/cli.ts tests/smoke.test.ts
git commit -m "chore: migrate project skeleton to bun"
```

## Task 2: Paths, Registry, Atomic Writes, and Locking

**Files:**
- Create: `src/types.ts`
- Create: `src/paths.ts`
- Create: `src/registry.ts`
- Create: `tests/helpers.ts`
- Create: `tests/registry.test.ts`

- [ ] **Step 1: Create shared test helpers**

Create `tests/helpers.ts`:

```ts
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function makeEnv(root: string): Record<string, string> {
  return {
    CXAUTH_HOME: path.join(root, "cxauth-home"),
    CODEX_HOME: path.join(root, "codex-home")
  };
}

export async function writeExecutable(filePath: string, body: string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `#!/usr/bin/env bun\n${body}`, "utf8");
  await chmod(filePath, 0o700);
  return filePath;
}
```

- [ ] **Step 2: Write failing registry tests**

Create `tests/registry.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
bun test tests/registry.test.ts
```

Expected: FAIL because `src/paths.ts` and `src/registry.ts` do not exist.

- [ ] **Step 4: Implement shared types**

Create `src/types.ts`:

```ts
export type LimitValue = {
  display: string;
  unit: "percent" | "unknown";
  value: number | null;
  raw: string;
};

export type StatusState = "ok" | "not_checked" | "auth_expired" | "parse_failed" | "timeout";

export type AccountStatus = {
  weeklyLimit: LimitValue;
  fiveHourLimit: LimitValue;
  checkedAt: string | null;
  source: string | null;
  rawSnippet: string;
  state: StatusState;
};

export type AccountEntry = {
  name: string;
  email: string;
  chatgptAccountId: string;
  planType: string;
  authPath: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  status: AccountStatus;
  notes: string;
};

export type Registry = {
  version: number;
  activeAccount: string | null;
  accounts: Record<string, AccountEntry>;
};

export type Paths = {
  cxauthHome: string;
  codexHome: string;
  registry: string;
  accountsDir: string;
  backupsDir: string;
  tmpDir: string;
  lock: string;
  globalAuth: string;
};
```

- [ ] **Step 5: Implement path resolution**

Create `src/paths.ts`:

```ts
import os from "node:os";
import path from "node:path";
import type { Paths } from "./types.ts";

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function resolvePath(input: string): string {
  return path.resolve(expandHome(input));
}

export function getPaths(env: Record<string, string | undefined> = process.env): Paths {
  const cxauthHome = resolvePath(env.CXAUTH_HOME ?? "~/.cxauth");
  const codexHome = resolvePath(env.CODEX_HOME ?? "~/.codex");
  return {
    cxauthHome,
    codexHome,
    registry: path.join(cxauthHome, "registry.json"),
    accountsDir: path.join(cxauthHome, "accounts"),
    backupsDir: path.join(cxauthHome, "backups"),
    tmpDir: path.join(cxauthHome, "tmp"),
    lock: path.join(cxauthHome, "cxauth.lock"),
    globalAuth: path.join(codexHome, "auth.json")
  };
}
```

- [ ] **Step 6: Implement registry storage and locking**

Create `src/registry.ts`:

```ts
import { constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
  await chmodCompat(dirPath, 0o700);
}

async function chmodCompat(filePath: string, mode: number): Promise<void> {
  const { chmod } = await import("node:fs/promises");
  await chmod(filePath, mode);
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
    await chmodCompat(tmpPath, mode);
    await rename(tmpPath, filePath);
    await chmodCompat(filePath, mode);
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
    accounts: loaded.accounts ?? {}
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
```

- [ ] **Step 7: Run tests**

Run:

```bash
bun test tests/registry.test.ts
bun test
```

Expected: registry tests and smoke tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/paths.ts src/registry.ts tests/helpers.ts tests/registry.test.ts
git commit -m "feat: add bun registry storage primitives"
```

## Task 3: Auth Snapshot Validation and Metadata Extraction

**Files:**
- Create: `src/auth.ts`
- Modify: `tests/helpers.ts`
- Create: `tests/auth.test.ts`

- [ ] **Step 1: Add fake auth helpers**

Append to `tests/helpers.ts`:

```ts
export function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

export function fakeAuth(email: string, accountId: string, plan = "plus"): Record<string, unknown> {
  return {
    auth_mode: "chatgpt",
    tokens: {
      id_token: fakeJwt({
        email,
        sub: accountId,
        "https://api.openai.com/auth": {
          chatgpt_account_id: accountId,
          plan_type: plan
        }
      })
    }
  };
}
```

- [ ] **Step 2: Write failing auth tests**

Create `tests/auth.test.ts`:

```ts
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractMetadata, readAuthSnapshot, writeAuthSnapshot } from "../src/auth.ts";
import { getPaths } from "../src/paths.ts";
import { fakeAuth, fakeJwt, makeEnv } from "./helpers.ts";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cxauth-auth-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("extracts metadata from nested token payload", () => {
  const metadata = extractMetadata({
    auth_mode: "chatgpt",
    tokens: {
      id_token: fakeJwt({
        email: "user@example.com",
        sub: "user-sub",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_123",
          plan_type: "plus"
        }
      })
    }
  });
  expect(metadata.email).toBe("user@example.com");
  expect(metadata.chatgptAccountId).toBe("acct_123");
  expect(metadata.planType).toBe("plus");
});

test("bad tokens produce token-safe unknown metadata", () => {
  const metadata = extractMetadata({ auth_mode: "chatgpt", tokens: { access_token: "bad-token" } });
  expect(metadata).toEqual({ email: "unknown", chatgptAccountId: "unknown", planType: "unknown" });
  expect(JSON.stringify(metadata)).not.toContain("bad-token");
});

test("read rejects snapshots without tokens", async () => {
  const root = await tempRoot();
  const authPath = path.join(root, "auth.json");
  await writeFile(authPath, JSON.stringify({ auth_mode: "chatgpt" }));
  await expect(readAuthSnapshot(authPath)).rejects.toThrow("auth snapshot does not contain tokens");
});

test("write auth snapshot sets private permissions", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  const authPath = path.join(paths.accountsDir, "main", "auth.json");
  await writeAuthSnapshot(authPath, fakeAuth("a@example.com", "acct_a"));
  expect((await stat(authPath)).mode & 0o777).toBe(0o600);
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
bun test tests/auth.test.ts
```

Expected: FAIL because `src/auth.ts` does not exist.

- [ ] **Step 4: Implement auth helpers**

Create `src/auth.ts`:

```ts
import { readFile } from "node:fs/promises";
import { atomicWriteJson } from "./registry.ts";

export class AuthSnapshotError extends Error {}

export type AuthSnapshot = Record<string, unknown> & {
  tokens: Record<string, unknown>;
};

export type AuthMetadata = {
  email: string;
  chatgptAccountId: string;
  planType: string;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf8");
    const value = JSON.parse(decoded) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function collectObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectObjects);
  if (!value || typeof value !== "object") return [];
  const objectValue = value as Record<string, unknown>;
  return [objectValue, ...Object.values(objectValue).flatMap(collectObjects)];
}

function collectTokenStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectTokenStrings);
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(collectTokenStrings);
}

function findFirst(objects: Record<string, unknown>[], keys: string[]): string {
  for (const key of keys) {
    for (const objectValue of objects) {
      const value = objectValue[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return "unknown";
}

export function validateAuthSnapshot(value: unknown): asserts value is AuthSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthSnapshotError("auth snapshot must be a JSON object");
  }
  const auth = value as Record<string, unknown>;
  if (auth.auth_mode !== undefined && auth.auth_mode !== "chatgpt") {
    throw new AuthSnapshotError("only ChatGPT auth snapshots are supported");
  }
  if (!auth.tokens || typeof auth.tokens !== "object" || Array.isArray(auth.tokens) || Object.keys(auth.tokens).length === 0) {
    throw new AuthSnapshotError("auth snapshot does not contain tokens");
  }
}

export async function readAuthSnapshot(authPath: string): Promise<AuthSnapshot> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(authPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AuthSnapshotError(`auth snapshot not found: ${authPath}`);
    }
    throw new AuthSnapshotError(`auth snapshot is invalid JSON: ${authPath}`);
  }
  validateAuthSnapshot(parsed);
  return parsed;
}

export async function writeAuthSnapshot(authPath: string, auth: unknown): Promise<void> {
  validateAuthSnapshot(auth);
  await atomicWriteJson(authPath, auth, 0o600);
}

export function extractMetadata(auth: unknown): AuthMetadata {
  if (!auth || typeof auth !== "object") {
    return { email: "unknown", chatgptAccountId: "unknown", planType: "unknown" };
  }
  const tokens = (auth as Record<string, unknown>).tokens;
  const payloads = collectTokenStrings(tokens).flatMap((token) => {
    const payload = decodeJwtPayload(token);
    return payload ? collectObjects(payload) : [];
  });
  return {
    email: findFirst(payloads, ["email", "preferred_username"]),
    chatgptAccountId: findFirst(payloads, ["chatgpt_account_id", "account_id", "sub"]),
    planType: findFirst(payloads, ["plan_type", "plan", "subscription_plan"])
  };
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/auth.test.ts
bun test
```

Expected: auth, registry, and smoke tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts tests/helpers.ts tests/auth.test.ts
git commit -m "feat: parse codex auth snapshots in typescript"
```

## Task 4: Account Commands

**Files:**
- Create: `src/commands.ts`
- Create: `tests/commands.test.ts`

- [ ] **Step 1: Write failing command tests**

Create `tests/commands.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/commands.test.ts
```

Expected: FAIL because `src/commands.ts` does not exist.

- [ ] **Step 3: Implement account commands**

Create `src/commands.ts`:

```ts
import { rm } from "node:fs/promises";
import path from "node:path";
import { AuthSnapshotError, extractMetadata, readAuthSnapshot, writeAuthSnapshot } from "./auth.ts";
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
    checkedAt: null,
    source: null,
    rawSnippet: "",
    state: "not_checked"
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
      notes: ""
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
  options: CommandOptions & { codexBin?: string; timeoutMs?: number } = {}
): Promise<AccountEntry> {
  const paths = options.paths ?? getPaths();
  const auth = await runDeviceLogin({ paths, codexBin: options.codexBin, timeoutMs: options.timeoutMs });
  return addSnapshot(name, auth, { paths });
}

export async function switchAccount(
  name: string,
  options: CommandOptions & { validator?: () => Promise<boolean> } = {}
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

export async function currentAccount(options: CommandOptions = {}): Promise<{ name: string | null; state: "managed" | "unmanaged" | "missing"; email: string }> {
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
    activeEmail: current.email
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

export async function refreshStatus(
  name: string | null,
  options: CommandOptions & { codexBin?: string; timeoutMs?: number } = {}
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
```

- [ ] **Step 4: Run tests**

Run:

```bash
bun test tests/commands.test.ts
bun test
```

Expected: command tests fail only if `src/codex.ts` is still missing. If that happens, create a temporary `src/codex.ts` shim:

```ts
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
    state: "not_checked"
  };
}
```

Then rerun:

```bash
bun test tests/commands.test.ts
bun test
```

Expected: command tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands.ts src/codex.ts tests/commands.test.ts
git commit -m "feat: manage codex auth snapshots in typescript"
```

## Task 5: Codex Subprocess Integration and Quota Parsing

**Files:**
- Modify: `src/codex.ts`
- Create: `tests/codex.test.ts`

- [ ] **Step 1: Write failing Codex tests**

Create `tests/codex.test.ts`:

```ts
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseStatusOutput, probeStatus, runDeviceLogin, validateLoginStatus } from "../src/codex.ts";
import { getPaths } from "../src/paths.ts";
import { fakeAuth, makeEnv, writeExecutable } from "./helpers.ts";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cxauth-codex-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("parse status output extracts weekly and five hour percentages", () => {
  const parsed = parseStatusOutput("model gpt-5.4 | 5h 18% | weekly 62% | context 71%");
  expect(parsed.state).toBe("ok");
  expect(parsed.weeklyLimit.display).toBe("62%");
  expect(parsed.weeklyLimit.value).toBe(62);
  expect(parsed.fiveHourLimit.display).toBe("18%");
});

test("parse status output accepts long limit labels and ANSI output", () => {
  const parsed = parseStatusOutput("\u001b[32mfive-hour-limit 7% weekly-limit 91%\u001b[0m");
  expect(parsed.state).toBe("ok");
  expect(parsed.weeklyLimit.display).toBe("91%");
  expect(parsed.fiveHourLimit.display).toBe("7%");
});

test("parse status output marks parse failed when no limits exist", () => {
  const parsed = parseStatusOutput("status window without limit values");
  expect(parsed.state).toBe("parse_failed");
  expect(parsed.weeklyLimit.display).toBe("unknown");
});

test("validate login status uses codex binary and CODEX_HOME", async () => {
  const root = await tempRoot();
  const fake = await writeExecutable(path.join(root, "codex"), `
const args = Bun.argv.slice(2);
if (args.join(" ") !== "login status") process.exit(2);
if (!process.env.CODEX_HOME?.endsWith("codex-home")) process.exit(3);
console.log("Logged in with ChatGPT");
`);
  const paths = getPaths(makeEnv(root));
  expect(await validateLoginStatus({ paths, codexBin: fake })).toBe(true);
});

test("run device login reads temporary auth json", async () => {
  const root = await tempRoot();
  const authJson = JSON.stringify(fakeAuth("new@example.com", "acct_new"));
  const fake = await writeExecutable(path.join(root, "codex"), `
const args = Bun.argv.slice(2);
if (args.join(" ") !== "login --device-auth") process.exit(2);
await Bun.write(process.env.CODEX_HOME + "/auth.json", ${JSON.stringify(authJson)});
console.log("device login complete");
`);
  const paths = getPaths(makeEnv(root));
  const auth = await runDeviceLogin({ paths, codexBin: fake, timeoutMs: 2_000 });
  expect((auth.tokens as Record<string, string>).id_token.split(".")).toHaveLength(3);
});

test("probe status parses output from fake PTY backend", async () => {
  const root = await tempRoot();
  const fakeScript = await writeExecutable(path.join(root, "script"), `
const args = Bun.argv.slice(2);
if (!args.some((arg) => arg.endsWith("codex"))) process.exit(2);
if (!args.includes("--no-alt-screen")) process.exit(3);
console.log("ready");
for await (const chunk of Bun.stdin.stream()) {
  const text = new TextDecoder().decode(chunk);
  if (text.includes("/status")) console.log("5h 11% weekly 44%");
  if (text.includes("/quit")) process.exit(0);
}
`);
  const fakeCodex = await writeExecutable(path.join(root, "codex"), `
console.log("fake codex should be wrapped by script");
`);
  const paths = getPaths(makeEnv(root));
  const authPath = path.join(root, "auth.json");
  await writeFile(authPath, JSON.stringify({ auth_mode: "chatgpt", tokens: { id_token: "a.b.c" } }));
  const result = await probeStatus(authPath, { paths, codexBin: fakeCodex, scriptBin: fakeScript, timeoutMs: 2_000 });
  expect(result.state).toBe("ok");
  expect(result.weeklyLimit.display).toBe("44%");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/codex.test.ts
```

Expected: FAIL if `src/codex.ts` is still the shim from Task 4.

- [ ] **Step 3: Implement Codex integration**

Replace `src/codex.ts` with:

```ts
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
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
  return input
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
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
    state: weeklyLimit.display !== "unknown" || fiveHourLimit.display !== "unknown" ? "ok" : "parse_failed"
  };
}

function envWithCodexHome(paths: Paths): Record<string, string> {
  return { ...process.env, CODEX_HOME: paths.codexHome } as Record<string, string>;
}

export async function validateLoginStatus(options: { paths: Paths; codexBin?: string }): Promise<boolean> {
  const proc = Bun.spawn([options.codexBin ?? "codex", "login", "status"], {
    env: envWithCodexHome(options.paths),
    stdout: "pipe",
    stderr: "pipe"
  });
  const exitCode = await proc.exited;
  return exitCode === 0;
}

export async function runDeviceLogin(options: { paths: Paths; codexBin?: string; timeoutMs?: number }): Promise<Awaited<ReturnType<typeof readAuthSnapshot>>> {
  await ensurePrivateDir(options.paths.tmpDir);
  const tempHome = await mkdtemp(path.join(options.paths.tmpDir, "login-"));
  try {
    await chmod(tempHome, 0o700);
    await writeFile(path.join(tempHome, "config.toml"), 'preferred_auth_method = "chatgpt"\n', { mode: 0o600 });
    const proc = Bun.spawn([options.codexBin ?? "codex", "login", "--device-auth"], {
      env: { ...process.env, CODEX_HOME: tempHome } as Record<string, string>,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit"
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

async function readWithTimeout(stream: ReadableStream<Uint8Array>, timeoutMs: number): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        reader.read(),
        Bun.sleep(remaining).then(() => ({ done: true, value: undefined }))
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
  options: { paths: Paths; codexBin?: string; scriptBin?: string; timeoutMs?: number }
): Promise<AccountStatus> {
  await readAuthSnapshot(authPath);
  await ensurePrivateDir(options.paths.tmpDir);
  const tempHome = await mkdtemp(path.join(options.paths.tmpDir, "probe-"));
  try {
    await chmod(tempHome, 0o700);
    await Bun.write(path.join(tempHome, "auth.json"), Bun.file(authPath));
    const proc = Bun.spawn([options.scriptBin ?? "script", "-q", "-t", "0", "/dev/null", options.codexBin ?? "codex", "--no-alt-screen"], {
      env: { ...process.env, CODEX_HOME: tempHome } as Record<string, string>,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });
    proc.stdin.write(new TextEncoder().encode("/status\n"));
    const [stdout, stderr] = await Promise.all([
      readWithTimeout(proc.stdout, options.timeoutMs ?? 20_000),
      readWithTimeout(proc.stderr, options.timeoutMs ?? 20_000)
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
      })
    ]);
    return parsed;
  } catch (error) {
    return {
      weeklyLimit: unknownLimit(),
      fiveHourLimit: unknownLimit(),
      checkedAt: nowIso(),
      source: "/status",
      rawSnippet: error instanceof Error ? error.message.slice(-2_000) : "",
      state: "timeout"
    };
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run Codex tests**

Run:

```bash
bun test tests/codex.test.ts
bun test
```

Expected: all Bun tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/codex.ts tests/codex.test.ts
git commit -m "feat: integrate codex subprocess probing in typescript"
```

## Task 6: CLI Commands and README

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing CLI tests**

Create `tests/cli.test.ts`:

```ts
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli.ts";
import { addSnapshot, switchAccount } from "../src/commands.ts";
import { getPaths } from "../src/paths.ts";
import { writeAuthSnapshot } from "../src/auth.ts";
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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/cli.test.ts
```

Expected: FAIL because `src/cli.ts` only supports `--version`.

- [ ] **Step 3: Implement CLI**

Replace `src/cli.ts` with:

```ts
#!/usr/bin/env bun

import { CommandError, addViaDeviceLogin, currentAccount, defaultSwitchValidator, listAccounts, refreshStatus, removeAccount, switchAccount } from "./commands.ts";
import { getPaths } from "./paths.ts";
import type { AccountEntry } from "./types.ts";

export const VERSION = "0.1.0";

function codexBin(): string {
  return process.env.CXAUTH_CODEX_BIN ?? "codex";
}

function usage(): string {
  return [
    "Usage:",
    "  cxauth add <name>",
    "  cxauth list",
    "  cxauth switch <name>",
    "  cxauth status [name] [--timeout <seconds>]",
    "  cxauth current",
    "  cxauth remove <name>"
  ].join("\n");
}

function limitDisplay(account: AccountEntry, key: "weeklyLimit" | "fiveHourLimit"): string {
  return account.status?.[key]?.display || "unknown";
}

function renderTable(data: { accounts: AccountEntry[]; activeName?: string | null; activeState?: string; activeEmail?: string }): string {
  const rows = [["NAME", "EMAIL", "PLAN", "ACTIVE", "WEEKLY", "5H", "LAST_CHECKED", "HEALTH"]];
  for (const account of data.accounts) {
    rows.push([
      account.name,
      account.email ?? "unknown",
      account.planType ?? "unknown",
      account.name === data.activeName ? "*" : "",
      limitDisplay(account, "weeklyLimit"),
      limitDisplay(account, "fiveHourLimit"),
      account.status?.checkedAt ?? "never",
      account.status?.state ?? "not_checked"
    ]);
  }
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => String(row[index]).length)));
  const lines = rows.map((row) => row.map((cell, index) => String(cell).padEnd(widths[index])).join("  ").trimEnd());
  if (data.activeState === "unmanaged") lines.push(`unmanaged global auth: ${data.activeEmail ?? "unknown"}`);
  if (data.activeState === "missing") lines.push("global auth missing");
  return lines.join("\n");
}

function parseTimeout(argv: string[]): { argv: string[]; timeoutMs: number } {
  const index = argv.indexOf("--timeout");
  if (index === -1) return { argv, timeoutMs: 20_000 };
  const seconds = Number(argv[index + 1]);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new CommandError("--timeout must be a positive number of seconds");
  return { argv: [...argv.slice(0, index), ...argv.slice(index + 2)], timeoutMs: seconds * 1000 };
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  if (argv.includes("--version")) {
    console.log(VERSION);
    return 0;
  }
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    console.log(usage());
    return 0;
  }

  const paths = getPaths();
  const bin = codexBin();
  try {
    if (command === "add") {
      const [name] = rest;
      if (!name) throw new CommandError("missing account name");
      const account = await addViaDeviceLogin(name, { paths, codexBin: bin });
      console.log(`added ${account.name} <${account.email}>`);
      return 0;
    }
    if (command === "list") {
      console.log(renderTable(await listAccounts({ paths })));
      return 0;
    }
    if (command === "switch") {
      const [name] = rest;
      if (!name) throw new CommandError("missing account name");
      const result = await switchAccount(name, { paths, validator: () => defaultSwitchValidator(paths, bin) });
      console.log(`switched to ${result.name} (${result.validated ? "validated" : "unverified"})`);
      return 0;
    }
    if (command === "status") {
      const parsed = parseTimeout(rest);
      const [name] = parsed.argv;
      const updated = await refreshStatus(name ?? null, { paths, codexBin: bin, timeoutMs: parsed.timeoutMs });
      const current = await currentAccount({ paths });
      console.log(renderTable({ accounts: updated, activeName: current.name }));
      return 0;
    }
    if (command === "current") {
      const current = await currentAccount({ paths });
      console.log(current.name ? `${current.name} <${current.email}>` : `${current.state} <${current.email}>`);
      return 0;
    }
    if (command === "remove") {
      const [name] = rest;
      if (!name) throw new CommandError("missing account name");
      const removed = await removeAccount(name, { paths });
      console.log(`removed ${removed.removed}`);
      return 0;
    }
    throw new CommandError(`unsupported command: ${command}`);
  } catch (error) {
    console.error(`cxauth: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
```

- [ ] **Step 4: Update README**

Replace `README.md` with:

```markdown
# cxauth

`cxauth` manages multiple ChatGPT-backed Codex auth snapshots on one machine.

## Install for local development

```bash
bun install
bun link --global
```

## Commands

```bash
cxauth add main
cxauth list
cxauth switch main
cxauth status
cxauth status main
cxauth current
cxauth remove backup
```

## What switching changes

`cxauth switch <name>` replaces the global Codex auth file at `~/.codex/auth.json`.
After switching, plain `codex` uses the selected account.

Before replacing the file, `cxauth` stores the previous auth at:

```text
~/.cxauth/backups/auth.json.bak
```

## Storage

`cxauth` stores its registry and saved account auth snapshots under:

```text
~/.cxauth/
```

These files contain sensitive tokens. Do not commit, paste, or share them.

## Quota status

`cxauth status` starts an isolated Codex session with the saved account snapshot,
sends `/status`, and parses values such as `weekly 62%` and `5h 18%`.

The Bun implementation uses the macOS `script` command as its first PTY backend.
Quota parsing is best-effort. If Codex changes the TUI output, switching still works
and status will show `parse_failed`, `timeout`, or `auth_expired`.

## Test

```bash
bun test
```
```

- [ ] **Step 5: Run CLI tests and all tests**

Run:

```bash
bun test tests/cli.test.ts
bun test
bun run src/cli.ts --version
```

Expected:

```text
0.1.0
```

All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli.test.ts README.md
git commit -m "feat: expose bun cxauth cli"
```

## Task 7: Final Verification and Global Entrypoint

**Files:**
- Modify only if needed: `.gitignore`

- [ ] **Step 1: Run full Bun test suite**

Run:

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Verify local CLI**

Run:

```bash
bun run src/cli.ts --version
```

Expected:

```text
0.1.0
```

- [ ] **Step 3: Check current global cxauth owner**

Run:

```bash
which cxauth
cxauth --version
```

Expected: `cxauth --version` prints `0.1.0`. If `which cxauth` points to the old Python editable install, remove it before Bun global verification:

```bash
python3 -m pip uninstall -y cxauth
```

- [ ] **Step 4: Link Bun package globally**

Run:

```bash
bun link --global
which cxauth
cxauth --version
```

Expected:

```text
0.1.0
```

`which cxauth` should point to Bun's global bin directory or a Bun-managed symlink.

- [ ] **Step 5: Dry-run list against isolated homes**

Run:

```bash
tmp_cx="$(mktemp -d)"
tmp_codex="$(mktemp -d)"
CXAUTH_HOME="$tmp_cx" CODEX_HOME="$tmp_codex" cxauth list
```

Expected:

```text
NAME  EMAIL  PLAN  ACTIVE  WEEKLY  5H  LAST_CHECKED  HEALTH
global auth missing
```

- [ ] **Step 6: Inspect worktree**

Run:

```bash
git status --short
```

Expected: only intentionally untracked local files such as `.agents/`, `.claude/`, and `skills-lock.json` remain.

- [ ] **Step 7: Commit final verification cleanup if needed**

If `.gitignore` or docs changed during verification:

```bash
git add .gitignore README.md
git commit -m "chore: finalize bun migration"
```

If no tracked files changed, do not create a commit.

## Manual Real-Account Verification

Run these only when the user explicitly wants to test real accounts, because they can launch login, replace global Codex auth, and probe quota:

```bash
cxauth add main
cxauth list
cxauth switch main
codex login status
cxauth status main --timeout 30
cxauth list
```

Expected:

- `cxauth add main` launches device login and stores `~/.cxauth/accounts/main/auth.json`.
- `cxauth switch main` replaces `~/.codex/auth.json`.
- `codex login status` succeeds for the selected account.
- `cxauth status main` updates quota fields when Codex exposes parseable status output.
- If status parsing fails, `cxauth list` shows `parse_failed`, `timeout`, or `auth_expired`, and switching remains usable.
