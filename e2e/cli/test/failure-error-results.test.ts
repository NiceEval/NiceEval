// owner: docs/engineering/testing/e2e/cli.md#cli-failure-error-results
// rerun: pnpm e2e test --repo cli -- --run test/failure-error-results.test.ts

import { only } from "@niceeval/testkit";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E, writeInspectionRequest } from "./context.ts";

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
      const failedEvents = failed.expEvalEvents();
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
        (event) => event.evalId === "deliberate-fail/broken",
        failed.diagnostic(),
      );
      const failedReceipt = failed.expReceipt();
      expect(failedReceipt).toMatchObject({ completion: "completed" });
      const failedJunit = readFileSync(join(root, "junit", "failed.xml"), "utf8");
      expect(failedJunit).toContain("<failure");
      expect(failedJunit).not.toContain("<error");
      const failedRequest = await writeInspectionRequest(root, "failed-run-summary", {
        kind: "run.summary", runId: failedReceipt.runIds[0]!,
      });
      const failedSummary = await niceeval.run(["query", "run", "--request", failedRequest]);
      expect(failedSummary.exitCode, failedSummary.diagnostic()).toBe(0);
      const failedDocument = failedSummary.runSummary();
      expect(failedDocument).toMatchObject({ protocol: "niceeval.query/v1", operation: "run.summary", issues: [] });
      expect(failedDocument.summary.denominator).toEqual({ expected: 1, observed: 1 });
      expect(failedDocument.summary.members).toEqual([expect.objectContaining({
        locator: failedEval.locator,
        state: "executed",
        verdict: "failed",
      })]);

      const failedHuman = await niceeval.run([
        "exp",
        "deliberate-fail",
        "--rerun",
        "all",
      ]);
      expect(failedHuman.exitCode, failedHuman.diagnostic()).toBe(1);
      expect(failedHuman.stderr).toBe("");
      expect(failedHuman.stdout).toContain("turn succeeded · expected completed · received failed");
      expect(failedHuman.stdout).toContain("reason deterministic agent reported a t");
      expect(failedHuman.stdout).not.toContain("error: failed");

      const errored = await niceeval.run(
        ["exp", "deliberate-error", "--rerun", "all", "--json", "--junit", "junit/errored.xml"],
      );
      expect(errored.exitCode, errored.diagnostic()).toBe(1);
      expect(errored.stderr).toBe("");
      expect(errored.stdout).not.toMatch(/[\x1b\x08]/);
      expect(errored.stdout).not.toContain("[object Object]");
      const erroredEvents = errored.expEvalEvents();
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
        (event) => event.evalId === "deliberate-error/crash",
        errored.diagnostic(),
      );
      const erroredReceipt = errored.expReceipt();
      expect(erroredReceipt).toMatchObject({ completion: "completed" });
      expect(erroredReceipt.runIds).toHaveLength(1);
      expect(erroredEval.locator).toBeTruthy();
      const erroredJunit = readFileSync(join(root, "junit", "errored.xml"), "utf8");
      expect(erroredJunit).toContain("<error");
      expect(erroredJunit).not.toContain("<failure");

      const erroredSummaryRequest = await writeInspectionRequest(root, "errored-run-summary", {
        kind: "run.summary", runId: erroredReceipt.runIds[0]!,
      });
      const erroredSummary = await niceeval.run(["query", "run", "--request", erroredSummaryRequest]);
      expect(erroredSummary.exitCode, erroredSummary.diagnostic()).toBe(0);
      const erroredDocument = erroredSummary.runSummary();
      expect(erroredDocument).toMatchObject({ protocol: "niceeval.query/v1", operation: "run.summary", issues: [] });
      expect(erroredDocument.summary.denominator).toEqual({ expected: 1, observed: 1 });
      expect(erroredDocument.summary.members).toEqual([expect.objectContaining({
        locator: erroredEval.locator,
        state: "executed",
        verdict: "errored",
      })]);

      const erroredAttemptRequest = await writeInspectionRequest(root, "errored-attempt", {
        kind: "attempt.get", locator: erroredEval.locator!,
      });
      const erroredAttempt = await niceeval.run(["query", "run", "--request", erroredAttemptRequest]);
      expect(erroredAttempt.exitCode, erroredAttempt.diagnostic()).toBe(0);
      const attemptDocument = erroredAttempt.attempt();
      expect(attemptDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.get",
        issues: [],
        attempt: {
          locator: erroredEval.locator,
          core: { outcome: "errored" },
          verdict: "errored",
        },
      });

      const erroredTraceRequest = await writeInspectionRequest(root, "errored-trace", {
        kind: "attempt.trace", locator: erroredEval.locator!,
      });
      const erroredTrace = await niceeval.run(["query", "run", "--request", erroredTraceRequest]);
      expect(erroredTrace.exitCode, erroredTrace.diagnostic()).toBe(0);
      const traceDocument = erroredTrace.attemptTrace();
      expect(traceDocument).toMatchObject({
        protocol: "niceeval.query/v1", operation: "attempt.trace", issues: [],
      });
      const prepareCommand = only(
        traceDocument.trace.commands.items,
        (item) => item.phase === "sandbox.prepare",
        erroredTrace.diagnostic(),
      );
      expect(prepareCommand.outcome).toEqual({ kind: "exited", exitCode: 17 });
      const prepareDiagnostic = only(
        traceDocument.trace.diagnostics.items,
        (item) => item.phase === "sandbox.prepare",
        erroredTrace.diagnostic(),
      );
      expect(prepareDiagnostic.summary).toContain("deliberate pre-context sandbox before failure");
      expect(JSON.stringify(traceDocument.trace)).not.toContain("[object Object]");
    },
  );
});

// regression: Judge 预检失败曾只输出通用消息，无法定位受影响的用例和次数。
test("Attempt 创建前的 Judge 错误在 NDJSON 中保留用例身份与数量", async () => {
  await cliE2E.case(
    "judge-precheck-error",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
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
    async ({ commands: { niceeval }, paths }) => {
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
        freshForCarry.expEvalEvents(),
        (event) => event.evalId === "greet/hello",
        freshForCarry.diagnostic(),
      );
      const carried = await niceeval.run(["exp", "normal", "greet", "--json"]);
      expect(carried.exitCode, carried.diagnostic()).toBe(0);
      const carriedRequest = await writeInspectionRequest(paths.projectRoot, "carried-run-summary", {
        kind: "run.summary", runId: carried.expReceipt().runIds[0]!,
      });
      const carriedSummary = await niceeval.run(["query", "run", "--request", carriedRequest]);
      expect(carriedSummary.exitCode, carriedSummary.diagnostic()).toBe(0);
      expect(carriedSummary.runSummary().summary.members).toEqual([expect.objectContaining({
        locator: freshForCarryEval.locator,
        state: "carried",
        verdict: "passed",
      })]);
    },
  );
});
