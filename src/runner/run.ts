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
import { resolveSandbox } from "../sandbox/resolve.ts";
import { recordFact, type FactValue } from "../shared/facts.ts";
import type { ConcurrencySlot } from "../context/send-retry.ts";
import { runReporter, emitReporterEvent, scopeReporter, summarize } from "./report.ts";
import {
  reportAttemptLifecycle,
  reportBudgetExhausted,
  reportDiagnostic,
  reportExperimentHook,
  reportExperimentProgress,
  reportFailure,
  reportInterrupted,
  reportLockWait,
  reportPrecheck,
} from "./feedback/sink.ts";
import { failureDetailFromResult } from "./feedback/failure.ts";
import { encodeAttemptLocator, type AttemptLocator } from "../results/locator.ts";
import { runWho } from "./types.ts";
import { prepareRunSandboxes, sandboxForEval } from "./sandbox-selection.ts";
import { selectedEvalsForRun } from "./eval-selection.ts";
import { registerExperimentTeardown, unregisterExperimentTeardown } from "./experiment-cleanup-registry.ts";
import { withCleanupTimeout } from "./cleanup-timeout.ts";
import { hostname } from "node:os";
import {
  isStaleTeardownRegistration,
  readTeardownRegistrations,
  removeTeardownRegistrationIfPresent,
  teardownEntryId,
  writeTeardownRegistration,
} from "./teardown-registry.ts";
import {
  acquireCaseLock,
  isCaseLockStale,
  readCaseLock,
  CASE_LOCK_HEARTBEAT_INTERVAL_MS,
  type CaseLockClaim,
  type CaseLockRecord,
} from "./lock.ts";
import { acquireGateSlot, type GateLeaseClaim } from "./gate-lease.ts";
import { loadLatestResultsPerEval } from "../view/data.ts";
import type {
  DiagnosticRecord,
  EvalResult,
  InvocationShape,
  InvocationSummary,
  JsonValue,
  JudgeConfig,
  Reporter,
  ReporterRegistration,
  SandboxOption,
} from "../types.ts";
import type { AgentRun, Attempt, ExperimentHookContext, LifecyclePhase, AttemptRef, RunOptions } from "./types.ts";

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

