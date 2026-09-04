import type { InputResponse, SandboxAgentContext, StreamEvent, Turn, TurnEvidenceCoverage, Usage } from "../types.ts";
import { createSessionSlot } from "./session-slot.ts";
import { ManagedJsonlDriver } from "./managed-jsonl.ts";
import { shared } from "./shared.ts";
import { unclassifiedToolActionsCoverage } from "../o11y/command-projection.ts";
import { makeSendFailure, sendAcceptanceFromEvents } from "../context/send-failures.ts";
import { normalizeExternalCause, type ExternalCause } from "../shared/external-cause.ts";
import { attemptResources } from "../context/attempt-resources.ts";

type RecordValue = globalThis.Record<string, unknown>;
type PendingQuestion = {
  readonly requestId: string;
  readonly nativeQuestionId: string;
  readonly prompt: string;
  readonly options: readonly string[];
};
type PendingBatch = {
  readonly rpcId: string | number;
  readonly turnId: string;
  readonly questions: readonly PendingQuestion[];
};
type CodexState = {
  readonly driver: ManagedJsonlDriver;
  cursor: number;
  readonly threadId: string;
  pending?: PendingBatch;
  readonly reported: Set<string>;
};

const stateSlot = createSessionSlot<CodexState>("codex/app-server-native");

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function progressPreview(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text;
}

