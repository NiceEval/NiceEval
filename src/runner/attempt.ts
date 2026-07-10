// 单个 attempt 的完整生命周期:资源(沙箱 / OTLP 接收器)经 Effect.Scope 的
// acquireRelease 接管,无论 body 成功 / 抛错 / 被中断,stop() / close() 都保证执行。
// 沙箱编排的固定段在 runAttemptBody(基线→setup→驱动 test→采 diff→评分→判决→收 trace),
// adapter 只填「把 agent 跑起来」一段。

import { resolve as resolvePath } from "node:path";
import { readFile as readSourceFile } from "node:fs/promises";
import { Effect, Cause, Duration } from "effect";
import { createSandbox, sandboxLabel } from "../sandbox/resolve.ts";
import { createTraceReceiver, type TraceReceiver } from "../o11y/otlp/receiver.ts";
import { createInSandboxTraceReceiver } from "../o11y/otlp/sandbox-receiver.ts";
import type { AgentOtelChannel } from "../o11y/otlp/turn-otel.ts";
import { selectTraceSpans, enrichTraceWithIO } from "../o11y/otlp/select.ts";
import { mapGenericSpans } from "../o11y/otlp/mappers/index.ts";
import { createEvalContext } from "../context/context.ts";
import { createAgentSession } from "../context/session.ts";
import { EvalRequirementFailed, EvalSkipped, TurnFailed } from "../context/control-flow.ts";
import { computeOutcome } from "../scoring/verdict.ts";
import { deriveRunFacts, buildO11ySummary } from "../o11y/derive.ts";
import { estimateCost } from "../o11y/cost.ts";
import { t } from "../i18n/index.ts";
import { formatThrown } from "../util.ts";
import { captureGeneratedFiles, initGitAndCommit } from "./sandbox-prep.ts";
import { createRemoteSandbox, withEvalLocalPaths } from "./remote-sandbox.ts";
import type {
  AgentContext,
  Cleanup,
  Config,
  EvalResult,
  JudgeConfig,
  Sandbox,
  ScoringContext,
  ScriptResult,
  SourceArtifact,
  StreamEvent,
  Telemetry,
  TraceSpan,
} from "../types.ts";
import { runWho } from "./types.ts";
import type { AgentRun, Attempt, RunOptions } from "./types.ts";

export function runAttemptEffect(
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
  const who = runWho(run);
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
      if (run.agent.kind !== "sandbox") log(t("runner.useRemoteAgent"));

      // ── tracing ──────────────────────────────────────────────────────────────────
      // sandbox.otlpHost:
      //   string → docker 类沙箱,宿主开本地接收器,container 经 host.docker.internal 回连
      //   null   → 远程云端沙箱(e2b / vercel),宿主端口不可达 → 改在沙箱内起 collector
      // defineConfig({ telemetry: { host } }) 可强制覆盖(如配好 tunnel 时)。
      //
      // 非沙箱 agent(远程 / 进程内)不走 per-attempt receiver:被测应用是长驻进程,只有一条
      // 全局 OTel 管线(OTEL_* env 进程启动时读一次)—— per-attempt 端口会在第一个 attempt
      // 结束时关掉,后续 span 全丢。改走 run 级共享池,span 逐轮归属(traceparent / 窗口)。
      let receiver: TraceReceiver | undefined;
      let telemetry: Telemetry | undefined;
      let otelChannel: AgentOtelChannel | undefined;
      // 共享池仅限:config 配了 telemetry(固定端口,无侵入接入的长驻服务)或显式 tracing.scope === "run"。
      // 只声明 tracing 的进程内 adapter(如 aiSdkAgent)保持 per-attempt receiver,attempt 全并发。
      const wantsSharedOtel =
        config.telemetry !== undefined || run.agent.tracing?.scope === "run";
      if (run.agent.kind !== "sandbox" && wantsSharedOtel && opts.otelPool) {
        otelChannel = yield* Effect.promise(() => opts.otelPool!.channel(run.agent.name));
        const endpoint = otelChannel.receiver.endpoint(config.telemetry?.host ?? "127.0.0.1");
        const env = run.agent.tracing?.env?.(endpoint);
        telemetry = env ? { endpoint, env } : { endpoint };
        log(t("runner.otlpShared", { endpoint }));
      } else if (run.agent.tracing !== undefined) {
        const forcedHost = config.telemetry?.host;
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
          // 远程沙箱(e2b / vercel):在沙箱内起 collector,agent 往 localhost 端口发
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
          otel: otelChannel,
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
  /** 非沙箱 tracing agent 的共享 OTLP 通道(run 级池持有,不随 attempt 关)。 */
  otel?: AgentOtelChannel;
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
  const { sandbox, receiver, telemetry, otel, signal, log } = res;
  const usesSandbox = run.agent.kind === "sandbox";
  // 整个 attempt 共用一份 agent ctx(sandbox 钩子 / agent setup / tracing configure / teardown 都用它)。
  const attemptCtx: AgentContext = {
    signal,
    model: run.model,
    reasoningEffort: run.reasoningEffort,
    flags: run.flags,
    sandbox,
    session: createAgentSession(),
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
      reasoningEffort: run.reasoningEffort,
      flags: run.flags,
      signal,
      log,
      judge,
      telemetry,
      otel,
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
        // 对接口分发,不按名字分支:mapper 由 Agent 自己声明,缺省走通用 heuristic。
        const canonical = (run.agent.spanMapper ?? mapGenericSpans)(spans);
        trace = enrichTraceWithIO(selectTraceSpans(canonical), facts.toolCalls);
        const note = spans.length > trace.length ? t("runner.traceSelected", { count: trace.length }) : "";
        log(`trace:${spans.length} span${note}`);
      }
    } else if (otel) {
      // 共享通道:receiver 不归本 attempt 关,trace 只取归属到本 attempt 的 span
      //(逐轮攒的 + 按本 attempt traceId sweep 回的迟到批)。
      const late = await otel.sweep(state.manager.otelTraceIds);
      const spans = [...state.manager.otelSpans, ...late];
      if (spans.length) {
        const canonical = (run.agent.spanMapper ?? mapGenericSpans)(spans);
        trace = enrichTraceWithIO(selectTraceSpans(canonical), facts.toolCalls);
        const note = spans.length > trace.length ? t("runner.traceSelected", { count: trace.length }) : "";
        log(`trace:${spans.length} span${note}`);
      }
    }

    const durationMs = Date.now() - t0;
    const o11y = buildO11ySummary(events, usage, durationMs);
    // 实测成本(网关带回)优先,缺则按 model + 用量查价格表估算(见 o11y/cost.ts)。
    const cost = usage.costUSD ?? estimateCost(run.model, usage, config.pricing);
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

function resolveJudge(
  evalJudge: JudgeConfig | undefined,
  configJudge: JudgeConfig | undefined,
): JudgeConfig | undefined {
  return evalJudge ?? configJudge;
}
