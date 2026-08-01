// cases: docs/engineering/testing/unit/experiments-runner.md
// 「执行错误 message 的一层摘要投影」行:diagnose 组合消息首行恒为一层可行动摘要、output tail
// 从第二行起保留原始换行;失败事实 reason 对多行 error message 折首行、剥控制字节并按摘要上限
// 收口——tail 里的 traceback 框线不得出现在 scrollback 失败行。
// bug: memory/diagnose-tail-inline-defeats-one-line-elision.md

import { describe, expect, it } from "vitest";
import { shared } from "../../agents/shared.ts";
import { failureDetailFromResult } from "./failure.ts";
import type { EvalResult } from "../../types.ts";
import { completeEvidenceCoverage } from "../../scoring/coverage.ts";

const RICH_TAIL = [
  "│ ❱ 205 │   raise APIError(",
  "╰──────────────────────────╯",
  "APIError: Concurrency limit exceeded for user, please retry later",
].join("\n");

describe("shared.diagnoseFailure 的分层消息", () => {
  it("首行是一层摘要(exit code · last error 首行),output tail 从第二行起保留原始换行", () => {
    const message = shared.diagnoseFailure(
      { exitCode: 1, stdout: "", stderr: RICH_TAIL },
      [
        {
          type: "error",
          message: "Concurrency limit exceeded for user, please retry later\nTraceback (most recent call last): …",
        },
      ],
      "{}",
    );
    const lines = message.split("\n");
    expect(lines[0]).toBe(
      "agent run exited with code 1 · last error: Concurrency limit exceeded for user, please retry later",
    );
    expect(lines[1]).toBe("output tail:");
    expect(lines.slice(2)).toEqual(RICH_TAIL.split("\n"));
    expect(message).not.toContain(" ⏎ ");
  });

  it("stdout/stderr 全空时消息只有首行,不带空 tail 段", () => {
    const message = shared.diagnoseFailure({ exitCode: 2, stdout: "", stderr: "" }, [], undefined);
    expect(message).toBe("agent run exited with code 2 · transcript was not generated");
    expect(message).not.toContain("\n");
  });
});

function erroredResult(message: string): EvalResult {
  return {
    id: "react-datepicker/pr-6168",
    experimentId: "compare/bub",
    agent: "bub",
    verdict: "errored",
    attempt: 0,
    durationMs: 1,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
    locator: "@1abc1234",
    error: { code: "turn-failed", message, origin: { scope: "attempt" as const, phase: "eval.run" } },
  };
}

describe("failureDetailFromResult 的 errored reason 收口", () => {
  it("多行 message 只取首行,tail 的框线不进 reason", () => {
    const detail = failureDetailFromResult(
      erroredResult(
        `This send returned failed: agent run exited with code 1 · last error: rate limited\noutput tail:\n${RICH_TAIL}`,
      ),
    );
    expect(detail?.reason).toBe("This send returned failed: agent run exited with code 1 · last error: rate limited");
    expect(detail?.reason).not.toContain("│");
    expect(detail?.reason).not.toContain("output tail");
  });

  it("单行 message 原样保留", () => {
    const detail = failureDetailFromResult(erroredResult("sandbox allocation failed after 5 attempts"));
    expect(detail?.reason).toBe("sandbox allocation failed after 5 attempts");
  });

  it("首行剥控制字节并按摘要上限截断收口", () => {
    const esc = "\u001b";
    const noisy = `${esc}[31mboom${esc}[0m ${"x".repeat(300)}\nsecond line`;
    const detail = failureDetailFromResult(erroredResult(noisy));
    expect(detail?.reason.startsWith("boom xxx")).toBe(true);
    expect(detail?.reason).not.toContain(esc);
    expect(detail?.reason.length).toBeLessThanOrEqual(240);
    expect(detail?.reason.endsWith("…")).toBe(true);
  });
});
