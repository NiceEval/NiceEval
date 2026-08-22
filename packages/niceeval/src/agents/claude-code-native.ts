import type { InputResponse, SandboxAgentContext, StreamEvent, Turn, TurnEvidenceCoverage, Usage } from "../types.ts";
import { createSessionSlot } from "./session-slot.ts";
import { ManagedJsonlDriver } from "./managed-jsonl.ts";
import { shared } from "./shared.ts";
import { unclassifiedToolActionsCoverage } from "../o11y/command-projection.ts";
import { makeSendFailure, sendAcceptanceFromEvents } from "../context/send-failures.ts";
import { normalizeExternalCause } from "../shared/external-cause.ts";
import { attemptResources } from "../context/attempt-resources.ts";

type RecordValue = globalThis.Record<string, unknown>;
type PendingQuestion = {
  readonly requestId: string;
  readonly index: number;
  readonly question: string;
  readonly options: readonly string[];
};
type Pending = {
  readonly controlRequestId: string;
  readonly toolUseId: string;
  readonly input: RecordValue;
  readonly questions: readonly PendingQuestion[];
};
type ClaudeState = {
  readonly driver: ManagedJsonlDriver;
  cursor: number;
  pending?: Pending;
  sessionId?: string;
  readonly reported: Set<string>;
};

const slot = createSessionSlot<ClaudeState>("claude-code/stream-json-native");
function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

async function resolveBin(ctx: SandboxAgentContext): Promise<string> {
  const result = await ctx.sandbox.runShell('if [ -x "$HOME/.local/bin/claude" ]; then printf %s "$HOME/.local/bin/claude"; else command -v claude; fi');
  const value = result.stdout.trim();
  if (result.exitCode !== 0 || !value) throw new Error(`Claude Code CLI path resolution failed: ${result.stderr}`);
  return value;
}

function eventKey(event: StreamEvent): string | undefined {
  return event.type === "operation.started" || event.type === "operation.finished"
    ? `${event.type}:${event.operationId}`
    : undefined;
}

function parseFrames(frames: readonly unknown[], reported: Set<string>): { events: StreamEvent[]; usage: Usage; parseSuccess: boolean } {
  const parsed = shared.parseClaudeCode(frames.map((frame) => JSON.stringify(frame)).join("\n"));
  return {
    usage: parsed.usage,
    parseSuccess: parsed.parseSuccess,
    events: parsed.events.filter((event) => {
      const key = eventKey(event);
      if (key === undefined) return true;
      if (reported.has(key)) return false;
      reported.add(key);
      return true;
    }),
  };
}

function coverage(frames: readonly unknown[], parsed: ReturnType<typeof parseFrames>): TurnEvidenceCoverage {
  if (frames.length === 0) {
    const reason = "Claude Code stream-json output was unavailable; tool trajectory was not observed.";
    return { events: { status: "unavailable", reason }, actions: { status: "unavailable", reason }, usage: { status: "unavailable", reason } };
  }
  if (!parsed.parseSuccess) {
    const reason = "Some Claude Code stream-json frames could not be parsed.";
    return { events: { status: "partial", reason }, actions: { status: "partial", reason } };
  }
  return unclassifiedToolActionsCoverage(parsed.events) ?? {};
}

function captureSession(state: ClaudeState, frame: RecordValue, ctx: SandboxAgentContext): void {
  const id = frame.session_id;
  if (typeof id !== "string" || id === "") return;
  if (state.sessionId !== undefined && state.sessionId !== id) {
    throw new Error(`Claude Code changed native session identity from ${state.sessionId} to ${id}`);
  }
  state.sessionId = id;
  ctx.session.capture(id);
}

function validate(pending: Pending, responses: readonly InputResponse[] | undefined): Record<string, string> {
  if (responses === undefined) throw new Error("Claude Code is waiting for a structured input response");
  const byId = new Map(responses.map((response) => [response.requestId, response]));
  if (byId.size !== responses.length) throw new Error("Claude Code input responses contain duplicate request ids");
  const expected = new Set(pending.questions.map((question) => question.requestId));
  for (const requestId of byId.keys()) if (!expected.has(requestId)) throw new Error(`Unknown Claude Code input request ${requestId}`);
  if (byId.size !== expected.size) throw new Error("Claude Code input responses must answer the complete native question batch");
  const answers: Record<string, string> = {};
  for (const question of pending.questions) {
    const response = byId.get(question.requestId)!;
    const answer = "optionId" in response ? response.optionId : response.text;
    if (answer === undefined) throw new Error(`Claude Code input request ${question.requestId} has no answer`);
    if ("optionId" in response && response.optionId !== undefined && !question.options.includes(response.optionId)) {
      throw new Error(`Option ${response.optionId} is not available for Claude Code input request ${question.requestId}`);
    }
    answers[question.question] = answer;
  }
  return answers;
}

