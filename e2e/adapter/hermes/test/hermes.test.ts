// owner: docs/engineering/testing/e2e/adapter/hermes.md#adapter-hermes-live-compatibility
//
// 单文件 Journey：真实 Hermes CLI + Docker Sandbox + live provider，
// 同一次真实运行分别供 verdict、execution 与 timing 三个独立命题读取。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import {
  command,
  only,
  type ExpEvalEvent,
  type ExpEvent,
  type ProcessReceipt,
} from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

const EXPECTED_EVALS = [
  "coding-task/write-and-verify",
  "skills/selected",
  "session/recall",
  "usage/tokens",
] as const;

const REQUIRED_LIVE_SECRETS = [
  "BUB_API_KEY",
  "BUB_API_BASE",
] as const;

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
let run!: ProcessReceipt;
let evalEvents!: ExpEvalEvent[];

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live hermes E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the hermes sandbox",
    );
  }
}

beforeAll(async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });

  // invoke：完整 argv 走安装后的 candidate binary；真实 Hermes CLI、Docker sandbox
  // 与 live provider 仍由 experiments/ci.ts + evals/ 驱动。
  run = await niceeval.run(["exp", "--rerun", "all", "--json"], {
    timeoutMs: 36 * 60_000,
  });
  expect(run.exitCode, run.diagnostic()).toBe(0);
  evalEvents = run
    .ndjson<ExpEvent>()
    .filter((event): event is ExpEvalEvent => "event" in event && event.event === "eval");
}, 38 * 60_000);

it("真实 Hermes CLI adapter 的 Eval 通过数正确且没有未通过项", () => {
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md「结束反馈与
  // receipt」）：completion 与 runIds（每个 Experiment 一个 Run）。成败由下面带身份的
  // eval 事件精确断言，不从 receipt 猜计数。
  const inv = run.expReceipt();
  expect(inv.completion, run.diagnostic()).toBe("completed");
  expect(inv.runIds, run.diagnostic()).toHaveLength(1);
  expect(evalEvents.filter((event) => event.verdict === "passed"), run.diagnostic()).toHaveLength(
    EXPECTED_EVALS.length,
  );
  expect(evalEvents.filter((event) => event.verdict !== "passed"), run.diagnostic()).toHaveLength(0);
});

it("show --execution 读回 Hermes 的代表性工具证据", async () => {
  const event = only(
    evalEvents,
    (candidate) => candidate.evalId === "coding-task/write-and-verify",
  );
  const execution = await niceeval.run(["show", event.locator!, "--execution"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("niceeval-hermes-tool-input-914");
});

it("show --timing 如实呈现 Hermes 没有原生 telemetry", async () => {
  const event = only(
    evalEvents,
    (candidate) => candidate.evalId === "coding-task/write-and-verify",
  );
  const timing = await niceeval.run(["show", event.locator!, "--timing"]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout).toMatch(/turn\s+turn1\b/);

  const execution = await niceeval.run(["show", event.locator!, "--execution"]);
  expect(execution.stdout).toContain("timing unavailable");
});
