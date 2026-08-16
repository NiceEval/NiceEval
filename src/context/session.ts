// 会话驱动:把 t.send(text) 翻成 agent.send(input, ctx),在同一沙箱里多轮 resume /
// newSession,并把每轮的标准事件流与用量累加进整次运行(供作用域断言 / o11y)。

import { Cause, Effect, Exit, Option } from "effect";

import type { Agent, AgentContext, AgentSession, InputFile, InputRequest, InputResponse, JsonValue, Sandbox, SandboxAgentContext, SessionSlot, StreamEvent, Telemetry, TraceSpan, Turn, TurnInput, Usage } from "../types.ts";
import type { AgentOtelChannel, TurnSpans } from "../o11y/otlp/turn-otel.ts";
import {
  downgradeEvidenceCoverage,
  worstEvidenceCoverage,
  type ResolvedEvidenceCoverage,
} from "../assertions/coverage.ts";
import { captureLoc, type SourceRegistry } from "../source-loc.ts";
import { t } from "../i18n/index.ts";
import {
  createAttemptRetryBudget,
  sendWithTurnRetry,
  type AttemptRetryBudget,
  type ConcurrencySlot,
  type SendRetryDeps,
} from "./send-retry.ts";
import type { AttemptFailureClassifier } from "../shared/failure-class.ts";
import { isSendFailure, normalizeSendFailure, sendFailureText } from "./send-failures.ts";
import type { RetryAttemptRecord, TimingActivity } from "../runner/types.ts";
import { formatTurnLabel } from "../shared/turn-label.ts";

interface PhysicalSendResult {
  readonly turn: Turn;
  readonly traceId?: string;
  readonly attribution?: "traceparent" | "window" | "none";
  readonly window?: TurnSpans["window"];
}

/**
 * 一条会话线的存取器实现。slot 值只按 factory 创建的 symbol 身份存取；
 * 从异构 Map 取出后立即依 typed slot 恢复 `T`，不让擦除后的值流入领域逻辑。
 */
abstract class StoredSessionSlotValue {
  declare private readonly storedSessionSlotValue: void;
}

class StoredSessionSlotValueOf<T> extends StoredSessionSlotValue {
  constructor(readonly value: T) {
    super();
  }
}

function valueFromStoredSlot<T>(stored: StoredSessionSlotValue): T {
  return (stored as StoredSessionSlotValueOf<T>).value;
}

export function createAgentSession(): AgentSession {
  let capturedId: string | undefined;
  const slots = new Map<symbol, StoredSessionSlotValue>();

  return {
    get id() {
      return capturedId;
    },
    capture(id) {
      if (!id || capturedId !== undefined) return; // 空值忽略;first-writer-wins
      capturedId = id;
    },
    get<T>(slot: SessionSlot<T>): T | undefined {
      const stored = slots.get(slot.key);
      return stored === undefined ? undefined : valueFromStoredSlot<T>(stored);
    },
    set<T>(slot: SessionSlot<T>, value: T): void {
      slots.set(slot.key, new StoredSessionSlotValueOf(value));
    },
    take<T>(slot: SessionSlot<T>): T | undefined {
      const stored = slots.get(slot.key);
      if (stored === undefined) return undefined;
      slots.delete(slot.key);
      return valueFromStoredSlot<T>(stored);
    },
  };
}

/**
 * 一条会话线的可变状态。存取器(id/capture/get/set/take)委托给
 * `createAgentSession()`;index/lastMessage/… 是运行器自己的会话簿记,不属于公开契约。
 */
export class RunSession implements AgentSession {
  private readonly session = createAgentSession();

  get id(): string | undefined {
    return this.session.id;
  }
  capture(id: string | undefined): void {
    this.session.capture(id);
  }
  get<T>(slot: SessionSlot<T>): T | undefined {
    return this.session.get(slot);
  }
  set<T>(slot: SessionSlot<T>, value: T): void {
    this.session.set(slot, value);
  }
  take<T>(slot: SessionSlot<T>): T | undefined {
    return this.session.take(slot);
  }

