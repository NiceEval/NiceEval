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
type PendingBatch = { readonly rpcId: string | number; readonly questions: readonly PendingQuestion[] };
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

function protocolEvents(frames: readonly unknown[], reported: Set<string>): { events: StreamEvent[]; usage?: Usage } {
  const normalized = frames.flatMap((value) => {
    const frame = record(value);
    if (!frame || typeof frame.method !== "string") return [];
    const params = record(frame.params) ?? {};
    const type = frame.method.replaceAll("/", ".");
    return [{ type, ...params, ...(params.item === undefined ? {} : { item: normalizeItem(params.item) }) }];
  });
  const parsed = shared.parseCodex(normalized.map((frame) => JSON.stringify(frame)).join("\n"));
  const events = parsed.events.filter((event) => {
    const key = eventKey(event);
    if (key === undefined) return true;
    if (reported.has(key)) return false;
    reported.add(key);
    return true;
  });
  return { events, ...(Object.keys(parsed.usage).length === 0 ? {} : { usage: parsed.usage }) };
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
    (value) => {
      const frame = record(value);
      if (frame?.method !== "item/started") return;
      const item = record(record(frame.params)?.item);
      const detail = typeof item?.type === "string" ? item.type : "Codex operation";
      ctx.progress({ message: detail });
    },
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

function waitingTurn(state: CodexState, frame: RecordValue, from: number, cursor: number, ctx: SandboxAgentContext): Turn {
  const params = record(frame.params) ?? {};
  const questionsRaw = Array.isArray(params.questions) ? params.questions : [];
  const itemId = typeof params.itemId === "string" ? params.itemId : "unknown-item";
  const turnId = typeof params.turnId === "string" ? params.turnId : "unknown-turn";
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
  state.pending = { rpcId, questions };
  const parsed = protocolEvents(state.driver.framesSince(from).slice(0, cursor - from), state.reported);
  for (const event of parsed.events) if (event.type === "operation.started") ctx.progress({ message: event.operation.name });
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
    evidenceCoverage: evidence(state.driver.framesSince(from).slice(0, cursor - from), true, parsed.events),
  };
}

async function drive(state: CodexState, ctx: SandboxAgentContext, from: number): Promise<Turn> {
  const receipt = await state.driver.waitFor(state.cursor, (value) => {
    const frame = record(value);
    return frame?.method === "item/tool/requestUserInput" || frame?.method === "turn/completed" || frame?.method === "error";
  }, ctx.signal);
  state.cursor = receipt.cursor;
  const frame = record(receipt.frame)!;
  if (frame.method === "item/tool/requestUserInput") return waitingTurn(state, frame, from, receipt.cursor, ctx);
  const parsed = protocolEvents(state.driver.framesSince(from).slice(0, receipt.cursor - from), state.reported);
  const turn = record(record(frame.params)?.turn);
  const status = turn?.status;
  if (frame.method === "error" || status === "failed") {
    const raw = state.driver.framesSince(from).map((value) => JSON.stringify(value)).join("\n");
    throw makeSendFailure({
      acceptance: sendAcceptanceFromEvents(parsed.events),
      message: `Codex app-server turn failed: ${JSON.stringify(frame.params)}`,
      cause: normalizeExternalCause(frame.params),
      events: parsed.events,
      ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
      process: state.driver.processReceipt(),
    });
  }
  for (const event of parsed.events) if (event.type === "operation.started") ctx.progress({ message: event.operation.name });
  return {
    status: "completed", events: parsed.events,
    ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
    evidenceCoverage: evidence(state.driver.framesSince(from).slice(0, receipt.cursor - from), true, parsed.events),
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
  const from = state.cursor;
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
  }
  try {
    return await drive(state, ctx, from);
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && (cause as { type?: unknown }).type === "agent-send-failed") throw cause;
    const raw = state.driver.framesSince(from).map((value) => JSON.stringify(value)).join("\n");
    const message = cause instanceof Error ? cause.message : String(cause);
    const facts = failureFacts?.(raw, protocolEvents(state.driver.framesSince(from), new Set()).events, message);
    throw makeSendFailure({
      acceptance: facts?.acceptance ?? (state.pending === undefined ? "unknown" : "started"),
      message: `Codex app-server transport failed: ${message} (frames=${state.driver.frameKinds() || "none"})`,
      cause: facts?.cause ?? normalizeExternalCause(cause),
      process: state.driver.processReceipt(),
    });
  }
}
