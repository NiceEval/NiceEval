// 运行器:发现产出的 eval × agent × runs → attempt,有界并发调度,把每个 attempt
// 跑成一个 EvalResult。沙箱编排的固定段在这里(起沙箱→上传→基线→setup→驱动 agent→
// 采 diff→跑脚本→评分→判决→停沙箱),adapter 只填「把 agent 跑起来」一段。

import { resolve as resolvePath } from "node:path";
import { Effect, Cause } from "effect";
import { createSandbox } from "../sandbox/resolve.ts";
import { createTraceReceiver, type TraceReceiver } from "../o11y/otlp/receiver.ts";
import { selectTraceSpans, enrichTraceWithIO } from "../o11y/otlp/select.ts";
import { mapSpansToCanonical } from "../o11y/otlp/mappers/index.ts";
import { createEvalContext } from "../context/context.ts";
import { EvalRequirementFailed, EvalSkipped, TurnFailed } from "../context/control-flow.ts";
import { computeVerdict } from "../scoring/verdict.ts";
import { deriveRunFacts, buildO11ySummary } from "../o11y/derive.ts";
import {
  captureGeneratedFiles,
  collectWorkspaceFiles,
  initGitAndCommit,
  isDirectory,
} from "./sandbox-prep.ts";
import { estimateCost } from "./pricing.ts";
import type {
  Agent,
  AgentContext,
  Cleanup,
  Config,
  DiscoveredEval,
  EvalResult,
  JudgeConfig,
  Reporter,
  RunSummary,
  Sandbox,
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
  sandbox?: string;
  timeoutMs?: number;
  budget?: number;
  evalFilter: (id: string) => boolean;
  experimentId?: string;
}

export interface RunOptions {
  config: Config;
  evals: DiscoveredEval[];
  agentRuns: AgentRun[];
  reporters: Reporter[];
  maxConcurrency: number;
  /** 同时起沙箱(Docker create + 镜像拉取)的上限,独立于 agent 并发。
   *  默认 min(maxConcurrency, 4)——高并发时防 Docker daemon 过载。*/
  sandboxConcurrency?: number;
  signal?: AbortSignal;
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

  // 展开 attempts
  const attempts: Attempt[] = [];
  for (const run of opts.agentRuns) {
    const evals = opts.evals.filter((e) => run.evalFilter(e.id));
    for (const evalDef of evals) {
      const key = `${run.agent.name}|${run.model ?? ""}|${evalDef.id}`;
      for (let i = 0; i < run.runs; i++) {
        attempts.push({ evalDef, run, attempt: i, key });
      }
    }
  }

  // onRunStart 报「本次实际要跑的 eval」(过滤 + 去重),不是发现到的全部 —— 否则计数误导。
  const runningIds = new Set(attempts.map((a) => a.evalDef.id));
  const runningEvals = [...runningIds].map((id) => ({ id }));
  const firstAgent = opts.agentRuns[0]?.agent;
  for (const r of opts.reporters) {
    await r.onRunStart?.(runningEvals, firstAgent as Agent);
  }

  const results: EvalResult[] = [];
  const passedKeys = new Set<string>();

  // reporter 的 onEvalComplete 要「每个 attempt 完成即时触发」(保流式输出),又不能让
  // 并发 worker 交错写 → 用一个 permit=1 的信号量串起来(替代原先手搓的 reportQueue 链)。
  const reportMutex = Effect.runSync(Effect.makeSemaphore(1));
  // 沙箱启动(Docker create / 镜像拉取)单独限流:与 agent 并发(maxConcurrency)解耦,
  // 防高并发下 Docker daemon 过载。默认 min(max, 4)——4 个容器同时起对本地 Docker 友好。
  const sandboxSem = Effect.runSync(
    Effect.makeSemaphore(opts.sandboxConcurrency ?? Math.min(opts.maxConcurrency, 4)),
  );

