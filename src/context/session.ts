// 会话驱动:把 t.send(text) 翻成 agent.send(input, ctx),在同一沙箱里多轮 resume /
// newSession,并把每轮的标准事件流与用量累加进整次运行(供作用域断言 / o11y)。

import type { Agent, AgentContext, Sandbox, StreamEvent, Telemetry, Turn, Usage } from "../types.ts";

/** 一条会话线的可变状态。adapter 读 isNew 决定是否 --resume,写 id 供下轮续接。 */
export class RunSession {
  id: string | undefined = undefined;
  isNew = true;
  index = 1;
  lastMessage = "";
  lastStatus: "completed" | "failed" | "waiting" = "completed";
}

export interface SessionDeps {
  agent: Agent;
  sandbox: Sandbox;
  model?: string;
  flags: Record<string, unknown>;
  shared: Record<string, unknown>;
  signal: AbortSignal;
  log(msg: string): void;
  /** tracing agent 的 OTLP 端点(经 send ctx 透给 adapter,用于注入导出 env)。 */
  telemetry?: Telemetry;
}

export class SessionManager {
  /** 整次运行(所有会话、所有轮)累计的标准事件流。 */
  readonly allEvents: StreamEvent[] = [];
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, requests: 0 };
  lastStatus: "completed" | "failed" | "waiting" = "completed";

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

  async send(session: RunSession, text: string): Promise<Turn> {
    const ctx: AgentContext = {
      signal: this.deps.signal,
      model: this.deps.model,
      flags: this.deps.flags,
      sandbox: this.deps.sandbox,
      session: session as unknown as AgentContext["session"],
      shared: this.deps.shared,
      telemetry: this.deps.telemetry,
      log: this.deps.log,
    };

    const n = ++this.turnCount;
    const preview = text.replace(/\s+/g, " ").slice(0, 36);
    this.deps.log(`s${session.index}·t${n} → "${preview}…"`);
    const t0 = Date.now();

    const turn = await this.deps.agent.send({ text }, ctx);

    this.allEvents.push(...turn.events);
    if (turn.usage) accumulateUsage(this.usage, turn.usage);
    session.isNew = false;
    session.lastStatus = turn.status;
    this.lastStatus = turn.status;
    const reply = lastAssistantText(turn.events);
    if (reply !== undefined) session.lastMessage = reply;

    const tok = (turn.usage?.inputTokens ?? 0) + (turn.usage?.outputTokens ?? 0);
    const tools = turn.events.filter((e) => e.type === "action.called").length;
    this.deps.log(
      `s${session.index}·t${n} ← ${turn.status} · ${tools} 工具 · ${tok} tok · ${Math.round((Date.now() - t0) / 1000)}s`,
    );
    return turn;
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
