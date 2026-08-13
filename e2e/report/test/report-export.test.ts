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
          "--latest",
          "--record",
          ".niceeval/record",
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

      const complete = await stat(join(projectRoot, "site-export", "_niceeval", "complete"));
      expect(complete.size).toBe(0);

      const attemptExport = await niceeval.run(
        [
          "view",
          failed.locator!,
          "--record",
          ".niceeval/record",
          "--out",
          "attempt-export",
          "--no-open",
        ],
      );
      expect(attemptExport.exitCode, attemptExport.diagnostic()).toBe(0);

      const attemptIndex = await readFile(join(projectRoot, "attempt-export", "index.html"), "utf8");
      expect(attemptIndex).toContain("Attempt overview");
      expect(attemptIndex).toContain("Verdict: failed");
      expect(attemptIndex).toContain("Assertions");

      const attemptComplete = await stat(join(projectRoot, "attempt-export", "_niceeval", "complete"));
      expect(attemptComplete.size).toBe(0);
    },
  );
});
