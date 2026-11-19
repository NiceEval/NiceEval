// rerun: pnpm e2e test --repo cli-docker -- --run test/failure-error-results.test.ts

import { only } from "@niceeval/testkit";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

// feature: 同一次公开 CLI 旅程中核对 failed / errored 的机器输出与人读详情。
// @feature docs/feature/experiments/README.md

test.concurrent("failed 与 errored 在 NDJSON、JUnit 和退出码上保持可区分", async () => {
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

      const failed = await niceeval.run([
        "exp",
        "deliberate-fail",
        "--rerun",
        "all",
        "--json",
        "--junit",
        "junit/failed.xml",
      ]);
      expect(failed.exitCode, failed.diagnostic()).toBe(1);
      expect(failed.stderr).toBe("");
      expect(failed.stdout).not.toMatch(/[\x1b\x08]/);
      const failedEvents = failed.expEvalEvents();
      expect(failedEvents).toContainEqual(
        expect.objectContaining({
          event: "eval",
          evalId: "deliberate-fail/broken",
          verdict: "failed",
          attempts: 1,
          passed: 0,
        }),
      );
      expect(failedEvents).not.toContainEqual(
        expect.objectContaining({
          event: "eval",
          verdict: "errored",
        }),
      );
      const failedEval = only(failedEvents, (event) => event.evalId === "deliberate-fail/broken", failed.diagnostic());
      const failedReceipt = failed.expReceipt();
      expect(failedReceipt).toMatchObject({ completion: "completed" });
      const failedJunit = readFileSync(join(root, "junit", "failed.xml"), "utf8");
      expect(failedJunit).toContain("<failure");
      expect(failedJunit).not.toContain("<error");

      const failedSummary = await niceeval.run(["show", `run:${failedReceipt.createdRunIds[0]!}`, "--json"]);
      expect(failedSummary.exitCode, failedSummary.diagnostic()).toBe(0);
      const failedDocument = failedSummary.run();
      expect(failedDocument).toMatchObject({ operation: "run.get", issues: [] });
      expect(failedDocument.run.denominator).toEqual({ expected: 1, published: 1, missing: 0 });
      expect(failedDocument.run.plannedAttempts).toEqual([
        expect.objectContaining({
          publication: expect.objectContaining({ state: "published", attemptLocator: failedEval.locator }),
          state: "executed",
          verdict: "failed",
        }),
      ]);

      const failedHuman = await niceeval.run(["exp", "deliberate-fail", "--rerun", "all"]);
      expect(failedHuman.exitCode, failedHuman.diagnostic()).toBe(1);
      expect(failedHuman.stderr).toBe("");
      expect(failedHuman.stdout).toContain("turn succeeded · expected completed · received failed");
      expect(failedHuman.stdout).toContain("reason deterministic agent reported a t");
      expect(failedHuman.stdout).not.toContain("error: failed");
      const failedHumanLocator = /✗ (@1[0-9A-HJKMNP-TV-Z]{12})/u.exec(failedHuman.stdout)?.[1];
      expect(failedHumanLocator, failedHuman.diagnostic()).toBeTruthy();
      expect(failedHuman.stdout).toContain(`details: niceeval show ${failedHumanLocator}`);
      const failedHumanRunId = /show: niceeval show run:([0-9a-f-]{36})/u.exec(failedHuman.stdout)?.[1];
      expect(failedHumanRunId, failedHuman.diagnostic()).toBeTruthy();
      expect(failedHuman.stdout.replace(/\s+/gu, " ")).toContain(
        `NEXT show: niceeval show run:${failedHumanRunId} view: niceeval view run:${failedHumanRunId}`,
      );

      const failedHumanSummary = await niceeval.run(["show", `run:${failedHumanRunId!}`, "--json"]);
      expect(failedHumanSummary.exitCode, failedHumanSummary.diagnostic()).toBe(0);
      expect(failedHumanSummary.run().run.plannedAttempts).toEqual([
        expect.objectContaining({
          publication: expect.objectContaining({ state: "published", attemptLocator: failedHumanLocator }),
          verdict: "failed",
        }),
      ]);

      const sessions = await niceeval.run(["invocation", "list", "--all"]);
      expect(sessions.exitCode, sessions.diagnostic()).toBe(0);
      expect(sessions.stdout).toContain(`deliberate-fail  niceeval show run:${failedHumanRunId}`);

      const errored = await niceeval.run([
        "exp",
        "deliberate-error",
        "--rerun",
        "all",
        "--json",
        "--junit",
        "junit/errored.xml",
      ]);
      expect(errored.exitCode, errored.diagnostic()).toBe(1);
      expect(errored.stderr).toBe("");
      expect(errored.stdout).not.toMatch(/[\x1b\x08]/);
      expect(errored.stdout).not.toContain("[object Object]");
      const erroredEvents = errored.expEvalEvents();
      expect(erroredEvents).toContainEqual(
        expect.objectContaining({
          event: "eval",
          evalId: "deliberate-error/crash",
          verdict: "errored",
          attempts: 1,
          passed: 0,
        }),
      );
      expect(erroredEvents).not.toContainEqual(
        expect.objectContaining({
          event: "eval",
          verdict: "failed",
        }),
      );
      const erroredEval = only(
        erroredEvents,
        (event) => event.evalId === "deliberate-error/crash",
        errored.diagnostic(),
      );
      const erroredReceipt = errored.expReceipt();
      expect(erroredReceipt).toMatchObject({ completion: "completed" });
      expect(erroredReceipt.createdRunIds).toHaveLength(1);
      expect(erroredEval.locator).toBeTruthy();
      const erroredJunit = readFileSync(join(root, "junit", "errored.xml"), "utf8");
      expect(erroredJunit).toContain("<error");
      expect(erroredJunit).not.toContain("<failure");

      const erroredSummary = await niceeval.run(["show", `run:${erroredReceipt.createdRunIds[0]!}`, "--json"]);
      expect(erroredSummary.exitCode, erroredSummary.diagnostic()).toBe(0);
      const erroredDocument = erroredSummary.run();
      expect(erroredDocument).toMatchObject({ operation: "run.get", issues: [] });
      expect(erroredDocument.run.denominator).toEqual({ expected: 1, published: 1, missing: 0 });
      expect(erroredDocument.run.plannedAttempts).toEqual([
        expect.objectContaining({
          publication: expect.objectContaining({ state: "published", attemptLocator: erroredEval.locator }),
          state: "executed",
          verdict: "errored",
        }),
      ]);

      const erroredAttempt = await niceeval.run(["show", erroredEval.locator!, "--json"]);
      expect(erroredAttempt.exitCode, erroredAttempt.diagnostic()).toBe(0);
      const attemptDocument = erroredAttempt.attempt();
      expect(attemptDocument).toMatchObject({
        operation: "attempt.get",
        issues: [],
        attempt: {
          locator: erroredEval.locator,
          core: { outcome: "errored" },
          verdict: "errored",
        },
      });

      const erroredTrace = await niceeval.run(["show", erroredEval.locator!, "execution", "--json"]);
      expect(erroredTrace.exitCode, erroredTrace.diagnostic()).toBe(0);
      const traceDocument = erroredTrace.attemptTrace();
      expect(traceDocument).toMatchObject({ operation: "attempt.trace", issues: [] });
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

      const erroredHuman = await niceeval.run(["exp", "deliberate-error", "--rerun", "all"]);
      expect(erroredHuman.exitCode, erroredHuman.diagnostic()).toBe(1);
      const erroredHumanLocator = /✗ (@1[0-9A-HJKMNP-TV-Z]{12})/u.exec(erroredHuman.stdout)?.[1];
      expect(erroredHumanLocator, erroredHuman.diagnostic()).toBeTruthy();
      expect(erroredHuman.stdout).toContain(`details: niceeval show ${erroredHumanLocator}`);
      expect(erroredHuman.stdout).not.toContain("details: niceeval view");
    },
  );
});
