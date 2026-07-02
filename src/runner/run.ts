// 运行器:发现产出的 eval × agent × runs → attempt,有界并发调度,把每个 attempt
// 跑成一个 EvalResult。沙箱编排的固定段在这里(起沙箱→上传→基线→setup→驱动 agent→
// 采 diff→跑脚本→评分→判决→停沙箱),adapter 只填「把 agent 跑起来」一段。

import { resolve as resolvePath } from "node:path";
import { readFile as readSourceFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Effect, Cause, Duration, Exit } from "effect";
import { createSandbox, sandboxLabel } from "../sandbox/resolve.ts";
import { createTraceReceiver, type TraceReceiver } from "../o11y/otlp/receiver.ts";
import { createInSandboxTraceReceiver } from "../o11y/otlp/sandbox-receiver.ts";
import { selectTraceSpans, enrichTraceWithIO } from "../o11y/otlp/select.ts";
import { mapSpansToCanonical } from "../o11y/otlp/mappers/index.ts";
import { createEvalContext } from "../context/context.ts";
import { EvalRequirementFailed, EvalSkipped, TurnFailed } from "../context/control-flow.ts";
import { computeOutcome } from "../scoring/verdict.ts";
import { probeJudge } from "../scoring/judge.ts";
import { deriveRunFacts, buildO11ySummary } from "../o11y/derive.ts";
import { estimateCost } from "../o11y/cost.ts";
import { t } from "../i18n/index.ts";
import { formatThrown } from "../util.ts";
import {
  captureGeneratedFiles,
  initGitAndCommit,
} from "./sandbox-prep.ts";
import { resolveLocalPath } from "../sandbox/paths.ts";
import type {
  Agent,
  AgentContext,
  Cleanup,
  Config,
  DiscoveredEval,
  EvalResult,
  JudgeConfig,
  LocalizedText,
  Reporter,
  ReporterEvent,
  RunShape,
  RunSummary,
  Sandbox,
  SandboxOption,
  ScoringContext,
  ScriptResult,
  SourceArtifact,
  StreamEvent,
  Telemetry,
  TraceSpan,
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
  strict?: boolean;
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
  /** 上次运行的结果。outcome === "passed" 的 (experimentId, evalId) 组合跳过重跑,结果直接合入本次汇总。 */
  priorResults?: EvalResult[];
}

interface Attempt {
  evalDef: DiscoveredEval;
  run: AgentRun;
  attempt: number;
  key: string; // agent+model+evalId,用于早停
  fingerprint: string;
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

  const plannedFingerprints = new Map<string, string>();
  for (const run of opts.agentRuns) {
    for (const evalDef of opts.evals.filter((e) => run.evalFilter(e.id))) {
      plannedFingerprints.set(cacheKey(run, evalDef.id), await computeFingerprint(evalDef, run));
    }
  }

