// owner: docs/engineering/testing/e2e/adapter/claude-agent-sdk.md#adapter-claude-agent-sdk-live-compatibility
//
// 真实 SDK / provider Journey：候选包公开的 converter 只消费 SDKMessage，测试只经
// 安装后的 CLI 读回。没有 HTTP server、MCP 或私有 .niceeval 读取。

import { randomInt, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  assertExpEvalOutcomes,
  command,
  only,
  retryFailedExpEvalsOnce,
  type ExpEvalEvent,
  type ProcessReceipt,
  withProcess,
  withTempDir,
} from "@niceeval/testkit";
import { beforeAll, expect, it } from "vitest";
import { runInspectionQuery, type InspectionDocument } from "./query.ts";

const EVAL_ID = "bash-session";
const REQUIRED_LIVE_SECRETS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"] as const;
const niceevalBin = join(process.cwd(), "node_modules", ".bin", "niceeval");
const niceeval = command([niceevalBin]);
let marker!: string;
let sentinel!: string;
let runReceipt!: ProcessReceipt;
let evalEvents!: readonly ExpEvalEvent[];
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

beforeAll(async () => {
  requireLiveSecrets();

  marker = `niceeval-claude-sdk-bash-${randomUUID()}`;
  // Resume only needs an unpredictable challenge that was present in the first
  // turn. A UUID makes the live model's character-perfect transcription, rather
  // than SDK session continuity, the dominant source of failure.
  sentinel = `NE-${randomInt(1_000, 10_000)}`;

  await withTempDir("niceeval-claude-agent-sdk-", async (tempRoot) => {
    const privateHome = join(tempRoot, "home");
    const workspace = join(tempRoot, "workspace");
    await Promise.all([mkdir(privateHome, { recursive: true }), mkdir(workspace, { recursive: true })]);

    const runExp = (args: readonly string[]) =>
      withProcess(
        [niceevalBin, "exp", ...args],
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

    runReceipt = await runExp(["--rerun", "all", "--json"]);
    const firstEvents = runReceipt.expEvalEvents();
    const failed = firstEvents.filter((event) => event.verdict === "failed");
    expect(
      firstEvents.filter(
        (event) => event.verdict === "errored" || event.verdict === "skipped",
      ),
      runReceipt.diagnostic(),
    ).toHaveLength(0);
    expect(runReceipt.exitCode, runReceipt.diagnostic()).toBe(failed.length > 0 ? 1 : 0);

    const retried = await retryFailedExpEvalsOnce({
      events: firstEvents,
      targets: failed,
      runRetry: (event) =>
        runExp(["ci", event.evalId, "--rerun", "all", "--json"]),
    });
    if (retried.retries.length > 0) {
      process.stderr.write(
        `[niceeval e2e] retried ${retried.retries.length} assertion-failed Eval once; ` +
          `first Invocation ${runReceipt.expReceipt().invocationId} remains recorded\n`,
      );
    }
    evalEvents = retried.events;
  });

  locator = only(
    evalEvents,
    (event) => event.evalId === EVAL_ID,
    () => runReceipt.diagnostic(),
  ).locator;
}, 14 * 60_000);

it("真实 Claude Agent SDK converter 的 Eval 以通过 verdict 完成", () => {
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md）：
  // completion 与 runIds；成败由带身份的 eval 事件精确断言，live provider
  // 故障不会冒充通过。
  const inv = runReceipt.expReceipt();
  expect(inv.completion, runReceipt.diagnostic()).toBe("completed");
  expect(inv.runIds, runReceipt.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(
    evalEvents,
    [
      // bash-session：真实 SDK stream 须归一 Bash 调用并在续接轮保留 sentinel；期望 passed/1。
      {
        evalId: EVAL_ID,
        experimentId: "ci",
        verdict: "passed",
        attempts: 1,
        passed: 1,
      },
    ],
    () => runReceipt.diagnostic(),
  );
});

it("attempt.trace 读回 Claude Agent SDK converter 的代表性证据", async () => {
  const queried = await runInspectionQuery(niceeval, { kind: "attempt.trace", locator });
  expect(queried.exitCode, queried.diagnostic()).toBe(0);
  const document = queried.json<InspectionDocument>();
  expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
  // Trace keeps the source-native tool, its unmodified input marker,
  // completed result, and resumed assistant response in the public machine view.
  const trace = JSON.stringify(document.trace);
  expect(trace).toMatch(/"tool":"(?:shell|Bash)"/);
  expect(trace).toContain('"kind":"tool-result"');
  expect(trace).toContain(marker);
  expect(trace).toContain(sentinel);
});
