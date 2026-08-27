// owner: docs/engineering/testing/e2e/report.md#show-terminal-review
// rerun: pnpm e2e test --repo report -- --run test/show-cli.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

function expectHumanText(stdout: string): void {
  expect(stdout.trim()).not.toBe("");
  expect(() => JSON.parse(stdout)).toThrow();
}

function expectInOrder(stdout: string, values: readonly string[]): void {
  let cursor = 0;
  for (const value of values) {
    const position = stdout.indexOf(value, cursor);
    expect(
      position,
      `expected ${JSON.stringify(value)} after byte ${cursor} in:\n${stdout}`,
    ).toBeGreaterThanOrEqual(cursor);
    cursor = position + value.length;
  }
}

interface FailedShowResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  diagnostic(): string;
}

function expectShowFailure(
  result: FailedShowResult,
  stderrValues: readonly string[],
): void {
  expect(result.exitCode, result.diagnostic()).not.toBe(0);
  expect(result.stdout, result.diagnostic()).toBe("");
  expect(result.stderr.trim(), result.diagnostic()).not.toBe("");
  for (const value of stderrValues) {
    expect(result.stderr, result.diagnostic()).toContain(value);
  }
}

function stableIdentity(stdout: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const identity = stdout.match(new RegExp(`^\\s*${escaped}\\s+(\\S+)\\s*$`, "mu"))?.[1];
  expect(identity, `expected ${label} in stable identity index:\n${stdout}`).toBeDefined();
  if (identity === undefined) throw new Error(`expected ${label} stable identity`);
  expect(identity).not.toMatch(/^(?:t\d+\.c\d+|cmd\d+)$/u);
  return identity;
}

