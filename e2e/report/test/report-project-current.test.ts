// owner: docs/engineering/testing/e2e/report.md#report-project-current
// regression: 052b13bb (design: memory/current-result-single-state-ruling.md)
// rerun: pnpm e2e --repo report -- --run test/report-project-current.test.ts

import { command, only, withProjectCopy } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportArtifactStaging, reportProjectCopy } from "./support.ts";

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

interface ExpEvent {
  event: string;
  evalId?: string;
  verdict?: string;
  reused?: number;
}

interface ShowOverview {
  format: "niceeval.report-show/v1";
  sample: { runCount: number; slotCount: number; denominator: number };
}

test("项目未变时复用结果，Eval 源码变化后重新执行并读回新结果", async () => {
  await withProjectCopy(
    reportProjectCopy,
    async ({ root }) => {
      const initialRun = await niceeval.run(
        ["exp", "source", "--rerun", "all", "--json"],
        { cwd: root },
      );
      expect(initialRun.exitCode, initialRun.diagnostic()).toBe(0);
      expect(initialRun.expReceipt()).toMatchObject({ completion: "completed" });
      expect(
        only(
          initialRun.ndjson<ExpEvent>(),
          (event) => event.event === "eval" && event.evalId === "source-snapshot",
          initialRun.diagnostic(),
        ),
      ).toMatchObject({ event: "eval", evalId: "source-snapshot", verdict: "passed" });

      const initialShow = await niceeval.run(["show", "--latest", "--json"], { cwd: root });
      expect(initialShow.exitCode, initialShow.diagnostic()).toBe(0);
      expect(initialShow.json<ShowOverview>()).toMatchObject({
        format: "niceeval.report-show/v1",
        sample: { runCount: 1, slotCount: 1, denominator: 1 },
      });

      const unchangedRun = await niceeval.run(["exp", "source", "--json"], { cwd: root });
      expect(unchangedRun.exitCode, unchangedRun.diagnostic()).toBe(0);
      expect(unchangedRun.expReceipt()).toMatchObject({ completion: "completed" });
      expect(
        only(
          unchangedRun.ndjson<ExpEvent>(),
          (event) => event.event === "start",
          unchangedRun.diagnostic(),
        ),
      ).toMatchObject({ event: "start", reused: 1 });

      const evalPath = join(root, "evals", "source-snapshot.eval.ts");
      const evalSource = await readFile(evalPath, "utf8");
      expect(evalSource).toContain("ENTRY_SNAPSHOT_BEFORE");
      await writeFile(
        evalPath,
        evalSource.replace("ENTRY_SNAPSHOT_BEFORE", "ENTRY_SNAPSHOT_AFTER"),
        "utf8",
      );

      const staleShow = await niceeval.run(["show", "--latest", "--json"], { cwd: root });
      expect(staleShow.exitCode, staleShow.diagnostic()).toBe(0);
      // --latest 只读已发布 Record，不按工作区源码重新校验指纹；源码变化要等下一次
      // exp 的 reuse plan 才体现为重新派发（reports cli.md「共同选择项」）。
      expect(staleShow.json<ShowOverview>()).toMatchObject({
        format: "niceeval.report-show/v1",
        sample: { runCount: 1, slotCount: 1, denominator: 1 },
      });

      const changedRun = await niceeval.run(["exp", "source", "--json"], { cwd: root });
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

      const refreshedShow = await niceeval.run(["show", "--latest", "--json"], { cwd: root });
      expect(refreshedShow.exitCode, refreshedShow.diagnostic()).toBe(0);
      expect(refreshedShow.json<ShowOverview>()).toMatchObject({
        format: "niceeval.report-show/v1",
        sample: { runCount: 1, slotCount: 1, denominator: 1 },
      });
    },
    reportArtifactStaging("project-current"),
  );
});
