// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#adapter-local-protocol
//
// 重跑：
//   pnpm e2e --repo adapter/local-protocol
//   pnpm e2e --repo adapter/local-protocol -- --run test/local-protocol.test.ts
//
// 无密钥 PR 场景：签入本地 HTTP UI Message Stream fixture + 安装后 niceeval binary，
// 证明 NiceEval 自有 transport、断流 / 超时 / HTTP 错误阶段与 cleanup。
// 不 import 候选源码/内部类型，不读 .niceeval 私有布局，不覆盖 live adapter 协议矩阵。

import {
  command,
  type ProcessReceipt,
  waitForOutput,
  withProcess,
} from "@niceeval/testkit";
import { createConnection } from "node:net";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FIXTURE_BASE_URL, FIXTURE_PORT } from "../src/fixture/address.ts";

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

interface ExpStartEvent {
  event: "start";
  format: string;
  schemaVersion: number;
  total: number;
}

interface ExpErrorEvent {
  event: "error";
  locator: string;
  evalId: string;
  experimentId: string;
  phase: string;
  reason: string;
}

interface ExpResultEvent {
  event: "result";
  status: "passed" | "failed" | "incomplete" | "interrupted";
  passed: number;
  failed: number;
  errored: number;
  completion: "complete" | "incomplete" | "interrupted";
}

type ExpEvent = ExpStartEvent | ExpErrorEvent | ExpResultEvent | { event: string };

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // still starting
    }
    if (Date.now() >= deadline) {
      throw new Error(`local-protocol fixture did not become ready at ${url} within ${timeoutMs}ms`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}

/** 端口在 withProcess dispose 后应可再次 bind，证明 fixture 进程被清理。 */
function assertPortReleased(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const probe = createConnection({ host: "127.0.0.1", port });
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        probe.removeAllListeners();
        probe.destroy();
        if (err) reject(err);
        else resolve();
      };
      probe.once("connect", () => {
        // 仍有人在听：端口未释放
        if (Date.now() >= deadline) {
          finish(new Error(`port ${port} still accepts connections after fixture cleanup`));
          return;
        }
        probe.destroy();
        setTimeout(tryOnce, 50);
      });
      probe.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ECONNREFUSED") {
          finish();
          return;
        }
        if (Date.now() >= deadline) {
          finish(error);
          return;
        }
        setTimeout(tryOnce, 50);
      });
    };
    tryOnce();
  });
}

function expectExpStream(receipt: ProcessReceipt, expectedExit: number | "nonzero"): ExpEvent[] {
  if (expectedExit === "nonzero") {
    expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
  } else {
    expect(receipt.exitCode, receipt.diagnostic()).toBe(expectedExit);
  }
  expect(receipt.signal, receipt.diagnostic()).toBeNull();
  expect(receipt.timedOut, receipt.diagnostic()).toBe(false);
  expect(receipt.stderr).toBe("");
  expect(receipt.stdout).not.toMatch(/[\x1b\x08]/);
  const events = receipt.ndjson<ExpEvent>();
  expect(events.length).toBeGreaterThan(0);
  expect(events[0]).toMatchObject({ event: "start", format: "niceeval.exp" });
  expect(events.at(-1)).toMatchObject({ event: "result" });
  return events;
}

function errorEvents(events: ExpEvent[]): ExpErrorEvent[] {
  return events.filter((event): event is ExpErrorEvent => event.event === "error");
}

/**
 * send 失败的公开 phase：嵌套 agent.run 在 send 在飞时成立；部分 transport 失败在
 * onSendActive(false) 之后才落盘，公开面呈现为 eval.run。两者都在「跑 eval / 调 agent」
 * 生命周期内，本 Repo 接受二者之一并靠 reason 区分故障形态。
 */
function expectSendFailurePhase(error: ExpErrorEvent): void {
  expect(["eval.run", "agent.run"]).toContain(error.phase);
}

