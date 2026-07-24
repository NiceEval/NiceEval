// 会话驱动:把 t.send(text) 翻成 agent.send(input, ctx),在同一沙箱里多轮 resume /
// newSession,并把每轮的标准事件流与用量累加进整次运行(供作用域断言 / o11y)。

import type { Agent, AgentContext, AgentSession, InputFile, InputRequest, InputResponse, Sandbox, StreamEvent, Telemetry, TraceSpan, Turn, Usage } from "../types.ts";
import type { AgentOtelChannel } from "../o11y/otlp/turn-otel.ts";
import { downgradeCoverage, resolveAgentCoverage, worstCoverage, type ResolvedCoverage } from "../scoring/coverage.ts";
import { captureLoc } from "../source-loc.ts";
import { t } from "../i18n/index.ts";
import {
  createAttemptRetryBudget,
  sendWithTurnRetry,
  type AttemptRetryBudget,
  type ConcurrencySlot,
} from "./send-retry.ts";
import type { AttemptFailureClassifier, FailureClass } from "../shared/failure-class.ts";
import type { TurnFailure } from "./turn-errors.ts";
import { recordFact } from "../shared/facts.ts";

/**
 * 一条会话线的存取器实现(见 docs-site/zh/explanation/adapter.mdx 的 AgentSession 契约)。
 * 私有槽都关在闭包里——`state` 只归用户,框架内部数据不往里塞。
 */
export function createAgentSession(): AgentSession {
  let capturedId: string | undefined;
  let historyLine: unknown[] = [];
  let held: unknown;
  let hasHeld = false;
  const state: Record<string, unknown> = {};

  return {
    get id() {
      return capturedId;
    },
    capture(id) {
      if (!id || capturedId !== undefined) return; // 空值忽略;first-writer-wins
      capturedId = id;
    },
    history<TMsg>() {
      return {
        get: () => historyLine as TMsg[],
        commit: (messages: TMsg[]) => {
          historyLine = messages;
        },
      };
    },
    hold(s) {
      held = s;
      hasHeld = true;
    },
    take<T>() {
      if (!hasHeld) return undefined;
      hasHeld = false;
      const v = held as T;
      held = undefined;
      return v;
    },
    state,
  };
}

/**
 * 一条会话线的可变状态。存取器(id/capture/history/hold/take/state)委托给
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
  history<TMsg>() {
    return this.session.history<TMsg>();
  }
  hold<T>(s: T): void {
    this.session.hold(s);
  }
  take<T>(): T | undefined {
    return this.session.take<T>();
  }
  get state(): Record<string, unknown> {
    return this.session.state;
  }

  index = 1;
  lastMessage = "";
  lastInput = "";
  lastStatus: "completed" | "failed" | "waiting" = "completed";
  readonly events: StreamEvent[] = [];
  readonly pendingInputRequests: InputRequest[] = [];
  readonly usage: Usage = {};
  /** 本会话累计的证据覆盖(初值 = Agent 级默认,逐轮按 Turn.coverage 降级折叠)。 */
  coverage!: ResolvedCoverage;
  /** 本会话内的轮次计数(turn 时间树 / 展示标签 s<session>/t<turn> 用)。 */
  turnCount = 0;
}

