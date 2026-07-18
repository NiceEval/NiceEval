// 单个 attempt 的完整生命周期:资源(沙箱 / OTLP 接收器)经 Effect.Scope 的
// acquireRelease 接管,无论 body 成功 / 抛错 / 被中断,stop() / close() 都保证执行。
// 沙箱编排的固定段在 runAttemptBody(基线→setup→驱动 test→采 diff→评分→判定→收 trace),
// adapter 只填「把 agent 跑起来」一段。

import { resolve as resolvePath } from "node:path";
import { readFile as readSourceFile } from "node:fs/promises";
import { Effect, Cause, Duration } from "effect";
import { createSandbox, resolveSandbox } from "../sandbox/resolve.ts";
import { stopSandbox, unregisterSandbox } from "../sandbox/registry.ts";
import { withCleanupTimeout } from "./cleanup-timeout.ts";
import { KEEPABLE_PROVIDERS, nativeEnterCommand, suspendSandbox } from "../sandbox/keep.ts";
import { keptEntryId, updateKeptEntry, writeKeptEntry } from "../sandbox/keep-registry.ts";
import { createTraceReceiver, type TraceReceiver } from "../o11y/otlp/receiver.ts";
import { createInSandboxTraceReceiver } from "../o11y/otlp/sandbox-receiver.ts";
import type { AgentOtelChannel } from "../o11y/otlp/turn-otel.ts";
import { selectTraceSpans, enrichTraceWithIO } from "../o11y/otlp/select.ts";
import { mapGenericSpans } from "../o11y/otlp/mappers/index.ts";
import { createEvalContext } from "../context/context.ts";
import { createAgentSession } from "../context/session.ts";
import { readAgentSetupManifest } from "../agents/manifest.ts";
import { EvalRequirementFailed, EvalSkipped, TurnFailed } from "../context/control-flow.ts";
import { computeVerdict } from "../scoring/verdict.ts";
import { deriveRunFacts, buildO11ySummary } from "../o11y/derive.ts";
import { estimateCost } from "../o11y/cost.ts";
import { t } from "../i18n/index.ts";
import { describeError, firstLine, formatThrown } from "../util.ts";
import { createChangeLedger, type ChangeLedger } from "./ledger.ts";
import { deriveDiffData, emptyDiffData } from "../scoring/diff.ts";
import { createRemoteSandbox, withEvalLocalPaths } from "./remote-sandbox.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import type {
  AgentContext,
  AgentSetupManifest,
  Cleanup,
  Config,
  DiagnosticInput,
  DiffArtifact,
  EvalResult,
  JudgeConfig,
  Sandbox,
  SandboxHook,
  SandboxHookContext,
  ScopedFeedback,
  ScoringContext,
  ScriptResult,
  SourceArtifact,
  StreamEvent,
  Telemetry,
  TraceSpan,
} from "../types.ts";
import { reportAttemptLifecycle, reportDiagnostic, reportKept } from "./feedback/sink.ts";
import { encodeAttemptKey, runWho } from "./types.ts";
import { commandDisplay, commandNode, createTimingRecorder, type TimingRecorder } from "./timing.ts";
import { sandboxForEval, sandboxProjection } from "./sandbox-selection.ts";
import type {
  AgentRun,
  Attempt,
  AttemptError,
  AttemptRef,
  DiagnosticRecord,
  LifecyclePhase,
  RunOptions,
} from "./types.ts";

