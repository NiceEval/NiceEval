import { expect, test } from "vitest";
import {
  CLASSIC_BARS,
  CLASSIC_COMPOSITION_RUNS,
  CLASSIC_EXPERIMENTS,
  CLASSIC_SCATTER,
  CLASSIC_SUMMARY,
  CLASSIC_TITLE,
} from "../support/classic-contract.ts";
import { PINNED_ENV } from "../support/context.ts";
import { assertPublicShowJson } from "../support/show-json.ts";
import { terminalReport, type AttemptExpectation } from "../support/terminal-report.ts";
import { withClassicWorld, type ClassicWorld } from "../support/world.ts";

test("show reads the frozen classic World by grid cell and hierarchy identity", async () => {
  await withClassicWorld("show-semantic", async ({ commands: { niceeval }, world }) => {
    const shown = await niceeval.run(["show"], { env: PINNED_ENV });
    expect(shown.exitCode, shown.diagnostic()).toBe(0);

    const report = terminalReport(shown.stdout);
    report.expectTitle(CLASSIC_TITLE);
    report.expectComposition(CLASSIC_COMPOSITION_RUNS);
    report.expectStats([
      { label: "Pass rate", value: "70.4%" },
      { label: "Experiments", value: String(CLASSIC_SUMMARY.experiments) },
      { label: "Evals", value: String(CLASSIC_SUMMARY.attempts) },
      { label: "Attempts", value: String(CLASSIC_SUMMARY.attempts) },
      { label: "Eval results", value: `${CLASSIC_SUMMARY.passed} passed · ${CLASSIC_SUMMARY.failed} failed` },
      {
        label: "Total cost",
        value: CLASSIC_SUMMARY.totalCost,
        detail: CLASSIC_SUMMARY.costDetail,
      },
    ]);
    report.bars("Pass rate(%)").expectRows(
      CLASSIC_BARS.map((bar) => ({
        label: bar.experiment,
        display: bar.passRate,
        value: Number.parseFloat(bar.passRate) / 100,
      })),
    );
    const scatter = report.scatter("costUSD × passRate");
    scatter.expectAxes({ xLabel: "costUSD", yLabel: "passRate", betterHint: "better → upper right" });
    scatter.expectPoints(
      CLASSIC_SCATTER.map((point) => ({
        label: point.experiment,
        key: point.key,
        xDisplay: point.cost,
        yDisplay: point.passRate,
      })),
    );
    scatter.expectVisualOrder({
      points: CLASSIC_SCATTER.map((point) => ({
        label: point.experiment.split("/").at(-1)!,
        key: point.key,
        xDisplay: point.cost,
        yDisplay: point.passRate,
      })),
      leftToRight: ["memory-b", "memory-a", "baseline"],
      topToBottom: ["memory-b", "memory-a", "baseline"],
    });
    const hierarchy = report.experimentTable(["Experiment", "Model", "Agent", "Avg. time", "Pass rate"]);
    hierarchy.expectExperiments(
      [...CLASSIC_EXPERIMENTS]
        .reverse()
        .map(({ id, model, agent, passRate }) => ({ id, model, agent, passRate })),
    );
    hierarchy.expectAttemptIdentity(expectedAttempts(world));

    const json = await niceeval.run(["show", "--json"], { env: PINNED_ENV });
    expect(json.exitCode, json.diagnostic()).toBe(0);
    const document = assertPublicShowJson(json.json());
    expect(document.view).toBe("leaderboard");
    expect(document.sample.experiments).toEqual(CLASSIC_EXPERIMENTS.map((experiment) => experiment.id));
  });
});

function expectedAttempts(world: ClassicWorld): readonly AttemptExpectation[] {
  return [...CLASSIC_EXPERIMENTS]
    .reverse()
    .flatMap((experiment) =>
      experiment.evals.map((evalExpectation) => ({
        experimentId: experiment.id,
        evalId: evalExpectation.id,
        verdict: evalExpectation.verdict,
        locator: world.attemptLocator(experiment.id, evalExpectation.id),
      })),
    );
}
