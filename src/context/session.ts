// 会话驱动:把 t.send(text) 翻成 agent.send(input, ctx),在同一沙箱里多轮 resume /
// newSession,并把每轮的标准事件流与用量累加进整次运行(供作用域断言 / o11y)。

import type { Agent, AgentContext, AgentSession, InputFile, InputRequest, InputResponse, Sandbox, StreamEvent, Telemetry, TraceSpan, Turn, Usage } from "../types.ts";
import type { AgentOtelChannel } from "../o11y/otlp/turn-otel.ts";
import { captureLoc } from "../source-loc.ts";
import { t } from "../i18n/index.ts";

/**
 * 一条会话线的存取器实现(见 docs-site/zh/concepts/adapter.mdx 的 AgentSession 契约)。
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
}

export interface SessionDeps {
  agent: Agent;
  sandbox: Sandbox;
  model?: string;
  reasoningEffort?: string;
  flags: Record<string, unknown>;
  signal: AbortSignal;
  log(msg: string): void;
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

  constructor(private readonly deps: SessionDeps) {
    this.primary = this.newSession();
  }

  newSession(): RunSession {
    const s = new RunSession();
    s.index = ++this.sessionCount;
    this.sessions.push(s);
    return s;
  }

  async send(
    session: RunSession,
    text: string,
    files?: readonly InputFile[],
    responses?: readonly InputResponse[],
  ): Promise<Turn> {
    // 抓住作者调 t.send / t.sendFile 那一行(view 把回复叠回这一行)。
    const loc = captureLoc();
    const ctx: AgentContext = {
      signal: this.deps.signal,
      model: this.deps.model,
      reasoningEffort: this.deps.reasoningEffort,
      flags: this.deps.flags,
      sandbox: this.deps.sandbox,
      session,
      telemetry: this.deps.telemetry,
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
    const turn = this.deps.otel
      ? await this.sendWithOtel(this.deps.otel, { text, files, responses }, ctx)
      : await this.deps.agent.send({ text, files, responses }, ctx);

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
    session.lastStatus = turn.status;
    this.lastStatus = turn.status;
    const reply = lastAssistantText(turn.events);
    if (reply !== undefined) session.lastMessage = reply;

    const tok = (turn.usage?.inputTokens ?? 0) + (turn.usage?.outputTokens ?? 0);
    const tools = turn.events.filter((e) => e.type === "action.called").length;
    this.deps.log(
      `${turnLabel} ← ${turn.status} · ${t("session.tools", { count: tools })} · ${tok} tok · ${Math.round((Date.now() - t0) / 1000)}s`,
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
  ): Promise<Turn> {
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
    return r.result;
  }
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