  index = 1;
  lastMessage = "";
  lastStatus: "completed" | "failed" | "waiting" = "completed";
  readonly events: StreamEvent[] = [];
  readonly pendingInputRequests: InputRequest[] = [];
  readonly usage: Usage = {};
  /** 本会话累计的证据覆盖(初值 = Agent 级默认,逐轮按 Turn.evidenceCoverage 降级折叠)。 */
  evidenceCoverage!: ResolvedEvidenceCoverage;
  /** 本会话内的轮次计数(turn 时间树 / 展示标签 turn<N> 用)。 */
  turnCount = 0;
}

export interface SessionDeps {
  agent: Agent;
  sandbox: Sandbox;
  /** 当前 Attempt 的 Eval 身份；Runner 路径必填，测试/第三方直构可省略。 */
  evalId?: string;
  /** 当前 Attempt 引用；与 setup/teardown 拿到的 AgentContext 保持同一身份。 */
  attempt?: AgentContext["attempt"];
  /** 当前 Eval Group 身份；未分组 Eval 省略。 */
  evalGroup?: AgentContext["evalGroup"];
  model?: string;
  reasoningEffort?: string;
  flags: globalThis.Record<string, JsonValue>;
  signal: AbortSignal;
  /**
   * The only Promise facade for the active Assert-first author surface. It
   * executes this SessionManager's Effect graph in the owning Attempt Scope.
   */
  requestEffect?: <Value, Error>(effect: Effect.Effect<Value, Error, never>) => Promise<Value>;
  log(msg: string): void;
  /** runner 绑定的作用域反馈(adapter ctx.progress/diagnostic);省略时 progress 退回 log。 */
  feedback?: import("../types.ts").ScopedFeedback;
  /** adapter send 在飞时通知 runner(errored 归因到嵌套的 `agent.run` 阶段用)。 */
  onSendActive?: (active: boolean) => void;
  /**
   * 变更分类账的 send 窗口钩子(仅沙箱型 agent):`beforeSend` 在 adapter send 前落 eval 归因
   * commit,`afterSend` 在返回后落 agent 归因 commit;label 是 `turn<N>` 或
   * `session<K>/turn<N>` 窗口标签。
   * 提供钩子时 send 自动串行(同一 workdir 上重叠的 send 是写入竞争,窗口不重叠)。
   */
  ledgerHooks?: {
    beforeSend(label: string): Promise<void>;
    afterSend(label: string): Promise<void>;
  };
  /** attempt 单调时钟域的当前 offset；runner 注入，测试直调缺省使用 performance.now()。 */
  timingNow?: () => number;
  /**
   * 每轮 send 结束后回报单调时钟包络(runner 挂成 eval.run 下的 turn 时间树节点)。`usage` 是该轮
   * `Turn.usage` 落盘原样(有记录才传;`--execution`/`--timing` 的 turn 头行读 TimingNode.usage)。
   */
  onTurn?: (info: {
    sessionIndex: number;
    turnIndex: number;
    /** Exact terminal label allocated by this SessionManager. */
    label: string;
    /** One physical public send is sealed with this exact terminal outcome. */
    outcome: "completed" | "failed" | "interrupted";
    /** The exact user event plus terminal provider events for this send only. */
    events: readonly StreamEvent[];
    startOffsetMs: number;
    durationMs: number;
    failed?: boolean;
    /** The real user-event source location, when stack capture succeeded. */
    loc?: ReturnType<typeof captureLoc>;
    /** Shared author-fact order; absent when there is no durable source site. */
    sourceOrder?: number;
    traceId?: string;
    traceAttribution?: "traceparent" | "window" | "none";
    otelWindow?: TurnSpans["window"];
    usage?: Usage;
  }) => TimingActivity | undefined;
  /** 路径推导出的实验 id(经 send ctx 透给 adapter,见 AgentContext.experimentId)。 */
  experimentId?: string;
  /** tracing agent 的 OTLP 端点(经 send ctx 透给 adapter,用于注入导出 env)。 */
  telemetry?: Telemetry;
  /** 非沙箱 tracing agent 的共享 OTLP 通道(runner 从 run 级池取,经它做逐轮 span 归属)。 */
  otel?: AgentOtelChannel;
  /**
   * turn 级重试退避期间释放/收回的全局并发槽位(见 docs/feature/error-classification/
   * architecture.md「退避与槽位」)。省略时退避不释放槽位(测试 / 无并发闸场景)。
   */
  concurrencySlot?: ConcurrencySlot;
  /**
   * 实验声明的失败分类器(`ExperimentDef.classifyFailure`):turn 链上排在 adapter 分类器
   * 之前询问(决议序见 docs/feature/error-classification/architecture.md「分类链」)。
   */
  experimentClassifier?: AttemptFailureClassifier;
  /** 与 Fact collector 共用的 attempt 级源码事实序号分配器。 */
  nextSourceOrder?: () => number;
  /** Attempt-owned source snapshot registry; Runner injects it explicitly. */
  sourceRegistry?: SourceRegistry;
}

