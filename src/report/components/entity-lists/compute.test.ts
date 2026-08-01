// cases: docs/engineering/testing/unit/reports.md
// 「数据计算函数(*Data)」行:errored 的单行摘要(failureSummaryOf)对多行 `error.message`
// 只取首行再收口——diagnose 从第二行起的 output tail(含被测 CLI 的 traceback 框线)不得折进
// Result 单元格;单行 message 原样保留。
// bug: memory/diagnose-tail-inline-defeats-one-line-elision.md

import { describe, expect, it } from "vitest";
import { failureSummaryOf } from "./compute.ts";
import type { EvalResult } from "../../../types.ts";
import { completeEvidenceCoverage } from "../../../scoring/coverage.ts";

function erroredResult(message: string): EvalResult {
  return {
    id: "react-datepicker/pr-6168",
    agent: "bub",
    verdict: "errored",
    attempt: 0,
    durationMs: 1,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
    error: { code: "turn-failed", message, origin: { scope: "attempt" as const, phase: "eval.run" } },
  };
}

describe("failureSummaryOf 的 errored 单行摘要", () => {
  it("多行 message 只取首行,tail 的框线不进 Result 单元格", () => {
    const { summary } = failureSummaryOf(
      erroredResult("agent run exited with code 1 · last error: rate limited\noutput tail:\n│ ❱ 205 │ raise APIError("),
    );
    expect(summary).toBe("eval.run · turn-failed · agent run exited with code 1 · last error: rate limited");
    expect(summary).not.toContain("│");
  });

  it("单行 message 原样保留", () => {
    const { summary } = failureSummaryOf(erroredResult("sandbox allocation failed"));
    expect(summary).toBe("eval.run · turn-failed · sandbox allocation failed");
  });
});
