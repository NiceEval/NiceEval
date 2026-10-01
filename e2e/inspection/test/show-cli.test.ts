// rerun: pnpm e2e test --repo inspection -- --run test/show-cli.test.ts

import { only, waitForOutput, waitForPathOrProcessExit, type ProcessReceipt } from "@niceeval/testkit";
import { readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

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

function expectShowFailure(
  result: ProcessReceipt,
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

// @feature docs/feature/inspection/README.md
// @regression memory/inspection-overview-fixed-byte-limit.md
// @regression memory/show-overview-includes-stale-execution-identity.md
// @regression memory/show-score-outcomes-rendered-as-pass-rate.md

test("用户从多个 Experiment 收据完整浏览 Show 总览、Run、Attempt 与确定性证据切面", async () => {
  await inspectionE2E.case(
    "show-terminal-review",
    { artifacts: inspectionCaseArtifacts() },
    async ({ commands: { niceeval }, paths }) => {
      const mainExperimentId = "harness/canary";
      const alternateExperimentId = "harness/alternate";
      const scaleExperimentId = "harness/scale";
      const scoreOnlyExperimentId = "score-only";
      const mainProduced = await niceeval.run(["exp", mainExperimentId, "--rerun", "all", "--json"]);
      expect(mainProduced.exitCode, mainProduced.diagnostic()).toBe(0);
      expect(mainProduced.expReceipt(), mainProduced.diagnostic()).toMatchObject({ completion: "completed" });
      const mainRunId = only(mainProduced.expReceipt().createdRunIds, () => true, mainProduced.diagnostic());
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
        alternateProduced.expReceipt().createdRunIds,
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

      const scaleProduced = await niceeval.run([
        "exp",
        scaleExperimentId,
        "--rerun",
        "all",
        "--json",
      ]);
      expect(scaleProduced.exitCode, scaleProduced.diagnostic()).toBe(0);
      expect(scaleProduced.expReceipt(), scaleProduced.diagnostic()).toMatchObject({
        completion: "completed",
      });
      expect(scaleProduced.expEvalEvents(), scaleProduced.diagnostic()).toEqual([
        expect.objectContaining({
          evalId: "overview-scale",
          attempts: 10,
          passed: 10,
          verdict: "passed",
        }),
      ]);

      const passOnlyExperiment = await niceeval.run(["show", "--experiment", scaleExperimentId]);
      expect(passOnlyExperiment.exitCode, passOnlyExperiment.diagnostic()).toBe(0);
      expectHumanText(passOnlyExperiment.stdout);
      expect(passOnlyExperiment.stdout).toContain("Pass rate");
      expect(passOnlyExperiment.stdout).toContain("Eval overview-scale");
      expect(passOnlyExperiment.stdout).toMatch(/Attempt\s+Verdict\s+Duration/u);
      expect(passOnlyExperiment.stdout.match(/^\s*@\S+\s+passed\s+\d+(?:\.\d+)? (?:ms|s|min|h)\s*$/gmu)).toHaveLength(10);
      expect(passOnlyExperiment.stdout).not.toContain("Attempts hidden");
      expect(passOnlyExperiment.stdout).not.toContain("Score");
      expect(passOnlyExperiment.stdout).not.toContain("unsupported");

      const scoreOnlyProduced = await niceeval.run([
        "exp",
        scoreOnlyExperimentId,
        "--rerun",
        "all",
        "--json",
      ]);
      expect(scoreOnlyProduced.exitCode, scoreOnlyProduced.diagnostic()).not.toBe(0);
      expect(scoreOnlyProduced.expReceipt(), scoreOnlyProduced.diagnostic()).toMatchObject({
        completion: "completed",
      });
      expect(scoreOnlyProduced.expEvalEvents(), scoreOnlyProduced.diagnostic()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ evalId: "score", verdict: "passed" }),
          expect.objectContaining({ evalId: "overview/secondary", verdict: "passed" }),
          expect.objectContaining({ evalId: "score-error", verdict: "errored" }),
        ]),
      );

      const scoreOnlyExperiment = await niceeval.run([
        "show",
        "--experiment",
        scoreOnlyExperimentId,
      ]);
      expect(scoreOnlyExperiment.exitCode, scoreOnlyExperiment.diagnostic()).toBe(0);
      expectHumanText(scoreOnlyExperiment.stdout);
      expect(scoreOnlyExperiment.stdout).toMatch(/Observed\s+3\/3/u);
      expect(scoreOnlyExperiment.stdout).toMatch(/Verdicts\s+2 passed; 0 failed; 1 errored; 0 skipped/u);
      expect(scoreOnlyExperiment.stdout).toContain("Score");
      expect(scoreOnlyExperiment.stdout).toMatch(/Attempt\s+Verdict\s+Duration\s+Score/u);
      expect(scoreOnlyExperiment.stdout).not.toContain("Outcomes");
      expect(scoreOnlyExperiment.stdout).not.toContain("Pass rate");
      expect(scoreOnlyExperiment.stdout).not.toContain("passed Attempts hidden");

      const overviewRequestPath = join(paths.projectRoot, "overview-request.json");
      writeFileSync(
        overviewRequestPath,
        JSON.stringify({
          protocol: "niceeval.query/v1",
          operation: { kind: "overview.get" },
        }),
        "utf8",
      );
      const machineOverview = await niceeval.run([
        "query",
        "run",
        "--request",
        overviewRequestPath,
      ]);
      expect(machineOverview.exitCode, machineOverview.diagnostic()).toBe(0);
      expect(Buffer.byteLength(machineOverview.stdout, "utf8")).toBeGreaterThan(512 * 1024);

      const overview = await niceeval.run(["show", "--record", join(paths.projectRoot, ".niceeval", "record.sqlite")]);
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      expectHumanText(overview.stdout);
      expect(overview.stdout).toContain("Recorded results");
      expectInOrder(overview.stdout, ["Totals", "Experiments"]);
      expectInOrder(overview.stdout, [
        "harness",
        "Experiment",
        "Observed",
        "Pass rate",
        "Score",
        "alternate",
        "canary",
      ]);
      expect(overview.stdout).toContain(`Experiment ${mainExperimentId}`);
      expect(overview.stdout).toContain(`Experiment ${alternateExperimentId}`);
      expect(overview.stdout).toContain(`Experiment ${scaleExperimentId}`);
      expect(overview.stdout).toContain(`Experiment ${scoreOnlyExperimentId}`);
      expect(overview.stdout).toMatch(/Experiment\s+Observed\s+Adapter\s+Model\s+Score[\s\S]+score-only\s+3\/3/u);
      expect(overview.stdout).toMatch(/scale\s+10\/10\s+/u);
      expect(overview.stdout).toContain("passed Attempts hidden");
      expect(overview.stdout).toContain(
        `See more  niceeval show --experiment ${mainExperimentId}`,
      );
      expect(overview.stdout).not.toMatch(/\bAction\b|\bRelation\b|\(available\)/u);
      expect(overview.stdout).not.toContain(locator);
      expect(overview.stdout).not.toContain(alternateLocator);
      expect(overview.stdout).toContain("100%");

      const expandedOverview = await niceeval.run(["show", "--all", "--record", join(paths.projectRoot, ".niceeval", "record.sqlite")]);
      expect(expandedOverview.exitCode, expandedOverview.diagnostic()).toBe(0);
      expectInOrder(expandedOverview.stdout, [`Experiment ${mainExperimentId}`, "Eval inspection", locator]);
      expectInOrder(expandedOverview.stdout, [`Experiment ${alternateExperimentId}`, "Eval inspection", alternateLocator]);
      expect(expandedOverview.stdout).toMatch(/Attempt\s+Verdict\s+Duration\s+Score/u);
      expect(expandedOverview.stdout).toMatch(new RegExp(`^\\s*${locator}\\s+passed\\s+\\d+(?:\\.\\d+)? (?:ms|s|min|h)\\s+37\\.11\\s+\\(scored\\)\\s*$`, "mu"));
      expect(expandedOverview.stdout).toMatch(new RegExp(`^\\s*${alternateLocator}\\s+passed\\s+\\d+(?:\\.\\d+)? (?:ms|s|min|h)\\s+37\\.11\\s+\\(scored\\)\\s*$`, "mu"));

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
        { argv: ["show", locator, "--all"], stderr: ["--all"] },
        { argv: ["show", "--run", mainRunId, "--all"], stderr: ["--all", "--run"] },
        { argv: ["show", "--experiment", mainExperimentId, "--all"], stderr: ["--all", "--experiment"] },
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

      const evalPath = join(paths.projectRoot, "evals", "inspection.eval.ts");
      const evalSource = readFileSync(evalPath, "utf8");
      expect(evalSource).toContain("inspection-fixture");
      writeFileSync(
        evalPath,
        evalSource.replace("inspection-fixture", "inspection-fixture-after-review"),
        "utf8",
      );

      const changedPlan = await niceeval.run(["exp", mainExperimentId, "--dry"]);
      expect(changedPlan.exitCode, changedPlan.diagnostic()).toBe(0);
      expect(changedPlan.stdout).toContain("identity-mismatch");
      expect(changedPlan.stdout).toContain(`niceeval accept ${locator}`);

      const historicalOverview = await niceeval.run(["show", "--all", "--record", join(paths.projectRoot, ".niceeval", "record.sqlite")]);
      expect(historicalOverview.exitCode, historicalOverview.diagnostic()).toBe(0);
      expectHumanText(historicalOverview.stdout);
      expectInOrder(historicalOverview.stdout, ["Totals", "Experiments"]);
      expectInOrder(historicalOverview.stdout, [
        "harness",
        "Experiment",
        "Observed",
        "Pass rate",
        "Score",
        "alternate",
        "canary",
      ]);
      expect(historicalOverview.stdout).toContain(`Experiment ${mainExperimentId}`);
      expect(historicalOverview.stdout).toContain(`Experiment ${alternateExperimentId}`);
      expect(historicalOverview.stdout).toContain(locator);
      expect(historicalOverview.stdout).toContain(alternateLocator);
      expect(historicalOverview.stdout).toMatch(
        new RegExp(`^\\s*${locator}\\s+passed\\s+\\d+(?:\\.\\d+)? (?:ms|s|min|h)\\s+37\\.11\\s+\\(scored\\)\\s*$`, "mu"),
      );
      expect(historicalOverview.stdout).toMatch(
        new RegExp(`^\\s*${alternateLocator}\\s+passed\\s+\\d+(?:\\.\\d+)? (?:ms|s|min|h)\\s+37\\.11\\s+\\(scored\\)\\s*$`, "mu"),
      );
      expect(historicalOverview.stdout).not.toContain("Observed   0/0");
    },
  );