async function createState(
  ctx: SandboxAgentContext,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<ClaudeState> {
  const resources = attemptResources(ctx);
  if (!resources) throw new Error("Claude Code structured transport requires an Attempt resource registry");
  const driver = await ManagedJsonlDriver.start(ctx.sandbox, "claude-code", resources, {
    argv: [await resolveBin(ctx), "--output-format", "stream-json", "--verbose", "--input-format", "stream-json", "--permission-prompt-tool", "stdio", "--permission-mode", "default", ...args],
    cwd: ctx.sandbox.workdir,
    env: { ...env, CLAUDE_CODE_ENTRYPOINT: "sdk-ts", CLAUDE_AGENT_SDK_VERSION: "0.3.226" },
  });
  return { driver, cursor: 0, reported: new Set() };
}

function pendingFrom(frame: RecordValue, sessionId: string): Pending | undefined {
  if (frame.type !== "control_request" || typeof frame.request_id !== "string") return undefined;
  const request = record(frame.request);
  if (request?.subtype !== "can_use_tool" || request.tool_name !== "AskUserQuestion") return undefined;
  if (typeof request.tool_use_id !== "string") throw new Error("Claude Code AskUserQuestion request has no native tool_use_id");
  const input = record(request.input) ?? {};
  const questions = Array.isArray(input.questions) ? input.questions : [];
  if (questions.length === 0) throw new Error("Claude Code AskUserQuestion request contained no questions");
  return {
    controlRequestId: frame.request_id,
    toolUseId: request.tool_use_id,
    input,
    questions: questions.map((value, index) => {
      const question = record(value) ?? {};
      const options = Array.isArray(question.options)
        ? question.options.map((option) => String(record(option)?.label ?? "")).filter(Boolean)
        : [];
      return {
        requestId: `${sessionId}:${request.tool_use_id}:${index}`,
        index,
        question: String(question.question ?? ""),
        options,
      };
    }),
  };
}

async function drive(state: ClaudeState, from: number, ctx: SandboxAgentContext): Promise<Turn> {
  for (;;) {
    const scanFrom = state.cursor;
    const receipt = await state.driver.waitFor(state.cursor, (value) => {
      const frame = record(value);
      return frame?.type === "control_request" || frame?.type === "result";
    }, ctx.signal);
    state.cursor = receipt.cursor;
    const frame = record(receipt.frame)!;
    for (const value of state.driver.framesSince(scanFrom).slice(0, receipt.cursor - scanFrom)) {
      const candidate = record(value);
      if (candidate) captureSession(state, candidate, ctx);
    }
    if (frame.type === "control_request") {
      const request = record(frame.request);
      if (state.sessionId === undefined) throw new Error("Claude Code control request arrived before native session identity");
      const pending = pendingFrom(frame, state.sessionId);
      if (pending) {
        state.pending = pending;
        const frames = state.driver.framesSince(from).slice(0, receipt.cursor - from);
        const parsed = parseFrames(frames, state.reported);
        for (const event of parsed.events) if (event.type === "operation.started") ctx.progress({ message: event.operation.name });
        return {
          status: "waiting",
          events: [...parsed.events, ...pending.questions.map((question): StreamEvent => ({ type: "input.requested", request: { id: question.requestId, action: "AskUserQuestion", prompt: question.question, options: question.options.map((id) => ({ id })) } }))],
          usage: parsed.usage,
          evidenceCoverage: coverage(frames, parsed),
        };
      }
      if (request?.subtype === "can_use_tool" && typeof frame.request_id === "string") {
        await state.driver.write({ type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: { behavior: "allow", updatedInput: record(request.input) ?? {} } } });
      }
      continue;
    }
    const frames = state.driver.framesSince(from).slice(0, receipt.cursor - from);
    const parsed = parseFrames(frames, state.reported);
    for (const value of frames) { const candidate = record(value); if (candidate) captureSession(state, candidate, ctx); }
    if (frame.is_error === true) {
      throw makeSendFailure({ acceptance: sendAcceptanceFromEvents(parsed.events), message: String(frame.result ?? frame.subtype ?? "Claude Code turn failed"), cause: normalizeExternalCause(frame), events: parsed.events, usage: parsed.usage, process: state.driver.processReceipt() });
    }
    return { status: "completed", events: parsed.events, usage: parsed.usage, evidenceCoverage: coverage(frames, parsed) };
  }
}

export async function sendClaudeCodeNative(
  input: { readonly text: string; readonly responses?: readonly InputResponse[] },
  ctx: SandboxAgentContext,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<Turn> {
  let state = ctx.session.get(slot);
  if (!state) { state = await createState(ctx, args, env); ctx.session.set(slot, state); }
  const from = state.cursor;
  try {
    if (state.pending) {
      const pending = state.pending;
      const answers = validate(pending, input.responses);
      if (state.driver.framesSince(state.cursor).length !== 0) throw new Error("Claude Code produced activity after entering waiting state; refusing an ambiguous answer");
      await state.driver.write({
        type: "control_response",
        response: { subtype: "success", request_id: pending.controlRequestId, response: { behavior: "allow", updatedInput: { ...pending.input, answers } } },
      });
      state.pending = undefined;
    } else {
      if (input.responses?.length) throw new Error("Claude Code received responses while no native request was pending");
      await state.driver.write({ type: "user", session_id: state.sessionId ?? "", message: { role: "user", content: [{ type: "text", text: input.text }] }, parent_tool_use_id: null });
    }
    return await drive(state, from, ctx);
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && (cause as { type?: unknown }).type === "agent-send-failed") throw cause;
    throw makeSendFailure({ acceptance: state.pending ? "started" : "unknown", message: `Claude Code structured transport failed: ${cause instanceof Error ? cause.message : String(cause)} (frames=${state.driver.frameKinds() || "none"})`, cause: normalizeExternalCause(cause), process: state.driver.processReceipt() });
  }
}
