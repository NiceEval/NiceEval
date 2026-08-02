// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「形态解析与 --json 流不变量」
//
// `computeExitCode` 是 CompletionStatus 驱动退出码折叠的纯函数,直接单测。`renderJsonPlanDocument`
// 只需证明「单个 JSON 文档,不是 NDJSON 流」这条结构性不变量。json renderer 写出的逐事件字段、
// 心跳节奏、`--json` 不做 suppression 这些流不变量由 coordinator/reducer 驱动的事件序列断言
// (见 coordinator.test.ts/reducer.test.ts);具体字节级渲染由
// docs/engineering/testing/e2e/cli.md「反馈输出格式」在真实进程输出上验收。

import { describe, expect, it } from "vitest";
import { computeExitCode, createJsonRenderer, renderJsonPlanDocument, type ExpEvent } from "./json.ts";
import { createInitialRunFeedbackState, reduceRunFeedback } from "./reducer.ts";
import { createFakeFeedbackIO } from "./testing.ts";
import {
  HALT_DIAGNOSTIC_CODE,
  type DurableFeedbackEvent,
  type EvalResult,
  type InvocationCompletion,
  type InvocationSummary,
} from "../types.ts";
import { encodeAttemptLocator } from "../../record/locator.ts";
import { completeEvidenceCoverage } from "../../assertions/coverage.ts";

function expEventCompileTimeContract(): void {
  ({
    event: "failure",
    locator: "@example",
    evalId: "memory/a",
    experimentId: "compare/codex",
    severity: "gate",
    assertion: "works",
  }) satisfies ExpEvent;

  // @ts-expect-error failure 的 experimentId 是机器事件主身份，不得省略。
  ({ event: "failure", locator: "@example", evalId: "memory/a", severity: "gate", assertion: "works" }) satisfies ExpEvent;
  // @ts-expect-error 文档未采纳 run_activity，它不是 ExpEvent 成员。
  ({ event: "run_activity", id: "build-1", key: "build.image", label: "build", status: "done" }) satisfies ExpEvent;
  // @ts-expect-error ResultEvent 的权威路径字段是 snapshots，不是旧 runs。
  ({ event: "result", status: "passed", passed: 1, failed: 0, errored: 0, completion: "complete", runs: [] }) satisfies ExpEvent;
}

void expEventCompileTimeContract;

function summary(overrides: Partial<InvocationSummary> = {}): InvocationSummary {
  return {
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:03:21.000Z",
    passed: 1,
    failed: 0,
    skipped: 0,
    errored: 0,
    durationMs: 60_000,
    results: [],
    ...overrides,
  };
}

function completion(overrides: Partial<InvocationCompletion> = {}): InvocationCompletion {
  return { status: "complete", unstarted: 0, earlyExitUnstarted: 0, reporterErrors: [], ...overrides };
}

describe("computeExitCode:CompletionStatus 驱动退出码,不只看 failed/errored", () => {
  it("全部通过、complete → 0", () => {
    expect(computeExitCode(summary({ passed: 5, failed: 0, errored: 0 }), completion())).toBe(0);
  });

  it("有 failed → 1", () => {
    expect(computeExitCode(summary({ passed: 4, failed: 1 }), completion())).toBe(1);
  });

  it("有 errored → 1", () => {
    expect(computeExitCode(summary({ passed: 4, errored: 1 }), completion())).toBe(1);
  });

  it("budget 耗尽导致 unstarted、completion.status=incomplete → 1,即便全部已跑的都通过", () => {
    expect(
      computeExitCode(summary({ passed: 36, failed: 0, errored: 0 }), completion({ status: "incomplete", unstarted: 4 })),
    ).toBe(1);
  });

  it("用户/平台中断、completion.status=interrupted → 130", () => {
    expect(computeExitCode(summary({ passed: 3, failed: 0, errored: 0 }), completion({ status: "interrupted" }))).toBe(130);
  });

  it("required reporter 失败 → 1,即便全部 attempt 都通过", () => {
    expect(
      computeExitCode(
        summary({ passed: 10, failed: 0, errored: 0 }),
        completion({ reporterErrors: [{ reporter: "artifacts", required: true, message: "EACCES" }] }),
      ),
    ).toBe(1);
  });

  it("best-effort(非 required)reporter 失败不强制非零", () => {
    expect(
      computeExitCode(
        summary({ passed: 10, failed: 0, errored: 0 }),
        completion({ reporterErrors: [{ reporter: "custom", required: false, message: "network blip" }] }),
      ),
    ).toBe(0);
  });

  it("首过即停省略的 earlyExitUnstarted 不影响退出码(不是 budget 的 unstarted)", () => {
    expect(
      computeExitCode(summary({ passed: 10, failed: 0, errored: 0 }), completion({ earlyExitUnstarted: 6, unstarted: 0 })),
    ).toBe(0);
  });
});

