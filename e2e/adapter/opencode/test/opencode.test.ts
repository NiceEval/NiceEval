// owner: docs/engineering/testing/e2e/adapter/opencode.md#adapter-opencode-live-compatibility
//
// 单文件 Journey：真实 OpenCode CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 timing。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ExpEvalEvent, type ExpEvent } from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const BASELINE_EVALS = [
  "coding-task/write-and-verify",
  "session/recall",
  "usage/tokens",
] as const;
const SKILL_EVAL = "skills/status-report";
const GO_EVAL = "provider/go-routing";

const TOOL_PAYLOAD = "niceeval-opencode-tool-input-907";
const GO_LIVE_MARKER = "OPENCODE-GO-DEEPSEEK-V4-FLASH-E2E-731";

const REQUIRED_LIVE_SECRETS = [
  "BUB_API_KEY",
  "BUB_API_BASE",
  "OPENCODE_API_KEY",
] as const;

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live opencode E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the opencode sandbox",
    );
  }
}

async function attemptLines(evalId: string, experimentId?: string): Promise<string[]> {
  const history = await niceeval.run([
    "show",
    evalId,
    ...(experimentId === undefined ? [] : ["--exp", experimentId]),
    "--history",
  ]);
  expect(history.exitCode, history.diagnostic()).toBe(0);
  return history.stdout.split("\n").filter((line) => line.includes("@"));
}

async function latestAttemptLocator(evalId: string, experimentId?: string): Promise<string> {
  const lines = await attemptLines(evalId, experimentId);
  expect(lines.length, `${evalId} has no public attempt in show --history`).toBeGreaterThan(0);

  const latest = lines.at(-1)!;
  expect(latest, `${evalId} latest attempt is not passed: ${latest}`).toContain("passed");
  const locator = latest.match(/@\S+/)?.[0];
  expect(locator, `${evalId} history line has no public locator: ${latest}`).toBeDefined();
  return locator!;
}

/** `show --execution` 的 TOOL 卡把每笔调用的 input 作为独立块公开展示。 */
function toolInputOccurrences(execution: string, marker: string): number {
  const lines = execution.split("\n");
  return lines.filter((line, index) =>
    line.trim() === "input" && lines.slice(index + 1, index + 5).join("\n").includes(marker),
  ).length;
}

function expectToolInputReadback(execution: string, marker: string, expected: number): void {
  expect(execution).toContain("TOOL");
  expect(
    toolInputOccurrences(execution, marker),
    `show --execution should expose ${expected} TOOL input block(s) containing ${marker}`,
  ).toBe(expected);
}

