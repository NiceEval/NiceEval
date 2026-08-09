// owner: docs/engineering/testing/e2e/adapter/ai-sdk-direct.md#adapter-ai-sdk-direct-live-compatibility
//
// Journey: the installed candidate instantiates aiSdkAgent around a real AI SDK
// generateText call, then every observation is read back through public CLI commands.

import {
  command,
  type ProcessReceipt,
  withProcess,
  withTempDir,
} from "@niceeval/testkit";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DIRECT_MARKER } from "../evals/direct-agent.eval.ts";

const EVAL_ID = "direct-agent";
const REQUIRED_LIVE_SECRETS = ["OPENAI_API_KEY", "OPENAI_BASE_URL"] as const;
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
      `[configuration] live aiSdkAgent E2E requires ${missing.join(", ")}; ` +
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

it("真实 aiSdkAgent 结果经过公开 CLI 完整读回", async () => {
  requireLiveSecrets();
  await rm(".niceeval", { recursive: true, force: true });
  await rm("junit.xml", { force: true });

  await withTempDir("niceeval-ai-sdk-direct-", async (tempRoot) => {
    const privateHome = join(tempRoot, "home");
    await mkdir(privateHome, { recursive: true });

    let runReceipt: ProcessReceipt | undefined;
    await withProcess(
      [niceevalBin, "exp", "--rerun", "all", "--json", "--junit", "junit.xml"],
      {
        processGroup: true,
        timeoutMs: 13 * 60_000,
        env: { HOME: privateHome },
      },
      async (running) => {
        runReceipt = await running.done;
        expectPassedExperiment(runReceipt);
      },
    );
    expect(runReceipt).toBeDefined();
  });

  const junit = await readFile("junit.xml", "utf8");
  expect(junit).toContain("<testsuite");
  expect(junit).not.toContain("<failure");
  expect(junit).not.toContain("<error");

  const board = await niceeval.run(["show"]);
  expectSuccessfulCli(board);
  expect(board.stdout).toContain(EVAL_ID);

  const boardJson = await niceeval.run(["show", "--json"]);
  expectSuccessfulCli(boardJson);
  expect(boardJson.stdout).toContain(EVAL_ID);

  const locator = await latestAttemptLocator();
  const execution = await niceeval.run(["show", locator, "--execution"]);
  expectSuccessfulCli(execution);
  expect(execution.stdout).toContain("remember_marker");
  expect(execution.stdout).toContain(DIRECT_MARKER);
}, 14 * 60_000);
