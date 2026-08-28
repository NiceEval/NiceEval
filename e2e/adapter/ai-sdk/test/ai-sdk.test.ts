// owner: docs/engineering/testing/e2e/adapter/ai-sdk.md#adapter-ai-sdk-live-compatibility
//
// 单文件 Journey：启动真实 AI SDK HTTP 应用，运行安装后的 niceeval candidate，
// 再从公开 CLI 读回 Experiment、attempt 与 execution。测试不导入候选
// 源码或类型，不读取私有结果布局；判分仍由 evals/ 内的真实 uiMessageStreamAgent
// 事件断言负责。

import "dotenv/config";
import {
  assertExpEvalOutcomes,
  command,
  type ExpEvalOutcomeExpectation,
  type ProcessReceipt,
  waitForOutput,
  withProcess,
} from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AI_SDK_BASE_URL } from "../src/topology.ts";
import { runInspectionQuery } from "./query.ts";

const EXPECTED_OUTCOMES = [
  // tool-call：天气请求须以裸名调用 get_weather，并按 call ID 配对输出；单次请求期望 passed/1。
  { experimentId: "ci", evalId: "tool-call", verdict: "passed", attempts: 1, passed: 1 },
  // hitl-approval：approve 须恢复 completed，独立 deny 分支须 rejected 且无工具结果；期望 passed/1。
  { experimentId: "ci", evalId: "hitl-approval", verdict: "passed", attempts: 1, passed: 1 },
  // session-replay：同一会话须回忆首轮事实，新会话须隔离历史；两个分支成立时为 passed/1。
  { experimentId: "ci", evalId: "session-replay", verdict: "passed", attempts: 1, passed: 1 },
] as const satisfies readonly ExpEvalOutcomeExpectation[];
const EXPECTED_EVALS = EXPECTED_OUTCOMES.map((outcome) => outcome.evalId);
const REQUIRED_LIVE_SECRETS = ["OPENAI_API_KEY", "OPENAI_BASE_URL"] as const;

const niceevalBin = join(process.cwd(), "node_modules", ".bin", "niceeval");
const niceeval = command([niceevalBin]);

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live AI SDK E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    if (Date.now() >= deadline) {
      throw new Error(`AI SDK app did not become ready at ${url} within ${timeoutMs}ms`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  }
}

it("真实 AI SDK adapter 运行结果经过公开 CLI 读回", async () => {
  requireLiveSecrets();
  rmSync(".niceeval", { recursive: true, force: true });

  await withProcess(
    ["pnpm", "exec", "tsx", "src/backend/server.ts"],
    {
      processGroup: true,
      timeoutMs: 14 * 60_000,
    },
    async (server) => {
      await waitForOutput(server, "stdout", /ai-sdk e2e server listening/, {
        timeoutMs: 20_000,
        label: "ai-sdk backend readiness",
      });
      await waitForHealth(`${AI_SDK_BASE_URL}/healthz`, 20_000);

      // invoke：完整 argv 走安装后的 candidate binary；真实 provider 与
      // uiMessageStreamAgent 仍由 experiments/ci.ts + evals/ 驱动。
      let run!: ProcessReceipt;
      await withProcess(
        [niceevalBin, "exp", "--rerun", "all", "--json"],
        { processGroup: true, timeoutMs: 13 * 60_000 },
        async (running) => {
          run = await running.done;
        },
      );
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const evalEvents = assertExpEvalOutcomes(
        run.expEvalEvents(),
        EXPECTED_OUTCOMES,
        () => run.diagnostic(),
      );
      // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md）：
      // completion 与 runIds；每个 Eval 的 identity/verdict/attempts 由中间 eval
      // 事件逐一断言，live provider 故障不会冒充通过。
      const inv = run.expReceipt();
      expect(inv.completion, run.diagnostic()).toBe("completed");
      expect(inv.createdRunIds, run.diagnostic()).toHaveLength(1);
      const locators = new Map<string, string>();
      for (const evalId of EXPECTED_EVALS) {
        const evalEvent = evalEvents.find((event) => event.evalId === evalId)!;
        locators.set(evalId, evalEvent.locator);
      }

      // outcome：execution 是适配器收到的公开投影；工具名与入参必须穿过
      // 归一化、落盘与 CLI 展示。
      const toolLocator = locators.get("tool-call")!;
      const queried = await runInspectionQuery(niceeval, {
        kind: "attempt.trace",
        locator: toolLocator,
      });
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      const document = queried.attemptTrace();
      expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
      const trace = JSON.stringify(document.trace);
      expect(trace).toContain("get_weather");
      expect(trace).toMatch(/北京/);

    },
  );
});
