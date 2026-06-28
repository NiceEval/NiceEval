// OpenAI Codex CLI transcript 解析器(关键路径)。
// 两类输入都吃:
//   1. `codex exec --json` 打到 stdout 的事件 JSONL(thread.* / turn.* / item.* / response.*);
//   2. 磁盘上 session rollout JSONL(ResponseItem:message / function_call / reasoning ...)。
// 唯一硬活:把这堆五花八门的原始事件归一成 fastevals 的 StreamEvent[]。

import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";

// ───────────────────────── 工具名归一 ─────────────────────────

/** Codex 工具名 → 规范 ToolName。 */
function normalizeToolName(name: string): ToolName {
  const toolMap: Record<string, ToolName> = {
    // 文件
    read_file: "file_read",
    write_file: "file_write",
    create_file: "file_write",
    delete_file: "file_write",
    edit_file: "file_edit",
    patch_file: "file_edit",
    apply_patch: "file_edit",
    file_change: "file_edit",
    update_plan: "agent_task",

    // shell
    shell: "shell",
    bash: "shell",
    exec: "shell",
    execute: "shell",
    run: "shell",
    terminal: "shell",
    command_execution: "shell",
    local_shell: "shell",

    // web
    fetch: "web_fetch",
    http_request: "web_fetch",
    curl: "web_fetch",
    web_fetch: "web_fetch",
    web_search: "web_search",
    search: "web_search",

    // 检索 / 导航
    glob: "glob",
    find_files: "glob",
    list_files: "glob",
    grep: "grep",
    search_files: "grep",
    ripgrep: "grep",
    ls: "list_dir",
    list_directory: "list_dir",
    dir: "list_dir",
  };
  return toolMap[name.toLowerCase()] || "unknown";
}

// ───────────────────────── 小工具 ─────────────────────────

/** 宽松取一个对象字段(原始 JSON 是 any,这里只做存在性收口)。 */
function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

/** 字符串则尝试 JSON.parse,失败原样返回;对象原样返回。 */
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

/** 从 content(string | block[])里抠出纯文本。 */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
        continue;
      }
      const t = get(block, "text") ?? get(block, "content") ?? get(block, "thinking");
      if (typeof t === "string") parts.push(t);
    }
    return parts.join("\n");
  }
  return "";
}

/** 从 reasoning item 抠文本(text / content / summary[].text)。 */
function extractReasoning(item: unknown): string {
  const direct = get(item, "text") ?? get(item, "content");
  if (typeof direct === "string" && direct) return direct;
  const summary = get(item, "summary");
  if (Array.isArray(summary)) return extractText(summary);
  return extractText(direct);
}

// ───────────────────────── usage 聚合 ─────────────────────────

/** 从一个 usage-like 对象读出增量(支持 input/output_tokens 与 prompt/completion_tokens 两套命名)。 */
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
  const input = num("input_tokens", "prompt_tokens", "inputTokens", "promptTokens");
  const output = num("output_tokens", "completion_tokens", "outputTokens", "completionTokens");
  const cacheRead = num(
    "cached_input_tokens",
    "cache_read_input_tokens",
    "cache_read_tokens",
    "cacheReadTokens",
  );
  if (input === 0 && output === 0 && cacheRead === 0) return null;
  return { input, output, cacheRead };
}

/** 防御式地从一行事件里找到第一处 usage(优先级顺序,每行至多取一次,避免重复计数)。 */
function pickUsage(data: unknown): unknown {
  return (
    get(data, "usage") ??
    get(get(data, "payload"), "usage") ??
    get(get(data, "item"), "usage") ??
    get(get(data, "turn"), "usage") ??
    get(get(data, "response"), "usage") ??
    null
  );
}

// ───────────────────────── compaction 标记 ─────────────────────────

/** 仅在出现可信压缩标记时才认(保守):type / item.type 含 compact / summariz / context_truncat。 */
function isCompactionMarker(eventType: unknown, data: unknown): boolean {
  const candidates = [eventType, get(get(data, "item"), "type"), get(data, "subtype")];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const s = c.toLowerCase();
    if (s.includes("compact") || s.includes("summariz") || s.includes("context_truncat")) return true;
  }
  return false;
}

// ───────────────────────── 主解析 ─────────────────────────

