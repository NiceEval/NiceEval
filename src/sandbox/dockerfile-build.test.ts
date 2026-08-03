// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖类别:
// - builder CLI 的 stdout 反压与失败诊断上限
import { describe, expect, it } from "vitest";
import { runBuildCommand } from "./dockerfile-build.ts";

describe("Dockerfile builder 子进程输出", () => {
  it("持续 drain 大量 stdout，不因 pipe buffer 写满而挂起", async () => {
    await expect(
      runBuildCommand(
        process.execPath,
        ["-e", "for (let i = 0; i < 2048; i += 1) process.stdout.write('x'.repeat(1024))"],
        AbortSignal.timeout(5_000),
      ),
    ).resolves.toBeUndefined();
  });

  it("失败只携带有界 stderr 尾部", async () => {
    await expect(
      runBuildCommand(
        process.execPath,
        ["-e", "process.stderr.write('a'.repeat(128 * 1024) + 'TAIL'); process.exit(7)"],
        new AbortController().signal,
      ),
    ).rejects.toThrow(/failed \(7\): a+TAIL$/);
  });
});
