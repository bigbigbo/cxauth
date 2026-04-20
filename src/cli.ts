#!/usr/bin/env bun

import {
  CommandError,
  addViaDeviceLogin,
  currentAccount,
  defaultSwitchValidator,
  listAccounts,
  refreshStatus,
  removeAccount,
  switchAccount,
} from "./commands.ts";
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
    "  cxauth remove <name>",
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
      account.status?.state ?? "not_checked",
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