/** A successful agent send whose post-send ledger checkpoint could not be recorded. */
export interface LedgerCaptureFailure {
  readonly state: "capture-failed";
  readonly label: string;
  readonly error: unknown;
}

export class SessionManager {
  /** 整次运行(所有会话、所有轮)累计的标准事件流。 */
  readonly allEvents: StreamEvent[] = [];
  readonly usage: Usage = {};
  lastStatus: "completed" | "failed" | "waiting" = "completed";
  /** Agent 级默认覆盖(六通道在 factory 构造期已验证)。 */
  readonly agentEvidenceCoverage: ResolvedEvidenceCoverage;
  /** attempt 级累计覆盖:各轮解析后覆盖的最差值,随每次 send 折叠。 */
  evidenceCoverage: ResolvedEvidenceCoverage;
  /** 自动重试吸收的物理 send 失败；不混进 allEvents。 */
  readonly retryAttempts: RetryAttemptRecord[] = [];

  /** 归属到本 attempt 的 span(逐轮攒;attempt 末尾连同 sweep 的迟到 span 一起挂 trace)。 */
  readonly otelSpans: TraceSpan[] = [];
  /** 本 attempt 各轮的 traceId(attempt 末尾按它 sweep 迟到 span)。 */
  readonly otelTraceIds = new Set<string>();
  private readonly otelTurnRecords: Array<{
    window: TurnSpans["window"];
    activity?: TimingActivity;
    hasSpans: boolean;
  }> = [];

  /** 已完成轮次的离散宿主时间窗口；共享 receiver sweep 只用这些窗口补迟到 span。 */
  get otelTurnWindows(): readonly TurnSpans["window"][] {
    return this.otelTurnRecords.map((record) => record.window);
  }
  private warnedWindowAttribution = false;
  private warnedNoSpans = false;

  readonly primary: RunSession;
  private readonly sessions: RunSession[] = [];
  private turnCount = 0;
  private sessionCount = 0;
  /** 沙箱型 send 的 Effect 串行闸(见 SessionDeps.ledgerHooks):窗口不重叠。 */
  private readonly sendSemaphore = Effect.unsafeMakeSemaphore(1);
  /** First failed post-send checkpoint makes the entire later diff producer unavailable. */
  private ledgerCaptureFailureValue: LedgerCaptureFailure | undefined;
  /** attempt 级 turn 重试预算,跨该 attempt 全部 send(全部 session)持续扣减,不随单次 send 重置。 */
  private readonly retryBudget: AttemptRetryBudget = createAttemptRetryBudget();
  private localSourceOrder = 0;
  private readonly nextSourceOrder: () => number;

