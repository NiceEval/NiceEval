// Hermes sessions export / state.db 消息行解析器。方言只住这里,不进 core
// (契约见 docs/feature/adapters/sdk/hermes/README.md)。

import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";
import { GENERIC_VERB_ALIASES, normalizeToolName as normalizeShared } from "../tool-names.ts";
import { normalizeJsonValue } from "../../shared/json-value.ts";
import { notCommandProjection, opaqueCommandProjection } from "../command-projection.ts";

export const HERMES_TOOL_ALIASES: globalThis.Record<string, ToolName> = {
  ...GENERIC_VERB_ALIASES,
  terminal: "shell",
  read_file: "file_read",
  write_file: "file_write",
  edit_file: "file_edit",
  web_extract: "web_fetch",
};

function normalizeToolName(name: string): ToolName {
  return normalizeShared(name, HERMES_TOOL_ALIASES);
}

/** Hermes 的 terminal tool 给的是工具 arguments，不是可验证的 native argv。 */
function commandProjectionForHermesTool(name: string) {
  return name.toLowerCase() === "terminal"
    ? opaqueCommandProjection("unsupported-protocol")
    : notCommandProjection();
}

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as globalThis.Record<string, unknown>)[key] : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/**
 * Hermes 以 `skill_view({ name })` 表示实际加载了一个已安装 Skill。它不是普通
 * 文件读取：对应的标准事件是 `skill.loaded`，这样判分和 execution 读面都无需猜工具文本。
 */
function skillNameFromToolCall(name: string, input: JsonValue): string | undefined {
  if (name.toLowerCase() !== "skill_view") return undefined;
  return str(get(input, "name"));
}

function num(obj: unknown, ...keys: string[]): number {
  for (const k of keys) {
    const v = get(obj, k);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

function coerceArgs(value: unknown): JsonValue {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return normalizeJsonValue(parsed, value);
    } catch {
      return value;
    }
  }
  return normalizeJsonValue(value, {});
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Hermes sessions export JSONL(一行一 session,或一行一 message)→ 标准事件 + usage。
 */
export function parseHermesTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let costUSD = 0;
  let requests = 0;
  let parseSuccess = true;
  let synth = 0;
  // `skill_view` 已转成 skill.loaded 后，其 tool result 不再重发成孤立 action 节点。
  const skillCallIds = new Set<string>();
  const nextSynthId = (): string => `hm_${++synth}`;

  if (!raw?.trim()) {
    return { events, usage: {}, compactions: 0, parseSuccess: true };
  }

  const ingestSessionMeta = (obj: globalThis.Record<string, unknown>): void => {
    inputTokens += num(obj, "input_tokens", "inputTokens");
    outputTokens += num(obj, "output_tokens", "outputTokens");
    cacheReadTokens += num(obj, "cache_read_tokens", "cacheReadTokens");
    cacheCreationTokens += num(obj, "cache_write_tokens", "cacheWriteTokens", "cacheCreationTokens");
    const actual = num(obj, "actual_cost_usd", "actualCostUsd");
    const estimated = num(obj, "estimated_cost_usd", "estimatedCostUsd");
    costUSD += actual || estimated;
    const apiCalls = num(obj, "api_call_count", "apiCallCount");
    if (apiCalls) requests += apiCalls;
  };

  const ingestMessage = (msg: globalThis.Record<string, unknown>): void => {
    const role = str(msg.role) ?? "assistant";
    const content = str(msg.content);

    if (role === "tool" || str(msg.tool_call_id) || str(msg.toolCallId)) {
      const callId = str(msg.tool_call_id) ?? str(msg.toolCallId) ?? nextSynthId();
      if (skillCallIds.has(callId)) return;
      const success = msg.is_error !== true && msg.isError !== true;
      events.push({
        type: "operation.finished",
        operationId: callId,
        kind: "tool",
        output: (content ?? get(msg, "output") ?? null) as JsonValue,
        status: success ? "completed" : "failed",
      });
      return;
    }

    const toolCallsRaw = parseJsonField(msg.tool_calls ?? msg.toolCalls);
    if (Array.isArray(toolCallsRaw)) {
      for (const call of toolCallsRaw) {
        const fn = get(call, "function") as globalThis.Record<string, unknown> | undefined;
        const name =
          str(get(fn, "name")) ?? str(get(call, "name")) ?? str(msg.tool_name) ?? "unknown";
        const callId = str(get(call, "id")) ?? nextSynthId();
        const args = coerceArgs(get(fn, "arguments") ?? get(call, "arguments") ?? get(call, "input"));
        const skill = skillNameFromToolCall(name, args);
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
            input: args,
            tool: normalizeToolName(name),
            command: commandProjectionForHermesTool(name),
          },
        });
      }
    }

    if (content?.trim() && role !== "user" && role !== "system") {
      events.push({ type: "message", role: "assistant", text: content });
    } else if (content?.trim() && role === "user" && !Array.isArray(toolCallsRaw)) {
      // 用户消息不进行为断言主路径;保留会污染 messageIncludes。跳过。
    }

    const reasoning = str(msg.reasoning) ?? str(msg.reasoning_content);
    if (reasoning?.trim()) events.push({ type: "thinking", text: reasoning });
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: globalThis.Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as globalThis.Record<string, unknown>;
    } catch {
      parseSuccess = false;
      continue;
    }

    try {
      // 整 session 导出:带 messages[]
      if (Array.isArray(obj.messages)) {
        ingestSessionMeta(obj);
        for (const m of obj.messages) {
          if (m && typeof m === "object") ingestMessage(m as globalThis.Record<string, unknown>);
        }
        continue;
      }
      // 单行 message
      if (str(obj.role)) {
        ingestMessage(obj);
        continue;
      }
      // sqlite dump 行:{session_id, role, content, tool_calls, ...}
      if (str(obj.session_id) || str(obj.sessionId)) {
        ingestMessage(obj);
        continue;
      }
      ingestSessionMeta(obj);
    } catch {
      parseSuccess = false;
    }
  }

  const usage: Usage = {};
  if (inputTokens) usage.inputTokens = inputTokens;
  if (outputTokens) usage.outputTokens = outputTokens;
  if (cacheReadTokens) usage.cacheReadTokens = cacheReadTokens;
  if (cacheCreationTokens) usage.cacheCreationTokens = cacheCreationTokens;
  if (costUSD) usage.costUSD = costUSD;
  if (requests) usage.requests = requests;

  return { events, usage, compactions: 0, parseSuccess };
}

/** 从 export / stdout 文本里抠 session id。 */
export function sessionIdFromHermesOutput(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  for (const line of raw.split("\n")) {
    const resume = line.match(/hermes\s+(?:chat\s+)?(?:--resume|-r)\s+(\S+)/i);
    if (resume?.[1]) return resume[1].replace(/["'`]/g, "");
    const labeled = line.match(/Session:\s*([A-Za-z0-9_-]+)/i);
    if (labeled?.[1]) return labeled[1];
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed) as globalThis.Record<string, unknown>;
      const id = str(obj.id) ?? str(obj.session_id) ?? str(obj.sessionId);
      if (id && (Array.isArray(obj.messages) || str(obj.source))) return id;
    } catch {
      // skip
    }
  }
  return undefined;
}
