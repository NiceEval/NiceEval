// OpenClaw session JSONL and agent --json use separate protocol boundaries.
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";
import { GENERIC_VERB_ALIASES, normalizeToolName as normalizeShared } from "../tool-names.ts";
import { notCommandProjection, opaqueCommandProjection } from "../command-projection.ts";
import { assertNever, coerceArgs, field, lineDecoder, nonEmptyString, unrecognized, UnknownPart } from "./shared.ts";
import { addUsage, normalizeUsage, TokenUsage, transcriptUsage } from "./usage.ts";

export const OPENCLAW_TOOL_ALIASES: globalThis.Record<string, ToolName> = {
  ...GENERIC_VERB_ALIASES,
  read: "file_read",
  write: "file_write",
  edit: "file_edit",
  exec: "shell",
  process: "shell",
  browser: "web_fetch",
};

const string = nonEmptyString;
const json = field(Schema.MutableJson);
const Part = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: string }),
  Schema.Struct({
    type: Schema.Literals(["thinking", "reasoning"]),
    thinking: string,
    reasoning: string,
    text: string,
  }),
  Schema.Struct({
    type: Schema.Literals(["toolCall", "tool_call", "tool-call", "toolUse"]),
    name: json,
    toolName: json,
    id: string,
    toolCallId: string,
    tool_call_id: string,
    arguments: json,
    args: json,
    input: json,
  }),
  UnknownPart,
]);
const Content = Schema.Union([Schema.String, Schema.Array(Part)]);
const Message = Schema.Union([
  Schema.Struct({ role: Schema.Literal("assistant"), content: field(Content), usage: field(TokenUsage) }),
  Schema.Struct({ role: Schema.Literal("user"), content: json, text: json }),
  Schema.Struct({
    role: Schema.Literals(["toolResult", "tool"]),
    toolCallId: string,
    tool_call_id: string,
    id: string,
    isError: field(Schema.Boolean),
    is_error: field(Schema.Boolean),
    output: json,
    result: json,
    content: json,
  }),
  Schema.Struct({ role: Schema.Literal("system") }),
]);
const MessageEvent = Schema.Struct({ type: Schema.Literal("message"), message: Message });
const Compaction = Schema.Struct({ type: Schema.Literal("compaction"), reason: string });
const OpenClawEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["compaction", "compact"]), reason: string }),
  Schema.Struct({ kind: Schema.Literal("compaction"), reason: string }).pipe(
    Schema.decodeTo(Schema.toType(Compaction), {
      decode: SchemaGetter.transform((event) => ({ type: "compaction" as const, reason: event.reason })),
      encode: SchemaGetter.transform((event) => ({ kind: "compaction" as const, reason: event.reason })),
    }),
  ),
  MessageEvent,
  Message.pipe(
    Schema.decodeTo(Schema.toType(MessageEvent), {
      decode: SchemaGetter.transform((message) => ({ type: "message" as const, message })),
      encode: SchemaGetter.transform((event) => event.message),
    }),
  ),
  Schema.Struct({ type: Schema.Literal("error"), message: json, error: json }),
]);
const decodeLine = lineDecoder(OpenClawEvent);

/** Tool outputs are arbitrary JSON; only their documented text blocks are joined. */
function extractText(content: JsonValue | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (typeof block === "string") return [block];
      if (block === null || typeof block !== "object" || Array.isArray(block)) return [];
      const text = block.text ?? block.content;
      return typeof text === "string" && text ? [text] : [];
    })
    .join("\n");
}