  constructor(private readonly deps: SessionDeps) {
    this.nextSourceOrder = deps.nextSourceOrder ?? (() => ++this.localSourceOrder);
    this.agentEvidenceCoverage = deps.agent.evidenceCoverage;
    this.evidenceCoverage = this.agentEvidenceCoverage;
    this.primary = this.newSession();
  }

  /** A ledger checkpoint failure is attempt state, not a synthetic empty diff. */
  get ledgerCaptureFailure(): LedgerCaptureFailure | undefined {
    return this.ledgerCaptureFailureValue;
  }

  newSession(): RunSession {
    const s = new RunSession();
    s.index = ++this.sessionCount;
    s.evidenceCoverage = this.agentEvidenceCoverage;
    this.sessions.push(s);
    return s;
  }

  /** 一轮的解析后覆盖:Agent 默认按 Turn.evidenceCoverage 降级(只降不升)。 */
  resolveTurnEvidenceCoverage(turn: Turn): ResolvedEvidenceCoverage {
    return downgradeEvidenceCoverage(this.agentEvidenceCoverage, turn.evidenceCoverage);
  }

  send(
    session: RunSession,
    text: string,
    files?: readonly InputFile[],
    responses?: readonly InputResponse[],
  ): Promise<Turn> {
    const requestEffect = this.deps.requestEffect;
    if (requestEffect === undefined) {
      throw new Error("SessionManager requires the Attempt Effect bridge");
    }
    return requestEffect(this.sendEffect(session, text, files, responses));
  }

  /**
   * The entire logical send is one Effect. The public Promise facade above is
   * deliberately only available through AssertFirstAttemptBridge.requestEffect.
   */
  sendEffect(
    session: RunSession,
    text: string,
    files?: readonly InputFile[],
    responses?: readonly InputResponse[],
    loc?: ReturnType<typeof captureLoc>,
  ): Effect.Effect<Turn, unknown> {
    const send = this.sendSerializedEffect(
      session,
      text,
      loc ?? captureLoc({ registry: this.deps.sourceRegistry }),
      files,
      responses,
    );
    // Sandbox sends share one workdir, so their attribution windows cannot
    // overlap. Direct Agent sends retain their existing unconstrained behavior.
    return this.deps.ledgerHooks === undefined
      ? send
      : this.sendSemaphore.withPermits(1)(send);
  }

