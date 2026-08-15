// owner: docs/engineering/testing/e2e/report.md#report-show-json
// rerun: pnpm e2e --repo report -- --run test/report-show.test.ts

import { only } from "@niceeval/testkit";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  closedTerminalBoxes,
  reportCaseArtifacts,
  reportE2E,
  runReportPty,
  terminalBoxContaining,
  terminalBoxRows,
  terminalTextSequence,
} from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
}

interface MetricDocument {
  readonly value: number | null;
  readonly samples: number;
  readonly total: number;
  readonly basis: "eval" | "attempt";
  readonly refs: readonly string[];
}

interface LeaderboardDocument {
  readonly scoring: "pass" | "score" | "mixed";
  readonly passRate: MetricDocument;
  readonly totalScore: MetricDocument;
  readonly costUSD: MetricDocument;
  readonly evals: number;
  readonly attempts: number;
  readonly experiments: readonly ({
    readonly experimentId: string;
    readonly scoring: "pass" | "score" | "mixed";
    readonly passRate: MetricDocument;
    readonly totalScore: MetricDocument;
    readonly costUSD: MetricDocument;
    readonly evals: number;
  })[];
}

interface ShowDocument {
  format: string;
  schemaVersion?: number;
  view?: string;
  sample?: {
    experiments?: readonly string[];
    denominator?: number;
    slotCount?: number;
  };
  problemTable?: readonly unknown[];
  data?: AttemptCalculation | unknown;
}

interface Evidence<Value> {
  state: string;
  value?: Value;
}

