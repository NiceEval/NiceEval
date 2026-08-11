// owner: docs/engineering/testing/e2e/report.md#report-project-current
// regression: 052b13bb (design: memory/current-result-single-state-ruling.md)
// rerun: pnpm e2e --repo report -- --run test/report-project-current.test.ts

import { command, withProjectCopy } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportArtifactStaging, reportProjectCopy } from "./support.ts";

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

interface ShowOverview {
  format: "niceeval.show";
  schemaVersion: 1;
  view: "leaderboard";
  data: {
    summary: {
      attempts: number;
    };
  };
}

test("项目未变时复用结果，Eval 源码变化后 show 排除旧结果并重新执行", async () => {
  await withProjectCopy(
    reportProjectCopy,
    async ({ root }) => {
      const initialRun = await niceeval.run(
        ["exp", "source", "--rerun", "all", "--json"],
        { cwd: root },
      );
      expect(initialRun.exitCode, initialRun.diagnostic()).toBe(0);
      expect(initialRun.expResult()).toMatchObject({
        event: "result",
        status: "passed",
        passed: 1,
        failed: 0,
        errored: 0,
        completion: "complete",
      });

      const initialShow = await niceeval.run(["show", "--json"], { cwd: root });
      expect(initialShow.exitCode, initialShow.diagnostic()).toBe(0);
      expect(initialShow.json<ShowOverview>()).toMatchObject({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "leaderboard",
        data: { summary: { attempts: 1 } },
      });

      const unchangedRun = await niceeval.run(["exp", "source", "--json"], { cwd: root });
      expect(unchangedRun.exitCode, unchangedRun.diagnostic()).toBe(0);
      expect(unchangedRun.expResult()).toMatchObject({
        event: "result",
        status: "passed",
        passed: 1,
        failed: 0,
        errored: 0,
        reused: 1,
        completion: "complete",
      });

      const evalPath = join(root, "evals", "source-snapshot.eval.ts");
      const evalSource = await readFile(evalPath, "utf8");
      expect(evalSource).toContain("ENTRY_SNAPSHOT_BEFORE");
      await writeFile(
        evalPath,
        evalSource.replace("ENTRY_SNAPSHOT_BEFORE", "ENTRY_SNAPSHOT_AFTER"),
        "utf8",
      );

      const staleShow = await niceeval.run(["show", "--json"], { cwd: root });
      expect(staleShow.exitCode, staleShow.diagnostic()).toBe(0);
      expect(staleShow.json<ShowOverview>()).toMatchObject({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "leaderboard",
        data: { summary: { attempts: 0 } },
      });

      const changedRun = await niceeval.run(["exp", "source", "--json"], { cwd: root });
      expect(changedRun.exitCode, changedRun.diagnostic()).toBe(0);
      const changedResult = changedRun.expResult();
      expect(changedResult).toMatchObject({
        event: "result",
        status: "passed",
        passed: 1,
        failed: 0,
        errored: 0,
        completion: "complete",
      });
      expect(changedResult.reused).toBeUndefined();

      const refreshedShow = await niceeval.run(["show", "--json"], { cwd: root });
      expect(refreshedShow.exitCode, refreshedShow.diagnostic()).toBe(0);
      expect(refreshedShow.json<ShowOverview>()).toMatchObject({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "leaderboard",
        data: { summary: { attempts: 1 } },
      });
    },
    reportArtifactStaging("project-current"),
  );
});