  private sendSerializedEffect(
    session: RunSession,
    text: string,
    loc: ReturnType<typeof captureLoc>,
    files?: readonly InputFile[],
    responses?: readonly InputResponse[],
  ): Effect.Effect<Turn, unknown> {
    return Effect.suspend(() => {
      const ctx: AgentContext = {
        signal: this.deps.signal,
        evalId: this.deps.evalId,
        attempt: this.deps.attempt,
        evalGroup: this.deps.evalGroup,
        model: this.deps.model,
        reasoningEffort: this.deps.reasoningEffort,
        flags: this.deps.flags,
        experimentId: this.deps.experimentId,
        session,
        telemetry: this.deps.telemetry,
        progress: (u) =>
          this.deps.feedback
            ? this.deps.feedback.progress(u)
            : this.deps.log(u.current !== undefined && u.total !== undefined ? `${u.message} (${u.current}/${u.total})` : u.message),
        diagnostic: (d) => this.deps.feedback?.diagnostic(d),
        // log 是 progress({ message }) 的别名(见 AgentContext.log)。
        log: this.deps.log,
      };

      const n = ++this.turnCount;
      const attach = files?.length ? ` 📎${files.length}` : "";
      const preview = (text.replace(/\s+/g, " ").slice(0, 36) || (files?.[0]?.filename ?? t("session.fileFallback"))) + attach;
      const turnLabel = session.index === 1
        ? t("session.turn.primary", { turn: n })
        : t("session.turn.secondary", { session: session.index, turn: n });
      this.deps.log(`${turnLabel} → "${preview}…"`);
      const timingNow = this.deps.timingNow ?? (() => performance.now());
      const startOffsetMs = timingNow();

      // A source order belongs only to a user event that can become an
      // Attempt source-site. Do not consume the shared sequence for a failed
      // stack capture.
      const sourceOrder = loc === undefined ? undefined : this.nextSourceOrder();
      const userEvent: StreamEvent = {
        type: "message",
        role: "user",
        text,
        loc,
        ...(sourceOrder === undefined ? {} : { sourceOrder }),
      };
      this.allEvents.push(userEvent);
      session.events.push(userEvent);
      session.pendingInputRequests.length = 0;
      const turnIndex = ++session.turnCount;
      const windowLabel = formatTurnLabel(session.index, turnIndex);
      const beforeSend = this.deps.ledgerHooks === undefined
        ? Effect.void
        : Effect.tryPromise({
            try: () => this.deps.ledgerHooks!.beforeSend(windowLabel),
            catch: (error) => error,
          });
      const afterSend = this.deps.ledgerHooks === undefined
        ? Effect.void
        : Effect.tryPromise({
            try: () => this.deps.ledgerHooks!.afterSend(windowLabel),
            catch: (error) => error,
          }).pipe(Effect.catchAll((error) => Effect.sync(() => {
            // The agent turn itself did complete. Preserve that success for
            // the author, but retain the failed checkpoint so freeze cannot
            // turn an incomplete capture into a convincing empty document.
            if (this.ledgerCaptureFailureValue === undefined) {
              this.ledgerCaptureFailureValue = Object.freeze({
                state: "capture-failed" as const,
                label: windowLabel,
                error,
              });
            }
          })));

      // turn 级重试只包这一次物理 agent send。SDK Promise 在这两个
      // Effect.tryPromise 边界适配；retry 本身不再包含手写 Promise / timeout。
      const sendOnce: Effect.Effect<PhysicalSendResult, unknown> = this.deps.otel
        ? this.sendWithOtelEffect(this.deps.otel, { text, files, responses }, ctx)
        : this.sendAgentEffect({ text, files, responses }, ctx).pipe(
            Effect.map((turn) => ({ turn })),
          );
      const retryDeps: SendRetryDeps = {
        classifier: this.deps.agent.classifySendFailure,
        experimentClassifier: this.deps.experimentClassifier,
        onRetryAttempt: ({ sendAttempt, startedAt, durationMs, failure, classification }) => {
          const process = failure.process;
          this.retryAttempts.push({
            sessionIndex: session.index,
            turnIndex,
            sendAttempt,
            startedAt,
            durationMs,
            failure: {
              type: "agent-send-failed",
              acceptance: "rejected",
              message: sendFailureText(failure),
              ...(process?.exitCode !== undefined || process?.signal !== undefined
                ? { process: { ...(process.exitCode !== undefined ? { exitCode: process.exitCode } : {}), ...(process.signal !== undefined ? { signal: process.signal } : {}) } }
                : {}),
            },
            classification: {
              retryable: true,
              scope: classification.scope ?? "attempt",
              reason: classification.reason,
            },
            events: failure.events ? [...failure.events] : [],
            ...(failure.usage !== undefined ? { usage: { ...failure.usage } } : {}),
          });
          if (failure.usage) {
            accumulateUsage(this.usage, failure.usage);
            accumulateUsage(session.usage, failure.usage);
          }
        },
        budget: this.retryBudget,
        slot: this.deps.concurrencySlot,
        reportRetry: (message: string) => ctx.progress({ message }),
        signal: ctx.signal,
      };
      const send = Effect.uninterruptibleMask((restore) =>
        Effect.flatMap(
          Effect.exit(restore(sendWithTurnRetry(sendOnce, retryDeps))),
          (exit) => Effect.flatMap(
            Effect.sync(() => {
              const durationMs = Math.max(0, timingNow() - startOffsetMs);
              if (Exit.isSuccess(exit)) {
                const { turn, traceId, attribution, window } = exit.value;
                const traceAttribution = attribution ?? "none";
                const terminalEvents = Object.freeze([userEvent, ...turn.events]);
                const timingActivity = this.deps.onTurn?.({
                  sessionIndex: session.index,
                  turnIndex,
                  label: windowLabel,
                  outcome: turn.status === "failed" ? "failed" : "completed",
                  events: terminalEvents,
                  startOffsetMs,
                  durationMs,
                  failed: turn.status === "failed" ? true : undefined,
                  ...(loc === undefined ? {} : { loc }),
                  ...(sourceOrder === undefined ? {} : { sourceOrder }),
                  ...(traceAttribution !== "none" && traceId !== undefined ? { traceId } : {}),
                  traceAttribution,
                  otelWindow: window,
                  usage: turn.usage,
                });
                if (window !== undefined) {
                  this.otelTurnRecords.push({
                    window,
                    activity: timingActivity,
                    hasSpans: traceAttribution !== "none",
                  });
                }
                return;
              }
              const failure = Option.getOrUndefined(Cause.failureOption(exit.cause));
              const sendFailure = failure !== undefined && isSendFailure(failure) ? failure : undefined;
              if (sendFailure?.usage !== undefined) {
                accumulateUsage(this.usage, sendFailure.usage);
                accumulateUsage(session.usage, sendFailure.usage);
              }
              this.deps.onTurn?.({
                sessionIndex: session.index,
                turnIndex,
                label: windowLabel,
                outcome: Cause.isInterruptedOnly(exit.cause) ? "interrupted" : "failed",
                events: Object.freeze([userEvent, ...(sendFailure?.events ?? [])]),
                startOffsetMs,
                durationMs,
                failed: true,
                ...(loc === undefined ? {} : { loc }),
                ...(sourceOrder === undefined ? {} : { sourceOrder }),
                ...(sendFailure?.usage !== undefined ? { usage: sendFailure.usage } : {}),
              });
            }),
            () => Exit.isSuccess(exit)
              ? Effect.succeed(exit.value)
              : Effect.failCause(exit.cause),
          ),
        ),
      ).pipe(
        Effect.flatMap(({ turn }) => Effect.sync(() => {
          this.allEvents.push(...turn.events);
          session.events.push(...turn.events);
          session.pendingInputRequests.push(
            ...turn.events
              .filter((e): e is Extract<StreamEvent, { type: "input.requested" }> => e.type === "input.requested")
              .map((e) => e.request),
          );
          if (turn.usage) {
            accumulateUsage(this.usage, turn.usage);
            accumulateUsage(session.usage, turn.usage);
          }
          // 证据覆盖:attempt / session 级聚合取各轮最差值(见 assertions/coverage.ts)。
          const turnEvidenceCoverage = this.resolveTurnEvidenceCoverage(turn);
          this.evidenceCoverage = worstEvidenceCoverage([this.evidenceCoverage, turnEvidenceCoverage]);
          session.evidenceCoverage = worstEvidenceCoverage([session.evidenceCoverage, turnEvidenceCoverage]);
          session.lastStatus = turn.status;
          this.lastStatus = turn.status;
          const reply = lastAssistantText(turn.events);
          if (reply !== undefined) session.lastMessage = reply;

          const tok = (turn.usage?.inputTokens ?? 0) + (turn.usage?.outputTokens ?? 0);
          const tools = turn.events.filter((event) => event.type === "operation.started" && event.operation.kind === "tool").length;
          const reason = turn.status === "failed" ? failureReason(turn.events) : undefined;
          this.deps.log(
            `${turnLabel} ← ${turn.status} · ${t("session.tools", { count: tools })} · ${tok} tok · ${Math.round(Math.max(0, timingNow() - startOffsetMs) / 1000)}s${reason ? ` · ${reason}` : ""}`,
          );
          return turn;
        })),
      );
      return beforeSend.pipe(
        Effect.zipRight(
          Effect.sync(() => this.deps.onSendActive?.(true)).pipe(
            Effect.zipRight(send),
            Effect.ensuring(Effect.sync(() => this.deps.onSendActive?.(false))),
            // send 返回后:这个 send 窗口内的全部 workspace 变化落 agent 归因。
            Effect.ensuring(afterSend),
          ),
        ),
      );
    });
  }

