// owner: docs/engineering/testing/e2e/adapter/claude-code.md#adapter-claude-code-live-compatibility
//
// 单文件 Journey：真实 Claude Code + Docker Sandbox + live provider。
// 具体 Skill、MCP、Plugin 与配置行为由各自 Eval 断言；owner 只守住发现完整性与全绿结果。
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
  // coding-task：文件写入、编辑与 shell 调用都须完成；单次基线 Attempt 全部断言成立才是 passed/1。
  { experimentId: "coding", evalId: "coding-task", verdict: "passed", attempts: 1, passed: 1 },
  // session-resume：原生 --resume 须带回首轮事实且两轮 usage 可用；一次会话链完成即为 passed/1。
  { experimentId: "coding", evalId: "session-resume", verdict: "passed", attempts: 1, passed: 1 },
  // WebSearch 正例：coding 开启 webResearch，必须调用 web_search 且不调用 web_fetch，因此期望 passed/1。
  { experimentId: "coding", evalId: "websearch-denied", verdict: "passed", attempts: 1, passed: 1 },
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

const EXPECTED_EXPERIMENT_COUNT = new Set(
  EXPECTED_OUTCOMES.map((outcome) => outcome.experimentId),
).size;

const REQUIRED_LIVE_SECRETS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"] as const;

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
let run!: ProcessReceipt;
let evalEvents!: ExpEvalEvent[];

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live claude-code E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the claude-code sandbox",
    );
  }
}

function evalKey(event: Pick<ExpEvalEvent, "experimentId" | "evalId">): string {
  return `${event.experimentId}\u0000${event.evalId}`;
}

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
  requireLiveSecrets();
  await requireDocker();

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
  const failed = firstEvents.filter(
    (event) => event.verdict === "failed" && event.experimentId !== "plugin-reuse",
  );
  expect(
    firstEvents.filter(
      (event) => event.verdict === "errored" || event.verdict === "skipped",
    ),
    run.diagnostic(),
  ).toHaveLength(0);
  expect(run.exitCode, run.diagnostic()).toBe(failed.length > 0 ? 1 : 0);
  expect(inv.completion, run.diagnostic()).toBe("completed");
  for (const event of failed) assertExactRetryEvalSelector(firstEvents, event);

  // 补跑 Invocation 继续写同一个保留证据的 Record；Record 是单写者，所以同 Repo
  // 必须串行。主 Invocation 内的 Attempt 并发和跨 Repo batch 并发不受影响。
  const retryRuns: ProcessReceipt[] = [];
  for (const event of failed) {
    retryRuns.push(
      await niceeval.run(
        ["exp", event.experimentId, event.evalId, "--rerun", "all", "--json"],
        { timeoutMs: 50 * 60_000 },
      ),
    );
  }
  const retriedByEval = new Map<string, ExpEvalEvent>();
  for (let index = 0; index < retryRuns.length; index += 1) {
    const retry = retryRuns[index]!;
    const target = failed[index]!;
    expect(retry.expReceipt(), retry.diagnostic()).toMatchObject({ completion: "completed" });
    const events = retry.expEvalEvents();
    expect(events, retry.diagnostic()).toHaveLength(1);
    expect(events[0], retry.diagnostic()).toMatchObject({
      experimentId: target.experimentId,
      evalId: target.evalId,
    });
    expect(events[0]?.verdict, retry.diagnostic()).toBe("passed");
    expect(retry.exitCode, retry.diagnostic()).toBe(0);
    retriedByEval.set(evalKey(target), events[0]!);
  }
  if (failed.length > 0) {
    process.stderr.write(
      `[niceeval e2e] retried ${failed.length} assertion-failed Eval(s) once; first Invocation ${inv.invocationId} remains recorded\n`,
    );
  }
  evalEvents = firstEvents.map((event) => retriedByEval.get(evalKey(event)) ?? event);
}, 104 * 60_000);

it("真实 Claude Code adapter 的全部专用 Eval 通过", () => {
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md「结束反馈与
  // receipt」）：completion 与 runIds（每个 Experiment 一个 Run）；成败由下面带身份的
  // eval 事件精确断言，不从 receipt 猜计数。
  const inv = run.expReceipt();
  expect(inv.completion, run.diagnostic()).toBe("completed");
  expect(inv.runIds, run.diagnostic()).toHaveLength(EXPECTED_EXPERIMENT_COUNT);
  assertExpEvalOutcomes(evalEvents, EXPECTED_OUTCOMES, () => run.diagnostic());
});

it("show --execution 读回 Claude Code 的代表性工具证据", async () => {
  const attempt = representativeAttempt();
  const execution = await niceeval.run(["show", attempt.locator!, "--execution"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("notes.txt");
  expect(execution.stdout).toContain("niceeval-e2e-marker-alpha-926");
});

it("show --timing 读回 Claude Code 的 runner 阶段", async () => {
  const attempt = representativeAttempt();
  const timing = await niceeval.run(["show", attempt.locator!, "--timing"]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout, timing.diagnostic()).toContain("eval.run");
  expect(timing.stdout, timing.diagnostic()).toContain("agent.setup");
  expect(timing.stdout, timing.diagnostic()).toMatch(/turn\s+turn1\b/);
});
