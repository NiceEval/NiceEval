// 会话驱动:把 t.send(text) 翻成 agent.send(input, ctx),在同一沙箱里多轮 resume /
// newSession,并把每轮的标准事件流与用量累加进整次运行(供作用域断言 / o11y)。

import type { Agent, AgentContext, AgentSession, InputFile, InputRequest, InputResponse, Sandbox, StreamEvent, Telemetry, TraceSpan, Turn, Usage } from "../types.ts";
import type { AgentOtelChannel } from "../o11y/otlp/turn-otel.ts";
import { downgradeCoverage, resolveAgentCoverage, worstCoverage, type ResolvedCoverage } from "../scoring/coverage.ts";
import { captureLoc } from "../source-loc.ts";
import { t } from "../i18n/index.ts";

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
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, requests: 0 };
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
  /** 每轮 send 结束后回报墙钟包络(runner 挂成 eval.run 下的 turn 时间树节点)。 */
  onTurn?: (info: {
    sessionIndex: number;
    turnIndex: number;
    startedAt: number;
    durationMs: number;
    failed?: boolean;
    traceId?: string;
    traceAttribution?: "traceparent" | "window" | "none";
  }) => void;
  /** 路径推导出的实验 id(经 send ctx 透给 adapter,见 AgentContext.experimentId)。 */
  experimentId?: string;
  /** tracing agent 的 OTLP 端点(经 send ctx 透给 adapter,用于注入导出 env)。 */
  telemetry?: Telemetry;
  /** 非沙箱 tracing agent 的共享 OTLP 通道(runner 从 run 级池取,经它做逐轮 span 归属)。 */
  otel?: AgentOtelChannel;
}

export class SessionManager {
  /** 整次运行(所有会话、所有轮)累计的标准事件流。 */
  readonly allEvents: StreamEvent[] = [];
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, requests: 0 };
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
    try {
      if (this.deps.otel) {
        const r = await this.sendWithOtel(this.deps.otel, { text, files, responses }, ctx);
        turn = r.turn;
        sentTraceId = r.traceId;
        sentAttribution = r.attribution;
      } else {
        turn = await this.deps.agent.send({ text, files, responses }, ctx);
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

function accumulateUsage(acc: Usage, add: Usage): void {
  acc.inputTokens += add.inputTokens ?? 0;
  acc.outputTokens += add.outputTokens ?? 0;
  acc.cacheReadTokens = (acc.cacheReadTokens ?? 0) + (add.cacheReadTokens ?? 0);
  acc.cacheWriteTokens = (acc.cacheWriteTokens ?? 0) + (add.cacheWriteTokens ?? 0);
  acc.requests = (acc.requests ?? 0) + (add.requests ?? 1);
  if (add.costUSD !== undefined) acc.costUSD = (acc.costUSD ?? 0) + add.costUSD;
}
