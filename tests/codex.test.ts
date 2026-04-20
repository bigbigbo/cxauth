import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseStatusOutput, parseUsagePayload, probeStatus, runDeviceLogin, validateLoginStatus } from "../src/codex.ts";
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

test("parse usage payload maps used percent to remaining quota", () => {
  const parsed = parseUsagePayload({
    plan_type: "pro",
    rate_limit: {
      primary_window: {
        used_percent: 18,
        limit_window_seconds: 18_000,
        reset_at: 1_765_000_000,
      },
      secondary_window: {
        used_percent: 62,
        limit_window_seconds: 604_800,
        reset_at: 1_765_604_800,
      },
    },
  });

  expect(parsed.state).toBe("ok");
  expect(parsed.source).toBe("chatgpt-usage");
  expect(parsed.fiveHourLimit.display).toBe("82%");
  expect(parsed.fiveHourLimit.value).toBe(82);
  expect(parsed.fiveHourLimit.raw).toContain("used=18%");
  expect(parsed.fiveHourLimit.raw).toContain("left=82%");
  expect(parsed.fiveHourLimit.raw).toContain("300m");
  expect(parsed.weeklyLimit.display).toBe("38%");
  expect(parsed.weeklyLimit.value).toBe(38);
  expect(parsed.weeklyLimit.raw).toContain("used=62%");
  expect(parsed.weeklyLimit.raw).toContain("left=38%");
  expect(parsed.weeklyLimit.raw).toContain("10080m");
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

test("probe status requests ChatGPT usage API with snapshot tokens", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  const authPath = path.join(root, "auth.json");
  await writeFile(authPath, JSON.stringify(fakeAuth("quota@example.com", "acct_quota")));

  let requestedUrl = "";
  let requestedHeaders = new Headers();
  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    return new Response(
      JSON.stringify({
        plan_type: "plus",
        rate_limit: {
          primary_window: { used_percent: 11, limit_window_seconds: 18_000, reset_at: 123 },
          secondary_window: { used_percent: 44, limit_window_seconds: 604_800, reset_at: 456 },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await probeStatus(authPath, { paths, fetchImpl, timeoutMs: 2_000 });
  expect(result.state).toBe("ok");
  expect(result.source).toBe("chatgpt-usage");
  expect(requestedUrl).toBe("https://chatgpt.com/backend-api/wham/usage");
  expect(requestedHeaders.get("authorization")).toBe("Bearer access-acct_quota");
  expect(requestedHeaders.get("chatgpt-account-id")).toBe("acct_quota");
  expect(result.weeklyLimit.display).toBe("56%");
  expect(result.fiveHourLimit.display).toBe("89%");
});

test("probe status maps unauthorized usage API response to auth expired", async () => {
  const root = await tempRoot();
  const paths = getPaths(makeEnv(root));
  const authPath = path.join(root, "auth.json");
  await writeFile(authPath, JSON.stringify(fakeAuth("expired@example.com", "acct_expired")));

  const fetchImpl: typeof fetch = async () => new Response("expired", { status: 401 });
  const result = await probeStatus(authPath, { paths, fetchImpl, timeoutMs: 2_000 });

  expect(result.state).toBe("auth_expired");
  expect(result.weeklyLimit.display).toBe("unknown");
  expect(result.rawSnippet).toContain("401");
});
