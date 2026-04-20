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
