// buildAnnotatedEvalSource 的单测(定稿见 docs/concepts.md「标注 Eval 源码」)。
// 覆盖:同一行多条断言、无 loc 断言进 unmapped、loc 指向别的文件/越界行也进 unmapped
// (never silently dropped 的边界情况)、空断言数组、summary 计数、哈希与归一化行为。

import { describe, expect, it } from "vitest";
import type { AssertionResult } from "../types.ts";
import { buildAnnotatedEvalSource } from "./annotated-source.ts";
import { hashEvalSource, normalizeEvalSource } from "./source-hash.ts";

const SOURCE_PATH = "evals/weather.eval.ts";

function assertion(over: Partial<AssertionResult> & Pick<AssertionResult, "name">): AssertionResult {
  return {
    severity: "soft",
    score: 1,
    outcome: "passed" as const,
    ...over,
  } as AssertionResult;
}

describe("buildAnnotatedEvalSource", () => {
  it("maps multiple assertions on the same line, preserving input order", () => {
    const content = "line 1\nline 2\nline 3\n";
    const a1 = assertion({ name: "first", loc: { file: SOURCE_PATH, line: 2 } });
    const a2 = assertion({ name: "second", loc: { file: SOURCE_PATH, line: 2 } });
    const a3 = assertion({ name: "third", loc: { file: SOURCE_PATH, line: 1 } });

    const model = buildAnnotatedEvalSource({ path: SOURCE_PATH, content }, [a1, a2, a3]);

    expect(model.lines).toHaveLength(3);
    expect(model.lines[0]!.assertions.map((a) => a.name)).toEqual(["third"]);
    expect(model.lines[1]!.assertions.map((a) => a.name)).toEqual(["first", "second"]);
    expect(model.lines[2]!.assertions).toEqual([]);
    expect(model.unmapped).toEqual([]);
    expect(model.summary.mappedAssertions).toBe(3);
    expect(model.summary.unmappedAssertions).toBe(0);
  });

  it("buckets an assertion with no SourceLoc into unmapped, never dropping it", () => {
    const content = "only line\n";
    const withLoc = assertion({ name: "has-loc", loc: { file: SOURCE_PATH, line: 1 } });
    const withoutLoc = assertion({ name: "no-loc" });

    const model = buildAnnotatedEvalSource({ path: SOURCE_PATH, content }, [withLoc, withoutLoc]);

    expect(model.lines[0]!.assertions.map((a) => a.name)).toEqual(["has-loc"]);
    expect(model.unmapped.map((a) => a.name)).toEqual(["no-loc"]);
    expect(model.summary.totalAssertions).toBe(2);
    expect(model.summary.mappedAssertions).toBe(1);
    expect(model.summary.unmappedAssertions).toBe(1);
  });

  it("buckets an assertion whose loc points at a different file into unmapped", () => {
    const content = "a\nb\n";
    const elsewhere = assertion({ name: "elsewhere", loc: { file: "evals/other.eval.ts", line: 1 } });

    const model = buildAnnotatedEvalSource({ path: SOURCE_PATH, content }, [elsewhere]);

    expect(model.lines.every((l) => l.assertions.length === 0)).toBe(true);
    expect(model.unmapped).toEqual([elsewhere]);
  });

  it("buckets an assertion whose loc.line is out of range into unmapped", () => {
    const content = "a\nb\n"; // 2 lines
    const tooHigh = assertion({ name: "too-high", loc: { file: SOURCE_PATH, line: 3 } });
    const tooLow = assertion({ name: "too-low", loc: { file: SOURCE_PATH, line: 0 } });

    const model = buildAnnotatedEvalSource({ path: SOURCE_PATH, content }, [tooHigh, tooLow]);

    expect(model.lines.every((l) => l.assertions.length === 0)).toBe(true);
    expect(model.unmapped.map((a) => a.name).sort()).toEqual(["too-high", "too-low"]);
  });

  it("handles an empty assertions array: lines are still built, everything else is zeroed", () => {
    const content = "a\nb\nc\n";
    const model = buildAnnotatedEvalSource({ path: SOURCE_PATH, content }, []);

    expect(model.lines).toHaveLength(3);
    expect(model.lines.every((l) => l.assertions.length === 0)).toBe(true);
    expect(model.unmapped).toEqual([]);
    expect(model.summary).toEqual({
      totalAssertions: 0,
      mappedAssertions: 0,
      unmappedAssertions: 0,
      passed: 0,
      failed: 0,
      gate: 0,
      soft: 0,
      totalLines: 3,
      annotatedLines: 0,
    });
  });

  it("computes summary counts across passed/failed and gate/soft, mapped and unmapped alike", () => {
    const content = "line 1\nline 2\n";
    const assertions = [
      assertion({ name: "a", severity: "gate", outcome: "passed" as const, loc: { file: SOURCE_PATH, line: 1 } }),
      assertion({ name: "b", severity: "gate", outcome: "failed" as const, loc: { file: SOURCE_PATH, line: 1 } }),
      assertion({ name: "c", severity: "soft", outcome: "passed" as const, loc: { file: SOURCE_PATH, line: 2 } }),
      assertion({ name: "d", severity: "soft", outcome: "failed" as const }), // unmapped
    ];

    const model = buildAnnotatedEvalSource({ path: SOURCE_PATH, content }, assertions);

    expect(model.summary).toEqual({
      totalAssertions: 4,
      mappedAssertions: 3,
      unmappedAssertions: 1,
      passed: 2,
      failed: 2,
      gate: 2,
      soft: 2,
      totalLines: 2,
      annotatedLines: 2,
    });
  });

  it("does not produce a phantom trailing blank line for source text ending in a newline", () => {
    const content = "a\nb\n";
    const model = buildAnnotatedEvalSource({ path: SOURCE_PATH, content }, []);
    expect(model.lines.map((l) => l.text)).toEqual(["a", "b"]);
  });

  it("keeps a real trailing blank line when the source has one (double newline)", () => {
    const content = "a\nb\n\n";
    const model = buildAnnotatedEvalSource({ path: SOURCE_PATH, content }, []);
    expect(model.lines.map((l) => l.text)).toEqual(["a", "b", ""]);
  });

  it("treats an empty source file as a single empty line", () => {
    const model = buildAnnotatedEvalSource({ path: SOURCE_PATH, content: "" }, []);
    expect(model.lines).toEqual([{ line: 1, text: "", assertions: [] }]);
  });

  it("sourceSha256 matches hashEvalSource(normalizeEvalSource(content)) and is stable across CRLF/LF", () => {
    const lf = "a\nb\nc\n";
    const crlf = "a\r\nb\r\nc\r\n";

    const modelLf = buildAnnotatedEvalSource({ path: SOURCE_PATH, content: lf }, []);
    const modelCrlf = buildAnnotatedEvalSource({ path: SOURCE_PATH, content: crlf }, []);

    expect(modelLf.sourceSha256).toBe(hashEvalSource(normalizeEvalSource(lf)));
    expect(modelLf.sourceSha256).toBe(modelCrlf.sourceSha256);
    expect(modelLf.lines.map((l) => l.text)).toEqual(modelCrlf.lines.map((l) => l.text));
  });
});
