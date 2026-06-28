// 会话驱动:把 t.send(text) 翻成 agent.send(input, ctx),在同一沙箱里多轮 resume /
// newSession,并把每轮的标准事件流与用量累加进整次运行(供作用域断言 / o11y)。

import type { Agent, AgentContext, Sandbox, StreamEvent, Turn, Usage } from "../types.ts";

/** 一条会话线的可变状态。adapter 读 isNew 决定是否 --resume,写 id 供下轮续接。 */
export class RunSession {
  id: string | undefined = undefined;
  isNew = true;
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
}

export class SessionManager {
  /** 整次运行(所有会话、所有轮)累计的标准事件流。 */
  readonly allEvents: StreamEvent[] = [];
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, requests: 0 };
  lastStatus: "completed" | "failed" | "waiting" = "completed";

  readonly primary: RunSession;
  private readonly sessions: RunSession[] = [];

  constructor(private readonly deps: SessionDeps) {
    this.primary = this.newSession();
  }

  newSession(): RunSession {
    const s = new RunSession();
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
      log: this.deps.log,
    };

    const turn = await this.deps.agent.send({ text }, ctx);

    this.allEvents.push(...turn.events);
    if (turn.usage) accumulateUsage(this.usage, turn.usage);
    session.isNew = false;
    session.lastStatus = turn.status;
    this.lastStatus = turn.status;
    const reply = lastAssistantText(turn.events);
    if (reply !== undefined) session.lastMessage = reply;
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
