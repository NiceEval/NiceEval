import { expect, test } from "vitest";
import { command, defined, only, pollUntil, waitForOutput, withProcess } from "./api.ts";

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);

test("AI SDK backend 就绪后运行真实 adapter，结束时一定回收 backend", async () => {
  const backendUrl = await withProcess(
    ["pnpm", "--silent", "start"],
    { env: { PORT: "0" }, dispose: { signal: "SIGTERM", graceMs: 5_000 } },
    async (backend) => {
      const url = await waitForOutput(backend, "stdout", /http:\/\/127\.0\.0\.1:\d+/, {
        timeoutMs: 20_000,
        label: "AI SDK backend URL",
      });

      const run = await niceeval.run(
        ["exp", "tool-call", "--rerun", "all", "--json"],
        { env: { AI_SDK_URL: url } },
      );
      expect(run.exitCode, run.diagnostic()).toBe(0);

      // 工具名、入参和 execution identity 继续由 Adapter 测试正文断言。
      return url;
    },
  );

  await expect(fetch(new URL("/health", backendUrl))).rejects.toThrow();
});

interface ExpEvent {
  event: string;
  status?: string;
  experimentId?: string;
}

test("SIGINT 后退出 130、执行 teardown、owned backend 消失且下一消费者可用", async () => {
  const owned = await withProcess(
    ["pnpm", "--silent", "exec", "niceeval", "exp", "slow", "--json"],
    { processGroup: true, dispose: { signal: "SIGINT", graceMs: 5_000 } },
    async (invocation) => {
      const info = await pollUntil(async () => readBackendInfoIfReady(), {
        timeoutMs: 15_000,
        intervalMs: 100,
        label: "backend.info",
      });
      await waitForHealth(`http://127.0.0.1:${info.port}`);

      expect(invocation.signal("SIGINT")).toBe(true);
      const interrupted = await invocation.done;
      expect(interrupted.exitCode, interrupted.diagnostic()).toBe(130);
      const events = interrupted.ndjson<ExpEvent>();
      expect(only(
        events,
        (event) => event.event === "result",
        () => interrupted.diagnostic(),
      )).toMatchObject({ event: "result", status: "interrupted" });
      expect(only(
        events,
        (event) => event.event === "experiment_teardown" && event.experimentId === "slow",
        () => interrupted.diagnostic(),
      )).toMatchObject({ status: "done" });

      return {
        invocationPid: defined(invocation.pid, () => interrupted.diagnostic()),
        backendPid: info.pid,
        backendUrl: `http://127.0.0.1:${info.port}`,
      };
    },
  );

  expect(() => process.kill(owned.invocationPid, 0)).toThrow();
  expect(() => process.kill(owned.backendPid, 0)).toThrow();
  await expect(fetch(`${owned.backendUrl}/health`)).rejects.toThrow();

  const next = await niceeval.run(["exp", "smoke", "--rerun", "all", "--json"]);
  expect(next.exitCode, next.diagnostic()).toBe(0);
});

declare function readBackendInfoIfReady(): Promise<{ pid: number; port: number } | undefined>;
declare function waitForHealth(url: string): Promise<void>;
