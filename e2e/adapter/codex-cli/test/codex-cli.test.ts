// owner: docs/engineering/testing/e2e/adapter/codex-cli.md#adapter-codex-cli-live-compatibility
//
// 单文件 Journey：真实 Codex CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt 与 execution。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import {
  assertExpEvalOutcomes,
  command,
  only,
  retryFailedExpEvalsOnce,
  type ExpEvalEvent,
  type ExpEvalOutcomeExpectation,
  type ProcessReceipt,
} from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import {
  inspectionRecords,
  runInspectionQuery,
} from "./query.ts";

// 每条 Eval 的首轮只有一个 Attempt；只有结构化 verdict=failed 才由本测试另起一次 Invocation。
const EXPECTED_OUTCOMES = [
  // coding-task：既有文件修改与 shell 调用都须归一并配对完成；最终单次 Attempt 期望 passed/1。
  { experimentId: "baseline", evalId: "coding-task", verdict: "passed", attempts: 1, passed: 1 },
  // configfile 正例：shell-enabled 配置下同一 prompt 必须调用 shell；分支成立时为 passed/1。
  { experimentId: "baseline", evalId: "configfile", verdict: "passed", attempts: 1, passed: 1 },
  // session：首轮 thread ID 须捕获，第二轮在同一 thread 上须回忆事实；一条会话链期望 passed/1。
  { experimentId: "baseline", evalId: "session", verdict: "passed", attempts: 1, passed: 1 },
  // usage：每轮 token usage 非空，且 session 侧写中的实际模型正确；一次验证期望 passed/1。
  { experimentId: "baseline", evalId: "usage", verdict: "passed", attempts: 1, passed: 1 },
  // HITL：原生问题的两个选项须进入结构化 request，选择 Node.js 后恢复同一会话。
  { experimentId: "hitl", evalId: "hitl-options", verdict: "passed", attempts: 1, passed: 1 },
  // HITL 反例：同一 Eval 收到普通内容且没有原生待输入请求时，必须是 failed/1。
  { experimentId: "hitl-content", evalId: "hitl-options", verdict: "failed", attempts: 1, passed: 0 },
  // configfile 反例：shell-disabled 配置下同一 prompt 不得调用 shell；零调用成立时为 passed/1。
  { experimentId: "configfile", evalId: "configfile", verdict: "passed", attempts: 1, passed: 1 },
  // mcp：stdio 求和与远程 DeepWiki 两种 MCP 调用都须出现且入参正确；期望 passed/1。
  { experimentId: "mcp", evalId: "mcp", verdict: "passed", attempts: 1, passed: 1 },
  // status-report：目标 Skill 须被读取并影响文件内容，且不能伪造 skill.loaded；期望 passed/1。
  { experimentId: "skill", evalId: "status-report", verdict: "passed", attempts: 1, passed: 1 },
  // skill-release-note：只读取 release-note Skill、不误读 status/decoy，并采用其约定；期望 passed/1。
  { experimentId: "skill", evalId: "skill-release-note", verdict: "passed", attempts: 1, passed: 1 },
  // repo-skill：钉定 Git 来源的 Skill 须安装、读取并影响产出；一次完整验证期望 passed/1。
  { experimentId: "repo-skill", evalId: "repo-skill", verdict: "passed", attempts: 1, passed: 1 },
  // plugin-hook：Plugin 安装痕迹与 SessionStart hook 侧写证据都须存在；单次安装路径期望 passed/1。
  { experimentId: "plugin", evalId: "plugin-hook", verdict: "passed", attempts: 1, passed: 1 },
  // plugin-reuse：四个 Sandbox 的两波共八次复用都须清理冲突残留并重装成功，所以期望 passed/8。
  { experimentId: "plugin-reuse", evalId: "plugin-hook", verdict: "passed", attempts: 8, passed: 8 },
] as const satisfies readonly ExpEvalOutcomeExpectation[];

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
let run!: ProcessReceipt;
let evalEvents!: readonly ExpEvalEvent[];

function assertExactRetryEvalSelector(events: readonly ExpEvalEvent[], failed: ExpEvalEvent): void {
  // Experiment selectors prefer an exact ID before considering path-prefix
  // families. Eval selectors intentionally use bare prefixes, so only the
  // Eval selector needs a preflight ambiguity check before spending a retry.
  const evals = events
    .filter(
      (event) =>
        event.experimentId === failed.experimentId && event.evalId.startsWith(failed.evalId),
    )
    .map((event) => event.evalId);
  expect(evals, `ambiguous Eval retry selector ${failed.experimentId}/${failed.evalId}`).toEqual([
    failed.evalId,
  ]);
}

