// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-sandbox
// regression: memory/workspace-diff-path-cap-skips-partial-capture.md
// rerun: pnpm e2e test --repo eval -- --run test/assertion-sandbox.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { inspectAssertion, inspectAttempt, type InspectionDocument } from "./inspection.ts";

interface DiffDocument extends InspectionDocument {
  readonly operation: "attempt.diff";
  readonly diff: {
    readonly state: "complete" | "partial";
    readonly limitations: readonly {
      readonly code: string;
      readonly target?: string;
      readonly omittedAtLeast?: number;
    }[];
    readonly windows: readonly { readonly changes: readonly unknown[] }[];
  };
}

interface AttemptDocument extends InspectionDocument {
  readonly operation: "attempt.get";
  readonly attempt: {
    readonly assertions: {
      readonly state: string;
      readonly entries: readonly {
        readonly entryId: string;
        readonly display: { readonly label?: string };
      }[];
    };
  };
}

interface AssertionDetailDocument extends InspectionDocument {
  readonly operation: "attempt.assertion.detail";
  readonly assertion: {
    readonly entryId: string;
    readonly check: { readonly state: string };
  };
}

test("Sandbox Assertion Eval 以 passed 终态完成", async () => {
  await evalE2E.case(
    "sandbox",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-sandbox", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluations = run.expEvalEvents();
      const evaluation = only(
        evaluations,
        (event) => event.evalId === "assertion-sandbox",
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-sandbox",
        verdict: "passed",
      });
      expect(`${run.stdout}\n${run.stderr}`).not.toContain("workspace-diff-unavailable");
      const bulkEvaluation = only(
        evaluations,
        (event) => event.evalId === "workspace-diff-cap",
        run.diagnostic(),
      );
      expect(bulkEvaluation).toMatchObject({ verdict: "passed" });
      const diff = await inspectAttempt<DiffDocument>(niceeval, projectRoot, bulkEvaluation.locator, "attempt.diff");
      expect(diff.receipt.exitCode, diff.receipt.diagnostic()).toBe(0);
      expect(diff.document).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.diff",
        issues: [],
        diff: { state: "partial" },
      });
      expect(diff.document.diff.windows.flatMap((window) => window.changes)).toHaveLength(1_000);
      const collectionCap = only(
        diff.document.diff.limitations,
        (limitation) => limitation.code === "collection-cap-reached",
        diff.receipt.diagnostic(),
      );
      expect(collectionCap).toMatchObject({
        code: "collection-cap-reached",
        target: "change",
        omittedAtLeast: 29_001,
      });
      const attempt = await inspectAttempt<AttemptDocument>(niceeval, projectRoot, bulkEvaluation.locator, "attempt.get");
      expect(attempt.receipt.exitCode, attempt.receipt.diagnostic()).toBe(0);
      expect(attempt.document.attempt.assertions.state).toBe("available");
      const lastWitness = only(
        attempt.document.attempt.assertions.entries,
        (entry) => entry.display.label === "last diff change remains a decisive witness",
        attempt.receipt.diagnostic(),
      );
      const assertionDetail = await inspectAssertion<AssertionDetailDocument>(
        niceeval,
        projectRoot,
        bulkEvaluation.locator,
        lastWitness.entryId,
      );
      expect(assertionDetail.receipt.exitCode, assertionDetail.receipt.diagnostic()).toBe(0);
      expect(assertionDetail.document).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.assertion.detail",
        issues: [],
        assertion: { entryId: lastWitness.entryId, check: { state: "matched" } },
      });
      const assertionJson = JSON.stringify(attempt.document.attempt.assertions.entries);
      expect(Buffer.byteLength(assertionJson), attempt.receipt.diagnostic()).toBeLessThan(256 * 1024);
      expect(assertionJson).not.toContain("bulk/29999.txt");
      const timing = await inspectAttempt<InspectionDocument>(niceeval, projectRoot, bulkEvaluation.locator, "attempt.timing");
      expect(timing.receipt.exitCode, timing.receipt.diagnostic()).toBe(0);
      const timingDocument = timing.receipt.attemptTiming();
      expect(timingDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.timing",
        issues: [],
        timing: { state: "complete" },
      });
      const workspaceDiffInterval = only(
        timingDocument.timing.activities,
        (activity) => activity.phase === "attempt.teardown" && activity.label === "workspace.diff",
        timing.receipt.diagnostic(),
      );
      expect(workspaceDiffInterval.durationMs, timing.receipt.diagnostic()).toBeLessThanOrEqual(9_000);
    },
  );
});