// This journey starts dozens of public CLI processes. CI's successful run took
// 109s, so the repository's 120s default leaves too little scheduling headroom.
}, 180_000);

// @feature docs/feature/inspection/README.md
test.concurrent("默认 Show 按当前声明区分可用结果、缺口和历史，求值失败仍能固定读取历史", async () => {
  await inspectionE2E.case(
    "show-current-results",
    { artifacts: inspectionCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      rmSync(join(projectRoot, "evals"), { recursive: true });
      rmSync(join(projectRoot, "experiments"), { recursive: true });
      mkdirSync(join(projectRoot, "evals", "current"), { recursive: true });
      mkdirSync(join(projectRoot, "experiments"));
      const experimentPath = join(projectRoot, "experiments", "current.ts");
      writeFileSync(experimentPath, `
import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { appendFileSync } from "node:fs";
const agent = defineAgent({
  name: "current-results-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  send: async () => {
    appendFileSync("agent-calls.txt", "send\\n");
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "accepted" }] };
  },
});
export default defineExperiment({
  agent, evals: ["current/"],
  setup: async () => { appendFileSync("hook-calls.txt", "setup\\n"); },
  teardown: async () => { appendFileSync("hook-calls.txt", "teardown\\n"); },
});
`, "utf8");
      for (const [name, expected] of [["first", "accepted"], ["changed", "accepted"], ["failed", "rejected"]]) {
        writeFileSync(join(projectRoot, "evals", "current", `${name}.eval.ts`), `
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";
export default defineEval({ async test(t) {
  const reply = await t.send("current result");
  t.check(reply.message, equals(${JSON.stringify(expected)}));
} });
`, "utf8");
      }
      const requestPath = join(projectRoot, "project.request.json");
      writeFileSync(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "project.get" } }), "utf8");
      const beforeRun = await niceeval.run(["show"]);
      expect(beforeRun.exitCode, beforeRun.diagnostic()).toBe(0);
      expect(beforeRun.stdout).toMatch(/Covered\s+0\/3/u);
      expect(beforeRun.stdout).toMatch(/Gaps\s+3/u);
      expect(beforeRun.stdout).toContain("Gap no-result");
      expect(existsSync(join(projectRoot, ".niceeval", "record.sqlite"))).toBe(false);
      expect(existsSync(join(projectRoot, "agent-calls.txt"))).toBe(false);
      expect(existsSync(join(projectRoot, "hook-calls.txt"))).toBe(false);

      const produced = await niceeval.run(["exp", "current", "--json"]);
      expect(produced.exitCode, produced.diagnostic()).not.toBe(0);
      expect(produced.expReceipt(), produced.diagnostic()).toMatchObject({ completion: "completed" });
      const runId = only(produced.expReceipt().createdRunIds, () => true, produced.diagnostic());
      const changedEvent = only(produced.expEvalEvents(), (event) => event.evalId === "current/changed", produced.diagnostic());
      const firstEvent = only(produced.expEvalEvents(), (event) => event.evalId === "current/first", produced.diagnostic());
      const failedEvent = only(produced.expEvalEvents(), (event) => event.evalId === "current/failed", produced.diagnostic());
      const changedLocator = changedEvent.locator.startsWith("@") ? changedEvent.locator : `@${changedEvent.locator}`;
      const firstLocator = firstEvent.locator.startsWith("@") ? firstEvent.locator : `@${firstEvent.locator}`;
      const failedLocator = failedEvent.locator.startsWith("@") ? failedEvent.locator : `@${failedEvent.locator}`;
      const agentCalls = readFileSync(join(projectRoot, "agent-calls.txt"), "utf8");
      const hookCalls = readFileSync(join(projectRoot, "hook-calls.txt"), "utf8");
      expect(agentCalls.trim().split("\n")).toHaveLength(3);
      const portable = join(projectRoot, "portable.sqlite");
      copyFileSync(join(projectRoot, ".niceeval", "record.sqlite"), portable);

      const complete = await niceeval.run(["show"]);
      expect(complete.exitCode, complete.diagnostic()).toBe(0);
      expect(complete.stdout).toMatch(/Covered\s+3\/3/u);
      expect(complete.stdout).toMatch(/Gaps\s+0/u);
      expect(complete.stdout).not.toContain("Next:");

      const changedPath = join(projectRoot, "evals", "current", "changed.eval.ts");
      writeFileSync(changedPath, readFileSync(changedPath, "utf8").replace("current result", "new current result"), "utf8");
      writeFileSync(join(projectRoot, "evals", "current", "new.eval.ts"), `
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";
export default defineEval({ test(t) { t.check("accepted", equals("accepted")); } });
`, "utf8");
      const current = await niceeval.run(["show"]);
      expect(current.exitCode, current.diagnostic()).toBe(0);
      expectHumanText(current.stdout);
      expectInOrder(current.stdout, ["Current results", "Covered", "2/4", "Gaps", "2", "Experiments", "Attempts · current", "Gap identity-mismatch", `Previous result ${changedLocator}`, "Gap no-result", failedLocator, "1 passed Attempts hidden", "Next: niceeval exp current --dry"]);
      expect(current.stdout).toMatch(/Verdicts\s+1 passed; 1 failed; 0 errored; 0 skipped/u);
      expect(current.stdout).toMatch(/Pass rate\s+50% \(partial\)/u);
      expect(current.stdout).not.toContain(firstLocator);
      expect(current.stdout).not.toContain("Observed");
      const expanded = await niceeval.run(["show", "--all"]);
      expect(expanded.exitCode, expanded.diagnostic()).toBe(0);
      expect(expanded.stdout).toContain(firstLocator);
      expect(expanded.stdout).toContain(failedLocator);
      expect(expanded.stdout).not.toContain("Attempts hidden");

      const queried = await niceeval.run(["query", "run", "--request", requestPath]);
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      const project = queried.querySuccess("project.get").project;
      expect(project.targetIdentity).not.toBe("");
      expect(project.coverage).toEqual({ expected: 4, covered: 2, gaps: 2 });
      expect(project.slots).toEqual(expect.arrayContaining([
        expect.objectContaining({ experimentId: "current", evalId: "current/changed", state: "gap", reason: "identity-mismatch", sourceRunId: runId, previous: { sourceRunId: runId, locator: changedLocator } }),
        expect.objectContaining({ experimentId: "current", evalId: "current/new", state: "gap", reason: "no-result", sourceRunId: null, previous: null }),
        expect.objectContaining({ experimentId: "current", evalId: "current/failed", state: "reuse", locator: failedLocator, action: "executed", relation: "origin" }),
      ]));
      expect(project.totals.denominator).toMatchObject({ expected: 4, observed: 2, missing: 2 });
      expect(project.totals.verdict.passRate).toMatchObject({ value: 0.5, state: "partial", samples: 2, total: 4 });
      expect(project.history).toEqual([]);
      const explained = await niceeval.run(["query", "explain", "--request", requestPath]);
      expect(explained.exitCode, explained.diagnostic()).toBe(0);
      expect(explained.queryExplanation("project.get").factKinds).toContain("current-project");

      const dry = await niceeval.run(["exp", "current", "--dry", "--json"]);
      expect(dry.exitCode, dry.diagnostic()).toBe(0);
      const plan = decodeExpPlanDocument(JSON.parse(dry.stdout));
      expect(plan).toMatchObject({ total: 4, reused: 2 });
      expect(plan.matrix.flatMap((row) => row.slots)).toEqual(expect.arrayContaining([
        expect.objectContaining({ evalId: "current/changed", state: "gap", reason: "identity-mismatch" }),
        expect.objectContaining({ evalId: "current/new", state: "gap", reason: "no-source-run" }),
      ]));
      const forced = await niceeval.run(["exp", "current", "--dry", "--rerun", "all", "--json"]);
      expect(forced.exitCode, forced.diagnostic()).toBe(0);
      expect(decodeExpPlanDocument(JSON.parse(forced.stdout))).toMatchObject({ reused: 0 });
      const afterForced = await niceeval.run(["query", "run", "--request", requestPath]);
      expect(afterForced.exitCode, afterForced.diagnostic()).toBe(0);
      expect(afterForced.querySuccess("project.get").project).toEqual(project);

      const externalCurrent = await niceeval.run(["query", "run", "--request", requestPath, "--record", portable]);
      expect(externalCurrent.exitCode, externalCurrent.diagnostic()).not.toBe(0);
      expect(externalCurrent.queryFailure().failure.code).toBe("current-target-unavailable");
      writeFileSync(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "project.get", experimentIds: ["current", "missing"] } }), "utf8");
      const missing = await niceeval.run(["query", "run", "--request", requestPath]);
      expect(missing.exitCode, missing.diagnostic()).not.toBe(0);
      expect(missing.queryFailure().failure.code).toBe("inspection-selection-missing");
      writeFileSync(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "project.get" } }), "utf8");

      writeFileSync(changedPath, 'throw new Error("current target fixture cannot evaluate");\n', "utf8");
      expectShowFailure(await niceeval.run(["show"]), ["current-target-unavailable", "niceeval show --run <run-id>"]);
      const failedQuery = await niceeval.run(["query", "run", "--request", requestPath]);
      expect(failedQuery.exitCode, failedQuery.diagnostic()).not.toBe(0);
      expect(failedQuery.queryFailure().failure).toMatchObject({ code: "current-target-unavailable", reason: expect.stringContaining("overview.get") });
      const recorded = await niceeval.run(["show", "--record", portable]);
      expect(recorded.exitCode, recorded.diagnostic()).toBe(0);
      expect(recorded.stdout).toContain("Recorded results");
      expect(recorded.stdout).toMatch(/Observed\s+3\/3/u);
      const fixedRun = await niceeval.run(["show", "--run", runId]);
      expect(fixedRun.exitCode, fixedRun.diagnostic()).toBe(0);
      expect(fixedRun.stdout).toContain(changedLocator);
      const fixedAttempt = await niceeval.run(["show", changedLocator]);
      expect(fixedAttempt.exitCode, fixedAttempt.diagnostic()).toBe(0);
      expect(fixedAttempt.stdout).toContain(changedLocator);

      rmSync(join(projectRoot, "evals"), { recursive: true });
      mkdirSync(join(projectRoot, "evals"));
      rmSync(experimentPath);
      const historyOnly = await niceeval.run(["show"]);
      expect(historyOnly.exitCode, historyOnly.diagnostic()).toBe(0);
      expect(historyOnly.stdout).toMatch(/Covered\s+0\/0/u);
      expect(historyOnly.stdout).toMatch(/Gaps\s+0/u);
      expect(historyOnly.stdout).toContain("History");
      expect(historyOnly.stdout).toContain(changedLocator);
      const history = await niceeval.run(["query", "run", "--request", requestPath]);
      expect(history.exitCode, history.diagnostic()).toBe(0);
      expect(history.querySuccess("project.get").project).toMatchObject({ coverage: { expected: 0, covered: 0, gaps: 0 }, slots: [], cells: [], experiments: [] });
      expect(history.querySuccess("project.get").project.history).toHaveLength(3);
      const runs = await niceeval.run(["run", "list", "--json"]);
      expect(runs.exitCode, runs.diagnostic()).toBe(0);
      expect(runs.runListDocument().runs.map((run) => run.runId)).toEqual([runId]);
      expect(readFileSync(join(projectRoot, "agent-calls.txt"), "utf8")).toBe(agentCalls);
      expect(readFileSync(join(projectRoot, "hook-calls.txt"), "utf8")).toBe(hookCalls);
    },
  );
}, 180_000);

