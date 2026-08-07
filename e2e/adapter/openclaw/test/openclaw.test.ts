// feature: docs/engineering/testing/e2e/adapter/openclaw.md
//
// 单文件 Journey：真实 OpenClaw CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 timing。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ProcessReceipt } from "@niceeval/testkit";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ensureDockerImage } from "../scripts/build-docker-env.ts";

const EXPECTED_EVALS = [
  "coding-task/write-and-verify",
  "session/recall",
  "usage/tokens",
] as const;

const REQUIRED_LIVE_SECRETS = ["BUB_API_KEY", "BUB_API_BASE"] as const;

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
      `[configuration] live openclaw E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the openclaw sandbox",
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

it("真实 OpenClaw CLI adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回", async () => {
  requireLiveSecrets();
  await requireDocker();
  ensureDockerImage();

  rmSync(".niceeval", { recursive: true, force: true });
  rmSync("junit.xml", { force: true });

  const run = await niceeval.run(["exp", "--rerun", "all", "--json", "--junit", "junit.xml"], {
    timeoutMs: 46 * 60_000,
  });
  const events = expectExpStream(run);
  const result = events.at(-1) as ExpResultEvent;
  expect(result.passed).toBeGreaterThanOrEqual(EXPECTED_EVALS.length);

  const junit = readFileSync("junit.xml", "utf8");
  expect(junit).toContain("<testsuite");
  expect(junit).not.toContain("<failure");
  expect(junit).not.toContain("<error");

  const board = await niceeval.run(["show", "--page", "attempts"]);
  expectSuccessfulCli(board);
  for (const evalId of EXPECTED_EVALS) {
    expect(board.stdout, `show --page attempts missing ${evalId}`).toContain(evalId);
  }

  const codingTaskLocator = await latestAttemptLocator("coding-task/write-and-verify");
  for (const evalId of EXPECTED_EVALS) {
    if (evalId === "coding-task/write-and-verify") continue;
    await latestAttemptLocator(evalId);
  }

  const execution = await niceeval.run(["show", codingTaskLocator, "--execution"]);
  expectSuccessfulCli(execution);
  expect(
    execution.stdout.includes("notes.txt") ||
      execution.stdout.includes("file_write") ||
      execution.stdout.includes("write"),
    "execution tree missing write evidence (notes.txt/file_write/write)",
  ).toBe(true);
  expect(
    execution.stdout.includes("shell") ||
      execution.stdout.includes("bash") ||
      execution.stdout.includes("command_execution"),
    "execution tree missing shell evidence (shell/bash/command_execution)",
  ).toBe(true);

  const timing = await niceeval.run(["show", codingTaskLocator, "--timing"]);
  expectSuccessfulCli(timing);
  expect(timing.stdout).toContain("eval.run");
  expect(timing.stdout).toContain("agent.setup");
  expect(timing.stdout).toMatch(/turn\s+s\d+\/t\d+/);
}, 48 * 60_000);
