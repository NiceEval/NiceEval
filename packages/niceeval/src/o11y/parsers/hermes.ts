// Hermes export/state.db protocols have structural session/message tags on wire.
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";
import { GENERIC_VERB_ALIASES, normalizeToolName as normalizeShared } from "../tool-names.ts";
import { notCommandProjection, opaqueCommandProjection } from "../command-projection.ts";
import { assertNever, coerceArgs, field, lineDecoder, nonEmptyString, unrecognized } from "./shared.ts";
import { addUsage, normalizeUsage, TokenUsage, transcriptUsage } from "./usage.ts";

export const HERMES_TOOL_ALIASES: globalThis.Record<string, ToolName> = {
  ...GENERIC_VERB_ALIASES,
  terminal: "shell",
  read_file: "file_read",
  write_file: "file_write",
  edit_file: "file_edit",
  web_extract: "web_fetch",
};

const string = nonEmptyString;
const json = field(Schema.MutableJson);
const ToolCall = Schema.Struct({
  id: string,
  name: string,
  arguments: json,
  input: json,
  function: field(Schema.Struct({ name: string, arguments: json })),
});
const Calls = Schema.Union([Schema.Array(ToolCall), Schema.fromJsonString(Schema.Array(ToolCall))]);
const messageFields = {
  role: string,
  content: string,
  tool_call_id: string,
  toolCallId: string,
  is_error: field(Schema.Boolean),
  isError: field(Schema.Boolean),
  output: json,
  tool_calls: field(Calls),
  toolCalls: field(Calls),
  tool_name: string,
  reasoning: string,
  reasoning_content: string,
  session_id: string,
  sessionId: string,
};
const Message = Schema.Struct(messageFields);
const MessageRow = Schema.Union([
  Schema.Struct({ ...messageFields, role: Schema.NonEmptyString }),
  Schema.Struct({ ...messageFields, session_id: Schema.NonEmptyString }),
  Schema.Struct({ ...messageFields, sessionId: Schema.NonEmptyString }),
]);
const Session = Schema.Struct({ ...TokenUsage.fields, messages: Schema.Array(Message) });
const Metadata = TokenUsage.check(
  Schema.makeFilter((value) => Object.values(value).some((item) => item !== undefined)),
);
const SessionEvent = Schema.Struct({ type: Schema.Literal("session"), session: Schema.toType(Session) });
const MessageEvent = Schema.Struct({ type: Schema.Literal("message"), message: Schema.toType(Message) });
const MetadataEvent = Schema.Struct({ type: Schema.Literal("metadata"), usage: Schema.toType(TokenUsage) });
const HermesEvent = Schema.Union([
  Session.pipe(
    Schema.decodeTo(SessionEvent, {
      decode: SchemaGetter.transform((session) => ({ type: "session" as const, session })),
      encode: SchemaGetter.transform((event) => event.session),
    }),
  ),
  MessageRow.pipe(
    Schema.decodeTo(MessageEvent, {
      decode: SchemaGetter.transform((message) => ({ type: "message" as const, message })),
      encode: SchemaGetter.forbiddenEncoding,
    }),
  ),
  Metadata.pipe(
    Schema.decodeTo(MetadataEvent, {
      decode: SchemaGetter.transform((usage) => ({ type: "metadata" as const, usage })),
      encode: SchemaGetter.transform((event) => event.usage),
    }),
  ),
]);
const decodeLine = lineDecoder(HermesEvent);

function skillName(name: string, input: JsonValue): string | undefined {
  if (name.toLowerCase() !== "skill_view" || input === null || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const skill = input.name;
  return typeof skill === "string" && skill ? skill : undefined;
}

export function parseHermesTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  const usage: Usage = {};
  const unrecognizedEvents: Record<string, number> = Object.create(null);
  let parseSuccess = true;
  let synth = 0;
  const skillCallIds = new Set<string>();
  const nextSynthId = (): string => `hm_${++synth}`;
  const ingestMessage = (message: typeof Message.Type): void => {
    const role = message.role ?? "assistant";
    const content = message.content;
    if (role === "tool" || message.tool_call_id || message.toolCallId) {
      const callId = message.tool_call_id ?? message.toolCallId ?? nextSynthId();
      if (skillCallIds.has(callId)) return;
      events.push({
        type: "operation.finished",
        operationId: callId,
        kind: "tool",
        output: content ?? message.output ?? null,
        status: message.is_error === true || message.isError === true ? "failed" : "completed",
      });
      return;
    }
    for (const call of message.tool_calls ?? message.toolCalls ?? []) {
      const name = call.function?.name ?? call.name ?? message.tool_name ?? "unknown";
      const callId = call.id ?? nextSynthId();
      const input = coerceArgs(call.function?.arguments ?? call.arguments ?? call.input);
      const skill = skillName(name, input);
      if (skill !== undefined) {
        events.push({ type: "skill.loaded", skill, operationId: callId });
        skillCallIds.add(callId);
        continue;
      }
      events.push({
        type: "operation.started",
        operationId: callId,
        operation: {
          kind: "tool",
          name,
          input,
          tool: normalizeShared(name, HERMES_TOOL_ALIASES),
          command:
            name.toLowerCase() === "terminal"
              ? opaqueCommandProjection("unsupported-protocol")
              : notCommandProjection(),
        },
      });
    }
    if (content?.trim() && role !== "user" && role !== "system")
      events.push({ type: "message", role: "assistant", text: content });
    const reasoning = message.reasoning ?? message.reasoning_content;
    if (reasoning?.trim()) events.push({ type: "thinking", text: reasoning });
  };
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
      case "session":
        addUsage(usage, normalizeUsage("hermes", event.session));
        for (const message of event.session.messages) ingestMessage(message);
        break;
      case "message":
        ingestMessage(event.message);
        break;
      case "metadata":
        addUsage(usage, normalizeUsage("hermes", event.usage));
        break;
      default:
        assertNever(event);
    }
  }
  return { events, usage: transcriptUsage("hermes", usage), compactions: 0, parseSuccess, unrecognizedEvents };
}

const SessionIdentity = Schema.Struct({
  id: string,
  session_id: string,
  sessionId: string,
  messages: field(Schema.Array(Schema.MutableJson)),
  source: string,
});
const decodeIdentity = lineDecoder(SessionIdentity);

export function sessionIdFromHermesOutput(raw: string | undefined): string | undefined {
  for (const line of (raw ?? "").split("\n")) {
    const resume = line.match(/hermes\s+(?:chat\s+)?(?:--resume|-r)\s+(\S+)/i);
    if (resume?.[1]) return resume[1].replace(/["'`]/g, "");
    const labeled = line.match(/Session:\s*([A-Za-z0-9_-]+)/i);
    if (labeled?.[1]) return labeled[1];
    const decoded = decodeIdentity(line);
    if (decoded.kind !== "decoded") continue;
    const value = decoded.value;
    const id = value.id ?? value.session_id ?? value.sessionId;
    if (id && (value.messages !== undefined || value.source !== undefined)) return id;
  }
  return undefined;
}
