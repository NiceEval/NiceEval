// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-score
// rerun: pnpm e2e test --repo eval -- --run test/assertion-score.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { inspectAssertionEntries, inspectAttempt, inspectRunSummary, type InspectionDocument } from "./inspection.ts";

interface RunSummaryDocument extends Omit<InspectionDocument, "operation"> {
  readonly operation: "run.get";
  readonly run: {
    readonly value: { readonly expectedSlots: readonly unknown[] };
    readonly members: readonly { readonly action: string }[];
    readonly attempts: readonly { readonly attemptId: string; readonly evalId: string }[];
  };
}

interface InspectedScoreEntry {
  readonly display: { readonly label?: string };
  readonly contribution:
    | { readonly state: "not-scored" }
    | { readonly state: "earned"; readonly points: number; readonly earned: number }
    | { readonly state: "unavailable"; readonly points: number; readonly reason: string };
}

interface AttemptDocument extends InspectionDocument {
  readonly operation: "attempt.get";
  readonly attempt: {
    readonly assertions: {
      readonly state: string;
      readonly entries: readonly { readonly entryId: string; readonly display: { readonly label?: string } }[];
    };
  };
}

interface AssertionDetailDocument extends InspectionDocument {
  readonly operation: "attempt.assertion.detail";
  readonly assertion: { readonly entryId: string; readonly entry: InspectedScoreEntry };
}

test("计分 Eval 公开区分 scored、stopped 与 skipped", async () => {
  await evalE2E.case(
    "score",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-score", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluations = run.expEvalEvents();
      const eventsFor = (evalId: string) => evaluations.filter((event) => event.evalId === evalId);
      const scoredEvents = eventsFor("assertion-score/scored");
      const emptyEvents = eventsFor("assertion-score/empty");
      const stoppedEvents = eventsFor("assertion-score/stopped");
      const skippedEvents = eventsFor("assertion-score/skipped");
      for (const [evalId, events, verdict] of [
        ["assertion-score/scored", scoredEvents, "passed"],
        ["assertion-score/empty", emptyEvents, "passed"],
        ["assertion-score/stopped", stoppedEvents, "passed"],
        ["assertion-score/skipped", skippedEvents, "skipped"],
      ] as const) {
        expect(events, `${evalId} must publish the first decisive Attempt under early exit`).toHaveLength(1);
        expect(events).toEqual(events.map((event) => expect.objectContaining({
          event: "eval",
          evalId,
          verdict,
          locator: expect.any(String),
        })));
      }
      expect(evaluations.filter((event) => event.verdict === "failed")).toEqual([]);
      const runId = only(run.expReceipt().createdRunIds, () => true, run.diagnostic());
      const summary = await inspectRunSummary<RunSummaryDocument>(niceeval, projectRoot, runId);
      expect(summary.receipt.exitCode, summary.receipt.diagnostic()).toBe(0);
      expect(summary.document).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "run.get",
        issues: [],
        run: { value: { expectedSlots: expect.any(Array) } },
      });
      expect(summary.document.run.value.expectedSlots).toHaveLength(8);
      expect(summary.document.run.members).toHaveLength(8);
      for (const evalId of [
        "assertion-score/scored",
        "assertion-score/empty",
        "assertion-score/stopped",
        "assertion-score/skipped",
      ] as const) {
        expect(summary.document.run.attempts.filter((attempt) => attempt.evalId === evalId)).toHaveLength(2);
      }

      const entriesByEval = new Map<string, (readonly InspectedScoreEntry[])[]>();
      for (const attempt of summary.document.run.attempts) {
        const locator = `@${attempt.attemptId}`;
        const inspected = await inspectAttempt<AttemptDocument>(niceeval, projectRoot, locator, "attempt.get");
        expect(inspected.receipt.exitCode, inspected.receipt.diagnostic()).toBe(0);
        expect(inspected.document.attempt.assertions.state).toBe("available");
        const details = await inspectAssertionEntries<AssertionDetailDocument>(
          niceeval,
          projectRoot,
          locator,
          inspected.document.attempt.assertions.entries,
        );
        const entries = details.map((detail) => {
          expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
          expect(detail.document.assertion.entryId).toBe(detail.entry.entryId);
          return detail.document.assertion.entry;
        });
        const attempts = entriesByEval.get(attempt.evalId) ?? [];
        attempts.push(entries);
        entriesByEval.set(attempt.evalId, attempts);
      }
      for (const evalId of [
        "assertion-score/scored",
        "assertion-score/empty",
        "assertion-score/stopped",
        "assertion-score/skipped",
      ]) {
        expect(entriesByEval.get(evalId), `${evalId} must expose both published Attempt assertion sets`).toHaveLength(2);
      }
      for (const entries of entriesByEval.get("assertion-score/scored") ?? []) {
        expect(entries).toHaveLength(5);
        expect(entries.map(({ contribution }) => contribution)).toEqual(expect.arrayContaining([
          { state: "earned", points: 1, earned: 1 },
          { state: "earned", points: 2, earned: 2 },
          { state: "earned", points: 3, earned: 3 },
          { state: "earned", points: 5, earned: 0 },
          { state: "earned", points: 4, earned: 4 },
        ]));
      }
      for (const entries of entriesByEval.get("assertion-score/empty") ?? []) {
        expect(entries).toEqual([]);
      }
      for (const entries of entriesByEval.get("assertion-score/stopped") ?? []) {
        expect(entries.map(({ contribution }) => contribution)).toEqual([
          { state: "earned", points: 2, earned: 2 },
          { state: "earned", points: 3, earned: 0 },
        ]);
      }
      for (const entries of entriesByEval.get("assertion-score/skipped") ?? []) {
        expect(entries.map(({ contribution }) => contribution)).toEqual([
          { state: "earned", points: 9, earned: 9 },
        ]);
      }
    },
  );
});
