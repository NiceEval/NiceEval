// owner: docs/engineering/testing/e2e/adapter/opencode.md#adapter-opencode-live-compatibility
//
// 单文件 Journey：真实 OpenCode CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 timing。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import {
  assertExpEvalOutcomes,
  command,
  requireDeclaredLiveSecrets,
  type ExpEvalOutcomeExpectation,
} from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const BASELINE_OUTCOMES = [
  // coding task：写文件与 shell 读回都须携带可区分参数并归一完成；单次执行期望 passed/1。
  { experimentId: "ci", evalId: "coding-task/write-and-verify", verdict: "passed", attempts: 1, passed: 1 },
  // session recall：OpenCode 同一 session 的第二轮须引用首轮事实；一条会话链期望 passed/1。
  { experimentId: "ci", evalId: "session/recall", verdict: "passed", attempts: 1, passed: 1 },
  // usage：两个 send 都须产生正的 input/output token；全部断言成立时为 passed/1。
  { experimentId: "ci", evalId: "usage/tokens", verdict: "passed", attempts: 1, passed: 1 },
] as const satisfies readonly ExpEvalOutcomeExpectation[];
const BASELINE_EVALS = BASELINE_OUTCOMES.map((outcome) => outcome.evalId);
const SKILL_EVAL = "skills/status-report";
const GO_EVAL = "provider/go-routing";

const TOOL_PAYLOAD = "niceeval-opencode-tool-input-907";
const GO_LIVE_MARKER = "OPENCODE-GO-DEEPSEEK-V4-FLASH-E2E-731";

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the opencode sandbox",
    );
  }
}

/** `show --execution` 的 Conversation 依次展示工具调用及其完成结果。 */
function expectToolInputReadback(execution: string, marker: string): void {
  expect(execution).toContain('"conversation"');
  expect(execution).toMatch(/"tool":"(?:apply_patch|file_write|write)"/);
  expect(execution).toMatch(/"tool":"(?:bash|shell|command_execution)"/);
  expect(execution).toContain(marker);
  expect(
    execution.match(/"kind":"tool-result"/g)?.length ?? 0,
    `show --execution should preserve both tool inputs and their completed results for ${marker}`,
  ).toBeGreaterThanOrEqual(2);
}

it("真实 OpenCode CLI adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回", async () => {
  requireDeclaredLiveSecrets("opencode");
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
  const evalEvents = assertExpEvalOutcomes(
    run.expEvalEvents(),
    BASELINE_OUTCOMES,
    () => run.diagnostic(),
  );

  const locators: Record<string, string> = {};
  for (const evalId of BASELINE_EVALS) {
    const event = evalEvents.find((candidate) => candidate.evalId === evalId);
    locators[evalId] = event!.locator;
  }

  // outcome：execution 是适配器收到的公开投影。TOOL ledger 行保留原始未归一化名
  //（opencode 的 write / bash），canonical 名 file_write / shell 也可能出现；
  // 工具身份与入参必须穿过归一化、持久化与 CLI 展示。
  const execution = await niceeval.run(["show", locators["coding-task/write-and-verify"]!, "--execution", "--json"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(
    execution.stdout.includes("notes.txt") ||
      execution.stdout.includes("file_write") ||
      execution.stdout.includes("write"),
    "execution tree missing write evidence (notes.txt/file_write/write)",
  ).toBe(true);
  // 两笔工具调用都以 marker 为输入；这同时证明参数没有在归一、落盘或 readback 时丢失。
  expectToolInputReadback(execution.stdout, TOOL_PAYLOAD);

  // usage Eval 的两个 t.send() 都形成独立 request observation，且输入、输出 token 均为正数。
  // Conversation 会按 adapter session 聚合，不能把一次 send 等同于一个展示层 Turn 卡片。
  const usageExecution = await niceeval.run(["show", locators["usage/tokens"]!, "--execution", "--json"]);
  expect(usageExecution.exitCode, usageExecution.diagnostic()).toBe(0);
  const usageDocument: unknown = JSON.parse(usageExecution.stdout);
  const usageObservations: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.kind === "request" || record.kind === "token-bucket") usageObservations.push(record);
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(usageDocument);
  expect(usageObservations.filter((observation) => observation.kind === "request")).toHaveLength(2);
  expect(usageObservations).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "token-bucket", bucket: "input", tokens: expect.any(Number) }),
    expect.objectContaining({ kind: "token-bucket", bucket: "output", tokens: expect.any(Number) }),
  ]));
  for (const observation of usageObservations) {
    if (observation.kind === "token-bucket" && (observation.bucket === "input" || observation.bucket === "output")) {
      expect(observation.tokens).toEqual(expect.any(Number));
      expect(observation.tokens).toBeGreaterThan(0);
    }
  }
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
  expect(timing.stdout).toMatch(/agent\.send\s+turn1\b/);

  // Skill 配置独立成线：安装、原生 skill 工具选择与 decoy 反选由专用 Eval 证明。
  const skillRun = await niceeval.run(
    ["exp", "skill", SKILL_EVAL, "--rerun", "all", "--json"],
    { timeoutMs: 10 * 60_000 },
  );
  expect(skillRun.exitCode, skillRun.diagnostic()).toBe(0);
  const skillInv = skillRun.expReceipt();
  expect(skillInv.completion, skillRun.diagnostic()).toBe("completed");
  expect(skillInv.runIds, skillRun.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(
    skillRun.expEvalEvents(),
    [
      // Skill：目标 status-report Skill 须安装、被选择且不误用 decoy；单次专用运行期望 passed/1。
      {
        experimentId: "skill",
        evalId: SKILL_EVAL,
        verdict: "passed",
        attempts: 1,
        passed: 1,
      },
    ],
    () => skillRun.diagnostic(),
  );

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
  const goEvents = assertExpEvalOutcomes(
    goRun.expEvalEvents(),
    [
      // Go routing：真实请求须落到 deepseek-v4-flash 并从官方 export 读回；期望 passed/1。
      {
        experimentId: "go",
        evalId: GO_EVAL,
        verdict: "passed",
        attempts: 1,
        passed: 1,
      },
    ],
    () => goRun.diagnostic(),
  );

  const goEvent = goEvents.find((event) => event.evalId === GO_EVAL);
  const goLocator = goEvent!.locator;
  const goExecution = await niceeval.run(["show", goLocator, "--execution"]);
  expect(goExecution.exitCode, goExecution.diagnostic()).toBe(0);
  expect(goExecution.stdout).toContain("opencode export");
  expect(goExecution.stdout).toContain("deepseek-v4-flash");
  expect(goExecution.stdout).toContain(GO_LIVE_MARKER);
}, 52 * 60_000);
