import { expect, test } from "vitest";
import {
  CLASSIC_EXPERIMENTS,
  CLASSIC_HISTORY_ATTEMPTS,
  CLASSIC_HISTORY_RUNS,
} from "../support/classic-contract.ts";
import { PINNED_ENV } from "../support/context.ts";
import { assertPublicShowJson } from "../support/show-json.ts";
import { withClassicWorld } from "../support/world.ts";

interface HistoryAttempt {
  readonly locator: string;
  readonly verdict: "passed" | "failed";
  readonly locatorRunId: string;
}

interface HistorySection {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempts: readonly HistoryAttempt[];
}

const factKey = (attempt: {
  readonly experimentId: string;
  readonly evalId: string;
  readonly locator: string;
  readonly verdict: "passed" | "failed";
}): string => `${attempt.experimentId}\0${attempt.evalId}\0${attempt.locator}\0${attempt.verdict}`;

test("show --history preserves every run and Attempt identity from the frozen producer", async () => {
  await withClassicWorld("show-history", async ({ commands: { niceeval }, world }) => {
    const shown = await niceeval.run(["show", "--history", "--json"], { env: PINNED_ENV });
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    const document = assertPublicShowJson(shown.json());
    expect(document.view).toBe("history");
    const sections = (document.data as { readonly sections?: readonly HistorySection[] }).sections;
    expect(Array.isArray(sections), "report.history.sections").toBe(true);

    const expectedSections = CLASSIC_EXPERIMENTS.flatMap((experiment) =>
      experiment.evals.map((evaluation) => ({ experimentId: experiment.id, evalId: evaluation.id })),
    );
    expect(
      sections!.map(({ experimentId, evalId }) => ({ experimentId, evalId })),
      "report.history.section.sequence",
    ).toEqual(expectedSections);
    for (const section of sections!) {
      expect(section.attempts, `report.history.section[${section.experimentId}/${section.evalId}].attempts`).toHaveLength(
        section.experimentId === "classic/memory-a" ? 2 : 1,
      );
    }

    const actual = sections!.flatMap((section) =>
      section.attempts.map((attempt) => ({ ...attempt, experimentId: section.experimentId, evalId: section.evalId })),
    );
    expect(actual, "report.history.attemptCount").toHaveLength(CLASSIC_HISTORY_ATTEMPTS);
    expect(actual.map(factKey).sort(), "report.history.attemptIdentityMultiset").toEqual(
      world.historyAttempts.map(factKey).sort(),
    );

    const runIds = new Set<string>();
    for (const sourceRun of ["full", "memory-a-rerun"] as const) {
      const sourceFacts = world.historyAttempts.filter((attempt) => attempt.sourceRun === sourceRun);
      for (const experimentId of new Set(sourceFacts.map((attempt) => attempt.experimentId))) {
        const locators = new Set(
          sourceFacts.filter((attempt) => attempt.experimentId === experimentId).map((attempt) => attempt.locator),
        );
        const groupRunIds = new Set(
          actual.filter((attempt) => locators.has(attempt.locator)).map((attempt) => attempt.locatorRunId),
        );
        expect(groupRunIds.size, `report.history.run[${sourceRun}/${experimentId}]`).toBe(1);
        runIds.add([...groupRunIds][0]!);
      }
    }
    expect(runIds.size, "report.history.runIds").toBe(CLASSIC_HISTORY_RUNS);
  });
});
