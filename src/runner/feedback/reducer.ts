// 纯 reducer:RunFeedbackEvent → RunFeedbackState。计数、active slot、cost 累计、
// failure/diagnostic 去重全部只在这里计算 —— 两种 profile 的 renderer(后续阶段实现)只读
// RunFeedbackState,不各自维护第二份推导,也不解析 message 里的人类文案(结构化字段都在
// DiagnosticNotice.data / FailureNotice 的具名字段上,见 ../types.ts 的类型注释)。
//
// `total = reused + running + elsewhere + queued + passed + failed + errored + skipped`
//(八项恒等式,契约见 docs/feature/experiments/cli.md「等待并发 run 的显示」)在处理每一个事件
// 之后都成立 —— 见 reducer.test.ts 的表驱动用例,每一步都断言这个不变量,不只在流程末尾断言
// 一次。八项是互斥状态划分:每一次迁移都是「从一项减 x、往另一项加 x」的原子操作(plan →
// queued;attempt:start queued→running;attempt:complete running→事件携带的 verdict 那一项;
// attempt:early-exit 与 budget-exhausted queued→skipped;lock-wait started queued→elsewhere;
// lock-wait resolved elsewhere→reused / elsewhere→queued),没有一个事件会让某条 attempt 同时
// 落在两项里或凭空消失。emitter 侧的对应义务是「报进 elsewhere 多少条,就要报出来多少条」
//(见 run.ts 的 recheckCarry)。
//
// 了结的 attempt 按 verdict 落项,不折进一个笼统的完成数:运行中最该被回答的问题是「到现在
// 为止挂了几个」,一个合计数回答不了,而失败流事件会被后续输出顶出可视区。携入结果的 verdict
// 不摊进这四项(留在 reused),否则 reused 会同时既是状态又是来源、恒等式失去意义。
//
// reducer 本身不读 Date.now()、不碰 process.stdout/stderr、不知道 profile 是 human/json ——
// 纯函数 (state, event) => state,方便脱离真实 runner/terminal 单测。

import type { DiagnosticNotice, FailureNotice, RunFeedbackEvent, RunFeedbackState } from "../types.ts";
import { encodeAttemptKey } from "../types.ts";
import { evalConclusionKey } from "./eval-conclusions.ts";

/** reducer 的起始状态:一个尚未收到任何事件的 run。 */
export function createInitialRunFeedbackState(): RunFeedbackState {
  return {
    total: 0,
    reused: 0,
    running: 0,
    elsewhere: 0,
    queued: 0,
    passed: 0,
    failed: 0,
    errored: 0,
    skipped: 0,
    earlyExitSkipped: 0,
    earlyExitByEval: new Map(),
    elapsedMs: 0,
    active: new Map(),
    experimentHooks: new Map(),
    lockWaits: new Map(),
    runActivities: new Map(),
    failures: [],
    freshFailureCount: 0,
    diagnostics: [],
    kept: [],
  };
}

