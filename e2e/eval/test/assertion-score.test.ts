// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-score
// rerun: pnpm e2e --repo eval -- --run test/assertion-score.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
}

interface LeaderboardShow {
  schema: "niceeval.show/v1";
  selection: { kind: "project-current"; sampleIdentity: string };
  data: {
    kind: "leaderboard";
    rows: readonly {
      experiment: string;
      passRate: null;
      totalScore: number;
    }[];
  };
}

test("计分 Eval 公开区分 scored、stopped 与 skipped", async () => {
  await evalE2E.case(
    "score",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-score", "--rerun", "all", "--json"]);
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
      });
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
      });
      const stoppedEvent = only(
        run.ndjson<ExpEvent>(),
        (event) =>
          event.event === "eval" && event.evalId === "assertion-score/stopped" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(stoppedEvent).toMatchObject({
        event: "eval",
        evalId: "assertion-score/stopped",
        verdict: "passed",
      });
      const skippedEvent = only(
        run.ndjson<ExpEvent>(),
        (event) =>
          event.event === "eval" && event.evalId === "assertion-score/skipped" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(skippedEvent).toMatchObject({
        event: "eval",
        evalId: "assertion-score/skipped",
        verdict: "skipped",
      });
      const shown = await niceeval.run(["show", "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(run.ndjson<ExpEvent>().filter((event) => event.verdict === "failed")).toEqual([]);
      const document = shown.json<LeaderboardShow>();
      expect(document).toMatchObject({
        schema: "niceeval.show/v1",
        selection: { kind: "project-current" },
        data: {
          kind: "leaderboard",
          rows: [{
            experiment: "assertion-score",
            passRate: null,
          }],
        },
      });
      const [row] = document.data.rows;
      expect(row).toBeDefined();
      expect(row!.totalScore).toEqual(expect.any(Number));
    },
  );
});
