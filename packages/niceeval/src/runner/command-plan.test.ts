import { describe, expect, it } from "vitest";
import { beforeCachePlanOf, type CommandPlan, type CommandPlanStep } from "./command-plan.ts";

const cachedStep = (prefixIdentity: string): CommandPlanStep => ({
  phase: "sandbox.before",
  truth: "exact",
  label: "prepare fixture",
  owner: { kind: "experiment", id: "experiment", index: undefined },
  condition: undefined,
  command: {
    kind: "shell",
    script: "true",
    cwd: undefined,
    user: undefined,
    timeoutMs: undefined,
    envKeys: undefined,
  },
  redactions: undefined,
  action: { kind: "command", id: prefixIdentity },
  declarationOrder: { owner: { kind: "experiment", id: "experiment" }, ordinal: 0 },
  executionOrder: { topologicalOrdinal: 0, occurrencePath: [] },
  changeFrequency: { value: 1, source: "explicit", preset: undefined },
  schedulingReason: "fixture has no dependencies",
  dependencies: [],
  occurrence: { kind: "attempt" },
  cache: {
    lookup: "not-probed",
    capability: "attempt-captured",
    prefixIdentity,
    capabilityReason: undefined,
    runtime: { status: "pending", finalKey: "not-probed" },
    eligibility: { status: "eligible" },
    state: {
      declared: "all",
      cumulative: "all",
      providerCoverage: "all",
      barrier: "none",
      barrierActionId: undefined,
    },
  },
});

describe("beforeCachePlanOf", () => {
  it("deduplicates selected consumers without probing cache inventory", () => {
    const commandPlan: CommandPlan = {
      completeness: "complete",
      opaqueCount: 0,
      redactedCount: 0,
      experiments: [
        {
          experimentId: "experiment",
          activation: "conditional",
          beforeLanes: [cachedStep("prefix:shared")],
          afterLanes: [],
          lanes: [
            {
              id: "lane",
              kind: "eval",
              ordering: "independent",
              slots: [
                {
                  evalId: "eval/a",
                  attempt: 0,
                  action: "dispatch",
                  activation: undefined,
                  steps: [cachedStep("prefix:a")],
                },
                {
                  evalId: "eval/b",
                  attempt: 0,
                  action: "dispatch",
                  activation: undefined,
                  steps: [cachedStep("prefix:a")],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(beforeCachePlanOf(commandPlan)).toEqual({
      lookup: "not-probed",
      nodes: [
        {
          prefixIdentity: "prefix:a",
          lookup: "not-probed",
          capability: "attempt-captured",
          eligibility: { status: "eligible" },
          consumers: [
            { experimentId: "experiment", evalId: "eval/a" },
            { experimentId: "experiment", evalId: "eval/b" },
          ],
        },
        {
          prefixIdentity: "prefix:shared",
          lookup: "not-probed",
          capability: "attempt-captured",
          eligibility: { status: "eligible" },
          consumers: [
            { experimentId: "experiment", evalId: "eval/a" },
            { experimentId: "experiment", evalId: "eval/b" },
          ],
        },
      ],
    });
  });
});
