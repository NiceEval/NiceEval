// owner: docs/engineering/testing/e2e/report.md#report-source-snapshot
// rerun: pnpm e2e test --repo report -- --run test/report-source.test.ts

import { only } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

interface ExpEvent {
  readonly event: string;
  readonly evalId?: string;
  readonly locator?: string;
}

interface SourceShowManifest {
  readonly format: "niceeval.report-target-execution/v1";
  readonly locale: "en";
  readonly page: {
    readonly route: string;
    readonly pageId: string;
    readonly title: string | Record<string, string>;
    readonly renderedText: string;
  };
  readonly downloads: readonly unknown[];
  readonly problems: readonly unknown[];
}

test("选中的 Source Page 从本轮 Record 呈现入口与导入断言快照", async () => {
  await reportE2E.case(
    "source",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "source", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const runId = only(run.expReceipt().runIds, () => true, run.diagnostic());
      only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "source-snapshot" && event.locator !== undefined,
        run.diagnostic(),
      );

      const entryPath = join(projectRoot, "evals", "source-snapshot.eval.ts");
      const assertionPath = join(projectRoot, "evals", "source-snapshot", "assertions.ts");
      const entry = await readFile(entryPath, "utf8");
      const assertions = await readFile(assertionPath, "utf8");
      expect(entry).toContain("ENTRY_SNAPSHOT_BEFORE");
      expect(assertions).toContain("IMPORTED_ASSERTION_SNAPSHOT_BEFORE");
      await writeFile(entryPath, entry.replace("ENTRY_SNAPSHOT_BEFORE", "ENTRY_SNAPSHOT_AFTER"), "utf8");
      await writeFile(
        assertionPath,
        assertions.replace("IMPORTED_ASSERTION_SNAPSHOT_BEFORE", "IMPORTED_ASSERTION_SNAPSHOT_AFTER"),
        "utf8",
      );

      const shown = await niceeval.run(
        ["show", "--run", runId, "--report", "./reports/site.tsx", "--page", "/source"],
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("Source fixture detail");
      expect(shown.stdout).toContain("evals/source-snapshot.eval.ts");
      expect(shown.stdout).toContain("evals/source-snapshot/assertions.ts");
      expect(shown.stdout).toContain("ENTRY_SNAPSHOT_BEFORE");
      expect(shown.stdout).toContain("IMPORTED_ASSERTION_SNAPSHOT_BEFORE");
      expect(shown.stdout).not.toContain("ENTRY_SNAPSHOT_AFTER");
      expect(shown.stdout).not.toContain("IMPORTED_ASSERTION_SNAPSHOT_AFTER");
      expect(shown.stdout).not.toContain(".niceeval/");
      expect(shown.stdout).not.toContain("sources.json");

      const json = await niceeval.run(
        ["show", "--run", runId, "--report", "./reports/site.tsx", "--page", "/source", "--json"],
      );
      expect(json.exitCode, json.diagnostic()).toBe(0);
      expect(json.stdout).not.toContain(projectRoot);
      expect(json.stdout).not.toContain(".niceeval/");
      expect(json.stdout).not.toContain("sources.json");
      const document = json.json<SourceShowManifest>();
      expect(document).toMatchObject({
        format: "niceeval.report-target-execution/v1",
        locale: "en",
        page: {
          route: "/source",
          pageId: "source",
          renderedText: expect.stringContaining("Source fixture detail"),
        },
        downloads: [],
        problems: [],
      });
      expect(document.page.renderedText).toContain("ENTRY_SNAPSHOT_BEFORE");
      expect(document.page.renderedText).toContain("IMPORTED_ASSERTION_SNAPSHOT_BEFORE");
      expect(document.page.renderedText).not.toContain("ENTRY_SNAPSHOT_AFTER");
      expect(document.page.renderedText).not.toContain("IMPORTED_ASSERTION_SNAPSHOT_AFTER");
    },
  );
});
