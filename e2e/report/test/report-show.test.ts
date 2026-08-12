// owner: docs/engineering/testing/e2e/report.md#report-show-json
// rerun: pnpm e2e --repo report -- --run test/report-show.test.ts

import { command, only, withProjectCopy } from "@niceeval/testkit";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportArtifactStaging, reportProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
}

interface ShowDocument {
  format: string;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("show 从一次固定 ReportExecution 呈现内建与自定义报告", async () => {
  await withProjectCopy(
    reportProjectCopy,
    async ({ root }) => {
      await mkdir(join(root, "junit"), { recursive: true });
      const run = await niceeval.run(
        ["exp", "main", "--rerun", "all", "--json", "--junit", "junit/main.xml"],
        { cwd: root },
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
      const junit = await readFile(join(root, "junit", "main.xml"), "utf8");
      expect(junit).toContain("<failure");
      expect(junit).toContain("<error");

      const overview = await niceeval.run(["show", "--latest", "--record", ".niceeval/record"], { cwd: root });
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      expect(overview.stdout).toContain("Sample: 1 run(s), 3 slot(s)");
      expect(overview.stdout).toContain("No slot problems");

      const attempt = await niceeval.run(
        ["show", failed.locator!, "--record", ".niceeval/record"],
        { cwd: root },
      );
      expect(attempt.exitCode, attempt.diagnostic()).toBe(0);
      expect(attempt.stdout).toContain("Attempt overview");
      expect(attempt.stdout).toContain("Evaluation kind");
      expect(attempt.stdout).toContain("Verdict: failed");
      expect(attempt.stdout).toContain("Assertions");
      expect(attempt.stdout).toContain("mismatched");
      expect(attempt.stdout).not.toContain("unavailable input assertions");
      expect(attempt.stdout).not.toContain("unavailable input verdict");

      const attemptJson = await niceeval.run(
        ["show", failed.locator!, "--record", ".niceeval/record", "--json"],
        { cwd: root },
      );
      expect(attemptJson.exitCode, attemptJson.diagnostic()).toBe(0);
      expect(attemptJson.json<ShowDocument>().format).toBe("niceeval.report-show/v1");

      const shown = await niceeval.run(
        ["show", "--latest", "--record", ".niceeval/record", "--json"],
        { cwd: root },
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const document = shown.json<ShowDocument>();
      expect(document.format).toBe("niceeval.report-show/v1");

      const custom = await niceeval.run(
        [
          "show",
          "--latest",
          "--record",
          ".niceeval/record",
          "--report",
          "./reports/site.ts",
          "--page",
          "/",
        ],
        { cwd: root },
      );
      expect(custom.exitCode, custom.diagnostic()).toBe(0);
      expect(custom.stdout).toContain("Report fixture");
      expect(custom.stdout).toContain("Fixture copy block");
    },
    reportArtifactStaging("show", ["junit"]),
  );
});
