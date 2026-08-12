// Bub(republic tape)transcript 解析器,同时充当「通用 JSONL」兜底解析器。
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
// 也保留 legacy {type:...} 与无 type/kind 的通用兜底。

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
      if (typeof b === "string") parts.push(b);
      else {
        const t = get(b, "text") ?? get(b, "content");
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
  let requests = 0;
  let compactions = 0;
  let parseSuccess = true;

  if (!raw || !raw.trim()) {
    return { events, usage: {}, compactions: 0, parseSuccess: true };
  }

  // tape 的 tool_result 与上一条 tool_call 按位对齐;记下上一批 callId。
  let lastCallIds: string[] = [];
  // 无显式 id 的兜底配对。
  const pendingCallIds: string[] = [];
  let synth = 0;
  const nextSynthId = (): string => `bub_${++synth}`;

  // 从 event/run 的 data.usage(或 legacy 顶层 usage)累加用量。
  const addUsage = (usage: unknown): void => {
    if (!usage || typeof usage !== "object") return;
    const rawInput = num(usage, "input_tokens", "prompt_tokens", "inputTokens");
    const output = num(usage, "output_tokens", "completion_tokens", "outputTokens");
    let cache = num(usage, "cached_input_tokens", "cache_read_input_tokens", "cacheReadTokens");
    if (cache === 0) cache = num(get(usage, "prompt_tokens_details"), "cached_tokens");
    const cost = num(usage, "cost");
    if (rawInput === 0 && output === 0 && cache === 0 && cost === 0) return;
    // Chat Completions 口径的 prompt_tokens 含缓存命中,cached_tokens 是其子集;
    // 落互斥桶前扣掉(docs/feature/adapters/sdk/bub/cost.md)
    const input = Math.max(0, rawInput - cache);
    inputTokens += input;
    outputTokens += output;
    cacheReadTokens += cache;
    costUSD += cost;
    requests += 1;
  };

  const emitCall = (originalName: string, input: JsonValue, explicitId: unknown): string => {
    const callId = explicitId != null ? String(explicitId) : nextSynthId();
    if (explicitId == null) pendingCallIds.push(callId);
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

  const emitResult = (output: unknown, success: boolean, explicitId: unknown): void => {
    const callId = explicitId != null ? String(explicitId) : pendingCallIds.shift() ?? nextSynthId();
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

      // ── legacy: 顶层 type ──
      if (typeof type === "string") {
        addUsage(get(entry, "usage"));
        if (type === "message") {
          const role = get(entry, "role") === "user" ? "user" : "assistant";
          const text = extractText(get(entry, "content") ?? get(entry, "text"));
          if (text) events.push({ type: "message", role, text });
        } else if (type === "tool_call") {
          const name = String(get(entry, "tool_name") ?? get(entry, "name") ?? get(entry, "tool") ?? "unknown");
          emitCall(name, coerceArgs(get(entry, "args") ?? get(entry, "input")), get(entry, "call_id") ?? get(entry, "id"));
        } else if (type === "tool_result") {
          emitResult(get(entry, "result") ?? get(entry, "output") ?? get(entry, "content"), get(entry, "success") !== false && !get(entry, "error"), get(entry, "call_id") ?? get(entry, "tool_call_id") ?? get(entry, "id"));
        } else if (type === "thinking" || type === "reasoning") {
          const text = extractText(get(entry, "content") ?? get(entry, "text"));
          if (text) events.push({ type: "thinking", text });
        } else if (type === "error") {
          events.push({ type: "error", message: String(get(entry, "message") ?? get(entry, "error") ?? "error") });
        }
        continue;
      }

      // ── republic tape: kind + payload ──
      if (typeof kind === "string") {
        const payload = get(entry, "payload");
        if (kind === "message") {
          const role = get(payload, "role") === "user" ? "user" : "assistant";
          const text = extractText(get(payload, "content") ?? get(payload, "text"));
          if (text) events.push({ type: "message", role, text });
        } else if (kind === "tool_call") {
          // 模型「先说话再调工具」:伴随文本记在 tool_call 的 payload.content 上
          // (bub 不给它单独的 message 条目)。先还原成 assistant message,再吐 calls,
          // 否则 transcript 里每次 send 后面都看不到 AI 回复。
          const accompanying = extractText(get(payload, "content"));
          if (accompanying) events.push({ type: "message", role: "assistant", text: accompanying });
          const calls = get(payload, "calls");
          const list = Array.isArray(calls) ? calls : [payload];
          lastCallIds = [];
          for (const call of list) {
            const fn = get(call, "function") ?? call;
            const name = String(get(fn, "name") ?? get(call, "name") ?? "unknown");
            const id = emitCall(name, coerceArgs(get(fn, "arguments") ?? get(call, "args") ?? get(call, "input")), get(call, "id") ?? get(call, "call_id"));
            lastCallIds.push(id);
          }
        } else if (kind === "tool_result") {
          const results = get(payload, "results");
          const list = Array.isArray(results) ? results : [get(payload, "result") ?? payload];
          // republic:results 与上一条 tool_call.calls 按位对齐。
          list.forEach((r, i) => {
            const isError = typeof r === "object" && r !== null && "error" in (r as globalThis.Record<string, unknown>);
            const explicitId = get(r, "tool_call_id") ?? get(r, "id") ?? lastCallIds[i];
            emitResult(get(r, "output") ?? get(r, "result") ?? get(r, "content") ?? r, !isError, explicitId);
          });
        } else if (kind === "event") {
          const data = get(payload, "data");
          // 用量:run 事件首选 data.usage;但新版 bub.tape 不一定每轮都发 run/usage,
          // 所以任何 event 上挂的 usage 也兜底累加(addUsage 自带去重式全零跳过)。
          addUsage(get(data, "usage"));
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
          events.push({ type: "error", message: String(get(payload, "message") ?? get(payload, "kind") ?? "error") });
        }
        continue;
      }

      // ── 通用兜底:既无 type 也无 kind ──
      addUsage(get(entry, "usage"));
      const role = get(entry, "role");
      const name = get(entry, "tool") ?? get(entry, "name");
      if (role === "assistant" || role === "user") {
        const text = extractText(get(entry, "content") ?? get(entry, "text"));
        if (text) events.push({ type: "message", role, text });
      } else if (typeof name === "string") {
        if (get(entry, "result") !== undefined || get(entry, "output") !== undefined) {
          emitResult(get(entry, "result") ?? get(entry, "output"), !get(entry, "error"), get(entry, "call_id") ?? get(entry, "id"));
        } else {
          emitCall(name, coerceArgs(get(entry, "args") ?? get(entry, "arguments") ?? get(entry, "input")), get(entry, "call_id") ?? get(entry, "id"));
        }
      }
    } catch {
      parseSuccess = false;
    }
  }

  // requests > 0 意味着至少一次 addUsage 真的读到了非零字段;整份 tape 没有任何 usage 时
  // input/output 也不该垫成 0(见 docs/feature/record/architecture.md#usage)。
  const usage: Usage = requests > 0 ? { inputTokens, outputTokens } : {};
  if (cacheReadTokens > 0) usage.cacheReadTokens = cacheReadTokens;
  if (requests > 0) usage.requests = requests;
  if (costUSD > 0) usage.costUSD = costUSD;

  return { events, usage, compactions, parseSuccess };
}

/** 便捷形态:只要 StreamEvent[]。 */
export function parseBub(raw: string | undefined): StreamEvent[] {
  return parseBubTranscript(raw).events;
}
