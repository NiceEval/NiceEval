// owner: docs/engineering/testing/e2e/report.md#report-static-export
// rerun: pnpm e2e --repo report -- --run test/report-export.test.ts

import { command, only, withProjectCopy } from "@niceeval/testkit";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportArtifactStaging, reportProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("view --out 从一份固定 ReportExecution 导出带完成标识的静态站", async () => {
  await withProjectCopy(
    reportProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"], { cwd: root });
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
        { cwd: root },
      );
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

      const index = await readFile(join(root, "site-export", "index.html"), "utf8");
      expect(index).toContain("Report fixture");
      expect(index).toContain("Slot denominator");
      expect(index).toContain("Fixture copy block");

      const complete = await stat(join(root, "site-export", "_niceeval", "complete"));
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
        { cwd: root },
      );
      expect(attemptExport.exitCode, attemptExport.diagnostic()).toBe(0);

      const attemptIndex = await readFile(join(root, "attempt-export", "index.html"), "utf8");
      expect(attemptIndex).toContain("Attempt overview");
      expect(attemptIndex).toContain("Verdict: failed");
      expect(attemptIndex).toContain("Assertions");

      const attemptComplete = await stat(join(root, "attempt-export", "_niceeval", "complete"));
      expect(attemptComplete.size).toBe(0);
    },
    reportArtifactStaging("export", ["site-export", "attempt-export"]),
  );
});
