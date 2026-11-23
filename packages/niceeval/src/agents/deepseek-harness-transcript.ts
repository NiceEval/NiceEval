import * as Schema from "effect/Schema";
import { notCommandProjection, opaqueCommandProjection } from "../o11y/command-projection.ts";
import { field, jsonField, lineDecoder } from "../o11y/parsers/shared.ts";
import { normalizeToolName } from "../o11y/tool-names.ts";
import type { StreamEvent, Usage } from "../types.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const StepUsage = Schema.Struct({
  inputTokens: Count,
  outputTokens: Count,
  cacheReadTokens: field(Count),
  cacheWriteTokens: field(Count),
  reasoningTokens: field(Count),
});
const ErrorDetail = Schema.Struct({ message: field(Schema.String), code: field(Schema.String) });
const TurnReason = Schema.Struct({ kind: Schema.NonEmptyString, error: field(ErrorDetail) });
const truncation = { truncated: field(Schema.Boolean) };
const stepIdentity = { turn: Count, step: Count };
const decodeFrame = lineDecoder(
  Schema.Union([
    Schema.Struct({ type: Schema.Literal("session"), sessionId: Schema.NonEmptyString, ...truncation }),
    Schema.Struct({ type: Schema.Literals(["text", "thinking"]), text: field(Schema.String), ...truncation }),
    Schema.Struct({
      type: Schema.Literal("tool_call"),
      callId: Schema.NonEmptyString,
      tool: Schema.NonEmptyString,
      input: jsonField,
      ...truncation,
    }),
    Schema.Struct({
      type: Schema.Literal("tool_result"),
      callId: Schema.NonEmptyString,
      status: Schema.Literals(["completed", "error"]),
      result: field(Schema.String),
      error: field(ErrorDetail),
      ...truncation,
    }),
    Schema.Struct({
      type: Schema.Literal("status"),
      phase: Schema.Literals(["turn_start", "turn_end"]),
      turn: Count,
      reason: field(TurnReason),
      ...truncation,
    }),
    Schema.Struct({
      type: Schema.Literal("status"),
      phase: Schema.Literals(["step_start", "step_end"]),
      ...stepIdentity,
      usage: field(StepUsage),
      ...truncation,
    }),
    Schema.Struct({ type: Schema.Literal("error"), message: Schema.NonEmptyString, ...truncation }),
    Schema.Struct({
      type: Schema.Literal("final"),
      sessionId: Schema.NonEmptyString,
      text: Schema.String,
      reason: Schema.NullOr(TurnReason),
      ...truncation,
    }),
  ]),
);
type Frame = Extract<ReturnType<typeof decodeFrame>, { kind: "decoded" }>["value"];
type Final = Extract<Frame, { type: "final" }>;
type Tokens = typeof StepUsage.Type;

const FAILED_TURN_REASONS = new Set(["aborted", "blocked", "error", "max-tokens"]);
const USAGE_FIELDS = [
  ["inputTokens", "inputTokens"],
  ["outputTokens", "outputTokens"],
  ["cacheReadTokens", "cacheReadTokens"],
  ["cacheWriteTokens", "cacheCreationTokens"],
  ["reasoningTokens", "reasoningTokens"],
] as const;

function totalUsage(steps: Map<string, Tokens | undefined>): Usage | undefined {
  const samples = Array.from(steps.values()).filter((step) => step !== undefined);
  if (samples.length === 0) return undefined;
  const sum = (key: keyof Tokens): number | undefined => {
    let total = 0;
    for (const sample of samples) {
      const value = sample[key];
      if (value === undefined) return undefined;
      total += value;
    }
    return Number.isSafeInteger(total) ? total : undefined;
  };
  const usage: Usage = {};
  for (const [native, normalized] of USAGE_FIELDS) {
    const value = sum(native);
    if (value !== undefined) usage[normalized] = value;
  }
  return Object.keys(usage).length === 0 ? undefined : usage;
}

function terminalStatus(exitCode: number, final: Final | undefined): "completed" | "failed" | undefined {
  if (exitCode === 0 && final?.reason?.kind === "completed" && final.text.trim()) return "completed";
  if (exitCode === 1 && final?.reason && FAILED_TURN_REASONS.has(final.reason.kind)) return "failed";
  return undefined;
}

