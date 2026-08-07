import { describe, expect, it, vi } from "vitest";
import type { Sandbox } from "./types.ts";
import { liveSandboxCount, registerSandbox, stopSandbox } from "./registry.ts";

function sandboxWithStop(stop: Sandbox["stop"]): Sandbox {
  const ok = async () => ({ stdout: "", stderr: "", exitCode: 0 });
  return {
    workdir: "/workspace",
    sandboxId: "registry-retry",
    otlpHost: null,
    runCommand: ok,
    runShell: ok,
    runCommandOrThrow: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    runShellOrThrow: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    readText: async () => "",
    writeText: async () => {},
    readBytes: async () => new Uint8Array(),
    writeBytes: async () => {},
    pathExists: async () => true,
    uploadFile: async () => {},
    uploadDirectory: async () => {},
    downloadFile: async () => {},
    downloadDirectory: async () => {},
    stop,
  };
}

describe("sandbox registry stop ownership", () => {
  it("stop 失败后保持登记，后续成功才解除", async () => {
    const before = liveSandboxCount();
    let calls = 0;
    const stop = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("first stop failed");
    });
    const sandbox = sandboxWithStop(stop);
    registerSandbox(sandbox);

    await stopSandbox(sandbox, 100);
    expect(liveSandboxCount()).toBe(before + 1);

    await stopSandbox(sandbox, 100);
    expect(liveSandboxCount()).toBe(before);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
