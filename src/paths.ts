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
    globalAuth: path.join(codexHome, "auth.json"),
  };
}
