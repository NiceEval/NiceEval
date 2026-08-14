// owner: docs/engineering/testing/e2e/report.md#report-show-json
// rerun: pnpm e2e --repo report -- --run test/report-show.test.ts

import { only } from "@niceeval/testkit";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
}

interface ShowDocument {
  format: string;
}

test("show 从一次固定 ReportExecution 呈现内建与自定义报告", async () => {
  await reportE2E.case(
    "show",
    { artifacts: reportCaseArtifacts(["junit"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      await mkdir(join(projectRoot, "junit"), { recursive: true });
      const run = await niceeval.run(
        ["exp", "main", "--rerun", "all", "--json", "--junit", "junit/main.xml"],
      );
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      expect(run.stderr).toBe("");

      const result = run.expReceipt();
      expect(result).toMatchObject({ completion: "completed" });
      const evals = run.ndjson<ExpEvent>().filter((event) => event.event === "eval");
      expect(evals.map((event) => [event.evalId, event.verdict]).sort()).toEqual([
        ["deliberate-error", "errored"],
        ["deliberate-fail", "failed"],
        ["tool-call", "passed"],
      ]);

      const failed = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "deliberate-fail" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(failed.locator, run.diagnostic()).toBeTruthy();
      const junit = await readFile(join(projectRoot, "junit", "main.xml"), "utf8");
      expect(junit).toContain("<failure");
      expect(junit).toContain("<error");

      const overview = await niceeval.run(["show"]);
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      expect(overview.stdout).toContain("Sample: 3 included / 3 slot(s) · 3 selected");
      expect(overview.stdout).toContain("analysis-missing");

      const attempt = await niceeval.run(
        ["show", failed.locator!],
      );
      expect(attempt.exitCode, attempt.diagnostic()).toBe(0);
      expect(attempt.stdout).toContain("Attempt overview");
      expect(attempt.stdout).toContain("Pass rate: 0 ratio");
      expect(attempt.stdout).toContain("Attempt identity");
      expect(attempt.stdout).toContain(failed.locator!);
      expect(attempt.stdout).toContain("Closed evidence");

      const attemptJson = await niceeval.run(
        ["show", failed.locator!, "--json"],
      );
      expect(attemptJson.exitCode, attemptJson.diagnostic()).toBe(0);
      expect(attemptJson.json<ShowDocument>().format).toBe("niceeval.report-show/v1");

      const shown = await niceeval.run(
        ["show", "--json"],
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const document = shown.json<ShowDocument>();
      expect(document.format).toBe("niceeval.report-show/v1");

      const custom = await niceeval.run(
        [
          "show",
          "--report",
          "./reports/site.ts",
          "--page",
          "/",
        ],
      );
      expect(custom.exitCode, custom.diagnostic()).toBe(0);
      expect(custom.stdout).toContain("Report fixture");
      expect(custom.stdout).toContain("Fixture copy block");
    },
  );
});