// @feature docs/feature/inspection/README.md
test.concurrent("当前 Score 只覆盖完整结果，零分沿用而 partial Score 在 Show 与 dry 中都形成缺口", async () => {
  await inspectionE2E.case(
    "show-current-score",
    { artifacts: inspectionCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      rmSync(join(projectRoot, "evals"), { recursive: true });
      rmSync(join(projectRoot, "experiments"), { recursive: true });
      mkdirSync(join(projectRoot, "evals", "score"), { recursive: true });
      mkdirSync(join(projectRoot, "experiments"));
      writeFileSync(join(projectRoot, "experiments", "current.ts"), `
import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
const agent = defineAgent({ name: "current-score-fixture", evidenceCoverage: completeEvidenceCoverage,
  send: async () => ({ status: "completed", events: [] }) });
export default defineExperiment({ agent, evals: ["score/"] });
`, "utf8");
      writeFileSync(join(projectRoot, "evals", "score", "zero.eval.ts"), `
import { defineScoreEval } from "niceeval";
export default defineScoreEval({ test(t) { t.score(0); } });
`, "utf8");
      writeFileSync(join(projectRoot, "evals", "score", "partial.eval.ts"), `
import { defineScoreEval } from "niceeval";
import { defineValueMatch } from "niceeval/expect";
const unavailable = defineValueMatch<null>({ name: "completion-evidence", evaluate: () => ({ state: "unavailable" as const, reason: "completion-boundary-missing" }) });
export default defineScoreEval({ test(t) {
  t.score(2);
  t.check(null, unavailable).score(50);
} });
`, "utf8");
      const produced = await niceeval.run(["exp", "current", "--json"]);
      expect(produced.expReceipt(), produced.diagnostic()).toMatchObject({ completion: "completed" });
      const runId = only(produced.expReceipt().createdRunIds, () => true, produced.diagnostic());
      const partialLocator = only(produced.expEvalEvents(), (event) => event.evalId === "score/partial", produced.diagnostic()).locator;
      const partialRequestPath = join(projectRoot, "partial.request.json");
      writeFileSync(partialRequestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.get", locator: partialLocator } }), "utf8");
      const partial = await niceeval.run(["query", "run", "--request", partialRequestPath]);
      expect(partial.exitCode, partial.diagnostic()).toBe(0);
      expect(partial.querySuccess("attempt.get").attempt).toMatchObject({ core: { outcome: "errored" }, score: { state: "unavailable", earned: 2, unavailable: 1 } });
      for (const name of ["new-a", "new-b"]) {
        writeFileSync(join(projectRoot, "evals", "score", `${name}.eval.ts`), `
import { defineScoreEval } from "niceeval";
export default defineScoreEval({ test(t) { t.score(4); } });
`, "utf8");
      }
      const requestPath = join(projectRoot, "project.request.json");
      writeFileSync(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "project.get" } }), "utf8");
      const queried = await niceeval.run(["query", "run", "--request", requestPath]);
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      const project = queried.querySuccess("project.get").project;
      expect(project.coverage).toEqual({ expected: 4, covered: 1, gaps: 3 });
      expect(project.totals).toMatchObject({ evaluationKind: "points", score: { state: "partial", value: 0 } });
      expect(project.slots).toEqual(expect.arrayContaining([
        expect.objectContaining({ evalId: "score/zero", state: "reuse" }),
        expect.objectContaining({ evalId: "score/partial", state: "gap", reason: "outcome-ineligible", previous: { sourceRunId: runId, locator: partialLocator } }),
        expect.objectContaining({ evalId: "score/new-a", state: "gap", reason: "no-result" }),
        expect.objectContaining({ evalId: "score/new-b", state: "gap", reason: "no-result" }),
      ]));
      const shown = await niceeval.run(["show"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toMatch(/Covered\s+1\/4/u);
      expect(shown.stdout).toMatch(/Gaps\s+3/u);
      expect(shown.stdout).toMatch(/Score\s+0\s+\(partial\)/u);
      expect(shown.stdout).toContain("Gap outcome-ineligible");
      expect(shown.stdout).not.toContain("Pass rate");
      const dry = await niceeval.run(["exp", "current", "--dry", "--json"]);
      expect(dry.exitCode, dry.diagnostic()).toBe(0);
      const plan = decodeExpPlanDocument(JSON.parse(dry.stdout));
      expect(plan).toMatchObject({ total: 4, reused: 1 });
      expect(plan.matrix.flatMap((row) => row.slots)).toEqual(expect.arrayContaining([
        expect.objectContaining({ evalId: "score/zero", state: "reused" }),
        expect.objectContaining({ evalId: "score/partial", state: "gap", reason: "attempt-outcome-ineligible" }),
      ]));
      const runs = await niceeval.run(["run", "list", "--json"]);
      expect(runs.exitCode, runs.diagnostic()).toBe(0);
      expect(runs.runListDocument().runs.map((run) => run.runId)).toEqual([runId]);
    },
  );
});

