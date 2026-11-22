import { createRequire } from "node:module";
import fc from "fast-check";
import { describe, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { defineSimulatedUser } = require("niceeval") as typeof import("../../packages/niceeval/src/index.ts");

const validInstructions = fc
  .string({ minLength: 1, maxLength: 64 })
  .filter((value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 8192);

describe("defineSimulatedUser contract", () => {
  // @feature docs/feature/eval/README.md#simulated-user-definition
  test("freezes valid definitions into immutable snapshots isolated from source mutations", () => {
    fc.assert(
      fc.property(
        validInstructions,
        fc.option(fc.integer({ min: 1, max: 600_000 }), { nil: undefined }),
        fc.string({ minLength: 1, maxLength: 32 }),
        (instructions, timeoutMs, mutated) => {
          const source: { instructions: string; timeoutMs?: number } =
            timeoutMs === undefined ? { instructions } : { instructions, timeoutMs };
          const definition = defineSimulatedUser(source);
          source.instructions = mutated;
          if (timeoutMs !== undefined) source.timeoutMs = timeoutMs + 1;

          expect(Object.isFrozen(definition)).toBe(true);
          expect(definition.instructions).toBe(instructions);
          expect(definition.timeoutMs).toBe(timeoutMs);
        },
      ),
      {
        numRuns: 40,
        examples: [
          ["Facts", 1, "Changed"],
          ["x".repeat(8192), undefined, "Changed"],
        ],
      },
    );
  });

  // @feature docs/feature/eval/README.md#simulated-user-definition
  test("rejects accessors without invoking getters, invalid bounds, unknown fields, and inherited properties", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant({ kind: "whitespace" as const, value: " \t\n" }),
          fc.nat(16).map((extra) => ({ kind: "overlong-utf8" as const, value: "字".repeat(2731 + extra) })),
        ),
        fc.constantFrom(0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1),
        (badInstructions, badTimeout) => {
          let calls = 0;
          expect(() =>
            defineSimulatedUser({
              get instructions() {
                calls += 1;
                return "facts";
              },
            }),
          ).toThrow();
          expect(calls).toBe(0);

          expect(() => defineSimulatedUser({ instructions: badInstructions.value })).toThrow();
          expect(() => defineSimulatedUser({ instructions: "facts", timeoutMs: badTimeout })).toThrow();
          expect(() => defineSimulatedUser({ instructions: "facts", name: "owner" } as never)).toThrow();
          expect(() => defineSimulatedUser(Object.create({ instructions: "inherited" }))).toThrow();
        },
      ),
      { numRuns: 24 },
    );
  });
});
