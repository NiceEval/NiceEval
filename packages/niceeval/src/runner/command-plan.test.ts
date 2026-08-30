import { describe, expect, it } from "vitest";
import { setupPrefixPlanOf, type CommandPlan, type CommandPlanStep } from "./command-plan.ts";

const cachedStep = (prefixIdentity: string): CommandPlanStep => ({
  phase: "sandbox.before",
  truth: "exact",
  cache: {
    lookup: "not-probed",
    capability: "persistent",
    prefixIdentity,
    runtime: { status: "pending", finalKey: "not-probed" },
    eligibility: { status: "eligible" },
    state: {
      declared: "all",
      cumulative: "all",
      providerCoverage: "all",
      barrier: "none",
    },
  },
});

describe("setupPrefixPlanOf", () => {
  it("deduplicates selected consumers without probing cache inventory", () => {
    const commandPlan: CommandPlan = {
      completeness: "complete",
      opaqueCount: 0,
      redactedCount: 0,
      experiments: [{
        experimentId: "experiment",
        activation: "conditional",
        beforeLanes: [],
        afterLanes: [],
        lanes: [{
          id: "lane",
          kind: "eval",
          ordering: "independent",
          slots: [
            { evalId: "eval/a", attempt: 0, action: "dispatch", steps: [cachedStep("prefix:a")] },
            { evalId: "eval/b", attempt: 0, action: "dispatch", steps: [cachedStep("prefix:a")] },
          ],
        }],
      }],
    };

    expect(setupPrefixPlanOf(commandPlan)).toEqual({
      lookup: "not-probed",
      nodes: [{
        prefixIdentity: "prefix:a",
        lookup: "not-probed",
        capability: "persistent",
        eligibility: { status: "eligible" },
        consumers: [
          { experimentId: "experiment", evalId: "eval/a" },
          { experimentId: "experiment", evalId: "eval/b" },
        ],
      }],
    });
  });
});
