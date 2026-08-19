// owner: docs/engineering/testing/e2e/cli.md#cli-failure-error-results
// rerun: pnpm e2e --repo cli -- --run test/failure-error-results.test.ts

import { only, type ExpEvent } from "@niceeval/testkit";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

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
      only(
        failedEvents,
        (event) => "event" in event && event.event === "eval" && event.evalId === "deliberate-fail/broken",
        failed.diagnostic(),
      );
      expect(failed.expReceipt()).toMatchObject({ completion: "completed" });
      const failedJunit = readFileSync(join(root, "junit", "failed.xml"), "utf8");
      expect(failedJunit).toContain("<failure");
      expect(failedJunit).not.toContain("<error");

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
      expect(shownRun.stdout).toContain("Run membership overview");
      expect(shownRun.stdout).toContain(erroredEval.locator!);
      expect(shownRun.stdout).toContain("errored");

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
    },
  );
});