  // 有界并发调度:Effect.forEach({ concurrency }) 取代手写 queue / inFlight / Promise.race。
  // 每个 attempt 跑在自己的 fiber;runAttemptEffect 只把「执行错误」收进 EvalResult.error(不 fail),
  // 但中断(Ctrl+C / kill)照常向上传播 —— 所以一条挂掉不会中断其它 attempt,而中断能停掉全部。
  //
  // signal:把 opts.signal 喂给 runPromise → abort 触发根 fiber 中断 → forEach 中断所有子 fiber
  //         → 每个 attempt 的 Scope 跑 release(sb.stop)→ 容器全部停掉(治孤儿)。Effect 保证
  //         所有 finalizer 跑完后 runPromise 才结算,所以下面 summarize 时容器已清理干净。
  let interrupted = false;
  await Effect.runPromise(
    Effect.forEach(
      attempts,
      (a) =>
        Effect.gen(function* () {
          // 早停:同 key 已通过且开了 earlyExit → 跳过(语义同原 launch 时的检查)。
          if (a.run.earlyExit && passedKeys.has(a.key)) return;
          const result = yield* runAttemptEffect(a, opts.config, sandboxSem, opts.signal);
          results.push(result);
          if (result.verdict === "passed") passedKeys.add(a.key);
          yield* reportMutex.withPermits(1)(
            Effect.promise(() =>
              Promise.all(opts.reporters.map((r) => r.onEvalComplete?.(result))),
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
  if (interrupted) process.stderr.write("  · 已中断:沙箱容器已清理,输出本次已完成的部分结果。\n");

  // 稳定排序:按发现顺序 + attempt
  const order = new Map(opts.evals.map((e, i) => [e.id, i]));
  results.sort(
    (a, b) =>
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) ||
      a.agent.localeCompare(b.agent) ||
      a.attempt - b.attempt,
  );

  const summary = summarize(results, firstAgent?.name ?? "", startedAt, Date.now() - t0);
  for (const r of opts.reporters) await r.onRunComplete?.(summary);
  return summary;
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
    counts[r.verdict] += 1;
    if (r.error) counts.errored += 1;
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
// 注册,无论 body 成功 / 抛错 / 被中断,stop() / close() 都保证执行(治容器与端口泄漏)——
// 这是手写 try/finally 在并发+中断下很难做对的部分。adapter 的 Promise 边界(setup/send)
// 原样保留:body 仍是个 async,经 Effect.promise 接进来。
function runAttemptEffect(
  a: Attempt,
  config: Config,
  sandboxSem: Effect.Semaphore,
  parentSignal?: AbortSignal,
): Effect.Effect<EvalResult> {
  const { evalDef, run, attempt } = a;
  const t0 = Date.now();

  const base: EvalResult = {
    id: evalDef.id,
    experimentId: run.experimentId,
    experiment: experimentRunInfo(run),
    agent: run.agent.name,
    model: run.model,
    verdict: "failed",
    attempt,
    startedAt: new Date(t0).toISOString(),
    durationMs: 0,
    assertions: [],
  };

  if (run.agent.kind !== "sandbox") {
    return Effect.succeed({ ...base, error: `runner 暂只支持沙箱型 agent(收到 ${run.agent.kind})` });
  }

  const timeoutMs = run.timeoutMs ?? evalDef.timeoutMs ?? config.timeoutMs ?? 600_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;

  // 流式进度打到宿主 stderr(结果走 stdout,互不干扰)。容器主日志【不】放这些进度标记 ——
  // 那里留给 agent 的原始输出(adapter 给 agent 命令开 { stream: true })。
  const who = run.model ? `${run.agent.name}/${run.model}` : run.agent.name;
  const log = (m: string) => process.stderr.write(`  · ${evalDef.id} [${who}] ${m}\n`);

  return Effect.scoped(
    Effect.gen(function* () {
      // ── 沙箱:acquire=起,release=stop(成功 / 失败 / 中断都跑)──
      // sandboxSem 只覆盖「容器创建」阶段;容器起好后立即释放,后续 npm install / agent 不占位。
      log("起沙箱…");
      const sandbox = yield* sandboxSem.withPermits(1)(
        createSandbox({ backend: run.sandbox ?? config.sandbox, timeout: timeoutMs, runtime: "node24" }),
      );

      // ── tracing:本机 OTLP 接收器同样用 Scope 接管(release=close,免端口泄漏)──
      let receiver: TraceReceiver | undefined;
      let telemetry: Telemetry | undefined;
      if (run.agent.capabilities.tracing) {
        receiver = yield* createTraceReceiver();
        const host = process.env.FASTEVAL_OTLP_HOST ?? "host.docker.internal";
        const endpoint = receiver.endpoint(host);
        // env-based 导出:把 agent 声明的 env(OTEL_* 等)算出来塞进 telemetry,send 直接 spread。
        const env = run.agent.tracing?.env?.(endpoint);
        telemetry = env ? { endpoint, env } : { endpoint };
        const proto = run.agent.tracing?.protocol;
        log(`OTLP 接收器 → ${endpoint}${proto ? ` (${proto})` : ""}`);
      }

      // body 是 Promise(adapter 边界);沙箱 / 接收器的回收交给上面的 Scope,不在 body 里。
      return yield* Effect.promise(() =>
        runAttemptBody(a, config, t0, base, { sandbox, receiver, telemetry, signal, log }),
      );
    }),
  ).pipe(
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
  let agentCleanup: Cleanup | void = undefined;
  let agentSetupCtx: AgentContext | undefined;
  try {
    // 上传 workspace + git 基线
    const wsDir = await resolveWorkspace(evalDef, config);
    if (wsDir) {
      const files = await collectWorkspaceFiles(wsDir);
      await sandbox.uploadFiles(files);
      log(`上传 workspace(${files.length} 文件)`);
    }
    await initGitAndCommit(sandbox);

    // eval 级 setup(starter prep:npm install / 装系统依赖等)。命令默认非 root;
    // setup 里需要 root 的(apt/pip)自己传 { root: true }。
    if (evalDef.setup) {
      log("eval setup(装依赖)…");
      await evalDef.setup(sandbox);
    }

    // agent 自己的 lifecycle:装 CLI、写 config(每个沙箱一次,不在每轮 send 里)。
    if (run.agent.setup) {
      log("agent setup(装 CLI / 写配置)…");
      agentSetupCtx = {
        signal,
        model: run.model,
        flags: run.flags,
        sandbox,
        session: { id: undefined, isNew: true },
        shared: {},
        telemetry,
        log,
      };
      agentCleanup = await run.agent.setup(sandbox, agentSetupCtx);
    }

    // OTLP 导出配置(file-based,如 codex 的 config.toml [otel] 块):与 setup 分开,
    // 在主配置写完后追加。仅当 tracing 开 + 有 endpoint 时调一次(env-based 的不实现 configure)。
    if (telemetry && run.agent.tracing?.configure) {
      const tracingCtx: AgentContext = agentSetupCtx ?? {
        signal,
        model: run.model,
        flags: run.flags,
        sandbox,
        session: { id: undefined, isNew: true },
        shared: {},
        telemetry,
        log,
      };
      log("agent tracing(写 otel 导出配置)…");
      await run.agent.tracing.configure(sandbox, tracingCtx);
    }

    // 构造 t,跑 test
    log("驱动 agent…");
    const judge = resolveJudge(evalDef.judge, config.judge);
    const { context, state } = createEvalContext({
      agent: run.agent,
      sandbox,
      model: run.model,
      flags: run.flags,
      shared: {},
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

    if (skipReason) log(`skip:${skipReason}`);

    // 采 diff(脚本如 next build 在采集后才跑,避免 .next 污染 diff)
    const diff = skipReason ? { generatedFiles: {}, deletedFiles: [] } : await captureGeneratedFiles(sandbox);
    state.late.diff = diff;
    if (!skipReason) log(`采 diff:${Object.keys(diff.generatedFiles).length} 改 / ${diff.deletedFiles.length} 删`);

    // 跑 test 请求过的脚本
    const scripts: Record<string, ScriptResult> = {};
    if (!skipReason) {
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
    if (!skipReason) log("评分 / judge…");
    const assertions = skipReason ? [] : await state.collector.finalize(scoringContext);
    const verdict: Verdict = computeVerdict({ error, assertions, skipReason });

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
        const note = spans.length > trace.length ? ` → 留 ${trace.length}(按语义)` : "";
        log(`trace:${spans.length} span${note}`);
      }
    }

    const durationMs = Date.now() - t0;
    const o11y = buildO11ySummary(events, usage, durationMs);
    const cost = estimateCost(usage, run.model, config.pricing);
    if (cost !== undefined) o11y.estimatedCostUSD = cost;

    return {
      id: evalDef.id,
      experimentId: run.experimentId,
      experiment: experimentRunInfo(run),
      agent: run.agent.name,
      model: run.model,
      verdict,
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
    // agent teardown / cleanup 一律在 finally 跑(失败也跑),不改判决。
    // 沙箱 stop / 接收器 close 不在这里 —— 由 runAttemptEffect 的 Scope 在本函数返回后回收
    //(LIFO:先 close 接收器,再 stop 沙箱,顺序与原 finally 一致)。
    try {
      if (typeof agentCleanup === "function") await agentCleanup();
      if (sandbox && agentSetupCtx) await run.agent.teardown?.(sandbox, agentSetupCtx);
    } catch {
      // teardown 失败只是 diagnostic,不影响已出的结果
    }
  }
}

function experimentRunInfo(run: AgentRun): EvalResult["experiment"] {
  return {
    id: run.experimentId,
    flags: run.flags,
    runs: run.runs,
    earlyExit: run.earlyExit,
    sandbox: run.sandbox,
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