/** 依次喂进 reducer 再交给 json renderer(与生产的 coordinator 同序:先 reduce 后 render),
 *  返回逐行解析出的事件对象。 */
function emitDurable(events: readonly DurableFeedbackEvent[]): ExpEvent[] {
  const { io, stdout } = createFakeFeedbackIO();
  const renderer = createJsonRenderer({ io });
  let state = createInitialRunFeedbackState();
  for (const event of events) {
    state = reduceRunFeedback(state, event);
    renderer.appendDurable(event, state);
  }
  return stdout.writes
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line): ExpEvent => JSON.parse(line));
}

describe("warning 事件:code 是稳定词法,折叠身份走具名字段", () => {
  it("code 用 DiagnosticInput.code 的干净字面量,不透传编了身份的去重 key", () => {
    const [warning] = emitDurable([
      {
        type: "diagnostic",
        at: 1,
        key: "lock-taken-over:compare/codex|memory/retention",
        code: "lock-taken-over",
        severity: "warning",
        message: "took over a stale lock",
        data: { experimentId: "compare/codex", evalId: "memory/retention" },
      },
    ]);
    expect(warning).toMatchObject({
      event: "warning",
      code: "lock-taken-over",
      level: "warning",
      experimentId: "compare/codex",
      evalId: "memory/retention",
    });
  });

  it("没给 code 的诊断回落到 key(折叠身份本就不进 key 的那些天生是干净字面量)", () => {
    const [warning] = emitDurable([
      { type: "diagnostic", at: 1, key: "memory-warmup-degraded", severity: "warning", message: "cold index" },
    ]);
    expect(warning).toMatchObject({ code: "memory-warmup-degraded" });
    expect(warning).not.toHaveProperty("experimentId");
    expect(warning).not.toHaveProperty("evalId");
  });

  it("eval 闸的 dispatch-halted:code 干净、evalId 与 phase 都在事件流里透得出", () => {
    const [warning] = emitDurable([
      {
        type: "diagnostic",
        at: 1,
        key: "dispatch-halted:eval:compare/codex|memory/retention",
        code: HALT_DIAGNOSTIC_CODE,
        severity: "error",
        message: "eval halted: fixture db is empty; run scripts/seed.ts",
        data: {
          experimentId: "compare/codex",
          scope: "eval",
          evalId: "memory/retention",
          phase: "eval.run",
          unstarted: 0,
        },
      },
    ]);
    expect(warning).toMatchObject({
      event: "warning",
      code: "dispatch-halted",
      level: "error",
      phase: "eval.run",
      experimentId: "compare/codex",
      evalId: "memory/retention",
    });
  });

  it("身份从 data 取(闸不是 attempt 级、不伪造 identity);有 identity 时 identity 优先", () => {
    const [fromIdentity] = emitDurable([
      {
        type: "diagnostic",
        at: 1,
        key: "fail-fast:x",
        code: "fail-fast",
        severity: "warning",
        message: "deterministic failure",
        identity: { experimentId: "compare/codex", evalId: "memory/a", attempt: 0 },
        data: { experimentId: "other/exp", evalId: "memory/z" },
      },
    ]);
    expect(fromIdentity).toMatchObject({ experimentId: "compare/codex", evalId: "memory/a" });
  });

  it("同一 dedupeKey 只追加一次:emitter 为刷新 data.unstarted 反复报同一条闸,事件流不重复", () => {
    const halted = (at: number, unstarted: number): DurableFeedbackEvent => ({
      type: "diagnostic",
      at,
      key: "dispatch-halted:experiment:compare/codex",
      code: HALT_DIAGNOSTIC_CODE,
      severity: "error",
      message: "experiment halted (dispatch-halted): shared service is down",
      data: { experimentId: "compare/codex", scope: "experiment", phase: "eval.run", unstarted },
    });
    const events = emitDurable([halted(1, 0), halted(2, 1), halted(3, 2)]);
    expect(events.filter((e) => e.event === "warning")).toHaveLength(1);
  });
});

