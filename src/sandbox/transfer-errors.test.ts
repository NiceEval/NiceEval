// cases: docs/engineering/testing/unit/sandbox.md
// 归属「文件操作与 IO 重试」那一类。
// 契约: docs/error-feedback.md「超时报错的三要素」—— 任何超时报错必须说清哪个操作、
// 对什么对象、预算多少谁定的。`The operation was aborted due to timeout`(e2b 一类 SDK 的
// 裸串)三样都缺,按缺陷处理;这里验的是包装层补齐了三要素、且**只**改写超时形态。

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeSandboxPaths } from "./paths.ts";
import { isTransferTimeout } from "./transfer-errors.ts";
import type { Sandbox } from "../types.ts";

/** 传输方法按注入的错误失败,其余方法不参与本文件。 */
function failingSandbox(error: unknown): Sandbox {
  const fail = async () => {
    throw error;
  };
  return {
    workdir: "/work",
    sandboxId: "fake",
    otlpHost: null,
    runCommand: fail,
    runShell: fail,
    readFile: fail,
    fileExists: fail,
    writeFiles: fail,
    uploadFiles: fail,
    uploadDirectory: fail,
    downloadDirectory: fail,
    downloadFile: fail,
    uploadFile: fail,
    stop: async () => {},
  } as unknown as Sandbox;
}

const e2bTimeout = () => new Error("The operation was aborted due to timeout");

/** 只取抛出的错误(传输方法本身返回 void,不能靠 .catch 的联合类型读 message)。 */
async function catchError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the transfer to fail");
}

describe("isTransferTimeout", () => {
  it("认得 SDK / undici / socket 各家的超时形态(含 cause 链里的)", () => {
    expect(isTransferTimeout(e2bTimeout())).toBe(true);
    expect(isTransferTimeout(Object.assign(new Error("x"), { name: "HeadersTimeoutError" }))).toBe(true);
    expect(isTransferTimeout(new TypeError("fetch failed", { cause: Object.assign(new Error("t"), { code: "ETIMEDOUT" }) }))).toBe(
      true,
    );
  });

  it("不把权限 / 不存在 / 限流当成超时(它们各有自己的下一步)", () => {
    expect(isTransferTimeout(new Error("EACCES: permission denied, open '/tmp/x'"))).toBe(false);
    expect(isTransferTimeout(new Error("ENOENT: no such file"))).toBe(false);
    expect(isTransferTimeout(new Error("429 too many requests"))).toBe(false);
  });
});

describe("沙箱文件传输超时的报错质量", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("uploadFile 超时:报错点名 provider、操作、沙箱侧路径与字节数,并说明这不是 attempt 预算", async () => {
    const sandbox = normalizeSandboxPaths(failingSandbox(e2bTimeout()), "e2b");

    const error = await catchError(() => sandbox.uploadFile("fixtures/repo.tar", Buffer.alloc(3_000)));

    // 三要素:哪个操作(provider + 方法名)/ 对什么对象(路径 + 字节数)/ 这条线是谁的。
    expect(error.message).toContain("e2b");
    expect(error.message).toContain("uploadFile");
    expect(error.message).toContain("/work/fixtures/repo.tar");
    expect(error.message).toContain("2.9 KiB");
    expect(error.message).toMatch(/timeoutMs|--timeout/);
    // 原始裸串不做消息(它是三样都缺的那条),但作为证据留在 cause 里。
    expect(error.message).not.toContain("The operation was aborted due to timeout");
    expect((error.cause as Error).message).toBe("The operation was aborted due to timeout");
  });

  it("uploadDirectory 超时:字节数在失败路径上现量本地来源,报错同时点名本地目录", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niceeval-transfer-"));
    dirs.push(dir);
    await writeFile(join(dir, "big.bin"), Buffer.alloc(4_096));
    const sandbox = normalizeSandboxPaths(failingSandbox(e2bTimeout()), "e2b");

    const error = await catchError(() => sandbox.uploadDirectory(dir, "fixtures"));

    expect(error.message).toContain("uploadDirectory");
    expect(error.message).toContain("/work/fixtures");
    expect(error.message).toContain(dir);
    expect(error.message).toContain("4.0 KiB");
  });

  it("非超时失败原样抛回(不套壳、不改写错误链)", async () => {
    const denied = new Error("EACCES: permission denied, open '/work/fixtures/x'");
    const sandbox = normalizeSandboxPaths(failingSandbox(denied), "e2b");

    // 区分力:这一格证明包装只改写超时形态,权限 / 不存在这类确定性失败仍是原始对象本身。
    await expect(sandbox.uploadFile("fixtures/x", Buffer.alloc(1))).rejects.toBe(denied);
  });
});
