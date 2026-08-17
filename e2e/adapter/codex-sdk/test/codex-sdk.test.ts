// owner: docs/engineering/testing/e2e/adapter/codex-sdk.md#adapter-codex-sdk-live-compatibility
//
// A single live Journey owns this leaf. It starts the installed niceeval
// candidate as an owned process, then proves the same result through public
// show commands only; it never reads the private .niceeval layout.

import {
  assertExpEvalOutcomes,
  command,
  only,
  type ProcessReceipt,
  withProcess,
  withTempDir,
} from "@niceeval/testkit";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

const REQUIRED_LIVE_SECRETS = ["CODEX_API_KEY", "CODEX_BASE_URL"] as const;
const EVAL_ID = "live-compatibility";
const niceevalBin = join(process.cwd(), "node_modules", ".bin", "niceeval");
const niceeval = command([niceevalBin]);
let env!: NodeJS.ProcessEnv;
let marker!: string;
let sentinel!: string;
let runReceipt!: ProcessReceipt;
let locator!: string;

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live Codex SDK converter E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

beforeAll(async () => {
  requireLiveSecrets();
  await rm(".niceeval", { recursive: true, force: true });

  await withTempDir("niceeval-codex-sdk-live-", async (tempRoot) => {
    const home = join(tempRoot, "home");
    const codexHome = join(tempRoot, "codex-home");
    const workspace = join(tempRoot, "workspace");
    await Promise.all([mkdir(home), mkdir(codexHome), mkdir(workspace)]);

    marker = `niceeval-codex-sdk-command-${randomUUID()}`;
    sentinel = `niceeval-codex-sdk-sentinel-${randomUUID()}`;
    env = {
      HOME: home,
      CODEX_HOME: codexHome,
      CODEX_SDK_WORKSPACE: workspace,
      CODEX_SDK_E2E_MARKER: marker,
      CODEX_SDK_E2E_SENTINEL: sentinel,
    };

    // withProcess owns the entire process group. The body waits for the strict
    // receipt; its finally path calls dispose(), which checks descendants after
    // the root process exits without relying on a non-existent receipt field.
    runReceipt = await withProcess(
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
  });

  expect(runReceipt.exitCode, runReceipt.diagnostic()).toBe(0);
  const evalEvent = only(
    runReceipt.expEvalEvents(),
    (event) => event.evalId === EVAL_ID,
    () => runReceipt.diagnostic(),
  );
  locator = evalEvent.locator;
}, 14 * 60_000);

it("真实 Codex SDK converter 的 Eval 以通过 verdict 完成", () => {
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md）：
  // completion 与 runIds；成败由带身份的 eval 事件精确断言，live provider
  // 故障不会冒充通过。
  const inv = runReceipt.expReceipt();
  expect(inv.completion, runReceipt.diagnostic()).toBe("completed");
  expect(inv.runIds, runReceipt.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(
    runReceipt.expEvalEvents(),
    [
      // live compatibility：真实 Thread stream 须保留命令结果并续接 sentinel；单次运行期望 passed/1。
      {
        evalId: EVAL_ID,
        experimentId: "live",
        verdict: "passed",
        attempts: 1,
        passed: 1,
      },
    ],
    () => runReceipt.diagnostic(),
  );
});

it("show --execution 读回 Codex SDK converter 的代表性证据", async () => {
  const execution = await niceeval.run(["show", locator, "--execution", "--json"], { env });
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  // Conversation keeps the original command, converted tool identity,
  // completed result, and resumed assistant response in the public machine view.
  expect(execution.stdout).toContain('"conversation"');
  expect(execution.stdout).toContain('"tool":"command_execution"');
  expect(execution.stdout).toContain('"kind":"tool-result"');
  expect(execution.stdout).toContain(marker);
  expect(execution.stdout).toContain(sentinel);
});

it("show --timing 读回 Codex SDK converter 的 runner 阶段", async () => {
  const timing = await niceeval.run(["show", locator, "--timing"], { env });
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout, timing.diagnostic()).toContain("eval.run");
  expect(timing.stdout, timing.diagnostic()).toMatch(/agent\.send\s+turn1\b/);

});
