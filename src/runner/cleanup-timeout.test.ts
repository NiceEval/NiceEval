// cases: docs/engineering/unit-tests/experiments-runner/cases.md
// (「cleanup 执行有界」行;sandbox/cases.md 的「收尾链每个可调用体各有清理超时」行同样由本文件证明机制)
// bug: memory/force-exit-skips-experiment-teardown.md
import { describe, expect, it } from "vitest";
import { withCleanupTimeout } from "./cleanup-timeout.ts";

describe("withCleanupTimeout", () => {
  it("挂起的可调用体到点抛超时错误(消息含超时毫秒数)", async () => {
    await expect(withCleanupTimeout(() => new Promise<never>(() => {}), 20)).rejects.toThrow(/20ms/);
  });

  it("按时完成的可调用体原样透传返回值;抛错原样透传,不被包装", async () => {
    await expect(withCleanupTimeout(async () => "ok", 1_000)).resolves.toBe("ok");
    await expect(withCleanupTimeout(() => Promise.reject(new Error("boom")), 1_000)).rejects.toThrow("boom");
  });
});
