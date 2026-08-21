// owner: docs/engineering/testing/e2e/report.md#report-static-export
// rerun: pnpm e2e --repo report -- --run test/report-export.test.ts

import { only } from "@niceeval/testkit";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

test("view --out 导出完整参数化站点并保护已有目标目录", async () => {
  await reportE2E.case(
    "export",
    { artifacts: reportCaseArtifacts(["site-export", "attempt-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const mainRun = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(mainRun.expReceipt(), mainRun.diagnostic()).toMatchObject({ completion: "completed" });
      const sourceRun = await niceeval.run(["exp", "source", "--rerun", "all", "--json"]);
      expect(sourceRun.expReceipt(), sourceRun.diagnostic()).toMatchObject({ completion: "completed" });
      const mainEvaluations = mainRun.expEvalEvents();
      const mainSlots = mainEvaluations.length;
      const sourceSlots = sourceRun.expEvalEvents().length;
      expect(mainSlots, "main must seal four logical slots").toBe(4);
      expect(mainSlots + sourceSlots, "the fixture Sample must stay small").toBe(5);
      const failed = only(
        mainEvaluations,
        (event) => event.evalId === "deliberate-fail",
        mainRun.diagnostic(),
      );

      const exported = await niceeval.run(
        [
          "view",
          "--report",
          "./reports/site.tsx",
          "--out",
          "site-export",
          "--no-open",
        ],
      );
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

      const index = await readFile(join(projectRoot, "site-export", "index.html"), "utf8");
      expect(index).toContain('src="_niceeval/app.js"');
      expect(index).not.toContain(projectRoot);
      expect(index).not.toContain(".niceeval/");
      const projections = JSON.parse(
        await readFile(join(projectRoot, "site-export", "_niceeval", "data", "projections.json"), "utf8"),
      ) as {
        readonly format: string;
        readonly pricingProfile: unknown;
        readonly costs: readonly unknown[];
      };
      expect(projections).toMatchObject({
        format: "niceeval.report-projections/v1",
        pricingProfile: {
          contentIdentity: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          currency: "USD",
          provenance: { kind: "declared-rate-card" },
        },
      });
      expect(projections.costs).toHaveLength(1);

      const complete = await stat(join(projectRoot, "site-export", "_niceeval", "complete"));
      expect(complete.size).toBe(0);

      const alreadyExists = await niceeval.run(
        [
          "view",
          "--report",
          "./reports/site.tsx",
          "--out",
          "site-export",
          "--no-open",
        ],
      );
      expect(alreadyExists.exitCode, alreadyExists.diagnostic()).not.toBe(0);
      expect(alreadyExists.stderr).toContain("report-export-target-exists");

      const attemptExport = await niceeval.run(
        [
          "view",
          failed.locator,
          "--out",
          "attempt-export",
          "--no-open",
        ],
      );
      expect(attemptExport.exitCode, attemptExport.diagnostic()).toBe(0);

      const attemptIndex = await readFile(join(projectRoot, "attempt-export", "index.html"), "utf8");
      expect(attemptIndex).toContain('src="_niceeval/app.js"');
      expect(attemptIndex).not.toContain(projectRoot);
      expect(attemptIndex).not.toContain(".niceeval/");

      const attemptComplete = await stat(join(projectRoot, "attempt-export", "_niceeval", "complete"));
      expect(attemptComplete.size).toBe(0);
    },
  );
});

test("view --out 拒绝发布零选中结果的空报告", async () => {
  await reportE2E.case(
    "empty-export",
    { artifacts: reportCaseArtifacts(["empty-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const initialRun = await niceeval.run(["exp", "source", "--rerun", "all", "--json"]);
      expect(initialRun.expReceipt(), initialRun.diagnostic()).toMatchObject({ completion: "completed" });

      const evalPath = join(projectRoot, "evals", "source-snapshot.eval.ts");
      const evalSource = await readFile(evalPath, "utf8");
      await writeFile(
        evalPath,
        evalSource.replace("ENTRY_SNAPSHOT_BEFORE", "ENTRY_SNAPSHOT_AFTER"),
        "utf8",
      );

      const exported = await niceeval.run([
        "view",
        "--out",
        "empty-export",
        "--no-open",
      ]);

      expect(exported.exitCode, exported.diagnostic()).not.toBe(0);
      expect(exported.stderr).toContain("report-sample-empty");
      await expect(stat(join(projectRoot, "empty-export"))).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});