interface AttemptCalculation {
  state: string;
  inputState?: string;
  problemIds: readonly number[];
  value?: {
    kind: string;
    identity: {
      locator: string;
      selectedRunId: string;
      originRunId: string;
      slotId: string;
      memberRelation: string;
    };
    evaluation: Evidence<{
      experimentId: string;
      evalId: string;
      attempt: number;
      kind: string;
    }>;
    assertions: Evidence<{
      entries: readonly { entry?: { result?: { state?: string } } }[];
    }>;
    verdict: Evidence<string>;
    score: Evidence<unknown>;
    conversation: Evidence<{
      collection: { state: string };
      items: readonly { kind?: string; role?: string; text?: string }[];
    }>;
    commands: Evidence<{
      collection: { state: string };
      commands: readonly unknown[];
    }>;
    usage: Evidence<{ collection: { state: string }; observations: readonly unknown[] }>;
    timing: Evidence<{ collection: { state: string }; intervals: readonly unknown[] }>;
    diagnostics: Evidence<{ collection: { state: string }; diagnostics: readonly unknown[] }>;
  };
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
        ["score", "passed"],
        ["tool-call", "passed"],
      ]);

      const failed = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "deliberate-fail" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(failed.locator, run.diagnostic()).toBeTruthy();
      const scored = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "score" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(scored.locator, run.diagnostic()).toBeTruthy();
      const junit = await readFile(join(projectRoot, "junit", "main.xml"), "utf8");
      expect(junit).toContain("<failure");
      expect(junit).toContain("<error");

      const overview = await niceeval.run(["show"]);
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      expect(overview.stdout).toContain("NiceEval");
      expect(overview.stdout).toContain("Pass rate");
      expect(overview.stdout).toContain("Experiment");
      expect(overview.stdout).not.toContain("Report default-overview");
      expect(overview.stdout).not.toContain("Slot denominator");
      expect(overview.stdout).not.toMatch(/[╭╰]/);

      const niceevalBin = join(projectRoot, "node_modules", ".bin", "niceeval");
      const terminal = await runReportPty(
        [niceevalBin, "show"],
        {
          columns: 120,
          rows: 40,
          cwd: projectRoot,
          env: { TERM: "dumb", NO_COLOR: undefined, FORCE_COLOR: undefined },
          timeoutMs: 60_000,
        },
      );
      expect(terminal.exitCode, terminal.diagnostic()).toBe(0);
      const boxes = closedTerminalBoxes(terminal.stdout);
      const summaryBox = terminalBoxContaining(boxes, ["Pass rate", "Eval results"]);
      const experimentsBox = terminalBoxContaining(boxes, ["Experiment", "Model", "Record"]);
      expect(summaryBox).toContain("1 passed · 1 failed · 1");
      expect(summaryBox).toContain("scored · 1 errored");
      expect(terminalBoxRows(summaryBox)).toEqual(expect.arrayContaining([
        ["Attempts", "Eval results", "Total cost"],
        ["4", expect.stringContaining("1 passed · 1 failed"), "$0.04"],
      ]));
      expect(experimentsBox).toContain("deliberate-fail");
      expect(experimentsBox).toContain("score");
      expect(experimentsBox).toContain("tool-call");

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
      const attemptDocument = attemptJson.json<ShowDocument>();
      expect(attemptDocument.format).toBe("niceeval.show");
      expect(attemptDocument.view).toBe("attempt");
      const attemptData = attemptDocument.data as AttemptCalculation;
      expect(attemptData).toMatchObject({
        state: "available",
        inputState: "complete",
        problemIds: [],
        value: {
          kind: "attempt",
          identity: {
            locator: failed.locator,
            memberRelation: "origin",
          },
          evaluation: {
            state: "available",
            value: {
              experimentId: "main",
              evalId: "deliberate-fail",
              attempt: 0,
              kind: "pass",
            },
          },
          verdict: { state: "available", value: "failed" },
          score: { state: "not-applicable" },
          conversation: { state: "available", value: { collection: { state: "complete" } } },
          commands: {
            state: "available",
            value: { collection: { state: "complete" }, commands: [] },
          },
          usage: { state: "available", value: { collection: { state: "complete" } } },
          timing: { state: "available", value: { collection: { state: "complete" } } },
          diagnostics: { state: "available", value: { collection: { state: "complete" } } },
        },
      });
      const attemptValue = attemptData.value!;
      expect(attemptValue.identity.selectedRunId).toBe(attemptValue.identity.originRunId);
      expect(attemptValue.identity.slotId).toMatch(/^slot-/);
      expect(attemptValue.assertions.value?.entries.map((entry) => entry.entry?.result?.state)).toContain(
        "mismatched",
      );
      expect(attemptValue.conversation.value?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "message",
          role: "assistant",
          text: "Deterministic report fixture response.",
        }),
      ]));

      const classicAttempt = await niceeval.run([
        "show",
        scored.locator!,
        "--report",
        "./reports/classic-attempt.tsx",
      ]);
      expect(classicAttempt.exitCode, classicAttempt.diagnostic()).toBe(0);
      const compactAttempt = classicAttempt.stdout.replace(/\s/g, "");
      expect(compactAttempt).toContain('"evaluationKind":"score"');
      expect(compactAttempt).toContain('"historical":false');
      expect(compactAttempt).toContain('"assertions":{"state":"available"');
      expect(compactAttempt).toContain('"label":"deterministicreportscore"');
      expect(compactAttempt).toContain('"score":{"state":"available","value":{"state":"complete","earned":7');

      const shown = await niceeval.run(
        ["show", "--json"],
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const document = shown.json<ShowDocument>();
      expect(document.format).toBe("niceeval.show");
      expect(document.schemaVersion).toBe(1);
      expect(document.view).toBe("leaderboard");
      expect(document.sample?.experiments).toEqual(["main"]);
      expect(document.sample?.denominator).toBe(4);
      expect(document.sample?.slotCount).toBe(4);
      expect(document.problemTable).toEqual([]);
      const leaderboard = document.data as LeaderboardDocument;
      expect(leaderboard).toMatchObject({
        scoring: "mixed",
        evals: 4,
        attempts: 4,
        passRate: { value: 1 / 3, samples: 3, total: 3, basis: "eval" },
        totalScore: { value: 7, samples: 1, total: 1, basis: "eval" },
        costUSD: { samples: 2, total: 4, basis: "eval" },
        experiments: [{
          experimentId: "main",
          scoring: "mixed",
          evals: 4,
          passRate: { value: 1 / 3, samples: 3, total: 3, basis: "eval" },
          totalScore: { value: 7, samples: 1, total: 1, basis: "eval" },
          costUSD: { samples: 2, total: 4, basis: "eval" },
        }],
      });
      const locators = evals.flatMap((event) => event.locator === undefined ? [] : [event.locator]);
      expect([...leaderboard.costUSD.refs].sort()).toEqual([...locators].sort());
      expect(leaderboard.totalScore.refs).toEqual([scored.locator]);
      expect(leaderboard.passRate.refs).not.toContain(scored.locator);

      const forbidden = await niceeval.run(
        ["show", "--report", "./reports/site.tsx", "--json"],
      );
      expect(forbidden.exitCode, forbidden.diagnostic()).not.toBe(0);
      expect(forbidden.stderr).toContain("--json cannot combine with --report");

      const forbiddenPage = await niceeval.run(
        [
          "show",
          "--json",
          "--page",
          "/",
          "--record",
          join(projectRoot, "record-that-does-not-exist"),
        ],
      );
      expect(forbiddenPage.exitCode, forbiddenPage.diagnostic()).not.toBe(0);
      expect(forbiddenPage.stderr).toContain("--json cannot combine with --page");
      expect(forbiddenPage.stderr).not.toContain("record-bootstrap-invalid");

      const custom = await niceeval.run(
        [
          "show",
          "--report",
          "./reports/site.tsx",
          "--page",
          "/",
        ],
      );
      expect(custom.exitCode, custom.diagnostic()).toBe(0);
      expect(custom.stdout).toContain("Report fixture");
      expect(custom.stdout).toContain("Fixture copy block");

      const customAuthor = await niceeval.run([
        "show",
        "--report",
        "./reports/site.tsx",
        "--page",
        "author-api",
      ]);
      expect(customAuthor.exitCode, customAuthor.diagnostic()).toBe(0);
      const primitiveSequence = ["Primitive children", "primitive-alpha", "42", "primitive-omega"];
      expect(terminalTextSequence(customAuthor.stdout, primitiveSequence)).toEqual(primitiveSequence);

      const invalidLocale = await niceeval.run([
        "show",
        "--report",
        "./reports/invalid-localized-text.tsx",
      ]);
      expect(invalidLocale.exitCode, invalidLocale.diagnostic()).toBe(0);
      expect(invalidLocale.stdout).toContain("page-execution-failed");
      expect(invalidLocale.stdout).not.toContain("Incomplete locale map must not render");

      const reservedRoute = await niceeval.run([
        "show",
        "--report",
        "./reports/reserved-route.ts",
      ]);
      expect(reservedRoute.exitCode, reservedRoute.diagnostic()).not.toBe(0);
      expect(reservedRoute.stderr).toContain("ReportModuleLoadError");
      expect(reservedRoute.stderr).not.toContain("RESERVED_ROUTE_AUTHOR_CALLBACK_RAN");
    },
  );
});
