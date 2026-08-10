// owner: docs/engineering/testing/e2e/adapter/opencode.md#adapter-opencode-live-compatibility
//
// 单文件 Journey：真实 OpenCode CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 timing。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ProcessReceipt } from "@niceeval/testkit";
import { readFileSync, rmSync } from "node:fs";
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
const STATUS_MARKER = "OPENCODE-STATUS-REPORT-NICEEVAL-E2E-914";
const DECOY_MARKER = "OPENCODE-DECOY-AUDIT-NICEEVAL-E2E-518";
const GO_LIVE_MARKER = "OPENCODE-GO-DEEPSEEK-V4-FLASH-E2E-731";

const REQUIRED_LIVE_SECRETS = [
  "BUB_API_KEY",
  "BUB_API_BASE",
  "OPENCODE_API_KEY",
] as const;

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

function expectSuccessfulCli(receipt: ProcessReceipt): void {
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(receipt.signal, receipt.diagnostic()).toBeNull();
  expect(receipt.timedOut, receipt.diagnostic()).toBe(false);
  expect(receipt.stderr).toBe("");
  expect(receipt.stdout).not.toMatch(/[\x1b\x08]/);
}

function expectExpStream(receipt: ProcessReceipt, expectedTotal: number): ExpEvent[] {
  expectSuccessfulCli(receipt);
  expect(receipt.durationMs).toBeGreaterThan(0);
  expect(receipt.stdout).not.toBe("");

  const events = receipt.ndjson<ExpEvent>();
  expect(events.length).toBeGreaterThan(0);
  expect(events[0]).toMatchObject({ event: "start", format: "niceeval.exp" });
  expect((events[0] as ExpStartEvent).total).toBeGreaterThanOrEqual(expectedTotal);
  expect(events.at(-1)).toMatchObject({
    event: "result",
    status: "passed",
    failed: 0,
    errored: 0,
    completion: "complete",
  });
  return events;
}

