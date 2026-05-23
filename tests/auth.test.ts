import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractMetadata, normalizeAuthSnapshot, readAuthSnapshot, writeAuthSnapshot } from "../src/auth.ts";
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
          plan_type: "plus",
        },
      }),
    },
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

test("normalizeAuthSnapshot passes through wrapped format", () => {
  const auth = fakeAuth("user@example.com", "acct_123");
  const result = normalizeAuthSnapshot(auth);
  expect(result.tokens).toBeDefined();
  expect((result.tokens as Record<string, unknown>).id_token).toBe((auth as Record<string, unknown>).tokens.id_token);
});

test("normalizeAuthSnapshot wraps flat token format", () => {
  const flat = {
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
  const result = normalizeAuthSnapshot(flat);
  expect(result.auth_mode).toBe("chatgpt");
  expect((result.tokens as Record<string, unknown>).id_token).toBe(flat.id_token);
  expect((result.tokens as Record<string, unknown>).access_token).toBe("access-flat");
  expect((result.tokens as Record<string, unknown>).account_id).toBe("acct_flat");
  expect(result.email).toBe("flat@example.com");
  expect(result.type).toBe("codex");
});

test("normalizeAuthSnapshot rejects object without tokens", () => {
  expect(() => normalizeAuthSnapshot({ foo: "bar" })).toThrow("auth snapshot does not contain tokens");
});
