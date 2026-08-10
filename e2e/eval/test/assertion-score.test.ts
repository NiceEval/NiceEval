// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-score
// rerun: pnpm e2e --repo eval -- --run test/assertion-score.test.ts

import { join } from "node:path";
import { openRecord, resolveLocator } from "niceeval/record";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalArtifactStaging, evalProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  status?: string;
  passed?: number;
  failed?: number;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("计分 Eval 正常返回自动封口并把空计分写成零分", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-score", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const result = only(run.ndjson<ExpEvent>(), (event) => event.event === "result", run.diagnostic());
      expect(result).toMatchObject({ event: "result", status: "passed", passed: 2, failed: 0 });
      const scoredLocator = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-score/scored" && event.locator !== undefined,
        run.diagnostic(),
      ).locator!;
      const emptyLocator = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-score/empty" && event.locator !== undefined,
        run.diagnostic(),
      ).locator!;

      const record = await openRecord(join(root, ".niceeval"));
      const scoredAttempt = resolveLocator(record, scoredLocator);
      expect(scoredAttempt.result.verdict).toBe("passed");
      expect(scoredAttempt.result.evaluationKind).toBe("score");
      expect(scoredAttempt.result.evaluationAlgorithm).toBe("fact-use/v2");
      expect(scoredAttempt.result.factUses).toContainEqual(
        expect.objectContaining({
          useKind: "score",
          label: "deterministic manual points",
          input: { kind: "direct", earned: 4 },
          outcome: "scored",
          earned: 4,
        }),
      );
      expect(scoredAttempt.result.scoreResult).toEqual({
        status: "scored",
        earnedScore: 10,
        creditedScore: 10,
      });

      const emptyAttempt = resolveLocator(record, emptyLocator);
      expect(emptyAttempt.result.verdict).toBe("passed");
      expect(emptyAttempt.result.factResults).toEqual([]);
      expect(emptyAttempt.result.factUses).toEqual([]);
      expect(emptyAttempt.result.scoreResult).toEqual({
        status: "scored",
        earnedScore: 0,
        creditedScore: 0,
      });
    },
    evalArtifactStaging("score"),
  );
});
