// owner: docs/engineering/testing/e2e/report.md#report-show-json
// rerun: pnpm e2e --repo report -- --run test/report-show.test.ts

import { only } from "@niceeval/testkit";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";
import { classicReportShowOracle } from "./report-show-oracle.ts";

interface ExpEvent {
  event: string;
  attempts?: number;
  evalId?: string;
  locator?: string;
  passed?: number;
  verdict?: string;
}

interface ShowDocument {
  format: string;
  pages?: readonly {
    state: string;
    route?: string;
    document?: Readonly<Record<string, unknown>>;
  }[];
}

const classicContract = classicReportShowOracle({
  transcript: `Classic Report fixture

Classic Report acceptance fixture
Read the Report contract: https://github.com/CorrectRoadH/niceeval

┌ Summary ─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
<last-run-line>
│Pass rate: 20.0% · coverage 5/5 eval                                                                                  │
│Experiments: 3 · coverage 3/3 eval                                                                                    │
│Evals: 5 · coverage 5/5 eval                                                                                          │
│Attempts: 7 · coverage 7/7 eval                                                                                       │
│Eval results: 1 passed / 3 failed / 1 errored · coverage 5/5 eval                                                     │
│Total cost: $0.10 · coverage 6/7 eval                                                                                 │
<run-range-line>
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

Pass rate(%) · higher is better
codex · baseline  ████████░░░░░░░░░░░░░░░░░░░░░░ 25.0% · coverage 4/4 eval
bub · baseline    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0.0% · coverage 1/1 eval

Experiments
x: Cost · y: Pass rate
0.33     │                                                               A│
         │                                                                │
         │                                                                │
         │                                                                │
         │                                                                │
0.15     │                                                                │
         │                                                                │
         │                                                                │
         │                                                                │
0        │A                                                               │
         └────────────────────────────────────────────────────────────────┘
          0.03 Cost 0.04
Key: A=Experiments
  A classic-baseline: x=$0.03, y=0.0%
  A classic-companion: x=$0.03, y=0.0%
  A main: x=$0.04, y=33.3%

Experiments
┌────────────────────────────┬────────┬────────┬──────┬─────────┬─────┬────────┬───────────────────────────────────────┐
│ Hierarchy                  │ Model  │ Agent  │ Avg… │ Pass r… │ To… │   Cost │ Record                                │
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-0>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-1>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-2>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-3>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-4>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-5>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-6>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-7>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-8>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-9>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-10>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-11>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-12>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-13>
├────────────────────────────┼────────┼────────┼──────┼─────────┼─────┼────────┼───────────────────────────────────────┤
<tree-row-14>
└────────────────────────────┴────────┴────────┴──────┴─────────┴─────┴────────┴───────────────────────────────────────┘
`,
});

