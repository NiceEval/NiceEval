// Bub transcript 解析器,同时充当「通用 JSONL」兜底解析器。
// Bub 的 tape 格式($BUB_HOME/tapes/<session>.jsonl)有两套:
//   - legacy { type:"message"|"tool_call"|"tool_result"|"error", ... };
//   - tape   { kind:"message"|"tool_call"|"tool_result"|"event", payload:{...} }。
// 格式本身不完全确定,所以这里走尽力而为:认常见字段(role/content/text;tool/name+args;usage)。
// compaction 在 bub 不可观测,固定 compactions=0。

import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";

// ───────────────────────── 工具名归一 ─────────────────────────

function normalizeToolName(name: string): ToolName {
  const toolMap: Record<string, ToolName> = {
    "fs.read": "file_read",
    fs_read: "file_read",
    read_file: "file_read",
    read: "file_read",
    "fs.write": "file_write",
    fs_write: "file_write",
    write_file: "file_write",
    write: "file_write",
    create_file: "file_write",
    "fs.edit": "file_edit",
    fs_edit: "file_edit",
    edit_file: "file_edit",
    edit: "file_edit",
    apply_patch: "file_edit",
    bash: "shell",
    shell: "shell",
    exec: "shell",
    command_execution: "shell",
    "web.fetch": "web_fetch",
    web_fetch: "web_fetch",
    fetch: "web_fetch",
    curl: "web_fetch",
    "web.search": "web_search",
    web_search: "web_search",
    glob: "glob",
    grep: "grep",
    ls: "list_dir",
    list_dir: "list_dir",
    task: "agent_task",
    update_todos: "agent_task",
  };
  return toolMap[name] || toolMap[name.toLowerCase()] || "unknown";
}

// ───────────────────────── 小工具 ─────────────────────────

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

function coerceArgs(value: unknown): JsonValue {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      return value;
    }
  }
  return (value ?? {}) as JsonValue;
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

function readUsage(u: unknown): { input: number; output: number; cacheRead: number } | null {
  if (!u || typeof u !== "object") return null;
  const o = u as Record<string, unknown>;
  const num = (...keys: string[]): number => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return 0;
  };
  const input = num("input_tokens", "prompt_tokens", "inputTokens");
  const output = num("output_tokens", "completion_tokens", "outputTokens");
  const cacheRead = num("cached_input_tokens", "cache_read_input_tokens", "cacheReadTokens");
  if (input === 0 && output === 0 && cacheRead === 0) return null;
  return { input, output, cacheRead };
}

// ───────────────────────── 主解析 ─────────────────────────

export function parseBubTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let requests = 0;
  let parseSuccess = true;

  if (!raw || !raw.trim()) {
    return { events, usage: { inputTokens: 0, outputTokens: 0 }, compactions: 0, parseSuccess: true };
  }

  // 无显式 id 时的 FIFO 兜底配对。
  const pendingCallIds: string[] = [];
  let synth = 0;
  const nextSynthId = (): string => `bub_${++synth}`;

  const addUsageFrom = (entry: unknown): void => {
    const u = readUsage(get(entry, "usage") ?? get(get(entry, "payload"), "usage"));
    if (!u) return;
    inputTokens += u.input;
    outputTokens += u.output;
    cacheReadTokens += u.cacheRead;
    requests += 1;
  };

  const emitCall = (originalName: string, input: JsonValue, explicitId: unknown): void => {
    const callId = explicitId != null ? String(explicitId) : nextSynthId();
    if (explicitId == null) pendingCallIds.push(callId);
    events.push({
      type: "action.called",
      callId,
      name: originalName,
      input,
      tool: normalizeToolName(originalName),
    });
  };

  const emitResult = (output: unknown, success: boolean, explicitId: unknown): void => {
    const callId =
      explicitId != null ? String(explicitId) : pendingCallIds.shift() ?? nextSynthId();
    events.push({
      type: "action.result",
      callId,
      output: (output ?? null) as JsonValue,
      status: success ? "completed" : "failed",
    });
  };

  const lines = raw.split("\n");
  for (const line of lines) {
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
      addUsageFrom(entry);

      const type = get(entry, "type");
      const kind = get(entry, "kind");

      // ── legacy: 顶层 type ──
      if (typeof type === "string") {
        if (type === "message") {
          const role = get(entry, "role") === "user" ? "user" : "assistant";
          const text = extractText(get(entry, "content") ?? get(entry, "text"));
          if (text) events.push({ type: "message", role, text });
        } else if (type === "tool_call") {
          const name = String(get(entry, "tool_name") ?? get(entry, "name") ?? get(entry, "tool") ?? "unknown");
          emitCall(name, coerceArgs(get(entry, "args") ?? get(entry, "input")), get(entry, "call_id") ?? get(entry, "id"));
        } else if (type === "tool_result") {
          emitResult(
            get(entry, "result") ?? get(entry, "output") ?? get(entry, "content"),
            get(entry, "success") !== false && !get(entry, "error"),
            get(entry, "call_id") ?? get(entry, "tool_call_id") ?? get(entry, "id"),
          );
        } else if (type === "thinking" || type === "reasoning") {
          const text = extractText(get(entry, "content") ?? get(entry, "text"));
          if (text) events.push({ type: "thinking", text });
        } else if (type === "error") {
          const msg = get(entry, "message") ?? get(entry, "error") ?? "error";
          events.push({ type: "error", message: String(msg) });
        }
        continue;
      }

      // ── tape: kind + payload ──
      if (typeof kind === "string") {
        const payload = get(entry, "payload");
        if (kind === "message") {
          const role = get(payload, "role") === "user" ? "user" : "assistant";
          const text = extractText(get(payload, "content") ?? get(payload, "text"));
          if (text) events.push({ type: "message", role, text });
        } else if (kind === "tool_call") {
          const calls = get(payload, "calls");
          const list = Array.isArray(calls) ? calls : [payload];
          for (const call of list) {
            const fn = get(call, "function") ?? call;
            const name = String(get(fn, "name") ?? get(call, "name") ?? "unknown");
            emitCall(name, coerceArgs(get(fn, "arguments") ?? get(call, "args") ?? get(call, "input")), get(call, "id") ?? get(call, "call_id"));
          }
        } else if (kind === "tool_result") {
          const results = get(payload, "results");
          const list = Array.isArray(results) ? results : [get(payload, "result") ?? payload];
          for (const r of list) {
            const isError = typeof r === "object" && r !== null && "error" in (r as Record<string, unknown>);
            emitResult(get(r, "output") ?? get(r, "result") ?? get(r, "content") ?? r, !isError, get(r, "tool_call_id") ?? get(r, "id"));
          }
        } else if (kind === "event") {
          const data = get(payload, "data");
          const status = get(data, "status");
          if (typeof status === "string" && status !== "ok") {
            const err = get(data, "error");
            events.push({
              type: "error",
              message: typeof err === "string" ? err : `${String(get(payload, "name"))}: ${status}`,
            });
          }
        }
        continue;
      }

      // ── 通用兜底:既无 type 也无 kind,认常见字段 ──
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

  const usage: Usage = { inputTokens, outputTokens };
  if (cacheReadTokens > 0) usage.cacheReadTokens = cacheReadTokens;
  if (requests > 0) usage.requests = requests;

  // bub 不可观测压缩,固定 0。
  return { events, usage, compactions: 0, parseSuccess };
}

/** 便捷形态:只要 StreamEvent[]。 */
export function parseBub(raw: string | undefined): StreamEvent[] {
  return parseBubTranscript(raw).events;
}
