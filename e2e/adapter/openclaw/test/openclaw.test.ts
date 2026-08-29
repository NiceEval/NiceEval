// owner: docs/engineering/testing/e2e/adapter/openclaw.md#adapter-openclaw-live-compatibility
//
// 单文件 Journey：真实 OpenClaw CLI + Docker Sandbox + live provider，
// 同一次真实运行供 verdict 与 execution 两个独立命题读取。
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
import { withInspectionRequest } from "@niceeval/testkit";

const EXPECTED_OUTCOMES = [
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
  // receipt」）：completion、createdRunIds 与 publicationCutoff（每个 Experiment 一个 Run）。成败由下面带身份的
  // eval 事件精确断言，不从 receipt 猜计数。
  const inv = run.expReceipt();
  expect(inv.completion, run.diagnostic()).toBe("completed");
  expect(inv.createdRunIds, run.diagnostic()).toHaveLength(1);
  assertExpEvalOutcomes(
    evalEvents,
    EXPECTED_OUTCOMES,
    () => run.diagnostic(),
  );
});

it("attempt.trace 读回 OpenClaw 的代表性工具证据", async () => {
  const event = only(
    evalEvents,
    (candidate) => candidate.evalId === "skills/status-report",
  );
  const queried = await withInspectionRequest({
    kind: "attempt.trace",
    locator: event.locator,
  }, async (requestPath) => await niceeval.run(["query", "run", "--request", requestPath]));
  expect(queried.exitCode, queried.diagnostic()).toBe(0);
  const document = queried.attemptTrace();
  expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
  expect(JSON.stringify(document.trace)).toContain("status-report.txt");
});