describe("ExpEvent 的 attempt 身份与结果路径", () => {
  it("failure / error 都强制写出 locator、evalId 与 experimentId", () => {
    const failedLocator = encodeAttemptLocator({ runId: "run-feedback", evalId: "memory/fail", attempt: 0 });
    const errorLocator = encodeAttemptLocator({ runId: "run-feedback", evalId: "memory/error", attempt: 1 });
    const events = emitDurable([
      {
        type: "failure",
        at: 1,
        locator: failedLocator,
        identity: { experimentId: "compare/codex", evalId: "memory/fail", attempt: 0 },
        who: "compare/codex",
        verdict: "failed",
        reason: "gate failed",
        assertion: { severity: "gate", assertion: "tests pass", additionalFailures: 0 },
      },
      {
        type: "failure",
        at: 2,
        locator: errorLocator,
        identity: { experimentId: "compare/codex", evalId: "memory/error", attempt: 1 },
        who: "compare/codex",
        verdict: "errored",
        reason: "sandbox failed",
        phase: "sandbox.create",
      },
    ]);

    expect(events).toEqual([
      {
        event: "failure",
        locator: failedLocator,
        evalId: "memory/fail",
        experimentId: "compare/codex",
        severity: "gate",
        assertion: "tests pass",
      },
      {
        event: "error",
        locator: errorLocator,
        evalId: "memory/error",
        experimentId: "compare/codex",
        phase: "sandbox.create",
        reason: "sandbox failed",
      },
    ]);
  });

  it("缺少 experimentId 时拒绝产生不完整的 failure 事件", () => {
    const locator = encodeAttemptLocator({ runId: "run-feedback", evalId: "memory/bare", attempt: 0 });
    expect(() => emitDurable([{
      type: "failure",
      at: 1,
      locator,
      identity: { evalId: "memory/bare", attempt: 0 },
      who: "codex",
      verdict: "failed",
      reason: "failed",
    }])).toThrow("missing experimentId");
  });

  it("eval 使用同一组必填身份，result 只输出 snapshots", () => {
    const locator = encodeAttemptLocator({ runId: "run-feedback", evalId: "memory/pass", attempt: 0 });
    const result: EvalResult = {
      id: "memory/pass",
      experimentId: "compare/codex",
      agent: "codex",
      verdict: "passed",
      attempt: 0,
      locator,
      durationMs: 1_000,
      assertions: [],
      evidenceCoverage: completeEvidenceCoverage,
    };
    const events = emitDurable([
      {
        type: "plan",
        at: 0,
        plan: {
          shape: { evals: 1, configs: 1, totalAttempts: 1, maxConcurrency: 1 },
          reused: 0,
          reusedFailures: [],
        },
      },
      { type: "summary", at: 1, summary: summary({ results: [result] }), completion: completion() },
      { type: "saved", at: 2, paths: [".niceeval/compare/codex/run-feedback"] },
    ]);

    expect(events[1]).toEqual({
      event: "eval",
      locator,
      evalId: "memory/pass",
      experimentId: "compare/codex",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    });
    expect(events[2]).toEqual({
      event: "result",
      status: "passed",
      passed: 1,
      failed: 0,
      errored: 0,
      completion: "complete",
      snapshots: [".niceeval/compare/codex/run-feedback"],
    });
    expect(events[2]).not.toHaveProperty("runs");
  });
});

