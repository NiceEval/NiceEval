// 纯 reducer:RunFeedbackEvent → RunFeedbackState。计数、active slot、cost 累计、
// failure/diagnostic 去重全部只在这里计算 —— 三种 profile 的 renderer(后续阶段实现)只读
// RunFeedbackState,不各自维护第二份推导,也不解析 message 里的人类文案(结构化字段都在
// DiagnosticNotice.data / FailureNotice 的具名字段上,见 ../types.ts 的类型注释)。
//
// `total = reused + running + queued + completed` 在处理每一个事件之后都成立 —— 见
// reducer.test.ts 的表驱动用例,每一步都断言这个不变量,不只在流程末尾断言一次。
//
// reducer 本身不读 Date.now()、不碰 process.stdout/stderr、不知道 profile 是 human/agent/ci ——
// 纯函数 (state, event) => state,方便脱离真实 runner/terminal 单测。

import type { DiagnosticNotice, FailureNotice, RunFeedbackEvent, RunFeedbackState } from "../types.ts";
import { encodeAttemptKey } from "../types.ts";

/** reducer 的起始状态:一个尚未收到任何事件的 run。 */
export function createInitialRunFeedbackState(): RunFeedbackState {
  return {
    total: 0,
    reused: 0,
    running: 0,
    queued: 0,
    completed: 0,
    earlyExitSkipped: 0,
    elapsedMs: 0,
    active: new Map(),
    experimentHooks: new Map(),
    failures: [],
    freshFailureCount: 0,
    diagnostics: [],
    kept: [],
  };
}

