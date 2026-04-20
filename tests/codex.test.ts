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
  const fake = await writeExecutable(
    path.join(root, "codex"),
    `
const args = Bun.argv.slice(2);
if (args.join(" ") !== "login status") process.exit(2);
if (!process.env.CODEX_HOME?.endsWith("codex-home")) process.exit(3);
console.log("Logged in with ChatGPT");
`,
  );
  const paths = getPaths(makeEnv(root));
  expect(await validateLoginStatus({ paths, codexBin: fake })).toBe(true);
});

test("run device login reads temporary auth json", async () => {
  const root = await tempRoot();
  const authJson = JSON.stringify(fakeAuth("new@example.com", "acct_new"));
  const fake = await writeExecutable(
    path.join(root, "codex"),
    `
const args = Bun.argv.slice(2);
if (args.join(" ") !== "login --device-auth") process.exit(2);
await Bun.write(process.env.CODEX_HOME + "/auth.json", ${JSON.stringify(authJson)});
console.log("device login complete");
`,
  );
  const paths = getPaths(makeEnv(root));
  const auth = await runDeviceLogin({ paths, codexBin: fake, timeoutMs: 2_000 });
  expect((auth.tokens as Record<string, string>).id_token.split(".")).toHaveLength(3);
});

test("probe status parses output from fake PTY backend", async () => {
  const root = await tempRoot();
  const fakeScript = await writeExecutable(
    path.join(root, "script"),
    `
const args = Bun.argv.slice(2);
if (!args.some((arg) => arg.endsWith("codex"))) process.exit(2);
if (!args.includes("--no-alt-screen")) process.exit(3);
console.log("ready");
for await (const chunk of Bun.stdin.stream()) {
  const text = new TextDecoder().decode(chunk);
  if (text.includes("/status")) console.log("5h 11% weekly 44%");
  if (text.includes("/quit")) process.exit(0);
}
`,
  );
  const fakeCodex = await writeExecutable(
    path.join(root, "codex"),
    `
console.log("fake codex should be wrapped by script");
`,
  );
  const paths = getPaths(makeEnv(root));
  const authPath = path.join(root, "auth.json");
  await writeFile(authPath, JSON.stringify({ auth_mode: "chatgpt", tokens: { id_token: "a.b.c" } }));
  const result = await probeStatus(authPath, { paths, codexBin: fakeCodex, scriptBin: fakeScript, timeoutMs: 2_000 });
  expect(result.state).toBe("ok");
  expect(result.weeklyLimit.display).toBe("44%");
});
