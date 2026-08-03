// cases: docs/engineering/testing/unit/reports.md

import { describe, expect, it } from "vitest";

import { normalizeTurnLabel } from "./turn-label.ts";

describe("normalizeTurnLabel", () => {
  it("归一主会话与额外会话的旧标签", () => {
    const main = ["s1", "t1"].join("/");
    const extra = ["s2", "t3"].join("/");

    expect(normalizeTurnLabel(main)).toBe("turn1");
    expect(normalizeTurnLabel(extra)).toBe("session2/turn3");
  });

  it("保留当前标签与其它 opaque label", () => {
    expect(normalizeTurnLabel("turn1")).toBe("turn1");
    expect(normalizeTurnLabel("legacy-internal-label")).toBe("legacy-internal-label");
  });
});