export function runAttemptEffect(
  a: Attempt,
  opts: RunOptions,
  sandboxSem: Effect.Semaphore,
  parentSignal?: AbortSignal,
  /** 每次跨入一个新 `LifecyclePhase` 边界时同步回调一次(与下面的 `enterPhase` 同一调用点,见
   *  该函数)。run.ts 用它在本地跟踪「这个 attempt 目前所在的阶段」,好在 attempt 失败/errored
   *  时把 phase 塞进 `reportFailure()`(见 sink.ts 的 `FailureInput.phase`)—— 到那时
   *  attempt:complete 已经让 coordinator 把 active map 里的条目删掉,没有别的地方能事后查到。 */
  onPhase?: (phase: LifecyclePhase) => void,
): Effect.Effect<EvalResult> {
  const config = opts.config;
  const { evalDef, run, attempt } = a;
  const niceevalRoot = opts.niceevalRoot ?? `${process.cwd()}/.niceeval`;
  const t0 = Date.now();

  const base: EvalResult = {
    id: evalDef.id,
    description: evalDef.description,
    experimentId: run.experimentId,
    experiment: experimentRunInfo(run, config.sandbox),
    agent: run.agent.name,
    model: run.model,
    verdict: "errored",
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

  // Attempt 阶段的正式生命周期投影(见 docs/feature/experiments/cli.md「Attempt 阶段」)。
  // run.ts 在这个 attempt 的 body Effect 真正开始跑之前,已经先发出过一次 attempt:start(占位
  // phase,见 run.ts 的 attempt:start emission,和这里的 eval:start 是同一个调用点),所以这里
  // 只需要在每个「实际执行到的」边界调 enterPhase() 覆盖上一个 phase(attempt:phase),不需要
  // 自己区分「第一次」。没有对应 hook/配置的步骤直接不调用,不产生空阶段(如没有 setup 的 agent
  // 跳过 agent-setup)。没有活跃 feedback coordinator 时 reportAttemptLifecycle 静默 no-op,
  // 不产生任何终端输出。
  const identity: AttemptRef = { experimentId: run.experimentId, evalId: evalDef.id, attempt };
  // 最近跨入的正式 phase:errored 结果的 `error.phase` 从它取(见下方 timeout / scope
  // 兜底与 runAttemptBody 的 body catch)。body 与本函数共用同一个 enterPhase 闭包(经 res 传下去),
  // 所以 body 内部的阶段推进也会更新它,不需要 body 再单独维护一份。
  // 阶段计时:live 展示、error.phase、落盘 phases[].name 用同一套 LifecyclePhase 闭集,
  // 一次 enterPhase 同时推进三者(词表全仓只有一套,见 runner/types.ts 的 LifecyclePhase)。
  let lastPhase: LifecyclePhase | undefined;
  const recorder = createTimingRecorder(() => Date.now());
  // adapter send 在飞时,错误/诊断归因到嵌套的 `agent.run`(eval.run 内打开,不单列计时条目)。
  let sendActive = false;
  const enterPhase = (phase: LifecyclePhase) => {
    lastPhase = phase;
    recorder.enter(phase);
    onPhase?.(phase);
    reportAttemptLifecycle({ type: "attempt:phase", at: Date.now(), identity, phase });
  };
  // 本 attempt 累计的诊断(与 verdict 独立):ScopedFeedback.diagnostic 与 teardown 失败都落这里,
  // 收尾时并入结果;dedupeKey 相同的并发诊断折叠成一条并累计 count。
  const diagnostics: DiagnosticRecord[] = [];
  const dedupeIndex = new Map<string, DiagnosticRecord>();
  const recordDiagnostic = (input: DiagnosticInput) => {
    const phase = (sendActive ? "agent.run" : lastPhase) ?? "eval.run";
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
      phase,
      ...(input.data !== undefined ? { data: input.data } : {}),
    };
    if (input.dedupeKey !== undefined) dedupeIndex.set(input.dedupeKey, record);
    diagnostics.push(record);
    // 同时进运行级永久事件流(human 撤下 dashboard 后追加、agent/ci 各追加一条,去重按 key)。
    reportDiagnostic({
      key: input.dedupeKey ?? `${input.code}:${encodeAttemptKey(identity)}`,
      severity: input.level,
      message: input.message,
      identity,
      data: input.data,
    });
  };
  // 作用域反馈:progress 走 attempt:progress(短命状态,归因由 runner 的当前阶段决定),
  // diagnostic 落 attempt diagnostics + 运行级永久事件。绑定见 docs/feature/experiments/library.md。
  const scopedFeedback: ScopedFeedback = {
    progress: (u) => {
      const suffix = u.current !== undefined && u.total !== undefined ? ` (${u.current}/${u.total})` : "";
      log(`${u.message}${suffix}`);
    },
    diagnostic: recordDiagnostic,
  };

  // 同时保留最近 20 条进度消息,timeout 时嵌入 error 字段方便定位卡在哪一步。
  const recentLogs: string[] = [];
  const log = (m: string) => {
    recentLogs.push(m);
    if (recentLogs.length > 20) recentLogs.shift();
    // 附着在「当前阶段」上的次要文本(见 ActiveAttempt.detail);attempt:start 早于本函数任何
    // 调用点发出(见上),active map 里一定已经有这个 identity 的条目。这是 log() 唯一的出口 ——
    // 没有裸写 stderr 的兜底分支(那是给已删除的 Live reporter 用的旧接线,见
    // docs/feature/experiments/cli.md「一个 run 内只有一个终端协调者」);由当前活跃的 profile
    // renderer(human/agent/ci)决定这条 detail 要不要、怎么展示。
    reportAttemptLifecycle({ type: "attempt:progress", at: Date.now(), identity, detail: m });
  };

  return Effect.scoped(
    Effect.gen(function* () {
      // 规划期按当前 eval 解析出的同一个 SandboxSpec，既用来起 provider，也作为
      // sandbox.setup / sandbox.teardown 钩子(SandboxSpec.setup()/.teardown() 链式挂的)来源。
      const sandboxSpec = a.sandboxSpec ?? sandboxForEval(run, evalDef, config.sandbox);
      // defineSandbox 自定义 provider 不参与留存(事后命令不执行用户项目代码,新进程无法安全
      // 找回用户对象上的 stopDetached);组合使用在创建沙箱前报清晰错误。
      if (
        run.agent.kind === "sandbox" &&
        opts.keepSandbox !== undefined &&
        resolveSandbox(sandboxSpec).create !== undefined
      ) {
        throw new Error(
          `--keep-sandbox is not supported with a defineSandbox custom provider ("${resolveSandbox(sandboxSpec).provider}"): the after-the-fact 'niceeval sandbox' commands never load project code, so a detached stop for user-defined sandboxes cannot be recovered safely. Use a built-in provider (docker / e2b / vercel), or drop --keep-sandbox.`,
        );
      }
      // 留存 disposition:只在本 attempt 内可变,初始 stop;只有留存提交成功才改成 keep
      // (Ctrl+C 中断外层 Scope 时仍是 stop,照常清理)。
      let disposition: "stop" | "keep" = "stop";
      // 退避重试(resolve.ts → retry.ts)期间临时归还这个名额:被限流的 provider 只是在
      // setTimeout 里睡觉,不该攥着 sandboxSem 的槽位陪跑,不然一批 429 能把整体并发拖成个位数。
      const provisionSlot = {
        release: () => Effect.runPromise(sandboxSem.release(1)).then(() => {}),
        reacquire: () => Effect.runPromise(sandboxSem.take(1)).then(() => {}),
      };
      // Scope release(receiver close + provider stop)整段计成 sandbox.stop:先加的 finalizer
      // 后跑(LIFO),所以「先加的」在 release 链末尾打终点戳、「后加的」在 release 开始前打起点戳;
      // 结果封口(附 phases)发生在 Scope release 完成之后(见下方 Effect.map)。
      let releaseStartedAt = 0;
      if (run.agent.kind === "sandbox") {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            // 留存路径的 phases 以 sandbox.suspend 结尾,没有 sandbox.stop 条目(见 release)。
            if (releaseStartedAt > 0 && disposition !== "keep") {
              recorder.record("sandbox.stop", Date.now() - releaseStartedAt);
            }
          }),
        );
      }
      const sandbox =
        run.agent.kind === "sandbox"
          ? yield* Effect.gen(function* () {
              // ── 沙箱:acquire=起,release=stop(成功 / 失败 / 中断都跑)──
              // sandboxSem 只覆盖「容器创建」阶段;容器起好后立即释放,后续 npm install / agent 不占位。
              enterPhase("sandbox.queue");
              return yield* sandboxSem.withPermits(1)(
                Effect.gen(function* () {
                  enterPhase("sandbox.create");
                  log(t("runner.startSandbox"));
                  return yield* createSandbox({
                    sandbox: sandboxSpec,
                    provisionSlot,
                    timeout: timeoutMs,
                    runtime: "node24",
                    feedback: scopedFeedback,
                    // Scope release 按 disposition 收尾:stop = 销毁(默认);keep = provider
                    // suspend(sandbox.suspend 阶段,有界计时),成功把登记项转 dormant,
                    // 失败保持 alive 并追加 diagnostic——不销毁、不冒充 dormant。
                    release: async (sb) => {
                      if (disposition !== "keep") {
                        await stopSandbox(sb);
                        return;
                      }
                      unregisterSandbox(sb);
                      const providerName = resolveSandbox(sandboxSpec).provider;
                      const suspendStart = Date.now();
                      try {
                        await suspendSandbox(sb);
                        recorder.record("sandbox.suspend", Date.now() - suspendStart);
                        await updateKeptEntry(niceevalRoot, keptEntryId(providerName, sb.sandboxId), {
                          state: "dormant",
                        }).catch(() => false);
                      } catch (e) {
                        recorder.record("sandbox.suspend", Date.now() - suspendStart, true);
                        recordDiagnostic({
                          code: "sandbox-suspend-failed",
                          level: "warning",
                          message: `sandbox ${sb.sandboxId} kept but suspend failed; the instance is still running: ${e instanceof Error ? e.message : String(e)}`,
                          dedupeKey: `sandbox-suspend-failed:${sb.sandboxId}`,
                        });
                      }
                    },
                  });
                }),
              );
            })
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

      if (run.agent.kind === "sandbox") {
        // 后加先跑:release 链开始时打起点戳(与上面的终点戳配对,测出整段 sandbox.stop)。
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            releaseStartedAt = Date.now();
          }),
        );
      }

      // body 是 Promise(adapter 边界)。Effect.promise 给的 AbortSignal 在本 fiber 被中断
      //(用户 Ctrl+C / 下面 timeoutTo 到点)时 abort —— 并进 signal,让真正观察 signal 的
      // adapter / docker 命令随中断一起停,而不只靠 Scope release 兜底。
      const bodyResult = yield* Effect.promise((interruptSignal) =>
        runAttemptBody(a, config, t0, base, {
          sandbox,
          sandboxSetupHooks: sandboxSpec?.setupHooks ?? [],
          sandboxTeardownHooks: sandboxSpec?.teardownHooks ?? [],
          receiver,
          telemetry,
          otel: otelChannel,
          signal: AbortSignal.any([signal, interruptSignal]),
          log,
          enterPhase,
          // send 在飞时归因到嵌套的 agent.run(不切换顶层阶段,见 LifecyclePhase 注释)。
          getPhase: () => (sendActive ? "agent.run" : lastPhase),
          setSendActive: (active) => {
            sendActive = active;
          },
          recorder,
          attemptEpoch: t0,
          feedback: scopedFeedback,
          diagnostics,
        }),
      );

      // 留存提交:verdict 定稿、其余收尾(teardown 链、diff 采集)已在 body 内完成后,按档位
      // 提交——failed 档留 failed/errored,all 档全部;顺序不可调换:先原子写登记项,写入成功
      // 才把 disposition 改成 keep;写入失败保持 stop、记 diagnostic,`sandbox.kept` 不得为 true。
      const keepMode = opts.keepSandbox;
      if (
        run.agent.kind === "sandbox" &&
        keepMode !== undefined &&
        a.locator !== undefined &&
        (keepMode === "all" || bodyResult.verdict === "failed" || bodyResult.verdict === "errored")
      ) {
        const providerName = resolveSandbox(sandboxSpec).provider;
        if (KEEPABLE_PROVIDERS.has(providerName)) {
          try {
            const enter = nativeEnterCommand(providerName, sandbox.sandboxId);
            yield* Effect.promise(() =>
              writeKeptEntry(niceevalRoot, {
                sandboxId: sandbox.sandboxId,
                provider: providerName,
                evalId: evalDef.id,
                attempt,
                ...(run.experimentId !== undefined ? { experimentId: run.experimentId } : {}),
                locator: String(a.locator),
                verdict: bodyResult.verdict,
                keptAt: new Date().toISOString(),
                workdir: sandbox.workdir,
                ...(enter !== undefined ? { enter } : {}),
                state: "alive",
              }),
            );
            disposition = "keep";
            reportKept({
              locator: a.locator,
              identity,
              who: runWho({ agentName: run.agent.name, model: run.model, experimentId: run.experimentId }),
              verdict: bodyResult.verdict,
              provider: providerName,
              sandboxId: sandbox.sandboxId,
              ...(enter !== undefined ? { enter } : {}),
            });
            return {
              ...bodyResult,
              sandbox: { provider: providerName, sandboxId: sandbox.sandboxId, kept: true as const },
            };
          } catch (e) {
            recordDiagnostic({
              code: "sandbox-keep-failed",
              level: "warning",
              message: `failed to register kept sandbox ${sandbox.sandboxId}; it will be destroyed normally: ${e instanceof Error ? e.message : String(e)}`,
              dedupeKey: `sandbox-keep-failed:${sandbox.sandboxId}`,
            });
          }
        }
      }
      return bodyResult;
    }),
  ).pipe(
    // ── attempt 总超时的硬边界(P1)──
    // timeoutMs 是「整个 attempt(setup+agent+脚本+评分)」的上限,不是 docker 单条命令的。
    // 到点 → 中断整段 body → Scope 跑 release(停容器、关接收器)→ 产出一条 errored 结果。
    // 即便 adapter / test 完全无视 signal 挂死,这一层也能把它停下来并回收资源。
    Effect.timeoutTo({
      duration: Duration.millis(timeoutMs),
      onSuccess: (r: EvalResult) => r,
      onTimeout: (): EvalResult => {
        // 超时:message 是一层原因(首行),recentLogs 明细放进 stack 供 show 展开「卡在哪一步」;
        // operation 取超时那一刻打开的 lifecycle operation。code 稳定为 "timeout"。
        const text = t("runner.timeout", { timeoutMs, recentLogs: recentLogs.map((l) => `  · ${l}`).join("\n") });
        const message = firstLine(text);
        const rest = text.length > message.length ? text.slice(message.length + 1).replace(/\n+$/, "") : "";
        const error: AttemptError = {
          code: "timeout",
          message,
          phase: (sendActive ? "agent.run" : lastPhase) ?? "eval.run",
          ...(rest.trim() !== "" ? { stack: rest } : {}),
        };
        recorder.failCurrent();
        return { ...base, durationMs: Date.now() - t0, error };
      },
    }),
    // body 自己已兜了 agent 执行错;这里兜的是资源获取 / Scope 层的意外(起沙箱失败等)。
    // 中断【不】吞:此时 Scope 已跑完 release(容器已停),把中断继续上抛,让 forEach 整体停掉,
    // 否则会把中断「恢复」成一条 errored 结果、并让后续 attempt 继续起 —— 那就停不下来了。
    Effect.catchAllCause((cause) =>
      Cause.isInterrupted(cause)
        ? Effect.failCause(cause)
        : Effect.succeed({
            ...base,
            durationMs: Date.now() - t0,
            error: errorFromThrown(Cause.squash(cause), sendActive ? "agent.run" : lastPhase),
          }),
    ),
    // 结果封口在 Scope release 完成之后:sandbox.stop 已由 finalizer 写进 recorder,
    // 这里把完整的阶段计时挂到即将交还的结果上(timeout / scope 兜底分支同样带上)。
    Effect.map((r: EvalResult): EvalResult => {
      const phases = recorder.finalize();
      return phases ? { ...r, phases } : r;
    }),
  );
}

