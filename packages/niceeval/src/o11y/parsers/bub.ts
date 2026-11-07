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
import { normalizeJsonValue } from "../../shared/json-value.ts";
import { notCommandProjection, opaqueCommandProjection } from "../command-projection.ts";

/** Bub 特有别名(fs.* / web.* 命名空间与裸 read/write/edit)+ 裸动词;通用别名走基表。 */
export const BUB_TOOL_ALIASES: globalThis.Record<string, ToolName> = {
  ...GENERIC_VERB_ALIASES,
  "fs.read": "file_read", fs_read: "file_read", read: "file_read",
  "fs.write": "file_write", fs_write: "file_write", write: "file_write",
  "fs.edit": "file_edit", fs_edit: "file_edit", edit: "file_edit",
  "web.fetch": "web_fetch",
  "web.search": "web_search",
  update_todos: "agent_task",
};

function normalizeToolName(name: string): ToolName {
  return normalizeShared(name, BUB_TOOL_ALIASES);
}

/** Bub tape 的 `bash` 是原生 shell action；tape 只保留 source，不能证明 argv。 */
function commandProjectionForBubTool(name: string) {
  return name.toLowerCase() === "bash"
    ? opaqueCommandProjection("unsupported-protocol")
    : notCommandProjection();
}

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as globalThis.Record<string, unknown>)[key] : undefined;
}

