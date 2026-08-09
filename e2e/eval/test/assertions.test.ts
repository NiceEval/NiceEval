// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-contract
// rerun: pnpm e2e --repo eval -- --run test/assertions.test.ts

import { join } from "node:path";
import { openRecord, resolveLocator } from "niceeval/record";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalProjectCopy, retainEvidence } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  status?: string;
  passed?: number;
  failed?: number;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

async function runOne(root: string, experiment: string, evalId: string): Promise<string> {
  const run = await niceeval.run(["exp", experiment, "--rerun", "all", "--json"], { cwd: root });
  expect(run.exitCode, run.diagnostic()).toBe(0);
  const result = only(run.ndjson<ExpEvent>(), (event) => event.event === "result", run.diagnostic());
  expect(result).toMatchObject({ event: "result", status: "passed", passed: 1, failed: 0 });
  return only(
    run.ndjson<ExpEvent>(),
    (event) => event.event === "eval" && event.evalId === evalId && event.locator !== undefined,
    run.diagnostic(),
  ).locator!;
}

test("值 matcher 与通过制 handle modifiers 在本轮确定性回复上折叠为 passed", async () => {
  await withProjectCopy(evalProjectCopy, async ({ root }) => {
    try {
      const locator = await runOne(root, "assertion-values", "assertion-values");
      const shown = await niceeval.run(["show", locator, "--record", ".niceeval", "--json"], { cwd: root });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("assertion-values-marker");

      const record = await openRecord(join(root, ".niceeval"));
      const attempt = resolveLocator(record, locator);
      expect(attempt.result.verdict).toBe("passed");
      expect(JSON.stringify(attempt.result.assertions)).toContain("two values");
    } finally {
      await retainEvidence(root, "values");
    }
  });
});

test("turn、session 与 attempt scope 都以同一批真实工具事件完成断言", async () => {
  await withProjectCopy(evalProjectCopy, async ({ root }) => {
    try {
      const locator = await runOne(root, "assertion-scopes", "assertion-scopes");
      const shown = await niceeval.run(["show", locator, "--record", ".niceeval", "--execution"], { cwd: root });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("scope_main_tool");
      expect(shown.stdout).toContain("scope_branch_tool");

      const record = await openRecord(join(root, ".niceeval"));
      const attempt = resolveLocator(record, locator);
      expect(attempt.result.verdict).toBe("passed");
      expect((await attempt.events())?.filter((event) => event.type === "operation.started")).toHaveLength(2);
    } finally {
      await retainEvidence(root, "scopes");
    }
  });
});

test("计分制 handle modifiers 与直接给分写入公开 Record", async () => {
  await withProjectCopy(evalProjectCopy, async ({ root }) => {
    try {
      const locator = await runOne(root, "assertion-score", "assertion-score");
      const record = await openRecord(join(root, ".niceeval"));
      const attempt = resolveLocator(record, locator);
      expect(attempt.result.verdict).toBe("passed");
      expect(attempt.result.evaluationKind).toBe("points");
      expect(attempt.result.scoreEntries).toContainEqual(
        expect.objectContaining({ label: "deterministic manual points", points: 4 }),
      );
    } finally {
      await retainEvidence(root, "score");
    }
  });
});

test("Sandbox 的真实文件与 shell evidence 由公开断言和 Record 判定", async () => {
  await withProjectCopy(evalProjectCopy, async ({ root }) => {
    try {
      const locator = await runOne(root, "assertion-sandbox", "assertion-sandbox");
      const shown = await niceeval.run(["show", locator, "--record", ".niceeval", "--execution"], { cwd: root });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("workspace_edit");

      const record = await openRecord(join(root, ".niceeval"));
      const attempt = resolveLocator(record, locator);
      expect(attempt.result.verdict).toBe("passed");
      const diff = await attempt.diff();
      expect(JSON.stringify(diff)).toContain("after-agent-change");
      expect(JSON.stringify(diff)).toContain("created-by-agent");
    } finally {
      await retainEvidence(root, "sandbox");
    }
  });
});

test("未配置 Judge 时 optional assertion 保留 unavailable 而不发起付费模型调用", async () => {
  await withProjectCopy(evalProjectCopy, async ({ root }) => {
    try {
      const locator = await runOne(root, "assertion-judge", "assertion-judge-unavailable");
      const record = await openRecord(join(root, ".niceeval"));
      const attempt = resolveLocator(record, locator);
      expect(attempt.result.verdict).toBe("passed");
      const assertions = JSON.stringify(attempt.result.assertions);
      expect(assertions).toContain("judge-model-unresolved");
      expect(assertions.match(/\"outcome\":\"unavailable\"/g)).toHaveLength(3);
    } finally {
      await retainEvidence(root, "judge-unavailable");
    }
  });
});