/** 把 catch 到的 e(body 里 test()/setup 抛错,或 Scope 层 squash 出来的原始错误)折成
 *  `AttemptError`。message/stack/cause 由 `describeError` 拆分;phase 取失败那一刻打开的
 *  生命周期阶段(极早期就挂、还没跨进任何阶段时兜底 `eval.run`——phase 是必填字段,不留空);
 *  code 目前只对确定已知的类别赋稳定码,其余走 `"unexpected-error"`——provider 专属的限流码
 *  分类留在各 provider 的 `classifyProvisionError`,没有中性入口能在这里复算,不猜一个可能错的码。 */
export function errorFromThrown(e: unknown, phase: LifecyclePhase | undefined): AttemptError {
  const { message, stack, cause } = describeError(e);
  return {
    code: "unexpected-error",
    message,
    phase: phase ?? "eval.run",
    ...(stack ? { stack } : {}),
    ...(cause ? { cause } : {}),
  };
}

interface AttemptResources {
  sandbox: Sandbox;
  /** SandboxSpec.setup() 链式挂的钩子,按追加顺序;非沙箱 agent 传空数组(usesSandbox 挡住不会跑)。 */
  sandboxSetupHooks: readonly SandboxHook[];
  /** SandboxSpec.teardown() 链式挂的钩子,按追加顺序保存,执行时逆序。 */
  sandboxTeardownHooks: readonly SandboxHook[];
  receiver?: TraceReceiver;
  telemetry?: Telemetry;
  /** 非沙箱 tracing agent 的共享 OTLP 通道(run 级池持有,不随 attempt 关)。 */
  otel?: AgentOtelChannel;
  signal: AbortSignal;
  log: (m: string) => void;
  /** 进入一个正式 LifecyclePhase 边界(见 runAttemptEffect 顶部的定义)。 */
  enterPhase: (phase: LifecyclePhase) => void;
  /** 读当前最近跨入的 phase(send 在飞时返回嵌套的 `agent.run`):error/diagnostic 归因用。 */
  getPhase: () => LifecyclePhase | undefined;
  /** SessionManager 的 send 在飞通知落点(agent.run 归因)。 */
  setSendActive: (active: boolean) => void;
  /** 阶段计时 recorder(turn/command 时间树挂载点)。 */
  recorder: TimingRecorder;
  /** attempt 墙钟起点(turn 节点的 startOffsetMs 基准)。 */
  attemptEpoch: number;
  /** 作用域反馈句柄(归因随 runner 当前阶段);各生命周期入口共享同一实现。 */
  feedback: ScopedFeedback;
  /** attempt 级诊断累计(runAttemptEffect 持有,含 sandbox.create 期间的诊断)。 */
  diagnostics: DiagnosticRecord[];
}

