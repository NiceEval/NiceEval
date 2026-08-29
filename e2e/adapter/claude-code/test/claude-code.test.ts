// Regression note: memory/results-schema-version-history.md#observability-family-1--2
//
// 单文件 Journey：真实 Claude Code + Docker Sandbox + live provider。
// 具体 Skill、MCP、Plugin 与配置行为由各自 Eval 断言；owner 另读一条代表 execution。
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
import { runInspectionQuery } from "./query.ts";

const EXPECTED_OUTCOMES = [
  // coding-task：文件写入、编辑与 shell 调用都须完成；单次基线 Attempt 全部断言成立才是 passed/1。
  { experimentId: "coding", evalId: "coding-task", verdict: "passed", attempts: 1, passed: 1 },
  // session-resume：原生 --resume 须带回首轮事实且两轮 usage 可用；一次会话链完成即为 passed/1。
  { experimentId: "coding", evalId: "session-resume", verdict: "passed", attempts: 1, passed: 1 },
  // WebSearch 正例：coding 开启 webResearch，必须调用 web_search 且不调用 web_fetch，因此期望 passed/1。
  { experimentId: "coding", evalId: "websearch-denied", verdict: "passed", attempts: 1, passed: 1 },
  // HITL：AskUserQuestion 的两个选项须进入结构化 request，选择 Node.js 后恢复同一会话。
  { experimentId: "hitl", evalId: "hitl-options", verdict: "passed", attempts: 1, passed: 1 },
  // HITL 反例：同一 Eval 收到普通内容且没有原生待输入请求时，必须是 failed/1。
  { experimentId: "hitl-content", evalId: "hitl-options", verdict: "failed", attempts: 1, passed: 0 },
  // skill-used：只加载目标本地 Skill，并在回答中采用其独有 marker；单次正调应为 passed/1。
  { experimentId: "skill", evalId: "skill-used", verdict: "passed", attempts: 1, passed: 1 },
  // skill-checklist：只加载 checklist Skill、不误载 marker/decoy；反选断言同时成立才是 passed/1。
  { experimentId: "skill", evalId: "skill-checklist", verdict: "passed", attempts: 1, passed: 1 },
  // skill-unused：普通对话不得加载任何已安装 Skill 或调用工具；这个反例成立时仍是 passed/1。
  { experimentId: "skill", evalId: "skill-unused", verdict: "passed", attempts: 1, passed: 1 },
  // repo-skill：钉定 Git 来源的 Skill 必须安装、原生加载并影响输出；一次完整验证期望 passed/1。
  { experimentId: "repo-skill", evalId: "repo-skill", verdict: "passed", attempts: 1, passed: 1 },
  // mcp-tools：stdio 与 Streamable HTTP 两个 MCP 工具都须以正确入参完成；因此期望 passed/1。
  { experimentId: "mcp", evalId: "mcp-tools", verdict: "passed", attempts: 1, passed: 1 },
  // plugin-mcp：官方 Context7 Plugin 的远程 MCP 必须接线并成功调用；单次安装路径期望 passed/1。
  { experimentId: "plugin", evalId: "plugin-mcp", verdict: "passed", attempts: 1, passed: 1 },
  // plugin-reuse：四个 Sandbox 承接两波共八次复用，八次都须调用 Context7 成功，所以是 passed/8。
  { experimentId: "plugin-reuse", evalId: "plugin-mcp", verdict: "passed", attempts: 8, passed: 8 },
  // remote-plugin：远程 marketplace 文件须安装，随 Plugin 的 Skill 须被加载并完成请求；期望 passed/1。
  { experimentId: "remote-plugin", evalId: "remote-plugin", verdict: "passed", attempts: 1, passed: 1 },
  // WebSearch 反例：locked-down settings 禁止 WebSearch/WebFetch，零调用才通过，因此期望 passed/1。
  { experimentId: "locked-down", evalId: "websearch-denied", verdict: "passed", attempts: 1, passed: 1 },
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

function representativeAttempt(): ExpEvalEvent {
  return only(
    evalEvents,
    (event) => event.evalId === "coding-task",
    () => run.diagnostic(),
  );
}

beforeAll(async () => {
  rmSync(".niceeval", { recursive: true, force: true });

  run = await niceeval.run(
    ["exp", "--rerun", "all", "--json"],
    { timeoutMs: 50 * 60_000 },
  );
  const inv = run.expReceipt();
  const firstEvents = run.expEvalEvents();
  // plugin-reuse 是八条 Attempt 的 Sandbox 复用 owner，不能用二次运行替换它的首次并发结果。
  // 其余 live provider 任务只对模型断言失败补跑一次；setup、timeout、I/O error 与
  // skipped 都是基础设施/生命周期故障，不能用后续绿色覆盖。
  const retryableFailed = firstEvents.filter(
    (event) =>
      event.verdict === "failed" &&
      event.experimentId !== "plugin-reuse" &&
      !(event.experimentId === "hitl-content" && event.evalId === "hitl-options"),
  );
  expect(
    firstEvents.filter(
      (event) => event.verdict === "errored" || event.verdict === "skipped",
    ),
    run.diagnostic(),
  ).toHaveLength(0);
  expect(run.exitCode, run.diagnostic()).toBe(
    firstEvents.some((event) => event.verdict === "failed") ? 1 : 0,
  );
  expect(inv.completion, run.diagnostic()).toBe("completed");
  for (const event of retryableFailed) assertExactRetryEvalSelector(firstEvents, event);

  // 补跑 Invocation 继续写同一个保留证据的 Record；Record 是单写者，所以同 Repo
  // 必须串行。主 Invocation 内的 Attempt 并发和跨 Repo batch 并发不受影响。
  const retried = await retryFailedExpEvalsOnce({
    events: firstEvents,
    targets: retryableFailed,
    runRetry: (event) =>
      niceeval.run(
        ["exp", event.experimentId, event.evalId, "--rerun", "all", "--json"],
        { timeoutMs: 50 * 60_000 },
      ),
  });
  if (retried.retries.length > 0) {
    process.stderr.write(
      `[niceeval e2e] retried ${retried.retries.length} assertion-failed Eval(s) once; first Invocation ${inv.invocationId} remains recorded\n`,
    );
  }
  evalEvents = retried.events;
}, 53 * 60_000);

it("真实 Claude Code adapter 的全部专用 Eval 得到预期 verdict [necase_03VC48FN8K5730J0]", () => {
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md「结束反馈与
  // receipt」）；成败与发现完整性由下面带身份的 eval 事件精确断言。
  const inv = run.expReceipt();
  expect(inv.completion, run.diagnostic()).toBe("completed");
  assertExpEvalOutcomes(evalEvents, EXPECTED_OUTCOMES, () => run.diagnostic());
});

it("attempt.trace 读回 Claude Code 的代表性工具证据 [necase_SD0VYFPKPV859TGT]", async () => {
  const attempt = representativeAttempt();
  const queried = await runInspectionQuery(niceeval, {
    kind: "attempt.trace",
    locator: attempt.locator,
  });
  expect(queried.exitCode, queried.diagnostic()).toBe(0);
  const document = queried.attemptTrace();
  expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
  const trace = JSON.stringify(document.trace);
  expect(trace).toContain("notes.txt");
  expect(trace).toContain("niceeval-e2e-marker-alpha-926");
});
