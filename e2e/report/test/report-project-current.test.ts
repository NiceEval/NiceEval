// owner: docs/engineering/testing/e2e/report.md#report-project-current
// regression: 052b13bb (design: memory/current-result-single-state-ruling.md)
// rerun: pnpm e2e --repo report -- --run test/report-project-current.test.ts

import { only, type ExpEvent } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

interface MetricValueJson {
  readonly value: number | null;
  readonly state: string;
  readonly samples: number;
  readonly total: number;
  readonly issues: readonly unknown[];
  readonly refs: readonly unknown[];
}

interface LeaderboardRow {
  readonly key: string;
  readonly passRate: MetricValueJson;
}

interface ReportProblem {
  readonly code: string;
  readonly path: readonly string[];
  readonly refs: readonly string[];
  readonly summary?: string;
}

interface ShowOverview {
  readonly schema: "niceeval.show/v1";
  readonly locale: "en";
  readonly selection:
    | {
        readonly kind: "project-current";
        readonly sampleIdentity: string;
        readonly experimentIds: readonly string[];
      }
    | {
        readonly kind: "explicit-runs";
        readonly sampleIdentity: string;
        readonly runIds: readonly string[];
      };
  readonly page: { readonly route: string; readonly pageId: string };
  readonly data: { readonly kind: "leaderboard"; readonly rows: readonly LeaderboardRow[] };
  readonly problems: readonly ReportProblem[];
}

const PROJECT_EXPERIMENT_IDS = [
  "classic/baseline",
  "classic/memory-a",
  "classic/memory-b",
  "main",
  "source",
] as const;

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
          initialRun.expEvalEvents(),
          (event) => event.evalId === "source-snapshot",
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
      expect(initialDocument).toMatchObject({
        schema: "niceeval.show/v1",
        locale: "en",
        selection: {
          kind: "project-current",
          experimentIds: [...PROJECT_EXPERIMENT_IDS],
        },
        page: { route: "/", pageId: "overview" },
        data: { kind: "leaderboard" },
      });
      expect(
        initialDocument.problems,
        "a completed Eval with no Agent send has known zero usage rather than missing input",
      ).toEqual([]);
      expect(initialDocument.data.rows).toHaveLength(1);
      expect(initialDocument.data.rows[0]!.passRate).toMatchObject({
        state: "available",
        samples: 1,
        total: 1,
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

      const accumulatedShow = await niceeval.run(["show", "--json"]);
      expect(accumulatedShow.exitCode, accumulatedShow.diagnostic()).toBe(0);
      const accumulatedDocument = accumulatedShow.json<ShowOverview>();
      expect(accumulatedDocument.selection).toMatchObject({ kind: "project-current" });
      expect(accumulatedDocument.data.rows).toHaveLength(1);
      expect(accumulatedDocument.data.rows[0]!.passRate).toMatchObject({
        state: "available",
        samples: 2,
        total: 2,
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
      expect(staleShow.json<ShowOverview>()).toMatchObject({
        schema: "niceeval.show/v1",
        selection: { kind: "project-current" },
        data: { kind: "leaderboard", rows: [] },
        problems: [],
      });

      const staleHistory = await niceeval.run(["show", "--run", initialRunId, "--json"]);
      expect(staleHistory.exitCode, staleHistory.diagnostic()).toBe(0);
      expect(staleHistory.json<ShowOverview>()).toMatchObject({
        schema: "niceeval.show/v1",
        selection: {
          kind: "explicit-runs",
          runIds: [initialRunId],
        },
        data: { kind: "leaderboard" },
      });
      expect(staleHistory.json<ShowOverview>().data.rows[0]!.passRate.state).toBe("available");

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
          changedRun.expEvalEvents(),
          (event) => event.evalId === "source-snapshot",
          changedRun.diagnostic(),
        ),
      ).toMatchObject({ event: "eval", evalId: "source-snapshot", verdict: "passed" });

      const refreshedShow = await niceeval.run(["show", "--json"]);
      expect(refreshedShow.exitCode, refreshedShow.diagnostic()).toBe(0);
      expect(refreshedShow.json<ShowOverview>()).toMatchObject({
        schema: "niceeval.show/v1",
        selection: { kind: "project-current" },
        data: { kind: "leaderboard" },
      });
      expect(refreshedShow.json<ShowOverview>().data.rows[0]!.passRate).toMatchObject({
        state: "available",
        samples: 1,
        total: 1,
      });

      const removedLatest = await niceeval.run(["show", "--latest"]);
      expect(removedLatest.exitCode, removedLatest.diagnostic()).not.toBe(0);
      expect(removedLatest.stderr).toContain("Unknown option '--latest'");
    },
  );
});
