// 运行器:发现产出的 eval × agent × runs → attempt,有界并发调度,把每个 attempt
// 跑成一个 EvalResult。沙箱编排的固定段在这里(起沙箱→上传→基线→setup→驱动 agent→
// 采 diff→跑脚本→评分→判决→停沙箱),adapter 只填「把 agent 跑起来」一段。

import { resolve as resolvePath } from "node:path";
import { Effect, Cause, Duration, Exit } from "effect";
import { createSandbox, sandboxLabel } from "../sandbox/resolve.ts";
import { createTraceReceiver, type TraceReceiver } from "../o11y/otlp/receiver.ts";
import { createInSandboxTraceReceiver } from "../o11y/otlp/sandbox-receiver.ts";
import { selectTraceSpans, enrichTraceWithIO } from "../o11y/otlp/select.ts";
import { mapSpansToCanonical } from "../o11y/otlp/mappers/index.ts";
import { createEvalContext } from "../context/context.ts";
import { EvalRequirementFailed, EvalSkipped, TurnFailed } from "../context/control-flow.ts";
import { computeOutcome, computeVerdict } from "../scoring/verdict.ts";
import { probeJudge } from "../scoring/judge.ts";
import { deriveRunFacts, buildO11ySummary } from "../o11y/derive.ts";
import { t } from "../i18n/index.ts";
import {
  captureGeneratedFiles,
  collectWorkspaceFiles,
  initGitAndCommit,
  isDirectory,
} from "./sandbox-prep.ts";
import type {
  Agent,
  AgentContext,
  Cleanup,
  Config,
  DiscoveredEval,
  EvalResult,
  JudgeConfig,
  LifecycleHooks,
  Reporter,
  RunShape,
  RunContext,
  RunSummary,
  Sandbox,
  SandboxOption,
  ScoringContext,
  ScriptResult,
  Telemetry,
  TraceSpan,
  Verdict,
} from "../types.ts";

/** 一个 (agent, model, flags) 的运行配置 —— 由 CLI / 实验展开。 */
export interface AgentRun {
  agent: Agent;
  model?: string;
  flags: Record<string, unknown>;
  runs: number;
  earlyExit: boolean;
  sandbox?: SandboxOption;
  timeoutMs?: number;
  budget?: number;
  evalFilter: (id: string) => boolean;
  experimentId?: string;
  /** 实验级生命周期钩子(叠加在 config.hooks 之上);run 作用域按 experimentId 各跑一次,
   *  sandbox 作用域每个 attempt 跑一次。来自 ExperimentDef.hooks,由 CLI 透传。 */
  hooks?: LifecycleHooks;
}

export interface RunOptions {
  config: Config;
  evals: DiscoveredEval[];
  agentRuns: AgentRun[];
  reporters: Reporter[];
  maxConcurrency: number;
  signal?: AbortSignal;
  /** TTY live display 的进度回调;设置后 attempt 的 log 消息路由到它而不是 stderr。 */
  onProgress?: (evalId: string, who: string, msg: string) => void;
}

interface Attempt {
  evalDef: DiscoveredEval;
  run: AgentRun;
  attempt: number;
  key: string; // agent+model+evalId,用于早停
}

