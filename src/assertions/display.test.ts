// cases: docs/engineering/testing/unit/assertions.md
import { describe, expect, it } from "vitest";
import type { AssertionResult } from "./types.ts";
import {
  assertionSummaryLines,
  compactAssertionSummary,
  fitCompactAssertionSummary,
  primaryAssertionSummary,
  stripControl,
  summaryText,
} from "./display.ts";

// 用字符码构造真实控制字节,避免源码里嵌裸控制字符。
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const BS = String.fromCharCode(0x08);

describe("stripControl / summaryText 控制字节收口", () => {
  it("剥 ANSI/OSC/裸控制字节,保留可打印字符与结构性换行", () => {
    const colored = `${ESC}[2m 28 |${ESC}[22m code ${ESC}[31m✕${ESC}[39m Tests: 2 failed`;
    const stripped = stripControl(colored);
    expect(stripped).not.toContain(ESC);
    expect(stripped).toContain("✕"); // jest 合法 glyph 保留
    expect(stripControl(`${ESC}]0;title${BEL}kept`)).toBe("kept"); // OSC 连 payload 去除
    expect(stripControl(`a${BS}b`)).toBe("ab"); // 裸 BS 去除
    expect(stripControl(`${ESC}[2mline1${ESC}[22m\nline2`)).toBe("line1\nline2"); // 保留换行
  });

  it("summaryText 先剥控制字节再折单行,输出不含任何 ESC", () => {
    const s = summaryText(`exit 1 · "${ESC}[2m 28 |${ESC}[22m\n  ${ESC}[31m✕${ESC}[39m failed"`);
    expect(s).not.toContain(ESC);
    expect(s).not.toContain("\n");
    expect(s).toContain("✕");
  });
});

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

    const summary = primaryAssertionSummary(assertions, "failed", "pass");
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
      "equals(4) · expected 4 · received 3",
      "+1 more failures",
    ]);
    expect(compactAssertionSummary(summary!)).toBe(
      "gate: Issue 15193: selected proposal matches the accepted proposal · equals(4) · expected 4 · received 3 · +1 more failures",
    );
  });

  it("无 group 时不重复 matcher；failed verdict 没有 gate 才选择 soft", () => {
    const summary = primaryAssertionSummary(
      [{ name: "similarity", severity: "soft", outcome: "failed", score: 0.71, threshold: 0.9 }],
      "failed",
      "pass",
    );
    expect(compactAssertionSummary(summary!)).toBe("similarity · score 0.71 · threshold 0.9");
  });

  it("errored 可由首条非 optional unavailable 解释，passed 不产生摘要", () => {
    const assertions: AssertionResult[] = [
      { name: "failed gate is not the errored root cause", severity: "gate", outcome: "failed", score: 0 },
      { name: "optional judge", severity: "soft", optional: true, outcome: "unavailable", reason: "no-key" },
      { name: "required judge", severity: "gate", outcome: "unavailable", reason: "judge-model-unresolved" },
    ];
    expect(primaryAssertionSummary(assertions, "errored", "pass")).toMatchObject({
      assertion: "required judge",
      reason: "judge-model-unresolved",
    });
    expect(primaryAssertionSummary(assertions, "passed", "pass")).toBeUndefined();
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

    const summary = primaryAssertionSummary(assertions, "failed", "pass")!;
    expect(summary.received).not.toContain("\n");
    expect(summary.received!.length).toBeLessThanOrEqual(240);
    expect(summary.received).toMatch(/…$/);
    const lines = assertionSummaryLines(summary);
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
    // matcher · expected 放不下大值 received 时各自另起一行
    expect(lines).toEqual([
      "gate: includes(/updateTag/)",
      expect.stringContaining("expected matches /updateTag/"),
      expect.stringMatching(/^received: .*…$/),
    ]);
  });

  it("received 大值单独截断一行时，+N more failures 仍是独立尾行、不与被截断的值粘连", () => {
    const assertions: AssertionResult[] = [
      {
        name: "includes(/updateTag/)",
        severity: "gate",
        outcome: "failed",
        score: 0,
        expected: "matches /updateTag/",
        received: `// app/actions/posts.ts\n'use server';\n${"const source = 1;\n".repeat(80)}`,
      },
      { name: "matches(schema)", severity: "gate", outcome: "failed", score: 0 },
    ];

    const summary = primaryAssertionSummary(assertions, "failed", "pass")!;
    const lines = assertionSummaryLines(summary);
    expect(lines.at(-1)).toBe("+1 more failures");
    const receivedLine = lines.find((line) => line.startsWith("received:"))!;
    expect(receivedLine).not.toContain("more failures");
  });
});

describe("fitCompactAssertionSummary", () => {
  const summary = primaryAssertionSummary(
    [{
      name: "includes(/['\"]use cache['\"];?/)",
      groupPath: ["Catalog reads use use-cache directive and products cache tag"],
      severity: "gate",
      outcome: "failed",
      score: 0,
      expected: "matches /['\"]use cache['\"];?/",
      received: `// next.config.ts\n${"import type { NextConfig } from 'next';\n".repeat(20)}`,
    }],
    "failed",
    "pass",
  )!;

  it("预算充足时与 compactAssertionSummary 完全一致", () => {
    const full = compactAssertionSummary(summary);
    expect(fitCompactAssertionSummary(summary, full.length)).toBe(full);
  });

  it("空间不足先截语义标题,received 保留最大份额", () => {
    const full = compactAssertionSummary(summary);
    const fitted = fitCompactAssertionSummary(summary, full.length - 20);
    expect(fitted.length).toBeLessThanOrEqual(full.length - 20);
    // 标题被截(带 …),matcher 与 received 前缀仍在
    expect(fitted).not.toContain("Catalog reads use use-cache directive and products cache tag");
    expect(fitted).toContain("…");
    expect(fitted).toContain("includes(");
    expect(fitted).toContain("received");
  });

  it("预算再小也收得住:整串不超预算且以 … 收口", () => {
    const fitted = fitCompactAssertionSummary(summary, 80);
    expect(fitted.length).toBeLessThanOrEqual(80);
    expect(fitted).toMatch(/…/);
  });
});