export function parseCodexTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let requests = 0;
  let compactions = 0;
  let parseSuccess = true;

  if (!raw || !raw.trim()) {
    return { events, usage: { inputTokens: 0, outputTokens: 0 }, compactions: 0, parseSuccess: true };
  }

  // 配对状态:已 started 的 callId(命令类工具的 started/completed 收口),
  // 以及无显式 call_id 时的 FIFO 兜底队列(老式 function_call_output 配对)。
  const startedCallIds = new Set<string>();
  const pendingCallIds: string[] = [];
  let synth = 0;
  const nextSynthId = (prefix: string): string => `${prefix}_${++synth}`;

  const addUsageFrom = (data: unknown): void => {
    const u = readUsage(pickUsage(data));
    if (!u) return;
    inputTokens += u.input;
    outputTokens += u.output;
    cacheReadTokens += u.cacheRead;
    requests += 1;
  };

  const emitCall = (callId: string, name: string, input: JsonValue, tool: ToolName): void => {
    startedCallIds.add(callId);
    events.push({ type: "action.called", callId, name, input, tool });
  };

  const emitResult = (
    callId: string,
    output: JsonValue | undefined,
    status: "completed" | "failed" | "rejected",
  ): void => {
    events.push({ type: "action.result", callId, output, status });
  };

  // 处理 item.started / item.completed 里的 item。
  const handleItem = (item: unknown, isCompleted: boolean): void => {
    if (!item || typeof item !== "object") return;
    const itemType = get(item, "type");
    const idRaw = get(item, "id");
    const baseId = typeof idRaw === "string" || typeof idRaw === "number" ? String(idRaw) : "";

    switch (itemType) {
      case "reasoning":
      case "thinking": {
        // 思考只在 completed 落一次,避免 started/completed 重复。
        if (!isCompleted) return;
        const text = extractReasoning(item);
        if (text) events.push({ type: "thinking", text });
        return;
      }

      case "agent_message":
      case "assistant_message":
      case "message": {
        if (!isCompleted) return;
        const text = extractText(get(item, "text") ?? get(item, "content") ?? get(item, "message"));
        if (text) events.push({ type: "message", role: "assistant", text });
        return;
      }

      case "command_execution":
      case "local_shell_call": {
        const callId = baseId || nextSynthId("cmd");
        const command = get(item, "command") ?? get(get(item, "action"), "command");
        if (!isCompleted) {
          emitCall(callId, "command_execution", { command } as JsonValue, "shell");
          return;
        }
        if (!startedCallIds.has(callId)) emitCall(callId, "command_execution", { command } as JsonValue, "shell");
        const exit = get(item, "exit_code");
        const statusStr = get(item, "status");
        const success =
          exit === 0 || (exit == null && statusStr !== "failed" && statusStr !== "error");
        emitResult(
          callId,
          {
            output: (get(item, "aggregated_output") ?? get(item, "output") ?? null) as JsonValue,
            exit_code: (exit ?? null) as JsonValue,
          },
          success ? "completed" : "failed",
        );
        return;
      }

      case "mcp_tool_call": {
        const callId = baseId || nextSynthId("mcp");
        const server = get(item, "server");
        const toolRaw = get(item, "tool") ?? get(item, "name") ?? "unknown";
        const originalName =
          typeof server === "string" ? `${server}.${String(toolRaw)}` : String(toolRaw);
        const input = coerceArgs(get(item, "arguments") ?? get(item, "input"));
        if (!isCompleted) {
          emitCall(callId, originalName, input, normalizeToolName(String(toolRaw)));
          return;
        }
        if (!startedCallIds.has(callId)) emitCall(callId, originalName, input, normalizeToolName(String(toolRaw)));
        const statusStr = get(item, "status");
        const success = !get(item, "error") && statusStr !== "failed";
        emitResult(callId, (get(item, "result") ?? null) as JsonValue, success ? "completed" : "failed");
        return;
      }

      case "web_search": {
        const callId = baseId || nextSynthId("web");
        const query = get(item, "query") ?? get(item, "search");
        if (!isCompleted) {
          emitCall(callId, "web_search", { query } as JsonValue, "web_search");
          return;
        }
        if (!startedCallIds.has(callId)) emitCall(callId, "web_search", { query } as JsonValue, "web_search");
        emitResult(callId, (get(item, "results") ?? get(item, "result") ?? null) as JsonValue, "completed");
        return;
      }

      case "file_change":
      case "patch":
      case "file_patch": {
        if (!isCompleted) return;
        const changes = get(item, "changes");
        const list = Array.isArray(changes) ? changes : [{ path: get(item, "path") }];
        list.forEach((ch, i) => {
          const path = get(ch, "path") ?? get(ch, "file");
          const kindRaw = get(ch, "kind") ?? get(ch, "type") ?? get(item, "kind");
          const kind = typeof kindRaw === "string" ? kindRaw.toLowerCase() : "update";
          const tool: ToolName = kind === "add" || kind === "delete" ? "file_write" : "file_edit";
          const callId = `${baseId || "patch"}#${i}`;
          emitCall(callId, "file_change", { path, kind } as JsonValue, tool);
          emitResult(callId, { path, kind } as JsonValue, "completed");
        });
        return;
      }

      case "error": {
        const msg = get(item, "message") ?? get(item, "text") ?? "error";
        events.push({ type: "error", message: String(msg) });
        return;
      }

      default:
        return; // todo_list / 其它 item 类型暂不映射
    }
  };

  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      parseSuccess = false;
      continue;
    }

    try {
      addUsageFrom(data);

      const eventType = (get(data, "type") ?? get(data, "event") ?? get(data, "kind")) as unknown;

      if (isCompactionMarker(eventType, data)) {
        events.push({ type: "compaction" });
        compactions += 1;
        continue;
      }

      switch (eventType) {
        // ── 控制流:仅在失败时落 error ──
        case "thread.started":
        case "thread.completed":
        case "turn.started":
        case "turn.completed":
        case "response.created":
        case "response.completed":
        case "response.cancelled":
          break;

        case "turn.failed":
        case "response.failed": {
          const err = get(data, "error");
          const msg = get(err, "message") ?? get(data, "message") ?? "turn failed";
          events.push({ type: "error", message: String(msg) });
          break;
        }

        // ── 主路径:item.* ──
        case "item.started":
          handleItem(get(data, "item"), false);
          break;
        case "item.updated":
          // 中间态忽略,等 completed
          break;
        case "item.completed":
          handleItem(get(data, "item"), true);
          break;

        // ── 老式 / session rollout ResponseItem ──
        case "message":
        case "chat": {
          const roleRaw = get(data, "role") ?? (get(data, "from") === "assistant" ? "assistant" : "user");
          const role = roleRaw === "user" ? "user" : "assistant";
          const text = extractText(get(data, "content") ?? get(data, "text") ?? get(data, "message"));
          if (text) events.push({ type: "message", role, text });
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
          const isShell = eventType === "local_shell_call";
          const nameRaw = isShell
            ? "shell"
            : (get(data, "name") ?? get(get(data, "function"), "name") ?? get(data, "tool") ?? get(data, "action") ?? "unknown");
          const name = String(nameRaw);
          const rawArgs = isShell
            ? (get(data, "action") ?? get(data, "input"))
            : (get(get(data, "function"), "arguments") ?? get(data, "arguments") ?? get(data, "input") ?? get(data, "params"));
          const input = coerceArgs(rawArgs);
          const explicit = get(data, "call_id") ?? get(data, "id") ?? get(data, "tool_call_id");
          const callId = explicit != null ? String(explicit) : nextSynthId("call");
          if (explicit == null) pendingCallIds.push(callId);
          emitCall(callId, name, input, normalizeToolName(name));
          break;
        }

        case "function_call_output":
        case "tool_result":
        case "tool_response":
        case "action_result":
        case "local_shell_call_output": {
          const explicit = get(data, "call_id") ?? get(data, "tool_call_id") ?? get(data, "id");
          const callId =
            explicit != null ? String(explicit) : pendingCallIds.shift() ?? nextSynthId("result");
          const rawOut = get(data, "output") ?? get(data, "result") ?? get(data, "content");
          const { output, status } = interpretOutput(rawOut, data);
          emitResult(callId, output, status);
          break;
        }

        case "error": {
          const err = get(data, "error");
          const msg = get(err, "message") ?? get(data, "message") ?? get(data, "content") ?? "error";
          events.push({ type: "error", message: String(msg) });
          break;
        }

        // output_text.delta / output_text.done 是同一条 assistant 文本的流式分片,
        // 最终文本会经 agent_message item / message ResponseItem 落地,这里直接丢弃避免重复。
        case "output_text.delta":
        case "output_text.done":
          break;

        default: {
          // 兜底:按结构猜。
          const role = get(data, "role");
          if (role === "assistant" || role === "user") {
            const text = extractText(get(data, "content") ?? get(data, "text"));
            if (text) events.push({ type: "message", role, text });
          }
        }
      }
    } catch {
      // 单行处理异常不应拖垮整条 transcript。
      parseSuccess = false;
    }
  }

  const usage: Usage = { inputTokens, outputTokens };
  if (cacheReadTokens > 0) usage.cacheReadTokens = cacheReadTokens;
  if (requests > 0) usage.requests = requests;

  return { events, usage, compactions, parseSuccess };
}