beforeAll(async () => {
  rmSync(".niceeval", { recursive: true, force: true });

  // invoke：完整 argv 走安装后的 candidate binary；真实 Codex CLI、Docker sandbox
  // 与 live provider 仍由 experiments/* + evals/ 驱动。
  run = await niceeval.run(["exp", "--rerun", "all", "--json"], {
    timeoutMs: 44 * 60_000,
  });
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md「结束反馈与
  // receipt」）；成败与发现完整性由下面带身份的 eval 事件精确断言。
  const inv = run.expReceipt();
  expect(inv.completion, run.diagnostic()).toBe("completed");
  // eval 事件是中间的身份事件：identity / verdict / attempts 在此精确断言。
  const firstEvents = run.expEvalEvents();
  // plugin-reuse 是八条 Attempt 的 Sandbox 复用 owner，不是模型断言重试消费者。
  const retryableFailed = firstEvents.filter(
    (event) =>
      event.verdict === "failed" &&
      event.experimentId !== "plugin-reuse" &&
      !(event.experimentId === "hitl-content" && event.evalId === "hitl-options"),
  );
  expect(
    firstEvents.filter((event) => event.verdict === "errored" || event.verdict === "skipped"),
    run.diagnostic(),
  ).toHaveLength(0);
  expect(run.exitCode, run.diagnostic()).toBe(
    firstEvents.some((event) => event.verdict === "failed") ? 1 : 0,
  );
  for (const event of retryableFailed) assertExactRetryEvalSelector(firstEvents, event);

  // 这些 Invocation 继续写同一个保留证据的 Record；Record 是单写者，多个 CLI 进程
  // 重叠会确定性触发 RecordWriterBusy。主 Invocation 内的 Attempt 并发不受影响。
  const retried = await retryFailedExpEvalsOnce({
    events: firstEvents,
    targets: retryableFailed,
    runRetry: (event) =>
      niceeval.run(
        ["exp", event.experimentId, event.evalId, "--rerun", "all", "--json"],
        { timeoutMs: 44 * 60_000 },
      ),
  });
  if (retried.retries.length > 0) {
    process.stderr.write(
      `[niceeval e2e] retried ${retried.retries.length} assertion-failed Eval(s) once; first Invocation ${inv.invocationId} remains recorded\n`,
    );
  }
  evalEvents = retried.events;
}, 48 * 60_000);

it("真实 Codex CLI adapter 的全部专用 Eval 得到预期 verdict", () => {
  expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
  assertExpEvalOutcomes(evalEvents, EXPECTED_OUTCOMES, () => run.diagnostic());
});

function locatorFor(evalId: string): string {
  return only(
    evalEvents,
    (event) => event.evalId === evalId,
    () => run.diagnostic(),
  ).locator;
}

it("attempt.trace 读回 Codex CLI 的代表性工具证据", async () => {
  const codingTaskLocator = locatorFor("coding-task");

  // outcome：trace 是适配器收到的公开投影。工具身份保留原始未归一化名
  //（command_execution / file_change），canonical 名 shell / file_edit 也可能出现；
  // 工具身份、入参和完成结果必须穿过归一化、持久化与机器读回。
  const queried = await runInspectionQuery(niceeval, {
    kind: "attempt.trace",
    locator: codingTaskLocator,
  });
  expect(queried.exitCode, queried.diagnostic()).toBe(0);
  const document = queried.attemptTrace();
  expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
  const trace = JSON.stringify(document.trace);
  expect(
    trace.includes("file_edit") || trace.includes("file_change"),
    "attempt trace missing file_edit/file_change",
  ).toBe(true);
  expect(
    trace.includes("shell") || trace.includes("command_execution"),
    "attempt trace missing shell/command_execution",
  ).toBe(true);
  expect(trace).toContain("niceeval-e2e-run-914");

  const resultRecords = inspectionRecords(document.trace).filter((record) =>
    record.kind === "tool-result"
  );
  const markerResult = resultRecords.find((record) =>
    typeof record.output === "string" && record.output.includes("niceeval-e2e-run-914")
  );
  expect(markerResult).toMatchObject({
    kind: "tool-result",
    outcome: "completed",
    output: expect.stringContaining("niceeval-e2e-run-914"),
  });
});
