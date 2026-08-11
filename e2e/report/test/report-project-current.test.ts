// owner: docs/engineering/testing/e2e/report.md#report-project-current
// regression: 052b13bb (design: memory/current-result-single-state-ruling.md)
// rerun: pnpm e2e --repo report -- --run test/report-project-current.test.ts

import { command, withProjectCopy } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportArtifactStaging, reportProjectCopy } from "./support.ts";

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("项目未变时复用结果，Eval 源码变化后 show 与 view 排除旧结果并重新执行", async () => {
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

      const initialShow = await niceeval.run(
        ["show", "--report", "./reports/config-reload.tsx"],
        { cwd: root },
      );
      expect(initialShow.exitCode, initialShow.diagnostic()).toBe(0);
      expect(initialShow.stdout).toContain("ATTEMPTS_1");

      const initialView = await niceeval.run(
        [
          "view",
          "--report",
          "./reports/config-reload.tsx",
          "--out",
          "view-initial",
          "--no-open",
        ],
        { cwd: root },
      );
      expect(initialView.exitCode, initialView.diagnostic()).toBe(0);
      const initialHtml = await readFile(join(root, "view-initial", "index.html"), "utf8");
      expect(initialHtml).toContain("ATTEMPTS_1");

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

      const staleShow = await niceeval.run(
        ["show", "--report", "./reports/config-reload.tsx"],
        { cwd: root },
      );
      expect(staleShow.exitCode, staleShow.diagnostic()).toBe(0);
      expect(staleShow.stdout).toContain("ATTEMPTS_0");
      expect(staleShow.stdout).not.toContain("ATTEMPTS_1");

      const staleView = await niceeval.run(
        [
          "view",
          "--report",
          "./reports/config-reload.tsx",
          "--out",
          "view-stale",
          "--no-open",
        ],
        { cwd: root },
      );
      expect(staleView.exitCode, staleView.diagnostic()).toBe(0);
      const staleHtml = await readFile(join(root, "view-stale", "index.html"), "utf8");
      expect(staleHtml).toContain("ATTEMPTS_0");
      expect(staleHtml).not.toContain("ATTEMPTS_1");

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

      const refreshedShow = await niceeval.run(
        ["show", "--report", "./reports/config-reload.tsx"],
        { cwd: root },
      );
      expect(refreshedShow.exitCode, refreshedShow.diagnostic()).toBe(0);
      expect(refreshedShow.stdout).toContain("ATTEMPTS_1");

      const refreshedView = await niceeval.run(
        [
          "view",
          "--report",
          "./reports/config-reload.tsx",
          "--out",
          "view-refreshed",
          "--no-open",
        ],
        { cwd: root },
      );
      expect(refreshedView.exitCode, refreshedView.diagnostic()).toBe(0);
      const refreshedHtml = await readFile(join(root, "view-refreshed", "index.html"), "utf8");
      expect(refreshedHtml).toContain("ATTEMPTS_1");
    },
    reportArtifactStaging("project-current"),
  );
});
