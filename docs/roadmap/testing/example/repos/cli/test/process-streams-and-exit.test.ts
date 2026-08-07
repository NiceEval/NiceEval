import { rmSync } from "node:fs";
import { command } from "@niceeval/testkit";
import { beforeEach, expect, test } from "vitest";

// NiceEval 根目录：pnpm e2e --repo cli -- --run test/process-streams-and-exit.test.ts
// 已安装候选包的隔离 Repo 根：pnpm test --run test/process-streams-and-exit.test.ts

interface ExpEvent {
  event: string;
  status?: string;
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);

beforeEach(() => rmSync(".niceeval", { recursive: true, force: true }));

test("JSON 模式保持 stdout、stderr 与 exit code 的公开分工", async () => {
  const passed = await niceeval.run(["exp", "passing", "--rerun", "all", "--json"]);
  expect(passed.exitCode, passed.diagnostic()).toBe(0);
  expect(passed.stderr).toBe("");
  expect(passed.ndjson<ExpEvent>().at(-1))
    .toMatchObject({ event: "result", status: "passed" });

  const failed = await niceeval.run(["exp", "failing", "--rerun", "all", "--json"]);
  expect(failed.exitCode, failed.diagnostic()).toBe(1);
  expect(failed.stderr).toBe("");
  expect(failed.ndjson<ExpEvent>().at(-1))
    .toMatchObject({ event: "result", status: "failed" });

  const usageError = await niceeval.run(["show", "missing-eval", "--json"]);
  expect(usageError.exitCode, usageError.diagnostic()).not.toBe(0);
  expect(usageError.stdout).toBe("");
  expect(usageError.stderr).toContain("No results matched");
});
