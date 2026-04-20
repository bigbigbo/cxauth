import { expect, test } from "bun:test";
import { main, VERSION } from "../src/cli.ts";

test("version exits successfully", async () => {
  expect(VERSION).toBe("0.1.0");
  expect(await main(["--version"])).toBe(0);
});