export async function runEvals(opts: RunOptions): Promise<RunSummary> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // 预检 judge:有显式配置时在第一步验证 API key + 端点可达,避免跑完 agent 才发现 judge 不通。
  {
    const seen = new Set<string>();
    const toProbe: JudgeConfig[] = [];
    for (const jc of [opts.config.judge, ...opts.evals.map((e) => e.judge)]) {
      if (!jc) continue;
      const key = `${jc.model ?? ""}|${jc.baseUrl ?? ""}|${jc.apiKeyEnv ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      toProbe.push(jc);
    }
    if (toProbe.length > 0) {
      process.stderr.write(t("runner.judgePrecheck"));
      for (const jc of toProbe) {
        const err = await probeJudge(jc, opts.signal);
        if (err) throw new Error(err);
      }
    }
  }

  // 展开 attempts
  // 外层按「round」(run index)迭代,内层按 eval 迭代,目的是让同一 key 的第 i+1 次
  // attempt 排在所有 eval 的第 i 次之后 —— 这样当 earlyExit 开启时,第 0 轮某 eval 通过后、
  // 第 1 轮该 eval 才进入队列,earlyExit 检查能生效。若内外层相反(先 eval 后 round),
  // 则同一 eval 的所有 runs 连续入队,高并发下会全部同时启动,earlyExit 永远来不及跳过。
  const attempts: Attempt[] = [];
  for (const run of opts.agentRuns) {
    const evals = opts.evals.filter((e) => run.evalFilter(e.id));
    for (let i = 0; i < run.runs; i++) {
      for (const evalDef of evals) {
        const key = `${run.agent.name}|${run.model ?? ""}|${evalDef.id}`;
        attempts.push({ evalDef, run, attempt: i, key });
      }
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
  };
  for (const r of opts.reporters) {
    // reporter 只是结果消费方:单个 reporter 抛错记 diagnostic,不能让整次调度崩(P2)。
    await runReporter("onRunStart", () => r.onRunStart?.(runningEvals, firstAgent as Agent, shape));
  }

  // run 作用域生命周期钩子(整轮一次)产出的共享物:经 run.share() 写进来,透给每个 attempt 的
  // ctx.shared。每个 attempt 不再各起一个空 {},而是读这同一份(语义同 docs/lifecycle.md)。
  const runShared: Record<string, unknown> = {};
  const runTeardowns = await setupRunHooks(opts, runShared);

  const results: EvalResult[] = [];
  const passedKeys = new Set<string>();

  // reporter 的 onEvalComplete 要「每个 attempt 完成即时触发」(保流式输出),又不能让
  // 并发 worker 交错写 → 用一个 permit=1 的信号量串起来(替代原先手搓的 reportQueue 链)。
  const reportMutex = Effect.runSync(Effect.makeSemaphore(1));
  // 沙箱启动单独限流:与 agent 并发(maxConcurrency)解耦,防高并发下 daemon/API 过载。
  // 未显式指定时跟 maxConcurrency 走——各 backend 的推荐值已在 cli 层写进 maxConcurrency 默认值。
  const sandboxSem = Effect.runSync(Effect.makeSemaphore(opts.maxConcurrency));

  // earlyExit:为每个 key 各建一个 AbortController。某 attempt 通过时 abort 它,
  // 让并发进行中的同 key attempt 通过 signal 尽早退出,而不只是等排队的才能被跳过。
  const evalAbortControllers = new Map<string, AbortController>();
  for (const a of attempts) {
    if (a.run.earlyExit && !evalAbortControllers.has(a.key)) {
      evalAbortControllers.set(a.key, new AbortController());
    }
  }

  // 有界并发调度:Effect.forEach({ concurrency }) 取代手写 queue / inFlight / Promise.race。
  // 每个 attempt 跑在自己的 fiber;runAttemptEffect 只把「执行错误」收进 EvalResult.error(不 fail),
  // 但中断(Ctrl+C / kill)照常向上传播 —— 所以一条挂掉不会中断其它 attempt,而中断能停掉全部。
  //
  // signal:把 opts.signal 喂给 run → abort 触发根 fiber 中断 → forEach 中断所有子 fiber
  //         → 每个 attempt 的 Scope 跑 release(sb.stop)→ 容器全部停掉(治孤儿)。Effect 保证
  //         所有 finalizer 跑完后才结算,所以下面 summarize 时容器已清理干净。
  //
  // 用 runPromiseExit 而非 runPromise:{ signal } 触发的中断会让整个 Exit 标记为 interrupted,
  // 即便内层 catchAllCause 已把中断咽下 —— runPromise 这种情况下会直接 reject,把 Ctrl+C 变成
  // 一条「fasteval 出错」崩溃栈、并跳过下面的部分汇总。runPromiseExit 返回 Exit 不抛,我们据此
  // 把「中断/signal 已 abort」当正常的部分结果收尾,只有真·非中断缺陷才上抛。
  let interrupted = false;
  try {
    const exit = await Effect.runPromiseExit(
      Effect.forEach(
        attempts,
        (a) =>
          Effect.gen(function* () {
            // 早停:同 key 已通过且开了 earlyExit → 跳过未启动的 attempt。
            if (a.run.earlyExit && passedKeys.has(a.key)) return;

            // 合并全局信号与本 eval 的早停信号:任一 abort → 本 attempt 的信号 abort。
            const evalAc = evalAbortControllers.get(a.key);
            const attemptSignal =
              evalAc && opts.signal
                ? AbortSignal.any([opts.signal, evalAc.signal])
                : (evalAc?.signal ?? opts.signal);

            const result = yield* runAttemptEffect(a, opts, sandboxSem, runShared, attemptSignal);

            if (result.verdict === "passed") {
              passedKeys.add(a.key);
              evalAc?.abort(); // 让同 key 并发 attempt 尽早退出
            } else if (a.run.earlyExit && passedKeys.has(a.key)) {
              // 并发情况:另一个 attempt 已通过后本 attempt 才完成(被 abort 后产出 errored),不计入结果。
              return;
            }

            results.push(result);
            yield* reportMutex.withPermits(1)(
              // 每个 reporter 单独兜错:一个写文件失败 / 自定义 reporter 抛错只记 diagnostic,
              // 不让 Promise.all 整体 reject —— 否则 Effect.promise 把它当 defect,fail 掉 forEach、
              // 停掉后续 attempt(P2)。
              Effect.promise(() =>
                Promise.all(
                  opts.reporters.map((r) =>
                    runReporter("onEvalComplete", () => r.onEvalComplete?.(result)),
                  ),
                ),
              ),
            );
          }),
        { concurrency: opts.maxConcurrency, discard: true },
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
    if (Exit.isFailure(exit)) {
      // signal abort 或 cause 含中断 → 当作用户中断,走部分汇总;否则是真·缺陷,照常抛出。
      if (opts.signal?.aborted || Cause.isInterrupted(exit.cause)) {
        interrupted = true;
      } else {
        throw Cause.squash(exit.cause);
      }
    }
    if (interrupted) process.stderr.write(t("runner.interrupted"));
  } finally {
    // run 作用域 teardown / cleanup 必跑(成功 / 失败 / 中断都跑),LIFO,各自兜错。
    for (const td of runTeardowns.reverse()) await runReporter("run.teardown", td);
  }

  // 稳定排序:按发现顺序 + attempt
  const order = new Map(opts.evals.map((e, i) => [e.id, i]));
  results.sort(
    (a, b) =>
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) ||
      a.agent.localeCompare(b.agent) ||
      a.attempt - b.attempt,
  );

  const summary = summarize(results, firstAgent?.name ?? "", startedAt, Date.now() - t0);
  for (const r of opts.reporters) {
    await runReporter("onRunComplete", () => r.onRunComplete?.(summary));
  }
  return summary;
}

// reporter / 生命周期钩子调用的统一兜错:它们是「消费方 / 资源起停」,单个失败只记 diagnostic
// 到 stderr,不能让整次调度崩。返回 void,永不 reject(供 Promise.all 安全聚合)。
async function runReporter(stage: string, fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    process.stderr.write(t("runner.reporterDiagnostic", { stage, message: msg }));
  }
}

// run 作用域生命周期钩子(整轮一次):config.hooks(全局)+ 每个实验各一次(叠加在 config 之上)。
// 每个 provider 的 setup 立即跑,返回的 cleanup 与 teardown 收成一个闭包入栈;调用方在 finally 里
// LIFO 跑这些闭包(见 docs/lifecycle.md)。setup 失败只记 diagnostic,不阻断后续 provider / 调度。
async function setupRunHooks(
  opts: RunOptions,
  shared: Record<string, unknown>,
): Promise<Array<() => Promise<void> | void>> {
  const signal = opts.signal ?? new AbortController().signal;
  const mkCtx = (runs: AgentRun[], experimentId?: string): RunContext => ({
    experimentId,
    evals: [
      ...new Set(opts.evals.filter((e) => runs.some((r) => r.evalFilter(e.id))).map((e) => e.id)),
    ],
    agents: [...new Set(runs.map((r) => r.agent.name))],
    flags: runs[0]?.flags ?? {},
    signal,
    log: (m) => process.stderr.write(t("runner.hooksLog", { message: m })),
    share: (k, v) => {
      shared[k] = v;
    },
  });

  // 收集 run-scope 提供方:config 覆盖全部 run;每个带 hooks.run 的实验各一组(按 experimentId 去重)。
  const providers: Array<{ hooks: LifecycleHooks; runs: AgentRun[]; experimentId?: string }> = [];
  if (opts.config.hooks?.run) providers.push({ hooks: opts.config.hooks, runs: opts.agentRuns });
  const seen = new Set<string>();
  for (const r of opts.agentRuns) {
    if (!r.hooks?.run || !r.experimentId || seen.has(r.experimentId)) continue;
    seen.add(r.experimentId);
    providers.push({
      hooks: r.hooks,
      runs: opts.agentRuns.filter((x) => x.experimentId === r.experimentId),
      experimentId: r.experimentId,
    });
  }

  const teardowns: Array<() => Promise<void> | void> = [];
  for (const p of providers) {
    const ctx = mkCtx(p.runs, p.experimentId);
    let cleanup: Cleanup | void = undefined;
    await runReporter("run.setup", async () => {
      cleanup = await p.hooks.run?.setup?.(ctx);
    });
    teardowns.push(async () => {
      if (typeof cleanup === "function") await cleanup();
      await p.hooks.run?.teardown?.(ctx);
    });
  }
  return teardowns;
}

function summarize(
  results: EvalResult[],
  agent: string,
  startedAt: string,
  durationMs: number,
): RunSummary {
  const counts = { passed: 0, failed: 0, scored: 0, skipped: 0, errored: 0 };
  let inTok = 0;
  let outTok = 0;
  let cost = 0;
  for (const r of results) {
    counts[r.outcome] += 1;
    inTok += r.usage?.inputTokens ?? 0;
    outTok += r.usage?.outputTokens ?? 0;
    cost += r.estimatedCostUSD ?? 0;
  }
  return {
    agent,
    startedAt,
    completedAt: new Date().toISOString(),
    passed: counts.passed,
    failed: counts.failed,
    scored: counts.scored,
    skipped: counts.skipped,
    errored: counts.errored,
    durationMs,
    usage: { inputTokens: inTok, outputTokens: outTok },
    estimatedCostUSD: cost || undefined,
    results,
  };
}

// 单个 attempt 的资源生命周期用 Effect.Scope 接管:沙箱 + OTLP 接收器经 acquireRelease
// 注册,无论 body 成功 / 抛错 / 被中断,stop() / close() 都保证执行(治容器与端口泄漏)。
// remote agent 没有沙箱资源,但仍走同一条 Promise 边界 / 超时 / 评分路径。
function runAttemptEffect(
  a: Attempt,
  opts: RunOptions,
  sandboxSem: Effect.Semaphore,
  runShared: Record<string, unknown>,
  parentSignal?: AbortSignal,
): Effect.Effect<EvalResult> {
  const config = opts.config;
  const { evalDef, run, attempt } = a;
  const t0 = Date.now();

  const base: EvalResult = {
    id: evalDef.id,
    experimentId: run.experimentId,
    experiment: experimentRunInfo(run),
    agent: run.agent.name,
    model: run.model,
    verdict: "failed",
    outcome: "errored",
    attempt,
    startedAt: new Date(t0).toISOString(),
    durationMs: 0,
    assertions: [],
  };

  const timeoutMs = run.timeoutMs ?? evalDef.timeoutMs ?? config.timeoutMs ?? 600_000;
  // timeoutSignal:给协作式 adapter / docker 命令的「软」截止信号(到点 abort,让能看 signal 的
  // 提前优雅停)。但它【不是】attempt 总超时的硬保证 —— 真正的硬边界是下面的 Effect.timeoutTo:
  // 它中断整段 body,触发 Scope release(停容器),从而即便 adapter 完全无视 signal 也能停掉(P1)。
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;

  // 流式进度打到宿主 stderr(结果走 stdout,互不干扰)。容器主日志【不】放这些进度标记 ——
  // 那里留给 agent 的原始输出(adapter 给 agent 命令开 { stream: true })。
  const who = run.model ? `${run.agent.name}/${run.model}` : run.agent.name;
  // 同时保留最近 20 条进度消息,timeout 时嵌入 error 字段方便定位卡在哪一步。
  const recentLogs: string[] = [];
  const log = (m: string) => {
    recentLogs.push(m);
    if (recentLogs.length > 20) recentLogs.shift();
    if (opts.onProgress) {
      opts.onProgress(evalDef.id, who, m);
    } else {
      process.stderr.write(`  · ${evalDef.id} [${who}] ${m}\n`);
    }
  };

  return Effect.scoped(
    Effect.gen(function* () {
      const sandbox =
        run.agent.kind === "sandbox"
          ? yield* sandboxSem.withPermits(1)(
              Effect.gen(function* () {
                // ── 沙箱:acquire=起,release=stop(成功 / 失败 / 中断都跑)──
                // sandboxSem 只覆盖「容器创建」阶段;容器起好后立即释放,后续 npm install / agent 不占位。
                log(t("runner.startSandbox"));
                return yield* createSandbox({
                  sandbox: run.sandbox ?? config.sandbox,
                  timeout: timeoutMs,
                  runtime: "node24",
                });
              }),
            )
          : createRemoteSandbox();
      if (run.agent.kind === "remote") log(t("runner.useRemoteAgent"));

      // ── tracing ──────────────────────────────────────────────────────────────────
      // sandbox.otlpHost:
      //   string → docker 类沙箱,宿主开本地接收器,container 经 host.docker.internal 回连
      //   null   → 远程云端沙箱(e2b / vercel),宿主端口不可达 → 改在沙箱内起 collector
      // FASTEVAL_OTLP_HOST 可强制覆盖(如配好 tunnel 时)。
      let receiver: TraceReceiver | undefined;
      let telemetry: Telemetry | undefined;
      if (run.agent.capabilities.tracing) {
        const forcedHost = process.env.FASTEVAL_OTLP_HOST;
        if (forcedHost) {
          // 显式覆盖:走本地接收器,把指定 host 交给 agent
          receiver = yield* createTraceReceiver();
          const endpoint = receiver.endpoint(forcedHost);
          const env = run.agent.tracing?.env?.(endpoint);
          telemetry = env ? { endpoint, env } : { endpoint };
          log(t("runner.otlpOverride", { endpoint }));
        } else if (sandbox.otlpHost !== null) {
          // 本地/docker 沙箱:宿主开接收器
          receiver = yield* createTraceReceiver();
          const endpoint = receiver.endpoint(sandbox.otlpHost);
          const env = run.agent.tracing?.env?.(endpoint);
          telemetry = env ? { endpoint, env } : { endpoint };
          const proto = run.agent.tracing?.protocol;
          log(t("runner.otlpReceiver", { endpoint, proto: proto ? ` (${proto})` : "" }));
        } else {
          // 远程沙箱(e2b / vercel):在沙箱内起 collector,agent 往 localhost:4318 发
          receiver = yield* createInSandboxTraceReceiver(sandbox);
          const endpoint = receiver.endpoint("");
          const env = run.agent.tracing?.env?.(endpoint);
          telemetry = env ? { endpoint, env } : { endpoint };
          const proto = run.agent.tracing?.protocol;
          log(t("runner.otlpInSandbox", { endpoint, proto: proto ? ` (${proto})` : "" }));
        }
      }

      // body 是 Promise(adapter 边界)。Effect.promise 给的 AbortSignal 在本 fiber 被中断
      //(用户 Ctrl+C / 下面 timeoutTo 到点)时 abort —— 并进 signal,让真正观察 signal 的
      // adapter / docker 命令随中断一起停,而不只靠 Scope release 兜底。
      return yield* Effect.promise((interruptSignal) =>
        runAttemptBody(a, config, t0, base, {
          sandbox,
          receiver,
          telemetry,
          signal: AbortSignal.any([signal, interruptSignal]),
          shared: runShared,
          log,
        }),
      );
    }),
  ).pipe(
    // ── attempt 总超时的硬边界(P1)──
    // timeoutMs 是「整个 attempt(setup+agent+脚本+评分)」的上限,不是 docker 单条命令的。
    // 到点 → 中断整段 body → Scope 跑 release(停容器、关接收器)→ 产出一条 errored 结果。
    // 即便 adapter / test 完全无视 signal 挂死,这一层也能把它停下来并回收资源。
    Effect.timeoutTo({
      duration: Duration.millis(timeoutMs),
      onSuccess: (r: EvalResult) => r,
      onTimeout: (): EvalResult => ({
        ...base,
        durationMs: Date.now() - t0,
        error: t("runner.timeout", {
          timeoutMs,
          recentLogs: recentLogs.map((l) => `  · ${l}`).join("\n"),
        }),
      }),
    }),
    // body 自己已兜了 agent 执行错;这里兜的是资源获取 / Scope 层的意外(起沙箱失败等)。
    // 中断【不】吞:此时 Scope 已跑完 release(容器已停),把中断继续上抛,让 forEach 整体停掉,
    // 否则会把中断「恢复」成一条 errored 结果、并让后续 attempt 继续起 —— 那就停不下来了。
    Effect.catchAllCause((cause) =>
      Cause.isInterrupted(cause)
        ? Effect.failCause(cause)
        : Effect.succeed({ ...base, durationMs: Date.now() - t0, error: causeToError(cause) }),
    ),
  );
}

function causeToError(cause: Cause.Cause<never>): string {
  const e = Cause.squash(cause);
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

interface AttemptResources {
  sandbox: Sandbox;
  receiver?: TraceReceiver;
  telemetry?: Telemetry;
  signal: AbortSignal;
  /** run 作用域钩子(hooks.run.setup → run.share)产出的共享物;透给 ctx.shared。 */
  shared: Record<string, unknown>;
  log: (m: string) => void;
}

// attempt 的固定段(上传→基线→setup→驱动 agent→采 diff→脚本→评分→判决)。
// 资源已由 runAttemptEffect 的 Scope 持有;这里只在 finally 跑 agent 自己的 cleanup/teardown。
async function runAttemptBody(
  a: Attempt,
  config: Config,
  t0: number,
  base: EvalResult,
  res: AttemptResources,
): Promise<EvalResult> {
  const { evalDef, run, attempt } = a;
  const { sandbox, receiver, telemetry, signal, shared, log } = res;
  const usesSandbox = run.agent.kind === "sandbox";
  // 整个 attempt 共用一份 agent ctx(sandbox 钩子 / agent setup / tracing configure / teardown 都用它)。
  const attemptCtx: AgentContext = {
    signal,
    model: run.model,
    flags: run.flags,
    sandbox,
    session: { id: undefined, isNew: true },
    shared,
    telemetry,
    log,
  };
  let agentCleanup: Cleanup | void = undefined;
  let agentDidSetup = false;
  // sandbox 作用域钩子的回收闭包(config + 实验,叠加);finally 里 LIFO 跑(必跑,各自兜错)。
  const sandboxTeardowns: Array<() => Promise<void> | void> = [];
  try {
    if (usesSandbox) {
      // 上传 workspace + git 基线
      const wsDir = await resolveWorkspace(evalDef, config);
      if (wsDir) {
        const files = await collectWorkspaceFiles(wsDir);
        await sandbox.uploadFiles(files);
        log(t("runner.uploadWorkspace", { count: files.length }));
      }
      await initGitAndCommit(sandbox);

      // sandbox 作用域 setup(每个 attempt 一次):写 .env / 起 mock 服务 / 连外部 DB 等。
      // 顺序同 docs/architecture.md:git 基线之后、装依赖之前。config.hooks 先、实验 hooks 叠加在后。
      for (const h of [config.hooks?.sandbox, run.hooks?.sandbox]) {
        if (!h) continue;
        let cleanup: Cleanup | void = undefined;
        log(t("runner.sandboxSetup"));
        cleanup = await h.setup?.(sandbox, attemptCtx);
        sandboxTeardowns.push(async () => {
          if (typeof cleanup === "function") await cleanup();
          await h.teardown?.(sandbox, attemptCtx);
        });
      }

      // eval 级 setup(starter prep:npm install / 装系统依赖等)。命令默认非 root;
      // setup 里需要 root 的(apt/pip)自己传 { root: true }。
      if (evalDef.setup) {
        log(t("runner.evalSetup"));
        await evalDef.setup(sandbox);
      }
    }

    // agent 自己的 lifecycle:装 CLI、写 config(每个沙箱一次,不在每轮 send 里)。
    if (run.agent.setup) {
      log(t("runner.startAgentSetup"));
      agentDidSetup = true;
      agentCleanup = await run.agent.setup(sandbox, attemptCtx);
    }

    // OTLP 导出配置(file-based,如 codex 的 config.toml [otel] 块):与 setup 分开,
    // 在主配置写完后追加。仅当 tracing 开 + 有 endpoint 时调一次(env-based 的不实现 configure)。
    if (telemetry && run.agent.tracing?.configure) {
      log(t("runner.startAgentTracing"));
      await run.agent.tracing.configure(sandbox, attemptCtx);
    }

    // 构造 t,跑 test
    log(t("runner.driveAgent"));
    const judge = resolveJudge(evalDef.judge, config.judge);
    const { context, state } = createEvalContext({
      agent: run.agent,
      sandbox,
      model: run.model,
      flags: run.flags,
      shared,
      signal,
      log,
      judge,
      telemetry,
    });

    let error: string | undefined;
    let skipReason: string | undefined;
    try {
      await evalDef.test(context);
    } catch (e) {
      if (e instanceof EvalSkipped) skipReason = e.reason;
      else if (e instanceof EvalRequirementFailed) {
        /* 断言已记录,非执行错误 */
      } else if (e instanceof TurnFailed) {
        error = e.message;
      } else {
        error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
    }

    if (skipReason) log(t("runner.skip", { reason: skipReason }));

    // 采 diff(脚本如 next build 在采集后才跑,避免 .next 污染 diff)。remote agent 没有 workspace。
    const diff =
      skipReason || !usesSandbox
        ? { generatedFiles: {}, deletedFiles: [] }
        : await captureGeneratedFiles(sandbox);
    state.late.diff = diff;
    if (!skipReason && usesSandbox) {
      log(t("runner.diffProgress", {
        changed: Object.keys(diff.generatedFiles).length,
        deleted: diff.deletedFiles.length,
      }));
    }

    // 跑 test 请求过的脚本
    const scripts: Record<string, ScriptResult> = {};
    if (!skipReason && usesSandbox) {
      for (const s of state.requestedScripts) {
        log(`npm run ${s}…`);
        const r = await sandbox.runCommand("npm", ["run", s]);
        scripts[s] = { success: r.exitCode === 0, output: tail(r.stdout + r.stderr) };
        log(`npm run ${s} → ${r.exitCode === 0 ? "✓" : "✗"}`);
      }
      if (state.needsVitest) {
        const r = await sandbox.runCommand("npx", ["vitest", "run", "EVAL.ts"]);
        scripts.__vitest__ = { success: r.exitCode === 0, output: tail(r.stdout + r.stderr) };
      }
    } else if (!skipReason && (state.requestedScripts.size > 0 || state.needsVitest)) {
      error =
        t("runner.noRemoteWorkspace");
    }
    state.late.scripts = scripts;

    // 评分
    const events = state.manager.allEvents;
    const usage = state.manager.usage;
    const facts = deriveRunFacts(events);
    const scoringContext: ScoringContext = {
      events,
      facts,
      diff,
      scripts,
      usage,
      status: state.manager.lastStatus,
      readFile: async (path) => {
        try {
          return await sandbox!.readFile(path);
        } catch {
          return undefined;
        }
      },
    };
    if (!skipReason) log(t("runner.scoreJudge"));
    const assertions = skipReason ? [] : await state.collector.finalize(scoringContext);
    const verdict: Verdict = computeVerdict({ error, assertions, skipReason });
    const outcome = computeOutcome({ error, verdict });

    // 收 OTLP trace:给最后一批导出留点落地时间,再 collect(空则不挂)。
    // codex 的 OTLP 把内部 Rust tracing 全导出来(handle_responses / append_items … 上万条);
    // 先经【每-agent mapper】把原生 span 归一到 canonical GenAI semconv(定 SpanKind),
    // 再 selectTraceSpans 按 kind 挑出回合/模型/工具,丢掉 "other" 噪声(干净小 trace 整段保留)。
    let trace: TraceSpan[] | undefined;
    if (receiver) {
      await receiver.settle(250, 1500);
      const spans = receiver.collect();
      if (spans.length) {
        // 归一 → 选语义 span → 按 call_id 把 transcript 的工具入参/出参 join 上去(span 自身不带命令文本)。
        const canonical = mapSpansToCanonical(spans, run.agent.name);
        trace = enrichTraceWithIO(selectTraceSpans(canonical), facts.toolCalls);
        const note = spans.length > trace.length ? t("runner.traceSelected", { count: trace.length }) : "";
        log(`trace:${spans.length} span${note}`);
      }
    }

    const durationMs = Date.now() - t0;
    const o11y = buildO11ySummary(events, usage, durationMs);
    const cost = usage.costUSD;
    if (cost !== undefined) o11y.estimatedCostUSD = cost;

    return {
      id: evalDef.id,
      experimentId: run.experimentId,
      experiment: experimentRunInfo(run),
      agent: run.agent.name,
      model: run.model,
      verdict,
      outcome,
      attempt,
      startedAt: new Date(t0).toISOString(),
      durationMs,
      assertions,
      usage,
      estimatedCostUSD: cost,
      error,
      skipReason,
      events,
      o11y,
      trace,
      diff,
    };
  } catch (e) {
    return {
      ...base,
      durationMs: Date.now() - t0,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  } finally {
    // teardown / cleanup 一律在 finally 跑(失败也跑),不改判决,各自兜错(diagnostic)。
    // LIFO:先 agent(setup 最晚),再 sandbox 钩子(实验 → config)。
    // 沙箱 stop / 接收器 close 不在这里 —— 由 runAttemptEffect 的 Scope 在本函数返回后回收。
    try {
      if (typeof agentCleanup === "function") await agentCleanup();
      if (agentDidSetup) await run.agent.teardown?.(sandbox, attemptCtx);
    } catch {
      // teardown 失败只是 diagnostic,不影响已出的结果
    }
    for (const td of sandboxTeardowns.reverse()) await runReporter("sandbox.teardown", td);
  }
}

function createRemoteSandbox(): Sandbox {
  const unavailable = (method: string): never => {
    throw new Error(t("runner.remoteSandboxUnavailable", { method }));
  };

  return {
    sandboxId: "remote",
    otlpHost: "127.0.0.1",
    async runCommand() {
      return unavailable("runCommand");
    },
    async runShell() {
      return unavailable("runShell");
    },
    async readFile() {
      return unavailable("readFile");
    },
    async fileExists() {
      return unavailable("fileExists");
    },
    async readSourceFiles() {
      return unavailable("readSourceFiles");
    },
    async writeFiles() {
      unavailable("writeFiles");
    },
    async uploadFiles() {
      unavailable("uploadFiles");
    },
    getWorkingDirectory() {
      return "";
    },
    setWorkingDirectory() {
      unavailable("setWorkingDirectory");
    },
    async stop() {
      // no-op:remote agent 生命周期由它自己的进程管理。
    },
    async downloadFile() {
      return unavailable("downloadFile");
    },
    async uploadFile() {
      unavailable("uploadFile");
    },
  };
}

function experimentRunInfo(run: AgentRun): EvalResult["experiment"] {
  return {
    id: run.experimentId,
    flags: run.flags,
    runs: run.runs,
    earlyExit: run.earlyExit,
    sandbox: run.sandbox === undefined ? undefined : sandboxLabel(run.sandbox),
    timeoutMs: run.timeoutMs,
    budget: run.budget,
  };
}

async function resolveWorkspace(
  evalDef: DiscoveredEval,
  config: Config,
): Promise<string | undefined> {
  const ws = evalDef.workspace ?? config.workspace;
  if (!ws) return undefined;
  const abs = resolvePath(process.cwd(), ws);
  return (await isDirectory(abs)) ? abs : undefined;
}

function resolveJudge(
  evalJudge: JudgeConfig | undefined,
  configJudge: JudgeConfig | undefined,
): JudgeConfig | undefined {
  return evalJudge ?? configJudge;
}

function tail(s: string, lines = 40): string {
  return s.trim().split("\n").slice(-lines).join("\n");
}