  private sendAgentEffect(
    input: TurnInput,
    ctx: AgentContext,
  ): Effect.Effect<Turn, ReturnType<typeof normalizeSendFailure>> {
    return Effect.tryPromise({
      try: (signal) => this.sendAgent(input, this.withFiberSignal(ctx, signal)),
      catch: normalizeSendFailure,
    });
  }

  /**
   * 经共享 OTLP 通道跑一轮:本轮的 traceparent 经 ctx.telemetry.headers 交给 adapter,
   * 返回后按 traceId / 时间窗口把本轮 span 归属进瀑布图。span 只进瀑布图,不进事件流、
   * 不喂断言——断言依据全部来自 send 返回的 Turn。
   */
  private sendWithOtelEffect(
    otel: AgentOtelChannel,
    input: { text: string; files?: readonly InputFile[]; responses?: readonly InputResponse[] },
    ctx: AgentContext,
  ): Effect.Effect<PhysicalSendResult, ReturnType<typeof normalizeSendFailure>> {
    return otel.runTurnEffect((headers) => {
      const turnCtx: AgentContext = ctx.telemetry
        ? { ...ctx, telemetry: { ...ctx.telemetry, headers } }
        : ctx;
      return this.sendAgentEffect(input, turnCtx);
    }).pipe(
      Effect.map((result) => {
        this.otelSpans.push(...result.spans);
        if (result.spans.length > 0) this.otelTraceIds.add(result.traceId);

        if (result.attribution === "window" && result.spans.length > 0 && !this.warnedWindowAttribution) {
          this.warnedWindowAttribution = true;
          this.deps.log(t("otel.windowAttribution"));
        }
        if (result.spans.length === 0 && !this.warnedNoSpans) {
          this.warnedNoSpans = true;
          this.deps.log(t("otel.noSpans"));
        }
        return {
          turn: result.result,
          traceId: result.traceId,
          attribution: result.spans.length === 0 ? "none" : result.attribution,
          window: result.window,
        };
      }),
    );
  }