describe("renderJsonPlanDocument:单个 ExpPlanDocument,不是事件流", () => {
  it("输出恰好一行 JSON,可解析为单个对象而不是逐行事件序列", () => {
    const text = renderJsonPlanDocument({
      total: 4,
      evals: 1,
      configs: 4,
      attempts: 1,
      matrix: [
        { experimentId: "compare/bub-e2b", evalId: "memory/commit0-cachetool", reused: false },
        { experimentId: "compare/codex", evalId: "memory/commit0-cachetool", reused: true },
      ],
    });
    const lines = text.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const doc = JSON.parse(lines[0]!);
    expect(doc.format).toBe("niceeval.exp-plan");
    expect(typeof doc.schemaVersion).toBe("number");
    expect(doc.total).toBe(4);
    expect(doc.evals).toBe(1);
    expect(doc.configs).toBe(4);
    expect(doc.attempts).toBe(1);
    expect(doc.matrix).toHaveLength(2);
  });

  it("locked 为 true 的行原样透传;省略的行不出现 locked 字段(JSON.stringify 丢弃 undefined 属性)", () => {
    const text = renderJsonPlanDocument({
      total: 2,
      evals: 2,
      configs: 1,
      attempts: 1,
      matrix: [
        { experimentId: "compare/codex", evalId: "memory/a", reused: false, locked: true },
        { experimentId: "compare/codex", evalId: "memory/b", reused: false },
      ],
    });
    const doc = JSON.parse(text);
    expect(doc.matrix[0]).toMatchObject({ evalId: "memory/a", locked: true });
    expect(doc.matrix[1]).not.toHaveProperty("locked");
  });

  it("dispatch 逐组给出 gate 与 attempt 序号,指纹门带 deltas;全携带的行不出现该字段", () => {
    const text = renderJsonPlanDocument({
      total: 4,
      evals: 2,
      configs: 1,
      attempts: 2,
      matrix: [
        {
          experimentId: "compare/codex",
          evalId: "memory/a",
          reused: false,
          dispatch: [
            {
              gate: "fingerprint",
              attempts: [0],
              deltas: [{ selector: "config:judge.model", kind: "changed", from: "gpt-5.6", to: "gpt-5.6-sol" }],
            },
            { gate: "missing", attempts: [1] },
          ],
        },
        { experimentId: "compare/codex", evalId: "memory/b", reused: true },
      ],
    });
    const doc = JSON.parse(text.trim());
    expect(doc.matrix[0].dispatch).toEqual([
      {
        gate: "fingerprint",
        attempts: [0],
        deltas: [{ selector: "config:judge.model", kind: "changed", from: "gpt-5.6", to: "gpt-5.6-sol" }],
      },
      { gate: "missing", attempts: [1] },
    ]);
    expect(doc.matrix[1]).not.toHaveProperty("dispatch");
  });

  it("carry-disabled dispatch 结构化保留 linked blocker 的 code/reason", () => {
    const doc = JSON.parse(renderJsonPlanDocument({
      total: 1,
      evals: 1,
      configs: 1,
      attempts: 1,
      matrix: [{
        experimentId: "compare/codex",
        evalId: "opaque",
        reused: false,
        dispatch: [{
          gate: "eligibility",
          attempts: [0],
          blockers: [
            { code: "sandbox.command-opaque", reason: "wrap it with defineSandboxCommand({ id, revision, inputs }, run)." },
            { code: "sandbox.lifecycle-opaque", reason: "Sandbox lifecycle hooks are opaque callbacks; cross-Run carry is disabled." },
          ],
        }],
      }],
    }));

    expect(doc.matrix[0].dispatch).toEqual([{
      gate: "eligibility",
      attempts: [0],
      blockers: [
        { code: "sandbox.command-opaque", reason: "wrap it with defineSandboxCommand({ id, revision, inputs }, run)." },
        { code: "sandbox.lifecycle-opaque", reason: "Sandbox lifecycle hooks are opaque callbacks; cross-Run carry is disabled." },
      ],
    }]);
    expect(JSON.stringify(doc)).not.toContain("details unavailable");
  });

  it("prior 暴露历史 verdict 与是否可接受，差异保留方向", () => {
    const doc = JSON.parse(renderJsonPlanDocument({
      total: 1,
      evals: 1,
      configs: 1,
      attempts: 1,
      matrix: [{
        experimentId: "compare/codex",
        evalId: "legacy",
        reused: false,
        prior: [{ locator: "@1rtu4f1f", verdict: "passed", acceptance: "legacy-locator" }],
        dispatch: [{
          gate: "fingerprint",
          attempts: [0],
          deltas: [{ selector: "config:state", kind: "removed", from: '{"_tag":"Stateless"}' }],
        }],
      }],
    }));

    expect(doc.matrix[0]).toMatchObject({
      prior: [{ locator: "@1rtu4f1f", verdict: "passed", acceptance: "legacy-locator" }],
      dispatch: [{
        deltas: [{ selector: "config:state", kind: "removed", from: '{"_tag":"Stateless"}' }],
      }],
    });
  });

  it("reused 是 matrix 逐行 reused 之和(命中数量,不是 attempt 数)", () => {
    const text = renderJsonPlanDocument({
      total: 3,
      evals: 3,
      configs: 1,
      attempts: 1,
      matrix: [
        { experimentId: "e", evalId: "a", reused: true },
        { experimentId: "e", evalId: "b", reused: true },
        { experimentId: "e", evalId: "c", reused: false },
      ],
    });
    const doc = JSON.parse(text.trim());
    expect(doc.reused).toBe(2);
  });

  it("零命中缓存时 reused 为 0", () => {
    const text = renderJsonPlanDocument({
      total: 1,
      evals: 1,
      configs: 1,
      attempts: 1,
      matrix: [{ experimentId: "e", evalId: "a", reused: false }],
    });
    expect(JSON.parse(text.trim()).reused).toBe(0);
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「PLAN 的实验并发附注」
// 契约见 docs/feature/experiments/cli.md 的 StartEvent:实验闸让声明了 maxConcurrency 的实验
// 有效宽度小于全局值,只报全局值会被读成「这批要开 N 路」;未声明的实验不出现,一个都没声明
// 时省略整个字段(消费方因此不必区分「空对象」和「没有实验闸」两种含义)。
describe("start 事件的 experimentConcurrency:只收声明了实验闸的实验", () => {
  it("有实验声明 maxConcurrency 时逐个给出上限,未声明的实验不出现", () => {
    const [start] = emitDurable([
      {
        type: "plan",
        at: 0,
        plan: {
          shape: { evals: 9, configs: 3, totalAttempts: 45, maxConcurrency: 19 },
          experimentConcurrency: { mempal: 1, nowledge: 4 },
          reused: 0,
          reusedFailures: [],
        },
      },
    ]);
    expect(start).toMatchObject({ event: "start", concurrency: 19, experimentConcurrency: { mempal: 1, nowledge: 4 } });
    if (start?.event !== "start") throw new Error("expected start event");
    // 第三个实验(未声明上限)不许被补成全局值——那会把「没有实验闸」写成「闸恰好等于全局」。
    expect(Object.keys(start.experimentConcurrency ?? {})).toEqual(["mempal", "nowledge"]);
  });

  it("没有任何实验声明 maxConcurrency 时省略整个字段,不输出空对象", () => {
    const [start] = emitDurable([
      {
        type: "plan",
        at: 0,
        plan: { shape: { evals: 2, configs: 1, totalAttempts: 2, maxConcurrency: 4 }, reused: 0, reusedFailures: [] },
      },
    ]);
    expect(start).toMatchObject({ event: "start", concurrency: 4 });
    expect(start).not.toHaveProperty("experimentConcurrency");
  });

  it("plan 里带了空对象也不输出这个字段(空 map 与「没有实验闸」是同一件事)", () => {
    const [start] = emitDurable([
      {
        type: "plan",
        at: 0,
        plan: {
          shape: { evals: 2, configs: 1, totalAttempts: 2, maxConcurrency: 4 },
          experimentConcurrency: {},
          reused: 0,
          reusedFailures: [],
        },
      },
    ]);
    expect(start).not.toHaveProperty("experimentConcurrency");
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「Judge 预检的运行级行」
// 契约见 docs/feature/experiments/cli.md「判分预检的显示」的 JudgePrecheckEvent:三值 status,
// done / failed 带时长;failed 只标记预检本身的结局,受影响 attempt 的 errored 另由 error 事件给出。
describe("judge_precheck 事件:started / done / failed 三值,结束态带时长", () => {
  it("failed 带 durationMs,起止各一行", () => {
    const events = emitDurable([
      { type: "precheck", at: 1, status: "started" },
      { type: "precheck", at: 40_013, status: "failed", durationMs: 40_012 },
    ]);
    expect(events).toEqual([
      { event: "judge_precheck", status: "started" },
      { event: "judge_precheck", status: "failed", durationMs: 40_012 },
    ]);
  });

  it("done 同样带 durationMs;started 不带", () => {
    const events = emitDurable([
      { type: "precheck", at: 1, status: "started" },
      { type: "precheck", at: 1_501, status: "done", durationMs: 1_500 },
    ]);
    expect(events).toEqual([
      { event: "judge_precheck", status: "started" },
      { event: "judge_precheck", status: "done", durationMs: 1_500 },
    ]);
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「live feedback 的未知 activity 通用投影」
describe("run-activity 不是 ExpEvent", () => {
  it("Run 级 activity 只服务 human live 面，不写入 --json 事件流", () => {
    const events = emitDurable([
      {
        type: "run-activity",
        at: 1,
        id: "warm-1",
        key: "acme.cache.warm",
        label: "warming acme cache shard-3",
        status: "started",
      },
      {
        type: "run-activity",
        at: 2,
        id: "warm-1",
        key: "acme.cache.warm",
        label: "warming acme cache shard-3",
        status: "failed",
        durationMs: 1_200,
      },
    ]);
    expect(events).toEqual([]);
  });
});
