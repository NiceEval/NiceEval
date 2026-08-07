import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { ProcessStartError } from "../src/process.js";
import { startProcess, waitForOutput, withProcess } from "../src/process-lifecycle.js";
import type { ProcessHandle } from "../src/process-lifecycle.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/process/${name}`, import.meta.url));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function pidIsDead(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

describe("startProcess", () => {
  test("暴露 pid 与输出流", async () => {
    const handle = startProcess([process.execPath, fixture("ready.mjs")]);
    expect(handle.pid).toBeTypeOf("number");
    expect(handle.stdout).not.toBeNull();
    expect(handle.stderr).not.toBeNull();
    await handle.dispose();
    expect(handle.settledExit).toBe(true);
  });

  test("waiter 挂载前已输出的 readiness 仍能命中", async () => {
    const handle = startProcess([process.execPath, fixture("ready.mjs")]);
    await sleep(300);
    const text = await waitForOutput(handle, "stdout", /READY/, {
      timeoutMs: 2000,
      label: "late waiter",
    });
    expect(text).toContain("READY");
    await handle.dispose();
  });

  test("输出流 tee 也能被订阅", async () => {
    const handle = startProcess([process.execPath, fixture("ready.mjs")]);
    const chunks: string[] = [];
    handle.stdout?.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString("utf8"));
    });
    await waitForOutput(handle, "stdout", /READY/, { timeoutMs: 2000, label: "tee" });
    expect(chunks.join("")).toContain("READY");
    await handle.dispose();
  });

  test("进程退出后 waiter 仍从缓冲命中", async () => {
    const handle = startProcess([process.execPath, fixture("quick-exit.mjs")]);
    const receipt = await handle.done;
    expect(receipt.exitCode).toBe(0);
    const text = await waitForOutput(handle, "stdout", /QUICK/, {
      timeoutMs: 2000,
      label: "after exit",
    });
    expect(text).toContain("QUICK");
  });

  test("进程提前退出时 waiter 报错而不是超时", async () => {
    const handle = startProcess([process.execPath, fixture("quick-exit.mjs")]);
    await expect(
      waitForOutput(handle, "stdout", /NEVER/, { timeoutMs: 3000, label: "early" }),
    ).rejects.toThrow(/exited before producing/);
  });

  test("signal() 只向根进程发送产品刺激", async () => {
    const handle = startProcess([process.execPath, fixture("listener.mjs")]);
    await waitForOutput(handle, "stdout", /LISTENING/, {
      timeoutMs: 2000,
      label: "listening",
    });
    expect(handle.signal("SIGINT")).toBe(true);
    const receipt = await handle.done;
    expect(receipt.exitCode).toBe(42);
    expect(receipt.signal).toBeNull();
    expect(receipt.timedOut).toBe(false);
    expect(receipt.stdout).toContain("GOT-SIGINT");
  });

  test("进程已退出后 signal() 返回 false", async () => {
    const handle = startProcess([process.execPath, fixture("quick-exit.mjs")]);
    await handle.done;
    expect(handle.signal("SIGTERM")).toBe(false);
  });

  test("dispose 幂等", async () => {
    const handle = startProcess([process.execPath, fixture("ready.mjs")]);
    await waitForOutput(handle, "stdout", /READY/, { timeoutMs: 2000, label: "ready" });
    await handle.dispose();
    await handle.dispose();
    await handle.dispose();
    const receipt = await handle.done;
    expect(receipt.exitCode).toBe(0);
  });

  test("dispose 按 TERM → grace → KILL 升级", async () => {
    const handle = startProcess([process.execPath, fixture("ignore-term.mjs")], {
      graceMs: 300,
    });
    await waitForOutput(handle, "stdout", /STARTED/, {
      timeoutMs: 2000,
      label: "started",
    });
    const startedAt = Date.now();
    await handle.dispose();
    const receipt = await handle.done;
    expect(receipt.exitCode).toBeNull();
    expect(receipt.signal).toBe("SIGKILL");
    expect(receipt.timedOut).toBe(false);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
  });

  test("TERM 被妥善处理时 dispose 不升级", async () => {
    const handle = startProcess([process.execPath, fixture("ready.mjs")], {
      graceMs: 300,
    });
    await waitForOutput(handle, "stdout", /READY/, { timeoutMs: 2000, label: "ready" });
    await handle.dispose();
    const receipt = await handle.done;
    expect(receipt.exitCode).toBe(0);
    expect(receipt.signal).toBeNull();
  });

  test("timeout 触发 TERM 并标记 timedOut", async () => {
    const handle = startProcess([process.execPath, fixture("forever.mjs")], {
      timeoutMs: 400,
      graceMs: 300,
    });
    const receipt = await handle.done;
    expect(receipt.timedOut).toBe(true);
    expect(receipt.exitCode).toBeNull();
    expect(receipt.signal).toBe("SIGTERM");
    expect(receipt.durationMs).toBeGreaterThanOrEqual(400);
  });

  test("timeout 遇到拒绝 TERM 的进程升级 KILL", async () => {
    const handle = startProcess([process.execPath, fixture("ignore-term.mjs")], {
      timeoutMs: 300,
      graceMs: 200,
    });
    await waitForOutput(handle, "stdout", /STARTED/, {
      timeoutMs: 2000,
      label: "started",
    });
    const receipt = await handle.done;
    expect(receipt.timedOut).toBe(true);
    expect(receipt.signal).toBe("SIGKILL");
  });

  test("processGroup 让 dispose 终结整组后代", async () => {
    const handle = startProcess([process.execPath, fixture("spawner.mjs")], {
      processGroup: true,
      graceMs: 300,
    });
    const text = await waitForOutput(handle, "stdout", /CHILD-PID:(\d+)/, {
      timeoutMs: 3000,
      label: "child pid",
    });
    const grandchildPid = Number(/CHILD-PID:(\d+)/.exec(text)?.[1]);

    await handle.dispose();
    const receipt = await handle.done;
    expect(receipt.exitCode).toBeNull();
    expect(receipt.signal).toBe("SIGTERM");

    const deadline = Date.now() + 3000;
    while (!(await pidIsDead(grandchildPid))) {
      if (Date.now() > deadline) {
        throw new Error(`grandchild ${grandchildPid} survived dispose`);
      }
      await sleep(50);
    }
  });
});

