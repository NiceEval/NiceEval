// 运行器主调度:发现产出的 eval × agent × runs → attempt,有界并发调度。
// 职责只有编排:指纹缓存在 fingerprint.ts,单 attempt 生命周期在 attempt.ts,
// reporter 编排 / 汇总在 report.ts,Sandbox 适配器在 remote-sandbox.ts。

import { readFile } from "node:fs/promises";
import { Effect, Cause, Exit } from "effect";
import { probeJudge } from "../scoring/judge.ts";
import { t } from "../i18n/index.ts";
import { cacheKey, planCarry } from "./fingerprint.ts";
import { OtelReceiverPool } from "../o11y/otlp/turn-otel.ts";
import { errorFromThrown, experimentRunInfo, runAttemptEffect } from "./attempt.ts";
import { runReporter, emitReporterEvent, scopeReporter, summarize } from "./report.ts";
import {
  reportActivity,
  reportAttemptLifecycle,
  reportBudgetExhausted,
  reportDiagnostic,
  reportExperimentHook,
  reportExperimentProgress,
  reportFailure,
  reportInterrupted,
} from "./feedback/sink.ts";
import { failureDetailFromResult } from "./feedback/failure.ts";
import { encodeAttemptLocator, type AttemptLocator } from "../results/locator.ts";
import { runWho } from "./types.ts";
import { prepareRunSandboxes, sandboxForEval } from "./sandbox-selection.ts";
import type { Agent, EvalResult, JudgeConfig, Reporter, ReporterRegistration, RunShape, RunSummary } from "../types.ts";
import type { AgentRun, Attempt, ExperimentHookContext, LifecyclePhase, AttemptRef, RunOptions } from "./types.ts";
import type { Cleanup } from "../shared/types.ts";

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

  prepareRunSandboxes(opts.evals, opts.agentRuns, opts.config.sandbox);

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
    opts.carryPlan ?? (await planCarry(opts.evals, opts.agentRuns, opts.priorResults, opts.config.sandbox));

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
    // 解析后实际选中的 eval id 全集(evals 过滤器的求值结果)进 ExperimentRunInfo.selectedEvalIds,
    // 与 evalFilterFingerprint 一起取代过滤器本身落盘(见 docs/feature/results/architecture.md)。
    run.selectedEvalIds = evals.map((e) => e.id);
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
          sandboxSpec: sandboxForEval(run, evalDef, opts.config.sandbox),
          // locator 在构造 fresh attempt plan 时即算好并作为身份贯穿执行、留存登记与落盘
          // (不是完成后写回,见 docs/cli.md);裸 run(无 experimentId)不产出。
          locator: run.experimentId
            ? encodeAttemptLocator({
                experimentId: run.experimentId,
                snapshotStartedAt,
                evalId: evalDef.id,
                attempt: i,
              })
            : undefined,
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

  // 缓存携入只在 plan 的 Reuse 行给数量,不逐条铺 eval id 清单(见 cli.md「人在终端里怎么用」:
  // 哪些 eval 复用、哪些重跑属于 --dry 与 niceeval view,不占 human 的 scrollback)。

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
  // run 级 fail-fast(见 docs/runner.md「首过即停」):同一错误 code 在同一 key 连续复现
  // 即判定确定性错误,停止派发受同一配置影响的后续 attempt(如实报 errored 的结果保留;
  // 这是止损,不是「首过即停」,两个机制互不混用)。
  const lastErrorCode = new Map<string, { code: string; streak: number }>();
  const failFastKeys = new Map<string, { code: string; skipped: number }>();
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
  // (`docs-site/zh/tutorials/write-experiment.mdx` 对 `budget` 的描述只有一句「这一格配置的预算
  // 上限」)。新语义:已完成 attempt 的花费加总一旦到顶,就不再放新 attempt 起飞(已经在飞的
  // 照常跑完,不会被中途打断);到顶之前不做任何预测性限流,并发完全由 globalSem / runSem 决定。
  // 代价是「已花 + 在飞未结算」的总花费可能短暂超出 budget——这是有意识的取舍:budget 是防止
  // 无限烧钱的安全网,不是精确计费闸,不应该反过来限制吞吐。
  interface BudgetState {
    spent: number;
    /** 已经真正发起过 agent turn、但仍拿不到成本的 attempt 数。provider/setup 在 agent
     *  运行前失败不计入——这种结果没有可执行的计费事实,不能据此声称 adapter 不报成本。 */
    completedAgentRunsNoCost: number;
    unenforceableWarned: boolean;
    /** 因这个 budgetKey 预算到顶而未派发的 attempt 累计数——反馈层 "budget-exhausted" 事件
     *  (见 sink.ts 的 `BudgetExhaustedInput`)要求 emitter 自己维护这个累计值,reducer 不推导。 */
    unstartedCount: number;
  }
  const budgetStates = new Map<string, BudgetState>();
  const budgetState = (key: string): BudgetState => {
    let s = budgetStates.get(key);
    if (!s) {
      s = { spent: 0, completedAgentRunsNoCost: 0, unenforceableWarned: false, unstartedCount: 0 };
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

  // 实验级生命周期(见 docs/feature/experiments/architecture.md「实验级生命周期」):
  // setup 整场至多一次——第一个通过派发许可(preflight)的 attempt 触发,后续 attempt 等同一个
  // memoized promise;等待发生在 gated 里、globalSem 之外,不占全局并发位。teardown = setup
  // 返回的 cleanup,按 per-run 剩余 attempt 计数在最后一个 attempt 收尾后执行;计数递减挂在
  // Effect.ensuring 上,中断路径同样递减,teardown 因此必跑。
  interface ExperimentLifecycle {
    /** memoized 的 setup 执行;undefined = 还没有 attempt 触发过。 */
    setupPromise?: Promise<void>;
    /** setup 抛过错(用独立布尔标记,不能拿 error 值判断——throw undefined 也是失败)。 */
    setupFailed: boolean;
    setupError?: unknown;
    cleanup?: Cleanup;
    /** 本实验还没收尾的 attempt 数;归零即触发 teardown。 */
    remaining: number;
    /** teardown 已触发(或已确认无事可做),后到的 setup 完成回调据此立即自清。 */
    tornDown: boolean;
  }
  const expLifecycles = new Map<AgentRun, ExperimentLifecycle>();
  for (const a of attempts) {
    if (!a.run.setup) continue;
    let lc = expLifecycles.get(a.run);
    if (!lc) expLifecycles.set(a.run, (lc = { setupFailed: false, remaining: 0, tornDown: false }));
    lc.remaining += 1;
  }
  const runExperimentTeardown = async (run: AgentRun, lc: ExperimentLifecycle): Promise<void> => {
    const cleanup = lc.cleanup;
    lc.cleanup = undefined;
    if (!cleanup) return;
    const experimentId = run.experimentId ?? run.agent.name;
    // 起止由 runner 发布,不依赖钩子自己调 progress(见 cli.md「实验级钩子的显示」)。
    reportExperimentHook({ experimentId, hook: "teardown", status: "started" });
    const startedAt = Date.now();
    try {
      await cleanup();
      reportExperimentHook({ experimentId, hook: "teardown", status: "done", durationMs: Date.now() - startedAt });
    } catch (e) {
      reportExperimentHook({ experimentId, hook: "teardown", status: "failed", durationMs: Date.now() - startedAt });
      // cleanup 失败只作运行级诊断,不改任何已产出的 verdict(与 sandbox.teardown 的
      // teardown-failed 同一语义);资源可能泄漏,所以要说出来。
      reportDiagnostic({
        key: `experiment-teardown-failed:${experimentId}`,
        severity: "warning",
        message: t("runner.experimentTeardownFailed", {
          experimentId,
          message: e instanceof Error ? e.message : String(e),
        }).trimEnd(),
        data: { experimentId },
      });
    }
  };
  const ensureExperimentSetup = (a: Attempt): Promise<void> => {
    const lc = expLifecycles.get(a.run)!;
    if (!lc.setupPromise) {
      const run = a.run;
      const experimentId = run.experimentId ?? run.agent.name;
      const ctx: ExperimentHookContext = {
        experimentId: run.experimentId ?? "",
        selectedEvalIds: run.selectedEvalIds ?? [],
        signal: opts.signal,
        // progress 是短命状态:只更新本实验运行级行的 detail,不属于任何 attempt 的 active 条目。
        progress: (u) => {
          const suffix = u.current !== undefined && u.total !== undefined ? ` (${u.current}/${u.total})` : "";
          reportExperimentProgress({ experimentId, detail: `${u.message}${suffix}` });
        },
        // diagnostic 进运行级永久事件流;实验级钩子不属于任何单个 attempt,不落 result.json。
        diagnostic: (input) =>
          reportDiagnostic({
            key: input.dedupeKey ?? `${input.code}:experiment:${experimentId}`,
            severity: input.level,
            message: input.message,
            data: { experimentId, ...(input.data ?? {}) },
          }),
      };
      lc.setupPromise = (async () => {
        // 起止由 runner 发布(见 cli.md「实验级钩子的显示」):一个什么都不调的 setup 也必须
        // 可见,不能让「0 running · N queued 长时间不动」看起来像调度卡死。
        reportExperimentHook({ experimentId, hook: "setup", status: "started" });
        const startedAt = Date.now();
        let cleanup: Cleanup | void;
        try {
          cleanup = await run.setup!(ctx);
        } catch (e) {
          reportExperimentHook({ experimentId, hook: "setup", status: "failed", durationMs: Date.now() - startedAt });
          throw e;
        }
        reportExperimentHook({ experimentId, hook: "setup", status: "done", durationMs: Date.now() - startedAt });
        if (typeof cleanup === "function") {
          // 极端时序:全部 attempt 在 setup 完成前就被中断收尾(remaining 已归零),
          // 没有人再会触发 teardown——这里立即自清,不留孤儿资源。
          if (lc.tornDown) {
            lc.cleanup = cleanup;
            await runExperimentTeardown(run, lc);
          } else {
            lc.cleanup = cleanup;
          }
        }
      })().catch((e) => {
        lc.setupFailed = true;
        lc.setupError = e;
      });
    }
    return lc.setupPromise;
  };

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
            // 首过即停:只由 passed 触发(errored 不中止其余样本,见 docs/feature/experiments/
            // architecture.md「调度接口」)。
            if (a.run.earlyExit && passedKeys.has(a.key)) {
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

            // run 级 fail-fast:确定性错误(同一 code 在同一 key 连续复现)已识别 → 停止派发,
            // 未派发计入 unstarted(结论落 incomplete,不伪装成全绿;与首过即停互不混用)。
            const failFast = failFastKeys.get(a.key);
            if (failFast !== undefined) {
              failFast.skipped += 1;
              reportAttemptLifecycle({
                type: "attempt:early-exit",
                at: Date.now(),
                identity: feedbackIdentity(a),
                who: feedbackWho(a),
              });
              reportDiagnostic({
                key: `fail-fast:${a.key}`,
                severity: "warning",
                message: t("runner.failFast", { evalId: a.evalDef.id, code: failFast.code }).trimEnd(),
                identity: feedbackIdentity(a),
                data: { evalId: a.evalDef.id, code: failFast.code, ...(a.run.experimentId ? { experimentId: a.run.experimentId } : {}) },
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
            // 占位(sandbox 型 attempt 恒为 sandbox.queue,一定正确;非 sandbox 型给
            // eval.run,attempt.ts 内部一旦跑到第一个真实边界会用 attempt:phase 立即纠正,见
            // attempt.ts 的 enterPhase)——attempt.ts 自己不再发 attempt:start,只发
            // attempt:phase,避免两处各发一次导致计数翻倍。
            const initialPhase: LifecyclePhase = a.run.agent.kind === "sandbox" ? "sandbox.queue" : "eval.run";
            reportAttemptLifecycle({
              type: "attempt:start",
              at: Date.now(),
              identity: feedbackIdentity(a),
              who: feedbackWho(a),
              phase: initialPhase,
            });
            // 实验级 setup 失败:不派发 agent,为这条 attempt 合成结构化 errored 结果
            // (code experiment-setup-failed、phase experiment.setup),走与真实结果完全相同的
            // 下游路径(locator / 反馈事件 / reporter / 落盘)——环境起不来是每条 eval 都没跑成
            // 的事实,要逐条进报告,不是一条一次性日志(见 docs/feature/experiments/
            // architecture.md「实验级生命周期」)。
            const expLc = expLifecycles.get(a.run);
            const result = expLc?.setupFailed
              ? ({
                  id: a.evalDef.id,
                  description: a.evalDef.description,
                  experimentId: a.run.experimentId,
                  experiment: experimentRunInfo(a.run, opts.config.sandbox),
                  agent: a.run.agent.name,
                  model: a.run.model,
                  verdict: "errored",
                  fingerprint: a.fingerprint,
                  attempt: a.attempt,
                  startedAt: new Date().toISOString(),
                  durationMs: 0,
                  assertions: [],
                  error: { ...errorFromThrown(expLc.setupError, "experiment.setup"), code: "experiment-setup-failed" },
                } satisfies EvalResult)
              : yield* runAttemptEffect(a, opts, sandboxSem, attemptSignal);
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
            // locator 在 attempt plan 构造时已算好(见 attempts 构建处);这里只把同一个值写进
            // 结果,早于本 attempt 触发的任何 reporter 回调 / 事件。
            const locator: AttemptLocator | undefined = a.locator;
            if (locator) result.locator = locator;
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
              tokenCount: result.usage
                ? (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0)
                : undefined,
              estimatedCostUSD: result.estimatedCostUSD,
            });
            if (a.run.budget !== undefined) {
              const s = budgetState(budgetKey);
              if (result.estimatedCostUSD !== undefined) {
                s.spent += result.estimatedCostUSD;
              } else if (result.phases?.some((phase) => phase.children?.some((child) => child.kind === "turn"))) {
                s.completedAgentRunsNoCost += 1;
                if (s.spent === 0 && s.completedAgentRunsNoCost >= 3 && !s.unenforceableWarned) {
                  // 连续几次真正跑过 agent 的 attempt 都拿不到成本:budget 对这个 agent
                  // 不可执行,说清楚一次。sandbox.create/setup 等前置失败没有 turn,跳过这里:
                  // 此时应由 attempt error 回答根因,不能再用计费 warning 抢走注意力。
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
              lastErrorCode.delete(a.key);
              evalAc?.abort(); // 让同 key 并发 attempt 尽早退出
            } else if (a.run.earlyExit && passedKeys.has(a.key)) {
              // 并发情况:同 key 另一个 attempt 已通过后本 attempt 才完成(被 abort 后产出
              // errored),不计入结果。
              return;
            } else if (result.verdict === "errored" && !expLc?.setupFailed) {
              // errored 不中止其余样本(基建可能自愈);只有同一错误 code 连续复现才判定为
              // 确定性错误,进 run 级 fail-fast 停止派发(不 abort 已在飞的 attempt)。
              // 实验级 setup 失败的合成结果不进 fail-fast:它不派发 agent、零成本,
              // 契约是本实验「所有」attempt 逐条记 errored 进报告,不该被止损机制截短。
              const code = result.error?.code ?? "unexpected-error";
              const prev = lastErrorCode.get(a.key);
              const streak = prev?.code === code ? prev.streak + 1 : 1;
              lastErrorCode.set(a.key, { code, streak });
              if (streak >= 2 && !failFastKeys.has(a.key)) {
                failFastKeys.set(a.key, { code, skipped: 0 });
              }
            } else {
              lastErrorCode.delete(a.key);
            }

            results.push(result);
            // 反馈层的永久失败通知(见 sink.ts 的 FailureInput / docs/feature/experiments/
            // cli.md「什么动态更新,什么逐条追加」表的「failed / errored + locator」行)——
            // 只在拿到 locator 时报(裸 run 没有 locator,不产出这类事件,与上面 result.locator
            // 的省略规则一致),且只报真正计入 results 的 attempt(上面的并发去重分支已经
            // return 掉、不会走到这里,不会为一条被丢弃的重复 attempt 误报失败)。
            if (locator) {
              const failure = failureDetailFromResult(result);
              if (failure) reportFailure(failure);
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
          // 实验级 setup:第一个走到这里的 attempt 真正执行,其余等同一个 memoized promise
          // (它从不 reject——失败收进 lc.setupFailed,由 body 合成 errored 结果);等待发生在
          // globalSem 之外,慢启动的 setup 不占全局并发位。
          if (a.run.setup) yield* Effect.promise(() => ensureExperimentSetup(a));
          yield* globalSem.withPermits(1)(body);
        });
        const runSem = runSems.get(a.run);
        const withRunSem = runSem ? runSem.withPermits(1)(gated) : gated;
        if (!a.run.setup) return withRunSem;
        // 实验级 teardown 计数:每个 attempt 收尾(含被 preflight 跳过、被中断的)都递减,
        // 归零触发 setup 返回的 cleanup。ensuring 在中断路径同样执行,teardown 因此必跑。
        return withRunSem.pipe(
          Effect.ensuring(
            Effect.promise(async () => {
              const lc = expLifecycles.get(a.run)!;
              lc.remaining -= 1;
              if (lc.remaining === 0 && !lc.tornDown) {
                lc.tornDown = true;
                await runExperimentTeardown(a.run, lc);
              }
            }),
          ),
        );
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

  // 实验级 teardown 兜底扫尾:正常路径由 per-attempt ensuring 的计数归零触发(见上),但一次
  // 真实批跑观察到过计数路径未触发的间歇现象(根因未定位,排查记录见 memory 的
  // experiment-teardown-missed-once-in-batch)。走到这里时 forEach 的全部 fiber 连同 finalizer
  // 都已结算,任何 tornDown 仍为 false 的实验都意味着泄漏;在此强制收尾并报警示诊断——
  // 扫尾幂等(cleanup 消费一次性),宁可多一道兜底,不把宿主机资源(隧道/容器)留给用户手拆。
  for (const [run, lc] of expLifecycles) {
    if (lc.tornDown) continue;
    lc.tornDown = true;
    if (!lc.cleanup) continue;
    const experimentId = run.experimentId ?? run.agent.name;
    reportDiagnostic({
      key: `experiment-teardown-late:${experimentId}`,
      severity: "warning",
      message: t("runner.experimentTeardownLate", { experimentId }).trimEnd(),
      data: { experimentId, remaining: lc.remaining },
    });
    await runExperimentTeardown(run, lc);
  }

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
