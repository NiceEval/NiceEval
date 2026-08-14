// owner: docs/engineering/testing/e2e/report.md#report-show-json
// rerun: pnpm e2e --repo report -- --run test/report-show.test.ts

import { only, runProcess } from "@niceeval/testkit";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { closedTerminalBoxes, reportCaseArtifacts, reportE2E } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
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
      expect(overview.stdout).toContain("NiceEval");
      expect(overview.stdout).toContain("Pass rate");
      expect(overview.stdout).toContain("Experiment");
      expect(overview.stdout).not.toContain("Report default-overview");
      expect(overview.stdout).not.toContain("Slot denominator");
      expect(overview.stdout).not.toMatch(/[╭╰]/);

      const niceevalBin = join(projectRoot, "node_modules", ".bin", "niceeval");
      const terminal = await runProcess(
        [
          "script",
          "-q",
          "-e",
          "-c",
          `stty cols 120 rows 40; exec ${shellQuote(niceevalBin)} show`,
          "/dev/null",
        ],
        {
          cwd: projectRoot,
          env: { TERM: "dumb", NO_COLOR: undefined, FORCE_COLOR: undefined },
          timeoutMs: 60_000,
        },
      );
      expect(terminal.exitCode, terminal.diagnostic()).toBe(0);
      const boxes = closedTerminalBoxes(terminal.stdout);
      const summaryBox = boxes.find((box) => box.includes("Pass rate") && box.includes("Eval results"));
      const experimentsBox = boxes.find(
        (box) => box.includes("Experiment") && box.includes("Model") && box.includes("Record"),
      );
      expect(summaryBox, terminal.diagnostic()).toBeDefined();
      expect(summaryBox).toContain("1 passed · 1 failed · 1 errored");
      expect(experimentsBox, terminal.diagnostic()).toBeDefined();
      expect(experimentsBox).toContain("deliberate-fail");
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

      const shown = await niceeval.run(
        ["show", "--json"],
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const document = shown.json<ShowDocument>();
      expect(document.format).toBe("niceeval.show");
      expect(document.schemaVersion).toBe(1);
      expect(document.view).toBe("leaderboard");
      expect(document.sample?.experiments).toEqual(["main"]);
      expect(document.sample?.denominator).toBe(3);
      expect(document.sample?.slotCount).toBe(3);
      expect(document.problemTable).toEqual([]);

      const forbidden = await niceeval.run(
        ["show", "--report", "./reports/site.ts", "--json"],
      );
      expect(forbidden.exitCode, forbidden.diagnostic()).not.toBe(0);
      expect(forbidden.stderr).toContain("--json cannot combine with --report");

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
