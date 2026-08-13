// owner: docs/engineering/testing/e2e/adapter/ai-sdk-direct.md#adapter-ai-sdk-direct-live-compatibility
//
// Journey: the installed candidate instantiates aiSdkAgent around a real AI SDK
// generateText call, then every observation is read back through public CLI commands.

import {
  command,
  type ExpEvalEvent,
  type ExpEvent,
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
  locator = await latestAttemptLocator();
}, 14 * 60_000);

it("真实 aiSdkAgent 的 Eval 以通过 verdict 完成", () => {
  const events = runReceipt.ndjson<ExpEvent>();
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md）：
  // completion 与 runIds；成败由带身份的 eval 事件精确断言，不让 live provider
  // 故障冒充通过，也不在 receipt 上断言计数。
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
