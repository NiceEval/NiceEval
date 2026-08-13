// owner: docs/engineering/testing/e2e/report.md#report-project-current
// regression: 052b13bb (design: memory/current-result-single-state-ruling.md)
// rerun: pnpm e2e --repo report -- --run test/report-project-current.test.ts

import { only } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";
import { assertPublicShowJson } from "./support/show-json.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  verdict?: string;
  reused?: number;
}

interface ShowLeaderboard {
  format: "niceeval.show";
  schemaVersion: 1;
  view: "leaderboard";
  sample: {
    resultsRoot: string;
    experiments: string[];
    fresh: boolean;
  };
  data: {
    experiments: readonly {
      experimentId: string;
      passRate: number | null;
      costUSD: number | null;
      evals: number;
    }[];
    passRate: number | null;
    evals: number;
    attempts: number;
  };
}

test("项目未变时复用结果，Eval 源码变化后重新执行并读回新结果", async () => {
  await reportE2E.case(
    "project-current",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const initialRun = await niceeval.run(["exp", "source", "--rerun", "all", "--json"]);
      expect(initialRun.exitCode, initialRun.diagnostic()).toBe(0);
      expect(initialRun.expReceipt()).toMatchObject({ completion: "completed" });
      expect(
        only(
          initialRun.ndjson<ExpEvent>(),
          (event) => event.event === "eval" && event.evalId === "source-snapshot",
          initialRun.diagnostic(),
        ),
      ).toMatchObject({ event: "eval", evalId: "source-snapshot", verdict: "passed" });
      const initialRunId = only(
        initialRun.expReceipt().runIds,
        () => true,
        initialRun.diagnostic(),
      );

      const initialShow = await niceeval.run(["show", "--json"]);
      expect(initialShow.exitCode, initialShow.diagnostic()).toBe(0);
      const initialDocument = assertPublicShowJson(initialShow.json());
      expect(initialDocument.view).toBe("leaderboard");
      expect(initialDocument.sample.experiments).toEqual(["source"]);
      expect(initialDocument.data).toMatchObject({
        experiments: [{ experimentId: "source", evals: 1 }],
        evals: 1,
        attempts: 1,
      });

      const unchangedRun = await niceeval.run(["exp", "source", "--json"]);
      expect(unchangedRun.exitCode, unchangedRun.diagnostic()).toBe(0);
      expect(unchangedRun.expReceipt()).toMatchObject({ completion: "completed" });
      expect(
        only(
          unchangedRun.ndjson<ExpEvent>(),
          (event) => event.event === "start",
          unchangedRun.diagnostic(),
        ),
      ).toMatchObject({ event: "start", reused: 1 });
      const unchangedRunId = only(
        unchangedRun.expReceipt().runIds,
        () => true,
        unchangedRun.diagnostic(),
      );

      const accumulatedShow = await niceeval.run(["show", "--json"]);
      expect(accumulatedShow.exitCode, accumulatedShow.diagnostic()).toBe(0);
      const accumulatedDocument = assertPublicShowJson(accumulatedShow.json());
      expect(accumulatedDocument.view).toBe("leaderboard");
      expect(accumulatedDocument.sample.experiments).toEqual(["source"]);
      expect(accumulatedDocument.data).toMatchObject({
        experiments: [{ experimentId: "source", evals: 1 }],
        evals: 1,
        attempts: 2,
      });

      const evalPath = join(projectRoot, "evals", "source-snapshot.eval.ts");
      const evalSource = await readFile(evalPath, "utf8");
      expect(evalSource).toContain("ENTRY_SNAPSHOT_BEFORE");
      await writeFile(
        evalPath,
        evalSource.replace("ENTRY_SNAPSHOT_BEFORE", "ENTRY_SNAPSHOT_AFTER"),
        "utf8",
      );

      const staleShow = await niceeval.run(["show", "--json"]);
      expect(staleShow.exitCode, staleShow.diagnostic()).toBe(0);
      const staleDocument = assertPublicShowJson(staleShow.json());
      expect(staleDocument.view).toBe("leaderboard");
      expect(staleDocument.sample.experiments).toEqual([]);
      expect(staleDocument.data).toMatchObject({
        experiments: [],
        passRate: null,
        evals: 0,
        attempts: 0,
      });

      const staleHistory = await niceeval.run(["show", "--run", initialRunId, "--json"]);
      expect(staleHistory.exitCode, staleHistory.diagnostic()).toBe(0);
      const staleHistoryDocument = assertPublicShowJson(staleHistory.json());
      expect(staleHistoryDocument.view).toBe("leaderboard");
      expect(staleHistoryDocument.sample.experiments).toEqual(["source"]);
      expect(staleHistoryDocument.data).toMatchObject({
        experiments: [{ experimentId: "source", evals: 1 }],
        evals: 1,
        attempts: 1,
      });

      const changedRun = await niceeval.run(["exp", "source", "--json"]);
      expect(changedRun.exitCode, changedRun.diagnostic()).toBe(0);
      expect(changedRun.expReceipt()).toMatchObject({ completion: "completed" });
      expect(
        only(
          changedRun.ndjson<ExpEvent>(),
          (event) => event.event === "start",
          changedRun.diagnostic(),
        ),
      ).toMatchObject({ event: "start", reused: 0 });
      expect(
        only(
          changedRun.ndjson<ExpEvent>(),
          (event) => event.event === "eval" && event.evalId === "source-snapshot",
          changedRun.diagnostic(),
        ),
      ).toMatchObject({ event: "eval", evalId: "source-snapshot", verdict: "passed" });
      const changedRunId = only(
        changedRun.expReceipt().runIds,
        () => true,
        changedRun.diagnostic(),
      );

      const refreshedShow = await niceeval.run(["show", "--json"]);
      expect(refreshedShow.exitCode, refreshedShow.diagnostic()).toBe(0);
      const refreshedDocument = assertPublicShowJson(refreshedShow.json());
      expect(refreshedDocument.view).toBe("leaderboard");
      expect(refreshedDocument.sample.experiments).toEqual(["source"]);
      expect(refreshedDocument.data).toMatchObject({
        experiments: [{ experimentId: "source", evals: 1 }],
        evals: 1,
        attempts: 1,
      });
      expect(initialRunId).not.toBe(unchangedRunId);
      expect(changedRunId).not.toBe(unchangedRunId);

      const removedLatest = await niceeval.run(["show", "--latest"]);
      expect(removedLatest.exitCode, removedLatest.diagnostic()).not.toBe(0);
      expect(removedLatest.stderr).toContain("Unknown option '--latest'");
    },
  );
});
