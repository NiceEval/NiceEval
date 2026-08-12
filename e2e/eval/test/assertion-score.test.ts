// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-score
// rerun: pnpm e2e --repo eval -- --run test/assertion-score.test.ts

import { join } from "node:path";
import {
  assertionsProjector,
  evaluationsProjector,
  scoreProjector,
  verdictProjector,
} from "niceeval/projection";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import {
  projectAttemptAttachment,
  projectAttemptOriginRunAttachment,
  singleAvailableAttemptAttachment,
} from "./record-reader.ts";
import { evalArtifactStaging, evalProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
  attempts?: number;
  passed?: number;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("计分 Eval 正常返回自动封口并把空计分写成零分", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-score", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const scoredEvent = only(
        run.ndjson<ExpEvent>(),
        (event) =>
          event.event === "eval" && event.evalId === "assertion-score/scored" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(scoredEvent).toMatchObject({
        event: "eval",
        evalId: "assertion-score/scored",
        verdict: "passed",
        attempts: 1,
      });
      const scoredLocator = scoredEvent.locator!;
      const emptyEvent = only(
        run.ndjson<ExpEvent>(),
        (event) =>
          event.event === "eval" && event.evalId === "assertion-score/empty" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(emptyEvent).toMatchObject({
        event: "eval",
        evalId: "assertion-score/empty",
        verdict: "passed",
        attempts: 1,
      });
      const emptyLocator = emptyEvent.locator!;

      const scoredVerdict = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator: scoredLocator, projector: verdictProjector }),
        "Verdict Attachment",
      );
      expect(scoredVerdict).toBe("passed");

      const scoredEvaluationsProjection = await projectAttemptOriginRunAttachment({
        root,
        locator: scoredLocator,
        projector: evaluationsProjector,
      });
      const scoredEvaluations = singleAvailableAttemptAttachment(
        scoredEvaluationsProjection,
        "Evaluations Attachment",
      );
      const scoredEvaluationEntry = scoredEvaluationsProjection.entries.find(
        (entry) => entry.state === "attachment-result",
      );
      if (scoredEvaluationEntry === undefined || scoredEvaluationEntry.state !== "attachment-result") {
        throw new Error("Scored Attempt did not resolve to its origin Run Evaluations Attachment");
      }
      expect(scoredEvaluations.evaluationForSlot(scoredEvaluationEntry.slot.slotId)).toEqual({ kind: "score" });

      const scoredAssertions = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator: scoredLocator, projector: assertionsProjector }),
      );
      expect(scoredAssertions.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          state: "available",
          entry: expect.objectContaining({
            display: expect.objectContaining({ label: "deterministic manual points" }),
            result: expect.objectContaining({
              state: "matched",
              score: { state: "earned", points: 4, earned: 4 },
            }),
          }),
        }),
      ]));
      const scoredScore = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator: scoredLocator, projector: scoreProjector }),
        "Score Attachment",
      );
      expect(scoredScore).toEqual({ state: "complete", earned: 10, comparable: true });

      const emptyVerdict = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator: emptyLocator, projector: verdictProjector }),
        "Verdict Attachment",
      );
      expect(emptyVerdict).toBe("passed");
      const emptyAssertions = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator: emptyLocator, projector: assertionsProjector }),
      );
      expect(emptyAssertions.entries).toEqual([]);
      const emptyScore = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator: emptyLocator, projector: scoreProjector }),
        "Score Attachment",
      );
      expect(emptyScore).toEqual({ state: "complete", earned: 0, comparable: true });
    },
    evalArtifactStaging("score"),
  );
});
