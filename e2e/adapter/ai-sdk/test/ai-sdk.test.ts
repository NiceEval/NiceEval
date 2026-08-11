// owner: docs/engineering/testing/e2e/adapter/ai-sdk.md#adapter-ai-sdk-live-compatibility
//
// 单文件 Journey：启动真实 AI SDK HTTP 应用，运行安装后的 niceeval candidate，
// 再从公开 CLI 读回 Experiment、attempt、execution 与 timing。测试不导入候选
// 源码或类型，不读取私有结果布局；判分仍由 evals/ 内的真实 uiMessageStreamAgent
// 事件断言负责。

import "dotenv/config";
import {
  command,
  type ExpResultEvent,
  type ProcessReceipt,
  waitForOutput,
  withProcess,
} from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AI_SDK_BASE_URL } from "../src/topology.ts";

const EXPECTED_EVALS = ["tool-call", "hitl-approval", "session-replay"] as const;
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

async function latestAttemptLocator(evalId: string): Promise<string> {
  const history = await niceeval.run(["show", evalId, "--history"]);
  expect(history.exitCode, history.diagnostic()).toBe(0);
  const lines = history.stdout.split("\n").filter((line) => line.includes("@"));
  expect(lines.length, `${evalId} has no public attempt in show --history`).toBeGreaterThan(0);

  const latest = lines.at(-1)!;
  expect(latest).toContain("passed");
  const locator = latest.match(/@\S+/)?.[0];
  expect(locator, `${evalId} history line has no public locator: ${latest}`).toBeDefined();
  return locator!;
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
      const result: ExpResultEvent = run.expResult();
      expect(result).toMatchObject({
        event: "result",
        status: "passed",
        passed: EXPECTED_EVALS.length,
        failed: 0,
        errored: 0,
        completion: "complete",
      });

      const locators = new Map<string, string>();
      for (const evalId of EXPECTED_EVALS) {
        locators.set(evalId, await latestAttemptLocator(evalId));
      }

      // outcome：execution 是适配器收到的公开投影；工具名、入参和 OTel 节点
      // 时间注释都必须穿过归一化、落盘与 CLI 展示。
      const toolLocator = locators.get("tool-call")!;
      const execution = await niceeval.run(["show", toolLocator, "--execution"]);
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      expect(execution.stdout).toContain("get_weather");
      expect(execution.stdout).toMatch(/北京/);
      expect(execution.stdout).not.toContain("timing unavailable");

      // timing 公开命令必须成功，并且必须把同一真实工具调用挂到 per-turn
      // OTel 子树；ai-sdk.md 将 correlation 断裂定义为协议回归，不能降级成 warning。
      const timing = await niceeval.run(["show", toolLocator, "--timing"]);
      expect(timing.exitCode, timing.diagnostic()).toBe(0);
      expect(timing.stdout).toContain("get_weather");
    },
  );
});