export function parseDeepSeekHarnessRun(stdout: string, exitCode: number) {
  const events: StreamEvent[] = [];
  const steps = new Map<string, Tokens | undefined>();
  const calls = new Set<string>();
  let sessionId: string | undefined;
  let final: Final | undefined;
  let accepted = false;
  let protocolGap = false;
  let conflictingTerminal = false;
  let latestTurnEnd: string | undefined;
  let pendingText = "";
  let lastMessage: number | undefined;
  let lastMessageTruncated = false;
  let pendingTextTruncated = false;

  function flushText() {
    if (pendingText || pendingTextTruncated) {
      lastMessage = events.length;
      lastMessageTruncated = pendingTextTruncated;
      events.push({ type: "message", role: "assistant", text: pendingText });
      pendingText = "";
      pendingTextTruncated = false;
    }
  }

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    if (final !== undefined) {
      conflictingTerminal = true;
      break;
    }
    const decoded = decodeFrame(line);
    if (decoded.kind !== "decoded") {
      protocolGap = true;
      continue;
    }
    const frame = decoded.value;
    if (sessionId === undefined && frame.type !== "session" && frame.type !== "error") {
      conflictingTerminal = true;
      continue;
    }
    protocolGap ||= frame.truncated === true;
    switch (frame.type) {
      case "session":
        conflictingTerminal ||= sessionId !== undefined || frame.truncated === true;
        sessionId ??= frame.sessionId;
        break;
      case "status": {
        if (frame.phase === "turn_start") {
          accepted = true;
          latestTurnEnd = undefined;
        } else if (frame.phase === "turn_end") {
          flushText();
          latestTurnEnd = frame.reason?.kind;
        } else if ("step" in frame) {
          const key = `${frame.turn}:${frame.step}`;
          if (frame.phase === "step_end") {
            flushText();
            steps.set(key, frame.usage);
          } else if (!steps.has(key)) {
            steps.set(key, undefined);
          }
        }
        break;
      }
      case "thinking":
        if (frame.text) events.push({ type: "thinking", text: frame.text });
        break;
      case "text":
        pendingText += frame.text ?? "";
        pendingTextTruncated ||= frame.truncated === true;
        break;
      case "tool_call": {
        flushText();
        if (frame.input === undefined || calls.has(frame.callId)) {
          protocolGap = true;
          break;
        }
        calls.add(frame.callId);
        const tool = normalizeToolName(frame.tool, { read: "file_read", write: "file_write", edit: "file_edit" });
        const command =
          tool === "shell"
            ? opaqueCommandProjection(frame.truncated ? "truncated" : "unsupported-protocol")
            : tool === "unknown"
              ? undefined
              : notCommandProjection();
        events.push({
          type: "operation.started",
          operationId: frame.callId,
          operation: { kind: "tool", name: frame.tool, input: frame.input, tool, command },
        });
        break;
      }
      case "tool_result":
        if (!calls.delete(frame.callId)) {
          protocolGap = true;
          break;
        }
        events.push({
          type: "operation.finished",
          operationId: frame.callId,
          kind: "tool",
          status:
            frame.status === "completed"
              ? "completed"
              : frame.error?.code === "APPROVAL_REJECTED"
                ? "rejected"
                : "failed",
          output: frame.result,
        });
        break;
      case "error":
        flushText();
        events.push({ type: "error", message: frame.message });
        break;
      case "final":
        flushText();
        final = frame;
        break;
    }
  }
  flushText();

  const trustedFinal =
    final !== undefined &&
    sessionId === final.sessionId &&
    !conflictingTerminal &&
    !final.truncated &&
    (latestTurnEnd === undefined || latestTurnEnd === final.reason?.kind)
      ? final
      : undefined;
  if (trustedFinal?.text) {
    const finalMessage = { type: "message", role: "assistant", text: trustedFinal.text } as const;
    const previous = lastMessage === undefined ? undefined : events[lastMessage];
    if (
      lastMessage !== undefined &&
      (lastMessageTruncated || (previous?.type === "message" && previous.text === trustedFinal.text))
    ) {
      events[lastMessage] = finalMessage;
    } else {
      events.push(finalMessage);
    }
  }
  const status = terminalStatus(exitCode, trustedFinal);
  if (status === "failed") {
    const reason = trustedFinal?.reason;
    events.push({
      type: "error",
      message: reason?.error?.message || `DeepSeek Harness ended with reason ${reason?.kind}.`,
    });
  }
  return {
    sessionId,
    accepted,
    events,
    status,
    usage: totalUsage(steps),
    usageGap: Array.from(steps.values()).some((step) => step === undefined),
    protocolGap: protocolGap || calls.size > 0,
  };
}
