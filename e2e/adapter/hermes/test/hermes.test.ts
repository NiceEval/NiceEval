// owner: docs/engineering/testing/e2e/adapter/hermes.md#adapter-hermes-live-compatibility
//
// 单文件 Journey：真实 Hermes CLI + Docker Sandbox + live provider，
// 同一次真实运行分别供 verdict、execution 与 timing 三个独立命题读取。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import {
  createE2EContext,
  only,
  type ExpEvalEvent,
  type ExpEvent,
} from "@niceeval/testkit";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

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

it("真实 Hermes CLI adapter 完成运行并公开读回工具与 timing 证据", async () => {
  requireLiveSecrets();
  await e2e.case(
    "live",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      // invoke：完整 argv 走安装后的 candidate binary；Docker capability 已由
      // e2e.json 的 requires.docker 在 root runner preflight 统一证明。
      const run = await niceeval.run(["exp", "--rerun", "all", "--json"], {
        timeoutMs: 36 * 60_000,
      });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const evalEvents = run
        .ndjson<ExpEvent>()
        .filter((event): event is ExpEvalEvent => "event" in event && event.event === "eval");

      // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md「结束反馈与
      // receipt」）：completion 与 runIds（每个 Experiment 一个 Run）。成败由下面带身份的
      // eval 事件精确断言，不从 receipt 猜计数。
      const inv = run.expReceipt();
      expect(inv.completion, run.diagnostic()).toBe("completed");
      expect(inv.runIds, run.diagnostic()).toHaveLength(1);
      expect(
        evalEvents.filter((event) => event.verdict === "passed"),
        run.diagnostic(),
      ).toHaveLength(EXPECTED_EVALS.length);
      expect(
        evalEvents.filter((event) => event.verdict !== "passed"),
        run.diagnostic(),
      ).toHaveLength(0);

      const event = only(
        evalEvents,
        (candidate) => candidate.evalId === "coding-task/write-and-verify",
      );
      const timing = await niceeval.run(["show", event.locator!, "--timing"]);
      expect(timing.exitCode, timing.diagnostic()).toBe(0);
      expect(timing.stdout).toMatch(/turn\s+turn1\b/);

      const execution = await niceeval.run(["show", event.locator!, "--execution"]);
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      expect(execution.stdout).toContain("niceeval-hermes-tool-input-914");
      expect(execution.stdout).toContain("timing unavailable");
    },
  );
}, 38 * 60_000);
