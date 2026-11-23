// Codex exec JSONL and normalized app-server notifications share this parser.
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import type { CommandProjection, StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";
import { GENERIC_VERB_ALIASES, normalizeToolName as normalizeShared } from "../tool-names.ts";
import { notCommandProjection, opaqueCommandProjection } from "../command-projection.ts";
import { assertNever, coerceArgs, field, lineDecoder, unrecognized } from "./shared.ts";
import { addUsage, normalizeUsage, TokenUsage, transcriptUsage } from "./usage.ts";

export const CODEX_TOOL_ALIASES: globalThis.Record<string, ToolName> = {
  ...GENERIC_VERB_ALIASES,
  file_change: "file_edit",
  update_plan: "agent_task",
};

const json = field(Schema.MutableJson);
const string = field(Schema.String);
const id = field(Schema.Union([Schema.String, Schema.Number]));
const TextBlock = Schema.Union([Schema.String, Schema.Struct({ text: string, content: string, thinking: string })]);
const Content = Schema.Union([Schema.String, Schema.Array(TextBlock)]);
const textFields = { text: field(Content), content: field(Content), summary: field(Schema.Array(TextBlock)) };
// Codex exec emits a string kind and app-server emits an object tagged by type.
const changeKind = field(Schema.Union([Schema.String, Schema.Struct({ type: Schema.String })]));
const itemFields = {
  ...textFields,
  id,
  message: field(Content),
  command: json,
  action: field(Schema.Struct({ command: json })),
  exit_code: json,
  exitCode: json,
  aggregated_output: json,
  aggregatedOutput: json,
  output: json,
  status: string,
  server: string,
  tool: json,
  name: json,
  arguments: json,
  input: json,
  error: json,
  result: json,
  query: json,
  search: json,
  results: json,
  changes: field(Schema.Array(Schema.Struct({ path: json, file: json, kind: changeKind, type: string }))),
  path: json,
  kind: string,
  usage: field(TokenUsage),
};
const CompactionItem = Schema.Struct({ type: Schema.Literal("compaction"), ...itemFields });
const compactionTag = Schema.String.check(Schema.isPattern(/compact|context_truncat/i));
const Item = Schema.Union([
  Schema.Struct({ type: compactionTag, ...itemFields }).pipe(
    Schema.decodeTo(Schema.toType(CompactionItem), {
      decode: SchemaGetter.transform((item) => ({ ...item, type: "compaction" as const })),
      encode: SchemaGetter.transform((item) => item),
    }),
  ),
  Schema.Struct({ type: Schema.Literals(["reasoning", "thinking"]), ...itemFields }),
  Schema.Struct({ type: Schema.Literals(["agent_message", "assistant_message", "message"]), ...itemFields }),
  Schema.Struct({ type: Schema.Literals(["command_execution", "local_shell_call"]), ...itemFields }),
  Schema.Struct({ type: Schema.Literal("mcp_tool_call"), ...itemFields }),
  Schema.Struct({ type: Schema.Literal("web_search"), ...itemFields }),
  Schema.Struct({ type: Schema.Literals(["file_change", "patch", "file_patch"]), ...itemFields }),
  Schema.Struct({ type: Schema.Literal("error"), ...itemFields }),
  Schema.Struct({ type: Schema.Literal("todo_list"), ...itemFields }),
]);
const ErrorMessage = Schema.Struct({ message: json });
const eventFields = {
  ...textFields,
  message: json,
  role: string,
  from: string,
  subtype: string,
  usage: field(TokenUsage),
  payload: field(Schema.Struct({ usage: field(TokenUsage) })),
  item: field(Item),
  turn: field(Schema.Struct({ usage: field(TokenUsage), status: string, error: field(ErrorMessage) })),
  response: field(Schema.Struct({ usage: field(TokenUsage) })),
  error: field(Schema.Union([ErrorMessage, Schema.MutableJson])),
  function: field(Schema.Struct({ name: json, arguments: json })),
  name: json,
  tool: json,
  action: json,
  arguments: json,
  input: json,
  params: json,
  call_id: id,
  id,
  tool_call_id: id,
  output: json,
  result: json,
  success: field(Schema.Boolean),
  status: string,
};
const CompactionEvent = Schema.Struct({ type: Schema.Literal("compaction"), ...eventFields });
const CodexEvent = Schema.Union([
  Schema.Struct({ type: compactionTag, ...eventFields }).pipe(
    Schema.decodeTo(Schema.toType(CompactionEvent), {
      decode: SchemaGetter.transform((event) => ({ ...event, type: "compaction" as const })),
      encode: SchemaGetter.transform((event) => event),
    }),
  ),
  Schema.Struct({ type: Schema.String, ...eventFields, subtype: compactionTag }).pipe(
    Schema.decodeTo(Schema.toType(CompactionEvent), {
      decode: SchemaGetter.transform((event) => ({ ...event, type: "compaction" as const })),
      encode: SchemaGetter.forbiddenEncoding,
    }),
  ),
  Schema.Struct({
    type: Schema.Literals([
      "thread.started",
      "thread.completed",
      "turn.started",
      "response.created",
      "response.completed",
      "response.cancelled",
    ]),
    ...eventFields,
  }),
  Schema.Struct({ type: Schema.Literal("turn.completed"), ...eventFields }),
  Schema.Struct({ type: Schema.Literals(["turn.failed", "response.failed"]), ...eventFields }),
  Schema.Struct({ type: Schema.Literals(["item.started", "item.updated", "item.completed"]), ...eventFields }),
  Schema.Struct({ type: Schema.Literals(["message", "chat"]), ...eventFields, message: field(Content) }),
  Schema.Struct({ type: Schema.Literals(["reasoning", "thinking", "thought"]), ...eventFields }),
  Schema.Struct({
    type: Schema.Literals(["function_call", "tool_call", "tool_use", "custom_tool_call", "action", "local_shell_call"]),
    ...eventFields,
  }),
  Schema.Struct({
    type: Schema.Literals([
      "function_call_output",
      "tool_result",
      "tool_response",
      "action_result",
      "local_shell_call_output",
    ]),
    ...eventFields,
    content: json,
  }),
  Schema.Struct({ type: Schema.Literal("error"), ...eventFields }),
  Schema.Struct({ type: Schema.Literals(["output_text.delta", "output_text.done"]), ...eventFields }),
  Schema.Struct({
    type: Schema.Literals(["compaction", "compact", "context_compacted", "context_truncated"]),
    ...eventFields,
  }),
]);
const decodeLine = lineDecoder(CodexEvent);
type CodexItem = typeof Item.Type;
type Event = typeof CodexEvent.Type;
type Text = typeof Content.Type;

function extractText(content: Text | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content
    .flatMap((block) => {
      if (typeof block === "string") return [block];
      const text = block.text ?? block.content ?? block.thinking;
      return text === undefined ? [] : [text];
    })
    .join("\n");
}

function extractReasoning(item: {
  readonly text: Text | undefined;
  readonly content: Text | undefined;
  readonly summary: readonly (typeof TextBlock.Type)[] | undefined;
}): string {
  const direct = item.text ?? item.content;
  if (typeof direct === "string" && direct) return direct;
  if (item.summary !== undefined) return extractText(item.summary);
  return extractText(direct);
}

function errorMessage(error: Event["error"]): JsonValue | undefined {
  if (error === undefined || error === null || typeof error !== "object" || Array.isArray(error)) return undefined;
  return error.message;
}

function commandStatus(status: string | undefined, exit: JsonValue | undefined): "completed" | "failed" | "rejected" {
  if (status === "declined" || status === "rejected") return "rejected";
  if (exit === 0 || (exit === undefined && status !== "failed" && status !== "error")) return "completed";
  return "failed";
}

const OutputStatus = Schema.Struct({
  exit_code: field(Schema.Number),
  exitCode: field(Schema.Number),
  metadata: field(Schema.Struct({ exit_code: field(Schema.Number) })),
});
const decodeOutputStatus = Schema.decodeUnknownOption(OutputStatus);

function interpretOutput(
  rawOut: JsonValue | undefined,
  data: Event,
): { readonly output: JsonValue; readonly status: "completed" | "failed" | "rejected" } {
  if (data.success === false || data.error) return { output: rawOut ?? null, status: "failed" };
  const status = data.status ?? data.item?.status;
  if (status === "failed" || status === "error") return { output: rawOut ?? null, status: "failed" };
  if (status === "rejected" || status === "declined") return { output: rawOut ?? null, status: "rejected" };
  const parsed = rawOut === undefined ? null : coerceArgs(rawOut);
  const decoded = decodeOutputStatus(parsed);
  if (decoded._tag === "Some") {
    const exit = decoded.value.exit_code ?? decoded.value.exitCode ?? decoded.value.metadata?.exit_code;
    if (exit !== undefined) return { output: parsed, status: exit === 0 ? "completed" : "failed" };
  }
  return { output: parsed, status: "completed" };
}

export function parseCodexTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  const usage: Usage = {};
  const unrecognizedEvents: Record<string, number> = Object.create(null);
  let compactions = 0;
  let parseSuccess = true;
  const startedCallIds = new Set<string>();
  const pendingCallIds: string[] = [];
  let synth = 0;
  const nextSynthId = (prefix: string): string => `${prefix}_${++synth}`;
  const emitCall = (
    callId: string,
    name: string,
    input: JsonValue,
    tool: ToolName,
    command: CommandProjection,
  ): void => {
    startedCallIds.add(callId);
    events.push({
      type: "operation.started",
      operationId: callId,
      operation: { kind: "tool", name, input, tool, command },
    });
  };
  const emitResult = (
    callId: string,
    output: JsonValue | undefined,
    status: "completed" | "failed" | "rejected",
  ): void => {
    events.push({ type: "operation.finished", operationId: callId, kind: "tool", output, status });
  };
  const handleItem = (item: CodexItem, completed: boolean): void => {
    const baseId = item.id === undefined ? "" : String(item.id);
    switch (item.type) {
      case "reasoning":
      case "thinking": {
        if (!completed) return;
        const text = extractReasoning(item);
        if (text) events.push({ type: "thinking", text });
        return;
      }
      case "agent_message":
      case "assistant_message":
      case "message": {
        if (!completed) return;
        const text = extractText(item.text ?? item.content ?? item.message);
        if (text) events.push({ type: "message", role: "assistant", text });
        return;
      }
      case "command_execution":
      case "local_shell_call": {
        const callId = baseId || nextSynthId("cmd");
        const command = item.command ?? item.action?.command;
        if (!completed || !startedCallIds.has(callId)) {
          emitCall(
            callId,
            "command_execution",
            command === undefined ? {} : { command },
            "shell",
            opaqueCommandProjection("unsupported-protocol"),
          );
        }
        if (!completed) return;
        const exit = item.exit_code ?? item.exitCode;
        const output = item.aggregated_output ?? item.aggregatedOutput ?? item.output;
        const result =
          output === undefined && exit === undefined ? undefined : { output: output ?? null, exit_code: exit ?? null };
        emitResult(callId, result, commandStatus(item.status, exit));
        return;
      }
      case "mcp_tool_call": {
        const callId = baseId || nextSynthId("mcp");
        const tool = item.tool ?? item.name ?? "unknown";
        const name = item.server === undefined ? String(tool) : `${item.server}.${String(tool)}`;
        if (!completed || !startedCallIds.has(callId))
          emitCall(
            callId,
            name,
            coerceArgs(item.arguments ?? item.input),
            normalizeShared(String(tool), CODEX_TOOL_ALIASES),
            notCommandProjection(),
          );
        if (completed)
          emitResult(callId, item.result ?? null, !item.error && item.status !== "failed" ? "completed" : "failed");
        return;
      }
      case "web_search": {
        const callId = baseId || nextSynthId("web");
        const query = item.query ?? item.search;
        if (!completed || !startedCallIds.has(callId))
          emitCall(callId, "web_search", query === undefined ? {} : { query }, "web_search", notCommandProjection());
        if (completed) emitResult(callId, item.results ?? item.result ?? null, "completed");
        return;
      }
      case "file_change":
      case "patch":
      case "file_patch": {
        if (!completed) return;
        const changes = item.changes ?? [{ path: item.path, file: undefined, kind: undefined, type: undefined }];
        const status = commandStatus(item.status, undefined);
        changes.forEach((change, index) => {
          const path = change.path ?? change.file;
          const reportedKind = typeof change.kind === "string" ? change.kind : change.kind?.type;
          const kind = (reportedKind ?? change.type ?? item.kind ?? "update").toLowerCase();
          const tool: ToolName = kind === "add" || kind === "delete" ? "file_write" : "file_edit";
          const callId = `${baseId || "patch"}#${index}`;
          const input = path === undefined ? { kind } : { path, kind };
          emitCall(callId, "file_change", input, tool, notCommandProjection());
          emitResult(callId, input, status);
        });
        return;
      }
      case "error":
        events.push({ type: "error", message: String(item.message ?? item.text ?? "error") });
        return;
      case "todo_list":
      case "compaction":
        return;
      default:
        return assertNever(item);
    }
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
    const data = decoded.value;
    const reported = data.usage ?? data.payload?.usage ?? data.item?.usage ?? data.turn?.usage ?? data.response?.usage;
    if (reported !== undefined) addUsage(usage, normalizeUsage("codex", reported));
    if (
      [data.type, data.item?.type, data.subtype].some(
        (type) => type !== undefined && /compact|context_truncat/i.test(type),
      )
    ) {
      events.push({ type: "compaction" });
      compactions += 1;
      continue;
    }
    switch (data.type) {
      case "thread.started":
      case "thread.completed":
      case "turn.started":
      case "response.created":
      case "response.completed":
      case "response.cancelled":
      case "item.updated":
      case "output_text.delta":
      case "output_text.done":
        break;
      case "turn.completed":
        if (data.turn?.status === "failed")
          events.push({ type: "error", message: String(data.turn.error?.message ?? data.message ?? "turn failed") });
        break;
      case "turn.failed":
      case "response.failed":
        events.push({ type: "error", message: String(errorMessage(data.error) ?? data.message ?? "turn failed") });
        break;
      case "item.started":
      case "item.completed":
        if (data.item !== undefined) handleItem(data.item, data.type === "item.completed");
        break;
      case "message":
      case "chat": {
        const role = data.role ?? (data.from === "assistant" ? "assistant" : "user");
        const text = extractText(data.content ?? data.text ?? data.message);
        if (text) events.push({ type: "message", role: role === "user" ? "user" : "assistant", text });
        break;
      }
      case "reasoning":
      case "thinking":
      case "thought": {
        const text = extractReasoning(data);
        if (text) events.push({ type: "thinking", text });
        break;
      }
      case "function_call":
      case "tool_call":
      case "tool_use":
      case "custom_tool_call":
      case "action":
      case "local_shell_call": {
        const shell = data.type === "local_shell_call";
        const name = shell
          ? "shell"
          : String(data.name ?? data.function?.name ?? data.tool ?? data.action ?? "unknown");
        const args = shell
          ? (data.action ?? data.input)
          : (data.function?.arguments ?? data.arguments ?? data.input ?? data.params);
        const explicit = data.call_id ?? data.id ?? data.tool_call_id;
        const callId = explicit === undefined ? nextSynthId("call") : String(explicit);
        if (explicit === undefined) pendingCallIds.push(callId);
        emitCall(
          callId,
          name,
          coerceArgs(args),
          normalizeShared(name, CODEX_TOOL_ALIASES),
          shell ? opaqueCommandProjection("unsupported-protocol") : notCommandProjection(),
        );
        break;
      }
      case "function_call_output":
      case "tool_result":
      case "tool_response":
      case "action_result":
      case "local_shell_call_output": {
        const explicit = data.call_id ?? data.tool_call_id ?? data.id;
        const callId = explicit === undefined ? (pendingCallIds.shift() ?? nextSynthId("result")) : String(explicit);
        const output = data.output ?? data.result ?? data.content;
        const result = interpretOutput(output, data);
        emitResult(callId, result.output, result.status);
        break;
      }
      case "error":
        events.push({
          type: "error",
          message: String(errorMessage(data.error) ?? data.message ?? data.content ?? "error"),
        });
        break;
      case "compaction":
      case "compact":
      case "context_compacted":
      case "context_truncated":
        break;
      default:
        assertNever(data);
    }
  }
  return { events, usage: transcriptUsage("codex", usage), compactions, parseSuccess, unrecognizedEvents };
}

export function parseCodex(raw: string | undefined): StreamEvent[] {
  return parseCodexTranscript(raw).events;
}
