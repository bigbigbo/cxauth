import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function makeEnv(root: string): Record<string, string> {
  return {
    CXAUTH_HOME: path.join(root, "cxauth-home"),
    CODEX_HOME: path.join(root, "codex-home"),
  };
}

export async function writeExecutable(filePath: string, body: string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `#!/usr/bin/env bun\n${body}`, "utf8");
  await chmod(filePath, 0o700);
  return filePath;
}

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
          plan_type: plan,
        },
      }),
      access_token: `access-${accountId}`,
      refresh_token: `refresh-${accountId}`,
      account_id: accountId,
    },
  };
}
