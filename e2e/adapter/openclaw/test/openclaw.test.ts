// owner: docs/engineering/testing/e2e/adapter/openclaw.md#adapter-openclaw-live-compatibility
//
// 单文件 Journey：真实 OpenClaw CLI + Docker Sandbox + live provider，
// 同一次真实运行分别供 verdict、execution 与 timing 三个独立命题读取。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import {
  assertExpEvalOutcomes,
  command,
  only,
  type ExpEvalEvent,
  type ExpEvalOutcomeExpectation,
  type ProcessReceipt,
} from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

const EXPECTED_OUTCOMES = [
  // coding task：文件写入与 shell 读回都须以正确参数完成并进入标准事件流；期望 passed/1。
  { experimentId: "ci", evalId: "coding-task/write-and-verify", verdict: "passed", attempts: 1, passed: 1 },
  // Skill status：只读取目标 status-report Skill、不误用 decoy，并采用目标约定；期望 passed/1。
  { experimentId: "ci", evalId: "skills/status-report", verdict: "passed", attempts: 1, passed: 1 },
  // session recall：同一会话的第二轮须引用首轮事实；一条会话链完成即为 passed/1。
  { experimentId: "ci", evalId: "session/recall", verdict: "passed", attempts: 1, passed: 1 },
  // usage：两个 turn 都须产生正的 input/output token；全部断言成立时为 passed/1。
  { experimentId: "ci", evalId: "usage/tokens", verdict: "passed", attempts: 1, passed: 1 },
] as const satisfies readonly ExpEvalOutcomeExpectation[];

const REQUIRED_LIVE_SECRETS = ["BUB_API_KEY", "BUB_API_BASE"] as const;

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
let run!: ProcessReceipt;
let evalEvents!: ExpEvalEvent[];

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live openclaw E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the openclaw sandbox",
    );
  }
}

beforeAll(async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });

  run = await niceeval.run(["exp", "--rerun", "all", "--json"], {
    timeoutMs: 46 * 60_000,
  });
  expect(run.exitCode, run.diagnostic()).toBe(0);
  evalEvents = run.expEvalEvents();
}, 48 * 60_000);

it("真实 OpenClaw adapter 的 Eval 通过数正确且没有未通过项", () => {
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md「结束反馈与
  // receipt」）：completion 与 runIds（每个 Experiment 一个 Run）。成败由下面带身份的
  // eval 事件精确断言，不从 receipt 猜计数。
  const inv = run.expReceipt();
  expect(inv.completion, run.diagnostic()).toBe("completed");
  expect(inv.runIds, run.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(
    evalEvents,
    EXPECTED_OUTCOMES,
    () => run.diagnostic(),
  );
});

it("show --execution 读回 OpenClaw 的代表性工具证据", async () => {
  const event = only(
    evalEvents,
    (candidate) => candidate.evalId === "coding-task/write-and-verify",
  );
  const execution = await niceeval.run(["show", event.locator!, "--execution"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("notes.txt");
});

it("show --timing 读回 OpenClaw 的 runner 阶段", async () => {
  const event = only(
    evalEvents,
    (candidate) => candidate.evalId === "coding-task/write-and-verify",
  );
  const timing = await niceeval.run(["show", event.locator!, "--timing"]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout).toMatch(/agent\.send\s+turn1\b/);

});
