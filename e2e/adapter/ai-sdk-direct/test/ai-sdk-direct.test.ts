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
import { runInspectionQuery } from "./query.ts";

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
  // completion、createdRunIds 与 publicationCutoff；成败由带身份的 eval 事件精确断言，不让 live provider
  // 故障冒充通过，也不在 receipt 上断言计数。
  const inv = runReceipt.expReceipt();
  expect(inv.completion, runReceipt.diagnostic()).toBe("completed");
  expect(inv.createdRunIds, runReceipt.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(
    runReceipt.expEvalEvents(),
    [
      // direct-agent：真实 generateText 须执行 remember_marker 工具并保留会话 marker；期望 passed/1。
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

it("attempt.trace 读回 aiSdkAgent 的代表性工具证据", async () => {
  const queried = await runInspectionQuery(niceeval, { kind: "attempt.trace", locator });
  expect(queried.exitCode, queried.diagnostic()).toBe(0);
  const document = queried.attemptTrace();
  expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
  const trace = JSON.stringify(document.trace);
  expect(trace).toContain("remember_marker");
  expect(trace).toContain(DIRECT_MARKER);
});
