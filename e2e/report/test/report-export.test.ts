// owner: docs/engineering/testing/e2e/report.md#report-static-export
// rerun: pnpm e2e --repo report -- --run test/report-export.test.ts

import { command, withProjectCopy } from "@niceeval/testkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportArtifactStaging, reportProjectCopy } from "./support.ts";

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("view --out 为本轮 report evidence 导出可读静态站", async () => {
  await withProjectCopy(
    reportProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).not.toBe(0);

      const exported = await niceeval.run(
        [
          "view",
          "--record",
          ".niceeval",
          "--report",
          "./reports/site.tsx",
          "--out",
          "site-export",
          "--no-open",
        ],
        { cwd: root },
      );
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

      const index = await readFile(join(root, "site-export", "index.html"), "utf8");
      expect(index).toContain("Report fixture");
      expect(index).toContain("tool-call");
      expect(index).toContain("deliberate-fail");
    },
    reportArtifactStaging("export", ["site-export"]),
  );
});