export interface SessionDeps {
  agent: Agent;
  sandbox: Sandbox;
  model?: string;
  reasoningEffort?: string;
  flags: Record<string, unknown>;
  signal: AbortSignal;
  log(msg: string): void;
  /** runner 绑定的作用域反馈(adapter ctx.progress/diagnostic);省略时 progress 退回 log。 */
  feedback?: import("../types.ts").ScopedFeedback;
  /** attempt 作用域 ctx.fact() 的落点(经 send ctx 透给 adapter,见 AgentContext.fact);省略时
   *  (测试直调)仍校验 key/value,只是无处落盘。 */
  fact?: (key: string, value: string | number | boolean) => void;
  /** adapter send 在飞时通知 runner(errored 归因到嵌套的 `agent.run` 阶段用)。 */
  onSendActive?: (active: boolean) => void;
  /**
   * 变更分类账的 send 窗口钩子(仅沙箱型 agent):`beforeSend` 在 adapter send 前落 eval 归因
   * commit,`afterSend` 在返回后落 agent 归因 commit;label 是 `s<session>/t<turn>` 窗口标签。
   * 提供钩子时 send 自动串行(同一 workdir 上重叠的 send 是写入竞争,窗口不重叠)。
   */
  ledgerHooks?: {
    beforeSend(label: string): Promise<void>;
    afterSend(label: string): Promise<void>;
  };
  /**
   * 每轮 send 结束后回报墙钟包络(runner 挂成 eval.run 下的 turn 时间树节点)。`usage` 是该轮
   * `Turn.usage` 落盘原样(有记录才传;`--execution`/`--timing` 的 turn 头行读 TimingNode.usage)。
   */
  onTurn?: (info: {
    sessionIndex: number;
    turnIndex: number;
    startedAt: number;
    durationMs: number;
    failed?: boolean;
    traceId?: string;
    traceAttribution?: "traceparent" | "window" | "none";
    usage?: Usage;
  }) => void;
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
  /** 仅供确定性单测注入:turn 重试执行体的随机数与睡眠(生产路径省略,走真实退避)。 */
  retryRandom?: () => number;
  retrySleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export class SessionManager {
  /** 整次运行(所有会话、所有轮)累计的标准事件流。 */
  readonly allEvents: StreamEvent[] = [];
  readonly usage: Usage = {};
  lastStatus: "completed" | "failed" | "waiting" = "completed";
  /** Agent 级默认覆盖(全通道解析,未声明 = unknown)。 */
  readonly agentCoverage: ResolvedCoverage;
  /** attempt 级累计覆盖:各轮解析后覆盖的最差值,随每次 send 折叠。 */
  coverage: ResolvedCoverage;

  /** 归属到本 attempt 的 span(逐轮攒;attempt 末尾连同 sweep 的迟到 span 一起挂 trace)。 */
  readonly otelSpans: TraceSpan[] = [];
  /** 本 attempt 各轮的 traceId(attempt 末尾按它 sweep 迟到 span)。 */
  readonly otelTraceIds = new Set<string>();
  private warnedWindowAttribution = false;
  private warnedNoSpans = false;

  readonly primary: RunSession;
  private readonly sessions: RunSession[] = [];
  private turnCount = 0;
  private sessionCount = 0;
  /** 沙箱型 send 的串行链(见 SessionDeps.ledgerHooks):窗口不重叠。 */
  private sendChain: Promise<unknown> = Promise.resolve();
  /** attempt 级 turn 重试预算,跨该 attempt 全部 send(全部 session)持续扣减,不随单次 send 重置。 */
  private readonly retryBudget: AttemptRetryBudget = createAttemptRetryBudget();

  constructor(private readonly deps: SessionDeps) {
    this.agentCoverage = resolveAgentCoverage(deps.agent.coverage);
    this.coverage = this.agentCoverage;
    this.primary = this.newSession();
  }

  newSession(): RunSession {
    const s = new RunSession();
    s.index = ++this.sessionCount;
    s.coverage = this.agentCoverage;
    this.sessions.push(s);
    return s;
  }

  /** 一轮的解析后覆盖:Agent 默认按 Turn.coverage 降级(只降不升)。 */
  resolveTurnCoverage(turn: Turn): ResolvedCoverage {
    return downgradeCoverage(this.agentCoverage, turn.coverage);
  }

  /**
   * 终局失败 Turn 的分类:失败 Turn 本身不是错误(作者不调 `expectOk()` 就不算失败),分类
   * 因此不能挂在 Turn 上,只在 `expectOk()` 铸造 `TurnFailed` 时随错误浮出——这里按 Turn 身份
   * 登记,`makeTurnHandle` 取用。被重试吸收的失败 Turn 从不外泄,也就不会被登记。
   */
  resolveTurnFailureClass(turn: Turn): FailureClass | undefined {
    return this.turnFailureClasses.get(turn);
  }

  private readonly turnFailureClasses = new WeakMap<Turn, FailureClass>();

  async send(
    session: RunSession,
    text: string,
    files?: readonly InputFile[],
    responses?: readonly InputResponse[],
  ): Promise<Turn> {
    // 抓住作者调 t.send / t.sendFile 那一行(view 把回复叠回这一行)。
    const loc = captureLoc();
    if (this.deps.ledgerHooks) {
      // 沙箱型 send 经串行链执行:同一 workdir 上重叠的 send 本身就是写入竞争,
      // 合并窗口只会掩盖归因不确定性(见 docs/feature/sandbox/architecture.md)。
      const run = this.sendChain.then(() => this.sendSerialized(session, text, loc, files, responses));
      this.sendChain = run.catch(() => {});
      return run;
    }
    return this.sendSerialized(session, text, loc, files, responses);
  }

  private async sendSerialized(
    session: RunSession,
    text: string,
    loc: ReturnType<typeof captureLoc>,
    files?: readonly InputFile[],
    responses?: readonly InputResponse[],
  ): Promise<Turn> {
    const ctx: AgentContext = {
      signal: this.deps.signal,
      model: this.deps.model,
      reasoningEffort: this.deps.reasoningEffort,
      flags: this.deps.flags,
      experimentId: this.deps.experimentId,
      sandbox: this.deps.sandbox,
      session,
      telemetry: this.deps.telemetry,
      progress: (u) =>
        this.deps.feedback
          ? this.deps.feedback.progress(u)
          : this.deps.log(u.current !== undefined && u.total !== undefined ? `${u.message} (${u.current}/${u.total})` : u.message),
      diagnostic: (d) => this.deps.feedback?.diagnostic(d),
      fact: (key, value) => {
        // 没有 runner 绑定的落点时(测试直调 SessionManager)仍要校验,只是无处落盘——
        // 与 progress 退回 log、diagnostic 静默丢弃是同一种「测试直调降级」纪律。
        if (this.deps.fact) this.deps.fact(key, value);
        else recordFact({}, key, value);
      },
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
    const t0 = Date.now();

    session.lastInput = text;
    const userEvent: StreamEvent = { type: "message", role: "user", text, loc };
    this.allEvents.push(userEvent);
    session.events.push(userEvent);
    session.pendingInputRequests.length = 0;
    const turnIndex = ++session.turnCount;
    const windowLabel = `s${session.index}/t${turnIndex}`;
    // send 进入前:workdir 有未记录变化(fixture / setup / runCommand 副作用)先落 eval 归因。
    await this.deps.ledgerHooks?.beforeSend(windowLabel);
    let turn: Turn;
    let sentTraceId: string | undefined;
    let sentAttribution: "traceparent" | "window" | "none" | undefined;
    this.deps.onSendActive?.(true);
    // turn 级重试:包住这一次逻辑 send(下面两个分支各一次调用),分类判据与执行体时序见
    // docs/feature/error-classification/architecture.md。retryDeps 复用同一个 attempt 级
    // 预算(this.retryBudget)与 ctx.signal(合并了 attempt 超时 / Ctrl+C 中断),退避睡眠
    // 因此能被 Effect interruption 干净打断,不新增超时语义。
    const retryDeps = {
      classifier: this.deps.agent.classifyTurnError,
      experimentClassifier: this.deps.experimentClassifier,
      // 终局失败的分类落账:thrown 形态由执行体标在错误对象上,turn-failed 形态在这里按 Turn
      // 身份登记,`expectOk()` 铸造 TurnFailed 时取出随错误浮出(止损闸的消费点在 attempt 封口)。
      onFinalFailure: (cls: FailureClass, failure: TurnFailure) => {
        if (failure.type === "turn-failed") this.turnFailureClasses.set(failure.turn, cls);
      },
      budget: this.retryBudget,
      slot: this.deps.concurrencySlot,
      reportRetry: (message: string) => ctx.progress({ message }),
      signal: ctx.signal,
      random: this.deps.retryRandom,
      sleep: this.deps.retrySleep,
    };
    try {
      if (this.deps.otel) {
        const otel = this.deps.otel;
        const r = await sendWithTurnRetry(
          () => this.sendWithOtel(otel, { text, files, responses }, ctx),
          { get: (v) => v.turn, set: (v, t) => ({ ...v, turn: t }) },
          retryDeps,
        );
        turn = r.turn;
        sentTraceId = r.traceId;
        sentAttribution = r.attribution;
      } else {
        turn = await sendWithTurnRetry(
          () => this.deps.agent.send({ text, files, responses }, ctx),
          { get: (v) => v, set: (_v, t) => t },
          retryDeps,
        );
      }
    } catch (e) {
      this.deps.onTurn?.({
        sessionIndex: session.index,
        turnIndex,
        startedAt: t0,
        durationMs: Date.now() - t0,
        failed: true,
        traceAttribution: sentAttribution,
      });
      throw e;
    } finally {
      this.deps.onSendActive?.(false);
      // send 返回后:这个 send 窗口内的全部 workspace 变化落 agent 归因(HITL waiting 同样收窗:
      // adapter 义务保证返回时 agent 侧进程已退出或进入不再写 workspace 的静止态)。
      await this.deps.ledgerHooks?.afterSend(windowLabel).catch(() => {});
    }
    this.deps.onTurn?.({
      sessionIndex: session.index,
      turnIndex,
      startedAt: t0,
      durationMs: Date.now() - t0,
      failed: turn.status === "failed" ? true : undefined,
      traceId: sentTraceId,
      traceAttribution: sentAttribution,
      usage: turn.usage,
    });

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
    // 证据覆盖:attempt / session 级聚合取各轮最差值(见 scoring/coverage.ts)。
    const turnCoverage = this.resolveTurnCoverage(turn);
    this.coverage = worstCoverage([this.coverage, turnCoverage]);
    session.coverage = worstCoverage([session.coverage, turnCoverage]);
    session.lastStatus = turn.status;
    this.lastStatus = turn.status;
    const reply = lastAssistantText(turn.events);
    if (reply !== undefined) session.lastMessage = reply;

    const tok = (turn.usage?.inputTokens ?? 0) + (turn.usage?.outputTokens ?? 0);
    const tools = turn.events.filter((e) => e.type === "action.called").length;
    const reason = turn.status === "failed" ? failureReason(turn.events) : undefined;
    this.deps.log(
      `${turnLabel} ← ${turn.status} · ${t("session.tools", { count: tools })} · ${tok} tok · ${Math.round((Date.now() - t0) / 1000)}s${reason ? ` · ${reason}` : ""}`,
    );
    return turn;
  }

  /**
   * 经共享 OTLP 通道跑一轮:本轮的 traceparent 经 ctx.telemetry.headers 交给 adapter,
   * 返回后按 traceId / 时间窗口把本轮 span 归属进瀑布图。span 只进瀑布图,不进事件流、
   * 不喂断言——断言依据全部来自 send 返回的 Turn。
   */
  private async sendWithOtel(
    otel: AgentOtelChannel,
    input: { text: string; files?: readonly InputFile[]; responses?: readonly InputResponse[] },
    ctx: AgentContext,
  ): Promise<{ turn: Turn; traceId: string; attribution: "traceparent" | "window" | "none" }> {
    const r = await otel.runTurn((headers) => {
      const turnCtx: AgentContext = ctx.telemetry
        ? { ...ctx, telemetry: { ...ctx.telemetry, headers } }
        : ctx;
      return this.deps.agent.send(input, turnCtx);
    });
    this.otelSpans.push(...r.spans);
    this.otelTraceIds.add(r.traceId);

    if (r.attribution === "window" && r.spans.length > 0 && !this.warnedWindowAttribution) {
      this.warnedWindowAttribution = true;
      this.deps.log(t("otel.windowAttribution"));
    }
    if (r.spans.length === 0 && !this.warnedNoSpans) {
      this.warnedNoSpans = true;
      this.deps.log(t("otel.noSpans"));
    }
    return { turn: r.result, traceId: r.traceId, attribution: r.spans.length === 0 ? "none" : r.attribution };
  }
}

/**
 * 失败轮的进度行原因摘要:取本轮事件流里最后一个 `type: "error"` 事件的 message
 * (与 TurnHandle.expectOk() / src/agents/shared.ts 的 diagnoseFailure 同一口径——
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
 * docs/feature/results/architecture.md「Usage」:「每个字段只在协议真实提供该值时存在……
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
  if (add.costUSD !== undefined) acc.costUSD = (acc.costUSD ?? 0) + add.costUSD;
}