function num(obj: unknown, ...keys: string[]): number {
  for (const k of keys) {
    const v = get(obj, k);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

function optionalNum(obj: unknown, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = get(obj, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
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

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (get(b, "type") === "text") {
        const t = get(b, "text");
        if (typeof t === "string") parts.push(t);
      }
    }
    return parts.join("\n");
  }
  return "";
}

export function parseBubTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let costUSD = 0;
  let hasObservedCostUSD = false;
  let requests = 0;
  let compactions = 0;
  let parseSuccess = true;
  const unrecognizedEvents: Record<string, number> = Object.create(null);
  const unrecognized = (type: string): void => {
    unrecognizedEvents[type] = (unrecognizedEvents[type] ?? 0) + 1;
  };

  if (!raw || !raw.trim()) {
    return { events, usage: {}, compactions: 0, parseSuccess: true };
  }

  // tape 的 tool_result 与上一条 tool_call 按位对齐;记下上一批 callId。
  let lastCallIds: (string | undefined)[] = [];

  // 从 event/run 的 data.usage 累加用量。
  const addUsage = (usage: unknown): void => {
    if (!usage || typeof usage !== "object") return;
    const rawInput = num(usage, "prompt_tokens");
    const output = num(usage, "completion_tokens");
    const cache = num(get(usage, "prompt_tokens_details"), "cached_tokens");
    const cost = optionalNum(usage, "cost");
    if (rawInput === 0 && output === 0 && cache === 0 && cost === undefined) return;
    // Chat Completions 口径的 prompt_tokens 含缓存命中,cached_tokens 是其子集;
    // 落互斥桶前扣掉(docs/feature/adapters/library/sdk/bub/cost.md)
    const input = Math.max(0, rawInput - cache);
    inputTokens += input;
    outputTokens += output;
    cacheReadTokens += cache;
    if (cost !== undefined) {
      costUSD += cost;
      hasObservedCostUSD = true;
    }
    requests += 1;
  };

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

  const emitResult = (output: unknown, success: boolean, callId: string): void => {
    events.push({
      type: "operation.finished",
      operationId: callId,
      kind: "tool",
      output: (output ?? null) as JsonValue,
      status: success ? "completed" : "failed",
    });
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      parseSuccess = false;
      continue;
    }

    try {
      const type = get(entry, "type");
      const kind = get(entry, "kind");

      // ── republic tape: kind + payload ──
      if (typeof kind === "string") {
        const payload = get(entry, "payload");
        if (kind === "message") {
          const role = get(payload, "role");
          if (role !== "user" && role !== "assistant") {
            parseSuccess = false;
            continue;
          }
          const text = extractText(get(payload, "content"));
          if (text) events.push({ type: "message", role, text });
        } else if (kind === "tool_call") {
          // 模型「先说话再调工具」:伴随文本记在 tool_call 的 payload.content 上
          // (bub 不给它单独的 message 条目)。先还原成 assistant message,再吐 calls,
          // 否则 transcript 里每次 send 后面都看不到 AI 回复。
          const accompanying = extractText(get(payload, "content"));
          if (accompanying) events.push({ type: "message", role: "assistant", text: accompanying });
          const calls = get(payload, "calls");
          const list = Array.isArray(calls) ? calls : [];
          if (!Array.isArray(calls)) parseSuccess = false;
          lastCallIds = list.map((call) => {
            const fn = get(call, "function");
            const name = get(fn, "name");
            const id = get(call, "id");
            if (typeof name !== "string" || typeof id !== "string") {
              parseSuccess = false;
              return undefined;
            }
            return emitCall(name, coerceArgs(get(fn, "arguments")), id);
          });
        } else if (kind === "tool_result") {
          const results = get(payload, "results");
          const list = Array.isArray(results) ? results : [];
          if (!Array.isArray(results)) parseSuccess = false;
          // republic:results 与上一条 tool_call.calls 按位对齐。
          list.forEach((r, i) => {
            const isError = typeof r === "object" && r !== null && "error" in (r as globalThis.Record<string, unknown>);
            const explicitId = lastCallIds[i];
            if (explicitId === undefined) {
              parseSuccess = false;
              return;
            }
            emitResult(r, !isError, explicitId);
          });
        } else if (kind === "event") {
          const name = get(payload, "name");
          if (typeof name !== "string" || !["run", "handoff", "loop.start", "loop.step.start", "loop.step"].includes(name)) {
            unrecognized(`event:${String(name ?? "<missing-name>")}`);
            continue;
          }
          const data = get(payload, "data");
          if (name === "run") addUsage(get(data, "usage"));
          // 仅在「真失败」时记 error:有 error 字段,或 status 命中失败词。
          // loop.step 这类控制事件 status=="continue"/"running" 不是错误 —— 别再当 error 刷屏。
          const status = get(data, "status");
          const errVal = get(data, "error");
          const failed =
            (errVal != null && errVal !== false && errVal !== "") ||
            (typeof status === "string" && /^(error|failed|aborted|cancell?ed|timeout)$/i.test(status));
          if (failed) {
            events.push({ type: "error", message: typeof errVal === "string" && errVal ? errVal : `${String(get(payload, "name"))}: ${String(status)}` });
          }
        } else if (kind === "anchor") {
          // 非 bootstrap 的 anchor = tape.handoff = 一次压缩检查点(供 t.transcript.compactions() 守卫)。
          const name = String(get(payload, "name") ?? "");
          if (name && name !== "session/start") {
            compactions += 1;
            events.push({ type: "compaction", reason: name });
          }
        } else if (kind === "error") {
          const message = get(payload, "message");
          if (typeof message === "string") events.push({ type: "error", message });
          else parseSuccess = false;
        } else if (kind !== "system") {
          unrecognized(kind);
        }
        continue;
      }

      unrecognized(typeof type === "string" ? `type:${type}` : "<missing-kind>");
    } catch {
      parseSuccess = false;
    }
  }

  // requests > 0 意味着至少一次 addUsage 真的读到了非零字段;整份 tape 没有任何 usage 时
  // input/output 也不该垫成 0(见 docs/feature/record/architecture.md#usage)。
  const usage: Usage = requests > 0 ? { inputTokens, outputTokens } : {};
  if (cacheReadTokens > 0) usage.cacheReadTokens = cacheReadTokens;
  if (requests > 0) usage.requests = requests;
  if (hasObservedCostUSD) usage.costUSD = costUSD;

  return { events, usage, compactions, parseSuccess, unrecognizedEvents };
}

/** 便捷形态:只要 StreamEvent[]。 */
export function parseBub(raw: string | undefined): StreamEvent[] {
  return parseBubTranscript(raw).events;
}
