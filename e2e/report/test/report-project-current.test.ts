// owner: docs/engineering/testing/e2e/report.md#report-project-current
// regression: 052b13bb (design: memory/current-result-single-state-ruling.md)
// kill: 77ae005b with the current-input fingerprint comparison removed packed as
// sha256:47e3f9a18580216922e0a3df65375bc1dc8c1b3a5a37b4bba4a22d82a94fa026;
// the public owner first failed at observe/outcome line 126 because stale
// `sample.experiments` was ["source"] instead of [].
// rerun: pnpm e2e --repo report -- --run test/report-project-current.test.ts

import { only } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  verdict?: string;
  reused?: number;
}

interface LeaderboardValue {
  readonly experiments: readonly { readonly experimentId: string; readonly evals: number }[];
  readonly passRate?: {
    readonly value: number | null;
    readonly samples: number;
    readonly total: number;
    readonly basis: "eval";
    readonly refs: readonly string[];
  };
  readonly evals: number;
  readonly attempts: number;
}

interface AvailableLeaderboardCalculation {
  readonly state: "available";
  readonly inputState: "complete" | "partial";
  readonly problemIds: readonly number[];
  readonly value: LeaderboardValue;
}

interface ShowOverview {
  readonly format: "niceeval.show";
  readonly view: string;
  readonly sample: {
    readonly experiments: readonly string[];
  };
  readonly data: AvailableLeaderboardCalculation;
}

function availableLeaderboardValue(document: ShowOverview): LeaderboardValue {
  expect(document.data).toMatchObject({
    state: "available",
    inputState: "complete",
    problemIds: [],
  });
  expect("value" in document.data).toBe(true);
  return document.data.value;
}

interface ExplicitRunShow {
  readonly format: "niceeval.report-show/v1";
  readonly reportId: "run-membership-overview";
  readonly sample: {
    readonly selection: { readonly policy: "explicit-runs"; readonly runIds: readonly string[] };
    readonly runCount: number;
    readonly slotCount: number;
    readonly denominator: number;
  };
  readonly pages: readonly {
    readonly state: string;
    readonly pageId: string;
    readonly route?: string;
  }[];
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
      const initialDocument = initialShow.json<ShowOverview>();
      expect(initialDocument.view).toBe("leaderboard");
      expect(initialDocument.sample.experiments).toEqual(["source"]);
      expect(availableLeaderboardValue(initialDocument)).toMatchObject({
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
      const accumulatedDocument = accumulatedShow.json<ShowOverview>();
      expect(accumulatedDocument.view).toBe("leaderboard");
      expect(accumulatedDocument.sample.experiments).toEqual(["source"]);
      expect(availableLeaderboardValue(accumulatedDocument)).toMatchObject({
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
      const staleDocument = staleShow.json<ShowOverview>();
      expect(staleDocument.view).toBe("leaderboard");
      expect(staleDocument.sample.experiments).toEqual([]);
      expect(availableLeaderboardValue(staleDocument)).toMatchObject({
        experiments: [],
        passRate: {
          value: null,
          samples: 0,
          total: 0,
          basis: "eval",
          refs: [],
        },
        evals: 0,
        attempts: 0,
      });

      const staleHistory = await niceeval.run(["show", "--run", initialRunId, "--json"]);
      expect(staleHistory.exitCode, staleHistory.diagnostic()).toBe(0);
      expect(staleHistory.json<ExplicitRunShow>()).toMatchObject({
        format: "niceeval.report-show/v1",
        reportId: "run-membership-overview",
        sample: {
          selection: { policy: "explicit-runs", runIds: [initialRunId] },
          runCount: 1,
          slotCount: 1,
          denominator: 1,
        },
        pages: [{ state: "rendered", pageId: "run-membership", route: "/" }],
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
      const refreshedDocument = refreshedShow.json<ShowOverview>();
      expect(refreshedDocument.view).toBe("leaderboard");
      expect(refreshedDocument.sample.experiments).toEqual(["source"]);
      expect(availableLeaderboardValue(refreshedDocument)).toMatchObject({
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
