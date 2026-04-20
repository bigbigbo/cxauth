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
