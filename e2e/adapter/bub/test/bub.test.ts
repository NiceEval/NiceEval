// owner: docs/engineering/testing/e2e/adapter/bub.md#adapter-bub-live-compatibility
//
// 单文件 Journey：真实 bubAgent + Docker Sandbox + live provider，
// 同一批真实运行分别供 verdict 与 execution 独立命题读取。
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
  { experimentId: "ci", evalId: "coding-task/write-and-verify", verdict: "passed", attempts: 1, passed: 1 },
  { experimentId: "ci", evalId: "skills/discovery", verdict: "passed", attempts: 1, passed: 1 },
  { experimentId: "ci", evalId: "extensions/plugin-postsetup", verdict: "passed", attempts: 1, passed: 1 },
  { experimentId: "ci", evalId: "session/recall", verdict: "passed", attempts: 1, passed: 1 },
] as const satisfies readonly ExpEvalOutcomeExpectation[];

const REQUIRED_LIVE_SECRETS = ["BUB_API_KEY", "BUB_API_BASE"] as const;

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
let run!: ProcessReceipt;
let legacy!: ProcessReceipt;
let evalEvents!: ExpEvalEvent[];
let legacyEvalEvents!: ExpEvalEvent[];

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live bub E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the bub sandbox",
    );
  }
}

beforeAll(async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });

  // invoke：先只跑 ci——结果目录一旦有两个实验，show 默认报告会折叠成实验汇总表。
  run = await niceeval.run(
    ["exp", "ci", "--rerun", "all", "--json"],
    { timeoutMs: 32 * 60_000 },
  );
  expect(run.exitCode, run.diagnostic()).toBe(0);
  evalEvents = run.expEvalEvents();

  // legacy 版本线证明声明的旧版组合仍能安装并完成公开协议闭环。
  legacy = await niceeval.run(
    ["exp", "legacy", "coding-task", "--rerun", "all", "--json"],
    { timeoutMs: 20 * 60_000 },
  );
  expect(legacy.exitCode, legacy.diagnostic()).toBe(0);
  legacyEvalEvents = legacy.expEvalEvents();
}, 36 * 60_000);

it("真实 Bub adapter 的 Eval 通过数正确且没有未通过项", () => {
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

  const legacyInv = legacy.expReceipt();
  expect(legacyInv.completion, legacy.diagnostic()).toBe("completed");
  expect(legacyInv.runIds, legacy.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(
    legacyEvalEvents,
    [
      {
        experimentId: "legacy",
        evalId: "coding-task/write-and-verify",
        verdict: "passed",
        attempts: 1,
        passed: 1,
      },
    ],
    () => legacy.diagnostic(),
  );
});

it("show --execution 读回 Bub 的代表性工具证据", async () => {
  const event = only(
    evalEvents,
    (candidate) => candidate.evalId === "coding-task/write-and-verify",
  );
  const execution = await niceeval.run(["show", event.locator!, "--execution"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("notes.txt");
});
