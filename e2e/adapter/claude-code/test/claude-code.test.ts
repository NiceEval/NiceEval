// feature: docs/engineering/testing/e2e/adapter/claude-code.md
//
// 单文件 Journey：真实 Claude Code + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 OTel 记录。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ProcessReceipt } from "@niceeval/testkit";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const EXPECTED_EVALS = [
  "assertion-contract/values-and-no-tools",
  "assertion-contract/score-handles",
  "assertion-contract/scope-tool",
  "assertion-contract/tool-match-and-sandbox",
  "session-resume",
  "skill-used",
  "mcp-tools",
  "plugin-mcp",
  "websearch-denied",
] as const;

// 本仓库有 6 个 experiment（每个挂不同 agent 配置），bare `niceeval show` 按
// experiment group 汇总展示（见 experiments/*.ts 的文件名）；eval id 级别的存在性
// 由 show <eval-id> --history 与 --page attempts 逐条核验。
const EXPECTED_EXPERIMENTS = ["coding", "skill", "mcp", "plugin", "plugin-reuse", "locked-down"] as const;

const REQUIRED_LIVE_SECRETS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
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
      `[configuration] live claude-code E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the claude-code sandbox",
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

async function attemptLines(evalId: string): Promise<string[]> {
  const history = await niceeval.run(["show", evalId, "--history"]);
  expectSuccessfulCli(history);
  return history.stdout.split("\n").filter((line) => line.includes("@"));
}

async function latestAttemptLocator(evalId: string): Promise<string> {
  const lines = await attemptLines(evalId);
  expect(lines.length, `${evalId} has no public attempt in show --history`).toBeGreaterThan(0);

  const latest = lines.at(-1)!;
  expect(latest, `${evalId} latest attempt is not passed: ${latest}`).toContain("passed");
  const locator = latest.match(/@\S+/)?.[0];
  expect(locator, `${evalId} history line has no public locator: ${latest}`).toBeDefined();
  return locator!;
}

// declares tracing 的 attempt 上，「OTel 没收到」的唯一诚实措辞：不出现它就证明
// span 真的被导出并解析成功。claude-code 的原生 span
// 量级小，同一个 tool_use_id 会挂出多条同名候选 span，执行树的关联规则「一个
// callId 唯一命中一条候选才合并」在这种形状下如实降级成 telemetry-only——所以断言
// 不是「节点带时间注释」，而是这个诚实二元判据本身：trace 只证时间与结构，行为
// 断言仍以 transcript 归一的事件流为准。
const OTEL_NOT_COLLECTED = "OTel trace was not collected";

it("真实 Claude Code adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回", async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });
  rmSync("junit.xml", { force: true });

  // invoke：完整 argv 走安装后的 candidate binary；真实 Claude Code CLI、Docker
  // sandbox 与 live provider 仍由 experiments/* + evals/ 驱动。
  const run = await niceeval.run(
    ["exp", "--rerun", "all", "--json", "--junit", "junit.xml"],
    { timeoutMs: 36 * 60_000 },
  );
  const events = expectExpStream(run);
  const result = events.at(-1) as ExpResultEvent;
  expect(result.passed).toBeGreaterThanOrEqual(EXPECTED_EVALS.length);

  const junit = readFileSync("junit.xml", "utf8");
  expect(junit).toContain("<testsuite");
  expect(junit).not.toContain("<failure");
  expect(junit).not.toContain("<error");

  // observe：show 默认报告列出全部 6 个 experiment group，--page attempts 是
  // 不随实验组数收缩的逐 attempt 视图——少发现/少运行后都不能以组级汇总假绿。
  const board = await niceeval.run(["show"]);
  expectSuccessfulCli(board);
  for (const id of EXPECTED_EXPERIMENTS) {
    expect(board.stdout, `show 默认报告缺少 experiment "${id}"`).toContain(id);
  }

  const attempts = await niceeval.run(["show", "--page", "attempts"]);
  expectSuccessfulCli(attempts);
  for (const evalId of EXPECTED_EVALS) {
    expect(attempts.stdout, `show --page attempts missing ${evalId}`).toContain(evalId);
  }

  const locators = new Map<string, string>();
  for (const evalId of EXPECTED_EVALS) {
    if (evalId === "plugin-mcp") continue;
    locators.set(evalId, await latestAttemptLocator(evalId));
  }

  // plugin-mcp 由 plugin 与 plugin-reuse 各跑一遍；复用实验的第二条 attempt 是
  // 安装收敛探针，必须逐条 passed，不能只看最新一条。
  for (const line of await attemptLines("plugin-mcp")) {
    expect(line, `plugin-mcp attempt is not passed: ${line}`).toContain("passed");
  }
  locators.set("plugin-mcp", await latestAttemptLocator("plugin-mcp"));

  // outcome：execution 是适配器收到的公开投影。skill.loaded、mcp__ 调用节点与
  // 入参必须穿过归一化、落盘与 CLI 展示。
  const skillExecution = await niceeval.run(["show", locators.get("skill-used")!, "--execution"]);
  expectSuccessfulCli(skillExecution);
  expect(
    skillExecution.stdout.includes("e2e-marker"),
    "skill-used 执行树缺少 skill.loaded 节点——Skill 调用没被归一进事件流，或 show 执行树读不回",
  ).toBe(true);
  expect(skillExecution.stdout, "skill-used 的 --execution 显示 OTel trace was not collected").not.toContain(
    OTEL_NOT_COLLECTED,
  );

  const mcpExecution = await niceeval.run(["show", locators.get("mcp-tools")!, "--execution"]);
  expectSuccessfulCli(mcpExecution);
  expect(mcpExecution.stdout).toContain("mcp__e2e-stdio__get-sum");
  expect(mcpExecution.stdout).toContain("mcp__e2e-http__get-sum");
  expect(mcpExecution.stdout).toContain("100");
  expect(mcpExecution.stdout).toContain("23");
  expect(mcpExecution.stdout).toContain("6");
  expect(mcpExecution.stdout).toContain("36");
  expect(mcpExecution.stdout).toContain("42");
  expect(mcpExecution.stdout, "mcp-tools 的 --execution 显示 OTel trace was not collected").not.toContain(
    OTEL_NOT_COLLECTED,
  );

  const pluginExecution = await niceeval.run(["show", locators.get("plugin-mcp")!, "--execution"]);
  expectSuccessfulCli(pluginExecution);
  expect(pluginExecution.stdout).toContain("mcp__plugin_e2e-plugin_tools__get-sum");
}, 38 * 60_000);