export function parseOpenClawTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  const usage: Usage = {};
  const unrecognizedEvents: Record<string, number> = Object.create(null);
  let compactions = 0;
  let parseSuccess = true;
  let synth = 0;
  const nextSynthId = (): string => `oc_${++synth}`;
  for (const line of (raw ?? "").split("\n")) {
    if (!line.trim()) continue;
    const decoded = decodeLine(line);
    if (decoded.kind === "invalid-json") {
      parseSuccess = false;
      unrecognized(unrecognizedEvents, "<missing-kind>");
      continue;
    }
    if (decoded.kind === "unrecognized") {
      unrecognized(unrecognizedEvents, decoded.type);
      continue;
    }
    const event = decoded.value;
    switch (event.type) {
      case "compaction":
      case "compact":
        compactions += 1;
        events.push({ type: "compaction", reason: event.reason });
        break;
      case "error":
        events.push({ type: "error", message: String(event.message ?? event.error ?? "error") });
        break;
      case "message": {
        const message = event.message;
        switch (message.role) {
          case "assistant": {
            if (message.usage !== undefined) addUsage(usage, normalizeUsage("openclaw", message.usage));
            if (typeof message.content === "string") {
              if (message.content) events.push({ type: "message", role: "assistant", text: message.content });
              break;
            }
            for (const part of message.content ?? []) {
              switch (part.type) {
                case "text":
                  if (part.text) events.push({ type: "message", role: "assistant", text: part.text });
                  break;
                case "thinking":
                case "reasoning": {
                  const text = part.thinking ?? part.reasoning ?? part.text;
                  if (text) events.push({ type: "thinking", text });
                  break;
                }
                case "toolCall":
                case "tool_call":
                case "tool-call":
                case "toolUse": {
                  const name = String(part.name ?? part.toolName ?? "unknown");
                  const callId = part.id ?? part.toolCallId ?? part.tool_call_id ?? nextSynthId();
                  const lower = name.toLowerCase();
                  events.push({
                    type: "operation.started",
                    operationId: callId,
                    operation: {
                      kind: "tool",
                      name,
                      input: coerceArgs(part.arguments ?? part.args ?? part.input),
                      tool: normalizeShared(name, OPENCLAW_TOOL_ALIASES),
                      command:
                        lower === "exec" || lower === "process"
                          ? opaqueCommandProjection("unsupported-protocol")
                          : notCommandProjection(),
                    },
                  });
                  break;
                }
                case "<unrecognized>":
                  unrecognized(unrecognizedEvents, `part:${part.originalType ?? "<missing-kind>"}`);
                  break;
                default:
                  assertNever(part);
              }
            }
            break;
          }
          case "user": {
            const text = extractText(message.content ?? message.text);
            if (text) events.push({ type: "message", role: "user", text });
            break;
          }
          case "toolResult":
          case "tool": {
            const callId = message.toolCallId ?? message.tool_call_id ?? message.id ?? nextSynthId();
            const output = message.output ?? message.result ?? message.content;
            events.push({
              type: "operation.finished",
              operationId: callId,
              kind: "tool",
              output: typeof output === "string" ? output : extractText(output) || output,
              status: message.isError === true || message.is_error === true ? "failed" : "completed",
            });
            break;
          }
          case "system":
            break;
          default:
            assertNever(message);
        }
        break;
      }
      default:
        assertNever(event);
    }
  }
  return { events, usage: transcriptUsage("openclaw", usage), compactions, parseSuccess, unrecognizedEvents };
}

export function parseOpenClaw(raw: string | undefined): StreamEvent[] {
  return parseOpenClawTranscript(raw).events;
}

export interface OpenClawRunJson {
  text: string | undefined;
  sessionId: string | undefined;
  usage: Usage | undefined;
  failed: boolean;
}

const Payloads = Schema.Array(Schema.Struct({ text: string }));
const resultFields = {
  text: string,
  payloads: field(Payloads),
  sessionId: string,
  session_id: string,
  usage: field(TokenUsage),
};
const RunDocument = Schema.Struct({
  ...resultFields,
  sessionKey: string,
  reply: string,
  message: json,
  error: json,
  success: field(Schema.Boolean),
  status: string,
  result: field(Schema.Struct(resultFields)),
  meta: field(
    Schema.Struct({
      usage: field(TokenUsage),
      agentMeta: field(
        Schema.Struct({
          sessionId: string,
          session_id: string,
          usage: field(TokenUsage),
          lastCallUsage: field(TokenUsage),
        }),
      ),
    }),
  ),
});
const decodeRunDocument = lineDecoder(RunDocument);

function payloadText(payloads: typeof Payloads.Type | undefined): string | undefined {
  if (payloads === undefined) return undefined;
  const texts = payloads.flatMap((payload) => (payload.text === undefined ? [] : [payload.text]));
  return texts.length ? texts.join("\n") : undefined;
}

function parseJsonDocument(stdout: string | undefined): typeof RunDocument.Type | undefined {
  if (!stdout?.trim()) return undefined;
  const document = decodeRunDocument(stdout.trim());
  if (document.kind === "decoded") return document.value;
  for (const line of stdout.trim().split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    const decoded = decodeRunDocument(trimmed);
    if (decoded.kind === "decoded") return decoded.value;
  }
  return undefined;
}

export function parseOpenClawRunJson(stdout: string | undefined): OpenClawRunJson {
  const document = parseJsonDocument(stdout);
  if (document === undefined) return { failed: false, text: undefined, sessionId: undefined, usage: undefined };
  const agent = document.meta?.agentMeta;
  const text =
    document.result?.text ??
    payloadText(document.result?.payloads) ??
    payloadText(document.payloads) ??
    document.text ??
    document.reply ??
    (typeof document.message === "string" && document.message ? document.message : undefined);
  const sessionId =
    document.sessionId ??
    document.session_id ??
    document.sessionKey ??
    document.result?.sessionId ??
    document.result?.session_id ??
    agent?.sessionId ??
    agent?.session_id;
  const reported =
    document.usage ?? document.result?.usage ?? document.meta?.usage ?? agent?.usage ?? agent?.lastCallUsage;
  let usage: Usage | undefined;
  if (reported !== undefined) usage = normalizeUsage("openclaw", reported);
  const failed =
    document.error !== undefined ||
    document.success === false ||
    (document.status !== undefined && /^(error|failed)$/i.test(document.status));
  return { text, sessionId, usage, failed };
}