export function reduceRunFeedback(state: RunFeedbackState, event: RunFeedbackEvent): RunFeedbackState {
  switch (event.type) {
    case "plan": {
      const total = event.plan.shape.totalRuns;
      const reused = event.plan.reused;
      // plan 是一次 run 的起点:重置 active/failures/diagnostics,即便 reducer 被复用于
      // 多次 run 也不会把上一次的残留状态带进新 run(正常用法下 plan 本来就应是第一个事件)。
      return {
        ...state,
        total,
        reused,
        // 全部非携入 attempt 在此刻就已知会被派发,先计入 queued;后续 attempt:start
        // 逐个把它们移进 running,不必等每条 attempt:queued 事件才累加(见类型注释)。
        queued: Math.max(0, total - reused),
        running: 0,
        completed: 0,
        active: new Map(),
        experimentHooks: new Map(),
        failures: (event.plan.reusedFailures ?? []).map((failure) => ({ ...failure, at: event.at })),
        freshFailureCount: 0,
        diagnostics: [],
      };
    }

    case "tick":
      return { ...state, elapsedMs: event.elapsedMs };

    case "attempt:queued":
      // 计数已经在 "plan" 时一次性算好(见上),这个事件目前只是为后续阶段预留「单条 attempt
      // 进入排队」的挂点(如展示排队位置),对 RunFeedbackState 不产生任何变化。
      return state;

    case "attempt:start": {
      const key = encodeAttemptKey(event.identity);
      const active = new Map(state.active);
      active.set(key, {
        identity: event.identity,
        who: event.who,
        phase: event.phase,
        phaseStartedAt: event.at,
      });
      return {
        ...state,
        queued: state.queued - 1,
        running: state.running + 1,
        active,
      };
    }

    case "attempt:phase": {
      const key = encodeAttemptKey(event.identity);
      const existing = state.active.get(key);
      if (!existing) return state; // 防御:识别不到的 attempt 静默忽略,不让 renderer 崩
      const active = new Map(state.active);
      // 进入新 phase 清空旧 detail —— 次要文本是绑定到具体 phase 的(如 running 阶段的
      // "tool: shell"),不该原样带进下一个 phase 显示。
      active.set(key, { ...existing, phase: event.phase, phaseStartedAt: event.at, detail: undefined });
      return { ...state, active };
    }

    case "attempt:progress": {
      const key = encodeAttemptKey(event.identity);
      const existing = state.active.get(key);
      if (!existing) return state;
      const active = new Map(state.active);
      active.set(key, { ...existing, detail: event.detail });
      return { ...state, active };
    }

    case "attempt:complete": {
      const key = encodeAttemptKey(event.identity);
      const active = new Map(state.active);
      active.delete(key);
      const estimatedCostUSD =
        event.estimatedCostUSD === undefined
          ? state.estimatedCostUSD
          : (state.estimatedCostUSD ?? 0) + event.estimatedCostUSD;
      const newTokenCount =
        event.tokenCount === undefined
          ? state.newTokenCount
          : (state.newTokenCount ?? 0) + event.tokenCount;
      return {
        ...state,
        running: state.running - 1,
        completed: state.completed + 1,
        active,
        newTokenCount,
        estimatedCostUSD,
      };
    }

    case "experiment-hook": {
      // 运行级行的增删:started 添加,done/failed 移除(见 cli.md「实验级钩子的显示」)。
      // 不动 running/queued 计数——等待 setup 的 attempt 保持 queued,计数不变量不受钩子影响。
      const experimentHooks = new Map(state.experimentHooks);
      if (event.status === "started") {
        experimentHooks.set(event.experimentId, {
          experimentId: event.experimentId,
          hook: event.hook,
          startedAt: event.at,
        });
      } else {
        experimentHooks.delete(event.experimentId);
      }
      return { ...state, experimentHooks };
    }

    case "experiment:progress": {
      const existing = state.experimentHooks.get(event.experimentId);
      if (!existing) return state; // 防御:没有对应运行级行时静默忽略,不让 renderer 崩
      const experimentHooks = new Map(state.experimentHooks);
      experimentHooks.set(event.experimentId, { ...existing, detail: event.detail });
      return { ...state, experimentHooks };
    }

    case "attempt:early-exit":
      // 首过即停下已知 verdict 的省略次数:折进 completed(结论已经确定,不再需要派发),
      // 不产生 failures/diagnostics —— 这不是一次失败或异常,只是省下的重复验证
      // (真正「未完整覆盖」的信号来自 budget-exhausted / fail-fast diagnostic,不是这里)。
      return {
        ...state,
        queued: state.queued - 1,
        completed: state.completed + 1,
        earlyExitSkipped: state.earlyExitSkipped + 1,
      };

    case "failure": {
      const isFresh = !state.failures.some((failure) => failure.locator === event.locator);
      return {
        ...state,
        failures: upsertFailure(state.failures, {
          at: event.at,
          locator: event.locator,
          identity: event.identity,
          who: event.who,
          verdict: event.verdict,
          reason: event.reason,
          ...(event.assertion !== undefined ? { assertion: event.assertion } : {}),
          ...(event.phase !== undefined ? { phase: event.phase } : {}),
        }),
        freshFailureCount: state.freshFailureCount + (isFresh ? 1 : 0),
      };
    }

    case "diagnostic":
      return {
        ...state,
        diagnostics: upsertDiagnostic(state.diagnostics, {
          at: event.at,
          key: event.key,
          severity: event.severity,
          message: event.message,
          identity: event.identity,
          data: event.data,
        }),
      };

    case "budget-exhausted":
      // 约定:emitter 对每一个因 budget 到顶而不派发的 attempt 各发一次这个事件(与
      // attempt:early-exit 同构),所以每次触发在这里折进 completed 一次 —— 不去信任
      // event.unstarted 的绝对值来算「这次要挪多少」(那需要 reducer 额外记住上一次的值,
      // 破坏纯 (state, event) => state 的最小状态原则)。event.unstarted / event.spent 仍然
      // 整体写进 diagnostic 的 data,供 agent/ci 直接读取当次快照值;真正的去重计数由
      // upsertDiagnostic 的 count 字段给出,天然等于「目前为止因 budget 未派发的次数」。
      return {
        ...state,
        queued: state.queued - 1,
        completed: state.completed + 1,
        diagnostics: upsertDiagnostic(state.diagnostics, {
          at: event.at,
          key: `budget-exhausted:${event.experimentId}`,
          severity: "warning",
          message: `budget exhausted for ${event.experimentId}`,
          data: { experimentId: event.experimentId, spent: event.spent, unstarted: event.unstarted },
        }),
      };

    case "kept":
      // 留存授予的永久通知:run 摘要后各 profile 追加输出(见 docs/feature/sandbox/cli.md)。
      return {
        ...state,
        kept: [
          ...state.kept,
          {
            at: event.at,
            locator: event.locator,
            identity: event.identity,
            who: event.who,
            verdict: event.verdict,
            provider: event.provider,
            sandboxId: event.sandboxId,
            ...(event.enter !== undefined ? { enter: event.enter } : {}),
          },
        ],
      };

    case "interrupted":
      return {
        ...state,
        diagnostics: upsertDiagnostic(state.diagnostics, {
          at: event.at,
          key: "interrupted",
          severity: "warning",
          message: "run interrupted",
        }),
      };

    case "reporter-error":
      return {
        ...state,
        diagnostics: upsertDiagnostic(state.diagnostics, {
          at: event.at,
          key: `reporter-error:${event.reporter}`,
          severity: event.required ? "error" : "warning",
          message: `reporter "${event.reporter}" failed: ${event.message}`,
          data: { reporter: event.reporter, required: event.required },
        }),
      };

    case "summary":
    case "saved":
      // 终局通知:发出时 counts/active 已经由前面的 attempt 事件更新到位,状态本身不再变化——
      // 这两个事件的 payload(summary/completion/paths)由 coordinator 直接使用,不经 reducer
      // 折叠进 RunFeedbackState(RunFeedbackState 是「当前进行中」的 dashboard 状态,不是终局报告)。
      return state;

    default: {
      // 穷尽性检查:新增 RunFeedbackEvent 变体时,这里会在编译期报错提醒补上对应分支。
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function upsertFailure(failures: readonly FailureNotice[], notice: FailureNotice): readonly FailureNotice[] {
  // 同一 locator 理论上不该出现两次;真出现时按最新一次覆盖(幂等),而不是重复追加同一条失败。
  const idx = failures.findIndex((f) => f.locator === notice.locator);
  if (idx === -1) return [...failures, notice];
  const next = failures.slice();
  next[idx] = notice;
  return next;
}

function upsertDiagnostic(
  diagnostics: readonly DiagnosticNotice[],
  input: Omit<DiagnosticNotice, "count">,
): readonly DiagnosticNotice[] {
  const idx = diagnostics.findIndex((d) => d.key === input.key);
  if (idx === -1) return [...diagnostics, { ...input, count: 1 }];
  const next = diagnostics.slice();
  next[idx] = { ...input, count: next[idx].count + 1 };
  return next;
}
