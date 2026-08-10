// owner: docs/engineering/testing/e2e/adapter/hermes.md#adapter-hermes-live-compatibility
//
// 单文件 Journey：真实 Hermes CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 timing。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ProcessReceipt } from "@niceeval/testkit";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const EXPECTED_EVALS = [
  "coding-task/write-and-verify",
  "skills/selected",
  "session/recall",
  "usage/tokens",
] as const;

const WRITE_MARKER = "niceeval-hermes-tool-input-914";
const SKILL_NAME = "niceeval-hermes-incident-report";

const REQUIRED_LIVE_SECRETS = [
  "BUB_API_KEY",
  "BUB_API_BASE",
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
      `[configuration] live hermes E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the hermes sandbox",
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

it("真实 Hermes CLI adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回", async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });
  rmSync("junit.xml", { force: true });

  // invoke：完整 argv 走安装后的 candidate binary；真实 Hermes CLI、Docker sandbox
  // 与 live provider 仍由 experiments/ci.ts + evals/ 驱动。
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

  const locators: Record<string, string> = {};
  for (const evalId of EXPECTED_EVALS) {
    locators[evalId] = await latestAttemptLocator(evalId);
  }

  // outcome：execution 是适配器收到的公开投影。工具名称、文件路径和两个特意选择的
  // 入参哨兵都必须跨过归一、落盘与 show；只出现任意 write/shell 名称不够区分。
  const codingExecution = await niceeval.run([
    "show",
    locators["coding-task/write-and-verify"]!,
    "--execution",
  ]);
  expectSuccessfulCli(codingExecution);
  expect(codingExecution.stdout).toContain("notes.txt");
  expect(codingExecution.stdout).toContain(WRITE_MARKER);
  expect(codingExecution.stdout).toMatch(/cat\s+notes\.txt/);

  const skillExecution = await niceeval.run(["show", locators["skills/selected"]!, "--execution"]);
  expectSuccessfulCli(skillExecution);
  expect(skillExecution.stdout).toContain(SKILL_NAME);

  // timing：仓库验收明确「无原生 OTel 时执行树显示 timing unavailable；
  // 事件流断言照常通过」，因此只断言阶段树本身，不要求字面 OTel 子树。
  const timing = await niceeval.run(["show", locators["coding-task/write-and-verify"]!, "--timing"]);
  expectSuccessfulCli(timing);
  expect(timing.stdout).toContain("eval.run");
  expect(timing.stdout).toContain("agent.setup");
  expect(timing.stdout).toMatch(/turn\s+turn1\b/);
}, 38 * 60_000);
