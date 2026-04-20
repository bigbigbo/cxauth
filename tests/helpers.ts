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
