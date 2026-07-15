// 运行器主调度:发现产出的 eval × agent × runs → attempt,有界并发调度。
// 职责只有编排:指纹缓存在 fingerprint.ts,单 attempt 生命周期在 attempt.ts,
// reporter 编排 / 汇总在 report.ts,Sandbox 适配器在 remote-sandbox.ts。

import { readFile } from "node:fs/promises";
import { Effect, Cause, Exit } from "effect";
import { probeJudge } from "../scoring/judge.ts";
import { t } from "../i18n/index.ts";
import { cacheKey, planCarry } from "./fingerprint.ts";
import { OtelReceiverPool } from "../o11y/otlp/turn-otel.ts";
import { runAttemptEffect } from "./attempt.ts";
import { runReporter, emitReporterEvent, scopeReporter, summarize } from "./report.ts";
import {
  reportActivity,
  reportAttemptLifecycle,
  reportBudgetExhausted,
  reportDiagnostic,
  reportFailure,
  reportInterrupted,
} from "./feedback/sink.ts";
import { encodeAttemptLocator, type AttemptLocator } from "../results/locator.ts";
import { runWho } from "./types.ts";
import { firstLine } from "../util.ts";
import type { Agent, EvalResult, JudgeConfig, Reporter, ReporterRegistration, RunShape, RunSummary } from "../types.ts";
import type { AgentRun, Attempt, AttemptPhase, AttemptRef, RunOptions } from "./types.ts";

/** 失败/errored 的一层可行动摘要,与 `computeVerdict`(verdict.ts)判定同一断言为准:
 *  errored 用 error 消息第一行(见上面的 firstLine);failed 用促成判定的那条断言
 *  (gate,或 `--strict` 下的 soft),格式 `${severity}: ${name}` —— 与
 *  docs/feature/experiments/cli.md「AI agent 怎么用」的例子(`gate: cache tool not used`)
 *  一致,整句透传给 `FailureNotice.reason`,不再二次拆分。 */
function describeFailureReason(result: EvalResult, strict: boolean | undefined): string {
  if (result.verdict === "errored") return firstLine(result.error?.message ?? result.verdict);
  const culprit = result.assertions.find((asn) => asn.outcome === "failed" && (asn.severity === "gate" || strict));
  return culprit ? `${culprit.severity}: ${culprit.name}` : firstLine(result.error?.message ?? result.verdict);
}

/** 反馈层的 attempt 身份 + 展示 label,两个 sink.ts lifecycle 调用点共用,避免各自手写
 *  同一组字段(见 memory 的 live-who-key-mismatch-freezes-rows —— 手写副本漏改是真实事故源)。 */
function feedbackIdentity(a: Attempt): AttemptRef {
  return { experimentId: a.run.experimentId, evalId: a.evalDef.id, attempt: a.attempt };
}
function feedbackWho(a: Attempt): string {
  return runWho({ agentName: a.run.agent.name, model: a.run.model, experimentId: a.run.experimentId });
}

export type { AgentRun, RunOptions } from "./types.ts";

/** 收集本次要探测的 judge 配置:只看「实际要跑、且源码里出现 judge 字样」的 eval 的生效
 *  配置(evalDef.judge ?? config.judge,与 attempt.ts 的 resolveJudge 一致),按
 *  model|baseUrl|apiKeyEnv 去重。要跑的 eval 都不用 judge 时返回空 —— 全局配了 judge
 *  也不探测,纯确定性断言的运行不再被 judge key / 端点问题拦下。
 *  源码扫描是启发式:judge 调用藏在 import 的 helper 里时会漏判,漏判只是退回旧行为
 *  (评分时才报 judge 错误,损失 fail fast),不影响正确性。 */
