// 跨进程保证：进程终止与信号——场景命令超时后，运行摘要保留触发终止的原因
import { Effect } from "effect";
import { expect, test } from "vitest";
import { OwnedProcessLive, runOwnedProcess } from "../../packages/e2e-runner/src/owned-process.ts";
import { classifyFromReceipt } from "../../packages/e2e-runner/src/receipt.ts";

test.each([
  { script: "setInterval(() => {}, 60_000)", timeoutMs: 300, timedOut: true },
  { script: "process.exit(143)", timeoutMs: 10_000, timedOut: false },
])("the summary attributes a timeout only when the runner enforced it ($timedOut)", async (example) => {
  const capture = await Effect.runPromise(
    runOwnedProcess([process.execPath, "-e", example.script], {
      cwd: process.cwd(),
      output: "capture",
      timeoutMs: example.timeoutMs,
    }).pipe(Effect.scoped, Effect.provide(OwnedProcessLive)),
  );
  expect(capture.timedOut).toBe(example.timedOut);
  expect(capture.cancelled).toBe(false);
  const failure = classifyFromReceipt(
    { stages: [{ stage: "test", ok: false, attempt: 1, detail: "test invocation 1 failed", capture }], detail: "" },
    example.timeoutMs / 60_000,
  );
  expect(failure).toEqual({
    category: "regression",
    detail: example.timedOut
      ? "test invocation 1 failed (exceeded project.json timeoutMinutes of 0.005 min)"
      : "test invocation 1 failed",
  });
});
