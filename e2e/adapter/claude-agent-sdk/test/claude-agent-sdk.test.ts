// owner: docs/engineering/testing/e2e/adapter/claude-agent-sdk.md#adapter-claude-agent-sdk-live-compatibility
//
// 真实 SDK / provider Journey：候选包公开的 converter 只消费 SDKMessage，测试只经
// 安装后的 CLI 读回。没有 HTTP server、MCP 或私有 .niceeval 读取。

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { command, type ProcessReceipt, withProcess, withTempDir } from "@niceeval/testkit";
import { expect, it } from "vitest";

const EVAL_ID = "bash-session";
const REQUIRED_LIVE_SECRETS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"] as const;
const niceevalBin = join(process.cwd(), "node_modules", ".bin", "niceeval");
const niceeval = command([niceevalBin]);

interface ExpStartEvent {
  event: "start";
  format: string;
  total: number;
}

interface ExpResultEvent {
  event: "result";
  status: "passed" | "failed" | "incomplete" | "interrupted";
  passed: number;
  failed: number;
  errored: number;
  completion: "complete" | "incomplete" | "interrupted";
}

type ExpEvent = ExpStartEvent | ExpResultEvent | { event: string };

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] Claude Agent SDK live E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

function expectSuccessfulCli(receipt: ProcessReceipt): void {
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(receipt.signal, receipt.diagnostic()).toBeNull();
  expect(receipt.timedOut, receipt.diagnostic()).toBe(false);
  expect(receipt.stderr, receipt.diagnostic()).toBe("");
  expect(receipt.stdout).not.toMatch(/[\x1b\x08]/);
}

function expectPassedExperiment(receipt: ProcessReceipt): void {
  expectSuccessfulCli(receipt);
  const events = receipt.ndjson<ExpEvent>();
  expect(events[0]).toMatchObject({ event: "start", format: "niceeval.exp", total: 1 });
  expect(events.at(-1)).toMatchObject({
    event: "result",
    status: "passed",
    passed: 1,
    failed: 0,
    errored: 0,
    completion: "complete",
  });
}

async function latestAttemptLocator(): Promise<string> {
  const history = await niceeval.run(["show", EVAL_ID, "--history"]);
  expectSuccessfulCli(history);
  const latest = history.stdout.split("\n").filter((line) => line.includes("@")).at(-1);
  expect(latest, `${EVAL_ID} has no public history row`).toBeDefined();
  expect(latest).toContain("passed");
  const locator = latest!.match(/@\S+/)?.[0];
  expect(locator, `history row has no public locator: ${latest}`).toBeDefined();
  return locator!;
}

it("真实 Claude Agent SDK converter 结果经过公共 CLI 完整读回", async () => {
  requireLiveSecrets();

  const marker = `niceeval-claude-sdk-bash-${randomUUID()}`;
  const sentinel = `niceeval-claude-sdk-session-${randomUUID()}`;

  await withTempDir("niceeval-claude-agent-sdk-", async (tempRoot) => {
    const privateHome = join(tempRoot, "home");
    const workspace = join(tempRoot, "workspace");
    await Promise.all([mkdir(privateHome, { recursive: true }), mkdir(workspace, { recursive: true })]);

    await withProcess(
      [niceevalBin, "exp", "--rerun", "all", "--json"],
      {
        processGroup: true,
        timeoutMs: 13 * 60_000,
        env: {
          HOME: privateHome,
          CLAUDE_CONFIG_DIR: join(privateHome, ".claude"),
          NICEEVAL_CLAUDE_AGENT_SDK_HOME: privateHome,
          NICEEVAL_CLAUDE_AGENT_SDK_WORKSPACE: workspace,
          NICEEVAL_CLAUDE_AGENT_SDK_MARKER: marker,
          NICEEVAL_CLAUDE_AGENT_SDK_SENTINEL: sentinel,
        },
      },
      async (handle) => {
        const receipt = await handle.done;
        expectPassedExperiment(receipt);
      },
    );
  });

  const board = await niceeval.run(["show"]);
  expectSuccessfulCli(board);
  expect(board.stdout).toContain(EVAL_ID);

  const boardJson = await niceeval.run(["show", "--json"]);
  expectSuccessfulCli(boardJson);
  expect(boardJson.stdout).toContain(EVAL_ID);

  const locator = await latestAttemptLocator();
  const attemptJson = await niceeval.run(["show", locator, "--json"]);
  expectSuccessfulCli(attemptJson);
  expect(attemptJson.stdout).toContain("session_id");
  expect(attemptJson.stdout).toContain(EVAL_ID);

  const execution = await niceeval.run(["show", locator, "--execution"]);
  expectSuccessfulCli(execution);
  expect(execution.stdout).toContain("TOOL · Bash");
  expect(execution.stdout).toContain(marker);
}, 14 * 60_000);