/** 解读一条工具结果输出:抠 exit_code / error 推断成败,返回归一化 output + status。 */
function interpretOutput(
  rawOut: unknown,
  data: unknown,
): { output: JsonValue | undefined; status: "completed" | "failed" | "rejected" } {
  // 显式 success / error 优先。
  const explicitSuccess = get(data, "success");
  if (explicitSuccess === false) return { output: (rawOut ?? null) as JsonValue, status: "failed" };
  if (get(data, "error")) return { output: (rawOut ?? null) as JsonValue, status: "failed" };

  // 字符串输出尝试解析 exit_code(codex shell 结果常见)。
  let parsed: unknown = rawOut;
  if (typeof rawOut === "string") {
    try {
      parsed = JSON.parse(rawOut);
    } catch {
      parsed = rawOut;
    }
  }
  const exit =
    get(parsed, "exit_code") ?? get(parsed, "exitCode") ?? get(get(parsed, "metadata"), "exit_code");
  if (typeof exit === "number") {
    return { output: (parsed ?? null) as JsonValue, status: exit === 0 ? "completed" : "failed" };
  }
  return { output: (parsed ?? null) as JsonValue, status: "completed" };
}

/** 便捷形态:只要 StreamEvent[]。 */
export function parseCodex(raw: string | undefined): StreamEvent[] {
  return parseCodexTranscript(raw).events;
}