function jsonPreview(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return progressPreview(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function completedTool(label: string, completed: boolean): string {
  const detail = progressPreview(label) ?? "tool";
  return completed ? `tool: ${detail} · completed` : `tool: ${detail}`;
}

/** 选择 app-server v2 的可信字段；统一的脱敏、清理与有界化由 Runner ACTIVE 出口负责。 */
function appServerProgressDetail(value: unknown): string | undefined {
  const frame = record(value);
  if (frame?.method !== "item/started" && frame?.method !== "item/completed") return undefined;
  const data = record(record(frame.params)?.item);
  if (!data) return undefined;
  const type = typeof data.type === "string" ? data.type : "";
  const completed = frame.method === "item/completed";

  if (type === "commandExecution" || type === "command_execution") {
    return completedTool(progressPreview(data.command) ?? "shell", completed);
  }
  if (type === "mcpToolCall" || type === "mcp_tool_call") {
    const tool = typeof data.tool === "string" ? data.tool : "MCP";
    const server = typeof data.server === "string" ? `${data.server}.` : "";
    const args = jsonPreview(data.arguments ?? data.input);
    return completedTool(`${server}${tool}${args ? ` ${args}` : ""}`, completed);
  }
  if (type === "dynamicToolCall" || type === "dynamic_tool_call") {
    const tool = typeof data.tool === "string" ? data.tool : "dynamic tool";
    const args = jsonPreview(data.arguments ?? data.input);
    return completedTool(`${tool}${args ? ` ${args}` : ""}`, completed);
  }
  if (type === "webSearch" || type === "web_search") {
    const query = progressPreview(data.query ?? data.search);
    return completedTool(`web search${query ? `: ${query}` : ""}`, completed);
  }
  if (type === "fileChange" || type === "file_change") {
    const paths = Array.isArray(data.changes)
      ? data.changes.flatMap((change) => {
          const path = record(change)?.path;
          return typeof path === "string" ? [path] : [];
        }).join(", ")
      : undefined;
    const detail = progressPreview(paths) ?? progressPreview(data.path);
    return completedTool(`file change${detail ? `: ${detail}` : ""}`, completed);
  }
  if (type === "imageView" || type === "image_view") {
    const path = progressPreview(data.path);
    return completedTool(`image view${path ? `: ${path}` : ""}`, completed);
  }
  if (type === "reasoning") {
    return "thinking";
  }
  if (type === "agentMessage" || type === "agent_message") {
    return "assistant response";
  }
  return undefined;
}

function eventKey(event: StreamEvent): string | undefined {
  if (event.type === "operation.started" || event.type === "operation.finished") return `${event.type}:${event.operationId}`;
  if (event.type === "skill.loaded" && event.operationId) return `${event.type}:${event.operationId}`;
  return undefined;
}

function normalizeItem(value: unknown): unknown {
  const item = record(value);
  if (!item || typeof item.type !== "string") return value;
  const type = ({
    agentMessage: "agent_message",
    commandExecution: "command_execution",
    mcpToolCall: "mcp_tool_call",
    fileChange: "file_change",
    webSearch: "web_search",
  } as Record<string, string>)[item.type] ?? item.type;
  return { ...item, type };
}

function nativeTurnIdentity(value: unknown): { readonly threadId: string; readonly turnId: string } | undefined {
  const params = record(record(value)?.params);
  if (!params || typeof params.threadId !== "string") return undefined;
  const directTurnId = params.turnId;
  const nestedTurnId = record(params.turn)?.id;
  const turnId = typeof directTurnId === "string"
    ? directTurnId
    : typeof nestedTurnId === "string"
      ? nestedTurnId
      : undefined;
  return turnId === undefined ? undefined : { threadId: params.threadId, turnId };
}

function belongsToTurn(value: unknown, threadId: string, turnId: string): boolean {
  const identity = nativeTurnIdentity(value);
  return identity?.threadId === threadId && identity.turnId === turnId;
}

function turnFrames(frames: readonly unknown[], threadId: string, turnId: string): readonly unknown[] {
  return frames.filter((frame) => belongsToTurn(frame, threadId, turnId));
}

function reportTurnProgress(value: unknown, threadId: string, turnId: string, ctx: SandboxAgentContext): void {
  if (!belongsToTurn(value, threadId, turnId)) return;
  const detail = appServerProgressDetail(value);
  if (detail !== undefined) ctx.progress({ message: detail });
}

function appServerUsage(frames: readonly unknown[]): Usage | undefined {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = record(frames[index]);
    if (frame?.method !== "thread/tokenUsage/updated") continue;
    const last = record(record(record(frame.params)?.tokenUsage)?.last);
    if (!last) continue;
    const number = (value: unknown): number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    const rawInput = number(last.inputTokens);
    const cacheReadTokens = number(last.cachedInputTokens);
    const reasoningTokens = number(last.reasoningOutputTokens);
    return {
      inputTokens: Math.max(0, rawInput - cacheReadTokens),
      outputTokens: number(last.outputTokens),
      ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
      ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
      requests: 1,
    };
  }
  return undefined;
}

function protocolEvents(frames: readonly unknown[], reported: Set<string>): { events: StreamEvent[]; usage?: Usage } {
  const normalized = frames.flatMap((value) => {
    const frame = record(value);
    if (!frame || typeof frame.method !== "string") return [];
    const params = record(frame.params) ?? {};
    const type = frame.method.replaceAll("/", ".");
    return [{ type, ...params, ...(params.item === undefined ? {} : { item: normalizeItem(params.item) }) }];
  });
  const parsed = shared.parseCodex(normalized.map((frame) => JSON.stringify(frame)).join("\n"));
  // app-server v2 streams per-turn usage separately from `turn/completed`.
  // `last` is already the current turn's total, so take the latest notification
  // in this send window instead of summing intermediate cumulative updates.
  const usage = appServerUsage(frames) ?? (Object.keys(parsed.usage).length === 0 ? undefined : parsed.usage);
  const events = parsed.events.filter((event) => {
    const key = eventKey(event);
    if (key === undefined) return true;
    if (reported.has(key)) return false;
    reported.add(key);
    return true;
  });
  return { events, ...(usage === undefined ? {} : { usage }) };
}

function evidence(frames: readonly unknown[], parseSuccess: boolean, events: readonly StreamEvent[]): TurnEvidenceCoverage {
  if (frames.length === 0) {
    const reason = "Codex app-server protocol output was unavailable; tool trajectory was not observed.";
    return { events: { status: "unavailable", reason }, actions: { status: "unavailable", reason }, usage: { status: "unavailable", reason } };
  }
  if (!parseSuccess) {
    const reason = "Some Codex app-server protocol frames could not be parsed.";
    return { events: { status: "partial", reason }, actions: { status: "partial", reason } };
  }
  return unclassifiedToolActionsCoverage(events) ?? {};
}

async function resolveBin(sandbox: SandboxAgentContext["sandbox"]): Promise<string> {
  const result = await sandbox.runShell('if [ -x "$HOME/.local/bin/codex" ]; then printf %s "$HOME/.local/bin/codex"; else command -v codex; fi');
  const value = result.stdout.trim();
  if (result.exitCode !== 0 || !value) throw new Error(`Codex CLI path resolution failed: ${result.stderr}`);
  return value;
}

async function rpc(
  driver: ManagedJsonlDriver,
  cursor: number,
  id: number,
  method: string,
  params: unknown,
  signal: AbortSignal,
): Promise<{ result: RecordValue; cursor: number }> {
  await driver.write({ id, method, params });
  const receipt = await driver.waitFor(cursor, (value) => record(value)?.id === id, signal);
  const frame = record(receipt.frame)!;
  if (frame.error !== undefined) throw new Error(`Codex app-server ${method} failed: ${JSON.stringify(frame.error)}`);
  return { result: record(frame.result) ?? {}, cursor: receipt.cursor };
}

async function createState(ctx: SandboxAgentContext, env: Readonly<Record<string, string>>): Promise<CodexState> {
  const resources = attemptResources(ctx);
  if (!resources) throw new Error("Codex app-server requires an Attempt resource registry");
  const driver = await ManagedJsonlDriver.start(
    ctx.sandbox,
    "codex",
    resources,
    {
      argv: [
        await resolveBin(ctx.sandbox),
        "app-server",
        "--stdio",
        "--enable", "default_mode_request_user_input",
        "-c", 'sandbox_mode="danger-full-access"',
        "-c", 'approval_policy="never"',
      ],
      cwd: ctx.sandbox.workdir,
      env,
    },
    () => ({ id: 9_999_999, method: "shutdown", params: {} }),
  );
  let cursor = 0;
  const initialized = await rpc(driver, cursor, 1, "initialize", {
    clientInfo: { name: "niceeval", title: "NiceEval", version: "1" },
  }, ctx.signal);
  cursor = initialized.cursor;
  await driver.write({ method: "initialized" });
  const started = await rpc(driver, cursor, 2, "thread/start", {
    cwd: ctx.sandbox.workdir,
    ...(ctx.model === undefined ? {} : { model: ctx.model }),
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    // app-server 没有 `codex exec --dangerously-bypass-hook-trust` 的顶层 flag，
    // 但 thread/start.config 会把这个 runtime-only override 交给同一 ConfigBuilder。
    // Eval Sandbox 中的 hook 出处由 agent 配置显式声明，因此非交互运行统一 bypass。
    config: { bypass_hook_trust: true },
  }, ctx.signal);
  cursor = started.cursor;
  const threadId = record(started.result.thread)?.id;
  if (typeof threadId !== "string" || !threadId) throw new Error("Codex app-server thread/start returned no native thread id");
  ctx.session.capture(threadId);
  return { driver, cursor, threadId, reported: new Set() };
}

function validateResponses(pending: PendingBatch, responses: readonly InputResponse[] | undefined): Record<string, { answers: string[] }> {
  if (!responses) throw new Error("Codex app-server is waiting for structured input responses");
  const byId = new Map(responses.map((response) => [response.requestId, response]));
  if (byId.size !== responses.length) throw new Error("Codex input responses contain duplicate request ids");
  const expected = new Set(pending.questions.map((question) => question.requestId));
  for (const id of byId.keys()) if (!expected.has(id)) throw new Error(`Unknown Codex input request ${id}`);
  if (byId.size !== expected.size) throw new Error("Codex input responses must answer the complete native question batch");
  const answers: Record<string, { answers: string[] }> = {};
  for (const question of pending.questions) {
    const response = byId.get(question.requestId)!;
    const answer = "optionId" in response ? response.optionId : response.text;
    if (answer === undefined) throw new Error(`Codex input request ${question.requestId} has no answer`);
    if ("optionId" in response && response.optionId !== undefined && !question.options.includes(response.optionId)) {
      throw new Error(`Option ${response.optionId} is not available for Codex input request ${question.requestId}`);
    }
    answers[question.nativeQuestionId] = { answers: [answer] };
  }
  return answers;
}

function waitingTurn(state: CodexState, frame: RecordValue, from: number, cursor: number, turnId: string): Turn {
  const params = record(frame.params) ?? {};
  const questionsRaw = Array.isArray(params.questions) ? params.questions : [];
  const itemId = typeof params.itemId === "string" ? params.itemId : "unknown-item";
  const questions: PendingQuestion[] = questionsRaw.map((value) => {
    const question = record(value) ?? {};
    const nativeQuestionId = String(question.id ?? "unknown-question");
    const options = Array.isArray(question.options)
      ? question.options.map((option) => String(record(option)?.label ?? "")).filter(Boolean)
      : [];
    return {
      requestId: `${state.threadId}:${turnId}:${itemId}:${nativeQuestionId}`,
      nativeQuestionId,
      prompt: String(question.question ?? ""),
      options,
    };
  });
  if (questions.length === 0) throw new Error("Codex app-server request_user_input contained no questions");
  const rpcId = frame.id;
  if (typeof rpcId !== "string" && typeof rpcId !== "number") throw new Error("Codex app-server request_user_input had no JSON-RPC id");
  state.pending = { rpcId, turnId, questions };
  const frames = turnFrames(state.driver.framesSince(from).slice(0, cursor - from), state.threadId, turnId);
  const parsed = protocolEvents(frames, state.reported);
  return {
    status: "waiting",
    events: [
      ...parsed.events,
      ...questions.map((question): StreamEvent => ({
        type: "input.requested",
        request: {
          id: question.requestId,
          action: "request_user_input",
          prompt: question.prompt,
          options: question.options.map((id) => ({ id })),
        },
      })),
    ],
    ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
    evidenceCoverage: evidence(frames, true, parsed.events),
  };
}

async function drive(state: CodexState, ctx: SandboxAgentContext, from: number, turnId: string): Promise<Turn> {
  const receipt = await state.driver.waitFor(state.cursor, (value) => {
    const frame = record(value);
    if (!belongsToTurn(value, state.threadId, turnId)) return false;
    if (frame?.method === "error") {
      // app-server emits transient stream errors before its own reconnect
      // attempts. They remain part of this turn's evidence, but only an error
      // with no promised retry is terminal for the adapter.
      return record(frame.params)?.willRetry !== true;
    }
    return frame?.method === "item/tool/requestUserInput" || frame?.method === "turn/completed";
  }, ctx.signal);
  state.cursor = receipt.cursor;
  const frame = record(receipt.frame)!;
  if (frame.method === "item/tool/requestUserInput") return waitingTurn(state, frame, from, receipt.cursor, turnId);
  const frames = turnFrames(state.driver.framesSince(from).slice(0, receipt.cursor - from), state.threadId, turnId);
  const parsed = protocolEvents(frames, state.reported);
  const turn = record(record(frame.params)?.turn);
  const status = turn?.status;
  if (frame.method === "error") {
    throw makeSendFailure({
      acceptance: sendAcceptanceFromEvents(parsed.events),
      message: `Codex app-server turn failed: ${JSON.stringify(frame.params)}`,
      cause: normalizeExternalCause(frame.params),
      events: parsed.events,
      ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
      process: state.driver.processReceipt(),
    });
  }
  return {
    status: status === "failed" ? "failed" : "completed", events: parsed.events,
    ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
    evidenceCoverage: evidence(frames, true, parsed.events),
  };
}

export async function sendCodexAppServer(
  input: { readonly text: string; readonly responses?: readonly InputResponse[] },
  ctx: SandboxAgentContext,
  env: Readonly<Record<string, string>>,
  failureFacts?: (raw: string, events: readonly StreamEvent[], nativeText: string) => {
    readonly acceptance: "rejected" | "started" | "unknown";
    readonly cause?: ExternalCause;
  },
): Promise<Turn> {
  let state = ctx.session.get(stateSlot);
  if (!state) {
    state = await createState(ctx, env);
    ctx.session.set(stateSlot, state);
  }
  // Anything arriving after the prior turn's terminal cursor is not allowed to
  // become part of a new durable window. Per-turn identity filtering below also
  // protects the race between this snapshot and the next turn/start write.
  if (!state.pending) state.cursor = state.driver.cursor();
  const from = state.cursor;
  let turnId = state.pending?.turnId;
  const bufferedProgress: unknown[] = [];
  const unsubscribe = state.driver.subscribeFrames((frame) => {
    if (turnId === undefined) bufferedProgress.push(frame);
    else reportTurnProgress(frame, state.threadId, turnId, ctx);
  });
  try {
    if (state.pending) {
      const pending = state.pending;
      const answers = validateResponses(pending, input.responses);
      if (state.driver.framesSince(state.cursor).length !== 0) {
        throw new Error("Codex app-server produced activity after entering waiting state; refusing an ambiguous answer");
      }
      try {
        await state.driver.write({ id: pending.rpcId, result: { answers } });
      } catch (cause) {
        throw makeSendFailure({
          acceptance: "started",
          message: `Codex app-server answer transport failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause: normalizeExternalCause(cause),
          process: state.driver.processReceipt(),
        });
      }
      // JSON-RPC response ids are native idempotency identities. Keep pending through
      // validation and transport failure; commit only after the write receipt succeeds.
      state.pending = undefined;
    } else {
      if (input.responses?.length) throw new Error("Codex app-server received responses while no input request was pending");
      const started = await rpc(state.driver, state.cursor, 10_000 + state.cursor, "turn/start", {
        threadId: state.threadId,
        input: [{ type: "text", text: input.text }],
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
        ...(ctx.model === undefined ? {} : { model: ctx.model }),
        ...(ctx.reasoningEffort === undefined ? {} : { effort: ctx.reasoningEffort }),
      }, ctx.signal);
      state.cursor = started.cursor;
      const startedTurnId = record(started.result.turn)?.id;
      if (typeof startedTurnId !== "string" || startedTurnId === "") {
        throw new Error("Codex app-server turn/start returned no native turn id");
      }
      turnId = startedTurnId;
      for (const frame of bufferedProgress) reportTurnProgress(frame, state.threadId, turnId, ctx);
    }
    if (turnId === undefined) throw new Error("Codex app-server send has no native turn id");
    return await drive(state, ctx, from, turnId);
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && (cause as { type?: unknown }).type === "agent-send-failed") throw cause;
    const frames = turnId === undefined
      ? []
      : turnFrames(state.driver.framesSince(from), state.threadId, turnId);
    const raw = frames.map((value) => JSON.stringify(value)).join("\n");
    const message = cause instanceof Error ? cause.message : String(cause);
    const facts = failureFacts?.(raw, protocolEvents(frames, new Set()).events, message);
    throw makeSendFailure({
      acceptance: facts?.acceptance ?? (state.pending === undefined ? "unknown" : "started"),
      message: `Codex app-server transport failed: ${message} (frames=${state.driver.frameKinds() || "none"})`,
      cause: facts?.cause ?? normalizeExternalCause(cause),
      process: state.driver.processReceipt(),
    });
  } finally {
    unsubscribe();
  }
}