export function judgeProbeTargets(
  evals: Array<{ source: string; judge: JudgeConfig | undefined }>,
  configJudge: JudgeConfig | undefined,
): JudgeConfig[] {
  const seen = new Set<string>();
  const toProbe: JudgeConfig[] = [];
  for (const e of evals) {
    const jc = e.judge ?? configJudge;
    if (!jc || !/\bjudge\b/.test(e.source)) continue;
    const key = `${jc.model ?? ""}|${jc.baseUrl ?? ""}|${jc.apiKeyEnv ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    toProbe.push(jc);
  }
  return toProbe;
}

export async function runEvals(opts: RunOptions): Promise<RunSummary> {
  const startedAt = new Date().toISOString();
  // 本次 invocation 的快照身份锚点:在展开/调度任何 attempt 之前确定一次,不同 experiment
  // 共享它(locator 身份还含 experimentId,不会碰撞)。fresh EvalResult 的 locator(见下方
  // attempt 完成处)与 Artifacts writer 写进 snapshot.json 的 startedAt 必须用同一个值——
  // 复用刚建立的 startedAt,不是另起一次 new Date(),避免两者出现毫秒级漂移
  // (docs/feature/experiments/cli.md「Locator 必须在 result 发布前确定」)。经 RunShape
  // 传给 reporter(见下方 shape 构造),run.ts 之外没有第二个入口能改这份身份。
  const snapshotStartedAt = startedAt;
  const t0 = Date.now();

  // 按 sourcePath 缓存文件内容,fingerprint 与 judge 预检共用:
  // 矩阵大时(实验 × eval)规划阶段不做串行重复文件读。
  const sourceCache = new Map<string, Promise<string>>();
  const readSource = (path: string): Promise<string> => {
    let p = sourceCache.get(path);
    if (!p) {
      p = readFile(path, "utf-8");
      sourceCache.set(path, p);
    }
    return p;
  };

  // 跨实验结果复用:上次 passed 或 failed 且 fingerprint 匹配的 (experimentId, evalId) 组合
  // 直接携入 —— 两者都是"跑完了、判定确定"的终态,没有理由重花一次 agent/sandbox 成本去
  // 复现同一个已知结果。errored 是框架/环境层面的不确定失败(超时、沙箱挂了、judge 探测失败
  // 等),判定本身不可信,必须重跑。跳过/fingerprint 不匹配同样重跑。--force 跳过此逻辑
  // (cli.ts 在 --force 时不传 priorResults,也不算 carryPlan)。
  // carryPlan 优先用调用方(cli.ts,为了 live 表格)已经算好的那份,不重算一遍。
  const { plannedFingerprints, priorRunKeys, carriedResults } =
    opts.carryPlan ?? (await planCarry(opts.evals, opts.agentRuns, opts.priorResults));

  // 携入覆盖计数:priorRunKeys 只回答「这个 (experimentId, evalId) 组合有没有可携入的终态
  // 结果」,不回答「携入了几条」。runs 被调大(或实验改成更大的 runs)时,上次可能只留下比
  // 这次请求更少的终态结果(如上次 runs:1、这次改成 runs:5),不能因为"有过携入"就把这次
  // 请求的差额序号也整段跳过——那会让 pass@N 里的 N 被携入悄悄砍短,运行还照样报 PASSED/exit 0
  // (见 docs/runner.md「不能在 CI 里伪装成全绿」)。下面按序号只跳过携入能覆盖到的前
  // carriedCount 个,差额必须真正进 attempts 数组、走正常调度(含 earlyExit/budget 判断)。
  const carriedCountByKey = new Map<string, number>();
  for (const r of carriedResults) {
    if (!r.experimentId) continue;
    const key = `${r.experimentId}|${r.id}`;
    carriedCountByKey.set(key, (carriedCountByKey.get(key) ?? 0) + 1);
  }

  // 展开 attempts
  // 外层按「round」(run index)迭代,内层按 eval 迭代:同一 key 的第 i+1 次 attempt 排在
  // 所有 eval 的第 i 次之后,earlyExit 开启时第 0 轮通过的 eval,其后续轮大多还没入池就被跳过。
  // 注意这只是省钱的吞吐优化,不是正确性前提 —— 即便同 key 的 attempt 同时在飞,
  // 首个通过会 abort 同 key 其余 attempt,且它们的结果被下面的去重检查丢弃,不会重复计入。
  const attempts: Attempt[] = [];
  for (const run of opts.agentRuns) {
    const evals = opts.evals.filter((e) => run.evalFilter(e.id));
    for (let i = 0; i < run.runs; i++) {
      for (const evalDef of evals) {
        const carryKey = `${run.experimentId ?? ""}|${evalDef.id}`;
        // 只跳过携入能覆盖到的前 carriedCount 个序号(见上面 carriedCountByKey 的注释);
        // i 超出携入数量的部分必须真正调度,不能因为同一组合"有过携入"就整段跳过。
        if (run.experimentId && priorRunKeys.has(carryKey) && i < (carriedCountByKey.get(carryKey) ?? 0)) continue;
        // key 标识「同一个运行配置下的同一条 eval」,earlyExit 的跳过/abort 只应作用于
        // 同 key 的重试轮。experimentId 必须进 key:两个实验可以同 agent 同 model、只差
        // flags(feature A/B 正是这种形状),漏掉它会让先过的实验把其它实验的同名 eval
        // 整个跳掉——花了钱还丢结果。
        const key = `${run.experimentId ?? ""}|${run.agent.name}|${run.model ?? ""}|${evalDef.id}`;
        attempts.push({
          evalDef,
          run,
          attempt: i,
          key,
          fingerprint: plannedFingerprints.get(cacheKey(run, evalDef.id)) ?? "",
        });
      }
    }
  }

  // 预检 judge:验证 API key + 端点可达,避免跑完 agent 才发现 judge 不通。
  // 放在 attempts 展开之后,fail fast 只对会真正触发 judge 的运行生效
  // (目标收集逻辑见 judgeProbeTargets;全部结果携入、attempts 为空时也自然跳过)。
  {
    const uniqueEvals = [...new Map(attempts.map((a) => [a.evalDef.id, a.evalDef])).values()];
    const sources = await Promise.all(uniqueEvals.map((e) => readSource(e.sourcePath)));
    const toProbe = judgeProbeTargets(
      uniqueEvals.map((e, i) => ({ source: sources[i] ?? "", judge: e.judge })),
      opts.config.judge,
    );
    if (toProbe.length > 0) {
      reportActivity(t("runner.judgePrecheck").trimEnd());
      for (const jc of toProbe) {
        const err = await probeJudge(jc, opts.signal);
        if (err) throw new Error(err);
      }
    }
  }

  if (carriedResults.length > 0) {
    const retryCount = new Set(attempts.map((a) => `${a.run.experimentId ?? ""}|${a.evalDef.id}`)).size;
    reportActivity(t("runner.resumeCarry", { carried: carriedResults.length, retry: retryCount }).trimEnd());
    // 按 experiment 分组列出被复用(跳过)的 eval:不列清单的话,用户只看到数量,
    // 无法核对「跳过的是不是我以为已经过了的那些」。同一 key 多个 run 去重。
    const carriedByExperiment = new Map<string, Set<string>>();
    for (const r of carriedResults) {
      const ids = carriedByExperiment.get(r.experimentId!) ?? new Set<string>();
      ids.add(r.id);
      carriedByExperiment.set(r.experimentId!, ids);
    }
    for (const [experiment, ids] of [...carriedByExperiment].sort(([a], [b]) => a.localeCompare(b))) {
      reportActivity(t("runner.resumeCarryDetail", { experiment, evals: [...ids].sort().join(", ") }).trimEnd());
    }
  }

  // onRunStart 报「本次实际要跑的 eval」(过滤 + 去重),不是发现到的全部 —— 否则计数误导。
  const runningIds = new Set(attempts.map((a) => a.evalDef.id));
  const runningEvals = [...runningIds].map((id) => ({ id }));
  const firstAgent = opts.agentRuns[0]?.agent;
  const shape: RunShape = {
    evals: runningEvals.length,
    configs: opts.agentRuns.length,
    totalRuns: attempts.length,
    maxConcurrency: opts.maxConcurrency,
    snapshotStartedAt,
  };
  // eval 级 reporters:实例只观测引用它的 eval(经 scopeReporter 过滤转发)。
  // 已经挂在全局 reporters 里的同一实例不重复挂;同一实例被多个 eval 引用时合并观测集
  // (共享一个目的地,如同一个 Braintrust 实验)。本次没有任何被观测 eval 要跑时整个跳过。
  const scopedSets = new Map<Reporter, Set<string>>();
  for (const e of opts.evals) {
    for (const r of e.reporters ?? []) {
      if (opts.reporters.some((reg) => reg.reporter === r)) continue;
      let ids = scopedSets.get(r);
      if (!ids) scopedSets.set(r, (ids = new Set()));
      ids.add(e.id);
    }
  }
  const reporters: ReporterRegistration[] = [...opts.reporters];
  // EvalDef.reporters 是用户在单个 eval 上挂的补充观测(如「这个 eval 单独也发一份到某个
  // dashboard」),不是 CLI 显式注册的默认/机器出口——与 Config.reporters 同样默认
  // best-effort(见 ReporterRegistration 的字段注释:required 只留给 artifacts / --json /
  // --junit)。name 用「scope 内第几个」编号,足以在诊断里区分「哪一个 eval 级 reporter」,
  // 不需要用户自己起名字。
  let evalReporterIndex = 0;
  for (const [r, ids] of scopedSets) {
    const scopedRuns = attempts.filter((a) => ids.has(a.evalDef.id)).length;
    if (scopedRuns === 0) continue;
    reporters.push({
      reporter: scopeReporter(r, ids, {
        evals: [...ids].filter((id) => runningIds.has(id)).length,
        configs: opts.agentRuns.length,
        totalRuns: scopedRuns,
        maxConcurrency: opts.maxConcurrency,
        snapshotStartedAt,
      }),
      name: `eval-reporter-${evalReporterIndex++}`,
      required: false,
    });
  }

  for (const reg of reporters) {
    // reporter 只是结果消费方:单个 reporter 抛错记 diagnostic,不能让整次调度崩,也不阻断
    // 其它 reporter 的必要收尾(required/best-effort 的判定权重在 runReporter 内部处理)。
    await runReporter(reg, "onRunStart", () => reg.reporter.onRunStart?.(runningEvals, firstAgent as Agent, shape));
  }
  await emitReporterEvent(reporters, {
    type: "run:start",
    evals: runningEvals,
    agent: firstAgent as Agent,
    shape,
  });

  const results: EvalResult[] = [];
  const passedKeys = new Set<string>();
  // errored = 框架/环境层面的意外(超时、adapter 崩、eval 脚本抛异常……),不是 agent 表现的信号。
  // 同 key 一旦 errored 就会确定性地重复 error,再跑 runs 里剩下的次数纯烧钱;只有 failed(断言
  // 真的没过)才代表 agent 行为的样本,值得跑满 runs 去测通过率。earlyExit 开时两者都提前收尾。
  const erroredKeys = new Set<string>();
  // 携入的 passed 结果预置进 passedKeys:上面按序号回填的差额 attempt(carriedCount < run.runs
  // 那部分)如果不预置这个,会在明明已经拿到过 passed 结果的情况下真的再调度一次 agent——
  // earlyExit 的语义是「已知会通过就不用再跑」,携入的 passed 同样是「已知会通过」,理应同等对待
  // (下面 preflight/body 的 earlyExit 判断本来就只在 a.run.earlyExit 为真时读这两个 Set,所以
  // 这里无条件预置对 --no-early-exit 场景没有副作用)。携入的 failed 故意不预置——failed 本来
  // 就不触发 earlyExit,回填的差额必须真的重跑,才对得起用户调大 runs 的意图(想看这次是不是
  // 还失败,或想凑够 pass@N 的样本量)。
  for (const r of carriedResults) {
    if (r.verdict === "passed" && r.experimentId) {
      passedKeys.add(`${r.experimentId}|${r.agent}|${r.model ?? ""}|${r.id}`);
    }
  }

  // budget 护栏:只按「已完成 attempt 的实测花费」判断,不做预测性节流。之前的实现会按
  // 「平均成本 × 在飞数」预扣,快到顶就让还没起飞的 attempt 排队等——这在探测阶段(还没有任何
  // 成本样本时)等价于把同一 budgetKey 的并发摁到一个很小的数,且完全没有文档承诺过这个副作用
  // (`docs-site/zh/guides/write-experiment.mdx` 对 `budget` 的描述只有一句「这一格配置的预算
  // 上限」)。新语义:已完成 attempt 的花费加总一旦到顶,就不再放新 attempt 起飞(已经在飞的
  // 照常跑完,不会被中途打断);到顶之前不做任何预测性限流,并发完全由 globalSem / runSem 决定。
  // 代价是「已花 + 在飞未结算」的总花费可能短暂超出 budget——这是有意识的取舍:budget 是防止
  // 无限烧钱的安全网,不是精确计费闸,不应该反过来限制吞吐。
  interface BudgetState {
    spent: number;
    completedNoCost: number;
    unenforceableWarned: boolean;
    /** 因这个 budgetKey 预算到顶而未派发的 attempt 累计数——反馈层 "budget-exhausted" 事件
     *  (见 sink.ts 的 `BudgetExhaustedInput`)要求 emitter 自己维护这个累计值,reducer 不推导。 */
    unstartedCount: number;
  }
  const budgetStates = new Map<string, BudgetState>();
  const budgetState = (key: string): BudgetState => {
    let s = budgetStates.get(key);
    if (!s) {
      s = { spent: 0, completedNoCost: 0, unenforceableWarned: false, unstartedCount: 0 };
      budgetStates.set(key, s);
    }
    return s;
  };
  const budgetReported = new Set<string>();

  // reporter 的 onEvalComplete 要「每个 attempt 完成即时触发」(保流式输出),又不能让
  // 并发 worker 交错写 → 用一个 permit=1 的信号量串起来(替代原先手搓的 reportQueue 链)。
  const reportMutex = Effect.runSync(Effect.makeSemaphore(1));
  // 沙箱启动单独限流:与 agent 并发(maxConcurrency)解耦,防高并发下 daemon/API 过载。
  // 未显式指定时跟 maxConcurrency 走——各 provider 的推荐值已在 cli 层写进 maxConcurrency 默认值。
  const sandboxSem = Effect.runSync(Effect.makeSemaphore(opts.maxConcurrency));

  // 两级并发闸:全局(opts.maxConcurrency)+ 实验级(AgentRun.maxConcurrency,可选)。
  // 实验级信号量让「有共享状态、必须串行」的实验(如跨 eval 累积记忆,maxConcurrency: 1)
  // 只在自己内部排队,同批其它实验照常并发——旧行为是 CLI 取所有选中实验的最小值钳全局,
  // 一个串行实验会把整批基线拖成串行。等于全局上限的实验级值不建闸(与全局闸重复)。
  const globalSem = Effect.runSync(Effect.makeSemaphore(opts.maxConcurrency));
  const runSems = new Map<AgentRun, Effect.Semaphore>();
  for (const run of opts.agentRuns) {
    if (run.maxConcurrency !== undefined && run.maxConcurrency < opts.maxConcurrency) {
      runSems.set(run, Effect.runSync(Effect.makeSemaphore(Math.max(1, run.maxConcurrency))));
    }
  }

  // 非沙箱 tracing agent 的共享 OTLP 接收池:被测应用是长驻进程,端点不能随
  // attempt 换 —— receiver 粒度跟被测进程走(每 agent 一个,整个 run 复用),run 结束回收。
  if (!opts.otelPool) {
    opts = { ...opts, otelPool: new OtelReceiverPool(opts.config.telemetry?.port) };
  }

  // earlyExit:为每个 key 各建一个 AbortController。某 attempt 通过或 errored 时 abort 它,
  // 让并发进行中的同 key attempt 通过 signal 尽早退出,而不只是等排队的才能被跳过。
  const evalAbortControllers = new Map<string, AbortController>();
  for (const a of attempts) {
    if (a.run.earlyExit && !evalAbortControllers.has(a.key)) {
      evalAbortControllers.set(a.key, new AbortController());
    }
  }

  // 有界并发调度:forEach 本身 unbounded(每个 attempt 立刻有自己的 fiber),真正的
  // 并发上限由上面两级信号量把守——执行体先过实验级闸(若有)再占全局 permit 才开跑。
  // 获取定序恒为 runSem → globalSem,无环等待;实验级闸的持有者在等全局 permit 时
  // 不占别的实验的并发位(并发位就是 globalSem 的 permit,不再是 forEach 的 fiber 槽)。
  // runAttemptEffect 只把「执行错误」收进 EvalResult.error(不 fail),
  // 但中断(Ctrl+C / kill)照常向上传播 —— 所以一条挂掉不会中断其它 attempt,而中断能停掉全部。
  //
  // signal:把 opts.signal 喂给 run → abort 触发根 fiber 中断 → forEach 中断所有子 fiber
  //         → 每个 attempt 的 Scope 跑 release(sb.stop)→ 容器全部停掉(治孤儿)。Effect 保证
  //         所有 finalizer 跑完后才结算,所以下面 summarize 时容器已清理干净。
  //
  // 用 runPromiseExit 而非 runPromise:{ signal } 触发的中断会让整个 Exit 标记为 interrupted,
  // 即便内层 catchAllCause 已把中断咽下 —— runPromise 这种情况下会直接 reject,把 Ctrl+C 变成
  // 一条「niceeval 出错」崩溃栈、并跳过下面的部分汇总。runPromiseExit 返回 Exit 不抛,我们据此
  // 把「中断/signal 已 abort」当正常的部分结果收尾,只有真·非中断缺陷才上抛。
  let interrupted = false;
  const exit = await Effect.runPromiseExit(
    Effect.forEach(
      attempts,
      (a) => {
        const budgetKey = a.run.experimentId ?? a.run.agent.name;

        // preflight:「要不要开始跑」的许可判断(首过即停 + budget 上限检查),不持有
        // globalSem——两类判断都是即时返回,不该占着全局并发槽位做无谓等待。runSem(实验自己的
        // maxConcurrency)例外:它是实验私有资源,preflight 占着不影响别的实验,且和 mempal
        // 那类「必须串行」的语义一致,所以仍然把 preflight 包在 runSem 里面(见下方)。
        const preflight = Effect.gen(function* () {
            // 首过即停:同 key 已通过,或已 errored(重跑只会重复同一个框架错误)且开了 earlyExit
            // → 跳过未启动的 attempt。
            if (a.run.earlyExit && (passedKeys.has(a.key) || erroredKeys.has(a.key))) {
              yield* reportMutex.withPermits(1)(
                Effect.promise(() =>
                  emitReporterEvent(reporters, {
                    type: "run:earlyExit",
                    evalId: a.evalDef.id,
                    experimentId: a.run.experimentId,
                  }),
                ),
              );
              reportAttemptLifecycle({
                type: "attempt:early-exit",
                at: Date.now(),
                identity: feedbackIdentity(a),
                who: feedbackWho(a),
              });
              return false;
            }

            const budget = a.run.budget;
            if (budget !== undefined) {
              // 只看已完成 attempt 的实测花费(见上方 BudgetState 注释),到顶就跳过新 attempt,
              // 没到顶就立即放行——不等待、不做预测性节流。
              const s = budgetState(budgetKey);
              if (s.spent >= budget) {
                if (!budgetReported.has(budgetKey)) {
                  budgetReported.add(budgetKey);
                  yield* reportMutex.withPermits(1)(
                    Effect.promise(() =>
                      emitReporterEvent(reporters, { type: "run:budgetExceeded", budget, spent: s.spent }),
                    ),
                  );
                }
                // 反馈层:对每一个因预算到顶而不派发的 attempt 各发一次(与上面的
                // attempt:early-exit 同构),让 RunFeedbackState 的 queued/completed 计数与
                // cli.ts 的 assembleRunCompletion() 都能感知到「有 attempt 因预算未派发」——
                // 上面 emitReporterEvent 的 run:budgetExceeded 只对旧版 Reporter 接口每
                // budgetKey 报一次,不满足反馈层「每个未派发 attempt 各一条」的计数契约,两者
                // 独立并存。只在挂靠 experiment 时报(budget-exhausted 事件要求真实
                // experimentId;裸 run 不产出这类永久事件,与 locator 的省略规则一致)。
                if (a.run.experimentId) {
                  s.unstartedCount += 1;
                  reportBudgetExhausted({
                    experimentId: a.run.experimentId,
                    spent: s.spent,
                    unstarted: s.unstartedCount,
                  });
                }
                return false;
              }
            }
            return true;
          });

        // body:preflight 放行之后才跑,只有这一段真正占用全局并发槽位(globalSem)。
        const body = Effect.gen(function* () {
            // 合并全局信号与本 eval 的首过即停信号:任一 abort → 本 attempt 的信号 abort。
            const evalAc = evalAbortControllers.get(a.key);
            const attemptSignal =
              evalAc && opts.signal
                ? AbortSignal.any([opts.signal, evalAc.signal])
                : (evalAc?.signal ?? opts.signal);

            yield* reportMutex.withPermits(1)(
              Effect.promise(() =>
                emitReporterEvent(reporters, {
                  type: "eval:start",
                  eval: { id: a.evalDef.id },
                  agent: a.run.agent,
                  model: a.run.model,
                  attempt: a.attempt,
                  experimentId: a.run.experimentId,
                }),
              ),
            );
            // attempt:start 是这个 attempt 从 queued 移进 running 的唯一时刻(见
            // src/runner/feedback/reducer.ts 的 attempt:start 分支),必须与 eval:start 同一
            // 调用点、恰好发生一次 —— 否则 RunFeedbackState 的守恒计数会被破坏。phase 只是粗粒度
            // 占位(sandbox 型 attempt 恒为 sandbox-provision,一定正确;非 sandbox 型给
            // running,attempt.ts 内部一旦跑到第一个真实边界会用 attempt:phase 立即纠正,见
            // attempt.ts 的 enterPhase)——attempt.ts 自己不再发 attempt:start,只发
            // attempt:phase,避免两处各发一次导致计数翻倍。
            const initialPhase: AttemptPhase = a.run.agent.kind === "sandbox" ? "sandbox-provision" : "running";
            reportAttemptLifecycle({
              type: "attempt:start",
              at: Date.now(),
              identity: feedbackIdentity(a),
              who: feedbackWho(a),
              phase: initialPhase,
            });
            // reportFailure()(见下)要求「失败发生时所在的阶段」,但 attempt:complete 一发出
            // coordinator 就会把 active map 里这个 attempt 的条目删掉(reducer 的 attempt:complete
            // 分支),事后没有地方能反查。用本地变量跟 attempt.ts 的 enterPhase 同步更新(经
            // runAttemptEffect 的 onPhase 回调,与它发出 attempt:phase 事件同一调用点)——初值
            // 与上面 attempt:start 的占位 phase 一致,attempt 全程失败在哪一步就停在哪一步。
            // 唯独 "teardown" 不计入:它在 attempt.ts 的 finally 里无条件触发(成功/失败都会走
            // 到),且 teardown 自身的失败只落 diagnostic、从不改变 verdict(见 attempt.ts 对应
            // 注释),所以一个 failed/errored 结果的真实病灶必然在 teardown 之前 ——
            // 把它计进来只会让每一条失败通知都显示同一个没有信息量的 "teardown"。
            let lastPhase: AttemptPhase = initialPhase;
            const result = yield* runAttemptEffect(a, opts, sandboxSem, attemptSignal, (phase) => {
              if (phase !== "teardown") lastPhase = phase;
            });
            // locator 在这里确定 —— 早于本 attempt 触发的任何 reporter 回调 / 事件
            // (onEvalComplete、eval:complete),所以每一个观察者看到的都已经是最终值,
            // 和落盘 result.json 完全一致(writer.ts 的 entry.locator ?? 兜底分支因此
            // 对 niceeval 自己的运行永不触发,只服务第三方直调 SnapshotWriter 的场景)。
            // 没有 experimentId 的裸 run(非 exp 命令)不产出 locator,与
            // writer.writeAttemptFor() 要求 experimentId 的既有约束一致 ——
            // encodeAttemptLocator 本身也会在 experimentId 为空时直接抛错。
            // 单独存一份本地变量(而不是只写 result.locator 再读回来):下面报 "failure" 永久
            // 事件时需要一个已知是 AttemptLocator 品牌类型的值,result.locator 字段本身是
            // 落盘/reporter 契约用的裸 string(见 EvalResult.locator 的类型注释)。
            let locator: AttemptLocator | undefined;
            if (a.run.experimentId) {
              locator = encodeAttemptLocator({
                experimentId: a.run.experimentId,
                snapshotStartedAt,
                evalId: a.evalDef.id,
                attempt: a.attempt,
              });
              result.locator = locator;
            }
            // attempt:complete 与上面的 attempt:start 严格一一配对(同一个 body Effect,唯一
            // 出口),覆盖每一个真正跑过 runAttemptEffect 的 attempt(包括之后被下面的并发去重
            // 分支丢弃、不计入 results 的那些)——reducer 的 attempt:complete 无条件
            // running-1/completed+1,少配对一次就会让 running 计数漂移。
            reportAttemptLifecycle({
              type: "attempt:complete",
              at: Date.now(),
              identity: feedbackIdentity(a),
              who: feedbackWho(a),
              verdict: result.verdict,
              estimatedCostUSD: result.estimatedCostUSD,
            });
            if (a.run.budget !== undefined) {
              const s = budgetState(budgetKey);
              if (result.estimatedCostUSD !== undefined) {
                s.spent += result.estimatedCostUSD;
              } else {
                s.completedNoCost += 1;
                if (s.spent === 0 && s.completedNoCost >= 3 && !s.unenforceableWarned) {
                  // 连续几次完成都拿不到成本:budget 对这个 agent 不可执行,说清楚一次。
                  // s.unenforceableWarned 已经是 per-budgetKey 的一次性闸门;稳定 key 上的
                  // reportDiagnostic 去重是双保险,不依赖它单独生效。
                  s.unenforceableWarned = true;
                  reportDiagnostic({
                    key: `budget-unenforceable:${budgetKey}`,
                    severity: "warning",
                    message: t("runner.budgetUnenforceable", { budgetKey }).trimEnd(),
                    data: { budgetKey },
                  });
                }
              }
            }

            if (result.verdict === "passed") {
              passedKeys.add(a.key);
              evalAc?.abort(); // 让同 key 并发 attempt 尽早退出
            } else if (a.run.earlyExit && (passedKeys.has(a.key) || erroredKeys.has(a.key))) {
              // 并发情况:同 key 另一个 attempt 已通过/已 errored 后本 attempt 才完成
              // (被 abort 后产出 errored),不计入结果。
              return;
            } else if (result.verdict === "errored") {
              erroredKeys.add(a.key);
              evalAc?.abort(); // 框架层面的错误会确定性重复,让同 key 剩余 attempt 尽早退出
            }

            results.push(result);
            // 反馈层的永久失败通知(见 sink.ts 的 FailureInput / docs/feature/experiments/
            // cli.md「什么动态更新,什么逐条追加」表的「failed / errored + locator」行)——
            // 只在拿到 locator 时报(裸 run 没有 locator,不产出这类事件,与上面 result.locator
            // 的省略规则一致),且只报真正计入 results 的 attempt(上面的并发去重分支已经
            // return 掉、不会走到这里,不会为一条被丢弃的重复 attempt 误报失败)。
            if (locator && (result.verdict === "failed" || result.verdict === "errored")) {
              reportFailure({
                locator,
                identity: feedbackIdentity(a),
                who: feedbackWho(a),
                verdict: result.verdict,
                reason: describeFailureReason(result, a.run.strict),
                phase: lastPhase,
              });
            }
            yield* reportMutex.withPermits(1)(
              // 每个 reporter 单独兜错:一个写文件失败 / 自定义 reporter 抛错只记 diagnostic,
              // 不让 Promise.all 整体 reject —— 否则 Effect.promise 把它当 defect,fail 掉 forEach、
              // 停掉后续 attempt(P2)。
              Effect.promise(() =>
                Promise.all(
                  reporters.map((reg) =>
                    runReporter(reg, "onEvalComplete", () => reg.reporter.onEvalComplete?.(result)),
                  ),
                ),
              ),
            );
            // 和上面的 onEvalComplete 同一把 reportMutex:两条回调路径都要串行化,否则并发
            // attempt 各自触发的 eval:complete 会绕开 permit=1 直接并发跑,和文档承诺的
            // 「报告回调串行化」不一致。
            yield* reportMutex.withPermits(1)(
              Effect.promise(() => emitReporterEvent(reporters, { type: "eval:complete", result })),
            );
          });
        const gated = Effect.gen(function* () {
          const proceed = yield* preflight;
          if (!proceed) return;
          yield* globalSem.withPermits(1)(body);
        });
        const runSem = runSems.get(a.run);
        return runSem ? runSem.withPermits(1)(gated) : gated;
      },
      { concurrency: "unbounded", discard: true },
    ).pipe(
      // 中断(用户 Ctrl+C):finalizer 已在中断过程中跑完(容器已停),这里只是把它咽下,
      // 好让流程走到 summarize / onRunComplete,用已完成的 results 出一份部分汇总,而不是抛栈。
      Effect.catchAllCause((cause) => {
        if (Cause.isInterrupted(cause)) {
          interrupted = true;
          return Effect.void;
        }
        return Effect.failCause(cause); // 非中断的意外缺陷:照常抛出
      }),
    ),
    { signal: opts.signal },
  );
  await opts.otelPool?.close();
  if (Exit.isFailure(exit)) {
    // signal abort 或 cause 含中断 → 当作用户中断,走部分汇总;否则是真·缺陷,照常抛出。
    if (opts.signal?.aborted || Cause.isInterrupted(exit.cause)) {
      interrupted = true;
    } else {
      throw Cause.squash(exit.cause);
    }
  }
  if (interrupted) reportInterrupted();

  // 稳定排序:按发现顺序 + attempt;携带结果并入后一起排
  const order = new Map(opts.evals.map((e, i) => [e.id, i]));
  const allResults = [...carriedResults, ...results];
  allResults.sort(
    (a, b) =>
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) ||
      a.agent.localeCompare(b.agent) ||
      a.attempt - b.attempt,
  );

  const summary = summarize(allResults, firstAgent?.name ?? "", startedAt, Date.now() - t0, opts.config.name);
  await emitReporterEvent(reporters, { type: "run:summary", summary });
  for (const reg of reporters) {
    // required reporter(默认 artifacts、显式 --json/--junit)在这一步失败,不能中断其它
    // reporter 的收尾——继续跑完剩下的循环,让每个 reporter 都拿到 onRunComplete 的机会;
    // 失败本身经 runReporter → reportReporterError 折成诊断,由调用方(cli.ts)读取
    // RunFeedbackState 组装成 RunCompletion,让最终 completion/退出码判红(见
    // docs/feature/experiments/cli.md「运行完成状态不只看 verdict 计数」)。
    await runReporter(reg, "onRunComplete", () => reg.reporter.onRunComplete?.(summary));
  }
  await emitReporterEvent(reporters, { type: "run:saved", summary });
  return summary;
}
