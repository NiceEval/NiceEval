// 运行器主调度:发现产出的 eval × agent × runs → attempt,有界并发调度。
// 职责只有编排:指纹缓存在 fingerprint.ts,单 attempt 生命周期在 attempt.ts,
// reporter 编排 / 汇总在 report.ts,Sandbox 适配器在 remote-sandbox.ts。

import { readFile } from "node:fs/promises";
import { Effect, Cause, Duration, Exit } from "effect";
import { probeJudge } from "../scoring/judge.ts";
import { t } from "../i18n/index.ts";
import { cacheKey, computeFingerprint } from "./fingerprint.ts";
import { OtelReceiverPool } from "../o11y/otlp/turn-otel.ts";
import { runAttemptEffect } from "./attempt.ts";
import { runReporter, emitReporterEvent, scopeReporter, summarize } from "./report.ts";
import type { Agent, EvalResult, JudgeConfig, Reporter, RunShape, RunSummary } from "../types.ts";
import type { AgentRun, Attempt, RunOptions } from "./types.ts";

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

  const plannedFingerprints = new Map<string, string>();
  {
    const jobs: Promise<void>[] = [];
    for (const run of opts.agentRuns) {
      for (const evalDef of opts.evals.filter((e) => run.evalFilter(e.id))) {
        jobs.push(
          computeFingerprint(evalDef, run, sourceCache).then((fp) => {
            plannedFingerprints.set(cacheKey(run, evalDef.id), fp);
          }),
        );
      }
    }
    await Promise.all(jobs);
  }

  // 跨实验结果复用:只有上次 passed 且 fingerprint 匹配的 (experimentId, evalId) 组合直接携入。
  // 失败/错误/跳过/fingerprint 不匹配都会重跑。--force 跳过此逻辑。
  const priorRunKeys = new Set<string>();
  const carriedResults: EvalResult[] = [];
  if (opts.priorResults?.length) {
    for (const r of opts.priorResults) {
      if (!r.experimentId) continue;
      const key = `${r.experimentId}|${r.id}`;
      if (r.verdict === "passed" && r.fingerprint !== undefined && r.fingerprint === plannedFingerprints.get(key)) {
        priorRunKeys.add(key);
      }
    }
    for (const r of opts.priorResults) {
      if (!r.experimentId || !priorRunKeys.has(`${r.experimentId}|${r.id}`)) continue;
      // artifactBase 是相对结果根(.niceeval)的路径,指向原快照的 attempt 目录:
      // loadLatestResultsPerEval(经 withViewRefs)已经拼好这个稳定路径,换一个新快照
      // 目录不影响它的可解析性,原样带过来——writer 落盘携带条目时只写 result.json,
      // artifact 仍留在原快照里,靠 artifactBase 懒加载回退;不然 view 就再也找不到
      // 这条携带结果的源码/转录/trace 了。
      carriedResults.push(r);
    }
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
        if (run.experimentId && priorRunKeys.has(`${run.experimentId}|${evalDef.id}`)) continue;
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
      process.stderr.write(t("runner.judgePrecheck"));
      for (const jc of toProbe) {
        const err = await probeJudge(jc, opts.signal);
        if (err) throw new Error(err);
      }
    }
  }

  if (carriedResults.length > 0) {
    const retryCount = new Set(attempts.map((a) => `${a.run.experimentId ?? ""}|${a.evalDef.id}`)).size;
    process.stderr.write(t("runner.resumeCarry", { carried: carriedResults.length, retry: retryCount }));
    // 按 experiment 分组列出被复用(跳过)的 eval:不列清单的话,用户只看到数量,
    // 无法核对「跳过的是不是我以为已经过了的那些」。同一 key 多个 run 去重。
    const carriedByExperiment = new Map<string, Set<string>>();
    for (const r of carriedResults) {
      const ids = carriedByExperiment.get(r.experimentId!) ?? new Set<string>();
      ids.add(r.id);
      carriedByExperiment.set(r.experimentId!, ids);
    }
    for (const [experiment, ids] of [...carriedByExperiment].sort(([a], [b]) => a.localeCompare(b))) {
      process.stderr.write(t("runner.resumeCarryDetail", { experiment, evals: [...ids].sort().join(", ") }));
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
  };
  // eval 级 reporters:实例只观测引用它的 eval(经 scopeReporter 过滤转发)。
  // 已经挂在全局 reporters 里的同一实例不重复挂;同一实例被多个 eval 引用时合并观测集
  // (共享一个目的地,如同一个 Braintrust 实验)。本次没有任何被观测 eval 要跑时整个跳过。
  const scopedSets = new Map<Reporter, Set<string>>();
  for (const e of opts.evals) {
    for (const r of e.reporters ?? []) {
      if (opts.reporters.includes(r)) continue;
      let ids = scopedSets.get(r);
      if (!ids) scopedSets.set(r, (ids = new Set()));
      ids.add(e.id);
    }
  }
  const reporters: Reporter[] = [...opts.reporters];
  for (const [r, ids] of scopedSets) {
    const scopedRuns = attempts.filter((a) => ids.has(a.evalDef.id)).length;
    if (scopedRuns === 0) continue;
    reporters.push(
      scopeReporter(r, ids, {
        evals: [...ids].filter((id) => runningIds.has(id)).length,
        configs: opts.agentRuns.length,
        totalRuns: scopedRuns,
        maxConcurrency: opts.maxConcurrency,
      }),
    );
  }

  for (const r of reporters) {
    // reporter 只是结果消费方:单个 reporter 抛错记 diagnostic,不能让整次调度崩(P2)。
    await runReporter("onRunStart", () => r.onRunStart?.(runningEvals, firstAgent as Agent, shape));
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

  // budget 护栏带「在飞预扣」:实测成本只有 attempt 完成后才知道,若只检查已完成花费,
  // maxConcurrency 个 attempt 会在任何成本回写前全部起飞,实际花费能冲到 budget 的十几倍。
  // 口径:还没有任何【带成本】的完成样本时,同一 budgetKey 只放一个 attempt 在飞(探单次成本);
  // 有样本后,用平均实测成本给每个在飞 attempt 预扣,预计总额到顶就等,已花到顶就停。
  // costSamples 只数报了成本的 attempt —— 不报成本的完成(agent 无用量、模型不在价格表、
  // 早期 errored)不能算 0 元样本,否则均值被拉成 0,护栏彻底失效。连续多次完成都拿不到
  // 成本时,说明这个 agent 的 budget 根本不可执行:警告一次然后放行,而不是永远串行装样子。
  interface BudgetState {
    spent: number;
    inflight: number;
    costSamples: number;
    completedNoCost: number;
    unenforceableWarned: boolean;
  }
  const budgetStates = new Map<string, BudgetState>();
  const budgetState = (key: string): BudgetState => {
    let s = budgetStates.get(key);
    if (!s) {
      s = { spent: 0, inflight: 0, costSamples: 0, completedNoCost: 0, unenforceableWarned: false };
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

        // preflight:「要不要开始跑」的许可判断(首过即停 + budget 探测),故意不持有 globalSem——
        // 这两类判断都可能要等(budget 探测尤其可能 sleep-loop 好一阵子),而全局并发槽位是所有
        // 实验共享的稀缺资源,等待中的 fiber 绝不能占着它空转,否则一个实验的 budget 探测能把
        // 其它实验饿死到连第一个 attempt 都抢不到全局槽位(bug 复盘见
        // memory: niceeval-budget-probe-starves-global-semaphore)。
        // runSem(实验自己的 maxConcurrency)例外:它是实验私有资源,preflight 占着不影响别的实验,
        // 且和 mempal 那类「必须串行」的语义一致,所以仍然把 preflight 包在 runSem 里面(见下方)。
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
              return false;
            }

            const budget = a.run.budget;
            if (budget !== undefined) {
              // 预扣循环:预计花费(已花 + 在飞×均值)到顶就等在飞的结算,已花到顶就整段停。
              // 这段刻意不持有 globalSem(见上方注释);runSem 仍然罩着它,同实验内的等待不
              // 影响别的实验。
              for (;;) {
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
                  return false;
                }
                if (s.costSamples === 0 && s.completedNoCost >= 3 && !s.unenforceableWarned) {
                  // 连续几次完成都拿不到成本:budget 对这个 agent 不可执行,说清楚再放行。
                  s.unenforceableWarned = true;
                  process.stderr.write(t("runner.budgetUnenforceable", { budgetKey }));
                }
                if (s.costSamples === 0 && s.unenforceableWarned) {
                  s.inflight += 1;
                  return true;
                }
                const avg = s.costSamples > 0 ? s.spent / s.costSamples : undefined;
                const projected =
                  avg === undefined ? (s.inflight > 0 ? Number.POSITIVE_INFINITY : 0) : s.spent + s.inflight * avg;
                if (projected < budget) {
                  s.inflight += 1;
                  return true;
                }
                yield* Effect.sleep(Duration.millis(200));
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
            const result = yield* runAttemptEffect(a, opts, sandboxSem, attemptSignal).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  if (a.run.budget !== undefined) {
                    const s = budgetState(budgetKey);
                    s.inflight = Math.max(0, s.inflight - 1);
                  }
                }),
              ),
            );
            if (a.run.budget !== undefined) {
              const s = budgetState(budgetKey);
              if (result.estimatedCostUSD !== undefined) {
                s.spent += result.estimatedCostUSD;
                s.costSamples += 1;
              } else {
                s.completedNoCost += 1;
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
            yield* reportMutex.withPermits(1)(
              // 每个 reporter 单独兜错:一个写文件失败 / 自定义 reporter 抛错只记 diagnostic,
              // 不让 Promise.all 整体 reject —— 否则 Effect.promise 把它当 defect,fail 掉 forEach、
              // 停掉后续 attempt(P2)。
              Effect.promise(() =>
                Promise.all(
                  reporters.map((r) =>
                    runReporter("onEvalComplete", () => r.onEvalComplete?.(result)),
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
  if (interrupted) process.stderr.write(t("runner.interrupted"));

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
  for (const r of reporters) {
    await runReporter("onRunComplete", () => r.onRunComplete?.(summary));
  }
  await emitReporterEvent(reporters, { type: "run:saved", summary });
  return summary;
}