  // 跨实验结果复用:只有上次 passed 且 fingerprint 匹配的 (experimentId, evalId) 组合直接携入。
  // 失败/错误/跳过/fingerprint 不匹配都会重跑。--force 跳过此逻辑。
  const priorRunKeys = new Set<string>();
  const carriedResults: EvalResult[] = [];
  if (opts.priorResults?.length) {
    for (const r of opts.priorResults) {
      if (!r.experimentId) continue;
      const key = `${r.experimentId}|${r.id}`;
      if (r.outcome === "passed" && r.fingerprint !== undefined && r.fingerprint === plannedFingerprints.get(key)) {
        priorRunKeys.add(key);
      }
    }
    for (const r of opts.priorResults) {
      if (!r.experimentId || !priorRunKeys.has(`${r.experimentId}|${r.id}`)) continue;
      // 去掉工件引用:工件文件在旧 run 目录,新 summary 里的相对路径会失效。
      carriedResults.push({ ...r, artifactsDir: undefined, artifactBase: undefined, artifactAbsBase: undefined });
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
        if (run.experimentId && priorRunKeys.has(`${run.experimentId}|${evalDef.id}`)) continue;
        const key = `${run.agent.name}|${run.model ?? ""}|${evalDef.id}`;
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

  if (carriedResults.length > 0) {
    const retryCount = new Set(attempts.map((a) => `${a.run.experimentId ?? ""}|${a.evalDef.id}`)).size;
    process.stderr.write(t("runner.resumeCarry", { carried: carriedResults.length, retry: retryCount }));
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
  await emitReporterEvent(opts.reporters, {
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
  const budgetSpent = new Map<string, number>();
  const budgetReported = new Set<string>();

  // reporter 的 onEvalComplete 要「每个 attempt 完成即时触发」(保流式输出),又不能让
  // 并发 worker 交错写 → 用一个 permit=1 的信号量串起来(替代原先手搓的 reportQueue 链)。
  const reportMutex = Effect.runSync(Effect.makeSemaphore(1));
  // 沙箱启动单独限流:与 agent 并发(maxConcurrency)解耦,防高并发下 daemon/API 过载。
  // 未显式指定时跟 maxConcurrency 走——各 backend 的推荐值已在 cli 层写进 maxConcurrency 默认值。
  const sandboxSem = Effect.runSync(Effect.makeSemaphore(opts.maxConcurrency));

  // earlyExit:为每个 key 各建一个 AbortController。某 attempt 通过或 errored 时 abort 它,
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
  // 一条「niceeval 出错」崩溃栈、并跳过下面的部分汇总。runPromiseExit 返回 Exit 不抛,我们据此
  // 把「中断/signal 已 abort」当正常的部分结果收尾,只有真·非中断缺陷才上抛。
  let interrupted = false;
  const exit = await Effect.runPromiseExit(
    Effect.forEach(
      attempts,
      (a) =>
        Effect.gen(function* () {
            // 早停:同 key 已通过,或已 errored(重跑只会重复同一个框架错误)且开了 earlyExit
            // → 跳过未启动的 attempt。
            if (a.run.earlyExit && (passedKeys.has(a.key) || erroredKeys.has(a.key))) {
              yield* Effect.promise(() =>
                emitReporterEvent(opts.reporters, {
                  type: "run:earlyExit",
                  evalId: a.evalDef.id,
                  experimentId: a.run.experimentId,
                }),
              );
              return;
            }

            const budget = a.run.budget;
            const budgetKey = a.run.experimentId ?? a.run.agent.name;
            const spent = budgetSpent.get(budgetKey) ?? 0;
            if (budget !== undefined && spent >= budget) {
              if (!budgetReported.has(budgetKey)) {
                budgetReported.add(budgetKey);
                yield* Effect.promise(() =>
                  emitReporterEvent(opts.reporters, { type: "run:budgetExceeded", budget, spent }),
                );
              }
              return;
            }

            // 合并全局信号与本 eval 的早停信号:任一 abort → 本 attempt 的信号 abort。
            const evalAc = evalAbortControllers.get(a.key);
            const attemptSignal =
              evalAc && opts.signal
                ? AbortSignal.any([opts.signal, evalAc.signal])
                : (evalAc?.signal ?? opts.signal);

            yield* Effect.promise(() =>
              emitReporterEvent(opts.reporters, {
                type: "eval:start",
                eval: { id: a.evalDef.id },
                agent: a.run.agent,
                attempt: a.attempt,
                experimentId: a.run.experimentId,
              }),
            );
            const result = yield* runAttemptEffect(a, opts, sandboxSem, attemptSignal);
            budgetSpent.set(budgetKey, (budgetSpent.get(budgetKey) ?? 0) + (result.estimatedCostUSD ?? 0));

            if (result.outcome === "passed") {
              passedKeys.add(a.key);
              evalAc?.abort(); // 让同 key 并发 attempt 尽早退出
            } else if (a.run.earlyExit && (passedKeys.has(a.key) || erroredKeys.has(a.key))) {
              // 并发情况:同 key 另一个 attempt 已通过/已 errored 后本 attempt 才完成
              // (被 abort 后产出 errored),不计入结果。
              return;
            } else if (result.outcome === "errored") {
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
                  opts.reporters.map((r) =>
                    runReporter("onEvalComplete", () => r.onEvalComplete?.(result)),
                  ),
                ),
              ),
            );
            yield* Effect.promise(() => emitReporterEvent(opts.reporters, { type: "eval:complete", result }));
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
  await emitReporterEvent(opts.reporters, { type: "run:summary", summary });
  for (const r of opts.reporters) {
    await runReporter("onRunComplete", () => r.onRunComplete?.(summary));
  }
  await emitReporterEvent(opts.reporters, { type: "run:saved", summary });
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

async function emitReporterEvent(reporters: readonly Reporter[], event: ReporterEvent): Promise<void> {
  await Promise.all(reporters.map((r) => runReporter(`event:${event.type}`, () => r.onEvent?.(event))));
}

function summarize(
  results: EvalResult[],
  agent: string,
  startedAt: string,
  durationMs: number,
  name?: LocalizedText,
): RunSummary {
  const counts = { passed: 0, failed: 0, skipped: 0, errored: 0 };
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
    name,
    agent,
    startedAt,
    completedAt: new Date().toISOString(),
    passed: counts.passed,
    failed: counts.failed,
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
  parentSignal?: AbortSignal,
): Effect.Effect<EvalResult> {
  const config = opts.config;
  const { evalDef, run, attempt } = a;
  const t0 = Date.now();

  const base: EvalResult = {
    id: evalDef.id,
    description: evalDef.description,
    experimentId: run.experimentId,
    experiment: experimentRunInfo(run),
    agent: run.agent.name,
    model: run.model,
    outcome: "errored",
    fingerprint: a.fingerprint,
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
        run.agent.capabilities.sandbox === true
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
      if (run.agent.capabilities.sandbox !== true) log(t("runner.useRemoteAgent"));

      // ── tracing ──────────────────────────────────────────────────────────────────
      // sandbox.otlpHost:
      //   string → docker 类沙箱,宿主开本地接收器,container 经 host.docker.internal 回连
      //   null   → 远程云端沙箱(e2b / vercel),宿主端口不可达 → 改在沙箱内起 collector
      // NICEEVAL_OTLP_HOST 可强制覆盖(如配好 tunnel 时)。
      let receiver: TraceReceiver | undefined;
      let telemetry: Telemetry | undefined;
      if (run.agent.capabilities.tracing) {
        const forcedHost = process.env.NICEEVAL_OTLP_HOST;
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
  return formatThrown(Cause.squash(cause));
}

interface AttemptResources {
  sandbox: Sandbox;
  receiver?: TraceReceiver;
  telemetry?: Telemetry;
  signal: AbortSignal;
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
  const { sandbox, receiver, telemetry, signal, log } = res;
  const usesSandbox = run.agent.capabilities.sandbox === true;
  // 整个 attempt 共用一份 agent ctx(sandbox 钩子 / agent setup / tracing configure / teardown 都用它)。
  const attemptCtx: AgentContext = {
    signal,
    model: run.model,
    flags: run.flags,
    sandbox,
    session: { id: undefined, isNew: true },
    telemetry,
    log,
  };
  let agentCleanup: Cleanup | void = undefined;
  let agentDidSetup = false;
  try {
    if (usesSandbox) {
      await initGitAndCommit(sandbox);

      // eval 级 setup(starter prep:npm install / 装系统依赖等)。命令默认非 root;
      // setup 里需要 root 的(apt/pip)自己传 { root: true }。
      if (evalDef.setup) {
        log(t("runner.evalSetup"));
        await evalDef.setup(withEvalLocalPaths(sandbox, evalDef.baseDir));
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
      signal,
      log,
      judge,
      telemetry,
      evalBaseDir: evalDef.baseDir,
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
        // 带 stack——eval 脚本(比如引用了已改名/删掉的 API)抛出的 TypeError 只有
        // "name: message" 完全定位不到是哪一行,报告里必须能看见 eval 文件的 file:line。
        error = formatThrown(e);
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

    const scripts: Record<string, ScriptResult> = {};
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
    const outcome = computeOutcome({ error, assertions, skipReason, strict: run.strict });

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
    // 实测成本(网关带回)优先,缺则按 model + 用量查价格表估算(见 o11y/cost.ts)。
    const cost = usage.costUSD ?? estimateCost(run.model, usage);
    if (cost !== undefined) o11y.estimatedCostUSD = cost;

    // 收 test 引用到的 eval 源码(按 send / 断言的 loc 去重),供 view 渲染代码视图。
    const sources = await collectSources(events, assertions);

    return {
      id: evalDef.id,
      description: evalDef.description,
      experimentId: run.experimentId,
      experiment: experimentRunInfo(run),
      agent: run.agent.name,
      model: run.model,
      outcome,
      fingerprint: a.fingerprint,
      attempt,
      startedAt: new Date(t0).toISOString(),
      durationMs,
      assertions,
      usage,
      estimatedCostUSD: cost,
      error,
      skipReason,
      events,
      sources,
      o11y,
      trace,
      diff,
    };
  } catch (e) {
    return {
      ...base,
      durationMs: Date.now() - t0,
      error: formatThrown(e),
    };
  } finally {
    // teardown / cleanup 一律在 finally 跑(失败也跑),不改判决,各自兜错(diagnostic)。
    // LIFO:先 agent(setup 最晚),再沙箱 Scope。
    // 沙箱 stop / 接收器 close 不在这里 —— 由 runAttemptEffect 的 Scope 在本函数返回后回收。
    try {
      if (typeof agentCleanup === "function") await agentCleanup();
      if (agentDidSetup) await run.agent.teardown?.(sandbox, attemptCtx);
    } catch {
      // teardown 失败只是 diagnostic,不影响已出的结果
    }
  }
}

function createRemoteSandbox(): Sandbox {
  const unavailable = (method: string): never => {
    throw new Error(t("runner.remoteSandboxUnavailable", { method }));
  };

  return {
    workdir: "",
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
    async uploadDirectory() {
      unavailable("uploadDirectory");
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

function withEvalLocalPaths(sandbox: Sandbox, baseDir: string): Sandbox {
  return {
    get workdir() {
      return sandbox.workdir;
    },
    get sandboxId() {
      return sandbox.sandboxId;
    },
    get otlpHost() {
      return sandbox.otlpHost;
    },
    runCommand: (cmd, args, opts) => sandbox.runCommand(cmd, args, opts),
    runShell: (script, opts) => sandbox.runShell(script, opts),
    readFile: (path) => sandbox.readFile(path),
    fileExists: (path) => sandbox.fileExists(path),
    readSourceFiles: (opts) => sandbox.readSourceFiles(opts),
    writeFiles: (files, targetDir) => sandbox.writeFiles(files, targetDir),
    uploadFiles: (files, targetDir) => sandbox.uploadFiles(files, targetDir),
    uploadDirectory: (localDir, targetDir, opts) =>
      sandbox.uploadDirectory(resolveLocalPath(baseDir, localDir), targetDir, opts),
    stop: () => sandbox.stop(),
    appendLog: sandbox.appendLog ? (line) => sandbox.appendLog!(line) : undefined,
    downloadFile: (path) => sandbox.downloadFile(path),
    uploadFile: (path, content) => sandbox.uploadFile(path, content),
  };
}

/**
 * 收集 test 引用到的 eval 源码:从 send(user message)与断言的 loc 去重出文件集,逐个读回。
 * loc.file 相对项目根(= 进程 cwd,CLI 从那儿发现 / 跑 eval),所以按 cwd 解析。读不到就跳过。
 */
async function collectSources(
  events: readonly StreamEvent[],
  assertions: readonly EvalResult["assertions"][number][],
): Promise<SourceArtifact[]> {
  const paths = new Set<string>();
  for (const e of events) if (e.type === "message" && e.loc) paths.add(e.loc.file);
  for (const a of assertions) if (a.loc) paths.add(a.loc.file);
  const out: SourceArtifact[] = [];
  for (const path of paths) {
    try {
      out.push({ path, content: await readSourceFile(resolvePath(process.cwd(), path), "utf-8") });
    } catch {
      // 源码读不到(路径在沙箱内 / 已删 / 权限)——跳过,view 用 loc 也能降级显示行号。
    }
  }
  return out;
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

function cacheKey(run: AgentRun, evalId: string): string {
  return `${run.experimentId ?? ""}|${evalId}`;
}

async function computeFingerprint(evalDef: DiscoveredEval, run: AgentRun): Promise<string> {
  const source = await readSourceFile(evalDef.sourcePath, "utf-8");
  const payload = {
    source,
    eval: {
      id: evalDef.id,
      tags: evalDef.tags ?? [],
      metadata: evalDef.metadata ?? {},
      timeoutMs: evalDef.timeoutMs,
    },
    run: {
      experimentId: run.experimentId,
      agent: run.agent.name,
      model: run.model,
      flags: run.flags,
      sandbox: run.sandbox === undefined ? undefined : sandboxLabel(run.sandbox),
      timeoutMs: run.timeoutMs,
      strict: run.strict,
    },
  };
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(",")}}`;
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
