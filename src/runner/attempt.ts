// 单个 attempt 的完整生命周期:资源(沙箱 / OTLP 接收器)经 Effect.Sample 的
// acquireRelease 接管,无论 body 成功 / 抛错 / 被中断,stop() / close() 都保证执行。
// 沙箱编排的固定段在 runAttemptBody(基线→setup→驱动 test→采 diff→评分→判定→收 trace),
// adapter 只填「把 agent 跑起来」一段。

import { resolve as resolvePath } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile as readSourceFile } from "node:fs/promises";
import { Effect, Cause, Duration, Either, Option } from "effect";
import {
  materializeSandboxRunPlan,
  liveSandboxRuntimeServices,
  sandboxRuntimeCapabilities,
  type SandboxRuntimeDeadline,
} from "../sandbox/runtime.ts";
import type { ConcurrencySlot } from "../context/send-retry.ts";
import { unregisterSandbox } from "../sandbox/registry.ts";
import { CLEANUP_TIMEOUT_MS, withCleanupTimeout } from "./cleanup-timeout.ts";
import { resolveAttemptTimeout, type TimeoutSource } from "./timeout.ts";
import { resolveJudge } from "./judge-config.ts";
import { SandboxCommandTimeoutError } from "../sandbox/deadline.ts";
import { ExperimentFatalError } from "../shared/failure-class.ts";
import { computeExpiresAt, nativeEnterCommand, suspendSandbox } from "../sandbox/keep.ts";
import { keptEntryId, updateKeptEntry, writeKeptEntry } from "../sandbox/keep-registry.ts";
import { runAgentEnsure, verifySandboxTargetPlatform } from "../agents/provisioner.ts";
import { createTraceReceiver, type TraceReceiver } from "../o11y/otlp/receiver.ts";
import { createInSandboxTraceReceiver } from "../o11y/otlp/sandbox-receiver.ts";
import { AgentOtelChannel } from "../o11y/otlp/turn-otel.ts";
import { selectTraceSpans, enrichTraceWithIO } from "../o11y/otlp/select.ts";
import { mapGenericSpans } from "../o11y/otlp/mappers/index.ts";
import { createEvalContext } from "../context/context.ts";
import { createAgentSession } from "../context/session.ts";
import { EvalRequirementFailed, EvalSkipped } from "../context/control-flow.ts";
import { isSendFailure, sendFailureText } from "../context/send-failures.ts";
import { computeVerdict } from "../scoring/verdict.ts";
import { deriveRunFacts, buildO11ySummary } from "../o11y/derive.ts";
import { estimateCost } from "../o11y/cost.ts";
import { t } from "../i18n/index.ts";
import { describeError, firstLine, formatThrown } from "../util.ts";
import { createChangeLedger, type ChangeLedger } from "./ledger.ts";
import { deriveDiffData, emptyDiffData } from "../scoring/diff.ts";
import { createRemoteSandbox } from "./remote-sandbox.ts";
import { createSandboxCommandTarget } from "../sandbox/operations.ts";
import type { SandboxCleanupCommand, SandboxCommandContext } from "../sandbox/commands.ts";
import { sandboxLayerIdentityFor } from "../sandbox/link.ts";
import { agentInstallPlansForRun } from "./config-identity.ts";
import { recordFact, type FactValue } from "../shared/facts.ts";
import { createSourceRegistry, withSourceRegistry, type SourceRegistry } from "../source-loc.ts";
import {
  attemptFailureInfo,
  resolveAttemptFailureClass,
  type AttemptFailureClassifier,
  type FailureClass,
} from "../shared/failure-class.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import type {
  AgentContext,
  SandboxAgentContext,
  AgentSetupManifest,
  Config,
  DiagnosticInput,
  DiffArtifact,
  EvalResult,
  FailedCommandEvidence,
  JudgeConfig,
  Sandbox,
  ScopedFeedback,
  ScoringContext,
  ScriptResult,
  SourceArtifact,
  StreamEvent,
  Telemetry,
  TraceSpan,
  Usage,
  RetryAttemptRecord,
  ScoreTestContext,
} from "../types.ts";
import { reportAttemptLifecycle, reportDiagnostic, reportKept } from "./feedback/sink.ts";
import { encodeAttemptKey, runWho } from "./types.ts";
import { attemptOrigin, commandDisplay, commandLimitAttribution, commandNode, createTimingRecorder, sandboxPrepareActivity, turnActivity, workspaceDiffExportActivity, type TimingRecorder } from "./timing.ts";
import {
  ExperimentStateWindow,
  ExperimentStateSequenceFailure,
  StateWindowTransitionFailure,
  type AttemptCompletion,
} from "../state/runtime.ts";
import { experimentStateProjection } from "../state/definition.ts";
import type { ReusableLeaseStateWindow } from "./sandbox-pool.ts";
import type {
  AgentRun,
  Attempt,
  AttemptError,
  TimeoutAttribution,
  AttemptRef,
  DiagnosticRecord,
  LifecyclePhase,
  RunOptions,
} from "./types.ts";

/**
 * 一次终局失败的空间轴回执:止损闸的消费点(见 docs/feature/error-classification/architecture.md
 * 「止损执行体」)。`class` 是分类链决议出的 `FailureClass`,`text` 与报错文案同源(作者的修复
 * 提示),`phase` 是失败所在的生命周期阶段。回执是旁路:不改 verdict、不改 `AttemptError` 形状,
 * 也不走错误通道传播(attempt fiber 的 `E` 仍恒为 `never`)。
 */
export interface AttemptFailureDeclaration {
  readonly class: FailureClass;
  readonly phase: LifecyclePhase;
  readonly text: string;
}

/**
 * 一次终局失败的空间轴决议:走三道链(抛出点声明 → 实验分类器 → 缺省不可重试,见
 * src/shared/failure-class.ts 的 `resolveAttemptFailureClass`),缺省档(`scope` 省略或
 * `"attempt"`)返回 undefined —— 死因只属于本次执行,没有闸可落。
 *
 * **必须在把错误折成纯数据 `AttemptError` 之前调**:折完之后原错误对象(连同它携带的
 * `_tag`/`class` 与 cause 链)就不再是任何人的引用,空间轴声明再也读不出来。
 * attempt 内的失败(本文件的 `declareFailure`)与 attempt 开跑前的资源获取失败
 * (run.ts 的复用池租借)共用这一份决议,两处不各写一遍链。
 */
export function attemptFailureDeclaration(
  classify: AttemptFailureClassifier | undefined,
  phase: LifecyclePhase,
  e: unknown,
): AttemptFailureDeclaration | undefined {
  const info = attemptFailureInfo(phase, e);
  const cls = resolveAttemptFailureClass(info, classify);
  if (cls.scope !== "eval" && cls.scope !== "experiment") return undefined;
  return { class: cls, phase, text: info.text };
}

export interface RunAttemptEffectOptions {
  /** 父级调度器的中断信号；测试直调时省略。 */
  parentSignal?: AbortSignal;
  /** 每次跨入一个新 `LifecyclePhase` 边界时同步回调一次(与下面的 `enterPhase` 同一调用点,见
   *  该函数)。run.ts 用它在本地跟踪「这个 attempt 目前所在的阶段」,好在 attempt 失败/errored
   *  时把 phase 塞进 `reportFailure()`(见 sink.ts 的 `FailureInput.phase`)—— 到那时
   *  attempt:complete 已经让 coordinator 把 active map 里的条目删掉,没有别的地方能事后查到。 */
  onPhase?: (phase: LifecyclePhase) => void;
  /**
   * turn 级重试退避期间释放/收回的全局并发槽位(globalSem / 实验级 runSem,见 run.ts 的调用点)。
   * 省略时(如测试直调)退避不释放槽位。
   */
  concurrencySlot?: ConcurrencySlot;
  /**
   * 终局失败的空间轴回执(每条终局失败各回调一次,含 per-attempt teardown 的失败——teardown
   * 声明照常落闸、不改 verdict,见 architecture.md「生命周期边界」)。省略(如测试直调)时
   * 分类照常决议、只是无人消费。回调必须不抛错:它跑在 attempt 的失败路径上,不得掩盖原始失败。
   */
  onFailureClass?: (declaration: AttemptFailureDeclaration) => void;
  /** 由复用池独占借出的实例；池负责 SandboxSpec 生命周期与最终 stop。 */
  reusedSandbox?: {
    sandbox: Sandbox;
    reuseSandbox: number;
    reuseOrdinal: number;
    stateWindow?: ReusableLeaseStateWindow;
    lastPlannedUse?: boolean;
  };
}

