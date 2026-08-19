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
      const mainRun = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(mainRun.expReceipt(), mainRun.diagnostic()).toMatchObject({ completion: "completed" });
      const sourceRun = await niceeval.run(["exp", "source", "--rerun", "all", "--json"]);
      expect(sourceRun.expReceipt(), sourceRun.diagnostic()).toMatchObject({ completion: "completed" });
      const mainSlots = mainRun.ndjson<ExpEvent>().filter((event) => event.event === "eval").length;
      const sourceSlots = sourceRun.ndjson<ExpEvent>().filter((event) => event.event === "eval").length;
      expect(mainSlots, "main must seal four logical slots").toBe(4);
      expect(mainSlots + sourceSlots, "the fixture Sample must stay small").toBe(5);
      const failed = only(
        mainRun.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "deliberate-fail" && event.locator !== undefined,
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
      expect(index).toContain("Report fixture");
      expect(index).not.toContain(projectRoot);
      expect(index).not.toContain(".niceeval/");

      // The authored hrefs, rather than a hand-built output path, reveal every
      // parameterized instance that static export had to close.
      const staticRoot = pathToFileURL(join(projectRoot, "site-export", "index.html"));
      const slotHrefs = [...new Set(
        [...index.matchAll(/href="([^"]*slot\/slot-[^"]+)"/g)].map((match) => match[1]!),
      )];
      expect(slotHrefs, "static export must close every slot detail instance").toHaveLength(
        mainSlots + sourceSlots,
      );
      for (const href of slotHrefs) {
        const detail = await readFile(fileURLToPath(new URL(href, staticRoot)), "utf8");
        expect(detail).toMatch(/Slot fixture detail slot-/);
      }

      const source = await readFile(fileURLToPath(new URL("source/index.html", staticRoot)), "utf8");
      expect(source).toContain("Source fixture detail");
      expect(source).toContain("evals/source-snapshot.eval.ts");
      expect(source).toContain("evals/source-snapshot/assertions.ts");

      // The author declares only slot/source/diff Pages; the standard Attempt
      // and Experiment detail Pages are explicitly composed into this Report,
      // so every declared instance is a readable closed document.
      const manifest = JSON.parse(
        await readFile(join(projectRoot, "site-export", "_niceeval", "manifest.json"), "utf8"),
      ) as {
        readonly pages: readonly { readonly pageId: string; readonly route: string; readonly path: string }[];
        readonly projections: string;
      };
      expect(manifest.projections).toBe("_niceeval/data/projections.json");
      const projections = JSON.parse(
        await readFile(join(projectRoot, "site-export", manifest.projections), "utf8"),
      ) as {
        readonly schema: string;
        readonly pricingProfile: unknown;
        readonly costs: readonly unknown[];
      };
      expect(projections).toMatchObject({
        schema: "niceeval.report-projections/v1",
        pricingProfile: {
          contentIdentity: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          currency: "USD",
          provenance: { kind: "declared-rate-card" },
        },
      });
      expect(projections.costs).toHaveLength(3);
      const attemptPages = manifest.pages.filter((page) => page.pageId === "attempt");
      const experimentPages = manifest.pages.filter((page) => page.pageId === "experiment");
      expect(attemptPages, "the declared standard Attempt Page must close every included Slot").toHaveLength(
        mainSlots + sourceSlots,
      );
      expect(experimentPages, "the declared standard Experiment Page must close every Sample Experiment")
        .not.toHaveLength(0);
      for (const entry of [...attemptPages, ...experimentPages]) {
        const detail = await readFile(fileURLToPath(new URL(entry.path, staticRoot)), "utf8");
        expect(detail).toMatch(entry.pageId === "attempt" ? /@[0-9A-HJKMNP-TV-Z]{13}/ : /Experiment · /);
      }

      const diff = await readFile(fileURLToPath(new URL("diff/index.html", staticRoot)), "utf8");
      expect(diff).toContain("Diff fixture detail");
      expect(diff).toContain("Diff entries: not-recorded");

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
          failed.locator!,
          "--out",
          "attempt-export",
          "--no-open",
        ],
      );
      expect(attemptExport.exitCode, attemptExport.diagnostic()).toBe(0);

      const attemptIndex = await readFile(join(projectRoot, "attempt-export", "index.html"), "utf8");
      expect(attemptIndex).toContain("Attempt overview");
      expect(attemptIndex).toContain(failed.locator!);
      expect(attemptIndex).not.toContain(projectRoot);
      expect(attemptIndex).not.toContain(".niceeval/");

      const attemptComplete = await stat(join(projectRoot, "attempt-export", "_niceeval", "complete"));
      expect(attemptComplete.size).toBe(0);
    },
  );
});
