// owner: docs/engineering/testing/e2e/report.md#report-static-export
// rerun: pnpm e2e --repo report -- --run test/report-export.test.ts

import { only } from "@niceeval/testkit";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
}

test("view --out 从一份固定 ReportExecution 导出带完成标识的静态站", async () => {
  await reportE2E.case(
    "export",
    { artifacts: reportCaseArtifacts(["site-export", "attempt-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      const failed = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "deliberate-fail" && event.locator !== undefined,
        run.diagnostic(),
      );

      const exported = await niceeval.run(
        [
          "view",
          "--report",
          "./reports/site.ts",
          "--out",
          "site-export",
          "--no-open",
        ],
      );
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

      const index = await readFile(join(projectRoot, "site-export", "index.html"), "utf8");
      expect(index).toContain("Report fixture");
      expect(index).toContain("Slot denominator");
      expect(index).toContain("Fixture copy block");

      // The overview exposes each route produced by the one params codec.
      // Static export must close exactly those Sample slots into detail pages.
      const detailRoutes = [...new Set(
        [...index.matchAll(/\/slots\/[a-z0-9][a-z0-9._~-]*/g)].map((match) => match[0]),
      )];
      expect(detailRoutes).toHaveLength(3);
      for (const detailRoute of detailRoutes) {
        const detail = await readFile(
          join(projectRoot, "site-export", ...detailRoute.split("/").filter(Boolean), "index.html"),
          "utf8",
        );
        expect(detail).toContain("Report fixture slot");
      }

      const complete = await stat(join(projectRoot, "site-export", "_niceeval", "complete"));
      expect(complete.size).toBe(0);

      const attemptExport = await niceeval.run(
        [
          "view",
          failed.locator!,
          "--out",
          "attempt-export",
          "--no-open",
        ],
      );
      expect(attemptExport.exitCode, attemptExport.diagnostic()).toBe(0);

      const attemptIndex = await readFile(join(projectRoot, "attempt-export", "index.html"), "utf8");
      expect(attemptIndex).toContain("Attempt overview");
      expect(attemptIndex).toContain("0 ratio · 1 / 1 slot");
      expect(attemptIndex).toContain("Attempt identity");
      expect(attemptIndex).toContain("Closed evidence");

      const attemptComplete = await stat(join(projectRoot, "attempt-export", "_niceeval", "complete"));
      expect(attemptComplete.size).toBe(0);
    },
  );
});
