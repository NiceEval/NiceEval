import { expect, test } from "vitest";
import { defineSimulatedUser } from "./definition.ts";

// Accessor side effects and non-JSON object shapes cannot cross an installed
// process fixture; keep this public definition boundary as a Unit exception.
// @feature docs/feature/eval/README.md
test("Simulated user definitions reject accessors without invoking them and freeze a validated copy", () => {
  let calls = 0;
  expect(() => defineSimulatedUser({ get instructions() { calls++; return "facts"; } })).toThrow();
  expect(calls).toBe(0);
  const source = { instructions: "Facts", timeoutMs: 1 };
  const definition = defineSimulatedUser(source);
  source.instructions = "Changed";
  expect(definition.instructions).toBe("Facts");
  expect(Object.isFrozen(definition)).toBe(true);
  for (const instructions of [" ", "字".repeat(2731)]) expect(() => defineSimulatedUser({ instructions })).toThrow();
  expect(defineSimulatedUser({ instructions: "x".repeat(8192) }).instructions).toHaveLength(8192);
  for (const timeoutMs of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => defineSimulatedUser({ instructions: "facts", timeoutMs })).toThrow();
  expect(() => defineSimulatedUser({ instructions: "facts", name: "owner" } as never)).toThrow();
  expect(() => defineSimulatedUser(Object.create({ instructions: "inherited" }))).toThrow();
});
