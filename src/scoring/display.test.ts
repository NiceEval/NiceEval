import { describe, expect, it } from "vitest";
import type { AssertionResult } from "./types.ts";
import {
  assertionSummaryLines,
  compactAssertionSummary,
  primaryAssertionSummary,
} from "./display.ts";

describe("primaryAssertionSummary", () => {
  it("选择第一条失败 gate，保留领域 group、matcher 与 expected/received，并只计数其余 gate", () => {
    const assertions: AssertionResult[] = [
      { name: "style", severity: "soft", outcome: "failed", score: 0.2, threshold: 0.8 },
      {
        name: "equals(4)",
        groupPath: ["Issue 15193: selected proposal matches the accepted proposal"],
        severity: "gate",
        outcome: "failed",
        score: 0,
        expected: "4",
        received: "3",
      },
      { name: "matches(schema)", severity: "gate", outcome: "failed", score: 0 },
    ];

    const summary = primaryAssertionSummary(assertions, "failed");
    expect(summary).toEqual({
      severity: "gate",
      assertion: "Issue 15193: selected proposal matches the accepted proposal",
      matcher: "equals(4)",
      expected: "4",
      received: "3",
      additionalFailures: 1,
    });
    expect(assertionSummaryLines(summary!)).toEqual([
      "gate: Issue 15193: selected proposal matches the accepted proposal",
      "equals(4) · expected 4 · received 3 · +1 more failures",
    ]);
    expect(compactAssertionSummary(summary!)).toBe(
      "gate: Issue 15193: selected proposal matches the accepted proposal · equals(4) · expected 4 · received 3 · +1 more failures",
    );
  });

  it("无 group 时不重复 matcher；failed verdict 没有 gate 才选择 soft", () => {
    const summary = primaryAssertionSummary(
      [{ name: "similarity", severity: "soft", outcome: "failed", score: 0.71, threshold: 0.9 }],
      "failed",
    );
    expect(compactAssertionSummary(summary!)).toBe("similarity · score 0.71 · threshold 0.9");
  });

  it("errored 可由首条非 optional unavailable 解释，passed 不产生摘要", () => {
    const assertions: AssertionResult[] = [
      { name: "failed gate is not the errored root cause", severity: "gate", outcome: "failed", score: 0 },
      { name: "optional judge", severity: "soft", optional: true, outcome: "unavailable", reason: "no-key" },
      { name: "required judge", severity: "gate", outcome: "unavailable", reason: "judge-model-unresolved" },
    ];
    expect(primaryAssertionSummary(assertions, "errored")).toMatchObject({
      assertion: "required judge",
      reason: "judge-model-unresolved",
    });
    expect(primaryAssertionSummary(assertions, "passed")).toBeUndefined();
  });

  it("摘要把多行大值压成单行有界预览，完整断言证据不在这里展开", () => {
    const assertions: AssertionResult[] = [{
      name: "includes(/updateTag/)",
      severity: "gate",
      outcome: "failed",
      score: 0,
      expected: "matches /updateTag/",
      received: `// app/actions/posts.ts\n'use server';\n${"const source = 1;\n".repeat(80)}`,
    }];

    const summary = primaryAssertionSummary(assertions, "failed")!;
    expect(summary.received).not.toContain("\n");
    expect(summary.received!.length).toBeLessThanOrEqual(240);
    expect(summary.received).toMatch(/…$/);
    const lines = assertionSummaryLines(summary);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
  });
});