// @feature docs/feature/inspection/README.md
test.concurrent("零发布 pending Run 遮蔽旧 ordinal，缩小 attempts 和单条采用保留兄弟位置的结果", async () => {
  await inspectionE2E.case(
    "show-current-ordinal-barriers",
    { artifacts: inspectionCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      rmSync(join(projectRoot, "evals"), { recursive: true });
      rmSync(join(projectRoot, "experiments"), { recursive: true });
      mkdirSync(join(projectRoot, "evals"));
      mkdirSync(join(projectRoot, "experiments"));
      writeFileSync(join(projectRoot, "experiments", "current.ts"), `
import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { existsSync, writeFileSync } from "node:fs";
const agent = defineAgent({ name: "current-barrier-fixture", evidenceCoverage: completeEvidenceCoverage,
  send: async (_input, ctx) => {
    if (existsSync("hold-agent")) {
      writeFileSync("agent-started", "ready");
      while (!existsSync("release-agent")) {
        if (ctx.signal.aborted) throw new Error("barrier fixture interrupted");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "accepted" }] };
  },
});
export default defineExperiment({ agent, evals: ["position"], attempts: 2 });
`, "utf8");
      writeFileSync(join(projectRoot, "evals", "position.eval.ts"), `
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";
export default defineEval({ async test(t) {
  const turn = await t.send("position");
  t.check(turn.message, equals("accepted"));
} });
`, "utf8");
      const requestPath = join(projectRoot, "project.request.json");
      writeFileSync(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "project.get" } }), "utf8");
      const initial = await niceeval.run(["exp", "current", "--json"]);
      expect(initial.exitCode, initial.diagnostic()).toBe(0);
      const initialRunId = only(initial.expReceipt().createdRunIds, () => true, initial.diagnostic());
      const first = await niceeval.run(["query", "run", "--request", requestPath]);
      expect(first.exitCode, first.diagnostic()).toBe(0);
      const initialSlots = first.querySuccess("project.get").project.slots.filter((slot) => slot.state === "reuse");
      expect(initialSlots).toHaveLength(2);
      const ordinalZero = only(initialSlots, (slot) => slot.attemptOrdinal === 0, first.diagnostic());
      const sibling = only(initialSlots, (slot) => slot.attemptOrdinal === 1, first.diagnostic());

      writeFileSync(join(projectRoot, "hold-agent"), "hold", "utf8");
      const pending = niceeval.start(["exp", "current", "--attempts", "1", "--rerun", "all", "--json"], { timeoutMs: 120_000 });
      try {
        await waitForPathOrProcessExit(join(projectRoot, "agent-started"), pending.done, "the new Run reaches its unpublished Attempt");
        const listed = await niceeval.run(["run", "list", "--json"]);
        expect(listed.exitCode, listed.diagnostic()).toBe(0);
        const active = only(listed.runListDocument().runs, (run) => run.state === "active", listed.diagnostic());
        expect(active).toMatchObject({ coverage: { expected: 1, published: 0, missing: 1 } });
        const current = await niceeval.run(["query", "run", "--request", requestPath]);
        expect(current.exitCode, current.diagnostic()).toBe(0);
        expect(current.querySuccess("project.get").project).toMatchObject({ coverage: { expected: 2, covered: 1, gaps: 1 } });
        expect(current.querySuccess("project.get").project.slots).toEqual([
          expect.objectContaining({ attemptOrdinal: 0, state: "gap", reason: "pending", sourceRunId: active.runId, previous: { sourceRunId: initialRunId, locator: ordinalZero.locator } }),
          expect.objectContaining({ attemptOrdinal: 1, state: "reuse", sourceRunId: initialRunId, locator: sibling.locator }),
        ]);
        const shown = await niceeval.run(["show"]);
        expect(shown.exitCode, shown.diagnostic()).toBe(0);
        expect(shown.stdout).toMatch(/Covered\s+1\/2/u);
        expect(shown.stdout).toContain("Gap pending");
        const dry = await niceeval.run(["exp", "current", "--dry", "--json"]);
        expect(dry.exitCode, dry.diagnostic()).toBe(0);
        const pendingPlan = decodeExpPlanDocument(JSON.parse(dry.stdout));
        expect(pendingPlan).toMatchObject({ total: 2, reused: 1 });
        expect(pendingPlan.matrix.flatMap((row) => row.slots)).toEqual([
          expect.objectContaining({ attempt: 0, state: "gap", reason: "source-member-missing" }),
          expect.objectContaining({ attempt: 1, state: "reused" }),
        ]);

        writeFileSync(join(projectRoot, "release-agent"), "release", "utf8");
        const completed = await pending.done;
        expect(completed.exitCode, completed.diagnostic()).toBe(0);
        const newRunId = only(completed.expReceipt().createdRunIds, () => true, completed.diagnostic());
        const after = await niceeval.run(["query", "run", "--request", requestPath]);
        expect(after.exitCode, after.diagnostic()).toBe(0);
        expect(after.querySuccess("project.get").project).toMatchObject({ coverage: { expected: 2, covered: 2, gaps: 0 } });
        expect(after.querySuccess("project.get").project.slots).toEqual([
          expect.objectContaining({ attemptOrdinal: 0, state: "reuse", sourceRunId: newRunId }),
          expect.objectContaining({ attemptOrdinal: 1, state: "reuse", sourceRunId: initialRunId, locator: sibling.locator }),
        ]);

        const accepted = await niceeval.run(["accept", sibling.locator]);
        expect(accepted.exitCode, accepted.diagnostic()).toBe(0);
        const adopted = await niceeval.run(["query", "run", "--request", requestPath]);
        expect(adopted.exitCode, adopted.diagnostic()).toBe(0);
        const adoptedSlots = adopted.querySuccess("project.get").project.slots;
        expect(adopted.querySuccess("project.get").project.coverage).toEqual({ expected: 2, covered: 2, gaps: 0 });
        expect(adoptedSlots).toEqual([
          expect.objectContaining({ attemptOrdinal: 0, state: "reuse", sourceRunId: newRunId }),
          expect.objectContaining({ attemptOrdinal: 1, state: "reuse", locator: sibling.locator, action: "accepted", relation: "reference" }),
        ]);
        const acceptedSibling = only(adoptedSlots.filter((slot) => slot.state === "reuse"), (slot) => slot.attemptOrdinal === 1, adopted.diagnostic());
        expect(acceptedSibling.sourceRunId).not.toBe(initialRunId);
        const next = await niceeval.run(["exp", "current", "--dry", "--json"]);
        expect(next.exitCode, next.diagnostic()).toBe(0);
        expect(decodeExpPlanDocument(JSON.parse(next.stdout))).toMatchObject({ total: 2, reused: 2 });
      } finally {
        writeFileSync(join(projectRoot, "release-agent"), "release", "utf8");
        await pending.dispose();
      }
    },
  );
}, 180_000);

