// owner: docs/engineering/testing/e2e/report.md#report-execution-evidence
// rerun: pnpm e2e test --repo report -- --run test/report-execution.test.ts

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  installedAuthorExportManifest,
  reportCaseArtifacts,
  reportE2E,
  typecheckInstalledReportConsumer,
} from "./support.ts";

test("标准 React JSX 的 v0.12 作者 fixture 经安装候选构建完整站点闭包", async () => {
  await reportE2E.case(
    "classic-author",
    { artifacts: reportCaseArtifacts(["classic-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      await typecheckInstalledReportConsumer(projectRoot);
      const manifest = await installedAuthorExportManifest(projectRoot);
      for (const subpath of [
        "./report",
        "./report/built-in",
        "./report/react",
        "./report/extension",
        "./report/host",
        "./report/react/styles.css",
        "./report/react/enhance.js",
      ] as const) {
        expect(manifest.subpaths, `package subpath ${subpath}`).toContain(subpath);
      }
      for (const deleted of [
        "./jsx-runtime",
        "./jsx-dev-runtime",
        "./report/jsx-runtime",
        "./report/jsx-dev-runtime",
      ] as const) {
        expect(manifest.subpaths, `deleted JSX runtime subpath ${deleted}`).not.toContain(deleted);
      }
      expect(manifest.report, "documented author runtime exports").toEqual(expect.arrayContaining([
        "Bars",
        "Col",
        "ExperimentScatter",
        "ExperimentTable",
        "Hero",
        "SampleNotices",
        "SampleSummary",
        "Section",
        "Stat",
        "Table",
        "Text",
        "aggregate",
        "builtInPricingProfile",
        "costUSD",
        "definePricingProfile",
        "defineComponent",
        "defineReport",
        "experiment",
        "passRate",
        "toFileChanges",
        "toSources",
      ]));
      for (const deleted of [
        "rollup",
        "metricValue",
        "totalScore",
        "isPricingProfile",
        "isCostMeasure",
        "formatCostProjectionCellText",
        "formatCostProjectionCellDetail",
        "COST_SUMMARY_NO_PROFILE_TEXT",
        "COST_SCATTER_NO_PROFILE_TEXT",
      ] as const) {
        expect(manifest.report, `deleted author export ${deleted}`).not.toContain(deleted);
      }
      expect(manifest.react, "documented react exports").toEqual(expect.arrayContaining([
        "HeroCard",
        "PoweredBy",
        "Table",
        "Text",
        "formatCellText",
        "formatMetricValue",
      ]));
      expect(manifest.extension, "documented extension exports").toEqual(expect.arrayContaining([
        "defineRenderer",
        "isRendererComponent",
        "rendererMetaOf",
      ]));
      expect(manifest.host, "documented host export").toEqual(expect.arrayContaining(["reportHost"]));
      expect(manifest.builtIn, "documented built-in exports").toEqual(expect.arrayContaining([
        "attemptDetailRoute",
        "attemptDetailTarget",
        "experimentDetailRoute",
        "experimentDetailTarget",
        "libraryDetailRoute",
        "standard",
        "standardAttemptPage",
        "standardExperimentPage",
        "standardOverviewPage",
      ]));

      for (const experimentId of ["classic/baseline", "classic/memory-a", "classic/memory-b"] as const) {
        const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
        expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      }
      const mainRun = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(mainRun.expReceipt(), mainRun.diagnostic()).toMatchObject({ completion: "completed" });

      const shown = await niceeval.run(["show", "--report", "./reports/classic.tsx"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("MemoryBench Classic");
      expect(shown.stdout).toContain("Leaderboard");
      expect(shown.stdout).toContain("classic/memory-b");

      const projected = await niceeval.run(["show", "--report", "./reports/classic.tsx", "--json"]);
      expect(projected.exitCode, projected.diagnostic()).toBe(0);
      const projectionManifest = projected.json<{
        readonly format: "niceeval.report-target-execution/v1";
        readonly projections: {
          readonly format: "niceeval.report-projections/v1";
          readonly pricingProfile: {
            readonly currency: string;
            readonly contentIdentity: string;
            readonly provenance: { readonly source: string };
          };
          readonly costs: readonly {
            readonly page: { readonly pageId: string; readonly route: string };
            readonly measureId: string;
            readonly row: { readonly key: string; readonly dimensions: Record<string, unknown> };
            readonly profileIdentity: string;
            readonly projection: {
              readonly profile: { readonly contentIdentity: string };
              readonly state: "available" | "partial" | "unavailable";
              readonly basis: "observed" | "estimated" | "mixed" | "unavailable";
              readonly combined: { readonly amount: string } | null;
            };
          }[];
        };
      }>();
      expect(projectionManifest.format).toBe("niceeval.report-target-execution/v1");
      expect(projectionManifest.projections.format).toBe("niceeval.report-projections/v1");
      expect(projectionManifest.projections.pricingProfile).toMatchObject({
        currency: "USD",
        provenance: { source: expect.stringMatching(/^NiceEval vendored models\.dev catalog sha256:[a-f0-9]{64}$/) },
      });
      expect(Object.keys(projectionManifest.projections.pricingProfile).sort()).toEqual([
        "contentIdentity",
        "coverage",
        "currency",
        "display",
        "provenance",
      ]);
      expect(projectionManifest.projections.costs.length).toBeGreaterThan(0);
      const projectionKeys = projectionManifest.projections.costs.map((entry) => [
        entry.page.route,
        entry.page.pageId,
        entry.measureId,
        entry.row.key,
        entry.profileIdentity,
      ] as const);
      expect(projectionKeys).toEqual([...projectionKeys].sort((left, right) =>
        Buffer.compare(Buffer.from(left.join("\u0000")), Buffer.from(right.join("\u0000"))),
      ));
      for (const entry of projectionManifest.projections.costs) {
        expect(Object.keys(entry).sort()).toEqual([
          "measureId",
          "page",
          "profileIdentity",
          "projection",
          "row",
        ]);
        expect(Object.keys(entry.page).sort()).toEqual(["pageId", "route"]);
        expect(Object.keys(entry.row).sort()).toEqual(["dimensions", "key"]);
        expect(entry.profileIdentity).toBe(entry.projection.profile.contentIdentity);
      }
      const estimatedCost = projectionManifest.projections.costs.find((entry) =>
        entry.projection.state === "available" &&
        entry.projection.basis === "estimated" &&
        entry.projection.combined !== null
      );
      expect(estimatedCost, "token-priced Direct Agent usage must produce an estimate").toBeDefined();
      expect(Number(estimatedCost!.projection.combined!.amount)).toBeGreaterThan(0);

      // A second physical package copy must remain recognizable without
      // carrying executable producer callbacks across the package boundary.
      const duplicateModules = join(projectRoot, "reports", "node_modules");
      await mkdir(duplicateModules, { recursive: true });
      await cp(
        join(projectRoot, "node_modules", "niceeval"),
        join(duplicateModules, "niceeval-duplicate"),
        { recursive: true, dereference: true },
      );
      await writeFile(
        join(projectRoot, "reports", "duplicate-standard.mjs"),
        'export { standard as default } from "niceeval-duplicate/report/built-in";\n',
        "utf8",
      );
      await writeFile(
        join(projectRoot, "reports", "duplicate-standard.cjs"),
        'module.exports = require("niceeval-duplicate/report/built-in").standard;\n',
        "utf8",
      );
      for (const module of ["duplicate-standard.mjs", "duplicate-standard.cjs"] as const) {
        const duplicate = await niceeval.run(["show", "--report", `./reports/${module}`, "--json"]);
        expect(duplicate.exitCode, duplicate.diagnostic()).toBe(0);
        expect(duplicate.json<{ format: string; data: { kind: string } }>()).toMatchObject({
          format: "niceeval.show",
          data: { kind: "groups" },
        });
      }

      // A globally recognizable Symbol is not enough: the loader accepts only
      // defineReport's frozen v2 normalized shape and rejects v1 outright.
      await writeFile(
        join(projectRoot, "reports", "forged-report-v2.mjs"),
        `const report = {
  kind: "report",
  pricing: null,
  head: [],
  pages: [{ id: "overview", path: "/", title: "forged", navigation: true, render: () => null }],
};
Object.defineProperty(report, Symbol.for("niceeval.report.definition/v2"), {
  value: Object.freeze({ version: 2, kind: "report" }), enumerable: false, writable: false, configurable: false,
});
export default report;
`,
        "utf8",
      );
      await writeFile(
        join(projectRoot, "reports", "forged-report-v1.mjs"),
        `const report = { kind: "report", pricing: null, head: Object.freeze([]), pages: Object.freeze([]) };
Object.defineProperty(report, Symbol.for("niceeval.report.definition/v1"), {
  value: Object.freeze({ version: 1, kind: "report" }), enumerable: false, writable: false, configurable: false,
});
export default Object.freeze(report);
`,
        "utf8",
      );
      for (const module of ["forged-report-v2.mjs", "forged-report-v1.mjs"] as const) {
        const forged = await niceeval.run(["show", "--report", `./reports/${module}`]);
        expect(forged.exitCode, forged.diagnostic()).not.toBe(0);
        expect(`${forged.stdout}\n${forged.stderr}`).toContain("report-module-invalid-report");
      }

      const exported = await niceeval.run([
        "view",
        "--report",
        "./reports/classic.tsx",
        "--out",
        "classic-export",
        "--no-open",
      ]);
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

      const exportRoot = join(projectRoot, "classic-export");
      const shell = await readFile(join(exportRoot, "index.html"), "utf8");
      expect(shell).toContain('src="_niceeval/app.js"');
      expect(shell).not.toContain(projectRoot);
      expect(shell).not.toContain(".niceeval/");
    },
  );
});
