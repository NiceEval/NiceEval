import { describe, expect, it } from "vitest";
import { collectPortfolio } from "@niceeval/e2e-kit/registry";

describe("proof portfolio", () => {
  it("每个 Behavior 与 mechanism matrix 只有一个 owner", async () => {
    const registry = await collectPortfolio({
      behaviors: "e2e/**/behaviors/**/*.ts",
      executions: "e2e/**/execution/**/*.ts",
      mechanisms: "test/portfolio/mechanisms/**/*.ts",
      retirements: "test/portfolio/retirements/**/*.ts",
    });

    expect(registry.errors).toEqual([]);
    expect(registry.duplicatedMatrices).toEqual([]);
    expect(registry.removedProofsStillCollected).toEqual([]);
  });
});
