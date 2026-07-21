// Shared shell-command helper for this repo's scripts/evidence.ts and every
// scripts/verify-<domain>.ts module (docs/engineering/testing/e2e/verification.md
// 「执行 niceeval 命令」). Commands appear as shell-literal strings in the caller — exactly
// what a developer would type, safe to copy out and re-run by hand. This is the one place
// that owns spawnSync plumbing so domain scripts don't each reimplement it.

import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

/**
 * Runs `cmd` through the shell, asserts its exit code matches `expect`, and returns stdout.
 * `expect: "nonzero"` makes an expected-failure invocation (e.g. deliberate-fail) a first-class
 * case instead of an exception.
 */
export function sh(cmd: string, expect: number | "nonzero" = 0): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(
    ok,
    `${cmd}\nexited ${exit}, expected ${expect}. stderr tail:\n${res.stderr.slice(-2000)}\nstdout tail:\n${res.stdout.slice(-2000)}`,
  );
  return res.stdout;
}
