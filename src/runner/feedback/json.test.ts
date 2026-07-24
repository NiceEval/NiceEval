// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「形态解析与 --json 流不变量」
//
// `computeExitCode` 是 CompletionStatus 驱动退出码折叠的纯函数,直接单测。`renderJsonPlanDocument`
// 只需证明「单个 JSON 文档,不是 NDJSON 流」这条结构性不变量。json renderer 写出的逐事件字段、
// 心跳节奏、`--json` 不做 suppression 这些流不变量由 coordinator/reducer 驱动的事件序列断言
// (见 coordinator.test.ts/reducer.test.ts);具体字节级渲染由
// docs/engineering/testing/e2e/cli.md「反馈输出格式」在真实进程输出上验收。

import { describe, expect, it } from "vitest";
import { computeExitCode, createJsonRenderer, renderJsonPlanDocument } from "./json.ts";
import { createInitialRunFeedbackState, reduceRunFeedback } from "./reducer.ts";
import { createFakeFeedbackIO } from "./testing.ts";
import { HALT_DIAGNOSTIC_CODE, type DurableFeedbackEvent, type InvocationCompletion, type InvocationSummary } from "../types.ts";

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
function emitDurable(events: readonly DurableFeedbackEvent[]): Record<string, unknown>[] {
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
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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

describe("renderJsonPlanDocument:单个 ExpPlanDocument,不是事件流", () => {
  it("输出恰好一行 JSON,可解析为单个对象而不是逐行事件序列", () => {
    const text = renderJsonPlanDocument({
      total: 4,
      evals: 1,
      configs: 4,
      runs: 1,
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
    expect(doc.runs).toBe(1);
    expect(doc.matrix).toHaveLength(2);
  });

  it("locked 为 true 的行原样透传;省略的行不出现 locked 字段(JSON.stringify 丢弃 undefined 属性)", () => {
    const text = renderJsonPlanDocument({
      total: 2,
      evals: 2,
      configs: 1,
      runs: 1,
      matrix: [
        { experimentId: "compare/codex", evalId: "memory/a", reused: false, locked: true },
        { experimentId: "compare/codex", evalId: "memory/b", reused: false },
      ],
    });
    const doc = JSON.parse(text);
    expect(doc.matrix[0]).toMatchObject({ evalId: "memory/a", locked: true });
    expect(doc.matrix[1]).not.toHaveProperty("locked");
  });

  it("reused 是 matrix 逐行 reused 之和(命中数量,不是 attempt 数)", () => {
    const text = renderJsonPlanDocument({
      total: 3,
      evals: 3,
      configs: 1,
      runs: 1,
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
      runs: 1,
      matrix: [{ experimentId: "e", evalId: "a", reused: false }],
    });
    expect(JSON.parse(text.trim()).reused).toBe(0);
  });
});
