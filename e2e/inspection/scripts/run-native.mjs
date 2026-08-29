#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["exec", "vitest", "run", ...process.argv.slice(2)], {
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
