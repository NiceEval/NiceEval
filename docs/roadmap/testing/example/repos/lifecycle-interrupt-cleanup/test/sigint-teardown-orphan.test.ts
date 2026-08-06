import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseNdjson, runProcess, startProcess } from "./support/process.ts";
import { defined, only } from "./support/assert.ts";

// NiceEval 根目录：pnpm e2e --repo lifecycle-interrupt-cleanup
// 已安装候选包的隔离 Repo 根：pnpm test

const BACKEND_INFO_PATH = join(process.cwd(), "backend.info");

interface BackendInfo {
  pid: number;
  port: number;
}

interface ExpEvent {
  event: string;
  status?: string;
  experimentId?: string;
}

interface ResultEvent extends ExpEvent {
  event: "result";
  status: "passed" | "failed" | "incomplete" | "interrupted";
}

function isResultEvent(item: ExpEvent): item is ResultEvent {
  return item.event === "result";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等 owned backend 写出的信息文件（pid + 动态端口），超时视为准备失败。 */
async function waitForBackendInfo(timeoutMs = 15_000): Promise<BackendInfo> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = JSON.parse(readFileSync(BACKEND_INFO_PATH, "utf8")) as BackendInfo;
      if (typeof info.pid === "number" && typeof info.port === "number") return info;
    } catch {
      /* backend 还没写出来 */
    }
    await sleep(100);
  }
  throw new Error(`backend.info 在 ${timeoutMs}ms 内没有就绪`);
}

/** 等 owned backend 真的接受连接：/health 返回 200，而不是只看调度事件行。 */
async function waitForHealth(baseUrl: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.status === 200) return;
    } catch {
      /* backend 还没监听 */
    }
    await sleep(100);
  }
  throw new Error(`${baseUrl}/health 在 ${timeoutMs}ms 内没有返回 200`);
}

// 中断路径契约见 docs/runner.md「退出码」与 docs/cli.md「中断:三级响应」：
// SIGINT 让 Invocation 折叠成 interrupted，退出码 130，实验级 teardown 照常执行。
// 无 orphan 必须核对 owned 资源本身（backend 的 pid 与端口），只查父进程 pid 不算。
test("SIGINT 后退出码 130、teardown 执行、owned backend 消失、下一消费者可用", async () => {
  rmSync(BACKEND_INFO_PATH, { force: true });
  const controlled = startProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "slow", "--json",
  ]);
  try {
    // 等 owned backend 真启动：先取信息文件，再等 /health 返回 200。
    const info = await waitForBackendInfo();
    const baseUrl = `http://127.0.0.1:${info.port}`;
    await waitForHealth(baseUrl);
    expect(controlled.send("SIGINT")).toBe(true);

    const interrupted = await controlled.done;
    expect(interrupted.exitCode, interrupted.diagnostic()).toBe(130);

    const events = parseNdjson<ExpEvent>(interrupted.stdout, interrupted.diagnostic());
    const result = events.filter(isResultEvent).at(-1);
    expect(result).toMatchObject({ event: "result", status: "interrupted" });

    // 实验级 teardown 在中断路径也要执行（docs/feature/experiments/architecture.md
    // 「实验级生命周期」：失败、中断也执行）。
    const teardown = only(
      events,
      (item) => item.event === "experiment_teardown" && item.experimentId === "slow",
      interrupted.diagnostic(),
    );
    expect(teardown.status).toBe("done");

    // 无 orphan：父进程与 owned backend 自己的 pid 都要消失，端口不再接受连接。
    expect(() => process.kill(defined(controlled.pid, interrupted.diagnostic()), 0)).toThrow();
    expect(() => process.kill(info.pid, 0)).toThrow();
    await expect(fetch(`${baseUrl}/health`)).rejects.toThrow();
  } finally {
    controlled.send("SIGINT");
    await controlled.done.catch(() => undefined);
    rmSync(BACKEND_INFO_PATH, { force: true });
  }

  // 下一次独立消费者可以正常启动，不受上次中断影响。
  const next = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "smoke", "--rerun", "all", "--json",
  ]);
  expect(next.exitCode, next.diagnostic()).toBe(0);
});