export function reduceRunFeedback(state: RunFeedbackState, event: RunFeedbackEvent): RunFeedbackState {
  switch (event.type) {
    case "plan": {
      const total = event.plan.shape.totalAttempts;
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
        elsewhere: 0,
        // 携入结果的 verdict 不摊进四项结局(它们留在 reused):plan 带 reusedFailures 时
        // failures 已经预置好供结束面板使用,但首行的结局计数此刻仍全为零。
        passed: 0,
        failed: 0,
        errored: 0,
        skipped: 0,
        active: new Map(),
        activePrecheck: undefined,
        experimentHooks: new Map(),
        lockWaits: new Map(),
        runActivities: new Map(),
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
        // active 行时间列的基准只在这里写一次:一条 attempt 的时间从派发起算,之后的阶段推进
        // 只换标签不重置时钟(见 ActiveAttempt.startedAt 与下面的 attempt:phase 分支)。
        startedAt: event.at,
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
      // "tool: shell"),不该原样带进下一个 phase 显示。`startedAt` 原样带过去(spread 保留):
      // 阶段边界换的是「正在干什么」,不是「这条跑了多久」。
      active.set(key, { ...existing, phase: event.phase, detail: undefined });
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
      // 落项完全由事件携带的 verdict 决定 —— reducer 不自己判断成败(那是 scoring 的事),
      // 也不留一个「已完成但未归类」的兜底项:Verdict 是四值闭集,穷尽覆盖。
      return {
        ...state,
        running: state.running - 1,
        [event.verdict]: state[event.verdict] + 1,
        active,
        newTokenCount,
        estimatedCostUSD,
      };
    }

    case "precheck": {
      // judge 预检运行级行的增删(见 cli.md「判分预检的显示」):started 建行,done / failed 清行
      // ——预检失败后受影响 eval 的逐条 errored 由 failure 事件解释,这行没有留下来的理由。
      // 不动 running/queued 计数——预检发生在派发之前,attempt 全程保持 queued,计数不变量不受影响。
      if (event.status === "started") {
        return { ...state, activePrecheck: { startedAt: event.at } };
      }
      const { activePrecheck: _cleared, ...rest } = state;
      return rest;
    }

    case "experiment-hook": {
      // 运行级行的增删:started 添加,done/failed 移除(见 cli.md「实验级 Hook 的显示」)。
      // 不动 running/queued 计数——等待 setup 的 attempt 保持 queued,计数不变量不受钩子影响。
      const experimentHooks = new Map(state.experimentHooks);
      if (event.status === "started") {
        experimentHooks.set(event.experimentId, {
          experimentId: event.experimentId,
          hook: event.hook,
          startedAt: event.at,
          ...(event.recovery !== undefined ? { recovery: event.recovery } : {}),
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

    case "lock-wait": {
      // 粒度是单个 (experimentId, evalId):"started" 把这次撞锁需要等待的 attempt 数从
      // queued 移入 elsewhere,"resolved" 按 carried/dispatched 分别迁入 reused/queued——
      // 两者之和不必等于 "started" 时的 attempts(同一批等待可能分批 resolve,虽然当前
      // emitter 恒一次性给出全部,reducer 不假设这一点,只按事件携带的数字增减)。
      const existing = state.lockWaits.get(event.experimentId);
      // 上一个「有等待用例」窗口已经完全关闭(waiting 为空)时,新窗口的累计计数从零开始——
      // 不把上一窗口 resolved 的历史计数带进这一窗口的非 TTY 聚合收尾行。
      const priorWindowClosed = !existing || existing.waiting.size === 0;
      const lockWaits = new Map(state.lockWaits);
      if (event.status === "started") {
        const attempts = event.attempts ?? 1;
        const waiting = new Map(priorWindowClosed ? [] : existing!.waiting);
        waiting.set(event.evalId, {
          startedAt: event.at,
          ...(event.holderPid !== undefined ? { holderPid: event.holderPid } : {}),
          ...(event.holderHost !== undefined ? { holderHost: event.holderHost } : {}),
        });
        lockWaits.set(event.experimentId, {
          experimentId: event.experimentId,
          waiting,
          resolvedCarried: priorWindowClosed ? 0 : existing!.resolvedCarried,
          resolvedDispatched: priorWindowClosed ? 0 : existing!.resolvedDispatched,
        });
        return { ...state, queued: state.queued - attempts, elsewhere: state.elsewhere + attempts, lockWaits };
      }
      // "resolved":没有对应的等待条目时静默忽略(防御,同 experiment:progress 对未知
      // experimentId 的处理),不让一次乱序/重复事件把计数推负。
      if (!existing || !existing.waiting.has(event.evalId)) return state;
      const carried = event.carried ?? 0;
      const dispatched = event.dispatched ?? 0;
      const waiting = new Map(existing.waiting);
      waiting.delete(event.evalId);
      lockWaits.set(event.experimentId, {
        experimentId: event.experimentId,
        waiting,
        resolvedCarried: existing.resolvedCarried + carried,
        resolvedDispatched: existing.resolvedDispatched + dispatched,
      });
      return {
        ...state,
        elsewhere: state.elsewhere - (carried + dispatched),
        reused: state.reused + carried,
        queued: state.queued + dispatched,
        lockWaits,
      };
    }

    case "run-activity": {
      // Run 级开放 activity 的运行级行增删:started 建行,done / failed 清行。
      // 不动 running/queued/elsewhere——共享准备不占 attempt 并发位(见 architecture.md
      // 「Run 级共享准备」)。人读标签走 event.label,不查 LifecyclePhase 锚点表。
      const runActivities = new Map(state.runActivities);
      if (event.status === "started") {
        runActivities.set(event.id, {
          id: event.id,
          key: event.key,
          label: event.label,
          startedAt: event.at,
        });
      } else {
        runActivities.delete(event.id);
      }
      return { ...state, runActivities };
    }

    case "attempt:early-exit": {
      // 首过即停下已知 verdict 的省略次数:折进 skipped —— 这一轮没跑,没有自己的 verdict,
      // 不冒充 passed(题目结论已经确定,但这条 attempt 本身没产出结论),也
      // 不产生 failures/diagnostics —— 这不是一次失败或异常,只是省下的重复验证
      // (真正「未完整覆盖」的信号来自 budget-exhausted / fail-fast diagnostic,不是这里)。
      // 同一份事件也用于 fail-fast 未派发(run.ts 两处调用同一个 "attempt:early-exit" 类型)——
      // earlyExitByEval 在这里按 (experiment, eval) 记的是原始计数,不剔除 fail-fast 份额;
      // `feedback/eval-conclusions.ts` 的 `evalConclusionRows` 消费时才对照 `state.diagnostics`
      // 里的 `fail-fast:` 记录减去那部分,不在 reducer 这一步做(reducer 只管纯计数,不掺业务
      // 判断,也避免依赖 run.ts 里两个事件的发出顺序这类隐式契约)。
      const key = evalConclusionKey(event.identity);
      const earlyExitByEval = new Map(state.earlyExitByEval);
      earlyExitByEval.set(key, (earlyExitByEval.get(key) ?? 0) + 1);
      return {
        ...state,
        queued: state.queued - 1,
        skipped: state.skipped + 1,
        earlyExitSkipped: state.earlyExitSkipped + 1,
        earlyExitByEval,
      };
    }

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
          ...(event.origin !== undefined ? { origin: event.origin } : {}),
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
          ...(event.code !== undefined ? { code: event.code } : {}),
          severity: event.severity,
          message: event.message,
          identity: event.identity,
          data: event.data,
        }),
      };

    case "budget-exhausted":
      // 约定:emitter 对每一个因 budget 到顶而不派发的 attempt 各发一次这个事件(与
      // attempt:early-exit 同构),所以每次触发在这里折进 skipped 一次 —— 不去信任
      // event.unstarted 的绝对值来算「这次要挪多少」(那需要 reducer 额外记住上一次的值,
      // 破坏纯 (state, event) => state 的最小状态原则)。event.unstarted / event.spent 仍然
      // 整体写进 diagnostic 的 data,供 json 直接读取当次快照值;真正的去重计数由
      // upsertDiagnostic 的 count 字段给出,天然等于「目前为止因 budget 未派发的次数」。
      return {
        ...state,
        queued: state.queued - 1,
        skipped: state.skipped + 1,
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
