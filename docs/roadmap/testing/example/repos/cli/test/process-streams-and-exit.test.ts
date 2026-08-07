import { rmSync } from "node:fs";
import { beforeEach, expect, test } from "vitest";
import { parseNdjson, runProcess } from "./support/process.ts";

// NiceEval 根目录：pnpm e2e --repo cli -- --run test/process-streams-and-exit.test.ts
// 已安装候选包的隔离 Repo 根：pnpm test --run test/process-streams-and-exit.test.ts

interface ExpEvent {
  event: string;
  status?: string;
}

beforeEach(() => rmSync(".niceeval", { recursive: true, force: true }));

test("JSON 模式保持 stdout、stderr 与 exit code 的公开分工", async () => {
  const passed = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "passing", "--rerun", "all", "--json",
  ]);
  expect(passed.exitCode, passed.diagnostic()).toBe(0);
  expect(passed.stderr).toBe("");
  expect(parseNdjson<ExpEvent>(passed.stdout, passed.diagnostic()).at(-1))
    .toMatchObject({ event: "result", status: "passed" });

  const failed = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "failing", "--rerun", "all", "--json",
  ]);
  expect(failed.exitCode, failed.diagnostic()).toBe(1);
  expect(failed.stderr).toBe("");
  expect(parseNdjson<ExpEvent>(failed.stdout, failed.diagnostic()).at(-1))
    .toMatchObject({ event: "result", status: "failed" });

  const usageError = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "missing-eval", "--json",
  ]);
  expect(usageError.exitCode, usageError.diagnostic()).not.toBe(0);
  expect(usageError.stdout).toBe("");
  expect(usageError.stderr).toContain("No results matched");
});
