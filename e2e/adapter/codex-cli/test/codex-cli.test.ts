// feature: docs/engineering/testing/e2e/adapter/codex-cli.md
//
// 单文件 Journey：真实 Codex CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 timing。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ProcessReceipt } from "@niceeval/testkit";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const EXPECTED_EVALS = [
  "coding-task",
  "session",
  "usage",
  "mcp",
  "skill",
  "plugin-hook",
  "configfile",
] as const;

const REQUIRED_LIVE_SECRETS = [
  "CODEX_API_KEY",
  "CODEX_BASE_URL",
  "NICEEVAL_JUDGE_KEY",
  "NICEEVAL_JUDGE_BASE",
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
      `[configuration] live codex-cli E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the codex-cli sandbox",
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

it("真实 Codex CLI adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回", async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });
  rmSync("junit.xml", { force: true });

  // invoke：完整 argv 走安装后的 candidate binary；真实 Codex CLI、Docker sandbox
  // 与 live provider 仍由 experiments/* + evals/ 驱动。
  const run = await niceeval.run(["exp", "--rerun", "all", "--json", "--junit", "junit.xml"], {
    timeoutMs: 36 * 60_000,
  });
  const events = expectExpStream(run);
  const result = events.at(-1) as ExpResultEvent;
  expect(result.passed).toBeGreaterThanOrEqual(EXPECTED_EVALS.length);

  const junit = readFileSync("junit.xml", "utf8");
  expect(junit).toContain("<testsuite");
  expect(junit).not.toContain("<failure");
  expect(junit).not.toContain("<error");

  // observe：--page attempts 是不随实验组数收缩的逐 attempt 视图，
  // 防止少发现/少运行后仍以组级汇总假绿。
  const board = await niceeval.run(["show", "--page", "attempts"]);
  expectSuccessfulCli(board);
  for (const evalId of EXPECTED_EVALS) {
    expect(board.stdout, `show --page attempts missing ${evalId}`).toContain(evalId);
  }

  const codingTaskLocator = await latestAttemptLocator("coding-task");
  for (const evalId of EXPECTED_EVALS) {
    if (evalId === "coding-task") continue;
    await latestAttemptLocator(evalId);
  }

  // plugin-hook 由 plugin 与 plugin-reuse 各跑一遍；复用实验的第二条 attempt
  // 是安装收敛探针，必须逐条 passed，不能只看最新一条。
  for (const line of await attemptLines("plugin-hook")) {
    expect(line, `plugin-hook attempt is not passed: ${line}`).toContain("passed");
  }

  // outcome：execution 是适配器收到的公开投影。TOOL 卡片头是原始未归一化名
  //（command_execution / file_change），canonical 名 shell / file_edit 也可能出现；
  // 入参与 OTel 时间注释必须穿过归一化、落盘与 CLI 展示。
  const execution = await niceeval.run(["show", codingTaskLocator, "--execution"]);
  expectSuccessfulCli(execution);
  expect(
    execution.stdout.includes("file_edit") || execution.stdout.includes("file_change"),
    "execution tree missing file_edit/file_change",
  ).toBe(true);
  expect(
    execution.stdout.includes("shell") || execution.stdout.includes("command_execution"),
    "execution tree missing shell/command_execution",
  ).toBe(true);
  expect(execution.stdout).toContain("niceeval-e2e-run-914");
  expect(execution.stdout).not.toContain("timing unavailable");

  const timing = await niceeval.run(["show", codingTaskLocator, "--timing"]);
  expectSuccessfulCli(timing);
  expect(timing.stdout).toMatch(/shell|file_edit/i);

  // MCP 反例也要穿透到 CLI 读回：stdio 与远程 HTTP 调用存在，未挂载的 weather 不出现。
  const mcpLocator = await latestAttemptLocator("mcp");
  const mcpExecution = await niceeval.run(["show", mcpLocator, "--execution"]);
  expectSuccessfulCli(mcpExecution);
  expect(
    mcpExecution.stdout.includes("e2e.get-sum") || mcpExecution.stdout.includes("get-sum"),
    "execution tree missing stdio MCP call (e2e.get-sum)",
  ).toBe(true);
  expect(
    mcpExecution.stdout.includes("deepwiki.read_wiki_structure") ||
      mcpExecution.stdout.includes("read_wiki_structure"),
    "execution tree missing remote HTTP MCP call (deepwiki.read_wiki_structure)",
  ).toBe(true);
  expect(mcpExecution.stdout).not.toContain("weather.get_weather");
}, 38 * 60_000);
