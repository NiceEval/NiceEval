//
// 单文件 Journey：真实 OpenCode CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt 与 execution。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import {
  assertExpEvalOutcomes,
  command,
  type ExpEvalOutcomeExpectation,
  type ProcessReceipt,
  withInspectionRequest,
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

/** `attempt.trace` 依次保留工具调用及其完成结果。 */
function expectToolInputReadback(
  trace: ReturnType<ProcessReceipt["attemptTrace"]>["trace"],
  marker: string,
): void {
  const serialized = JSON.stringify(trace);
  expect(serialized).toMatch(/"tool":"(?:apply_patch|file_write|write)"/);
  expect(serialized).toMatch(/"tool":"(?:bash|shell|command_execution)"/);
  expect(serialized).toContain(marker);
  expect(
    trace.conversation.items.filter((item) => item.kind === "tool-result").length,
    `attempt.trace should preserve both tool inputs and their completed results for ${marker}`,
  ).toBeGreaterThanOrEqual(2);
}

function expectCommandOutcome(outcome: InspectionTraceCommandOutcome): void {
  expect(["exited", "terminated", "not-started"]).toContain(outcome.kind);
  switch (outcome.kind) {
    case "exited":
      expect(outcome.exitCode).toEqual(expect.any(Number));
      break;
    case "terminated":
      expect(["timeout", "cancelled", "transport-lost"]).toContain(outcome.reason);
      break;
    case "not-started":
      expect(["spawn-failed", "cancelled-before-start"]).toContain(outcome.reason);
      break;
  }
}

function expectCommandSummary(document: InspectionAttemptTraceDocument): InspectionTraceCommandSummary {
  const commands = document.trace.commands;
  expect(["complete", "partial"]).toContain(commands.state);
  expect(commands.items).not.toHaveLength(0);
  expect(commands.hasMore).toEqual(expect.any(Boolean));
  expect(commands.omittedCommandCount).toBeGreaterThanOrEqual(0);
  for (const command of commands.items) {
    expect(command.commandId).toMatch(/\S/u);
    expect([
      "attempt.setup",
      "sandbox.prepare",
      "agent.ensure",
      "eval.run",
      "sandbox.command",
      "attempt.teardown",
    ]).toContain(command.phase);
    expectCommandOutcome(command.outcome);
  }
  return commands.items[0]!;
}

function expectCommandDetail(
  document: InspectionAttemptTraceCommandDetailDocument,
  summary: InspectionTraceCommandSummary,
): void {
  const detail = document.detail;
  expect(detail).toMatchObject({
    kind: "command",
    commandId: summary.commandId,
    phase: summary.phase,
    outcome: summary.outcome,
  });
  expect(detail.sequence).toBeGreaterThanOrEqual(0);
  expect(["shell", "argv"]).toContain(detail.invocation.kind);
  switch (detail.invocation.kind) {
    case "shell":
      expect(detail.invocation.command).toEqual(expect.any(String));
      break;
    case "argv":
      expect(detail.invocation.executable).toEqual(expect.any(String));
      expect(detail.invocation.arguments).toEqual(expect.any(Array));
      break;
  }
  expect(["sandbox-default", "project-relative", "redacted"]).toContain(detail.workingDirectory.kind);
  switch (detail.workingDirectory.kind) {
    case "sandbox-default":
    case "redacted":
      break;
    case "project-relative":
      expect(detail.workingDirectory.path).toEqual(expect.any(String));
      break;
  }
  for (const stream of [detail.stdout, detail.stderr]) {
    expect(stream.text).toEqual(expect.any(String));
    expect(stream.retainedBytes).toBeGreaterThanOrEqual(0);
    expect(stream.totalSafeUtf8Bytes).toBeGreaterThanOrEqual(stream.retainedBytes);
    expect(stream.sha256).toEqual(expect.any(String));
    expect(["not-truncated", "truncated"]).toContain(stream.truncation.state);
    expect(stream.truncation.omittedSafeUtf8Bytes).toBeGreaterThanOrEqual(0);
  }
}

