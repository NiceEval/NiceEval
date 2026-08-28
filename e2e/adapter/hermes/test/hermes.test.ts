// owner: docs/engineering/testing/e2e/adapter/hermes.md#adapter-hermes-live-compatibility
//
// 单文件 Journey：真实 Hermes CLI + Docker Sandbox + live provider，
// 同一次真实运行供 verdict 与 execution 两个独立命题读取。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import {
  assertExpEvalOutcomes,
  createE2EContext,
  only,
  type ExpEvalOutcomeExpectation,
} from "@niceeval/testkit";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { runInspectionQuery } from "./query.ts";

const EXPECTED_OUTCOMES = [
  // coding task：带可区分入参的文件写入与 shell 读回都须归一完成；单次执行期望 passed/1。
  { experimentId: "ci", evalId: "coding-task/write-and-verify", verdict: "passed", attempts: 1, passed: 1 },
  // Skill selection：只加载 incident-report Skill、不加载 decoy，并采用目标约定；期望 passed/1。
  { experimentId: "ci", evalId: "skills/selected", verdict: "passed", attempts: 1, passed: 1 },
  // session recall：同一会话的第二轮须引用首轮事实；一条会话链完成即为 passed/1。
  { experimentId: "ci", evalId: "session/recall", verdict: "passed", attempts: 1, passed: 1 },
  // usage：两个独立 turn 都须读到正的 input/output token；全部断言成立时为 passed/1。
  { experimentId: "ci", evalId: "usage/tokens", verdict: "passed", attempts: 1, passed: 1 },
] as const satisfies readonly ExpEvalOutcomeExpectation[];

const REQUIRED_LIVE_SECRETS = [
  "BUB_API_KEY",
  "BUB_API_BASE",
] as const;

const e2e = createE2EContext({
  repoId: "hermes",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-hermes-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "junit.xml", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live hermes E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

it("真实 Hermes CLI adapter 完成运行并公开读回工具证据", async () => {
  requireLiveSecrets();
  await e2e.case(
    "live",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      // invoke：完整 argv 走安装后的 candidate binary；Docker capability 已由
      // project.json metadata 的 requires.docker 在 root runner preflight 统一证明。
      const run = await niceeval.run(["exp", "--rerun", "all", "--json"], {
        timeoutMs: 36 * 60_000,
      });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const evalEvents = assertExpEvalOutcomes(
        run.expEvalEvents(),
        EXPECTED_OUTCOMES,
        () => run.diagnostic(),
      );

      // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md「结束反馈与
      // receipt」）：completion 与 runIds（每个 Experiment 一个 Run）。成败由下面带身份的
      // eval 事件精确断言，不从 receipt 猜计数。
      const inv = run.expReceipt();
      expect(inv.completion, run.diagnostic()).toBe("completed");
      expect(inv.runIds, run.diagnostic()).toHaveLength(1);
      const event = only(
        evalEvents,
        (candidate) => candidate.evalId === "coding-task/write-and-verify",
      );
      const queried = await runInspectionQuery(niceeval, {
        kind: "attempt.trace",
        locator: event.locator,
      });
      expect(queried.exitCode, queried.diagnostic()).toBe(0);
      const document = queried.attemptTrace();
      expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
      const trace = JSON.stringify(document.trace);
      expect(trace).toContain("write_file");
      expect(trace).toContain("terminal");
      expect(trace).toContain("niceeval-hermes-tool-input-914");
    },
  );
}, 38 * 60_000);
