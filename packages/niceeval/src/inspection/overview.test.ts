// owner: docs/engineering/testing/unit/reports.md#证明范围规范
// cases: docs/engineering/testing/unit/reports.md

import { describe, expect, it } from "vitest";

import type { LoadedInspectionRun } from "./facts.ts";
import { selectInspectionOverview } from "./overview.ts";

function run(input: {
  readonly runId: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly completedAt: number;
  readonly labels: Readonly<Record<string, string>>;
}): LoadedInspectionRun {
  return {
    source: undefined,
    physical: undefined,
    run: {
      runId: input.runId,
      experimentId: input.experimentId,
      context: {
        experimentId: input.experimentId,
        execution: {
          agentId: "agent",
          model: null,
          reasoningEffort: null,
          flags: { privateExecutionFlag: "not-reportable" },
        },
        labels: input.labels,
      },
      startedAt: input.completedAt - 1,
      completedAt: input.completedAt,
      expectedSlots: [{
        slotId: `slot-${input.runId}`,
        evalId: input.evalId,
        attemptOrdinal: 0,
        executionIdentityDigest: "execution",
      }],
    },
    members: [],
    attempts: [],
    attachments: [],
  } as unknown as LoadedInspectionRun;
}

describe("Inspection Overview sealed labels", () => {
  it("projects complete Run labels and available, mixed, or unavailable Experiment label states", () => {
    const overview = selectInspectionOverview([
      run({
        runId: "run-a1",
        experimentId: "experiment-a",
        evalId: "suite/one",
        completedAt: 1,
        labels: { memory: "semantic", shared: "same", firstOnly: "present" },
      }),
      run({
        runId: "run-a2",
        experimentId: "experiment-a",
        evalId: "suite/two",
        completedAt: 2,
        labels: { memory: "episodic", shared: "same", secondOnly: "present" },
      }),
      run({
        runId: "run-b1",
        experimentId: "experiment-b",
        evalId: "suite/one",
        completedAt: 3,
        labels: { other: "coordinate" },
      }),
    ]);

    const experimentA = overview.experiments.find(({ experimentId }) => experimentId === "experiment-a");
    expect(experimentA?.labels).toEqual({
      firstOnly: { state: "mixed" },
      memory: { state: "mixed" },
      secondOnly: { state: "mixed" },
      shared: { state: "available", value: "same" },
    });

    const firstRun = overview.cells
      .flatMap(({ members }) => members)
      .find(({ runId }) => runId === "run-a1");
    expect(firstRun?.labels).toEqual({
      firstOnly: { state: "available", value: "present" },
      memory: { state: "available", value: "semantic" },
      secondOnly: { state: "unavailable" },
      shared: { state: "available", value: "same" },
    });
    expect(JSON.stringify(overview)).not.toContain("privateExecutionFlag");
  });
});
