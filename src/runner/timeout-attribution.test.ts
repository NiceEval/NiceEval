// cases: docs/engineering/testing/unit/experiments-runner.md

import { describe, expect, it } from "vitest";

import { SandboxCommandTimeoutError, providerSessionLimitMs } from "../sandbox/deadline.ts";
import { errorFromThrown } from "./attempt.ts";

describe("attempt 超时归属", () => {
  it.each([
    ["flag", 30_000],
    ["experiment", 60_000],
    ["eval", 90_000],
    ["config", 120_000],
  ] as const)("deadline 剩余量触发时保留 %s 来源层", (source, limitMs) => {
    const error = errorFromThrown(
      new SandboxCommandTimeoutError("deadline reached", 1_234, false),
      "eval.run",
      { timeoutMs: limitMs, source },
    );

    expect(error.timeout).toEqual({ trigger: "attempt-deadline", limitMs, source });
  });

  it("命令显式 timeout 触发时归命令自己的上限,不冒充 attempt deadline", () => {
    const error = errorFromThrown(
      new SandboxCommandTimeoutError("command timed out", 5_000, true),
      "eval.run",
      { timeoutMs: 90_000, source: "eval" },
    );

    expect(error.timeout).toEqual({ trigger: "command-timeout", limitMs: 5_000, source: "command" });
  });

  it("provider 固有会话上限可在派发前解析,本地 provider 不凭空新增默认", () => {
    expect(providerSessionLimitMs("e2b")).toBe(1_800_000);
    expect(providerSessionLimitMs("vercel")).toBe(1_200_000);
    expect(providerSessionLimitMs("docker")).toBeUndefined();
    expect(providerSessionLimitMs("local")).toBeUndefined();
    expect(providerSessionLimitMs("e2b", 600_000)).toBe(600_000);
  });
});