export function runAttemptEffect(
  a: Attempt,
  opts: RunOptions,
  sandboxSem: Effect.Semaphore,
  { parentSignal, onPhase, concurrencySlot, onFailureClass, reusedSandbox }: RunAttemptEffectOptions = {},
): Effect.Effect<EvalResult> {
  const config = opts.config;
  const { evalDef, run, attempt } = a;
  const niceevalRoot = opts.niceevalRoot ?? `${process.cwd()}/.niceeval`;
  const t0 = Date.now();

  const base: EvalResult = {
    id: evalDef.id,
    description: evalDef.description,
    experimentId: run.experimentId,
    experiment: experimentRunInfo(run, a.plan, a.sandboxPlansByEval, config, evalDef.judge),
    agent: run.agent.name,
    model: run.model,
    verdict: "errored",
    fingerprint: a.fingerprint,
    configHash: a.configHash,
    attempt,
    startedAt: new Date(t0).toISOString(),
    durationMs: 0,
    assertions: [],
    evidenceCoverage: run.agent.evidenceCoverage,
    scoring: evalDef.scoring ?? "pass",
    // 资源获取/硬超时等在 collector 尚不可用前就可能收束；计分制的异常骨架也保持该字段的
    // 读取面（空数组而非缺失），与正常路径一致。
    ...(evalDef.scoring === "points" ? { scoreEntries: [] } : {}),
  };

  /**
   * 调度事实:Sandbox 租借给这条 Attempt 的那一刻定死(复用池借出的实例在进入本函数时就已经
   * 借定,一次性沙箱在 create 返回那一刻借定)。Attempt 在任何阶段终结——Eval `setup` 失败、
   * 超时、资源获取失败——记录里都要带全 provider / sandboxId / reused / 编号与承接序号,
   * 只有 `kept` 在收尾时点决定(见 docs/feature/record/architecture.md 的 `sandbox` 字段)。
   * 所以它挂在唯一出口(下方 Effect.map)上,而不是分散在各条返回路径里。
   */
  let sandboxFacts: NonNullable<EvalResult["sandbox"]> | undefined;
  /** 留存提交成功(`--keep-sandbox`)——唯一一个在收尾时点才知道的 sandbox 记录键。 */
  let kept = false;
  if (reusedSandbox && run.agent.kind === "sandbox") {
    if (a.plan._tag !== "Sandbox") {
      throw new Error(`sandbox agent ${JSON.stringify(run.agent.name)} received a Direct plan`);
    }
    sandboxFacts = {
      provider: a.plan.providerPlan.provider,
      sandboxId: reusedSandbox.sandbox.sandboxId,
      reused: true,
      reuseSandbox: reusedSandbox.reuseSandbox,
      reuseOrdinal: reusedSandbox.reuseOrdinal,
    };
  }

  // 四层解析链的最后两层(eval → config)在这里接上,并把赢家那一层带出来:超时消息要说得出
  // 「这个上限是哪一层给的」,否则撞线时得回头逐层对照四个声明点(契约见
  // docs/feature/experiments/cli.md「timeout、budget 与基础设施错误」)。
  // 四层都没声明 = 无上限:不挂 deadline、不发软截止信号,也不给 provider 递命令超时,
  // 链末端不发明一条隐藏的线。
  const attemptTimeout = resolveAttemptTimeout(run, evalDef, config);
  // deadline 的截止**时刻**:沙箱内一切时限从它派生(单条命令未显式传 timeout 时上限 =
  // 剩余量,见 sandbox/deadline.ts)。与下面那条软截止信号同一个锚点,不各取各的 now()。
  const deadlineAt = attemptTimeout ? Date.now() + attemptTimeout.timeoutMs : undefined;
  // timeoutSignal:给协作式 adapter / docker 命令的「软」截止信号(到点 abort,让能看 signal 的
  // 提前优雅停)。但它【不是】attempt 总超时的硬保证 —— 真正的硬边界是下面的 Effect.timeoutTo:
  // 它中断整段 body,触发 Sample release(停容器),从而即便 adapter 完全无视 signal 也能停掉(P1)。
  const timeoutSignal = attemptTimeout ? AbortSignal.timeout(attemptTimeout.timeoutMs) : undefined;
  // 无上限时 signal 仍必须存在(下游 ctx / adapter 一律读它):用一个永不 abort 的信号,
  // 不用 timeoutSignal 冒充。
  const signal =
    parentSignal && timeoutSignal
      ? AbortSignal.any([parentSignal, timeoutSignal])
      : (parentSignal ?? timeoutSignal ?? new AbortController().signal);

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
  // 超时证据保全的外层句柄:与 recorder 同一模式,runAttemptBody 内部一建好 SessionManager /
  // ChangeLedger 就经 AttemptResources.registerEvidence/registerLedger 登记回这里——中断后由
  // Sample 外层直接读它们组装结果,不随被 Effect 中断放弃的 body fiber 一起消失(见
  // docs/runner.md「超时:双层保护」超时不丢证据)。
  let liveEvents: (() => readonly StreamEvent[]) | undefined;
  let liveUsage: (() => Usage) | undefined;
  let liveRetryAttempts: (() => readonly RetryAttemptRecord[]) | undefined;
  let liveLedger: ChangeLedger | undefined;
  // Effect.timeoutTo 的 onTimeout 是同步回调,在中断真正下发给 body fiber(从而触发下面的
  // finalizer 链)之前就已经跑完并同步置位这个标记——下面新增的 finalizer 靠它判断本次 Sample
  // release 是不是超时触发的,只在超时路径补折叠证据,正常收尾路径不重复做(见文件顶部
  // Effect.timeoutTo 调用点的注释)。
  let timedOut = false;
  let timeoutDiff: DiffArtifact | undefined;
  let timeoutSources: SourceArtifact[] | undefined;
  const enterPhase = (phase: LifecyclePhase) => {
    lastPhase = phase;
    recorder.enter(phase);
    onPhase?.(phase);
    reportAttemptLifecycle({ type: "attempt:phase", at: Date.now(), identity, phase });
  };
  /**
   * 终局失败的分类与回执 —— **必须在把错误折成纯数据 `AttemptError` 之前调**:折完之后原错误
   * 对象(连同它携带的 `_tag`/`class` 与 cause 链)就不再是任何人的引用,空间轴声明再也读不出来。
   * 走生命周期链的三道决议(抛出点声明 → 实验分类器 → 缺省不可重试,见
   * src/shared/failure-class.ts 的 `resolveAttemptFailureClass`);send 失败的时间轴已由 send 重试
   * 执行体在 context 层消费完,浮出到这里的一定是终局失败,这里只读空间轴。
   * 缺省档(`scope` 省略或 `"attempt"`)不回执:那是「死因只属于本次执行」,没有闸可落。
   */
  const declareFailure = (phase: LifecyclePhase, e: unknown): void => {
    if (!onFailureClass) return;
    const declaration = attemptFailureDeclaration(run.classifyFailure, phase, e);
    if (declaration) onFailureClass(declaration);
  };
  // 本 attempt 累计的运行事实(与 verdict/diagnostics 独立):layer prepare/cleanup 与
  // agent setup·send·teardown 经 ctx.fact() 上报的都落这里(同一 attempt 内后写覆盖先写),
  // 收尾时并入结果的 facts 字段(见 finally 末尾,与 diagnostics 同一种「累加器 + finally 并入」模式)。
  const facts: globalThis.Record<string, FactValue> = {};
  // 本 attempt 累计的诊断(与 verdict 独立):ScopedFeedback.diagnostic 与 teardown 失败都落这里,
  // 收尾时并入结果;dedupeKey 相同的并发诊断折叠成一条并累计 count。
  const diagnostics: DiagnosticRecord[] = [];
  const dedupeIndex = new Map<string, DiagnosticRecord>();
  // 非零 Sandbox 命令证据的累加器(与 diagnostics/facts 同一种「共享容器」模式):
  // withCommandTiming 在 CommandResult 交还调用方之前把每条非零退出命令 push 进来,
  // runAttemptBody 的 finally 与本函数的超时/中断兜底分支都读同一个数组引用
  // (见 docs/feature/record/architecture.md「commandsjson」「证据在 CommandResult 返回
  // 调用方之前写入内存」)。
  const commands: FailedCommandEvidence[] = [];
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
      detail: input.message,
      origin: attemptOrigin(phase),
      ...(input.data !== undefined ? { context: input.data } : {}),
    };
    if (input.dedupeKey !== undefined) dedupeIndex.set(input.dedupeKey, record);
    diagnostics.push(record);
    // 同时进运行级永久事件流(human 撤下 dashboard 后追加、agent/ci 各追加一条,去重按 key)。
    // `key` 只管折叠到多细(作者没给 dedupeKey 时折到「这一条 attempt 的这种诊断」,身份因此
    // 编进去);对外稳定词法始终单独给 `code`,不让消费方从 key 反推(见 sink.ts 的
    // DiagnosticInput.code、docs/feature/experiments/cli.md 的 WarningEvent)。
    const { origin: _authorOrigin, phase: _authorPhase, ...diagnosticData } = input.data ?? {};
    reportDiagnostic({
      key: input.dedupeKey ?? `${input.code}:${encodeAttemptKey(identity)}`,
      code: input.code,
      severity: input.level,
      message: input.message,
      identity,
      // phase 由运行器给,且**压过**作者 `data` 里的同名字段:`WarningEvent.phase` 是
      // `LifecyclePhase` 闭集,取值只能由「这条诊断报上来时运行器正处在哪一步」决定。
      // 作者的 `data` 是开放词表,让它盖住这个字段等于允许从 eval / adapter 代码里冒充一个
      // 别的(甚至不在闭集里的)阶段,消费方按 phase 分支就此失效——与 ScopedFeedback
      // 「两个方法都不接受 phase」是同一条纪律(见 src/shared/types.ts 的接口注释)。
      data: { ...diagnosticData, phase, origin: attemptOrigin(phase) },
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

  /**
   * ── attempt 总超时的硬边界(P1)──
   * 上限是「整个 attempt(setup+agent+脚本+评分)」的,不是 docker 单条命令的。
   * 到点 → 中断整段 body → Sample 跑 release(停容器、关接收器)→ 产出一条 errored 结果。
   * 即便 adapter / test 完全无视 signal 挂死,这一层也能把它停下来并回收资源。
   *
   * 四层解析链都没声明上限时**这个算子整个不挂**——不是挂一条无穷大的 timer:没有线就没有
   * deadline,attempt 跑到自己结束为止(与携带判据的 `Infinity` 同一个语义)。
   */
  const applyAttemptDeadline = <E, R>(self: Effect.Effect<EvalResult, E, R>): Effect.Effect<EvalResult, E, R> => {
    if (attemptTimeout === undefined) return self;
    const { timeoutMs, source: timeoutSource } = attemptTimeout;
    return self.pipe(
      Effect.timeoutTo({
        duration: Duration.millis(timeoutMs),
        onSuccess: (r: EvalResult) => r,
        onTimeout: (): EvalResult => {
          // 超时:message 是一层原因(首行),recentLogs 明细放进 stack 供 show 展开「卡在哪一步」;
          // operation 取超时那一刻打开的 lifecycle operation。code 稳定为 "timeout"。
          const text = t("runner.timeout", {
            timeoutMs,
            source: timeoutSource,
            recentLogs: recentLogs.map((l) => `  · ${l}`).join("\n"),
          });
          const message = firstLine(text);
          const rest = text.length > message.length ? text.slice(message.length + 1).replace(/\n+$/, "") : "";
          const error: AttemptError = {
            code: "timeout",
            message,
            origin: attemptOrigin((sendActive ? "agent.run" : lastPhase) ?? "eval.run"),
            // 归属三样一起落盘:撞的是哪层时限、值多少、值从四层解析链的哪层来。
            // 不打一个没有归属说明的 ✗(见 docs/feature/sandbox/architecture.md「时限归属」)。
            timeout: { trigger: "attempt-deadline", limitMs: timeoutMs, source: timeoutSource },
            ...(rest.trim() !== "" ? { stack: rest } : {}),
          };
          recorder.failCurrent();
          // 置位给下面的 finalizer 用(它在 Sample release 里跑,LIFO 早于 sandbox stop,
          // 补折叠 workspace.diff / sources——见该 finalizer 的注释)。events/usage 不必等它:
          // SessionManager 是外层已经登记过的活引用(见 liveEvents/liveUsage),截至这一刻已经
          // 归一化的事件与已累计的用量此刻就能直接读出,不随放弃的 body fiber 一起消失。
          timedOut = true;
          const events = liveEvents?.();
          const usage = liveUsage?.();
          const retryAttempts = liveRetryAttempts?.();
          return {
            ...base,
            durationMs: Date.now() - t0,
            error,
            ...(events !== undefined ? { events: [...events], o11y: buildO11ySummary(events) } : {}),
            ...(usage !== undefined ? { usage: { ...usage } } : {}),
            ...(retryAttempts !== undefined && retryAttempts.length > 0
              ? { retryAttempts: retryAttempts.map((attempt) => ({ ...attempt })) }
              : {}),
            // 超时前已经登记的非零命令证据(见 withCommandTiming)不因中断而丢失——它们在
            // CommandResult 返回调用方那一刻就已经写进了这个共享数组。
            ...(commands.length > 0 ? { commands: [...commands] } : {}),
          };
        },
      }),
    );
  };

  const layerCleanups: LayerCleanupEntry[] = [];
  let attemptStateForResult: AttemptState = { _tag: "Stateless" };
  const scopeOutcome: AttemptScopeOutcome = {
    completion: { _tag: "VerdictNotPassed", verdict: "errored" },
    stateFailure: undefined,
    stateRecord: undefined,
  };

  return Effect.scoped(
    Effect.gen(function* () {
      const sandboxPlan = a.plan._tag === "Sandbox" ? a.plan : undefined;
      if (run.agent.kind === "sandbox" && sandboxPlan === undefined) {
        throw new Error(`sandbox agent ${JSON.stringify(run.agent.name)} received a Direct plan`);
      }
      const runtimeCapabilities = sandboxPlan === undefined ? undefined : sandboxRuntimeCapabilities(sandboxPlan);
      // 留存 disposition:只在本 attempt 内可变,初始 stop;只有留存提交成功才改成 keep
      // (Ctrl+C 中断外层 Sample 时仍是 stop,照常清理)。是否可留存只读 physical plan
      // 的中性 retention 能力；不在 runner 里按 provider 名或旧声明结构分支。
      let disposition: "stop" | "keep" = "stop";
      // 退避重试(resolve.ts → retry.ts)期间临时归还这个名额:被限流的 provider 只是在
      // setTimeout 里睡觉,不该攥着 sandboxSem 的槽位陪跑,不然一批 429 能把整体并发拖成个位数。
      const provisionSlot = {
        release: () => Effect.runPromise(sandboxSem.release(1)).then(() => {}),
        reacquire: () => Effect.runPromise(sandboxSem.take(1)).then(() => {}),
      };
      // Sample release(receiver close + provider stop)整段计成 sandbox.stop:先加的 finalizer
      // 后跑(LIFO),所以「先加的」在 release 链末尾打终点戳、「后加的」在 release 开始前打起点戳;
      // 结果封口(附 phases)发生在 Sample release 完成之后(见下方 Effect.map)。
      let releaseStartedAt = 0;
      if (run.agent.kind === "sandbox" && !reusedSandbox) {
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
        reusedSandbox?.sandbox ??
        (run.agent.kind === "sandbox"
          ? yield* Effect.gen(function* () {
              // ── 沙箱:acquire=起,release=整组 stop(成功 / 失败 / 中断都跑)──
              // sandboxSem 只覆盖「容器创建」阶段;容器起好后立即释放,后续 npm install / agent 不占位。
              enterPhase("sandbox.queue");
              return yield* sandboxSem.withPermits(1)(
                Effect.gen(function* () {
                  enterPhase("sandbox.create");
                  log(t("runner.startSandbox"));
                  // provider 固有的会话上限不能静默充当默认值:deadline 超出它时,attempt
                  // 会跑到一半被平台截断。在派发前就报环境约束,点名 provider 与上限值。
                  if (sandboxPlan === undefined || runtimeCapabilities === undefined) {
                    throw new Error("sandbox plan invariant violated before materialization");
                  }
                  assertDeadlineFitsPlan(runtimeCapabilities, attemptTimeout?.timeoutMs);
                  if (opts.keepSandbox !== undefined && runtimeCapabilities.retention._tag !== "Suspendable") {
                    throw new Error(
                      `--keep-sandbox is unsupported by provider ${JSON.stringify(runtimeCapabilities.provider)}`,
                    );
                  }
                  const runtimeDeadline: SandboxRuntimeDeadline = attemptTimeout === undefined || deadlineAt === undefined
                    ? { _tag: "Unlimited" }
                    : { _tag: "Bounded", timeoutMs: attemptTimeout.timeoutMs, deadlineAt };
                  const materialized = yield* materializeSandboxRunPlan({
                    plan: sandboxPlan,
                    evalId: evalDef.id,
                    deadline: runtimeDeadline,
                    feedback: scopedFeedback,
                    signal,
                    buildLocators: a.buildLocators ?? new Map(),
                    provisionSlot: { _tag: "Bound", value: provisionSlot },
                    services: liveSandboxRuntimeServices,
                    // Provider runtime 自己用 acquireRelease 持有 Case；Attempt 只提交显式
                    // Managed disposition，避免外层再包一层 acquireRelease 造成 double-stop。
                    release: {
                      _tag: "Managed",
                      run: (owned) => Effect.promise(async () => {
                        const sb = owned.sandbox;
                        if (disposition !== "keep") {
                          await owned.group.stop();
                          return;
                        }
                        unregisterSandbox(sb);
                        const providerName = runtimeCapabilities.provider;
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
                      }),
                    },
                  });
                  return materialized.sandbox;
                }),
              );
            })
          : createRemoteSandbox());
      // 一次性沙箱的租借时刻:实例到手就定归属,后面无论走到哪一步终结都带着它。
      if (run.agent.kind === "sandbox" && !sandboxFacts) {
        sandboxFacts = { provider: runtimeCapabilities!.provider, sandboxId: sandbox.sandboxId };
      }
      if (run.agent.kind !== "sandbox") log(t("runner.useRemoteAgent"));

      const plannedState = run.state;
      const attemptState: AttemptState = plannedState._tag === "Stateless"
        ? { _tag: "Stateless" }
        : reusedSandbox === undefined
          ? {
              _tag: "Fresh",
              window: yield* ExperimentStateWindow.make(plannedState, run.experimentId, randomUUID()),
            }
          : reusedSandbox.stateWindow?._tag === "Stateful"
            ? {
                _tag: "Reused",
                window: reusedSandbox.stateWindow.window,
                lastPlannedUse: reusedSandbox.lastPlannedUse === true,
              }
            : yield* Effect.die(
                new Error("Stateful AgentRun received a Stateless reusable Sandbox lease."),
              );
      attemptStateForResult = attemptState;
      const commandTarget = createSandboxCommandTarget(sandbox);

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
          // 远程沙箱(e2b / vercel):在沙箱内起 collector,agent 往 localhost 端口发。
          // 这一步是「创建本次 tracing 出口」(telemetry.configure 的定义,见
          // docs/feature/experiments/cli.md 的阶段表),而且是唯一一条要往沙箱里传脚本、
          // 起进程、等端口的 tracing 出口——秒级耗时与失败都归它自己,不能顺着上一个还开着的
          // 阶段记成 sandbox.create(那样 collector 起不来会伪装成「起沙箱失败」)。
          enterPhase("telemetry.configure");
          receiver = yield* createInSandboxTraceReceiver(sandbox);
          const endpoint = receiver.endpoint("");
          const env = run.agent.tracing?.env?.(endpoint);
          telemetry = env ? { endpoint, env } : { endpoint };
          const proto = run.agent.tracing?.protocol;
          log(t("runner.otlpInSandbox", { endpoint, proto: proto ? ` (${proto})` : "" }));
        }
      }

      // attempt-scope 的进程内 adapter（如 aiSdkAgent + aiSdkOtel）虽然拥有独立 receiver，
      // 仍需要逐轮窗口归属来给 TimingActivity 写入真实 traceId。独立 receiver 不会与其它
      // attempt 混流，因此直接复用同一个 AgentOtelChannel 算法，不必升级成 run 级共享池。
      if (run.agent.kind !== "sandbox" && receiver !== undefined && otelChannel === undefined) {
        otelChannel = new AgentOtelChannel(receiver);
      }

      if (run.agent.kind === "sandbox" && !reusedSandbox) {
        // 后加先跑:release 链开始时打起点戳(与上面的终点戳配对,测出整段 sandbox.stop)。
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            releaseStartedAt = Date.now();
          }),
        );
      }

      // 超时收尾段的证据保全(docs/runner.md「超时:双层保护」超时不丢证据)。注册在这里,
      // LIFO 意味着 release 时它先于上面已注册的 sandbox stop/suspend finalizer 跑——此刻沙箱
      // (若有)仍然存活,赶在停之前抢一次 workspace.diff 折叠;`timedOut` 由 Effect.timeoutTo
      // 的 onTimeout 同步置位,正常收尾(body 走完)时这里直接跳过,不重复采一次已经采过的证据。
      // 沙箱此刻可能已经被 agent 搞挂——withCleanupTimeout 有界执行,导出挂起也不能拖住收尾,
      // 到点如实缺失。计时单独记一条 phases 条目,不入 durationMs(durationMs 已在 onTimeout
      // 按中断时刻定格)。sources 折叠是本地文件读取,与沙箱是否存活无关,一并在这里补。
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          if (!timedOut) return;
          const events = liveEvents?.() ?? [];
          if (run.agent.kind === "sandbox" && liveLedger) {
            const startedAt = Date.now();
            try {
              timeoutDiff = await withCleanupTimeout(() => liveLedger!.exportWindows());
            } catch {
              // 沙箱不可用 / 导出挂起到点:如实缺失,不阻塞收尾。
            } finally {
              recorder.record("workspace.diff", Date.now() - startedAt);
            }
          }
          try {
            timeoutSources = await withCleanupTimeout(() => collectSources(events, [], evalDef.source));
          } catch {
            // 源码读不到:如实缺失,不阻塞收尾。
          }
        }),
      );

      // 先登记作者 cleanup、再登记 State；Scope 的 LIFO 让实际收尾顺序固定为
      // Agent teardown(body finally) → State save → 作者 cleanup → Provider Case finalizer。
      // cleanup 使用新的有界 signal，不复用已经超时/取消的 Attempt signal。
      if (run.agent.kind === "sandbox") {
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            if (layerCleanups.length === 0) return;
            enterPhase("sandbox.cleanup");
            await recorder
              .measureClosing("sandbox.cleanup", async () => {
                const before = diagnostics.length;
                for (let i = layerCleanups.length - 1; i >= 0; i--) {
                  const cleanup = layerCleanups[i]!;
                  const startedAt = Date.now();
                  const node = recorder.child(sandboxPrepareActivity({
                    label: `${cleanup.label} cleanup`,
                    startOffsetMs: Math.max(0, startedAt - t0),
                  }));
                  if (node) recorder.pushParent(node);
                  try {
                    const cleanupSignal = AbortSignal.timeout(CLEANUP_TIMEOUT_MS);
                    await withCleanupTimeout(() => cleanup.command(commandTarget, {
                      ...cleanup.context,
                      signal: cleanupSignal,
                    }));
                  } catch (error) {
                    if (node) node.failed = true;
                    declareFailure("sandbox.cleanup", error);
                    diagnostics.push(teardownDiagnostic("sandbox.cleanup", error));
                  } finally {
                    if (node) {
                      node.durationMs = Date.now() - startedAt;
                      recorder.popParent();
                    }
                  }
                }
                if (diagnostics.length > before) throw new Error("sandbox cleanup diagnostics");
              })
              .catch(() => {});
          }),
        );
      }

      const finalizeState =
        attemptState._tag === "Fresh" ||
        (attemptState._tag === "Reused" && attemptState.lastPlannedUse);
      if (attemptState._tag !== "Stateless" && finalizeState) {
        yield* Effect.addFinalizer(() => {
          enterPhase("state.save");
          const startedAt = Date.now();
          return Effect.either(attemptState.window.finalize({
            sandbox: commandTarget,
            progress: scopedFeedback.progress,
            diagnostic: (input) => scopedFeedback.diagnostic({ ...input, level: "warning" }),
            fact: (key, value) => recordFact(facts, key, value),
          }, {
            completion: scopeOutcome.completion,
            budget: { _tag: "Bounded", timeoutMs: CLEANUP_TIMEOUT_MS },
          })).pipe(
            Effect.tap((finalized) => Effect.gen(function* () {
              recorder.record("state.save", Date.now() - startedAt, Either.isLeft(finalized));
              if (Either.isLeft(finalized)) {
                scopeOutcome.stateFailure = finalized.left;
                declareFailure("state.save", finalized.left);
              } else {
                scopeOutcome.stateRecord = finalized.right;
              }
              const snapshot = yield* attemptState.window.snapshot();
              if (snapshot._tag === "Finalized") scopeOutcome.stateRecord = snapshot.record;
            })),
            Effect.asVoid,
          );
        });
      }

      // body 是 Promise(adapter 边界)。Effect.promise 给的 AbortSignal 在本 fiber 被中断
      //(用户 Ctrl+C / 下面 timeoutTo 到点)时 abort —— 并进 signal,让真正观察 signal 的
      // adapter / docker 命令随中断一起停,而不只靠 Sample release 兜底。
      const bodyResult = yield* Effect.promise((interruptSignal) =>
        runAttemptBody(a, config, t0, base, {
          sandbox,
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
          ...(attemptTimeout ? { attemptTimeout } : {}),
          ...(deadlineAt !== undefined ? { deadlineAt } : {}),
          attemptEpoch: t0,
          feedback: scopedFeedback,
          diagnostics,
          facts,
          commands,
          concurrencySlot,
          declareFailure,
          attemptState,
          layerCleanups,
          complete: (result, agentTeardownSucceeded) => {
            scopeOutcome.completion = completionFor(result, agentTeardownSucceeded);
          },
          registerEvidence: (getEvents, getUsage, getRetryAttempts) => {
            liveEvents = getEvents;
            liveUsage = getUsage;
            liveRetryAttempts = getRetryAttempts;
          },
          registerLedger: (ledger) => {
            liveLedger = ledger;
          },
          ...(opts.artifactPrepare !== undefined ? { prepareCoordinator: opts.artifactPrepare } : {}),
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
        const providerName = runtimeCapabilities!.provider;
        if (runtimeCapabilities!.retention._tag === "Suspendable") {
          try {
            const enter = nativeEnterCommand(providerName, sandbox.sandboxId);
            const keptAt = new Date().toISOString();
            const expiresAt = computeExpiresAt(providerName, keptAt);
            yield* Effect.promise(() =>
              writeKeptEntry(niceevalRoot, {
                sandboxId: sandbox.sandboxId,
                provider: providerName,
                evalId: evalDef.id,
                attempt,
                ...(run.experimentId !== undefined ? { experimentId: run.experimentId } : {}),
                locator: String(a.locator),
                verdict: bodyResult.verdict,
                keptAt,
                workdir: sandbox.workdir,
                ...(enter !== undefined ? { enter } : {}),
                ...(expiresAt !== undefined ? { expiresAt } : {}),
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
            // 只有 `kept` 在收尾时点决定;provider / sandboxId 等归属键仍由租借时刻的
            // sandboxFacts 统一挂上(见下方 Effect.map)。
            kept = true;
            return bodyResult;
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
    // attempt 总超时的硬边界(无上限时这一层不挂,见 applyAttemptDeadline)。
    applyAttemptDeadline,
    // body 自己已兜了 agent 执行错;这里兜的是资源获取 / Sample 层的意外(起沙箱失败等)。
    // 中断【不】吞:此时 Sample 已跑完 release(容器已停),把中断继续上抛,让 forEach 整体停掉,
    // 否则会把中断「恢复」成一条 errored 结果、并让后续 attempt 继续起 —— 那就停不下来了。
    Effect.catchAllCause((cause) =>
      Cause.isInterrupted(cause)
        ? Effect.interrupt
        : Effect.suspend(() => {
            // 资源获取 / Sample 层的意外(起沙箱失败、provisioning 的确定性配置死因)同样是终局
            // 失败:先读空间轴回执,再折成纯数据 AttemptError(顺序不可换,见 declareFailure)。
            const raw = Cause.squash(cause);
            const phase = (sendActive ? "agent.run" : lastPhase) ?? "eval.run";
            declareFailure(phase, raw);
            return Effect.succeed({
              ...base,
              durationMs: Date.now() - t0,
              error: errorFromThrown(raw, sendActive ? "agent.run" : lastPhase, attemptTimeout),
              ...(commands.length > 0 ? { commands: [...commands] } : {}),
            });
          }),
    ),
    // 结果封口在 Sample release 完成之后:sandbox.stop 已由 finalizer 写进 recorder,
    // 这里把完整的阶段计时挂到即将交还的结果上(timeout / scope 兜底分支同样带上)。超时路径
    // 额外把上面那个 finalizer 折叠出的 workspace.diff / sources 并进来——它俩是异步产出,
    // 必须等 Sample release(本 map 之前的所有 finalizer)跑完才有值,不能在 onTimeout 的同步
    // 回调里就地给,原理与 phases 完全一致(见该 finalizer 与 onTimeout 的注释)。
    Effect.map((r: EvalResult): EvalResult => {
      const stateFailure = scopeOutcome.stateFailure;
      const afterState: EvalResult = stateFailure === undefined
        ? r
        : {
            ...r,
            verdict: "errored",
            error: {
              ...errorFromThrown(stateFailure, "state.save"),
              code: stateFailure instanceof ExperimentStateSequenceFailure && stateFailure.activity.outcome === "failed"
                ? stateFailure.activity.code
                : "state.save.failed",
            },
          };
      const state = attemptStateForResult._tag === "Stateless"
        ? undefined
        : run.state._tag !== "Stateless" && run.state.cadence === "attempt" && scopeOutcome.stateRecord !== undefined
          ? {
              windowId: scopeOutcome.stateRecord.windowId,
              load: scopeOutcome.stateRecord.load,
              save: scopeOutcome.stateRecord.save,
            }
          : { windowId: attemptStateForResult.window.windowId };
      const withEvidence: EvalResult = {
        ...afterState,
        ...(diagnostics.length > 0 ? { diagnostics: [...diagnostics] } : {}),
        ...(Object.keys(facts).length > 0 ? { facts: { ...facts } } : {}),
        ...(commands.length > 0 ? { commands: [...commands] } : {}),
        ...(state !== undefined ? { state } : {}),
      };
      const phases = recorder.finalize();
      // 现有阶段计时尚未把 sandbox.create 起点单独持久化；在它可用前落同口径的保守值，
      // 读取旧记录也按 durationMs 回退，绝不因缺值错误携带。
      const withPhases = {
        ...(phases ? { ...withEvidence, phases } : withEvidence),
        executionMs: withEvidence.executionMs ?? withEvidence.durationMs,
      };
      // 调度事实统一在这里挂:每条出口(正常、body 抛错、超时、Sample 层失败)都经过本 map,
      // 归属因此不随「走到了哪一步」丢失(见 sandboxFacts 的声明)。
      const withSandbox = sandboxFacts
        ? { ...withPhases, sandbox: { ...sandboxFacts, ...(kept ? { kept: true as const } : {}) } }
        : withPhases;
      if (!timedOut) return withSandbox;
      return {
        ...withSandbox,
        ...(timeoutDiff !== undefined ? { diff: timeoutDiff } : {}),
        sources: timeoutSources ?? [],
      };
    }),
  );
}

/** 把 catch 到的 e(body 里 test()/setup 抛错,或 Sample 层 squash 出来的原始错误)折成
 *  `AttemptError`。message/stack/cause 由 `describeError` 拆分;phase 取失败那一刻打开的
 *  生命周期阶段(极早期就挂、还没跨进任何阶段时兜底 `eval.run`——phase 是必填字段,不留空);
 *  code 目前只对确定已知的类别赋稳定码,其余走 `"unexpected-error"`——provider 专属的限流码
 *  分类留在各 provider 的 `classifyProvisionError`,没有中性入口能在这里复算,不猜一个可能错的码。 */
export function errorFromThrown(
  e: unknown,
  phase: LifecyclePhase | undefined,
  deadline?: { timeoutMs: number; source: TimeoutSource },
): AttemptError {
  if (isSendFailure(e)) {
    const nestedFailure = isSendFailure(e.cause) ? e.cause : undefined;
    const detail = e.cause === undefined || nestedFailure ? undefined : describeError(e.cause);
    return {
      code: "agent-send-failed",
      message: sendFailureText(e),
      origin: attemptOrigin(phase ?? "eval.run"),
      ...(detail?.stack ? { stack: detail.stack } : {}),
      ...(nestedFailure
        ? { cause: { message: sendFailureText(nestedFailure) } }
        : detail
          ? { cause: detail.cause ?? { message: detail.message } }
          : {}),
    };
  }
  const { message, stack, cause } = describeError(e);
  // 沙箱命令撞线抛的是带归属的错(见 sandbox/deadline.ts):显式传 timeout 的那条命令归
  // `command-timeout`,没显式传的那条上限本来就是 attempt deadline 派生的,归属如实指回
  // deadline —— 两者都不是「不明原因的 unexpected-error」。
  const timeout = timeoutAttributionOf(e, deadline);
  return {
    code: timeout ? "timeout" : "unexpected-error",
    message,
    origin: attemptOrigin(phase ?? "eval.run"),
    ...(timeout ? { timeout } : {}),
    ...(stack ? { stack } : {}),
    ...(cause ? { cause } : {}),
  };
}

/**
 * 命令撞线错误 → 归属三元组;不是这类错误返回 undefined。
 *
 * 命令没显式传 `timeout` 时,它撞的那条线本来就是 attempt deadline 派生出来的剩余量:
 * 归属如实指回 deadline 那一层(值与来源都取解析链的赢家),而不是编造一个「命令自己的上限」。
 */
function timeoutAttributionOf(
  e: unknown,
  deadline?: { timeoutMs: number; source: TimeoutSource },
): TimeoutAttribution | undefined {
  if (!(e instanceof SandboxCommandTimeoutError)) return undefined;
  if (e.explicit) return { trigger: "command-timeout", limitMs: e.limitMs, source: "command" };
  return deadline === undefined
    ? { trigger: "command-timeout", limitMs: e.limitMs, source: "command" }
    : { trigger: "attempt-deadline", limitMs: deadline.timeoutMs, source: deadline.source };
}

/**
 * provider 固有会话上限的派发前预检:deadline 超出它时 attempt 会跑到一半被平台截断,
 * 与其让它跑一半赔钱,不如在这里报环境约束——点名 provider 与上限值,并给出两条出路。
 * 全实验同因必死(同一个 provider、同一条 deadline),因此按 experiment 域止损。
 */
function assertDeadlineFitsPlan(
  capabilities: ReturnType<typeof sandboxRuntimeCapabilities>,
  deadlineMs: number | undefined,
): void {
  if (deadlineMs === undefined) return;
  if (capabilities.sessionLimit._tag === "Unlimited") return;
  const limit = capabilities.sessionLimit.milliseconds;
  if (deadlineMs <= limit) return;
  throw new ExperimentFatalError(
    t("sandbox.deadlineExceedsSession", {
      provider: capabilities.provider,
      limitMs: limit,
      timeoutMs: deadlineMs,
    }),
  );
}

interface AttemptResources {
  sandbox: Sandbox;
  /** 本 attempt 解析出的超时上限与它的出处;超时归属(`error.timeout`)照它落盘。 */
  attemptTimeout?: { timeoutMs: number; source: TimeoutSource };
  /** attempt deadline 的截止**时刻**;命令节点的时限归属按它算剩余量。四层都没声明上限时缺席。 */
  deadlineAt?: number;
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
  /**
   * attempt 级运行事实累计(runAttemptEffect 持有的同一个 Record 引用,与 diagnostics 同一种
   * 「共享可变容器」模式):runAttemptBody 用它构造 ctx.fact() 闭包,并在 finally 里原样
   * 挂到即将返回的结果上(见 diagnostics 的并入点)。
   */
  facts: globalThis.Record<string, FactValue>;
  /**
   * attempt 级非零 Sandbox 命令证据累加(runAttemptEffect 持有的同一个数组引用,与
   * diagnostics/facts 同一种「共享容器」模式):`withCommandTiming` 往这里 push,
   * finally 挂到即将返回的结果上(见 diagnostics 的并入点)。
   */
  commands: FailedCommandEvidence[];
  /** turn 级重试退避期间释放/收回的全局并发槽位;透传给 createEvalContext。 */
  concurrencySlot?: ConcurrencySlot;
  /** 终局失败的空间轴回执(runAttemptEffect 持有的同一个闭包):body 的失败路径与 finally 里的
   *  per-attempt teardown 失败都经它上报,止损闸据此落闸(见 runAttemptEffect 的 declareFailure)。 */
  declareFailure: (phase: LifecyclePhase, e: unknown) => void;
  /** State window 由外层 Effect Scope 持有；Promise author 边界只执行 load，不负责 finalizer。 */
  attemptState: AttemptState;
  /** 作者 prepare 成功后登记的 cleanup；由外层 Scope 在 State finalizer 之后全局 LIFO 执行。 */
  layerCleanups: LayerCleanupEntry[];
  /** Agent teardown 完成后提交显式 completion ADT，供 State Scope finalizer 读取。 */
  complete(result: EvalResult | undefined, agentTeardownSucceeded: boolean): void;
  /** SessionManager 一建好就登记事件/用量的读取句柄回外层(超时证据保全用,见
   *  runAttemptEffect 顶部 liveEvents/liveUsage 的注释与 docs/runner.md「超时:双层保护」)。 */
  registerEvidence: (
    getEvents: () => readonly StreamEvent[],
    getUsage: () => Usage,
    getRetryAttempts: () => readonly RetryAttemptRecord[],
  ) => void;
  /** 变更分类账一建好(workspace.baseline 阶段)就登记回外层(超时收尾段折叠 workspace.diff 用)。 */
  registerLedger: (ledger: ChangeLedger) => void;
  /** Run 级 Agent artifact prepare 协调器；仅 Runner 的 agent.ensure 使用。 */
  prepareCoordinator?: import("../agents/provisioner.ts").ArtifactPrepareCoordinator;
}

type AttemptState =
  | { readonly _tag: "Stateless" }
  | { readonly _tag: "Fresh"; readonly window: ExperimentStateWindow }
  | {
      readonly _tag: "Reused";
      readonly window: ExperimentStateWindow;
      readonly lastPlannedUse: boolean;
    };

interface LayerCleanupEntry {
  readonly command: SandboxCleanupCommand;
  readonly context: Omit<SandboxCommandContext, "onCleanup">;
  readonly label: string;
}

interface AttemptScopeOutcome {
  completion: AttemptCompletion;
  stateFailure: ExperimentStateSequenceFailure | StateWindowTransitionFailure | undefined;
  stateRecord: import("../state/types.ts").StateWindowRecord | undefined;
}

// attempt 的固定段(上传→基线→setup→驱动 agent→采 diff→脚本→评分→判定)。
// 资源已由 runAttemptEffect 的 Sample 持有;这里只在 finally 跑 agent 自己的 cleanup/teardown。
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
    facts,
    commands,
    concurrencySlot,
    declareFailure,
    attemptState,
    layerCleanups,
    complete,
    registerEvidence,
    registerLedger,
    prepareCoordinator,
  } = res;
  // ctx.fact() 闭包:校验后写进 res.facts(与 runAttemptEffect 共享的同一个 Record 引用),
  // finally 把它原样挂到即将返回的结果上(与 diagnostics 同一种「共享容器 + finally 并入」模式)。
  const fact = (key: string, value: FactValue) => recordFact(facts, key, value);
  const usesSandbox = run.agent.kind === "sandbox";
  // 命令时间树:所有经这个包装 sandbox 发出的 runCommand/runShell 都挂成当前阶段(或当前 hook
  // 节点)下的 command 子节点。包装只在最外层公开调用记录一次——provider 内部转调不经过它。
  const sandbox = usesSandbox ? withCommandTiming(rawSandbox, recorder, getPhase, commands, res.deadlineAt) : rawSandbox;
  // 在两个 return 前赋值,好让 finally 把 diagnostics 挂到即将返回的同一个对象上(见 finally 末尾)。
  let result: EvalResult | undefined;
  // Direct Agent 只拿基础 ctx；Sandbox Agent 才拿带真实 Sandbox 的扩展 ctx。
  const attemptCtx: AgentContext = {
    signal,
    evalId: evalDef.id,
    attempt: { id: evalDef.id, index: attempt },
    model: run.model,
    reasoningEffort: run.reasoningEffort,
    flags: run.flags,
    experimentId: run.experimentId,
    session: createAgentSession(),
    telemetry,
    progress: feedback.progress,
    diagnostic: feedback.diagnostic,
    fact,
    // log 是 progress({ message }) 的别名,不是第二条通道(见 AgentContext.log 注释)。
    log,
  };
  const sandboxAttemptCtx: SandboxAgentContext = { ...attemptCtx, sandbox };
  const commandTarget = createSandboxCommandTarget(sandbox);
  /** agent.setup 时点已走到(未声明 setup 也置位)——agent.teardown 的触发条件(成对触发规则)。 */
  let agentSetupReached = false;
  let agentTeardownSucceeded = true;
  /** adapter 在 agent.setup 里经 `ctx.reportSetup()` 交回的安装清单(宿主侧内存对象,不经沙箱磁盘;
   *  装了 Skill / plugin / MCP 的沙箱型 adapter 才有)。运行器只把它抬成 attempt artifact,
   *  不解释内容、不按 agent 名字分支;什么都没装的 adapter 不调用 → undefined,不生成空 artifact。 */
  let agentSetup: AgentSetupManifest | undefined;
  // 变更分类账(仅沙箱型;workspace.baseline 阶段建立)。
  let ledger: ChangeLedger | undefined;
  // discovery 的 entry 快照加上调用发生时首次读取的 helper 快照；不在 attempt 收尾重读。
  const sourceRegistry = createSourceRegistry(process.cwd());
  try {
    if (usesSandbox) {
      // Linker 已按「template owner 在前，另一作者在后」排好命令；fresh/reuse 每条 Attempt
      // 都完整重放。owner 子 phase 只做错误与诊断归因，计时仍聚合在 sandbox.prepare。
      const linked = a.plan._tag === "Sandbox" ? a.plan.pair : undefined;
      if (linked !== undefined && linked.commands.length > 0) {
        enterPhase("sandbox.prepare");
        for (const entry of linked.commands) {
          const ownerPhase = entry.owner.kind === "eval"
            ? "sandbox.prepare.eval"
            : "sandbox.prepare.experiment";
          enterPhase(ownerPhase);
          const label = `${entry.owner.kind}#${entry.index}`;
          const startedAt = Date.now();
          const node = recorder.child(sandboxPrepareActivity({
            label,
            startOffsetMs: Math.max(0, startedAt - attemptEpoch),
          }));
          if (node) recorder.pushParent(node);
          const cleanupContext: Omit<SandboxCommandContext, "onCleanup"> = {
            phase: "prepare",
            owner: entry.owner,
            attempt: { id: `${run.experimentId}/${evalDef.id}`, index: attempt },
            signal,
            progress: feedback.progress,
            diagnostic: feedback.diagnostic,
            facts: fact,
          };
          const context: SandboxCommandContext = {
            ...cleanupContext,
            onCleanup(command) {
              if (typeof command !== "function") throw new TypeError("sandbox cleanup must be a function");
              layerCleanups.push({ command, context: cleanupContext, label });
            },
          };
          try {
            await entry.command(commandTarget, context);
          } catch (error) {
            if (node) node.failed = true;
            throw error;
          } finally {
            if (node) {
              node.durationMs = Date.now() - startedAt;
              recorder.popParent();
            }
          }
        }
      }

      // 两侧作者的环境准备完成后，Runner 统一执行 Agent ensure；adapter setup 只能写运行时
      // 配置/凭据，不能自行安装或跳过 probe → install → recheck 循环。
      if (run.agent.kind === "sandbox") {
        if (a.plan._tag !== "Sandbox") {
          throw new Error(`sandbox agent ${JSON.stringify(run.agent.name)} received a Direct plan`);
        }
        enterPhase("agent.ensure");
        log(t("runner.startAgentEnsure"));
        const verified = await Effect.runPromise(Effect.either(
          verifySandboxTargetPlatform(sandbox, a.plan.providerPlan.target.platform),
        ));
        if (Either.isLeft(verified)) throw verified.left;
        const ensureEffect = runAgentEnsure(run.agent.ensure, run.agent.installers, sandbox, {
          fact,
          coordinator: Option.fromNullable(prepareCoordinator),
          targetPlatform: a.plan.providerPlan.target.platform,
          signal,
          progress: feedback.progress,
        });
        const ensured = await Effect.runPromise(Effect.either(ensureEffect));
        if (Either.isLeft(ensured)) throw ensured.left;
      }

      if (
        attemptState._tag !== "Stateless" &&
        Effect.runSync(attemptState.window.needsLoad())
      ) {
        enterPhase("state.load");
        const loaded = await Effect.runPromise(Effect.either(attemptState.window.load({
          sandbox: commandTarget,
          progress: feedback.progress,
          diagnostic: (input) => feedback.diagnostic({ ...input, level: "warning" }),
          fact,
        })));
        if (Either.isLeft(loaded)) throw loaded.left;
      }

      // 作者准备、Agent ensure 与 State load 都不属于 Agent diff；Runner 在这些
      // 基础设施活动完成后建立统一的 Agent 可归因起点。
      enterPhase("workspace.baseline");
      ledger = await createChangeLedger(sandbox, evalDef.diff === undefined
        ? undefined
        : { include: [...evalDef.diff.include], ignore: [...evalDef.diff.ignore] });
      registerLedger(ledger);
    }

    // agent 自己的 lifecycle:装 CLI、写 config(每个沙箱一次,不在每轮 send 里)。
    // 时点在此走到(未声明 setup 也算)——agent.teardown 据此触发。
    agentSetupReached = true;
    if (run.agent.setup) {
      enterPhase("agent.setup");
      log(t("runner.startAgentSetup"));
      const returned = (await (run.agent.kind === "sandbox"
        ? run.agent.setup(sandbox, {
            ...sandboxAttemptCtx,
            reportSetup: (manifest) => (agentSetup = manifest),
          })
        : run.agent.setup(attemptCtx))) as unknown;
      if (typeof returned === "function") {
        throw new Error(
          t("runner.setupReturnedCleanup", {
            layer: `Agent.setup (${run.agent.name})`,
            hint: "Agent.teardown",
          }).trimEnd(),
        );
      }
    }

    // OTLP 导出配置(file-based,如 codex 的 config.toml [otel] 块):与 setup 分开,
    // 在主配置写完后追加。仅当 tracing 开 + 有 endpoint 时调一次(env-based 的不实现 configure)。
    if (telemetry && run.agent.kind === "sandbox" && run.agent.tracing?.configure) {
      enterPhase("telemetry.configure");
      log(t("runner.startAgentTracing"));
      await run.agent.tracing.configure(sandbox, sandboxAttemptCtx);
    }

    // 构造 t,跑 test
    enterPhase("eval.run");
    log(t("runner.driveAgent"));
    const judge = resolveJudge(run.judge, evalDef.judge, config.judge);
    const { context, state } = createEvalContext({
      agent: run.agent,
      sandbox,
      evalId: evalDef.id,
      attempt: { id: evalDef.id, index: attempt },
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
      fact,
      concurrencySlot,
      // 实验分类器:send 链上排在 adapter 的 classifySendFailure 之前(见
      // docs/feature/error-classification/architecture.md「分类链」)。与本文件 declareFailure
      // 走的生命周期链是同一个函数,两条链的决议序各自单源在 send-failures.ts / failure-class.ts。
      experimentClassifier: run.classifyFailure,
      // 题型:计分制下句柄上的 .gate() 是前置(就地求值 + 挂了中止 test()),见 collector。
      scoring: evalDef.scoring ?? "pass",
      // 前置断言就地求值要看当前已提交窗口的 agent diff(非沙箱型没有分类账,省略)。
      ...(ledger ? { liveDiff: async () => deriveDiffData(await ledger!.exportWindows()) } : {}),
      // send 窗口钩子:进入前落 eval 归因、返回后落 agent 归因(见 ledger.ts)。
      ledgerHooks: ledger
        ? {
            beforeSend: (label) => ledger!.commitEvalWindow(label),
            afterSend: (label) => ledger!.commitAgentWindow(label),
          }
        : undefined,
      onSendActive: setSendActive,
      // 每次 send 一个 turn 节点:本地单调时钟测得的端到端包络 + session/turn 身份;
      // OTel 接入时再带 traceId,trace.json 的 spans 由消费方按它临时挂到 turn 下。usage 有记录
      // 才带(show `--execution`/`--timing` 的 turn 头行读 TimingNode.usage,见 docs/feature/
      // results/architecture.md「result.json」TimingNode.usage)。
      onTurn: (info) =>
        recorder.child(turnActivity({
          label: `s${info.sessionIndex}/t${info.turnIndex}`,
          startOffsetMs: Math.max(0, info.startedAt - attemptEpoch),
          durationMs: info.durationMs,
          ...(info.failed ? { failed: true as const } : {}),
          sessionIndex: info.sessionIndex,
          turnIndex: info.turnIndex,
          ...(info.traceId !== undefined ? { traceId: info.traceId } : {}),
          ...(info.traceAttribution !== undefined ? { traceAttribution: info.traceAttribution } : {}),
          ...(info.usage !== undefined ? { usage: info.usage } : {}),
        })),
    });
    // 登记回外层:超时中断后由 onTimeout 直接读这两个句柄组装 events/usage(见
    // registerEvidence 注释、docs/runner.md「超时:双层保护」超时不丢证据)。
    registerEvidence(
      () => state.manager.allEvents,
      () => state.manager.usage,
      () => state.manager.retryAttempts,
    );

    let error: AttemptError | undefined;
    let skipReason: string | undefined;
    try {
      await withSourceRegistry(sourceRegistry, () => evalDef.test(context as ScoreTestContext));
      // test() 正常返回也要结算待决前置:最后一条前置挂了而后面没有 t.* 调用时,
      // 中止信号在这里抛出(判定与写了 await 完全一致)。
      const aborted = await state.collector.settlePrerequisites();
      if (aborted !== undefined) throw new EvalRequirementFailed(aborted);
    } catch (e) {
      if (e instanceof EvalSkipped) skipReason = e.reason;
      else if (e instanceof EvalRequirementFailed) {
        /* 断言已记录,非执行错误 */
      } else {
        // eval 脚本(比如引用了已改名/删掉的 API)抛出的 TypeError:message 是一层原因,完整 stack
        // 单独进 `error.stack`,niceeval show 展开时才看得到 eval 文件的 file:line。
        // 作者从 test(t) 体内抛的 ExperimentFatalError / EvalFatalError 也走这条分支。
        declareFailure(getPhase() ?? "eval.run", e);
        error = errorFromThrown(e, getPhase(), res.attemptTimeout);
      }
    }

    if (skipReason) log(t("runner.skip", { reason: skipReason }));

    // 采 agent 归因增量(workspace.diff 阶段:从分类账折叠逐窗口 delta)。remote agent 没有 workspace。
    if (!skipReason && usesSandbox) enterPhase("workspace.diff");
    let diffWindows: DiffArtifact = [];
    if (!skipReason && usesSandbox && ledger) {
      const startedAt = Date.now();
      const operation = recorder.child(workspaceDiffExportActivity({
        label: "export workspace diff",
        startOffsetMs: Math.max(0, startedAt - attemptEpoch),
        durationMs: 0,
      }));
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

    const scripts: globalThis.Record<string, ScriptResult> = {};
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
      evidenceCoverage: state.manager.evidenceCoverage,
      readFile: async (path) => {
        try {
          return await sandbox!.readText(path);
        } catch {
          return undefined;
        }
      },
    };
    if (!skipReason) enterPhase("scoring.evaluate");
    // 类型面挡住通过制 t.points()/t.score()，但 tsx 与 JS 可绕过；持久化边界必须再门控一次。
    const assertions = skipReason
      ? []
      : await state.collector.finalize(scoringContext, {
          includePoints: evalDef.scoring === "points",
          // scoring 阶段唯一值得解释的等待是「在等裁判模型」:有判分断言时逐条推进 detail,
          // 没有则整段不发 detail(见 docs/feature/experiments/cli.md「Attempt 阶段」)。
          // 文本是契约字面量,中英一致,不进 i18n。
          onJudgeProgress: ({ index, total, check }) => log(`judge ${index}/${total} · ${check}`),
        });
    const verdict = computeVerdict({ error, assertions, skipReason, strict: run.strict, scoring: evalDef.scoring ?? "pass" });

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

    // 主链到 telemetry.collect 为止。必须在 Effect Sample release 之前显式封口；否则最后一个
    // 主链 phase 会一直开到 sandbox.stop 完成，既把收尾时间重复算进主链，也会让 phases
    // 主链合计大于 durationMs。Sample finalizer 只负责另记 sandbox.stop / sandbox.suspend。
    recorder.closeCurrent();
    const durationMs = Date.now() - t0;
    const o11y = buildO11ySummary(events);
    // 实测成本(网关带回)优先,缺则按 model + 用量查价格表估算(见 o11y/cost.ts)。
    // 权威唯一在 result.json 的 estimatedCostUSD;o11y.json 只留行为计数(见 docs/feature/record/architecture.md「o11y.json」)。
    const cost = usage.costUSD ?? estimateCost(run.model, usage, config.pricing);

    // 收 test 引用到的 eval 源码(按 send / 断言的 loc 去重),供 view 渲染代码视图。
    const sources = await collectSources(events, assertions, evalDef.source, sourceRegistry);

    const value: EvalResult = {
      id: evalDef.id,
      description: evalDef.description,
      experimentId: run.experimentId,
      experiment: experimentRunInfo(run, a.plan, a.sandboxPlansByEval, config, evalDef.judge),
      agent: run.agent.name,
      model: run.model,
      verdict,
      fingerprint: a.fingerprint,
      configHash: a.configHash,
      attempt,
      startedAt: new Date(t0).toISOString(),
      durationMs,
      assertions,
      scoring: evalDef.scoring ?? "pass",
      // 只在计分制 eval 上落 scoreEntries(t.score 直接给分记录);通过制 eval 的 t 上没有
      // t.score,collector.scoreEntries 恒为空数组,省略即等价于空数组
      // (见 docs/feature/record/architecture.md「result.json」)。
      ...(evalDef.scoring === "points" ? { scoreEntries: state.collector.scoreEntries } : {}),
      ...(state.manager.retryAttempts.length > 0 ? { retryAttempts: state.manager.retryAttempts } : {}),
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
      evidenceCoverage: state.manager.evidenceCoverage,
      // sandbox 归属不在这里拼:它是租借时刻就定死的调度事实,由 runAttemptEffect 统一挂到
      // 每一条出口结果上(含 setup 失败与超时),见那边的 `sandboxFacts`。
    };
    result = value;
    return value;
  } catch (e) {
    recorder.failCurrent();
    // SandboxLayer command / agent.setup / 评分链路抛出的终局失败:同样先读空间轴回执,
    // 再折成纯数据 AttemptError(顺序不可换,见 declareFailure)。
    declareFailure(getPhase() ?? "eval.run", e);
    const value: EvalResult = {
      ...base,
      durationMs: Date.now() - t0,
      error: errorFromThrown(e, getPhase(), res.attemptTimeout),
      ...(agentSetup !== undefined ? { agentSetup } : {}),
    };
    result = value;
    return value;
  } finally {
    // 收尾段一律在 finally 跑(主链成败都执行),不改判定,各自兜错(diagnostic)、各自计时
    // (不计入 durationMs 口径,见 docs/feature/record/architecture.md)。执行序与 LifecyclePhase
    // 闭集声明一致:agent.teardown → sandbox.cleanup;各段可独立标 failed。
    // 沙箱 stop / 接收器 close 不在这里 —— 由 runAttemptEffect 的 Sample 在本函数返回后回收,
    // 并经 finalizer 计成 sandbox.stop。没有对应 teardown/cleanup 的段直接跳过，不产生空阶段。
    if (agentSetupReached && run.agent.teardown) {
      enterPhase("agent.teardown");
      await recorder
        .measureClosing("agent.teardown", async () => {
          try {
            // 先按 kind 收窄 Agent 联合,再取 teardown —— 否则可选属性访问会把
            // AgentTeardown | DirectAgentTeardown 混成无法调用的签名。
            if (run.agent.kind === "sandbox") {
              const teardown = run.agent.teardown;
              if (teardown) await withCleanupTimeout(() => teardown(sandbox, sandboxAttemptCtx));
            } else {
              const teardown = run.agent.teardown;
              if (teardown) await withCleanupTimeout(() => teardown(attemptCtx));
            }
          } catch (e) {
            agentTeardownSucceeded = false;
            declareFailure("agent.teardown", e);
            diagnostics.push(teardownDiagnostic("agent.teardown", e));
            throw e;
          }
        })
        .catch(() => {});
    }
    // Agent teardown 是 Promise author 边界内最后一步；State / author cleanup / Provider Case
    // 都由外层 Effect Scope finalizer 接管。这里只提交显式 completion ADT，不手写后续清理链。
    complete(result, agentTeardownSucceeded);
  }
}

function completionFor(
  result: EvalResult | undefined,
  agentTeardownSucceeded: boolean,
): AttemptCompletion {
  const verdict = result?.verdict;
  const persistedVerdict = verdict === "passed" || verdict === "failed"
    ? verdict
    : "errored";
  if (!agentTeardownSucceeded) {
    return { _tag: "AgentTeardownFailed", verdict: persistedVerdict };
  }
  return persistedVerdict === "passed"
    ? { _tag: "Succeeded" }
    : { _tag: "VerdictNotPassed", verdict: persistedVerdict };
}

/** 把一次 teardown / cleanup 失败折成一条 `DiagnosticRecord`(warning,不改判定)。message 取一层
 *  摘要(`firstLine(formatThrown)`),完整 stack 不塞进单 attempt 诊断 —— 诊断是「顺带发生的清理
 *  问题」,不是 attempt 的主因(主因在 verdict / error)。稳定 code `teardown-failed`。 */
function teardownDiagnostic(phase: LifecyclePhase, e: unknown): DiagnosticRecord {
  return {
    code: "teardown-failed",
    level: "warning",
    detail: firstLine(formatThrown(e)),
    origin: attemptOrigin(phase),
  };
}

/**
 * 命令时间树包装:runCommand / runShell 的最外层公开调用各记一个 command 子节点
 * (有界脱敏摘要 + exitCode;env 值与 stdout/stderr 不进入时间树)。Proxy 只拦这两个方法,
 * provider 内部 `this.runCommand(...)` 转调不经过它——不形成重复节点。非零退出的命令额外
 * 把完整 `CommandResult` 登记进 `commands` 累加器,登记发生在把结果交还调用方**之前**
 * (docs/feature/record/architecture.md「commandsjson」);登记不改变 `runCommand` 的
 * 返回/抛错语义,调用方可以处理非零退出并继续,证据仍保留。只记录成功拿到 `CommandResult`
 * 且 `exitCode !== 0` 的情形——`fn()` 本身抛错(如传输失败)不产出 `CommandResult`,不在这
 * 条证据线里,那类失败只落进时间树的 `failed` 标记。
 */
function withCommandTiming(
  sandbox: Sandbox,
  recorder: TimingRecorder,
  getPhase: () => LifecyclePhase | undefined,
  commands: FailedCommandEvidence[],
  deadlineAt: number | undefined,
): Sandbox {
  const wrap = async <T>(display: string, opts: unknown, fn: () => Promise<T>): Promise<T> => {
    const startOffsetMs = recorder.offsetNow();
    const t0 = Date.now();
    // 这条命令这次生效的线:显式 timeout 归命令自己那层,否则是 attempt deadline 在**命令开始
    // 这一刻**的剩余量——同一台沙箱上的第二条命令拿到的不是一整份上限。
    const limit = commandLimitAttribution(opts as { timeoutMs?: number } | undefined, { deadlineAt }, t0);
    try {
      const result = await fn();
      const exitCode = (result as { exitCode?: unknown })?.exitCode;
      const node = recorder.child(
        commandNode({
          display,
          startOffsetMs,
          durationMs: Date.now() - t0,
          ...(limit !== undefined ? { limit } : {}),
          ...(typeof exitCode === "number" ? { exitCode, failed: exitCode !== 0 } : {}),
        }),
      );
      if (typeof exitCode === "number" && exitCode !== 0 && node) {
        const stdout = result as { stdout?: unknown; stderr?: unknown };
        commands.push({
          timingNodeId: node.id,
          phase: getPhase() ?? "eval.run",
          display,
          exitCode,
          stdout: typeof stdout.stdout === "string" ? stdout.stdout : "",
          stderr: typeof stdout.stderr === "string" ? stdout.stderr : "",
        });
      }
      // CommandResult.command:最外层公开调用恰好是「eval 实际跑了什么」的定义点,摘要
      // 与时间树节点同一份;provider 自己填过就不覆盖。
      if (result !== null && typeof result === "object" && !("command" in result)) {
        return { ...result, command: display } as T;
      }
      return result;
    } catch (e) {
      // 撞线失败的节点带 provider 实际执行的那条线(`SandboxCommandTimeoutError` 自带上限与
      // 「是不是显式声明」),不是这里事前算的那份——两者同源,但 provider 那份是真正掐断它的值。
      const hit =
        e instanceof SandboxCommandTimeoutError
          ? {
              source: e.explicit ? ("command-timeout" as const) : ("attempt-deadline" as const),
              limitMs: e.limitMs,
              timedOut: true as const,
            }
          : limit;
      recorder.child(
        commandNode({
          display,
          startOffsetMs,
          durationMs: Date.now() - t0,
          failed: true,
          ...(hit !== undefined ? { limit: hit } : {}),
        }),
      );
      throw e;
    }
  };
  return new Proxy(sandbox, {
    get(target, prop, receiver) {
      if (prop === "runCommand") {
        return (cmd: string, args?: string[], opts?: unknown) =>
          wrap(commandDisplay(cmd, args), opts, () => (target.runCommand as (...a: unknown[]) => Promise<unknown>)(cmd, args, opts));
      }
      if (prop === "runShell") {
        return (script: string, opts?: unknown) =>
          wrap(commandDisplay(script), opts, () => (target.runShell as (...a: unknown[]) => Promise<unknown>)(script, opts));
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
 * 其它文件(包括 callers 链中的 helper)在首次引用后由 registry 冻结；这里仅把已知路径
 * 补成 artifact。读取失败不能删掉 loc，投影会将该路径表示为 unavailable。
 */
async function collectSources(
  events: readonly StreamEvent[],
  assertions: readonly EvalResult["assertions"][number][],
  evalSource: CapturedEvalSource,
  registry?: SourceRegistry,
): Promise<SourceArtifact[]> {
  if (registry) return registry.artifacts({ path: evalSource.path, content: evalSource.content, role: "entry" });
  const paths = new Set<string>();
  const add = (loc: import("../types.ts").SourceLoc | undefined) => {
    if (!loc) return;
    paths.add(loc.file);
    for (const frame of loc.callers ?? []) if (frame.kind === "project") paths.add(frame.file);
  };
  for (const e of events) if (e.type === "message") add(e.loc);
  for (const a of assertions) add(a.loc);
  const out: SourceArtifact[] = [{ path: evalSource.path, content: evalSource.content, role: "entry" }];
  for (const path of paths) {
    if (path === evalSource.path) {
      continue;
    }
    try {
      out.push({ path, content: await readSourceFile(resolvePath(process.cwd(), path), "utf-8"), role: "referenced" });
    } catch {
      // 缺内容仍保留在 callers 内，assembleSourceTree 会输出 unavailable 段。
    }
  }
  return out;
}

/** 解析后运行配置的穷尽投影(ExperimentRunInfo,见 docs/feature/record/architecture.md):
 *  agent/model 只在快照顶层,这里不复制;sandbox 只经 provider 的公开参数投影落盘。
 *  第二个参数收整份项目配置(而不是只收 sandbox):`sandbox` 与 `timeoutMs` 记录真正生效的
 *  run 级值；Judge 则连同 Eval 层逐字段解析并按 pair 落盘，使同一 Eval 的裁判 A/B 可回放。 */
export function experimentRunInfo(
  run: AgentRun,
  plan: Attempt["plan"],
  sandboxPlansByEval: globalThis.Record<string, import("../types.ts").JsonValue>,
  config?: Pick<Config, "timeoutMs" | "judge">,
  evalJudge?: JudgeConfig,
): EvalResult["experiment"] {
  const plannedState = run.state;
  const runLevelTimeoutMs = run.timeoutMs ?? config?.timeoutMs;
  const judge = resolveJudge(run.judge, evalJudge, config?.judge);
  return {
    ...(run.description !== undefined ? { description: run.description } : {}),
    ...(run.reasoningEffort !== undefined ? { reasoningEffort: run.reasoningEffort } : {}),
    ...(Object.keys(run.flags).length > 0 ? { flags: run.flags } : {}),
    ...(run.labels !== undefined && Object.keys(run.labels).length > 0 ? { labels: run.labels } : {}),
    attempts: run.attempts,
    earlyExit: run.earlyExit,
    ...(runLevelTimeoutMs !== undefined ? { timeoutMs: runLevelTimeoutMs } : {}),
    ...(run.budget !== undefined ? { budget: run.budget } : {}),
    ...(run.maxConcurrency !== undefined ? { maxConcurrency: run.maxConcurrency } : {}),
    selectedEvalIds: [...run.selectedEvalIds],
    ...(run.evalFilterFingerprint !== undefined ? { evalFilterFingerprint: run.evalFilterFingerprint } : {}),
    sandboxLayer: sandboxLayerIdentityFor(plan.pair, "experiment"),
    sandboxPlansByEval: { ...sandboxPlansByEval },
    ...(run.sandboxReuse ? { sandboxReuse: true } : {}),
    ...(plannedState._tag === "Stateless" ? {} : { state: experimentStateProjection(plannedState.definition) }),
    ...(run.strict ? { strict: true } : {}),
    ...(judge
      ? { judge: { model: judge.model, baseUrl: judge.baseUrl, timeoutMs: judge.timeoutMs } }
      : {}),
    agentInstalls: [...agentInstallPlansForRun(run)],
  };
}

export { resolveJudge } from "./judge-config.ts";
