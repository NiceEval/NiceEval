// owner: docs/engineering/testing/e2e/adapter/claude-agent-sdk.md#adapter-claude-agent-sdk-live-compatibility
//
// 真实 SDK / provider Journey：候选包公开的 converter 只消费 SDKMessage，测试只经
// 安装后的 CLI 读回。没有 HTTP server、MCP 或私有 .niceeval 读取。

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  command,
  type ExpEvalEvent,
  type ExpEvent,
  type ProcessReceipt,
  withProcess,
  withTempDir,
} from "@niceeval/testkit";
import { beforeAll, expect, it } from "vitest";

const EVAL_ID = "bash-session";
const REQUIRED_LIVE_SECRETS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"] as const;
const niceevalBin = join(process.cwd(), "node_modules", ".bin", "niceeval");
const niceeval = command([niceevalBin]);
let marker!: string;
let sentinel!: string;
let runReceipt!: ProcessReceipt;
let locator!: string;

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] Claude Agent SDK live E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function latestAttemptLocator(): Promise<string> {
  const history = await niceeval.run(["show", EVAL_ID, "--history"]);
  expect(history.exitCode, history.diagnostic()).toBe(0);
  const latest = history.stdout.split("\n").filter((line) => line.includes("@")).at(-1);
  expect(latest, `${EVAL_ID} has no public history row`).toBeDefined();
  expect(latest).toContain("passed");
  const locator = latest!.match(/@\S+/)?.[0];
  expect(locator, `history row has no public locator: ${latest}`).toBeDefined();
  return locator!;
}

beforeAll(async () => {
  requireLiveSecrets();

  marker = `niceeval-claude-sdk-bash-${randomUUID()}`;
  sentinel = `niceeval-claude-sdk-session-${randomUUID()}`;

  await withTempDir("niceeval-claude-agent-sdk-", async (tempRoot) => {
    const privateHome = join(tempRoot, "home");
    const workspace = join(tempRoot, "workspace");
    await Promise.all([mkdir(privateHome, { recursive: true }), mkdir(workspace, { recursive: true })]);

    runReceipt = await withProcess(
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
      async (handle) => await handle.done,
    );
  });

  expect(runReceipt.exitCode, runReceipt.diagnostic()).toBe(0);
  locator = await latestAttemptLocator();
}, 14 * 60_000);

it("真实 Claude Agent SDK converter 的 Eval 以通过 verdict 完成", () => {
  const events = runReceipt.ndjson<ExpEvent>();
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md）：
  // completion 与 runIds；成败由带身份的 eval 事件精确断言，live provider
  // 故障不会冒充通过。
  const inv = runReceipt.expReceipt();
  expect(inv.completion, runReceipt.diagnostic()).toBe("completed");
  expect(inv.runIds, runReceipt.diagnostic()).toHaveLength(1);
  const evalEvent = events.find(
    (event): event is ExpEvalEvent =>
      "event" in event && event.event === "eval" && event.evalId === EVAL_ID,
  );
  expect(evalEvent, runReceipt.diagnostic()).toBeDefined();
  expect(evalEvent).toMatchObject({
    event: "eval",
    evalId: EVAL_ID,
    verdict: "passed",
    attempts: 1,
  });
});

it("show --execution 读回 Claude Agent SDK converter 的代表性证据", async () => {
  const attemptJson = await niceeval.run(["show", locator, "--json"]);
  expect(attemptJson.exitCode, attemptJson.diagnostic()).toBe(0);
  expect(attemptJson.stdout).toContain("session_id");
  expect(attemptJson.stdout).toContain(EVAL_ID);

  const execution = await niceeval.run(["show", locator, "--execution"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("TOOL · Bash");
  expect(execution.stdout).toContain(marker);
});

it("show --timing 读回 Claude Agent SDK converter 的 runner 阶段", async () => {
  const timing = await niceeval.run(["show", locator, "--timing"]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout, timing.diagnostic()).toContain("eval.run");
  expect(timing.stdout, timing.diagnostic()).toMatch(/turn\s+turn1\b/);

});