// attempt 的固定段(上传→基线→setup→驱动 agent→采 diff→脚本→评分→判定)。
// 资源已由 runAttemptEffect 的 Scope 持有;这里只在 finally 跑 agent 自己的 cleanup/teardown。
async function runAttemptBody(
  a: Attempt,
  config: Config,
  t0: number,
  base: EvalResult,
  res: AttemptResources,
): Promise<EvalResult> {
  const { evalDef, run, attempt } = a;
  const {
    sandbox: rawSandbox,
    sandboxSetupHooks,
    sandboxTeardownHooks,
    receiver,
    telemetry,
    otel,
    signal,
    log,
    enterPhase,
    getPhase,
    setSendActive,
    recorder,
    attemptEpoch,
    feedback,
    diagnostics,
  } = res;
  const usesSandbox = run.agent.kind === "sandbox";
  // 命令时间树:所有经这个包装 sandbox 发出的 runCommand/runShell 都挂成当前阶段(或当前 hook
  // 节点)下的 command 子节点。包装只在最外层公开调用记录一次——provider 内部转调不经过它。
  const sandbox = usesSandbox ? withCommandTiming(rawSandbox, recorder) : rawSandbox;
  // 在两个 return 前赋值,好让 finally 把 diagnostics 挂到即将返回的同一个对象上(见 finally 末尾)。
  let result: EvalResult | undefined;
  // 整个 attempt 共用一份 agent ctx(sandbox 钩子 / agent setup / tracing configure / teardown 都用它)。
  const attemptCtx: AgentContext = {
    signal,
    model: run.model,
    reasoningEffort: run.reasoningEffort,
    flags: run.flags,
    experimentId: run.experimentId,
    sandbox,
    session: createAgentSession(),
    telemetry,
    progress: feedback.progress,
    diagnostic: feedback.diagnostic,
    // log 是 progress({ message }) 的别名,不是第二条通道(见 AgentContext.log 注释)。
    log,
  };
  // Sandbox hook / eval.setup 的窄上下文:experimentId + signal + 作用域反馈,不借用完整 AgentContext
  // (hook 拿不到 session / model / telemetry,见 docs/feature/sandbox/library.md)。
  const hookCtx: SandboxHookContext = {
    experimentId: run.experimentId,
    signal,
    progress: feedback.progress,
    diagnostic: feedback.diagnostic,
  };
  let agentCleanup: Cleanup | void = undefined;
  let agentDidSetup = false;
  /** agent.setup 写进沙箱的安装清单(装了 Skill / plugin / MCP 的沙箱型 adapter 才有)。 */
  let agentSetup: AgentSetupManifest | undefined;
  // EvalDef.setup() 返回的 cleanup 闭包;finally 里按 LIFO 跑(见下)。
  let evalCleanup: Cleanup | void = undefined;
  // 变更分类账(仅沙箱型;workspace.baseline 阶段建立)。
  let ledger: ChangeLedger | undefined;
  // SandboxSpec.setup() 返回的 cleanup 闭包,按调用顺序收集;finally 里 LIFO 跑(见下)。
  const sandboxCleanups: Cleanup[] = [];
  try {
    if (usesSandbox) {
      // 沙箱级生命周期钩子(SandboxSpec.setup):环境预置层,先于 workspace 上传 / git 基线 /
      // eval.setup 跑——改动进 git 基线,不会被误算进 agent 产出的 diff。按追加顺序依次执行;
      // 单个抛错走下面的执行错误路径(与 eval.setup / agent.setup 同一条),已跑过的 cleanup /
      // sandbox.teardown 钩子仍在 finally 里跑(见 catch/finally)。
      if (sandboxSetupHooks.length > 0) {
        enterPhase("sandbox.setup");
        log(t("runner.startSandboxSetup"));
      }
      for (const [i, hook] of sandboxSetupHooks.entries()) {
        // hook 先建节点,hook 内经 Sandbox.runCommand/runShell 发出的命令挂成它的 command 子节点。
        const hookStart = Date.now();
        const hookNode = recorder.child({
          kind: "hook",
          label: `setup#${i}`,
          startOffsetMs: Math.max(0, hookStart - attemptEpoch),
          durationMs: 0,
        });
        if (hookNode) recorder.pushParent(hookNode);
        try {
          const cleanup = await hook(sandbox, hookCtx);
          if (typeof cleanup === "function") sandboxCleanups.push(cleanup);
        } catch (e) {
          if (hookNode) hookNode.failed = true;
          throw e;
        } finally {
          if (hookNode) {
            hookNode.durationMs = Date.now() - hookStart;
            recorder.popParent();
          }
        }
      }

      // 变更分类账锚点:私有 git ledger(git 目录在 workdir 外),排除清单在此冻结。
      enterPhase("workspace.baseline");
      ledger = await createChangeLedger(sandbox, evalDef.diff);

      // eval 级 setup(starter prep:npm install / 装系统依赖等)。命令默认非 root;
      // setup 里需要 root 的(apt/pip)自己传 { root: true }。
      if (evalDef.setup) {
        enterPhase("eval.setup");
        log(t("runner.evalSetup"));
        evalCleanup = await evalDef.setup(withEvalLocalPaths(sandbox, evalDef.baseDir), hookCtx);
      }
    }

    // agent 自己的 lifecycle:装 CLI、写 config(每个沙箱一次,不在每轮 send 里)。
    if (run.agent.setup) {
      enterPhase("agent.setup");
      log(t("runner.startAgentSetup"));
      agentDidSetup = true;
      agentCleanup = await run.agent.setup(sandbox, attemptCtx);
    }

    // 安装 manifest:adapter 在 setup 收尾写进沙箱的固定路径,核心只把它抬成 attempt artifact
    // (不解释内容、不按 agent 名字分支)。什么都没装的 adapter 不写这个文件 → undefined,
    // 不生成空 artifact。读在 setup 之后:test 阶段抛错也留得住这份「这次装了什么」的证据。
    if (usesSandbox && agentDidSetup) agentSetup = await readAgentSetupManifest(sandbox);

    // OTLP 导出配置(file-based,如 codex 的 config.toml [otel] 块):与 setup 分开,
    // 在主配置写完后追加。仅当 tracing 开 + 有 endpoint 时调一次(env-based 的不实现 configure)。
    if (telemetry && run.agent.tracing?.configure) {
      enterPhase("telemetry.configure");
      log(t("runner.startAgentTracing"));
      await run.agent.tracing.configure(sandbox, attemptCtx);
    }

    // 构造 t,跑 test
    enterPhase("eval.run");
    log(t("runner.driveAgent"));
    const judge = resolveJudge(evalDef.judge, config.judge);
    const { context, state } = createEvalContext({
      agent: run.agent,
      sandbox,
      model: run.model,
      reasoningEffort: run.reasoningEffort,
      flags: run.flags,
      experimentId: run.experimentId,
      signal,
      log,
      judge,
      telemetry,
      otel,
      evalBaseDir: evalDef.baseDir,
      feedback,
      // send 窗口钩子:进入前落 eval 归因、返回后落 agent 归因(见 ledger.ts)。
      ledgerHooks: ledger
        ? {
            beforeSend: (label) => ledger!.commitEvalWindow(label),
            afterSend: (label) => ledger!.commitAgentWindow(label),
          }
        : undefined,
      onSendActive: setSendActive,
      // 每次 send 一个 turn 节点:本地单调时钟测得的端到端包络 + session/turn 身份;
      // OTel 接入时再带 traceId,trace.json 的 spans 由消费方按它临时挂到 turn 下。
      onTurn: (info) =>
        recorder.child({
          kind: "turn",
          label: `s${info.sessionIndex}/t${info.turnIndex}`,
          startOffsetMs: Math.max(0, info.startedAt - attemptEpoch),
          durationMs: info.durationMs,
          ...(info.failed ? { failed: true as const } : {}),
          sessionIndex: info.sessionIndex,
          turnIndex: info.turnIndex,
          ...(info.traceId !== undefined ? { traceId: info.traceId } : {}),
          ...(info.traceAttribution !== undefined ? { traceAttribution: info.traceAttribution } : {}),
        }),
    });

    let error: AttemptError | undefined;
    let skipReason: string | undefined;
    try {
      await evalDef.test(context);
    } catch (e) {
      if (e instanceof EvalSkipped) skipReason = e.reason;
      else if (e instanceof EvalRequirementFailed) {
        /* 断言已记录,非执行错误 */
      } else if (e instanceof TurnFailed) {
        // TurnFailed 是 eval 驱动 agent 时的一层可读失败(message 已是一句话);稳定 code
        // `turn-failed`,不带控制流 stack(那指向 control-flow.ts,对定位无益)。
        error = { code: "turn-failed", message: e.message, phase: getPhase() ?? "eval.run" };
      } else {
        // eval 脚本(比如引用了已改名/删掉的 API)抛出的 TypeError:message 是一层原因,完整 stack
        // 单独进 `error.stack`,niceeval show 展开时才看得到 eval 文件的 file:line。
        error = errorFromThrown(e, getPhase());
      }
    }

    if (skipReason) log(t("runner.skip", { reason: skipReason }));

    // 采 agent 归因增量(workspace.diff 阶段:从分类账折叠逐窗口 delta)。remote agent 没有 workspace。
    if (!skipReason && usesSandbox) enterPhase("workspace.diff");
    let diffWindows: DiffArtifact = [];
    if (!skipReason && usesSandbox && ledger) {
      const startedAt = Date.now();
      const operation = recorder.child({
        kind: "operation",
        label: "export workspace diff",
        startOffsetMs: Math.max(0, startedAt - attemptEpoch),
        durationMs: 0,
      });
      if (operation) recorder.pushParent(operation);
      try {
        diffWindows = await ledger.exportWindows();
        if (operation) {
          const files = new Set(diffWindows.flatMap((window) => Object.keys(window.changes))).size;
          operation.label = `export workspace diff · ${diffWindows.length} ${diffWindows.length === 1 ? "window" : "windows"} · ${files} ${files === 1 ? "file" : "files"}`;
        }
      } catch (error) {
        if (operation) operation.failed = true;
        throw error;
      } finally {
        if (operation) {
          operation.durationMs = Date.now() - startedAt;
          recorder.popParent();
        }
      }
    }
    const diff = deriveDiffData(diffWindows);
    state.late.diff = diff;
    if (!skipReason && usesSandbox) {
      const files = Object.values(diff.files);
      log(t("runner.diffProgress", {
        changed: files.filter((f) => f.net !== "deleted").length,
        deleted: files.filter((f) => f.net === "deleted").length,
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
      // attempt 级聚合覆盖(各轮最差值);t.* 作用域断言按它折叠,turn/session 作用域在
      // record 时已换成各自的覆盖(见 context.ts 的 recordScoped / makeTurnHandle)。
      coverage: state.manager.coverage,
      readFile: async (path) => {
        try {
          return await sandbox!.readFile(path);
        } catch {
          return undefined;
        }
      },
    };
    if (!skipReason) {
      enterPhase("scoring.evaluate");
      log(t("runner.scoreJudge"));
    }
    const assertions = skipReason ? [] : await state.collector.finalize(scoringContext);
    const verdict = computeVerdict({ error, assertions, skipReason, strict: run.strict });

    // 收 OTLP trace:给最后一批导出留点落地时间,再 collect(空则不挂)。
    // codex 的 OTLP 把内部 Rust tracing 全导出来(handle_responses / append_items … 上万条);
    // 先经【每-agent mapper】把原生 span 归一到 canonical GenAI semconv(定 SpanKind),
    // 再 selectTraceSpans 按 kind 挑出回合/模型/工具,丢掉 "other" 噪声(干净小 trace 整段保留)。
    let trace: TraceSpan[] | undefined;
    if (receiver) {
      enterPhase("telemetry.collect");
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
      enterPhase("telemetry.collect");
      const late = await otel.sweep(state.manager.otelTraceIds);
      const spans = [...state.manager.otelSpans, ...late];
      if (spans.length) {
        const canonical = (run.agent.spanMapper ?? mapGenericSpans)(spans);
        trace = enrichTraceWithIO(selectTraceSpans(canonical), facts.toolCalls);
        const note = spans.length > trace.length ? t("runner.traceSelected", { count: trace.length }) : "";
        log(`trace:${spans.length} span${note}`);
      }
    }

    // 主链到 telemetry.collect 为止。必须在 Effect Scope release 之前显式封口；否则最后一个
    // 主链 phase 会一直开到 sandbox.stop 完成，既把收尾时间重复算进主链，也会让 phases
    // 主链合计大于 durationMs。Scope finalizer 只负责另记 sandbox.stop / sandbox.suspend。
    recorder.closeCurrent();
    const durationMs = Date.now() - t0;
    const o11y = buildO11ySummary(events, usage, durationMs);
    // 实测成本(网关带回)优先,缺则按 model + 用量查价格表估算(见 o11y/cost.ts)。
    const cost = usage.costUSD ?? estimateCost(run.model, usage, config.pricing);
    if (cost !== undefined) o11y.estimatedCostUSD = cost;

    // 收 test 引用到的 eval 源码(按 send / 断言的 loc 去重),供 view 渲染代码视图。
    const sources = await collectSources(events, assertions, evalDef.source);

    const value: EvalResult = {
      id: evalDef.id,
      description: evalDef.description,
      experimentId: run.experimentId,
      experiment: experimentRunInfo(run, config.sandbox),
      agent: run.agent.name,
      model: run.model,
      verdict,
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
      agentSetup,
      diff: diffWindows,
      coverage: state.manager.coverage,
      ...(usesSandbox
        ? {
            sandbox: {
              provider: resolveSandbox(a.sandboxSpec ?? sandboxForEval(run, evalDef, config.sandbox)).provider,
              sandboxId: sandbox.sandboxId,
            },
          }
        : {}),
    };
    result = value;
    return value;
  } catch (e) {
    recorder.failCurrent();
    const value: EvalResult = {
      ...base,
      durationMs: Date.now() - t0,
      error: errorFromThrown(e, getPhase()),
      ...(agentSetup !== undefined ? { agentSetup } : {}),
    };
    result = value;
    return value;
  } finally {
    // 收尾段一律在 finally 跑(主链成败都执行),不改判定,各自兜错(diagnostic)、各自计时
    // (不计入 durationMs 口径,见 docs/feature/results/architecture.md)。执行序与 LifecyclePhase
    // 闭集声明一致:eval.teardown → agent.teardown → sandbox.teardown;各段可独立标 failed。
    // 沙箱 stop / 接收器 close 不在这里 —— 由 runAttemptEffect 的 Scope 在本函数返回后回收,
    // 并经 finalizer 计成 sandbox.stop。没有对应 cleanup 的段直接跳过,不产生空阶段。
    const evalCleanupFn = typeof evalCleanup === "function" ? evalCleanup : undefined;
    if (evalCleanupFn) {
      enterPhase("eval.teardown");
      await recorder
        .measureClosing("eval.teardown", async () => {
          try {
            // 收尾可调用体一律有界(docs/cli.md「中断:三级响应」的有界性前提):挂起的 cleanup
            // 到点按本段失败语义收束,后续段照常执行,收尾链不能无限拖住退出。下同。
            await withCleanupTimeout(evalCleanupFn);
          } catch (e) {
            // 收尾失败只是 diagnostic,不改判定 —— 挂到 attempt.diagnostics(见 finally 末尾并入)。
            diagnostics.push(teardownDiagnostic("eval.teardown", e));
            throw e; // 让 measureClosing 把这段标 failed
          }
        })
        .catch(() => {});
    }
    const agentCleanupFn = typeof agentCleanup === "function" ? agentCleanup : undefined;
    if (agentCleanupFn !== undefined || (agentDidSetup && run.agent.teardown !== undefined)) {
      enterPhase("agent.teardown");
      await recorder
        .measureClosing("agent.teardown", async () => {
          try {
            if (agentCleanupFn) await withCleanupTimeout(agentCleanupFn);
            if (agentDidSetup && run.agent.teardown) {
              await withCleanupTimeout(() => run.agent.teardown!(sandbox, attemptCtx));
            }
          } catch (e) {
            diagnostics.push(teardownDiagnostic("agent.teardown", e));
            throw e;
          }
        })
        .catch(() => {});
    }
    if (usesSandbox && (sandboxCleanups.length > 0 || sandboxTeardownHooks.length > 0)) {
      enterPhase("sandbox.teardown");
      await recorder
        .measureClosing("sandbox.teardown", async () => {
          const before = diagnostics.length;
          // sandbox.setup 返回的 cleanup:LIFO(后 setup 先 cleanup)。逐钩子有界:一个挂起的
          // 钩子不阻塞链上其余钩子拿到执行机会。
          for (let i = sandboxCleanups.length - 1; i >= 0; i--) {
            try {
              await withCleanupTimeout(sandboxCleanups[i]);
            } catch (e) {
              diagnostics.push(teardownDiagnostic("sandbox.teardown", e));
            }
          }
          // sandbox.teardown 钩子:按追加的逆序执行,沙箱销毁前最后一步。
          if (sandboxTeardownHooks.length > 0) {
            log(t("runner.startSandboxTeardown"));
            for (let i = sandboxTeardownHooks.length - 1; i >= 0; i--) {
              try {
                await withCleanupTimeout(async () => {
                  const teardownCleanup = await sandboxTeardownHooks[i](sandbox, hookCtx);
                  // SandboxHook 类型允许返回 Cleanup(与 setup 同一签名);teardown 返回的
                  // cleanup 没有更晚的挂点,立即执行。
                  if (typeof teardownCleanup === "function") await teardownCleanup();
                });
              } catch (e) {
                diagnostics.push(teardownDiagnostic("sandbox.teardown", e));
              }
            }
          }
          if (diagnostics.length > before) throw new Error("sandbox teardown diagnostics");
        })
        .catch(() => {});
    }
    // finally 在两个 return 求值之后、函数真正交还返回值之前运行;`result` 已经是那个即将被返回的
    // 对象引用,这里往它上面挂 diagnostics,调用方拿到的就是带诊断的同一个对象(标准 try/finally
    // 变异语义)。result 恒已赋值(两个 return 分支都先赋值再 return);极端情况下(finally 之前就
    // 抛了、result 还没赋值)静默跳过,不掩盖原始异常。
    if (diagnostics.length > 0 && result) result.diagnostics = diagnostics;
  }
}

/** 把一次 teardown / cleanup 失败折成一条 `DiagnosticRecord`(warning,不改判定)。message 取一层
 *  摘要(`firstLine(formatThrown)`),完整 stack 不塞进单 attempt 诊断 —— 诊断是「顺带发生的清理
 *  问题」,不是 attempt 的主因(主因在 verdict / error)。稳定 code `teardown-failed`。 */
function teardownDiagnostic(phase: LifecyclePhase, e: unknown): DiagnosticRecord {
  return {
    code: "teardown-failed",
    level: "warning",
    message: firstLine(formatThrown(e)),
    phase,
  };
}

/**
 * 命令时间树包装:runCommand / runShell 的最外层公开调用各记一个 command 子节点
 * (有界脱敏摘要 + exitCode;env 值与 stdout/stderr 不进入时间树)。Proxy 只拦这两个方法,
 * provider 内部 `this.runCommand(...)` 转调不经过它——不形成重复节点。
 */
function withCommandTiming(sandbox: Sandbox, recorder: TimingRecorder): Sandbox {
  const wrap = async <T>(display: string, fn: () => Promise<T>): Promise<T> => {
    const startOffsetMs = recorder.offsetNow();
    const t0 = Date.now();
    try {
      const result = await fn();
      const exitCode = (result as { exitCode?: unknown })?.exitCode;
      recorder.child(
        commandNode({
          display,
          startOffsetMs,
          durationMs: Date.now() - t0,
          ...(typeof exitCode === "number" ? { exitCode, failed: exitCode !== 0 } : {}),
        }),
      );
      // CommandResult.command:最外层公开调用恰好是「eval 实际跑了什么」的定义点,摘要
      // 与时间树节点同一份;provider 自己填过就不覆盖。
      if (result !== null && typeof result === "object" && !("command" in result)) {
        return { ...result, command: display } as T;
      }
      return result;
    } catch (e) {
      recorder.child(commandNode({ display, startOffsetMs, durationMs: Date.now() - t0, failed: true }));
      throw e;
    }
  };
  return new Proxy(sandbox, {
    get(target, prop, receiver) {
      if (prop === "runCommand") {
        return (cmd: string, args?: string[], opts?: unknown) =>
          wrap(commandDisplay(cmd, args), () => (target.runCommand as (...a: unknown[]) => Promise<unknown>)(cmd, args, opts));
      }
      if (prop === "runShell") {
        return (script: string, opts?: unknown) =>
          wrap(commandDisplay(script), () => (target.runShell as (...a: unknown[]) => Promise<unknown>)(script, opts));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * 收集 test 引用到的 eval 源码:从 send(user message)与断言的 loc 去重出文件集。
 * 命中 eval 自己的定义文件(绝大多数情况——send / 断言几乎总在 eval 主体里直接调用)时,
 * 直接用 discovery 时已经读好、归一化、算过哈希的 `evalSource`,不重新读盘;loc 指向
 * 其它文件(共享 helper 里包装 t.send / 断言的少见情形)才现读现取,读不到就跳过
 * (路径在沙箱内 / 已删 / 权限),view 用 loc 也能降级显示行号。
 */
async function collectSources(
  events: readonly StreamEvent[],
  assertions: readonly EvalResult["assertions"][number][],
  evalSource: CapturedEvalSource,
): Promise<SourceArtifact[]> {
  const paths = new Set<string>();
  for (const e of events) if (e.type === "message" && e.loc) paths.add(e.loc.file);
  for (const a of assertions) if (a.loc) paths.add(a.loc.file);
  const out: SourceArtifact[] = [];
  for (const path of paths) {
    if (path === evalSource.path) {
      out.push({ path, content: evalSource.content });
      continue;
    }
    try {
      out.push({ path, content: await readSourceFile(resolvePath(process.cwd(), path), "utf-8") });
    } catch {
      // 源码读不到(路径在沙箱内 / 已删 / 权限)——跳过,view 用 loc 也能降级显示行号。
    }
  }
  return out;
}

/** 解析后运行配置的穷尽投影(ExperimentRunInfo,见 docs/feature/results/architecture.md):
 *  agent/model 只在快照顶层,这里不复制;sandbox 只经 provider 的公开参数投影落盘。 */
export function experimentRunInfo(run: AgentRun, configSandbox?: Config["sandbox"]): EvalResult["experiment"] {
  return {
    ...(run.description !== undefined ? { description: run.description } : {}),
    ...(run.reasoningEffort !== undefined ? { reasoningEffort: run.reasoningEffort } : {}),
    ...(Object.keys(run.flags).length > 0 ? { flags: run.flags } : {}),
    runs: run.runs,
    earlyExit: run.earlyExit,
    ...(run.timeoutMs !== undefined ? { timeoutMs: run.timeoutMs } : {}),
    ...(run.budget !== undefined ? { budget: run.budget } : {}),
    ...(run.maxConcurrency !== undefined ? { maxConcurrency: run.maxConcurrency } : {}),
    selectedEvalIds: run.selectedEvalIds ?? [],
    ...(run.evalFilterFingerprint !== undefined ? { evalFilterFingerprint: run.evalFilterFingerprint } : {}),
    ...sandboxProjection(run, configSandbox),
  };
}

function resolveJudge(
  evalJudge: JudgeConfig | undefined,
  configJudge: JudgeConfig | undefined,
): JudgeConfig | undefined {
  return evalJudge ?? configJudge;
}
