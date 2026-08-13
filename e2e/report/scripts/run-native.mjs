#!/usr/bin/env node
// Native Vitest + Playwright entry for the 0.12 Report owner.
// No extra args: run both. A .browser.spec target starts Playwright only.
import { spawnSync } from "node:child_process";

const nativeArgs = process.argv.slice(2);
const isBrowserTarget = nativeArgs.some((arg) => /\.browser\.spec\.[cm]?[jt]sx?$/.test(arg));
const playwrightArgs = nativeArgs.flatMap((arg) => {
  if (arg === "--run") return [];
  if (arg === "-t") return ["--grep"];
  return [arg];
});
const commands =
  nativeArgs.length === 0
    ? [
        ["pnpm", "exec", "vitest", "run"],
        ["pnpm", "exec", "playwright", "test"],
      ]
    : isBrowserTarget
      ? [["pnpm", "exec", "playwright", "test", ...playwrightArgs]]
      : [["pnpm", "exec", "vitest", "run", ...nativeArgs]];

for (const [command, ...args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
