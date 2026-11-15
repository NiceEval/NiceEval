// Claude Code transcript JSONL: decode message and content unions at entry.
import * as Schema from "effect/Schema";
import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";
import { normalizeToolName as normalizeShared } from "../tool-names.ts";
import { notCommandProjection, opaqueCommandProjection } from "../command-projection.ts";
import { assertNever, field, lineDecoder, unrecognized, UnknownPart } from "./shared.ts";
import { addUsage, normalizeUsage, TokenUsage, transcriptUsage } from "./usage.ts";

export const CLAUDE_TOOL_ALIASES: globalThis.Record<string, ToolName> = {
  read: "file_read",
  readfile: "file_read",
  write: "file_write",
  writefile: "file_write",
  write_to_file: "file_write",
  edit: "file_edit",
  multiedit: "file_edit",
  editfile: "file_edit",
  strreplace: "file_edit",
  notebookedit: "file_edit",
  bashoutput: "shell",
  webfetch: "web_fetch",
  mcp__fetch__fetch: "web_fetch",
  websearch: "web_search",
  ls: "list_dir",
  listdir: "list_dir",
  task: "agent_task",
};

const json = field(Schema.MutableJson);
const string = field(Schema.String);
const ResultFields = {
  tool_use_id: json,
  id: json,
  is_error: field(Schema.Boolean),
  error: json,
  content: json,
  output: json,
  result: json,
};
const Block = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("thinking"), thinking: string, text: string }),
  Schema.Struct({ type: Schema.Literal("tool_use"), name: string, id: json, input: json }),
  Schema.Struct({ type: Schema.Literal("tool_result"), ...ResultFields }),
  UnknownPart,
]);
const Content = Schema.Union([Schema.String, Schema.Array(Block)]);
const Message = Schema.Struct({
  content: field(Content),
  usage: field(TokenUsage),
  isCompactSummary: field(Schema.Boolean),
});
const messageFields = {
  role: string,
  content: field(Content),
  message: field(Message),
  text: string,
  usage: field(TokenUsage),
  isCompactSummary: field(Schema.Boolean),
  subtype: string,
};
const ClaudeEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["user", "assistant"]), ...messageFields }),
  Schema.Struct({ type: Schema.Literals(["tool_result", "tool_response"]), ...ResultFields }),
  Schema.Struct({ type: Schema.Literals(["system", "summary"]), ...messageFields }),
  Schema.Struct({ type: Schema.Literal("error"), error: json, message: json }),
]);
const decodeLine = lineDecoder(ClaudeEvent);
const SchemaResult = Schema.Struct(ResultFields);
type MessageEvent = Extract<typeof ClaudeEvent.Type, { type: "user" | "assistant" }>;

function blocksOf(event: MessageEvent): readonly (typeof Block.Type)[] {
  if (Array.isArray(event.content)) return event.content;
  if (Array.isArray(event.message?.content)) return event.message.content;
  return [];
}

function extractText(event: MessageEvent, blocks: readonly (typeof Block.Type)[]): string {
  let content: string | undefined;
  if (typeof event.content === "string") content = event.content;
  else if (typeof event.message?.content === "string") content = event.message.content;
  if (content) return content;
  const texts = blocks.flatMap((block) => (block.type === "text" ? [block.text] : []));
  if (texts.length > 0) return texts.join("\n");
  return event.text ?? "";
}

function skillName(name: string, input: JsonValue): string | undefined {
  if (name.toLowerCase() !== "skill" || input === null || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const skill = input.skill;
  return typeof skill === "string" && skill ? skill : undefined;
}

function errorMessage(error: JsonValue | undefined): JsonValue | undefined {
  if (error === undefined || error === null || typeof error !== "object" || Array.isArray(error)) return undefined;
  return error.message;
}

export function parseClaudeCodeTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  const usage: Usage = {};
  const unrecognizedEvents: Record<string, number> = Object.create(null);
  const skillCallIds = new Set<string>();
  let compactions = 0;
  let parseSuccess = true;
  const emitResult = (result: typeof SchemaResult.Type, output: JsonValue | undefined): void => {
    const callId = String(result.tool_use_id ?? result.id ?? "unknown");
    if (skillCallIds.has(callId)) return;
    events.push({
      type: "operation.finished",
      operationId: callId,
      kind: "tool",
      output: output ?? null,
      status: result.is_error === true || !!result.error ? "failed" : "completed",
    });
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
    switch (data.type) {
      case "summary":
        compactions += 1;
        events.push({ type: "compaction" });
        break;
      case "system":
        if (data.isCompactSummary || data.message?.isCompactSummary || data.subtype === "compact_boundary") {
          compactions += 1;
          events.push({ type: "compaction" });
        }
        break;
      case "user":
      case "assistant": {
        if (data.isCompactSummary || data.message?.isCompactSummary || data.subtype === "compact_boundary") {
          compactions += 1;
          events.push({ type: "compaction" });
          break;
        }
        const reported = data.message?.usage ?? data.usage;
        if (reported !== undefined) addUsage(usage, normalizeUsage("claude-code", reported));
        const blocks = blocksOf(data);
        const role = data.type === "user" || data.role === "user" ? "user" : "assistant";
        const results = blocks.filter((block) => block.type === "tool_result");
        if (role === "user" && results.length > 0) {
          for (const result of results) emitResult(result, result.content);
        } else {
          const text = extractText(data, blocks);
          if (text) events.push({ type: "message", role, text });
        }
        if (role === "user") break;
        const thoughts = blocks.flatMap((block) => {
          if (block.type !== "thinking") return [];
          const text = block.thinking ?? block.text;
          return text === undefined ? [] : [text];
        });
        const thinking = thoughts.join("\n");
        if (thinking) events.push({ type: "thinking", text: thinking });
        for (const block of blocks) {
          switch (block.type) {
            case "tool_use": {
              const name = block.name ?? "unknown";
              const callId = String(block.id ?? "unknown");
              const input = block.input ?? {};
              const skill = skillName(name, input);
              if (skill !== undefined) {
                events.push({ type: "skill.loaded", skill, operationId: callId });
                skillCallIds.add(callId);
                break;
              }
              events.push({
                type: "operation.started",
                operationId: callId,
                operation: {
                  kind: "tool",
                  name,
                  input,
                  tool: normalizeShared(name, CLAUDE_TOOL_ALIASES),
                  command:
                    name.toLowerCase() === "bash"
                      ? opaqueCommandProjection("unsupported-protocol")
                      : notCommandProjection(),
                },
              });
              break;
            }
            case "text":
            case "thinking":
            case "tool_result":
              break;
            case "<unrecognized>":
              unrecognized(unrecognizedEvents, `part:${block.originalType ?? "<missing-kind>"}`);
              break;
            default:
              assertNever(block);
          }
        }
        break;
      }
      case "tool_result":
      case "tool_response":
        emitResult(data, data.content ?? data.output ?? data.result);
        break;
      case "error":
        events.push({ type: "error", message: String(errorMessage(data.error) ?? data.message ?? "error") });
        break;
      default:
        assertNever(data);
    }
  }
  return { events, usage: transcriptUsage("claude-code", usage), compactions, parseSuccess, unrecognizedEvents };
}

export function parseClaudeCode(raw: string | undefined): StreamEvent[] {
  return parseClaudeCodeTranscript(raw).events;
}