it("签入 fixture 上的 uiMessageStreamAgent 证明审批、transport、断流、超时、错误阶段与 cleanup", async () => {
  // prepare：本 Journey 声明的结果与 JUnit 从空白开始。
  rmSync(".niceeval", { recursive: true, force: true });
  rmSync("junit", { recursive: true, force: true });
  mkdirSync("junit", { recursive: true });

  await withProcess(
    ["pnpm", "exec", "tsx", "src/fixture/server.ts"],
    {
      timeoutMs: 7 * 60_000,
      processGroup: true,
    },
    async (server) => {
      await waitForOutput(server, "stdout", /local-protocol fixture listening/, {
        timeoutMs: 15_000,
        label: "local-protocol fixture readiness",
      });
      await waitForHealth(`${FIXTURE_BASE_URL}/healthz`, 10_000);

      // ── 1. transport：完整 canned SSE 往返，exit 0，公开读回含固定文案 ──
      const transport = await niceeval.run(
        ["exp", "transport", "--rerun", "all", "--json", "--junit", "junit/transport.xml"],
        { timeoutMs: 60_000 },
      );
      const transportEvents = expectExpStream(transport, 0);
      expect(transportEvents.at(-1)).toMatchObject({
        event: "result",
        status: "passed",
        passed: 1,
        failed: 0,
        errored: 0,
        completion: "complete",
      });
      const transportJunit = readFileSync("junit/transport.xml", "utf8");
      expect(transportJunit).toContain("<testsuite");
      expect(transportJunit).not.toContain("<failure");
      expect(transportJunit).not.toContain("<error");

      const board = await niceeval.run(["show", "--exp", "transport"]);
      expect(board.exitCode, board.diagnostic()).toBe(0);
      expect(board.stdout).toContain("transport-ok");
      expect(board.stdout).toMatch(/pass|passed/i);

      const history = await niceeval.run(["show", "transport-ok", "--history"]);
      expect(history.exitCode, history.diagnostic()).toBe(0);
      const locatorLine = history.stdout.split("\n").filter((line) => line.includes("@")).at(-1);
      expect(locatorLine, history.diagnostic()).toBeDefined();
      expect(locatorLine).toMatch(/pass/i);
      const locator = locatorLine!.match(/@\S+/)?.[0];
      expect(locator).toBeDefined();

      // 公开 execution 投影含 fixture 文案（transport 身份），不读 .niceeval。
      const execution = await niceeval.run(["show", locator!, "--execution"]);
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      expect(execution.stdout).toContain("local-protocol-ok");

      // ── 2. approval：请求轮必须先暴露 pending operation，resume 再完成同一 call ──
      const approval = await niceeval.run(
        ["exp", "approval", "--rerun", "all", "--json", "--junit", "junit/approval.xml"],
        { timeoutMs: 60_000 },
      );
      const approvalEvents = expectExpStream(approval, 0);
      expect(approvalEvents.at(-1)).toMatchObject({
        event: "result",
        status: "passed",
        passed: 1,
        failed: 0,
        errored: 0,
        completion: "complete",
      });
      const approvalJunit = readFileSync("junit/approval.xml", "utf8");
      expect(approvalJunit).toContain("<testsuite");
      expect(approvalJunit).not.toContain("<failure");
      expect(approvalJunit).not.toContain("<error");

      const approvalBoard = await niceeval.run(["show", "--exp", "approval"]);
      expect(approvalBoard.exitCode, approvalBoard.diagnostic()).toBe(0);
      expect(approvalBoard.stdout).toContain("approval-lifecycle");
      expect(approvalBoard.stdout).toMatch(/pass|passed/i);

      const approvalHistory = await niceeval.run([
        "show",
        "approval-lifecycle",
        "--exp",
        "approval",
        "--history",
      ]);
      expect(approvalHistory.exitCode, approvalHistory.diagnostic()).toBe(0);
      const approvalLocatorLine = approvalHistory.stdout.split("\n").filter((line) => line.includes("@")).at(-1);
      expect(approvalLocatorLine, approvalHistory.diagnostic()).toBeDefined();
      expect(approvalLocatorLine).toMatch(/pass/i);
      const approvalLocator = approvalLocatorLine!.match(/@\S+/)?.[0];
      expect(approvalLocator).toBeDefined();

      const approvalExecution = await niceeval.run(["show", approvalLocator!, "--execution"]);
      expect(approvalExecution.exitCode, approvalExecution.diagnostic()).toBe(0);
      expect(approvalExecution.stdout).toContain("calculate");
      expect(approvalExecution.stdout).toContain("local-approval-output");
      expect(approvalExecution.stdout).toContain("rejected");

      // ── 3. disconnect：半截 SSE 断流 → 公开 send 失败阶段 ──
      const disconnect = await niceeval.run(
        ["exp", "disconnect", "--rerun", "all", "--json", "--junit", "junit/disconnect.xml"],
        { timeoutMs: 60_000 },
      );
      const disconnectEvents = expectExpStream(disconnect, "nonzero");
      expect(disconnectEvents.at(-1)).toMatchObject({
        event: "result",
        status: "failed",
        errored: 1,
        failed: 0,
        completion: "complete",
      });
      const disconnectErrors = errorEvents(disconnectEvents);
      expect(disconnectErrors.length).toBeGreaterThan(0);
      expect(disconnectErrors[0]).toMatchObject({
        event: "error",
        evalId: "disconnect",
        experimentId: "disconnect",
      });
      expectSendFailurePhase(disconnectErrors[0]!);
      // 断流诊断必须可行动：指出端点或连接被对端关闭 / 流未完成。
      expect(disconnectErrors[0]!.reason).toMatch(/closed|connect|stream|failed|abort|partial/i);
      expect(readFileSync("junit/disconnect.xml", "utf8")).toContain("<error");

      // ── 4. timeout：挂起 body + 短 experiment.timeoutMs → send 生命周期错误 ──
      const timeoutRun = await niceeval.run(
        ["exp", "timeout", "--rerun", "all", "--json", "--junit", "junit/timeout.xml"],
        { timeoutMs: 30_000 },
      );
      const timeoutEvents = expectExpStream(timeoutRun, "nonzero");
      expect(timeoutEvents.at(-1)).toMatchObject({
        event: "result",
        status: "failed",
        errored: 1,
        completion: "complete",
      });
      const timeoutErrors = errorEvents(timeoutEvents);
      expect(timeoutErrors.length).toBeGreaterThan(0);
      expect(timeoutErrors[0]).toMatchObject({
        event: "error",
        evalId: "timeout",
        experimentId: "timeout",
      });
      expectSendFailurePhase(timeoutErrors[0]!);
      expect(timeoutErrors[0]!.reason).toMatch(/timed out|timeout/i);
      expect(readFileSync("junit/timeout.xml", "utf8")).toContain("<error");

      // ── 5. http-error：HTTP 500 → send 生命周期错误 + 可行动诊断 ──
      const httpError = await niceeval.run(
        ["exp", "http-error", "--rerun", "all", "--json", "--junit", "junit/http-error.xml"],
        { timeoutMs: 60_000 },
      );
      const httpErrorEvents = expectExpStream(httpError, "nonzero");
      expect(httpErrorEvents.at(-1)).toMatchObject({
        event: "result",
        status: "failed",
        errored: 1,
        completion: "complete",
      });
      const httpErrors = errorEvents(httpErrorEvents);
      expect(httpErrors.length).toBeGreaterThan(0);
      expect(httpErrors[0]).toMatchObject({
        event: "error",
        evalId: "http-error",
        experimentId: "http-error",
      });
      expectSendFailurePhase(httpErrors[0]!);
      // uiMessageStreamAgent 对非 2xx 会把 status 写进 message。
      expect(httpErrors[0]!.reason).toMatch(/500|failed|POST/i);
      expect(readFileSync("junit/http-error.xml", "utf8")).toContain("<error");
    },
  );

  // cleanup：withProcess dispose 后 fixture 端口必须释放。
  await assertPortReleased(FIXTURE_PORT, 5_000);
});
