// cases: docs/engineering/testing/unit/assertions.md
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { defineScoreMatch, managedScoreMatchOf } from "./match.ts";

describe("defineScoreMatch", () => {
  it("captures a canonical deeply frozen managed definition", () => {
    const config = { weights: { correctness: 1 }, labels: ["yes", "no"] };
    const match = defineScoreMatch<string>({
      name: "quality",
      version: "1",
      config,
      llm: {},
      score: () => Effect.succeed(1),
    });
    config.weights.correctness = 0;
    config.labels.push("maybe");
    const definition = managedScoreMatchOf(match)!;
    expect(definition.config).toEqual({ labels: ["yes", "no"], weights: { correctness: 1 } });
    expect(definition.canonicalConfig).toBe('{"labels":["yes","no"],"weights":{"correctness":1}}');
    expect(Object.isFrozen(definition.config)).toBe(true);
    expect(Object.isFrozen((definition.config as { weights: object }).weights)).toBe(true);
    expect(definition.llm).toEqual({ maxCalls: 4, maxMaterialBytes: 32 * 1024, maxAuditBytes: 96 * 1024 });
  });

  it("rejects ambiguous, accessor, and out-of-range managed options", () => {
    expect(() => defineScoreMatch({ name: "x", version: "1", config: {}, llm: { maxCalls: 17 }, score: () => Effect.succeed(1) })).toThrow("at most 16");
    expect(() => defineScoreMatch({ name: "x", score: () => 1, extra: true } as never)).toThrow("unknown option");
    const config = Object.defineProperty({}, "value", { enumerable: true, get: () => 1 });
    expect(() => defineScoreMatch({ name: "x", version: "1", config, llm: {}, score: () => Effect.succeed(1) })).toThrow("data property");
  });
});