  private withFiberSignal(ctx: AgentContext, fiberSignal: AbortSignal): AgentContext {
    if (ctx.signal === fiberSignal) return ctx;
    return { ...ctx, signal: AbortSignal.any([ctx.signal, fiberSignal]) };
  }

  /** telemetry.collect 收到 BatchSpanProcessor 迟到导出后，回写尚无 span 的 turn。 */
  attributeDeferredOtel(spans: readonly TraceSpan[]): TraceSpan[] {
    const attributed: TraceSpan[] = [];
    const remaining = new Set(spans);
    for (const record of this.otelTurnRecords) {
      if (record.hasSpans || record.activity === undefined) continue;
      const candidates = [...remaining].filter(
        (span) => span.endMs >= record.window.startMs && span.startMs <= record.window.endMs,
      );
      const byTrace = new Map<string, TraceSpan[]>();
      for (const span of candidates) {
        const group = byTrace.get(span.traceId);
        if (group === undefined) byTrace.set(span.traceId, [span]);
        else group.push(span);
      }
      const selected = [...byTrace.entries()]
        .map(([traceId, traceSpans]) => {
          const latestEndMs = Math.max(...traceSpans.map((span) => span.endMs));
          const coversEnd = traceSpans.some(
            (span) => span.startMs <= record.window.endMs && span.endMs >= record.window.endMs,
          );
          return { traceId, traceSpans, latestEndMs, coversEnd };
        })
        .sort(
          (a, b) =>
            Number(b.coversEnd) - Number(a.coversEnd) ||
            Math.abs(record.window.endMs - a.latestEndMs) - Math.abs(record.window.endMs - b.latestEndMs) ||
            b.latestEndMs - a.latestEndMs ||
            a.traceId.localeCompare(b.traceId),
        )[0];
      if (selected === undefined) continue;
      record.activity.traceId = selected.traceId;
      record.activity.traceAttribution = "window";
      record.hasSpans = true;
      this.otelTraceIds.add(selected.traceId);
      for (const span of selected.traceSpans) {
        remaining.delete(span);
        attributed.push(span);
      }
    }
    return attributed;
  }