async function attemptLines(evalId: string, experimentId?: string): Promise<string[]> {
  const history = await niceeval.run([
    "show",
    evalId,
    ...(experimentId === undefined ? [] : ["--exp", experimentId]),
    "--history",
  ]);
  expectSuccessfulCli(history);
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

function expectToolInputReadback(execution: string, marker: string, minimum: number): void {
  expect(execution).toContain("TOOL");
  expect(
    toolInputOccurrences(execution, marker),
    `show --execution should expose ${minimum} TOOL input block(s) containing ${marker}`,
  ).toBeGreaterThanOrEqual(minimum);
}

it("真实 OpenCode CLI adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回", async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });
  rmSync("junit.xml", { force: true });
  rmSync("junit-skill.xml", { force: true });
  rmSync("junit-go.xml", { force: true });

  // invoke：先跑 compat 基线协议矩阵。完整 argv 走安装后的 candidate binary；
  // 真实 OpenCode CLI、Docker sandbox 与 live provider 由 experiments/ci.ts + evals/ 驱动。
  const run = await niceeval.run(
    ["exp", "ci", "--rerun", "all", "--json", "--junit", "junit.xml"],
    { timeoutMs: 36 * 60_000 },
  );
  const events = expectExpStream(run, BASELINE_EVALS.length);
  const result = events.at(-1) as ExpResultEvent;
  expect(result.passed).toBeGreaterThanOrEqual(BASELINE_EVALS.length);

  const junit = readFileSync("junit.xml", "utf8");
  expect(junit).toContain("<testsuite");
  expect(junit).not.toContain("<failure");
  expect(junit).not.toContain("<error");

  const locators: Record<string, string> = {};
  for (const evalId of BASELINE_EVALS) {
    locators[evalId] = await latestAttemptLocator(evalId);
  }

  // outcome：execution 是适配器收到的公开投影。TOOL 卡片头是原始未归一化名
  //（opencode 的 write / bash），canonical 名 file_write / shell 也可能出现；
  // 入参与 OTel 时间注释必须穿过归一化、落盘与 CLI 展示。
  const execution = await niceeval.run(["show", locators["coding-task/write-and-verify"]!, "--execution"]);
  expectSuccessfulCli(execution);
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
  expectSuccessfulCli(usageExecution);
  expect(usageExecution.stdout).toMatch(/turn1\s+·\s+completed[^\n]*\btok\b/);
  expect(usageExecution.stdout).toMatch(/turn2\s+·\s+completed[^\n]*\btok\b/);
  expect(
    execution.stdout.includes("shell") ||
      execution.stdout.includes("bash") ||
      execution.stdout.includes("command_execution"),
    "execution tree missing shell evidence (shell/bash/command_execution)",
  ).toBe(true);

  // timing：runner 分阶段耗时树。opencode 适配器声明了 tracing 与 canonical OTel
  // mapper，但仓库验收明确「时间轨缺失只影响 timing 注释，不影响事件流断言」，
  // 因此不把字面 OTel 子树当作硬前提，只断言阶段树本身。
  const timing = await niceeval.run(["show", locators["coding-task/write-and-verify"]!, "--timing"]);
  expectSuccessfulCli(timing);
  expect(timing.stdout).toContain("eval.run");
  expect(timing.stdout).toContain("agent.setup");
  expect(timing.stdout).toMatch(/turn\s+turn1\b/);

  // Skill 配置独立成线：安装、原生 skill 工具选择与 decoy 反选由专用 Eval 证明。
  const skillRun = await niceeval.run(
    ["exp", "skill", SKILL_EVAL, "--rerun", "all", "--json", "--junit", "junit-skill.xml"],
    { timeoutMs: 10 * 60_000 },
  );
  const skillEvents = expectExpStream(skillRun, 1);
  const skillResult = skillEvents.at(-1) as ExpResultEvent;
  expect(skillResult.passed).toBeGreaterThanOrEqual(1);

  const skillJunit = readFileSync("junit-skill.xml", "utf8");
  expect(skillJunit).toContain("<testsuite");
  expect(skillJunit).not.toContain("<failure");
  expect(skillJunit).not.toContain("<error");

  const skillBoard = await niceeval.run(["show", "--exp", "skill", "--json"]);
  expectSuccessfulCli(skillBoard);
  expect(skillBoard.stdout).toContain(SKILL_EVAL);

  const skillLocator = await latestAttemptLocator(SKILL_EVAL, "skill");
  const skillExecution = await niceeval.run(["show", skillLocator, "--execution"]);
  expectSuccessfulCli(skillExecution);
  expectToolInputReadback(skillExecution.stdout, STATUS_MARKER, 1);
  expect(skillExecution.stdout).not.toContain(DECOY_MARKER);

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
      "--junit",
      "junit-go.xml",
    ],
    { timeoutMs: 12 * 60_000 },
  );
  const goEvents = expectExpStream(goRun, 1);
  const goResult = goEvents.at(-1) as ExpResultEvent;
  expect(goResult.passed).toBeGreaterThanOrEqual(1);

  const goJunit = readFileSync("junit-go.xml", "utf8");
  expect(goJunit).toContain("<testsuite");
  expect(goJunit).not.toContain("<failure");
  expect(goJunit).not.toContain("<error");

  const goBoard = await niceeval.run(["show", "--exp", "go", "--json"]);
  expectSuccessfulCli(goBoard);
  expect(goBoard.stdout).toContain(GO_EVAL);
  expect(goBoard.stdout).toContain("opencode-go/deepseek-v4-flash");

  const goLocator = await latestAttemptLocator(GO_EVAL, "go");
  const goExecution = await niceeval.run(["show", goLocator, "--execution"]);
  expectSuccessfulCli(goExecution);
  expect(goExecution.stdout).toContain("opencode export");
  expect(goExecution.stdout).toContain("deepseek-v4-flash");
  expect(goExecution.stdout).toContain(GO_LIVE_MARKER);
}, 52 * 60_000);