it("真实 OpenCode CLI adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回", async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });

  // invoke：先跑 compat 基线协议矩阵。完整 argv 走安装后的 candidate binary；
  // 真实 OpenCode CLI、Docker sandbox 与 live provider 由 experiments/ci.ts + evals/ 驱动。
  const run = await niceeval.run(
    ["exp", "ci", "--rerun", "all", "--json"],
    { timeoutMs: 36 * 60_000 },
  );
  expect(run.exitCode, run.diagnostic()).toBe(0);
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md「结束反馈与
  // receipt」）：completion 与 runIds（每个 Experiment 一个 Run）。成败由下面带身份的
  // eval 事件精确断言，不从 receipt 猜计数。
  const inv = run.expReceipt();
  expect(inv.completion, run.diagnostic()).toBe("completed");
  expect(inv.runIds, run.diagnostic()).toHaveLength(1);
  const evalEvents = run
    .ndjson<ExpEvent>()
    .filter(
      (event): event is ExpEvalEvent => "event" in event && event.event === "eval",
    );
  expect(evalEvents.filter((event) => event.verdict === "passed"), run.diagnostic()).toHaveLength(
    BASELINE_EVALS.length,
  );
  expect(evalEvents.filter((event) => event.verdict !== "passed"), run.diagnostic()).toHaveLength(0);

  const locators: Record<string, string> = {};
  for (const evalId of BASELINE_EVALS) {
    locators[evalId] = await latestAttemptLocator(evalId);
  }

  // outcome：execution 是适配器收到的公开投影。TOOL 卡片头是原始未归一化名
  //（opencode 的 write / bash），canonical 名 file_write / shell 也可能出现；
  // 工具身份与入参必须穿过归一化、持久化与 CLI 展示。
  const execution = await niceeval.run(["show", locators["coding-task/write-and-verify"]!, "--execution"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(
    execution.stdout.includes("notes.txt") ||
      execution.stdout.includes("file_write") ||
      execution.stdout.includes("write"),
    "execution tree missing write evidence (notes.txt/file_write/write)",
  ).toBe(true);
  // 两笔工具调用都以 marker 为输入；这同时证明参数没有在归一、落盘或 readback 时丢失。
  expectToolInputReadback(execution.stdout, TOOL_PAYLOAD, 2);

  // usage Eval 的两个 t.send() 都有独立的正 token 数；execution 的两个 turn 头必须各自可读。
  const usageExecution = await niceeval.run(["show", locators["usage/tokens"]!, "--execution"]);
  expect(usageExecution.exitCode, usageExecution.diagnostic()).toBe(0);
  expect(usageExecution.stdout).toMatch(/turn1\s+·\s+completed[^\n]*\btok\b/);
  expect(usageExecution.stdout).toMatch(/turn2\s+·\s+completed[^\n]*\btok\b/);
  expect(
    execution.stdout.includes("shell") ||
      execution.stdout.includes("bash") ||
      execution.stdout.includes("command_execution"),
    "execution tree missing shell evidence (shell/bash/command_execution)",
  ).toBe(true);

  // timing 独立读回 runner 的实际阶段树，不重复 execution 或 Skill 断言。
  const timing = await niceeval.run(["show", locators["coding-task/write-and-verify"]!, "--timing"]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout).toContain("eval.run");
  expect(timing.stdout).toContain("agent.setup");
  expect(timing.stdout).toMatch(/turn\s+turn1\b/);

  // Skill 配置独立成线：安装、原生 skill 工具选择与 decoy 反选由专用 Eval 证明。
  const skillRun = await niceeval.run(
    ["exp", "skill", SKILL_EVAL, "--rerun", "all", "--json"],
    { timeoutMs: 10 * 60_000 },
  );
  expect(skillRun.exitCode, skillRun.diagnostic()).toBe(0);
  const skillInv = skillRun.expReceipt();
  expect(skillInv.completion, skillRun.diagnostic()).toBe("completed");
  expect(skillInv.runIds, skillRun.diagnostic()).toHaveLength(1);
  const skillEvents = skillRun.ndjson<ExpEvent>().filter(
    (event): event is ExpEvalEvent => "event" in event && event.event === "eval",
  );
  expect(skillEvents.filter((event) => event.verdict === "passed"), skillRun.diagnostic()).toHaveLength(1);
  expect(skillEvents.filter((event) => event.verdict !== "passed"), skillRun.diagnostic()).toHaveLength(0);

  // Go 配置独立成线：专用 Eval 用显式 OPENCODE_API_KEY、无自定义 base URL 完成
  // 真实 provider 调用，再从官方 session export 核对 provider 与 API model。
  const goRun = await niceeval.run(
    [
      "exp",
      "go",
      GO_EVAL,
      "--rerun",
      "all",
      "--json",
    ],
    { timeoutMs: 12 * 60_000 },
  );
  expect(goRun.exitCode, goRun.diagnostic()).toBe(0);
  const goInv = goRun.expReceipt();
  expect(goInv.completion, goRun.diagnostic()).toBe("completed");
  expect(goInv.runIds, goRun.diagnostic()).toHaveLength(1);
  const goEvents = goRun.ndjson<ExpEvent>().filter(
    (event): event is ExpEvalEvent => "event" in event && event.event === "eval",
  );
  expect(goEvents.filter((event) => event.verdict === "passed"), goRun.diagnostic()).toHaveLength(1);
  expect(goEvents.filter((event) => event.verdict !== "passed"), goRun.diagnostic()).toHaveLength(0);

  const goLocator = await latestAttemptLocator(GO_EVAL, "go");
  const goExecution = await niceeval.run(["show", goLocator, "--execution"]);
  expect(goExecution.exitCode, goExecution.diagnostic()).toBe(0);
  expect(goExecution.stdout).toContain("opencode export");
  expect(goExecution.stdout).toContain("deepseek-v4-flash");
  expect(goExecution.stdout).toContain(GO_LIVE_MARKER);
}, 52 * 60_000);
