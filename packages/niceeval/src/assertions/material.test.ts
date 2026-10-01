// cases: docs/engineering/testing/unit/assertions.md
// Unit exception: adversarial ordinary-data and exact UTF-8 boundary matrices;
// installed Eval result and reader/receiver lifecycle are owned by E2E.
import { describe, expect, it } from "vitest";
import { defineContextMatch, contextMatchDefinitionOf } from "./context-match.ts";
import { defineValueMatch } from "./match.ts";
import { captureContextualMatch } from "./material.ts";
import { fullAssertionContentOf } from "./full-content.ts";

function capture(value: unknown, maxBytes = 49152) {
  const match = defineContextMatch({ name: "fact", read: () => ({ state: "available", value }), match: defineValueMatch({ name: "known", evaluate: () => true }), capture: { maxBytes } });
  return captureContextualMatch(contextMatchDefinitionOf(match), {}, { owner: {} });
}

describe("context fact data capture boundaries", () => {
  it("counts escaped UTF-8 and undefined markers without losing undefined facts", () => {
    const value = { "quote\"": "\u0000\b\t\n\f\r\\\"臺😀\ud800", absent: undefined, array: [undefined, null, -0] };
    const captured = capture(value);
    expect(captured.kind).toBe("context-boolean");
    if (captured.kind === "material") throw new Error("Expected a fact");
    expect(captured.value).toEqual(value);
    expect(Object.isFrozen(captured.value)).toBe(true);
    const content = fullAssertionContentOf(captured.captured.material)!;
    expect(JSON.parse(content).value.absent).toEqual({ $niceeval: "undefined" });
    const exactBytes = new TextEncoder().encode(content).length;
    expect(capture(value, exactBytes).problem).toBeUndefined();
    expect(capture(value, exactBytes - 1).problem?.code).toBe("source-byte-limit");
  });

  it("rejects invalid data without invoking accessors, toJSON or custom array methods", () => {
    let reads = 0;
    const accessor = Object.defineProperty({}, "secret", { enumerable: true, get() { reads += 1; return 1; } });
    const jsonHook = { toJSON() { reads += 1; return 1; } };
    const sparse = new Array(2);
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const customArray = [1]; Object.defineProperty(customArray, "map", { value() { reads += 1; return []; } });
    for (const value of [accessor, jsonHook, sparse, cycle, customArray, new Date(), new Map(), new Set(), NaN, Infinity, Symbol("x"), () => 1]) {
      expect(capture(value).problem?.code).toBe("material-not-capturable");
    }
    expect(reads).toBe(0);
  });
});