it("真实 OpenCode CLI adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回 [necase_A6ZPA7TVDX4T0MCR]", async () => {
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
  // receipt」）：completion、createdRunIds 与 publicationCutoff（每个 Experiment 一个 Run）。成败由下面带身份的
  // eval 事件精确断言，不从 receipt 猜计数。
  const inv = run.expReceipt();
  expect(inv.completion, run.diagnostic()).toBe("completed");
  expect(inv.createdRunIds, run.diagnostic()).toHaveLength(1);
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

  // outcome：trace 是适配器收到的公开投影，保留原始未归一化名
  //（opencode 的 write / bash），canonical 名 file_write / shell 也可能出现；
  // 工具身份与入参必须穿过归一化、持久化与 CLI 展示。
  const queried = await withInspectionRequest({
    kind: "attempt.trace",
    locator: locators["coding-task/write-and-verify"]!,
  }, async (requestPath) => await niceeval.run(["query", "run", "--request", requestPath]));
  expect(queried.exitCode, queried.diagnostic()).toBe(0);
  const document = queried.attemptTrace();
  expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
  const trace = JSON.stringify(document.trace);
  expect(
    trace.includes("notes.txt") || trace.includes("file_write") || trace.includes("write"),
    "attempt trace missing write evidence (notes.txt/file_write/write)",
  ).toBe(true);
  // 两笔工具调用都以 marker 为输入；这同时证明参数没有在归一、落盘或 readback 时丢失。
  expectToolInputReadback(document.trace, TOOL_PAYLOAD);

  // usage Eval 的两个 t.send() 都形成独立 request observation，且输入、输出 token 均为正数。
  // Conversation 会按 adapter session 聚合，不能把一次 send 等同于一个展示层 Turn 卡片。
  const usageReceipt = await withInspectionRequest({
    kind: "attempt.usage",
    locator: locators["usage/tokens"]!,
  }, async (requestPath) => await niceeval.run(["query", "run", "--request", requestPath]));
  expect(usageReceipt.exitCode, usageReceipt.diagnostic()).toBe(0);
  const usageDocument = usageReceipt.attemptUsage();
  expect(usageDocument).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.usage" });
  const usageObservations = usageDocument.usage.observations.filter((record) =>
    record.kind === "request" || record.kind === "token-bucket"
  );
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
    trace.includes("shell") || trace.includes("bash") || trace.includes("command_execution"),
    "attempt trace missing shell evidence (shell/bash/command_execution)",
  ).toBe(true);

  // Skill 配置独立成线：安装、原生 skill 工具选择与 decoy 反选由专用 Eval 证明。
  const skillRun = await niceeval.run(
    ["exp", "skill", SKILL_EVAL, "--rerun", "all", "--json"],
    { timeoutMs: 10 * 60_000 },
  );
  expect(skillRun.exitCode, skillRun.diagnostic()).toBe(0);
  const skillInv = skillRun.expReceipt();
  expect(skillInv.completion, skillRun.diagnostic()).toBe("completed");
  expect(skillInv.createdRunIds, skillRun.diagnostic()).toHaveLength(1);
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
  expect(goInv.createdRunIds, goRun.diagnostic()).toHaveLength(1);
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
  const goQuery = await withInspectionRequest({
    kind: "attempt.trace",
    locator: goLocator,
  }, async (requestPath) => await niceeval.run(["query", "run", "--request", requestPath]));
  expect(goQuery.exitCode, goQuery.diagnostic()).toBe(0);
  const goDocument = goQuery.attemptTrace();
  expect(goDocument).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
  // Go Eval 自己判定 export 中的 provider/model 与回复 marker。公开 trace 只承诺
  // bounded command projection，因此这里验收稳定 shape，不要求后段 export 命令
  // 穿过 MAX_COMMANDS 截止线。
  const command = expectCommandSummary(goDocument);
  const goDetailQuery = await withInspectionRequest({
    kind: "attempt.trace.detail",
    locator: goLocator,
    selector: { kind: "command", commandId: command.commandId },
  }, async (requestPath) => await niceeval.run(["query", "run", "--request", requestPath]));
  expect(goDetailQuery.exitCode, goDetailQuery.diagnostic()).toBe(0);
  const goDetailDocument = goDetailQuery.attemptTraceDetail();
  expect(goDetailDocument).toMatchObject({
    protocol: "niceeval.query/v1",
    operation: "attempt.trace.detail",
  });
  expectCommandDetail(goDetailDocument, command);
}, 52 * 60_000);