test("show 从一次固定 ReportExecution 呈现内建与自定义报告", async () => {
  await reportE2E.case(
    "show",
    { artifacts: reportCaseArtifacts(["junit", "classic-static"]) },
    async ({ paths: { projectRoot }, commands: { niceeval, tsc } }) => {
      await Promise.all([
        copyFile(
          join(process.cwd(), "test/fixtures/classic-baseline.experiment.fixture"),
          join(projectRoot, "experiments/classic-baseline.ts"),
        ),
        copyFile(
          join(process.cwd(), "test/fixtures/classic-companion.experiment.fixture"),
          join(projectRoot, "experiments/classic-companion.ts"),
        ),
      ]);
      await mkdir(join(projectRoot, "junit"), { recursive: true });
      const typecheck = await tsc.run(["--noEmit"]);
      expect(typecheck.exitCode, typecheck.diagnostic()).toBe(0);

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

      const companionRun = await niceeval.run(
        ["exp", "classic-companion", "--rerun", "all", "--json"],
      );
      expect(companionRun.exitCode, companionRun.diagnostic()).not.toBe(0);
      const companionReceipt = companionRun.expReceipt();
      expect(companionReceipt).toMatchObject({ completion: "completed" });
      expect(companionRun.ndjson<ExpEvent>()).toContainEqual(expect.objectContaining({
        event: "eval",
        evalId: "deliberate-fail",
        attempts: 3,
        passed: 0,
        verdict: "failed",
      }));
      const companionAttempts = exactlyThreeLocators(
        companionRun.ndjson<ExpEvent>(),
        "deliberate-fail",
        companionRun.diagnostic(),
      );

      const baselineRun = await niceeval.run(
        ["exp", "classic-baseline", "--rerun", "all", "--json"],
      );
      expect(baselineRun.exitCode, baselineRun.diagnostic()).not.toBe(0);
      const baselineReceipt = baselineRun.expReceipt();
      expect(baselineReceipt).toMatchObject({ completion: "completed" });

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
      expect(overview.stdout).toContain("Sample: 3 run(s), 7 slot(s)");
      expect(overview.stdout).toContain("No slot problems");

      const attempt = await niceeval.run(
        ["show", failed.locator!],
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

      const classicJson = await niceeval.run([
        "show",
        "--report",
        "./reports/classic.tsx",
        "--page",
        "/",
        "--json",
      ]);
      expect(classicJson.exitCode, classicJson.diagnostic()).toBe(0);
      const classicDocument = classicJson
        .json<ShowDocument>()
        .pages?.find((page) => page.route === "/")?.document;
      const classicBindings = {
        runs: {
          baseline: only(baselineReceipt.runIds, () => true, baselineRun.diagnostic()),
          companion: only(companionReceipt.runIds, () => true, companionRun.diagnostic()),
          main: only(result.runIds, () => true, run.diagnostic()),
        },
        attempts: {
          baselineFail: locatorFor(baselineRun.ndjson<ExpEvent>(), "deliberate-fail", baselineRun.diagnostic()),
          companion: companionAttempts,
          mainError: locatorFor(evals, "deliberate-error", run.diagnostic()),
          mainFail: locatorFor(evals, "deliberate-fail", run.diagnostic()),
          mainTool: locatorFor(evals, "tool-call", run.diagnostic()),
        },
      } as const;
      const classicEvidence = classicContract.expectDocument(classicDocument, classicBindings);

      const explicitClassic = await niceeval.run([
        "show",
        "--run",
        classicBindings.runs.main,
        "--report",
        "./reports/classic.tsx",
        "--page",
        "/",
        "--json",
      ]);
      expect(explicitClassic.exitCode, explicitClassic.diagnostic()).toBe(0);
      const explicitDocument = explicitClassic
        .json<ShowDocument>()
        .pages?.find((page) => page.route === "/")?.document;
      classicContract.expectExplicitRunDocument(explicitDocument, classicBindings);

      const classicText = await niceeval.run(
        ["show", "--report", "./reports/classic.tsx", "--page", "/"],
        { env: { ...process.env, NO_COLOR: "1", COLUMNS: "120", LANG: "C.UTF-8" } },
      );
      expect(classicText.exitCode, classicText.diagnostic()).toBe(0);
      classicContract.expectTranscript(classicText.stdout, classicEvidence);

      const narrowClassic = await niceeval.run(
        ["show", "--report", "./reports/classic.tsx", "--page", "/"],
        { env: { ...process.env, NO_COLOR: "1", COLUMNS: "80", LANG: "C.UTF-8" } },
      );
      expect(narrowClassic.exitCode, narrowClassic.diagnostic()).toBe(0);
      expect(narrowClassic.stdout.split("\n").every((line) => Array.from(line).length <= 80)).toBe(true);
      expect(narrowClassic.stdout).toContain("Record: @");

      await copyFile(
        join(process.cwd(), "test/fixtures/classic-no-locale.config.fixture"),
        join(projectRoot, "niceeval.config.ts"),
      );
      const chineseClassic = await niceeval.run(
        ["show", "--report", "./reports/classic.tsx", "--page", "/"],
        {
          env: {
            ...process.env,
            NO_COLOR: "1",
            COLUMNS: "120",
            LC_ALL: "zh_CN.UTF-8",
            LC_MESSAGES: "zh_CN.UTF-8",
            LANG: "zh_CN.UTF-8",
          },
        },
      );
      expect(chineseClassic.exitCode, chineseClassic.diagnostic()).toBe(0);
      expect(chineseClassic.stdout).toContain("通过率(%)");
      expect(chineseClassic.stdout).toContain("实验");
      await copyFile(
        join(process.cwd(), "niceeval.config.ts"),
        join(projectRoot, "niceeval.config.ts"),
      );

      const classicStatic = await niceeval.run(
        [
          "view",
          "--report",
          "./reports/classic.tsx",
          "--out",
          "classic-static",
        ],
        { env: { ...process.env, LANG: "en_US.UTF-8" } },
      );
      expect(classicStatic.exitCode, classicStatic.diagnostic()).toBe(0);
      const classicHtml = await readFile(join(projectRoot, "classic-static/index.html"), "utf8");
      expect(classicHtml).toContain('<html lang="en">');
      expect(classicHtml).toContain("niceeval-report__document--classic-dashboard");
      expect(classicHtml).toContain("niceeval-report__scatter");
      expect(classicHtml).toContain("niceeval-report__tree-table");
      expect(classicHtml).toContain(classicBindings.attempts.mainTool);
      expect(classicHtml).not.toContain('href="#/attempt/');

      const invalidClassicLink = await niceeval.run([
        "show",
        "--report",
        "./reports/classic-invalid-link.tsx",
      ]);
      expect(invalidClassicLink.exitCode, invalidClassicLink.diagnostic()).not.toBe(0);
      expect(invalidClassicLink.stderr).toContain("https");
    },
  );
});

function exactlyThreeLocators(
  events: readonly ExpEvent[],
  evalId: string,
  diagnostic: string,
): readonly [string, string, string] {
  const locators = events
    .filter((event) => event.event === "failure" && event.evalId === evalId && event.locator !== undefined)
    .map((event) => event.locator!);
  expect(locators, diagnostic).toHaveLength(3);
  expect(new Set(locators).size, diagnostic).toBe(3);
  return locators as unknown as readonly [string, string, string];
}

function locatorFor(
  events: readonly ExpEvent[],
  evalId: string,
  diagnostic: string,
): string {
  return only(
    events,
    (event) => event.event === "eval" && event.evalId === evalId && event.locator !== undefined,
    diagnostic,
  ).locator!;
}
