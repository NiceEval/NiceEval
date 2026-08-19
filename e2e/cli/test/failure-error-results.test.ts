// owner: docs/engineering/testing/e2e/cli.md#cli-failure-error-results
// rerun: pnpm e2e --repo cli -- --run test/failure-error-results.test.ts

import { only, type ExpEvent } from "@niceeval/testkit";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

interface JudgePrecheckWarning {
  event: "warning";
  code: string;
  experimentId?: string;
  evalId?: string;
  planned?: number;
  errored?: number;
}

// feature: 同一次公开 CLI 旅程中核对 failed / errored 的机器输出与人读详情。
test("failed 与 errored 在 NDJSON、JUnit 和退出码上保持可区分", async () => {
  await cliE2E.case(
    "failure-error-results",
    {
      artifacts: [
        { source: ".niceeval", target: ".niceeval", optional: true },
        { source: "junit", target: "junit" },
      ],
    },
    async ({ commands: { niceeval }, paths }) => {
      const root = paths.projectRoot;
      mkdirSync(join(root, "junit"), { recursive: true });

      const failed = await niceeval.run(
        ["exp", "deliberate-fail", "--rerun", "all", "--json", "--junit", "junit/failed.xml"],
      );
      expect(failed.exitCode, failed.diagnostic()).toBe(1);
      expect(failed.stderr).toBe("");
      expect(failed.stdout).not.toMatch(/[\x1b\x08]/);
      const failedEvents = failed.ndjson<ExpEvent>();
      expect(failedEvents).toContainEqual(expect.objectContaining({
        event: "eval",
        evalId: "deliberate-fail/broken",
        verdict: "failed",
        attempts: 1,
        passed: 0,
      }));
      expect(failedEvents).not.toContainEqual(expect.objectContaining({
        event: "eval",
        verdict: "errored",
      }));
      const failedEval = only(
        failedEvents,
        (event) => "event" in event && event.event === "eval" && event.evalId === "deliberate-fail/broken",
        failed.diagnostic(),
      );
      const failedReceipt = failed.expReceipt();
      expect(failedReceipt).toMatchObject({ completion: "completed" });
      const failedJunit = readFileSync(join(root, "junit", "failed.xml"), "utf8");
      expect(failedJunit).toContain("<failure");
      expect(failedJunit).not.toContain("<error");

      const shownFailedRun = await niceeval.run([
        "show",
        "--run",
        failedReceipt.runIds[0]!,
        "--record",
        ".niceeval/record",
      ]);
      expect(shownFailedRun.exitCode, shownFailedRun.diagnostic()).toBe(0);
      expect(shownFailedRun.stdout).toContain(failedEval.locator!);
      expect(shownFailedRun.stdout).toMatch(/deliberate-fail\/broken[\s\S]*?#1[\s\S]*?failed/u);

      const errored = await niceeval.run(
        ["exp", "deliberate-error", "--rerun", "all", "--json", "--junit", "junit/errored.xml"],
      );
      expect(errored.exitCode, errored.diagnostic()).toBe(1);
      expect(errored.stderr).toBe("");
      expect(errored.stdout).not.toMatch(/[\x1b\x08]/);
      expect(errored.stdout).not.toContain("[object Object]");
      const erroredEvents = errored.ndjson<ExpEvent>();
      expect(erroredEvents).toContainEqual(expect.objectContaining({
        event: "eval",
        evalId: "deliberate-error/crash",
        verdict: "errored",
        attempts: 1,
        passed: 0,
      }));
      expect(erroredEvents).not.toContainEqual(expect.objectContaining({
        event: "eval",
        verdict: "failed",
      }));
      const erroredEval = only(
        erroredEvents,
        (event) => "event" in event && event.event === "eval" && event.evalId === "deliberate-error/crash",
        errored.diagnostic(),
      );
      const erroredReceipt = errored.expReceipt();
      expect(erroredReceipt).toMatchObject({ completion: "completed" });
      expect(erroredReceipt.runIds).toHaveLength(1);
      expect(erroredEval.locator).toBeTruthy();
      const erroredJunit = readFileSync(join(root, "junit", "errored.xml"), "utf8");
      expect(erroredJunit).toContain("<error");
      expect(erroredJunit).not.toContain("<failure");

      const shownRun = await niceeval.run([
        "show",
        "--run",
        erroredReceipt.runIds[0]!,
        "--record",
        ".niceeval/record",
      ]);
      expect(shownRun.exitCode, shownRun.diagnostic()).toBe(0);
      expect(shownRun.stdout).toContain("Run results");
      expect(shownRun.stdout).toContain("Planned attempts");
      expect(shownRun.stdout).toContain(erroredEval.locator!);
      expect(shownRun.stdout).toContain("errored");
      expect(shownRun.stdout).not.toContain("Membership");

      const shownAttempt = await niceeval.run([
        "show",
        erroredEval.locator,
        "--record",
        ".niceeval/record",
      ]);
      expect(shownAttempt.exitCode, shownAttempt.diagnostic()).toBe(0);
      expect(shownAttempt.stdout).toContain("Attempt overview");
      expect(shownAttempt.stdout).toContain(erroredEval.locator!);
      expect(shownAttempt.stdout).toContain("errored");
      expect(shownAttempt.stdout).toContain("sandbox.prepare");
      expect(shownAttempt.stdout).toContain("code 17");
      expect(shownAttempt.stdout.replace(/\s+/gu, " ")).toContain(
        "deliberate pre-context sandbox prepare failure",
      );
      expect(shownAttempt.stdout).not.toContain("[object Object]");
    },
  );
});

// regression: Judge 预检失败曾只输出通用消息，无法定位受影响的用例和次数。
test("Attempt 创建前的 Judge 错误在 NDJSON 中保留用例身份与数量", async () => {
  await cliE2E.case(
    "judge-precheck-error",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      const result = await niceeval.run(
        ["exp", "judge-precheck-error", "--rerun", "all", "--json"],
        { env: { CLI_JUDGE_TEST_KEY: "fixture-key" } },
      );

      expect(result.exitCode, result.diagnostic()).toBe(1);
      const warnings = result.ndjson<JudgePrecheckWarning>().filter(
        (event) => event.event === "warning" && event.code === "judge-precheck-failed",
      );
      expect(warnings).toEqual([expect.objectContaining({
        experimentId: "judge-precheck-error",
        evalId: "judge-precheck/unreachable",
        planned: 2,
        errored: 2,
      })]);
      expect(result.expReceipt()).toMatchObject({ completion: "completed" });

      const human = await niceeval.run(
        ["exp", "judge-precheck-error", "--rerun", "all"],
        { env: { CLI_JUDGE_TEST_KEY: "fixture-key" } },
      );
      expect(human.exitCode, human.diagnostic()).toBe(1);
      expect(human.stdout).toContain("Judge precheck failed");
      expect(human.stdout).not.toContain("sandbox provisioning failed");
      expect(human.stdout).not.toContain("judge-precheck-failed");
    },
  );
});

