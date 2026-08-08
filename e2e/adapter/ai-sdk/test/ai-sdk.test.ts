// feature: docs/engineering/testing/e2e/adapter/ai-sdk.md
//
// 单文件 Journey：启动真实 AI SDK HTTP 应用，运行安装后的 niceeval candidate，
// 再从公开 CLI 读回 Experiment、attempt、execution 与 timing。测试不导入候选
// 源码或类型，不读取私有结果布局；判分仍由 evals/ 内的真实 uiMessageStreamAgent
// 事件断言负责。

import "dotenv/config";
import {
  command,
  type ProcessReceipt,
  waitForOutput,
  withProcess,
} from "@niceeval/testkit";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const EXPECTED_EVALS = [
  "assertion-contract/values-and-no-tools",
  "assertion-contract/score-handles",
  "assertion-contract/scope-tool",
  "assertion-contract/tool-match-and-sandbox",
  "tool-call",
  "hitl-approval",
  "session-replay",
] as const;
const REQUIRED_LIVE_SECRETS = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "NICEEVAL_JUDGE_KEY"] as const;

const PORT = 34101;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OTLP_ENDPOINT = "http://127.0.0.1:4318";
const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

interface ExpStartEvent {
  event: "start";
  format: string;
  schemaVersion: number;
  total: number;
  configs: number;
  concurrency: number;
  reused: number;
}

interface ExpResultEvent {
  event: "result";
  status: "passed" | "failed" | "incomplete" | "interrupted";
  passed: number;
  failed: number;
  errored: number;
  reused?: number;
  completion: "complete" | "incomplete" | "interrupted";
  snapshots: string[];
  junit?: string;
}

type ExpEvent = ExpStartEvent | ExpResultEvent | { event: string };

function liveEnv(): NodeJS.ProcessEnv {
  return { AI_SDK_URL: BASE_URL };
}

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

function expectSuccessfulCli(receipt: ProcessReceipt): void {
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(receipt.signal, receipt.diagnostic()).toBeNull();
  expect(receipt.timedOut, receipt.diagnostic()).toBe(false);
  expect(receipt.stderr).toBe("");
  expect(receipt.stdout).not.toMatch(/[\x1b\x08]/);
}

function expectExpStream(receipt: ProcessReceipt): ExpEvent[] {
  expectSuccessfulCli(receipt);
  expect(receipt.durationMs).toBeGreaterThan(0);
  expect(receipt.stdout).not.toBe("");

  const events = receipt.ndjson<ExpEvent>();
  expect(events.length).toBeGreaterThan(0);
  expect(events[0]).toMatchObject({ event: "start", format: "niceeval.exp" });
  expect((events[0] as ExpStartEvent).total).toBeGreaterThanOrEqual(EXPECTED_EVALS.length);
  expect(events.at(-1)).toMatchObject({
    event: "result",
    status: "passed",
    failed: 0,
    errored: 0,
    completion: "complete",
  });
  return events;
}

async function latestAttemptLocator(evalId: string): Promise<string> {
  const history = await niceeval.run(["show", evalId, "--history"], { env: liveEnv() });
  expectSuccessfulCli(history);
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
  rmSync("junit.xml", { force: true });

  await withProcess(
    ["pnpm", "exec", "tsx", "src/backend/server.ts"],
    {
      env: {
        OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT,
      },
      timeoutMs: 14 * 60_000,
    },
    async (server) => {
      await waitForOutput(server, "stdout", /ai-sdk e2e server listening/, {
        timeoutMs: 20_000,
        label: "ai-sdk backend readiness",
      });
      await waitForHealth(`${BASE_URL}/healthz`, 20_000);

      // invoke：完整 argv 走安装后的 candidate binary；真实 provider 与
      // uiMessageStreamAgent 仍由 experiments/ci.ts + evals/ 驱动。
      const run = await niceeval.run(
        ["exp", "--rerun", "all", "--json", "--junit", "junit.xml"],
        { env: liveEnv(), timeoutMs: 13 * 60_000 },
      );
      const events = expectExpStream(run);
      const result = events.at(-1) as ExpResultEvent;
      expect(result.passed).toBeGreaterThanOrEqual(EXPECTED_EVALS.length);

      const junit = readFileSync("junit.xml", "utf8");
      expect(junit).toContain("<testsuite");
      expect(junit).not.toContain("<failure");
      expect(junit).not.toContain("<error");

      // observe：公开成绩单必须列出本 Repo 声明的 Experiment 与每条 Eval，
      // 防止少发现/少运行后仍以空结果假绿。
      const board = await niceeval.run(["show"], { env: liveEnv() });
      expectSuccessfulCli(board);
      expect(board.stdout).toContain("ci");

      const groupBoard = await niceeval.run(["show", "--exp", "ci"], { env: liveEnv() });
      expectSuccessfulCli(groupBoard);
      for (const evalId of EXPECTED_EVALS) {
        expect(groupBoard.stdout).toContain(evalId);
      }

      const locators = new Map<string, string>();
      for (const evalId of EXPECTED_EVALS) {
        locators.set(evalId, await latestAttemptLocator(evalId));
      }

      // outcome：execution 是适配器收到的公开投影；工具名、入参和 OTel 节点
      // 时间注释都必须穿过归一化、落盘与 CLI 展示。
      const toolLocator = locators.get("tool-call")!;
      const execution = await niceeval.run(["show", toolLocator, "--execution"], { env: liveEnv() });
      expectSuccessfulCli(execution);
      expect(execution.stdout).toContain("get_weather");
      expect(execution.stdout).toMatch(/北京/);
      expect(execution.stdout).not.toContain("timing unavailable");

      // 共享断言契约的 coding 节经应用文件工具（内存实现，direct agent 无 Sandbox）
      // 执行：执行树出现 canonical 工具名，断言过的入参（assertion-contract-edit.txt
      // 等）穿到展示面。
      const contractLocator = locators.get("assertion-contract/tool-match-and-sandbox")!;
      const contractExecution = await niceeval.run(["show", contractLocator, "--execution"], {
        env: liveEnv(),
      });
      expectSuccessfulCli(contractExecution);
      expect(
        contractExecution.stdout.includes("file_write") || contractExecution.stdout.includes("file_edit"),
        "contract execution tree missing file_write/file_edit nodes",
      ).toBe(true);
      expect(
        contractExecution.stdout.includes("shell"),
        "contract execution tree missing shell node",
      ).toBe(true);
      expect(contractExecution.stdout).toContain("assertion-contract-edit.txt");

      // timing 公开命令必须成功，并且必须把同一真实工具调用挂到 per-turn
      // OTel 子树；ai-sdk.md 将 correlation 断裂定义为协议回归，不能降级成 warning。
      const timing = await niceeval.run(["show", toolLocator, "--timing"], { env: liveEnv() });
      expectSuccessfulCli(timing);
      expect(timing.stdout).toContain("get_weather");
    },
  );
});