export async function runEvals(opts: RunOptions): Promise<InvocationSummary> {
  const startedAt = new Date().toISOString();
  // 本次 invocation 的快照身份锚点:在展开/调度任何 attempt 之前确定一次,不同 experiment
  // 共享它(locator 身份还含 experimentId,不会碰撞)。fresh EvalResult 的 locator(见下方
  // attempt 完成处)与 Artifacts writer 写进 snapshot.json 的 startedAt 必须用同一个值——
  // 复用刚建立的 startedAt,不是另起一次 new Date(),避免两者出现毫秒级漂移
  // (docs/feature/experiments/cli.md「Locator 必须在 result 发布前确定」)。经 InvocationShape
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
  const { plannedFingerprints, carriedAttemptsByKey, carriedResults } =
    opts.carryPlan ??
    (await planCarry(opts.evals, opts.agentRuns, opts.priorResults, opts.config.sandbox, opts.config.timeoutMs));

  // 展开 attempts
  // 外层按「round」(run index)迭代,内层按 eval 迭代:同一 key 的第 i+1 次 attempt 排在
  // 所有 eval 的第 i 次之后,earlyExit 开启时第 0 轮通过的 eval,其后续轮大多还没入池就被跳过。
  // 注意这只是省钱的吞吐优化,不是正确性前提 —— 即便同 key 的 attempt 同时在飞,
  // 首个通过会 abort 同 key 其余 attempt,且它们的结果被下面的去重检查丢弃,不会重复计入。
  const attempts: Attempt[] = [];
  for (const run of opts.agentRuns) {
    // selectedEvalIds 已由 CLI 在构造 AgentRun 时对候选 eval 各求值一次算好(见
    // eval-selection.ts 的 resolveExperimentEvals());这里只按 resolved id 取 eval,
    // 不重新调用用户谓词(见 docs/feature/results/architecture.md「selectedEvalIds」)。
    const evals = selectedEvalsForRun(opts.evals, run);
    for (let i = 0; i < run.runs; i++) {
      for (const evalDef of evals) {
        const carryKey = `${run.experimentId ?? ""}|${evalDef.id}`;
        // 携带以 attempt 为粒度:只跳过这个具体序号确实被携入的那些(见 fingerprint.ts 的
        // `carriedAttemptsByKey`),不是"这个组合有过携入就跳过前 N 个"——runs:5 里若只有
        // 序号 1 是上一轮的终态、序号 0 是 errored,这里必须只跳过序号 1、照常调度序号 0。
        if (run.experimentId && carriedAttemptsByKey.get(carryKey)?.has(i)) continue;
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

  // 派发顺序:瓶颈优先(docs/runner.md「派发顺序:瓶颈优先,追求最小总墙钟时间」)。
  // 单次 attempt 耗时未知且假设同批内大致均匀,轮次数(该 run 的 attempt 数 / 有效并发宽度,
  // 向上取整)就是耗时的代理指标——把 identical-machine 调度的 LPT 规则推广到 moldable job
  // 场景:轮次多的 run 是关键路径瓶颈,让它先抢到并发位,总时长才接近瓶颈自身的串行耗时,
  // 而不是「瓶颈耗时 + 排在它前面的其它 run 先跑完的耗时」。只在建 attempt 列表时算一次,
  // 不随 earlyExit / fail-fast / budget 实际提前收尾而重算(动态调整不值得为一个尽力而为的
  // 启发式引入)。只重排派发顺序,不改两级信号量本身;结果仍按发现顺序输出(见下方 sort)。
  {
    const byRun = new Map<AgentRun, Attempt[]>();
    for (const a of attempts) {
      let group = byRun.get(a.run);
      if (!group) byRun.set(a.run, (group = []));
      group.push(a);
    }
    const rounds = (run: AgentRun, count: number): number => {
      const width = Math.min(run.maxConcurrency ?? opts.maxConcurrency, opts.maxConcurrency);
      return Math.ceil(count / width);
    };
    const groups = [...byRun.entries()];
    groups.sort((a, b) => rounds(b[0], b[1].length) - rounds(a[0], a[1].length));
    attempts.length = 0;
    for (const [, group] of groups) attempts.push(...group);
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
      // judge 预检是一次真实网络往返,可能慢甚至长时间不返回:发运行级行(started/done),
      // 让 live 面板在预检期间显示「为什么还停在 0 running · N queued」,而不是看起来卡死
      // (见 docs/feature/experiments/cli.md「judge 预检的显示」)。失败以既有错误路径中止,
      // 不发 done——那条运行级行由 coordinator 收尾时随 dashboard 一起清掉。
      reportPrecheck({ status: "started" });
      const precheckStartedAt = Date.now();
      for (const jc of toProbe) {
        const err = await probeJudge(jc, opts.signal);
        if (err) throw new Error(err);
      }
      reportPrecheck({ status: "done", durationMs: Date.now() - precheckStartedAt });
    }
  }

  // 缓存携入只在 plan 的 Reuse 行给数量,不逐条铺 eval id 清单(见 cli.md「人在终端里怎么用」:
  // 哪些 eval 复用、哪些重跑属于 --dry 与 niceeval view,不占 human 的 scrollback)。

  // onInvocationStart 报「本次实际要跑的 eval」(过滤 + 去重),不是发现到的全部 —— 否则计数误导。
  const runningIds = new Set(attempts.map((a) => a.evalDef.id));
  const runningEvals = [...runningIds].map((id) => ({ id }));
  const shape: InvocationShape = {
    evals: runningEvals.length,
    configs: opts.agentRuns.length,
    totalAttempts: attempts.length,
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
        totalAttempts: scopedRuns,
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
    await runReporter(reg, "onInvocationStart", () => reg.reporter.onInvocationStart?.(runningEvals, shape));
  }
  await emitReporterEvent(reporters, {
    type: "invocation:start",
    evals: runningEvals,
    shape,
  });

  const results: EvalResult[] = [];
  // 用例锁释放/接管后重查携带命中的结果(见下方「用例锁」分组与 resolveCaseLockGate)。与
  // 静态 carriedResults 同一种身份:不触发 onEvalComplete / eval:complete(它们已经在另一次
  // Invocation 里被报告过一次),只随 allResults 一起进入本次快照与 experiment:complete 的
  // carriedResults 字段——见 docs/runner.md「并发 Invocation 靠用例锁把续跑扩展到多开」。
  const lateCarriedResults: EvalResult[] = [];
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
  // 实验级闸让「有共享状态、必须串行」的实验(如跨 eval 累积记忆,maxConcurrency: 1)只在
  // 自己内部排队,同批其它实验照常并发。它的名额域跨 Invocation 共用(见 gate-lease.ts 与
  // docs/feature/experiments/architecture.md「并发 Invocation:用例锁」末条),所以名额不是
  // 进程内信号量而是磁盘上的逐槽租约——多开不叠加 N,`maxConcurrency: 1` 的临界区声明在
  // 多开下同样成立。全局位反过来是每条 Invocation 私有的吞吐旋钮,仍是进程内信号量。
  const globalSem = Effect.runSync(Effect.makeSemaphore(opts.maxConcurrency));
  // 实验闸在进程内先垫一层同名额的信号量,再去取租约。两个原因:
  // ① 名额在本进程内部交接是即时的(Effect 信号量把 permit 直接递给排队的下一个 attempt),
  //    不必等租约轮询的下一个周期——单开是绝大多数场景,不该为跨进程协调付整整一个轮询周期
  //    的空转;② 同实验同时去拍磁盘的 attempt 至多 N 个,不让 runs 展开出的一大批兄弟一起
  //    轮询。它只会更严、不会更松:permit 数恒等于该实验 resolved 的 N,真正的名额权威仍是
  //    租约(跨 Invocation 共用、min-N 收紧)。裸 run(没有 experimentId、没有可共享的名额域)
  //    就只有这一层,不产生任何跨进程协调。
  const gateLocalSems = new Map<AgentRun, Effect.Semaphore>();
  for (const run of opts.agentRuns) {
    if (run.maxConcurrency !== undefined) {
      gateLocalSems.set(run, Effect.runSync(Effect.makeSemaphore(Math.max(1, run.maxConcurrency))));
    }
  }

  // provider 级独占串行闸(见 docs/runner.md「调度:有界并发」):声明了 exclusive 的 provider
  // (如 local——同一棵真实工作树不允许并发写)按 provider 名共享一把 permit=1 的信号量,
  // --max-concurrency / 实验级 maxConcurrency 都不解除。核心不认 provider 名分支:这里只读
  // resolveSandbox() 折出的中性 `exclusive` 字段;按 provider 字符串分组只是「同一份不可
  // 并发的底层资源用同一把锁」,不是 `provider === "local"` 的行为分支。
  const providerExclusiveSems = new Map<string, Effect.Semaphore>();
  let exclusiveConcurrencyWarned = false;
  const exclusiveSemFor = (spec: SandboxOption | undefined): Effect.Semaphore | undefined => {
    if (!spec) return undefined;
    const resolved = resolveSandbox(spec);
    if (!resolved.exclusive) return undefined;
    let sem = providerExclusiveSems.get(resolved.provider);
    if (!sem) {
      sem = Effect.runSync(Effect.makeSemaphore(1));
      providerExclusiveSems.set(resolved.provider, sem);
    }
    // 如实标注串行事实(一次性,不管命中多少条 attempt):全局上限比 1 高时,这个 provider 的
    // attempt 实际仍然一个一个跑——不管 --max-concurrency 写了多少,这是正确性约束不是调度旋钮。
    if (opts.maxConcurrency > 1 && !exclusiveConcurrencyWarned) {
      exclusiveConcurrencyWarned = true;
      reportDiagnostic({
        key: `provider-exclusive-serial:${resolved.provider}`,
        severity: "warning",
        message: t("runner.providerExclusiveSerial", {
          provider: resolved.provider,
          concurrency: opts.maxConcurrency,
        }).trimEnd(),
        data: { provider: resolved.provider, concurrency: opts.maxConcurrency },
      });
    }
    return sem;
  };

  // 非沙箱 tracing agent 的共享 OTLP 接收池:被测应用是长驻进程,端点不能随
  // attempt 换 —— receiver 粒度跟被测进程走(每 agent 一个,整个 run 复用),run 结束回收。
  if (!opts.otelPool) {
    opts = { ...opts, otelPool: new OtelReceiverPool(opts.config.telemetry?.port) };
  }

  // 实验级生命周期(见 docs/feature/experiments/architecture.md「实验级生命周期」):
  // setup 整场至多一次——第一个通过派发许可(preflight)的 attempt 触发,后续 attempt 等同一个
  // memoized promise;等待发生在 gated 里、globalSem 之外,不占全局并发位。teardown 是
  // ExperimentDef.teardown 字段,按 per-run 剩余 attempt 计数在最后一个 attempt 收尾后执行,
  // 当且仅当 setup 时点走到过(triggered)——setup 抛错不豁免,未声明 setup 不影响触发;
  // 计数递减挂在 Effect.ensuring 上,中断路径同样递减,teardown 因此必跑。
  interface ExperimentLifecycle {
    /** memoized 的 setup 执行;undefined = 还没有 attempt 触发过。未声明 setup 时为已决议 promise。 */
    setupPromise?: Promise<void>;
    /** setup 时点已走到(第一个通过派发许可的 attempt 已触发本实验生命周期;未声明 setup 也置位)。 */
    triggered: boolean;
    /** setup 抛过错(用独立布尔标记,不能拿 error 值判断——throw undefined 也是失败)。 */
    setupFailed: boolean;
    setupError?: unknown;
    /** teardown 的 memoized 执行体:谁先到(计数归零 / 扫尾 / 强清 drain)谁启动,后到者等
     *  同一个 promise——「恰好一次 + 在飞可等待」的全部机制。undefined = 还没人启动。 */
    teardownPromise?: Promise<void>;
    /** 本实验还没收尾的 attempt 数;归零即触发 teardown。 */
    remaining: number;
    /** 本实验的收尾时点已走到(计数归零 / run 收尾扫尾)。 */
    tornDown: boolean;
  }
  const expLifecycles = new Map<AgentRun, ExperimentLifecycle>();
  for (const a of attempts) {
    if (!a.run.setup && !a.run.teardown) continue;
    let lc = expLifecycles.get(a.run);
    if (!lc)
      expLifecycles.set(a.run, (lc = { triggered: false, setupFailed: false, remaining: 0, tornDown: false }));
    lc.remaining += 1;
  }

  // 实验域诊断累积器(docs/runner.md「实验域诊断持久化」):只接无法归属单 Attempt 的实验
  // 事实——ctx.diagnostic、teardown failed/late、budget-unenforceable。相同 dedupeKey 只在
  // 同一个 experimentId 桶内折叠 count;不同 Experiment 各自独立累计,不跨来源合并。裸 run
  // (没有 experimentId)没有 Snapshot 可挂,直接丢弃不进这个累积器——只留 reportDiagnostic
  // 的运行期反馈。与之配套的收尾时刻(捕捉每个 Experiment 真正完成的那一刻,不是整个
  // Invocation 收尾的那一刻,才诚实)。
  const experimentDiagnostics = new Map<string, DiagnosticRecord[]>();
  const experimentDedupeIndex = new Map<string, Map<string, DiagnosticRecord>>();
  const experimentCompletedAt = new Map<string, string>();
  // experiment 作用域 ctx.fact() 的累加器(与 experimentDiagnostics 同一种「按 experimentId 分桶」
  // 模式):同一实验内后写覆盖先写,与 completedAt 同批在快照封口补写进 SnapshotMeta.facts
  // (见 docs/feature/results/architecture.md#facts运行事实)。没有 experimentId 的裸 run 没有
  // Snapshot 可挂,调用直接丢弃(与 recordExperimentDiagnostic 同一条纪律)。
  const experimentFacts = new Map<string, Record<string, FactValue>>();
  const recordExperimentFact = (experimentId: string | undefined, key: string, value: FactValue): void => {
    if (!experimentId) return;
    const facts = experimentFacts.get(experimentId) ?? {};
    recordFact(facts, key, value);
    experimentFacts.set(experimentId, facts);
  };
  const recordExperimentDiagnostic = (input: {
    experimentId: string | undefined;
    code: string;
    level: "warning" | "error";
    message: string;
    phase: LifecyclePhase;
    data?: Readonly<Record<string, JsonValue>>;
    command?: string;
    dedupeKey?: string;
  }): void => {
    if (!input.experimentId) return;
    const dedupeIndex = experimentDedupeIndex.get(input.experimentId) ?? new Map<string, DiagnosticRecord>();
    experimentDedupeIndex.set(input.experimentId, dedupeIndex);
    if (input.dedupeKey !== undefined) {
      const existing = dedupeIndex.get(input.dedupeKey);
      if (existing) {
        existing.count = (existing.count ?? 1) + 1;
        return;
      }
    }
    const record: DiagnosticRecord = {
      code: input.code,
      level: input.level,
      message: input.message,
      phase: input.phase,
      ...(input.data !== undefined ? { data: input.data } : {}),
      ...(input.command !== undefined ? { command: input.command } : {}),
    };
    if (input.dedupeKey !== undefined) dedupeIndex.set(input.dedupeKey, record);
    const list = experimentDiagnostics.get(input.experimentId) ?? [];
    list.push(record);
    experimentDiagnostics.set(input.experimentId, list);
  };
  // 强杀后的收尾兜底(docs/feature/experiments/architecture.md「强杀后的收尾兜底」)的磁盘登记
  // 挂在结果根下,与留存注册表 `.niceeval/sandboxes/` 同一个根(省略时退回 cwd/.niceeval,
  // 与 attempt.ts 的 niceevalRoot 兜底同一口径)。
  const niceevalRoot = opts.niceevalRoot ?? `${process.cwd()}/.niceeval`;
  const currentHost = hostname();
  const makeExperimentHookContext = (run: AgentRun, phase: LifecyclePhase): ExperimentHookContext => {
    const experimentId = run.experimentId ?? run.agent.name;
    return {
      experimentId: run.experimentId ?? "",
      selectedEvalIds: run.selectedEvalIds,
      signal: opts.signal,
      // progress 是短命状态:只更新本实验运行级行的 detail,不属于任何 attempt 的 active 条目。
      progress: (u) => {
        const suffix = u.current !== undefined && u.total !== undefined ? ` (${u.current}/${u.total})` : "";
        reportExperimentProgress({ experimentId, detail: `${u.message}${suffix}` });
      },
      // diagnostic 双落:运行级永久事件流(即时反馈,人/agent/ci 都能看到)+ 实验域诊断累积器
      // (持久化,该 Experiment 的 Snapshot 封口时一次写入)——两条通路相互独立,互不派生
      // (docs/runner.md「实验域诊断持久化」)。实验级钩子的事实不属于任何单个 Attempt,不落
      // result.json。
      diagnostic: (input) => {
        reportDiagnostic({
          key: input.dedupeKey ?? `${input.code}:experiment:${experimentId}`,
          severity: input.level,
          message: input.message,
          data: { experimentId, ...(input.data ?? {}) },
        });
        recordExperimentDiagnostic({
          experimentId: run.experimentId,
          code: input.code,
          level: input.level,
          message: input.message,
          phase,
          ...(input.data !== undefined ? { data: input.data } : {}),
          ...(input.dedupeKey !== undefined ? { dedupeKey: input.dedupeKey } : {}),
        });
      },
      fact: (key, value) => recordExperimentFact(run.experimentId, key, value),
    };
  };
  const runExperimentTeardown = (run: AgentRun, lc: ExperimentLifecycle): Promise<void> => {
    // memoized 一次性执行体(docs/cli.md「中断:三级响应」):正常路径(计数归零 / run 收尾
    // 扫尾)、强清 drain、崩溃路径谁先到都启动同一个 promise,后到者等到同一个结果——
    // 不双跑、也不空转;注册表条目在 settle 后注销,drain 因此能等待在飞中的 teardown。
    lc.teardownPromise ??= (async () => {
      const experimentId = run.experimentId ?? run.agent.name;
      try {
        // 触发规则(docs/feature/experiments/architecture.md):setup 时点没走到(一个 attempt
        // 都没通过派发许可)则跳过;setup 抛错不豁免——半初始化现场同样要扫尾。
        if (!lc.triggered || !run.teardown) return;
        // 与 setup 串行:setup 仍在飞(极端时序:全部 attempt 在 setup 完成前被中断收尾)时等它
        // settle 再收尾;setupPromise 自带 catch(失败收进 setupFailed),这里不会 reject。
        await lc.setupPromise;
        // 起止由 runner 发布,不依赖钩子自己调 progress(见 cli.md「实验级钩子的显示」)。
        reportExperimentHook({ experimentId, hook: "teardown", status: "started" });
        const startedAt = Date.now();
        try {
          // 有界执行(docs/cli.md 的有界性前提):挂起的 teardown 到点按失败收束,不能无限拖住
          // 退出;超时后遗留的 promise 悬空,随进程退出消亡。
          const ctx = makeExperimentHookContext(run, "experiment.teardown");
          await withCleanupTimeout(() => run.teardown!(ctx));
          reportExperimentHook({ experimentId, hook: "teardown", status: "done", durationMs: Date.now() - startedAt });
        } catch (e) {
          reportExperimentHook({ experimentId, hook: "teardown", status: "failed", durationMs: Date.now() - startedAt });
          // teardown 失败只作运行级诊断,不改任何已产出的 verdict(与 sandbox.teardown 的
          // teardown-failed 同一语义);资源可能泄漏,所以要说出来。同时进实验域诊断累积器,
          // 供该 Experiment 的 Snapshot 封口时持久化(docs/runner.md「实验域诊断持久化」)。
          const message = t("runner.experimentTeardownFailed", {
            experimentId,
            message: e instanceof Error ? e.message : String(e),
          }).trimEnd();
          reportDiagnostic({ key: `experiment-teardown-failed:${experimentId}`, severity: "warning", message, data: { experimentId } });
          recordExperimentDiagnostic({
            experimentId: run.experimentId,
            code: "experiment-teardown-failed",
            level: "warning",
            message,
            phase: "experiment.teardown",
          });
        }
        // 这个 Experiment 真正走完了 teardown(不论成败)的时刻——诚实的 Snapshot completedAt,
        // 不是整个 Invocation 收尾那一刻(见下方 experiment:complete 事件的发送处)。
        experimentCompletedAt.set(experimentId, new Date().toISOString());
      } finally {
        // settle 后才注销:drain 的「启动全部未启动 + 等待全部未 settle」依赖条目在飞期间仍可见。
        unregisterExperimentTeardown(experimentId);
        // 磁盘镜像同一时点删除(所有触发路径:完成 / 中断 / 强清 drain 都经这条 finally)——
        // 不变量:磁盘上存在登记,当且仅当某次 run 的实验级收尾义务尚未完成(docs/feature/
        // experiments/architecture.md「强杀后的收尾兜底」)。没写过(裸 run / 无 teardown)
        // 时删除是 no-op。
        if (run.experimentId) {
          await removeTeardownRegistrationIfPresent(
            niceevalRoot,
            teardownEntryId(run.experimentId, process.pid),
          ).catch(() => {});
        }
      }
    })();
    return lc.teardownPromise;
  };
  /**
   * 启动自愈:本实验触发 setup 之前,先核对磁盘上是否有它自己的遗留登记——上一次运行同一
   * experimentId 被强杀、来不及删除。同宿主且 pid 已死才是遗留义务;pid 活或异宿主可能是
   * 并发 run,不触碰。先原子删登记拿到执行权,再补执行一次它的 teardown(新进程语义:
   * ctx.selectedEvalIds 从登记恢复,不依赖已丢失的 setup 产物)。失败只记诊断,不阻断、
   * 不重试本次 run 的调度——recovery 补偿的是上一次的泄漏,不是这一次的前提条件。
   */
  const recoverStaleTeardownRegistration = async (run: AgentRun, experimentId: string): Promise<void> => {
    if (!run.experimentId || !run.teardown) return;
    let registrations;
    try {
      registrations = await readTeardownRegistrations(niceevalRoot);
    } catch {
      return;
    }
    for (const { id, entry } of registrations) {
      if (entry.experimentId !== run.experimentId || !isStaleTeardownRegistration(entry, currentHost)) continue;
      const claimed = await removeTeardownRegistrationIfPresent(niceevalRoot, id).catch(() => false);
      if (!claimed) continue; // 已被另一个进程抢先删除,义务已被别处接手
      reportExperimentHook({ experimentId, hook: "teardown", status: "started", recovery: true });
      const startedAt = Date.now();
      const recoveryCtx: ExperimentHookContext = {
        experimentId,
        selectedEvalIds: entry.selectedEvalIds,
        signal: opts.signal ?? new AbortController().signal,
        progress: (u) => {
          const suffix = u.current !== undefined && u.total !== undefined ? ` (${u.current}/${u.total})` : "";
          reportExperimentProgress({ experimentId, detail: `${u.message}${suffix}` });
        },
        diagnostic: (input) => {
          reportDiagnostic({
            key: input.dedupeKey ?? `${input.code}:experiment:${experimentId}`,
            severity: input.level,
            message: input.message,
            data: { experimentId, ...(input.data ?? {}) },
          });
          recordExperimentDiagnostic({
            experimentId: run.experimentId,
            code: input.code,
            level: input.level,
            message: input.message,
            phase: "experiment.teardown",
            ...(input.data !== undefined ? { data: input.data } : {}),
            ...(input.dedupeKey !== undefined ? { dedupeKey: input.dedupeKey } : {}),
          });
        },
        fact: (key, value) => recordExperimentFact(run.experimentId, key, value),
      };
      try {
        await withCleanupTimeout(() => run.teardown!(recoveryCtx));
        reportExperimentHook({
          experimentId,
          hook: "teardown",
          status: "done",
          durationMs: Date.now() - startedAt,
          recovery: true,
        });
      } catch (e) {
        reportExperimentHook({
          experimentId,
          hook: "teardown",
          status: "failed",
          durationMs: Date.now() - startedAt,
          recovery: true,
        });
        const message = t("runner.experimentTeardownFailed", {
          experimentId,
          message: e instanceof Error ? e.message : String(e),
        }).trimEnd();
        reportDiagnostic({ key: `experiment-teardown-failed:${experimentId}`, severity: "warning", message, data: { experimentId } });
        recordExperimentDiagnostic({
          experimentId: run.experimentId,
          code: "experiment-teardown-failed",
          level: "warning",
          message,
          phase: "experiment.teardown",
        });
      }
    }
  };
  const ensureExperimentSetup = (a: Attempt): Promise<void> => {
    const lc = expLifecycles.get(a.run)!;
    if (!lc.setupPromise) {
      const run = a.run;
      const experimentId = run.experimentId ?? run.agent.name;
      lc.triggered = true;
      // teardown 从触发时点起就静态可达:立即登记进宿主机侧兜底表,setup 挂起 / 抛错都不会
      // 丢收尾——强清退出(二次中断/看门狗/崩溃路径)时 cli 由此排空未被运行路径消费的
      // teardown(docs/cli.md「中断:三级响应」)。
      if (run.teardown) registerExperimentTeardown(experimentId, () => runExperimentTeardown(run, lc));
      const ctx = run.setup ? makeExperimentHookContext(run, "experiment.setup") : undefined;
      lc.setupPromise = (async () => {
        // 强杀后的收尾兜底(docs/feature/experiments/architecture.md「强杀后的收尾兜底」):
        // 先核对并补执行本实验自己的遗留登记,再原子写入本次的登记——两步都先于 setup。
        if (run.teardown && run.experimentId) {
          await recoverStaleTeardownRegistration(run, experimentId);
          await writeTeardownRegistration(niceevalRoot, {
            experimentId: run.experimentId,
            selectedEvalIds: run.selectedEvalIds,
            pid: process.pid,
            host: currentHost,
            startedAt: new Date().toISOString(),
          }).catch((e) => {
            const message = t("runner.teardownRegistrationWriteFailed", {
              experimentId,
              message: e instanceof Error ? e.message : String(e),
            }).trimEnd();
            reportDiagnostic({ key: `teardown-registration-write-failed:${experimentId}`, severity: "warning", message, data: { experimentId } });
            recordExperimentDiagnostic({
              experimentId: run.experimentId,
              code: "teardown-registration-write-failed",
              level: "warning",
              message,
              phase: "experiment.setup",
            });
          });
        }
        if (!run.setup) return;
        // 起止由 runner 发布(见 cli.md「实验级钩子的显示」):一个什么都不调的 setup 也必须
        // 可见,不能让「0 running · N queued 长时间不动」看起来像调度卡死。
        reportExperimentHook({ experimentId, hook: "setup", status: "started" });
        const startedAt = Date.now();
        try {
          const returned = (await run.setup!(ctx!)) as unknown;
          if (typeof returned === "function") {
            // 迁移护栏:tsx 用户没有类型检查,旧式「setup 返回 cleanup」会被静默忽略而泄漏资源。
            // best-effort 执行一次返回的函数(把已起的资源收掉),然后按 setup 失败报清晰错误。
            try {
              await withCleanupTimeout(returned as () => unknown);
            } catch {
              // 迁移护栏里的旧式 cleanup 失败不再叠加报错,主错误(下一行)已指明修法。
            }
            throw new Error(
              t("runner.setupReturnedCleanup", {
                layer: `ExperimentDef.setup (${experimentId})`,
                hint: "ExperimentDef.teardown",
              }).trimEnd(),
            );
          }
        } catch (e) {
          reportExperimentHook({ experimentId, hook: "setup", status: "failed", durationMs: Date.now() - startedAt });
          throw e;
        }
        reportExperimentHook({ experimentId, hook: "setup", status: "done", durationMs: Date.now() - startedAt });
      })().catch((e) => {
        lc.setupFailed = true;
        lc.setupError = e;
      });
    }
    return lc.setupPromise;
  };

  // 自愈是「选中实验」的启动期职责，不是首个派发 attempt 的副作用：全携带使 attempts 为空时，
  // 仍必须补上上一进程强杀遗留的收尾。无 teardown 的新定义无法安全补执行，交由 CLI 提醒。
  const recoveredExperimentIds = new Set<string>();
  for (const run of opts.agentRuns) {
    if (!run.experimentId || !run.teardown || recoveredExperimentIds.has(run.experimentId)) continue;
    recoveredExperimentIds.add(run.experimentId);
    await recoverStaleTeardownRegistration(run, run.experimentId);
  }

  // ─────────────────────── 派发许可链(docs/runner.md「调度:有界并发」) ───────────────────────
  // 一条 attempt 要真正开跑,顺序通过四道许可,顺序本身是契约:
  //   ① 止损闸(checkDispatchHalt)→ ② 实验闸(跨 Invocation 逐槽租约)→ ③ 全局并发位
  //   → ④ 派发时刻非阻塞试锁(用例锁)→ preflight → body
  // ②③ 是资源许可,④ 是「这条用例归谁跑」的仲裁。撞上别人持有的新鲜锁时,④ 立刻把 ③ 和 ②
  // 都还回去(不还就会拿着实验闸名额干等持锁方——同一实验的名额域跨 Invocation 共用,
  // maxConcurrency: 1 下这是必然死锁),该用例转 elsewhere 挂起,腾出的位子由排队中的下一条
  // attempt 接手;锁释放/过期后重查携带,仍要自跑的那些从 ① 重新走一遍这条链。

  /**
   * 止损闸检查点 —— **C2 接入点**(plan/runner-dispatch-spine-refactor.md 节点 C2「止损执行体
   * 接入」)。返回「这条 attempt 是否被作者声明的止损闸拦下」:落闸后本 eval / 本实验剩余
   * attempt 不再派发,计入 `unstarted`、完成状态落 `incomplete`
   * (契约见 docs/feature/error-classification/README.md「自愈阶梯与止损阶梯」)。
   *
   * 本节点(C1)只留桩:恒不落闸,派发行为与接入前完全一致。C2 把函数体换成真检查——读该
   * eval 闸 / 该实验闸的 `Effect.makeLatch` 状态(闸在 attempt 封口读终局失败的 scope 时落下,
   * 幂等、invocation 内不可逆、实验闸蕴含全部 eval 闸),并在下面唯一的调用点补上 `unstarted`
   * 记账与 `dispatch-halted` 诊断。调用点每轮循环都会重新问一次:挂起在 elsewhere 的用例被
   * 唤醒后同样先过这道闸,不会绕开已经落下的闸重新入场。
   */
  const checkDispatchHalt = (a: Attempt): { halted: false } | { halted: true; scope: "eval" | "experiment" } => {
    void a;
    return { halted: false };
  };

  const lockIdentity = { pid: process.pid, host: currentHost };
  /** 调度整体收束(forEach 已结算)后置位:兜住被 Effect 抛下的挂起轮询,不让它无主空转。 */
  let dispatchClosed = false;

  /** 可被 abort 打断的定时等待;abort 或到点都以 resolve 收束(调用方自己复查中断状态),
   *  不留悬挂的定时器——真实的用户 Ctrl+C 不能被别人的锁拖着无限期挂住。 */
  const delayOrAbort = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const done = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener("abort", done, { once: true });
    });

  const combinedSignal = (extra: AbortSignal): AbortSignal =>
    opts.signal ? AbortSignal.any([opts.signal, extra]) : extra;

  // 用例锁(docs/feature/experiments/architecture.md「并发 Invocation:用例锁」):按
  // (experimentId, evalId) 给这批已经确定要真实派发的 attempt 分组——被静态携带筛掉的组合
  // 从不出现在 attempts[] 里,天然满足「全携带用例不取锁」;裸 run(无 experimentId)不接入。
  // 一组(runs > 1 的兄弟 attempt)共享同一把锁:谁先到派发时刻谁试,自己已持有的直接放行,
  // 别人持有则全体挂在同一个等待窗口上,不重复试锁、不各自轮询。
  /** 一次非阻塞试锁的结论。`busy` 直接带出这一条用例的挂起窗口——「发现撞锁」与「挂进哪个
   *  窗口」必须是同一步:分成两步的话,兄弟 attempt 归还许可的那几个 microtask 里窗口可能
   *  已经解决并重新取到锁,它再去建窗口就会读到**自己**的新鲜锁、永久等下去。 */
  type CaseLockTry =
    | { kind: "acquired" }
    | { kind: "busy"; window: Promise<void> }
    | { kind: "aborted" };
  interface CaseLockState {
    experimentId: string;
    evalId: string;
    /** 本用例这次计划的全部 attempt;持有者一次认领它们全部,不按 attempt 拆锁。 */
    group: Attempt[];
    /** 还没收尾、也还没被重查携带命中的 attempt 序号——`lock_wait` 的计数与「锁还留不留」都读它。 */
    pending: Set<number>;
    /** 重查携带命中的 attempt 序号(elsewhere → reused,不再派发)。 */
    carried: Set<number>;
    /** 本进程此刻持有的锁;undefined = 没持有(还没试 / 撞锁挂起中)。 */
    claim?: CaseLockClaim;
    /** 在飞的一次非阻塞试锁:同组兄弟共享同一次尝试的结论,不各自拍一遍磁盘。 */
    trying?: Promise<CaseLockTry>;
    /** 在飞的挂起窗口:撞锁的兄弟全体等同一个 promise。 */
    suspension?: Promise<void>;
  }
  const caseLocks = new Map<string, CaseLockState>();
  for (const a of attempts) {
    if (!a.run.experimentId) continue;
    const key = cacheKey(a.run, a.evalDef.id);
    let st = caseLocks.get(key);
    if (!st) {
      st = {
        experimentId: a.run.experimentId,
        evalId: a.evalDef.id,
        group: [],
        pending: new Set<number>(),
        carried: new Set<number>(),
      };
      caseLocks.set(key, st);
    }
    st.group.push(a);
    st.pending.add(a.attempt);
  }
  const caseStateOf = (a: Attempt): CaseLockState | undefined =>
    a.run.experimentId ? caseLocks.get(cacheKey(a.run, a.evalDef.id)) : undefined;

  /** 等待/接管之后值不值得重新读盘查携带。`--force` 下 opts.priorResults 恒为 undefined——
   *  force 关掉的是缓存,等完同样全部自跑;中断路径同样不再读盘。注意这只关掉「重查」,
   *  不关掉挂起窗口的 `resolved` 事件:少发一次 resolved,elsewhere 就永远挂着,五项恒等式
   *  当场破(旧实现在 `--force` + 真实撞锁等待这条组合上就是这么漏的)。 */
  const carryRecheckEnabled = (): boolean => opts.priorResults !== undefined && !opts.signal?.aborted;

  /**
   * 撞锁等待结束、或接管一把过期锁之后,对这个用例**重新做一次携带规划**:对方 Invocation
   * 落盘的终态此刻已可读。判定逐 attempt 进行(见 memory 的
   * carry-must-be-per-attempt-not-whole-eval-key —— 按整段 key 判定会让同 eval 里一个 attempt
   * 的终态连带携入其它序号):命中的序号 elsewhere → reused 不再派发,仍缺的序号
   * elsewhere → queued 自跑。`waitStartedAt` 省略表示这次重查没有对应的挂起窗口(接管路径),
   * 补一个瞬时的 `started` 让计数迁移成立。
   */
  const recheckCarry = async (
    st: CaseLockState,
    waitStartedAt: number | undefined,
    holder: CaseLockRecord | undefined,
  ): Promise<void> => {
    const { experimentId, evalId } = st;
    let startedAt = waitStartedAt;
    if (startedAt === undefined) {
      // 接管一把无人等待的过期锁也要重查,但此刻还没有对应的 "started" 事件——这批 attempt
      // 仍停在 queued(从没被标记过 elsewhere),必须先补一个瞬时的 "started" 才能让下面的
      // "resolved" 把它们正确迁走,否则会永远卡在 queued、打破五项恒等式。
      startedAt = Date.now();
      reportLockWait({
        experimentId,
        evalId,
        status: "started",
        ...(holder?.pid !== undefined ? { holderPid: holder.pid } : {}),
        ...(holder?.host !== undefined ? { holderHost: holder.host } : {}),
        attempts: st.pending.size,
      });
    }
    const pendingBefore = st.pending.size;
    const newlyCarried: number[] = [];
    if (carryRecheckEnabled()) {
      const a0 = st.group[0]!;
      const key = cacheKey(a0.run, evalId);
      const freshPrior = await loadLatestResultsPerEval(niceevalRoot).catch((): EvalResult[] => []);
      const recheck = await planCarry([a0.evalDef], [a0.run], freshPrior, opts.config.sandbox, opts.config.timeoutMs);
      const carriedIndices = recheck.carriedAttemptsByKey.get(key) ?? new Set<number>();
      for (const idx of carriedIndices) {
        if (!st.pending.has(idx)) continue; // 已经跑过 / 上一轮已经携入过的序号不重复计
        st.pending.delete(idx);
        st.carried.add(idx);
        newlyCarried.push(idx);
      }
      for (const r of recheck.carriedResults) {
        if (!newlyCarried.includes(r.attempt)) continue; // 只收本轮新命中的,跨窗口不重复入账
        lateCarriedResults.push(r);
        if (r.verdict === "passed") {
          passedKeys.add(`${experimentId}|${a0.run.agent.name}|${a0.run.model ?? ""}|${evalId}`);
        }
      }
    }
    reportLockWait({
      experimentId,
      evalId,
      status: "resolved",
      carried: newlyCarried.length,
      dispatched: pendingBefore - newlyCarried.length,
      waitedMs: Date.now() - startedAt,
    });
  };

  /**
   * 派发时刻的一次**非阻塞**试锁。非阻塞语义借 `acquireCaseLock` 的 `onWaitStart` 实现:确认
   * 要等待的那一刻立刻自我中断,只保留「一次尝试」的部分——这样仍然复用它的心跳续租与强清
   * 登记(lock.ts 的 held 表),而 `tryAcquireCaseLockOnce` 两件都不做。撞上过期锁属于「一次
   * 尝试」内部的 rename 接管,照常返回 acquired。
   */
  const tryAcquireCase = (st: CaseLockState): Promise<CaseLockTry> => {
    // 同组兄弟:自己已持有,直接放行。
    if (st.claim) return Promise.resolve<CaseLockTry>({ kind: "acquired" });
    // 已经有兄弟挂在窗口上:全体等同一个窗口,不重复试锁。
    if (st.suspension) return Promise.resolve<CaseLockTry>({ kind: "busy", window: st.suspension });
    if (st.trying) return st.trying;
    const attempt = (async (): Promise<CaseLockTry> => {
      const { experimentId, evalId } = st;
      // 接管诊断要报"原持有者是谁",但 acquireCaseLock 只回传 takenOver 布尔值——取锁前先
      // 无副作用地读一眼当前记录(纯尽力而为:极端时序下这份快照可能已经不是真正被接管的
      // 那条记录,但诊断本来就是人读提示,不是判定依据)。
      const priorHolder = await readCaseLock(niceevalRoot, experimentId, evalId).catch(() => undefined);
      const giveUp = new AbortController();
      let busyWith: CaseLockRecord | undefined;
      try {
        const { claim, takenOver } = await acquireCaseLock(niceevalRoot, experimentId, evalId, lockIdentity, {
          signal: combinedSignal(giveUp.signal),
          onWaitStart: (h) => {
            busyWith = h;
            giveUp.abort(); // 撞上新鲜锁 = 这次尝试到此为止,不进入 acquireCaseLock 自己的轮询
          },
        });
        st.claim = claim;
        if (takenOver) {
          const message = t("runner.lockTakenOver", {
            experimentId,
            evalId,
            pid: priorHolder?.pid ?? "?",
            host: priorHolder?.host ?? "?",
          }).trimEnd();
          reportDiagnostic({
            key: `lock-taken-over:${experimentId}|${evalId}`,
            severity: "warning",
            message,
            data: { experimentId, evalId },
          });
          recordExperimentDiagnostic({
            experimentId,
            code: "lock-taken-over",
            level: "warning",
            message,
            phase: "eval.run",
            dedupeKey: `lock-taken-over:${experimentId}|${evalId}`,
            data: { experimentId, evalId },
          });
          // 接管说明上一个持有者死在半路:它可能已经落盘了一部分终态,重查一次携带。
          // 无携带可消费(--force / 中断)时整段跳过——这条路径还没有对应的挂起窗口要关,
          // 不必为一次注定空手而归的重查凭空造一对 elsewhere 进出。
          if (carryRecheckEnabled()) await recheckCarry(st, undefined, priorHolder);
        }
        return { kind: "acquired" };
      } catch (e) {
        // 撞新鲜锁:就地开(或加入)挂起窗口,窗口对象随结论一起交给调用方。
        if (busyWith) return { kind: "busy", window: suspendUntilCaseFree(st, busyWith) };
        if (opts.signal?.aborted) return { kind: "aborted" };
        throw e;
      }
    })();
    st.trying = attempt;
    return attempt.finally(() => {
      st.trying = undefined;
    });
  };

  /**
   * 撞新鲜锁后的挂起窗口:这一条用例转 `elsewhere`(不占全局并发位、不占实验闸名额),每个
   * 心跳周期重读一次锁文件;锁消失(正常释放)或过期(可接管)即结束等待并重查携带。等待没有
   * 超时——心跳新鲜就一直等,用户中断照常退出。同组兄弟共享同一个窗口。
   */
  const suspendUntilCaseFree = (st: CaseLockState, holder: CaseLockRecord): Promise<void> => {
    if (st.suspension) return st.suspension;
    const startedAt = Date.now();
    reportLockWait({
      experimentId: st.experimentId,
      evalId: st.evalId,
      status: "started",
      holderPid: holder.pid,
      holderHost: holder.host,
      attempts: st.pending.size,
    });
    const window = (async (): Promise<void> => {
      for (;;) {
        await delayOrAbort(CASE_LOCK_HEARTBEAT_INTERVAL_MS, opts.signal);
        if (opts.signal?.aborted || dispatchClosed) break;
        const record = await readCaseLock(niceevalRoot, st.experimentId, st.evalId).catch(() => undefined);
        if (record === undefined || isCaseLockStale(record, Date.now())) break;
      }
      await recheckCarry(st, startedAt, holder);
    })();
    st.suspension = window.finally(() => {
      st.suspension = undefined;
    });
    return st.suspension;
  };

  /** 用例全部 attempt(不论真实派发还是被重查携带命中而跳过)都 settle 后删锁;与
   *  expLifecycles.remaining 归零触发 teardown 同一种「逐 attempt 收尾时递减,归零触发」模式。 */
  const releaseCaseLockIfDone = async (st: CaseLockState, attempt: number): Promise<void> => {
    st.pending.delete(attempt);
    if (st.pending.size > 0) return;
    const claim = st.claim;
    st.claim = undefined;
    if (claim) await claim.release().catch(() => {});
  };

  /**
   * 实验闸的取位:声明了 `maxConcurrency` 的实验从**跨 Invocation 共用**的逐槽租约取名额
   * (gate-lease.ts);未声明的实验不走租约、不产生任何跨进程协调。取位在全局位之前——等名额
   * 的 attempt 不占别的实验的并发位。返回 undefined 表示等待期间被中断,这条 attempt 就此放弃。
   */
  const acquireGateLease = async (
    experimentId: string,
    maxConcurrency: number,
    fiberSignal: AbortSignal,
  ): Promise<GateLeaseClaim | undefined> => {
    const signal = combinedSignal(fiberSignal);
    try {
      const { claim, takenOver, takenOverFrom } = await acquireGateSlot(
        niceevalRoot,
        experimentId,
        maxConcurrency,
        lockIdentity,
        { signal },
      );
      if (takenOver) {
        const message = t("runner.gateLeaseTakenOver", {
          experimentId,
          slot: claim.slot,
          pid: takenOverFrom?.pid ?? "?",
          host: takenOverFrom?.host ?? "?",
        }).trimEnd();
        const dedupeKey = `gate-lease-taken-over:${experimentId}`;
        reportDiagnostic({ key: dedupeKey, severity: "warning", message, data: { experimentId } });
        recordExperimentDiagnostic({
          experimentId,
          code: "gate-lease-taken-over",
          level: "warning",
          message,
          phase: "eval.run",
          dedupeKey,
          data: { experimentId, slot: claim.slot },
        });
      }
      return claim;
    } catch (e) {
      if (signal.aborted) return undefined; // 等名额期间被中断:立刻退出,不留悬挂
      throw e;
    }
  };

  /** 派发链一轮的结局:`done` = 这条 attempt 已经了结(跑完 / 被跳过 / 携入 / 中断),
   *  `suspend` = 撞上别人持有的用例锁,许可全部归还、挂进 `window` 这个 elsewhere 窗口后重来。 */
  type DispatchOutcome = { kind: "done" } | { kind: "suspend"; window: Promise<void> };

  /** 全局并发位的显式持有句柄:`withPermits` 的作用域语义没法表达「中途让位、回来再拿」,
   *  而实验级 setup 与 turn 退避都要求让位(docs/runner.md「调度:有界并发」)。两个成员都
   *  幂等——让位后收尾 finalizer 不会重复归还,回来之后中断也只归还一次。 */
  interface GlobalSlotHold {
    readonly release: Effect.Effect<void>;
    readonly reacquire: Effect.Effect<void>;
  }

  const withGlobalSlot = <A>(use: (slot: GlobalSlotHold) => Effect.Effect<A>): Effect.Effect<A> =>
    Effect.uninterruptibleMask((restore) => {
      const state = { held: false };
      const release = Effect.suspend(() =>
        state.held
          ? globalSem.release(1).pipe(
              Effect.map(() => {
                state.held = false;
              }),
            )
          : Effect.void,
      );
      const reacquire = Effect.suspend(() =>
        state.held
          ? Effect.void
          : globalSem.take(1).pipe(
              Effect.map(() => {
                state.held = true;
              }),
            ),
      );
      // 取位本身可中断(restore):Ctrl+C 不该被「等一个全局位」拖住;拿到之后的执行体同样
      // 可中断,只有归还挂在 ensuring 上,中断路径照样跑。
      return restore(reacquire).pipe(
        Effect.flatMap(() => restore(use({ release, reacquire })).pipe(Effect.ensuring(release))),
      );
    });

  /**
   * 实验闸(② 道许可)的持有作用域:名额与 attempt **同生命周期**——从这里持有到执行体收尾
   * (teardown 链、沙箱销毁)之后才归还,turn 退避等内部等待一律不释放
   * (docs/runner.md「调度:有界并发」)。撞用例锁挂起是唯一的例外:那时执行体以 `suspend`
   * 正常返回,作用域退出、名额归还,挂起结束后重新取——挂起的用例不占名额,否则同实验的
   * 持锁方(可能就在另一条 Invocation 里)会被自己的等待方饿死。
   */
  const withExperimentGate = (
    a: Attempt,
    use: Effect.Effect<DispatchOutcome>,
  ): Effect.Effect<DispatchOutcome> => {
    const { maxConcurrency, experimentId } = a.run;
    const localSem = gateLocalSems.get(a.run);
    if (maxConcurrency === undefined || localSem === undefined) return use;
    if (experimentId === undefined) return localSem.withPermits(1)(use);
    const leased = Effect.uninterruptibleMask((restore) =>
      restore(Effect.promise((sig) => acquireGateLease(experimentId, maxConcurrency, sig))).pipe(
        Effect.flatMap((claim) =>
          claim === undefined
            ? Effect.succeed<DispatchOutcome>({ kind: "done" })
            : restore(use).pipe(
                Effect.ensuring(Effect.promise(() => claim.release().catch(() => {}))),
              ),
        ),
      ),
    );
    return localSem.withPermits(1)(leased);
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
  // 并发上限由上面那条许可链把守——执行体依次过止损闸、实验闸(若有)、全局 permit、
  // 派发时刻试锁才开跑。获取定序恒为 实验闸 → globalSem → 用例锁,无环等待;实验闸的
  // 持有者在等全局 permit 时不占别的实验的并发位(并发位就是 globalSem 的 permit,
  // 不再是 forEach 的 fiber 槽)。
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
        const caseState = caseStateOf(a);

        // preflight:「要不要开始跑」的许可判断(首过即停 + budget 上限检查)。两类判断都是
        // 即时返回、不做任何等待,所以放在授位之后没有「占着全局并发槽位干等」的问题;放在
        // 派发时刻(而不是排队时刻)判,读到的是这一刻最新的通过集与已花费。
        const preflight = Effect.gen(function* () {
            // 首过即停:只由 passed 触发(errored 不中止其余样本,见 docs/feature/experiments/
            // architecture.md「调度接口」)。
            if (a.run.earlyExit && passedKeys.has(a.key)) {
              yield* reportMutex.withPermits(1)(
                Effect.promise(() =>
                  emitReporterEvent(reporters, {
                    type: "invocation:earlyExit",
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
                      emitReporterEvent(reporters, { type: "invocation:budgetExceeded", budget, spent: s.spent }),
                    ),
                  );
                }
                // 反馈层:对每一个因预算到顶而不派发的 attempt 各发一次(与上面的
                // attempt:early-exit 同构),让 RunFeedbackState 的 queued/completed 计数与
                // cli.ts 的 assembleRunCompletion() 都能感知到「有 attempt 因预算未派发」——
                // 上面 emitReporterEvent 的 invocation:budgetExceeded 只对旧版 Reporter 接口每
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

        // body:许可链全部通过之后才跑,真正的执行段。
        const body = (slot: GlobalSlotHold) =>
          Effect.gen(function* () {
            // 合并全局信号与本 eval 的首过即停信号:任一 abort → 本 attempt 的信号 abort。
            const evalAc = evalAbortControllers.get(a.key);
            const attemptSignal =
              evalAc && opts.signal
                ? AbortSignal.any([opts.signal, evalAc.signal])
                : (evalAc?.signal ?? opts.signal);

            // turn 级重试退避期间释放/收回的并发槽位——两级闸按持有期分工的单点契约见
            // docs/runner.md「调度:有界并发」与 docs/feature/error-classification/
            // architecture.md「退避与槽位」:这里只释放/收回全局并发位(globalSem),它管
            // 吞吐,内部等待一律让位。实验闸管正确性,名额与 attempt 同生命周期、退避这类
            // 内部等待不释放——继续由外层的租约(或裸 run 的回退信号量)全程持有,这个槽位
            // 对象因此不接触实验闸,否则同实验的下一个 attempt 会趁退避窗口提前进场,击穿
            // maxConcurrency: 1 的串行契约(bug 台账见
            // memory/turn-retry-backoff-releases-experiment-serial-lock.md)。
            // 走 slot 的显式持有对象(而不是直接 take/release 信号量):让「谁此刻还握着位子」
            // 只有一份真相,退避期间被中断时收尾 finalizer 才不会重复归还一个已经让出的位。
            const concurrencySlot: ConcurrencySlot = {
              release: async () => {
                await Effect.runPromise(slot.release);
              },
              reacquire: async () => {
                await Effect.runPromise(slot.reacquire);
              },
            };

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
              : yield* runAttemptEffect(a, opts, sandboxSem, { parentSignal: attemptSignal, concurrencySlot });
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
                  {
                    const message = t("runner.budgetUnenforceable", { budgetKey }).trimEnd();
                    reportDiagnostic({ key: `budget-unenforceable:${budgetKey}`, severity: "warning", message, data: { budgetKey } });
                    recordExperimentDiagnostic({
                      experimentId: a.run.experimentId,
                      code: "budget-unenforceable",
                      level: "warning",
                      message,
                      phase: "eval.run",
                      data: { budgetKey },
                    });
                  }
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
        // ③ 全局并发位 → ④ 派发时刻试锁 → preflight → 实验级 setup → body。
        // 独占串行 provider(如 local):同一 provider 名的所有 attempt 共享一把 permit=1 的锁,
        // 包在全局位之外(见上面 exclusiveSemFor 的注释)。
        const exclusiveSem = exclusiveSemFor(a.sandboxSpec);
        const dispatch = withGlobalSlot((slot) =>
          Effect.gen(function* () {
            // 派发时刻取锁:授位之后才试,非阻塞。撞上别人持有的新鲜锁就把这个位子连同实验闸
            // 名额一起还回去(返回 "suspend"),由外层转入 elsewhere 挂起;位子当场空出来,
            // 排队中的下一条没被锁的用例接手。
            if (caseState) {
              const outcome = yield* Effect.promise(() => tryAcquireCase(caseState));
              if (outcome.kind === "aborted") return { kind: "done" } as const;
              if (outcome.kind === "busy") return { kind: "suspend", window: outcome.window } as const;
              // 接管过期锁时顺带重查过携带:这个序号已经被对方跑完,不重复派发。
              if (caseState.carried.has(a.attempt)) return { kind: "done" } as const;
            }
            const proceed = yield* preflight;
            if (!proceed) return { kind: "done" } as const;
            if (a.run.setup || a.run.teardown) {
              // 实验级 setup:第一个通过派发许可的 attempt 真正执行,其余等同一个 memoized
              // promise(它从不 reject——失败收进 lc.setupFailed,由 body 合成 errored 结果)。
              // 等它的时候让出全局并发位(docs/runner.md「调度:有界并发」——内部等待一律让位,
              // 慢启动的 setup 不许饿死同批其它实验),回来再重新拿位。实验闸名额不让。
              yield* slot.release;
              yield* Effect.promise(() => ensureExperimentSetup(a));
              yield* slot.reacquire;
            }
            yield* body(slot);
            return { kind: "done" } as const;
          }),
        );
        const guarded = exclusiveSem ? exclusiveSem.withPermits(1)(dispatch) : dispatch;

        // 许可链的循环外壳:撞锁挂起的用例解决后从 ① 重新走一遍(实验闸名额与全局位都要
        // 重新取,不能拿着别人在等的名额干等),携入的直接收工。
        const pipeline = Effect.gen(function* () {
          for (;;) {
            // ① 止损闸(C1 桩:恒不落闸;C2 换真检查)。
            if (checkDispatchHalt(a).halted) return;
            // ② 实验闸 → ③ 全局位 → ④ 用例锁 → preflight → body
            const outcome = yield* withExperimentGate(a, guarded);
            if (outcome.kind === "done") return;
            // ② ③ 已随作用域归还。挂起等锁:不占并发位、计入 elsewhere;锁释放或过期后重查
            // 携带——携入的收工,仍要自跑的按原优先级回到派发队列(下一轮循环)。
            yield* Effect.promise(() => outcome.window);
            if (caseState!.carried.has(a.attempt)) return;
            if (opts.signal?.aborted) return;
          }
        });
        // 实验级 teardown 计数:每个 attempt 收尾(含被 preflight 跳过、被中断的、被用例锁
        // late-carry 跳过的)都递减,归零触发 ExperimentDef.teardown。ensuring 在中断路径
        // 同样执行,teardown 因此必跑。
        const withExpLifecycle =
          !a.run.setup && !a.run.teardown
            ? pipeline
            : pipeline.pipe(
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
        if (!caseState) return withExpLifecycle;
        // 用例锁释放:这个 key 的全部 attempt(真实派发的与被 late-carry 跳过的)都 settle 后
        // 删锁,与上面的实验级 teardown 计数同一种「逐 attempt 收尾时递减,归零触发」模式,
        // 挂在最外层确保晚于实验级 teardown 计数结算(docs「用例全部 attempt 收尾(含沙箱销毁)
        // 后删除自己的锁」)。
        return withExpLifecycle.pipe(
          Effect.ensuring(Effect.promise(() => releaseCaseLockIfDone(caseState, a.attempt))),
        );
      },
      { concurrency: "unbounded", discard: true },
    ).pipe(
      // 中断(用户 Ctrl+C):finalizer 已在中断过程中跑完(容器已停),这里只是把它咽下,
      // 好让流程走到 summarize / onInvocationComplete,用已完成的 results 出一份部分汇总,而不是抛栈。
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
  // 调度已经结算:任何被中断路径抛下的挂起轮询到下一个心跳周期自行收束,不无主空转。
  dispatchClosed = true;
  await opts.otelPool?.close();

  // 实验级 teardown 兜底扫尾:正常路径由 per-attempt ensuring 的计数归零触发(见上),但一次
  // 真实批跑观察到过计数路径未触发的间歇现象(根因未定位,排查记录见 memory 的
  // experiment-teardown-missed-once-in-batch)。走到这里时 forEach 的全部 fiber 连同 finalizer
  // 都已结算,任何 tornDown 仍为 false 的实验都意味着泄漏;在此强制收尾并报警示诊断——
  // 扫尾幂等(cleanup 消费一次性),宁可多一道兜底,不把宿主机资源(隧道/容器)留给用户手拆。
  // 真·缺陷抛出前同样要扫(finalizer 语义,见 docs/feature/experiments/architecture.md
  // 「实验级生命周期」);cli 的 main().catch() 只兜沙箱,不知道实验级 cleanup 的存在。
  const sweepExperimentTeardowns = async (): Promise<void> => {
    for (const [run, lc] of expLifecycles) {
      if (lc.tornDown) continue;
      lc.tornDown = true;
      // 无事可扫:没触发过 / 没声明 teardown——静默跳过。
      if (!lc.triggered || !run.teardown) continue;
      // 只有扫尾是启动者时才报「late」诊断;已在飞的(如强清 drain 先到)只等 settle,不算漏。
      if (!lc.teardownPromise) {
        const experimentId = run.experimentId ?? run.agent.name;
        const message = t("runner.experimentTeardownLate", { experimentId }).trimEnd();
        reportDiagnostic({ key: `experiment-teardown-late:${experimentId}`, severity: "warning", message, data: { experimentId, remaining: lc.remaining } });
        recordExperimentDiagnostic({
          experimentId: run.experimentId,
          code: "experiment-teardown-late",
          level: "warning",
          message,
          phase: "experiment.teardown",
          data: { remaining: lc.remaining },
        });
      }
      await runExperimentTeardown(run, lc);
    }
  };
  if (Exit.isFailure(exit)) {
    // signal abort 或 cause 含中断 → 当作用户中断,走部分汇总;否则是真·缺陷,照常抛出。
    if (opts.signal?.aborted || Cause.isInterrupted(exit.cause)) {
      interrupted = true;
    } else {
      await sweepExperimentTeardowns();
      throw Cause.squash(exit.cause);
    }
  }
  if (interrupted) reportInterrupted();
  await sweepExperimentTeardowns();

  // Experiment 收尾协议(docs/runner.md):每个真正出现在这次 Invocation 里的 experimentId
  // 各发一次 experiment:complete,携带它自己的 completedAt(真实 teardown 完成时刻,没有
  // teardown 或未触发时退回当前时刻)与实验域诊断累积器里attribute 给它的记录。全部
  // Experiment 此刻都已经收尾(sweepExperimentTeardowns 已经等过),严格早于下面的
  // invocation:summary——供 Artifacts 据此对每个 Snapshot 原子封口,不用等到整个 Invocation
  // 结束才一次性全部封口(interrupted、reporter error 等 Invocation 级事实不在这条通道里,
  // 不会误落进任一 Snapshot)。
  const invocationExperimentIds = new Set(
    opts.agentRuns.map((r) => r.experimentId).filter((id): id is string => id !== undefined),
  );
  for (const experimentId of invocationExperimentIds) {
    await emitReporterEvent(reporters, {
      type: "experiment:complete",
      experimentId,
      completedAt: experimentCompletedAt.get(experimentId) ?? new Date().toISOString(),
      // 静态携带(启动时已知)与用例锁释放/接管后重查携带命中的迟到携带(lateCarriedResults)
      // 对 Artifacts 封口而言是同一种东西——都是"这个 Experiment 本次没有真实执行、但要计入
      // 快照的终态结果",合并后一起按 experimentId 过滤。
      carriedResults: [...carriedResults, ...lateCarriedResults].filter((r) => r.experimentId === experimentId),
      diagnostics: experimentDiagnostics.get(experimentId) ?? [],
      ...(experimentFacts.has(experimentId) ? { facts: experimentFacts.get(experimentId) } : {}),
      name: opts.config.name,
    });
  }

  // 稳定排序:按发现顺序 + attempt;携带结果(静态 + 用例锁迟到携带)并入后一起排
  const order = new Map(opts.evals.map((e, i) => [e.id, i]));
  const allResults = [...carriedResults, ...lateCarriedResults, ...results];
  allResults.sort(
    (a, b) =>
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) ||
      a.agent.localeCompare(b.agent) ||
      a.attempt - b.attempt,
  );

  const summary = summarize(allResults, startedAt, Date.now() - t0, opts.config.name);
  await emitReporterEvent(reporters, { type: "invocation:summary", summary });
  for (const reg of reporters) {
    // required reporter(默认 artifacts、显式 --json/--junit)在这一步失败,不能中断其它
    // reporter 的收尾——继续跑完剩下的循环,让每个 reporter 都拿到 onInvocationComplete 的机会;
    // 失败本身经 runReporter → reportReporterError 折成诊断,由调用方(cli.ts)读取
    // RunFeedbackState 组装成 InvocationCompletion,让最终 completion/退出码判红(见
    // docs/feature/experiments/cli.md「运行完成状态不只看 verdict 计数」)。
    await runReporter(reg, "onInvocationComplete", () => reg.reporter.onInvocationComplete?.(summary));
  }
  await emitReporterEvent(reporters, { type: "invocation:saved", summary });
  return summary;
}