// regression: Assertions writer 的具体原因曾使用与其它 CLI 运行错误不同的 `niceeval error:` 前缀。
test("Assertions document 无法发布时使用统一 error 前缀", async () => {
  await cliE2E.case(
    "assertions-document-error",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      const result = await niceeval.run([
        "exp",
        "assertions-document-error",
        "--rerun",
        "all",
      ]);

      expect(result.exitCode, result.diagnostic()).toBe(1);
      expect(result.stderr).toMatch(/^error: Assertions could not be saved/u);
      expect(result.stderr).not.toContain("niceeval error:");
      expect(result.stdout).not.toContain("niceeval error:");
    },
  );
});

// feature: Human 结束摘要按 Eval 类型展示 score 或 pass 主读数。
test("计分制与通过制 Human 结束摘要显示各自主读数", async () => {
  await cliE2E.case(
    "score-human-results",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      const scored = await niceeval.run(["exp", "deliberate-score", "--rerun", "all"]);
      expect(scored.exitCode, scored.diagnostic()).toBe(0);
      expect(scored.stderr).toBe("");
      expect(scored.stdout).not.toMatch(/[\x1b\x08]/);
      expect(scored.stdout).toContain("SCORED");
      expect(scored.stdout).toContain("RESULTS");
      expect(scored.stdout).toContain("deliberate-score/scored  2 score · 1/1 complete");
      expect(scored.stdout).toContain("1 scored · 0 skipped · 0 errored");
      expect(scored.stdout).not.toContain("1 passed · 0 failed");

      const passed = await niceeval.run(["exp", "normal", "greet", "--rerun", "all"]);
      expect(passed.exitCode, passed.diagnostic()).toBe(0);
      expect(passed.stderr).toBe("");
      expect(passed.stdout).toContain("PASSED");
      expect(passed.stdout).toContain("RESULTS");
      expect(passed.stdout).toContain("greet/hello  1/1 passed");
      expect(passed.stdout).not.toContain("SCORED");

      const freshForCarry = await niceeval.run(["exp", "normal", "greet", "--rerun", "all", "--json"]);
      expect(freshForCarry.exitCode, freshForCarry.diagnostic()).toBe(0);
      const freshForCarryEval = only(
        freshForCarry.ndjson<ExpEvent>(),
        (event) => "event" in event && event.event === "eval" && event.evalId === "greet/hello",
        freshForCarry.diagnostic(),
      );
      const carried = await niceeval.run(["exp", "normal", "greet", "--json"]);
      expect(carried.exitCode, carried.diagnostic()).toBe(0);
      const shownCarriedRun = await niceeval.run([
        "show",
        "--run",
        carried.expReceipt().runIds[0]!,
        "--record",
        ".niceeval/record",
      ]);
      expect(shownCarriedRun.exitCode, shownCarriedRun.diagnostic()).toBe(0);
      expect(shownCarriedRun.stdout.replace(/\s+/gu, " ")).toContain(
        `using result ${freshForCarryEval.locator}`,
      );
    },
  );
});
