// feature: docs/feature/experiments/use-case/生命周期/启动共享服务.md
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { command, defined, only, pollUntil, withProcess, withProjectCopy, withTempDir } from "@niceeval/testkit";
import { expect, test } from "vitest";

// NiceEval 根目录：pnpm e2e --repo lifecycle -- --run test/interrupt-cleanup.test.ts
// 已安装候选包的隔离 Repo 根：pnpm test

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);

// 外层副本隔离 NiceEval 状态（.niceeval / config / evals），内层临时目录隔离控制收据
// （backend.json 与端口）；两者不互相污染。
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-e2e-lifecycle-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

interface BackendInfo {
  pid: number;
  port: number;
}

interface InvocationReceiptRecord {
  type: "receipt";
  receipt: { completion: "complete" | "incomplete" | "interrupted" };
}

type InvocationMachineRecord =
  | { type: "snapshot" | "observation" | "claim" | "heartbeat" }
  | InvocationReceiptRecord;

function invocationReceipt(records: readonly InvocationMachineRecord[], diagnostic: string): InvocationReceiptRecord {
  const receipts = records.filter((record): record is InvocationReceiptRecord => record.type === "receipt");
  return only(receipts, () => true, diagnostic);
}

/** backend.json 的格式属于本 Repo；Testkit 只拥有临时目录与轮询时序。 */
async function readBackendInfoIfReady(path: string): Promise<BackendInfo | undefined> {
  try {
    const info = JSON.parse(await readFile(path, "utf8")) as BackendInfo;
    return typeof info.pid === "number" && typeof info.port === "number" ? info : undefined;
  } catch {
    return undefined;
  }
}

/** 等 owned backend 真的接受连接：/health 返回 200，而不是只看调度事件行。 */
async function waitForHealth(baseUrl: string): Promise<void> {
  await pollUntil(async () => {
    try {
      return (await fetch(`${baseUrl}/health`)).status === 200 ? true : undefined;
    } catch {
      return undefined;
    }
  }, { timeoutMs: 15_000, intervalMs: 100, label: `${baseUrl}/health` });
}

// 中断路径契约见 docs/runner.md「退出码」与 docs/cli.md「中断:三级响应」：
// SIGINT 让 Invocation 折叠成 interrupted，退出码 130，实验级 teardown 照常执行。
// 无 orphan 必须核对 owned 资源本身（backend 的 pid 与端口），只查父进程 pid 不算。
test("SIGINT 后返回 130、实验 teardown 完成、owned backend 释放且下一消费者可运行", async () => {
  await withProjectCopy(PROJECT_COPY, async ({ root }) => {
    await withTempDir("niceeval-lifecycle-", async (controlRoot) => {
      const backendInfoPath = join(controlRoot, "backend.json");
      const owned = await withProcess(
        ["pnpm", "--silent", "exec", "niceeval", "exp", "slow", "--json"],
        {
          cwd: root,
          env: { ...process.env, NICEEVAL_BACKEND_INFO_PATH: backendInfoPath },
          processGroup: true,
          dispose: { signal: "SIGINT", graceMs: 5_000 },
        },
        async (controlled) => {
          // 等 owned backend 真启动：先取信息文件，再等 /health 返回 200。
          const info = await pollUntil(() => readBackendInfoIfReady(backendInfoPath), {
            timeoutMs: 15_000,
            intervalMs: 100,
            label: backendInfoPath,
          });
          const baseUrl = `http://127.0.0.1:${info.port}`;
          await waitForHealth(baseUrl);
          // 这是给 NiceEval 根进程的唯一产品刺激；processGroup 仅供 dispose/timeout 异常终结时覆盖整组。
          expect(controlled.signal("SIGINT")).toBe(true);

          const interrupted = await controlled.done;
          expect(interrupted.exitCode, interrupted.diagnostic()).toBe(130);

          expect(invocationReceipt(interrupted.ndjson<InvocationMachineRecord>(), interrupted.diagnostic()))
            .toMatchObject({ type: "receipt", receipt: { completion: "interrupted" } });

          // 中断后的 teardown 由下方对 owned backend 的真实释放证明，而不是旧的结果摘要事件。

          return {
            invocationPid: defined(controlled.pid, () => interrupted.diagnostic()),
            backendPid: info.pid,
            baseUrl,
          };
        },
      );

      // `withProcess` 返回前已做幂等 dispose；再核对产品拥有的真实资源。
      expect(() => process.kill(owned.invocationPid, 0)).toThrow();
      expect(() => process.kill(owned.backendPid, 0)).toThrow();
      await expect(fetch(`${owned.baseUrl}/health`)).rejects.toThrow();

      // 下一次独立消费者在同一个私有项目副本 cwd 里正常启动，不受上次中断影响。
      const next = await niceeval.run(
        ["exp", "post-interrupt-consumer", "--rerun", "all", "--json"],
        { cwd: root },
      );
      expect(next.exitCode, next.diagnostic()).toBe(0);
    });
  });
});