// @feature docs/feature/inspection/README.md
test.concurrent("等待复用的目标 pending Run 保留当前缺口，释放后沿用刚发布的结果", async () => {
  await inspectionE2E.case(
    "show-current-late-adoption",
    { artifacts: inspectionCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      // Both Invocations must reach the Eval lock while the source is held.
      writeFileSync(join(projectRoot, "niceeval.config.ts"), 'import { defineConfig } from "niceeval";\nexport default defineConfig({ timeoutMs: 60_000, maxConcurrency: 2 });\n', "utf8");
      rmSync(join(projectRoot, "evals"), { recursive: true });
      rmSync(join(projectRoot, "experiments"), { recursive: true });
      mkdirSync(join(projectRoot, "evals"));
      mkdirSync(join(projectRoot, "experiments"));
      writeFileSync(join(projectRoot, "experiments", "current.ts"), `
import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const agent = defineAgent({ name: "current-late-adoption-fixture", evidenceCoverage: completeEvidenceCoverage,
  send: async (_input, ctx) => {
    appendFileSync("agent-calls.txt", "send\\n");
    writeFileSync("agent-started", "ready");
    while (!existsSync("release-agent")) {
      if (ctx.signal.aborted) throw new Error("late adoption fixture interrupted");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "accepted" }] };
  },
});
export default defineExperiment({ agent, evals: ["case"], attempts: 1, timeoutMs: 60_000 });
`, "utf8");
      writeFileSync(join(projectRoot, "evals", "case.eval.ts"), `
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";
export default defineEval({ async test(t) { const turn = await t.send("current result"); t.check(turn.message, equals("accepted")); } });
`, "utf8");
      const requestPath = join(projectRoot, "project-request.json");
      writeFileSync(requestPath, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "project.get" } }), "utf8");
      const first = niceeval.start(["exp", "current", "--json"], { timeoutMs: 120_000 });
      let second: ReturnType<typeof niceeval.start> | undefined;
      try {
        await waitForPathOrProcessExit(join(projectRoot, "agent-started"), first.done, "the source Run starts its Attempt");
        second = niceeval.start(["exp", "current", "--json"], { timeoutMs: 120_000 });
        await waitForOutput(second, "stdout", /"event":"lock_wait"[^\n]*"status":"started"/u, { timeoutMs: 30_000, label: "the target Run waits for the source Attempt" });
        const listed = await niceeval.run(["run", "list", "--json"]);
        expect(listed.exitCode, listed.diagnostic()).toBe(0);
        expect(listed.runListDocument().runs.filter((run) => run.state === "active")).toHaveLength(2);
        const pending = await niceeval.run(["query", "run", "--request", requestPath]);
        expect(pending.exitCode, pending.diagnostic()).toBe(0);
        expect(pending.querySuccess("project.get").project).toMatchObject({ coverage: { expected: 1, covered: 0, gaps: 1 }, slots: [expect.objectContaining({ state: "gap", reason: "pending" })] });

        writeFileSync(join(projectRoot, "release-agent"), "release", "utf8");
        const [source, carried] = await Promise.all([first.done, second.done]);
        expect(source.exitCode, source.diagnostic()).toBe(0);
        expect(carried.exitCode, carried.diagnostic()).toBe(0);
        expect(readFileSync(join(projectRoot, "agent-calls.txt"), "utf8")).toBe("send\n");
        const locator = only(source.expEvalEvents(), () => true, source.diagnostic()).locator;
        const targetRunId = only(carried.expReceipt().createdRunIds, () => true, carried.diagnostic());
        const available = await niceeval.run(["query", "run", "--request", requestPath]);
        expect(available.exitCode, available.diagnostic()).toBe(0);
        expect(available.querySuccess("project.get").project).toMatchObject({ coverage: { expected: 1, covered: 1, gaps: 0 }, slots: [expect.objectContaining({ state: "reuse", sourceRunId: targetRunId, locator, action: "carried", relation: "reference" })] });
        const shown = await niceeval.run(["show"]);
        expect(shown.exitCode, shown.diagnostic()).toBe(0);
        expect(shown.stdout).toMatch(/Covered\s+1\/1/u);
        expect(shown.stdout).not.toContain("Next:");
      } finally {
        writeFileSync(join(projectRoot, "release-agent"), "release", "utf8");
        await first.dispose();
        await second?.dispose();
      }
    },
  );
}, 180_000);
