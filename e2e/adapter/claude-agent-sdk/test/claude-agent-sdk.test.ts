// owner: docs/engineering/testing/e2e/adapter/claude-agent-sdk.md#adapter-claude-agent-sdk-live-compatibility
//
// 真实 SDK / provider Journey：候选包公开的 converter 只消费 SDKMessage，测试只经
// 安装后的 CLI 读回。没有 HTTP server、MCP 或私有 .niceeval 读取。

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  assertExpEvalOutcomes,
  command,
  only,
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

function latestAttemptLocator(): string {
  const evalEvent = only(
    runReceipt.expEvalEvents(),
    (event) => event.evalId === EVAL_ID,
    () => runReceipt.diagnostic(),
  );
  return evalEvent.locator;
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
  locator = latestAttemptLocator();
}, 14 * 60_000);

it("真实 Claude Agent SDK converter 的 Eval 以通过 verdict 完成", () => {
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md）：
  // completion 与 runIds；成败由带身份的 eval 事件精确断言，live provider
  // 故障不会冒充通过。
  const inv = runReceipt.expReceipt();
  expect(inv.completion, runReceipt.diagnostic()).toBe("completed");
  expect(inv.runIds, runReceipt.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(
    runReceipt.expEvalEvents(),
    [{
      evalId: EVAL_ID,
      experimentId: "ci",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    }],
    () => runReceipt.diagnostic(),
  );
});

it("show --execution 读回 Claude Agent SDK converter 的代表性证据", async () => {
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
