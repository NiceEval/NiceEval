// Bub 0.5.1 tape transcript 解析器。
//
// 真实 tape 格式(~/.bub/tapes/<md5(ws)__md5(sess)>.jsonl,按 id 升序逐行):
//   - kind=message      payload={role, content}                 → 对话
//   - kind=tool_call    payload={calls:[{id,function:{name,arguments}}]}
//   - kind=tool_result  payload={results:[...]}                  ← 与上一条 tool_call.calls 按位对齐
//   - kind=event        payload={name, data}                     name=="run" → data.usage 是该次模型调用用量
//   - kind=anchor       payload={name, state:{summary?}}         name!="session/start" = tape.handoff(压缩检查点)
//   - kind=system/error
// 用量路径(已对真实 tape 校验):payload.data.usage.{prompt_tokens,completion_tokens,total_tokens,
//   prompt_tokens_details.cached_tokens, cost}。compaction = 非 bootstrap 的 anchor(handoff)条数。
// 只读取固定版本的 kind + payload 协议。

import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";
import { GENERIC_VERB_ALIASES, normalizeToolName as normalizeShared } from "../tool-names.ts";
import * as Schema from "effect/Schema";
import { notCommandProjection, opaqueCommandProjection } from "../command-projection.ts";
import { assertNever, coerceArgs, field, jsonField, lineDecoder, unrecognized } from "./shared.ts";
import { addUsage, normalizeUsage, TokenUsage, transcriptUsage } from "./usage.ts";

/** Bub 特有别名(fs.* / web.* 命名空间与裸 read/write/edit)+ 裸动词;通用别名走基表。 */
export const BUB_TOOL_ALIASES: globalThis.Record<string, ToolName> = {
  ...GENERIC_VERB_ALIASES,
  "fs.read": "file_read",
  fs_read: "file_read",
  read: "file_read",
  "fs.write": "file_write",
  fs_write: "file_write",
  write: "file_write",
  "fs.edit": "file_edit",
  fs_edit: "file_edit",
  edit: "file_edit",
  "web.fetch": "web_fetch",
  "web.search": "web_search",
  update_todos: "agent_task",
};

function normalizeToolName(name: string): ToolName {
  return normalizeShared(name, BUB_TOOL_ALIASES);
}

/** Bub tape 的 `bash` 是原生 shell action；tape 只保留 source，不能证明 argv。 */
function commandProjectionForBubTool(name: string) {
  return name.toLowerCase() === "bash" ? opaqueCommandProjection("unsupported-protocol") : notCommandProjection();
}

const Content = Schema.Union([
  Schema.String,
  Schema.Array(Schema.Struct({ type: field(Schema.String), text: field(Schema.String) })),
]);
const TapeEntry = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("message"),
    payload: Schema.Struct({ role: Schema.Literals(["user", "assistant"]), content: field(Content) }),
  }),
  Schema.Struct({
    kind: Schema.Literal("tool_call"),
    payload: Schema.Struct({
      content: field(Content),
      calls: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          function: Schema.Struct({ name: Schema.String, arguments: jsonField }),
        }),
      ),
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("tool_result"),
    payload: Schema.Struct({ results: Schema.Array(Schema.MutableJson) }),
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    payload: Schema.Struct({
      name: field(Schema.String),
      data: field(
        Schema.Struct({ usage: field(TokenUsage), error: field(Schema.MutableJson), status: field(Schema.String) }),
      ),
    }),
  }),
  Schema.Struct({ kind: Schema.Literal("anchor"), payload: Schema.Struct({ name: field(Schema.String) }) }),
  Schema.Struct({ kind: Schema.Literal("error"), payload: Schema.Struct({ message: Schema.String }) }),
  Schema.Struct({ kind: Schema.Literal("system") }),
]);
const decodeLine = lineDecoder(TapeEntry, "kind");

function extractText(content: typeof Content.Type | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content.flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : [])).join("\n");
}

export function parseBubTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  const usage: Usage = {};
  let compactions = 0;
  let parseSuccess = true;
  const unrecognizedEvents: Record<string, number> = Object.create(null);
  let lastCallIds: string[] = [];

  const emitCall = (originalName: string, input: JsonValue, callId: string): string => {
    events.push({
      type: "operation.started",
      operationId: callId,
      operation: {
        kind: "tool",
        name: originalName,
        input,
        tool: normalizeToolName(originalName),
        command: commandProjectionForBubTool(originalName),
      },
    });
    return callId;
  };

  const emitResult = (output: JsonValue, success: boolean, callId: string): void => {
    events.push({
      type: "operation.finished",
      operationId: callId,
      kind: "tool",
      output,
      status: success ? "completed" : "failed",
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
      if (["message", "tool_call", "tool_result", "error"].includes(decoded.type)) parseSuccess = false;
      continue;
    }
    const entry = decoded.value;
    switch (entry.kind) {
      case "message": {
        const text = extractText(entry.payload.content);
        if (text) events.push({ type: "message", role: entry.payload.role, text });
        break;
      }
      case "tool_call": {
        const text = extractText(entry.payload.content);
        if (text) events.push({ type: "message", role: "assistant", text });
        lastCallIds = entry.payload.calls.map((call) =>
          emitCall(call.function.name, coerceArgs(call.function.arguments), call.id),
        );
        break;
      }
      case "tool_result":
        entry.payload.results.forEach((result, index) => {
          const callId = lastCallIds[index];
          if (callId === undefined) {
            parseSuccess = false;
            return;
          }
          const failed = result !== null && typeof result === "object" && "error" in result;
          emitResult(result, !failed, callId);
        });
        break;
      case "event": {
        const { name, data } = entry.payload;
        switch (name) {
          case "run":
            if (data?.usage !== undefined) addUsage(usage, normalizeUsage("bub", data.usage));
            break;
          case "handoff":
          case "loop.start":
          case "loop.step.start":
          case "loop.step":
            break;
          default:
            unrecognized(unrecognizedEvents, `event:${name ?? "<missing-name>"}`);
            continue;
        }
        const status = data?.status;
        const error = data?.error;
        const failed =
          (error !== undefined && error !== false && error !== "") ||
          (status !== undefined && /^(error|failed|aborted|cancell?ed|timeout)$/i.test(status));
        if (failed)
          events.push({
            type: "error",
            message: typeof error === "string" && error ? error : `${String(name)}: ${String(status)}`,
          });
        break;
      }
      case "anchor": {
        const name = entry.payload.name;
        if (name && name !== "session/start") {
          compactions += 1;
          events.push({ type: "compaction", reason: name });
        }
        break;
      }
      case "error":
        events.push({ type: "error", message: entry.payload.message });
        break;
      case "system":
        break;
      default:
        assertNever(entry);
    }
  }

  return { events, usage: transcriptUsage("bub", usage), compactions, parseSuccess, unrecognizedEvents };
}

/** 便捷形态:只要 StreamEvent[]。 */
export function parseBub(raw: string | undefined): StreamEvent[] {
  return parseBubTranscript(raw).events;
}