  private sendAgent(input: TurnInput, ctx: AgentContext): Promise<Turn> {
    const agent = this.deps.agent;
    if (agent.kind === "sandbox") {
      const sandboxCtx: SandboxAgentContext = { ...ctx, sandbox: this.deps.sandbox };
      return agent.send(input, sandboxCtx);
    }
    return agent.send(input, ctx);
  }
}

/**
 * 失败轮的进度行原因摘要:取本轮事件流里最后一个 `type: "error"` 事件的 message
 * (与 src/agents/shared.ts 的 diagnoseFailure 同一口径——
 * 都认「最后一条 error 事件」为本轮失败的权威原因),压成单行并截断,避免 402/超时
 * 这类关键信息只能事后翻落盘的 result.json 才看得到。提不到时返回 undefined,调用方不补空后缀。
 */
function failureReason(events: readonly StreamEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "error") return truncateOneLine(e.message, 120);
  }
  return undefined;
}

/** 单行截断:折叠空白 + 120 字符上限。 */
function truncateOneLine(s: string, width: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= width) return clean;
  return `${clean.slice(0, width - 1)}…`;
}

export function lastAssistantText(events: readonly StreamEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "message" && e.role === "assistant" && e.text.trim()) return e.text;
  }
  return undefined;
}

/**
 * 每个字段只在某一轮真的带回该值时才累加,协议不提供就保持省略(见
 * docs/feature/record/architecture.md「Usage」:「每个字段只在协议真实提供该值时存在……
 * 不存在『默认 0』或『默认 1』的字段」)。此前 `requests` 用 `add.requests ?? 1` 累加,会让
 * 转录解析型 adapter(整个 attempt 只在末尾解析一次 transcript、天然不报每轮请求数)的一轮
 * send 被硬算成 1 个请求,一个内部发起了 21 次工具调用的 codex session 因此落盘
 * `requests: 1`——不是真值,是轮数的误代理(见 memory 的 show-scope-slice-json-ruling 条目)。
 * `inputTokens`/`outputTokens` 此前是 Usage 的必填字段、始终累加(缺省视同 0);现在两者也
 * 可选化,同一条纪律统一适用:任何字段缺席就保持缺席,不拿「大概率是 0」去凑。
 */
function accumulateUsage(acc: Usage, add: Usage): void {
  if (add.inputTokens !== undefined) acc.inputTokens = (acc.inputTokens ?? 0) + add.inputTokens;
  if (add.outputTokens !== undefined) acc.outputTokens = (acc.outputTokens ?? 0) + add.outputTokens;
  if (add.cacheReadTokens !== undefined) acc.cacheReadTokens = (acc.cacheReadTokens ?? 0) + add.cacheReadTokens;
  if (add.cacheCreationTokens !== undefined) acc.cacheCreationTokens = (acc.cacheCreationTokens ?? 0) + add.cacheCreationTokens;
  if (add.reasoningTokens !== undefined) acc.reasoningTokens = (acc.reasoningTokens ?? 0) + add.reasoningTokens;
  if (add.requests !== undefined) acc.requests = (acc.requests ?? 0) + add.requests;
  if (add.costUSD !== undefined) {
    acc.costUSD = acc.costUSD === undefined ? add.costUSD : acc.costUSD + add.costUSD;
  }
}
