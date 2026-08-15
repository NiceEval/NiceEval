// owner: docs/engineering/testing/e2e/report.md#report-static-export
// rerun: pnpm e2e --repo report -- --run test/report-export.test.ts

import { only } from "@niceeval/testkit";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

interface ExpEvent {
  readonly event: string;
  readonly evalId?: string;
  readonly locator?: string;
}

test("view --out 导出完整参数化站点并保护已有目标目录", async () => {
  await reportE2E.case(
    "export",
    { artifacts: reportCaseArtifacts(["site-export", "attempt-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      const slotCount = run.ndjson<ExpEvent>().filter((event) => event.event === "eval").length;
      expect(slotCount, run.diagnostic()).toBeGreaterThan(0);
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
      expect(index).not.toContain(projectRoot);
      expect(index).not.toContain(".niceeval/");

      // The authored hrefs, rather than a hand-built output path, reveal every
      // parameterized instance that static export had to close.
      const staticRoot = pathToFileURL(join(projectRoot, "site-export", "index.html"));
      const detailHrefs = [...new Set(
        [...index.matchAll(/href="([^"]*(?:source|trace|diff)\/[^"]*)"/g)].map((match) => match[1]!),
      )];
      expect(detailHrefs).toHaveLength(slotCount * 3);
      for (const href of detailHrefs) {
        const kind = detailKind(href);
        const detail = await readFile(fileURLToPath(new URL(href, staticRoot)), "utf8");
        expect(detail).toContain(`${kind} fixture detail`);
      }

      const complete = await stat(join(projectRoot, "site-export", "_niceeval", "complete"));
      expect(complete.size).toBe(0);

      const alreadyExists = await niceeval.run(
        [
          "view",
          "--report",
          "./reports/site.ts",
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

function detailKind(href: string): "Source" | "Trace" | "Diff" {
  if (href.includes("source/")) return "Source";
  if (href.includes("trace/")) return "Trace";
  if (href.includes("diff/")) return "Diff";
  throw new Error(`unexpected static detail href: ${JSON.stringify(href)}`);
}