test("用户从多个 Experiment 收据完整浏览 Show 总览、Run、Attempt 与确定性证据切面", async () => {
  await reportE2E.case(
    "show-terminal-review",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const mainExperimentId = "harness/canary";
      const alternateExperimentId = "install/canary";
      const mainProduced = await niceeval.run(["exp", mainExperimentId, "--rerun", "all", "--json"]);
      expect(mainProduced.exitCode, mainProduced.diagnostic()).toBe(0);
      expect(mainProduced.expReceipt(), mainProduced.diagnostic()).toMatchObject({ completion: "completed" });
      const mainRunId = only(mainProduced.expReceipt().runIds, () => true, mainProduced.diagnostic());
      const attempt = only(
        mainProduced.expEvalEvents(),
        (event) => event.evalId === "inspection",
        mainProduced.diagnostic(),
      );
      expect(attempt).toMatchObject({ verdict: "passed" });
      const locator = attempt.locator.startsWith("@") ? attempt.locator : `@${attempt.locator}`;

      const alternateProduced = await niceeval.run(["exp", alternateExperimentId, "--rerun", "all", "--json"]);
      expect(alternateProduced.exitCode, alternateProduced.diagnostic()).toBe(0);
      expect(alternateProduced.expReceipt(), alternateProduced.diagnostic()).toMatchObject({ completion: "completed" });
      const alternateRunId = only(
        alternateProduced.expReceipt().runIds,
        () => true,
        alternateProduced.diagnostic(),
      );
      const alternateAttempt = only(
        alternateProduced.expEvalEvents(),
        (event) => event.evalId === "inspection",
        alternateProduced.diagnostic(),
      );
      expect(alternateAttempt).toMatchObject({ verdict: "passed" });
      const alternateLocator = alternateAttempt.locator.startsWith("@")
        ? alternateAttempt.locator
        : `@${alternateAttempt.locator}`;

      const overview = await niceeval.run(["show"]);
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      expectHumanText(overview.stdout);
      expectInOrder(overview.stdout, ["Totals", "Experiments"]);
      expectInOrder(overview.stdout, ["harness", "Experiment", "Observed", "Pass rate", "Score", "canary"]);
      expectInOrder(overview.stdout, ["install", "Experiment", "Observed", "Pass rate", "Score", "canary"]);
      expect(overview.stdout).toContain(`Experiment ${mainExperimentId}`);
      expect(overview.stdout).toContain(`Experiment ${alternateExperimentId}`);
      expect(overview.stdout).toMatch(/Eval\s+Attempt\s+Score/u);
      expect(overview.stdout).not.toMatch(/\bAction\b|\bRelation\b|\(available\)/u);
      expect(overview.stdout).toContain(locator);
      expect(overview.stdout).toContain(alternateLocator);
      expect(overview.stdout).toMatch(new RegExp(`^\\s*inspection\\s+${locator}\\s+37\\.11\\s*$`, "mu"));
      expect(overview.stdout).toMatch(new RegExp(`^\\s*inspection\\s+${alternateLocator}\\s+37\\.11\\s*$`, "mu"));
      expect(overview.stdout).toContain("100%");

      const run = await niceeval.run(["show", "--run", mainRunId]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expectHumanText(run.stdout);
      expect(run.stdout).toContain(mainRunId);
      expectInOrder(run.stdout, [mainExperimentId, "inspection", locator]);

      const runs = await niceeval.run([
        "show",
        "--run",
        alternateRunId,
        "--run",
        mainRunId,
      ]);
      expect(runs.exitCode, runs.diagnostic()).toBe(0);
      expectHumanText(runs.stdout);
      expect(runs.stdout).toContain(`Run ${mainRunId}`);
      expect(runs.stdout).toContain(`Run ${alternateRunId}`);
      expect(runs.stdout).toContain(locator);
      expect(runs.stdout).toContain(alternateLocator);
      expect(runs.stdout.match(/^Run /gmu)).toHaveLength(2);

      const atomicRunsFailure = await niceeval.run([
        "show",
        "--run",
        mainRunId,
        "--run",
        "missing-run",
      ]);
      expectShowFailure(atomicRunsFailure, ["missing-run"]);

      const mainExperiment = await niceeval.run(["show", "--experiment", mainExperimentId]);
      expect(mainExperiment.exitCode, mainExperiment.diagnostic()).toBe(0);
      expectHumanText(mainExperiment.stdout);
      expect(mainExperiment.stdout).toContain(mainExperimentId);
      expect(mainExperiment.stdout).toContain(locator);
      expect(mainExperiment.stdout).not.toContain(alternateLocator);

      const experiments = await niceeval.run([
        "show",
        "--experiment",
        alternateExperimentId,
        "--experiment",
        mainExperimentId,
      ]);
      expect(experiments.exitCode, experiments.diagnostic()).toBe(0);
      expectHumanText(experiments.stdout);
      expect(experiments.stdout).toContain(mainExperimentId);
      expect(experiments.stdout).toContain(alternateExperimentId);
      expect(experiments.stdout).toContain(locator);
      expect(experiments.stdout).toContain(alternateLocator);

      const missingExperiment = await niceeval.run([
        "show",
        "--experiment",
        mainExperimentId,
        "--experiment",
        "does-not-exist",
      ]);
      expectShowFailure(missingExperiment, ["does-not-exist"]);

      const attemptOverview = await niceeval.run(["show", locator]);
      expect(attemptOverview.exitCode, attemptOverview.diagnostic()).toBe(0);
      expectHumanText(attemptOverview.stdout);
      expect(attemptOverview.stdout).toContain(locator);
      expectInOrder(attemptOverview.stdout, [mainExperimentId, "inspection", "Outcome", "Score", "Evidence"]);
      expect(attemptOverview.stdout).toContain("passed");
      expect(attemptOverview.stdout).toContain("Inspection tool occurrence");
      expect(attemptOverview.stdout).toContain("Compact score contribution");
      expect(attemptOverview.stdout).toContain("Mismatched Boolean contributes zero");
      expect(attemptOverview.stdout).toContain("Measurement contributes three points");
      expect(attemptOverview.stdout).toContain("Collection evidence remains bounded");
      expect(attemptOverview.stdout).toMatch(/assertions\s+(?:available|partial)\s+·\s+5 entries/u);
      expect(attemptOverview.stdout).toMatch(/coverage\s+.+/u);
      expect(attemptOverview.stdout).toMatch(/limitations\s+.+/u);
      expect(attemptOverview.stdout).toContain(`niceeval show ${locator} --source`);
      expect(attemptOverview.stdout).toContain(`niceeval show ${locator} --execution`);
      expect(attemptOverview.stdout).toContain(`niceeval show ${locator} --timing`);
      expect(attemptOverview.stdout).toContain(`niceeval show ${locator} --usage`);
      expect(attemptOverview.stdout).toContain(`niceeval show ${locator} --diff`);

      const source = await niceeval.run(["show", locator, "--source"]);
      expect(source.exitCode, source.diagnostic()).toBe(0);
      expectHumanText(source.stdout);
      expect(source.stdout).toContain("Captured source");
      expect(source.stdout).toContain("inspection.eval.ts");
      expect(source.stdout).toContain("Inspection tool occurrence");
      const sourceIdentity = source.stdout.match(/inspection\.eval\.ts · (\S+) · \d+ bytes/u)?.[1];
      expect(sourceIdentity, source.diagnostic()).toBeDefined();
      if (sourceIdentity === undefined) throw new Error("expected captured source identity");
      expect(source.stdout.split(sourceIdentity).length - 1).toBeGreaterThan(1);
      expect(source.stdout).toMatch(
        new RegExp(`Assertion source facts[\\s\\S]+mapped · ${sourceIdentity} · [0-9a-f]{64}`, "u"),
      );

      const execution = await niceeval.run(["show", locator, "--execution"]);
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      expectHumanText(execution.stdout);
      expect(execution.stdout).toContain(locator);
      expect(execution.stdout).toContain("Conversation · partial");
      expect(execution.stdout).toContain("Commands ·");
      expect(execution.stdout).toContain("Stable identities");
      expect(execution.stdout).toContain("inspection_fixture");
      expect(execution.stdout).toContain("inspection-tool-input");
      expect(execution.stdout).toContain("inspection-tool-result");
      const itemIdentity = stableIdentity(execution.stdout, "item");
      const toolIdentity = stableIdentity(execution.stdout, "tool occurrence");
      const commandIdentity = stableIdentity(execution.stdout, "command");
      expect(execution.stdout.split(itemIdentity).length - 1).toBeGreaterThan(1);
      expect(execution.stdout.split(toolIdentity).length - 1).toBeGreaterThan(1);
      expect(execution.stdout.split(commandIdentity).length - 1).toBeGreaterThan(1);

      const itemDetail = await niceeval.run([
        "show",
        locator,
        "--execution",
        "--expand",
        itemIdentity,
      ]);
      expect(itemDetail.exitCode, itemDetail.diagnostic()).toBe(0);
      expectHumanText(itemDetail.stdout);
      expect(itemDetail.stdout).toContain(locator);
      expect(itemDetail.stdout).toContain(itemIdentity);
      expect(itemDetail.stdout).toContain("item");

      const toolDetail = await niceeval.run([
        "show",
        locator,
        "--execution",
        "--expand",
        toolIdentity,
      ]);
      expect(toolDetail.exitCode, toolDetail.diagnostic()).toBe(0);
      expectHumanText(toolDetail.stdout);
      expect(toolDetail.stdout).toContain(locator);
      expect(toolDetail.stdout).toContain(toolIdentity);
      expect(toolDetail.stdout).toContain("inspection_fixture");
      expect(toolDetail.stdout).toContain("inspection-tool-input");
      expect(toolDetail.stdout).toContain("inspection-tool-result");

      const commandDetail = await niceeval.run([
        "show",
        locator,
        "--execution",
        "--expand",
        commandIdentity,
      ]);
      expect(commandDetail.exitCode, commandDetail.diagnostic()).toBe(0);
      expectHumanText(commandDetail.stdout);
      expect(commandDetail.stdout).toContain(locator);
      expect(commandDetail.stdout).toContain(commandIdentity);
      expect(commandDetail.stdout).toMatch(/invocation|command/iu);
      expect(commandDetail.stdout).toMatch(/outcome|exit/iu);

      const timing = await niceeval.run(["show", locator, "--timing"]);
      expect(timing.exitCode, timing.diagnostic()).toBe(0);
      expectHumanText(timing.stdout);
      expect(timing.stdout).toContain(locator);
      expect(timing.stdout).toMatch(/timing/iu);
      expect(timing.stdout).toContain("eval.run");

      const usage = await niceeval.run(["show", locator, "--usage"]);
      expect(usage.exitCode, usage.diagnostic()).toBe(0);
      expectHumanText(usage.stdout);
      expect(usage.stdout).toContain(locator);
      expect(usage.stdout).toMatch(/usage/iu);
      expect(usage.stdout).toMatch(/input(?: tokens)?\s+10/iu);
      expect(usage.stdout).toMatch(/output(?: tokens)?\s+5/iu);
      expect(usage.stdout).toMatch(/requests?\s+1/iu);

      const diff = await niceeval.run(["show", locator, "--diff"]);
      expect(diff.exitCode, diff.diagnostic()).toBe(0);
      expectHumanText(diff.stdout);
      expect(diff.stdout).toContain(locator);
      expect(diff.stdout).toMatch(/diff/iu);
      expect(diff.stdout).toContain("complete");
      expect(diff.stdout).toContain("inspection-agent-change.txt");
      expect(diff.stdout).toContain("created");

      const usageErrors: readonly {
        readonly argv: readonly string[];
        readonly stderr: readonly string[];
      }[] = [
        { argv: ["show", locator, "--source", "--execution"], stderr: ["--source", "--execution"] },
        { argv: ["show", locator, "--expand", itemIdentity], stderr: ["--expand", "--execution"] },
        { argv: ["show", locator, "--run", mainRunId], stderr: ["--run"] },
        { argv: ["show", locator, "--experiment", mainExperimentId], stderr: ["--experiment"] },
        { argv: ["show", locator, "--timing", "--usage"], stderr: ["--timing", "--usage"] },
        { argv: ["show", locator, "--source", "--diff"], stderr: ["--source", "--diff"] },
        { argv: ["show", locator, "--execution", "--expand", "item_missing"], stderr: ["item_missing"] },
        { argv: ["show", locator, "--execution", "--expand", "t1.c1"], stderr: ["stable", "itemId"] },
        { argv: ["show", locator, "--execution", "--expand", "cmd1"], stderr: ["stable", "commandId"] },
        { argv: ["show", locator, "--json"], stderr: ["--json"] },
        { argv: ["show", locator, "--report", "standard"], stderr: ["--report"] },
        { argv: ["show", "@does-not-exist"], stderr: ["does-not-exist"] },
      ];
      for (const usageError of usageErrors) {
        expectShowFailure(
          await niceeval.run([...usageError.argv]),
          usageError.stderr,
        );
      }
    },
  );
});