describe("withProcess", () => {
  test("正文成功后 cleanup 结束 owned process", async () => {
    let handle: ProcessHandle | undefined;
    const result = await withProcess(
      [process.execPath, fixture("ready.mjs")],
      { graceMs: 300 },
      async (h) => {
        handle = h;
        const text = await waitForOutput(h, "stdout", /READY/, {
          timeoutMs: 2000,
          label: "ready",
        });
        return text.length;
      },
    );
    expect(result).toBeGreaterThan(0);
    expect(handle).toBeDefined();
    expect(handle!.settledExit).toBe(true);
    const receipt = await handle!.done;
    expect(receipt.exitCode).toBe(0);
  });

  test("正文失败时 cleanup 照常执行并传播正文错误", async () => {
    let handle: ProcessHandle | undefined;
    await expect(
      withProcess(
        [process.execPath, fixture("listener.mjs")],
        { graceMs: 300 },
        async (h) => {
          handle = h;
          throw new Error("body boom");
        },
      ),
    ).rejects.toThrow("body boom");
    expect(handle).toBeDefined();
    expect(handle!.settledExit).toBe(true);
  });

  test("正文和 cleanup 同时失败抛 AggregateError，主错误排第一并作 cause", async () => {
    await expect(
      withProcess(
        ["definitely-not-a-real-binary-testkit-xyz"],
        {},
        async () => {
          throw new Error("body boom");
        },
      ),
    ).rejects.toMatchObject({
      errors: [
        { message: "body boom" },
        expect.any(ProcessStartError),
      ],
      cause: { message: "body boom" },
    });
  });

  test("只有 cleanup 失败时直接抛 cleanup 错误", async () => {
    await expect(
      withProcess(["definitely-not-a-real-binary-testkit-xyz"], {}, async () => 42),
    ).rejects.toBeInstanceOf(ProcessStartError);
  });

  test("正文中先 dispose 后返回，cleanup 是 no-op", async () => {
    await withProcess(
      [process.execPath, fixture("ready.mjs")],
      { graceMs: 300 },
      async (h) => {
        await waitForOutput(h, "stdout", /READY/, { timeoutMs: 2000, label: "ready" });
        await h.dispose();
        return "done";
      },
    );
  });

  test("readiness 轮询超时进入 cleanup 并传播等待错误", async () => {
    let handle: ProcessHandle | undefined;
    await expect(
      withProcess(
        [process.execPath, fixture("listener.mjs")],
        { graceMs: 300 },
        async (h) => {
          handle = h;
          await waitForOutput(h, "stdout", /NEVER-MATCHES/, {
            timeoutMs: 200,
            label: "readiness never",
          });
        },
      ),
    ).rejects.toThrow(/readiness never/);
    expect(handle).toBeDefined();
    expect(handle!.settledExit).toBe(true);
    const receipt = await handle!.done;
    expect(receipt.exitCode).toBe(0);
    expect(receipt.signal).toBeNull();
    expect(receipt.timedOut).toBe(false);
  });
});
