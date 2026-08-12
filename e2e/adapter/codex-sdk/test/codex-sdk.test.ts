// owner: docs/engineering/testing/e2e/adapter/codex-sdk.md#adapter-codex-sdk-live-compatibility
//
// A single live Journey owns this leaf. It starts the installed niceeval
// candidate as an owned process, then proves the same result through public
// show commands only; it never reads the private .niceeval layout.

import { command, type ExpEvalEvent, type ExpEvent, withProcess, withTempDir } from "@niceeval/testkit";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

const REQUIRED_LIVE_SECRETS = ["CODEX_API_KEY", "CODEX_BASE_URL"] as const;
const EVAL_ID = "live-compatibility";
const niceevalBin = join(process.cwd(), "node_modules", ".bin", "niceeval");
const niceeval = command([niceevalBin]);

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live Codex SDK converter E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function latestPassedLocator(env: NodeJS.ProcessEnv): Promise<string> {
  const history = await niceeval.run(["show", EVAL_ID, "--history"], { env });
  expect(history.exitCode, history.diagnostic()).toBe(0);
  const line = history.stdout.split("\n").filter((candidate) => candidate.includes("@")).at(-1);
  expect(line, history.diagnostic()).toBeDefined();
  expect(line).toContain("passed");
  const locator = line!.match(/@\S+/)?.[0];
  expect(locator, history.diagnostic()).toBeDefined();
  return locator!;
}

it("真实 Codex SDK converter 兼容性从 Experiment 到公开 CLI 读回", async () => {
  requireLiveSecrets();
  await rm(".niceeval", { recursive: true, force: true });

  await withTempDir("niceeval-codex-sdk-live-", async (tempRoot) => {
    const home = join(tempRoot, "home");
    const codexHome = join(tempRoot, "codex-home");
    const workspace = join(tempRoot, "workspace");
    await Promise.all([mkdir(home), mkdir(codexHome), mkdir(workspace)]);

    const marker = `niceeval-codex-sdk-command-${randomUUID()}`;
    const sentinel = `niceeval-codex-sdk-sentinel-${randomUUID()}`;
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      CODEX_HOME: codexHome,
      CODEX_SDK_WORKSPACE: workspace,
      CODEX_SDK_E2E_MARKER: marker,
      CODEX_SDK_E2E_SENTINEL: sentinel,
    };

    // withProcess owns the entire process group. The body waits for the strict
    // receipt; its finally path calls dispose(), which checks descendants after
    // the root process exits without relying on a non-existent receipt field.
    const receipt = await withProcess(
      [niceevalBin, "exp", "live", "--rerun", "all", "--json"],
      {
        env,
        processGroup: true,
        timeoutMs: 12 * 60_000,
      },
      async (handle) => {
        return await handle.done;
      },
    );
    expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
    const events = receipt.ndjson<ExpEvent>();
    // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md）：
    // completion 与 runIds；成败由带身份的 eval 事件精确断言，live provider
    // 故障不会冒充通过。
    const inv = receipt.expReceipt();
    expect(inv.completion, receipt.diagnostic()).toBe("completed");
    expect(inv.runIds, receipt.diagnostic()).toHaveLength(1);
    const evalEvent = events.find(
      (event): event is ExpEvalEvent =>
        "event" in event && event.event === "eval" && event.evalId === EVAL_ID,
    );
    expect(evalEvent, receipt.diagnostic()).toBeDefined();
    expect(evalEvent).toMatchObject({
      event: "eval",
      evalId: EVAL_ID,
      verdict: "passed",
      attempts: 1,
    });

    const locator = await latestPassedLocator(env);
    const execution = await niceeval.run(["show", locator, "--execution"], { env });
    expect(execution.exitCode, execution.diagnostic()).toBe(0);
    // The public execution projection contains the original command marker, its
    // converted tool card/result, and the second turn that resumed the thread.
    expect(execution.stdout).toContain(marker);
    expect(execution.stdout).toMatch(/TOOL · (shell|command_execution)/);
    expect(execution.stdout).toContain("result · completed");
    expect(execution.stdout).toContain(sentinel);
    expect(execution.stdout).toContain("turn2");
  });
}, 14 * 60_000);
