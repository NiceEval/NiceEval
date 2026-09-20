// cases: docs/engineering/testing/unit/assertions.md

import { describe, expect, it } from "vitest";

import { captureAssertionSnapshot } from "./runtime.ts";

describe("assertion snapshot material", () => {
  it("records undefined as complete tagged material", () => {
    const captured = captureAssertionSnapshot({
      hp: 80,
      attackTarget: undefined,
      bubble: undefined,
    });

    expect(captured.coverage).toEqual({ state: "complete" });
    expect(captured.limitations).toEqual([]);
    expect(captured.material).toEqual({
      kind: "snapshot",
      value: {
        hp: 80,
        attackTarget: { $niceeval: "undefined" },
        bubble: { $niceeval: "undefined" },
      },
    });
  });

  it("keeps unsupported values partial", () => {
    const captured = captureAssertionSnapshot({
      value: () => undefined,
    });

    expect(captured.coverage).toEqual({ state: "partial", reason: "truncated" });
    expect(captured.limitations).toEqual([{ kind: "truncated", omittedBytes: 15 }]);
  });
});
