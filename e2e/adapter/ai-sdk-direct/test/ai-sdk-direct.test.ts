// owner: docs/engineering/testing/e2e/adapter/ai-sdk-direct.md#adapter-ai-sdk-direct-live-compatibility
//
// Journey: the installed candidate instantiates aiSdkAgent around a real AI SDK
// generateText call, then every observation is read back through public CLI commands.

import {
  assertExpEvalOutcomes,
  command,
  only,
  type ProcessReceipt,
  withProcess,
  withTempDir,
} from "@niceeval/testkit";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import { DIRECT_MARKER } from "../evals/direct-agent.eval.ts";

const EVAL_ID = "direct-agent";
const REQUIRED_LIVE_SECRETS = ["OPENAI_API_KEY", "OPENAI_BASE_URL"] as const;
const niceevalBin = join(process.cwd(), "node_modules", ".bin", "niceeval");
const niceeval = command([niceevalBin]);
let runReceipt!: ProcessReceipt;
let locator!: string;

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live aiSdkAgent E2E requires ${missing.join(", ")}; ` +
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
  await rm(".niceeval", { recursive: true, force: true });

  await withTempDir("niceeval-ai-sdk-direct-", async (tempRoot) => {
    const privateHome = join(tempRoot, "home");
    await mkdir(privateHome, { recursive: true });

    runReceipt = await withProcess(
      [niceevalBin, "exp", "--rerun", "all", "--json"],
      {
        processGroup: true,
        timeoutMs: 13 * 60_000,
        env: { HOME: privateHome },
      },
      async (running) => await running.done,
    );
  });

  expect(runReceipt.exitCode, runReceipt.diagnostic()).toBe(0);
  locator = latestAttemptLocator();
}, 14 * 60_000);

it("真实 aiSdkAgent 的 Eval 以通过 verdict 完成", () => {
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md）：
  // completion 与 runIds；成败由带身份的 eval 事件精确断言，不让 live provider
  // 故障冒充通过，也不在 receipt 上断言计数。
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

it("show --execution 读回 aiSdkAgent 的代表性工具证据", async () => {
  const execution = await niceeval.run(["show", locator, "--execution"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("remember_marker");
  expect(execution.stdout).toContain(DIRECT_MARKER);
});

it("show --timing 读回 aiSdkAgent 的 runner 阶段", async () => {
  const timing = await niceeval.run(["show", locator, "--timing"]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout, timing.diagnostic()).toContain("eval.run");
  expect(timing.stdout, timing.diagnostic()).toMatch(/turn\s+turn1\b/);

});
