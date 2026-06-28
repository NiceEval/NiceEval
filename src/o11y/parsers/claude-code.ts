// Claude Code transcript 解析器。
// Claude Code 把会话存成 JSONL:~/.claude/projects/{path}/{session}.jsonl。
//   - 每行 { type:"user"|"assistant", message:{ content:[...], usage:{...} } };
//   - assistant 行的 content 里混着 text / tool_use / thinking 块;
//   - 工具结果以 user 行里的 tool_result 块回来(按 tool_use_id 配对)。
// 目标:归一成 fastevals StreamEvent[]。

import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";

// ───────────────────────── 工具名归一 ─────────────────────────

function normalizeToolName(name: string): ToolName {
  const toolMap: Record<string, ToolName> = {
    // 文件
    Read: "file_read",
    read_file: "file_read",
    ReadFile: "file_read",
    Write: "file_write",
    write_file: "file_write",
    WriteFile: "file_write",
    write_to_file: "file_write",
    create_file: "file_write",
    Edit: "file_edit",
    MultiEdit: "file_edit",
    edit_file: "file_edit",
    EditFile: "file_edit",
    str_replace_editor: "file_edit",
    StrReplace: "file_edit",
    NotebookEdit: "file_edit",

    // shell
    Bash: "shell",
    bash: "shell",
    BashOutput: "shell",
    Shell: "shell",
    shell: "shell",
    execute_command: "shell",
    run_command: "shell",

    // web
    WebFetch: "web_fetch",
    web_fetch: "web_fetch",
    fetch_url: "web_fetch",
    mcp__fetch__fetch: "web_fetch",
    WebSearch: "web_search",
    web_search: "web_search",

    // 检索 / 导航
    Glob: "glob",
    glob: "glob",
    list_files: "glob",
    Grep: "grep",
    grep: "grep",
    search_files: "grep",
    LS: "list_dir",
    list_dir: "list_dir",
    ListDir: "list_dir",

    // 子 agent
    Task: "agent_task",
    task: "agent_task",
  };
  return toolMap[name] || "unknown";
}

// ───────────────────────── 小工具 ─────────────────────────

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

/** content 既可能是 string,也可能挂在 data.message.content;统一取数组。 */
function getContentArray(data: unknown): unknown[] | undefined {
  const direct = get(data, "content");
  if (Array.isArray(direct)) return direct;
  const msgContent = get(get(data, "message"), "content");
  if (Array.isArray(msgContent)) return msgContent;
  return undefined;
}

function getStringContent(data: unknown): string | undefined {
  const direct = get(data, "content");
  if (typeof direct === "string") return direct;
  const msgContent = get(get(data, "message"), "content");
  if (typeof msgContent === "string") return msgContent;
  return undefined;
}

/** 抠 text 块(含 message.content[].type==="text")。 */
function extractText(data: unknown): string {
  const s = getStringContent(data);
  if (s) return s;
  const arr = getContentArray(data);
  if (arr) {
    const texts = arr
      .filter((b) => get(b, "type") === "text")
      .map((b) => get(b, "text"))
      .filter((t): t is string => typeof t === "string");
    if (texts.length > 0) return texts.join("\n");
  }
  const t = get(data, "text");
  return typeof t === "string" ? t : "";
}

/** 抠 thinking 块。 */
function extractThinking(data: unknown): string {
  const arr = getContentArray(data);
  if (!arr) return "";
  const blocks = arr
    .filter((b) => get(b, "type") === "thinking")
    .map((b) => get(b, "thinking") ?? get(b, "text"))
    .filter((t): t is string => typeof t === "string");
  return blocks.join("\n");
}

// ───────────────────────── usage 聚合 ─────────────────────────

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
  const cacheRead = num("cache_read_input_tokens", "cached_input_tokens", "cache_read_tokens");
  if (input === 0 && output === 0 && cacheRead === 0) return null;
  return { input, output, cacheRead };
}

// ───────────────────────── compaction 标记 ─────────────────────────

/** Claude Code 压缩边界:type:"summary" / isCompactSummary / subtype:"compact_boundary"。 */
function isCompactSummary(data: unknown): boolean {
  if (get(data, "type") === "summary") return true;
  if (get(data, "isCompactSummary") === true) return true;
  if (get(get(data, "message"), "isCompactSummary") === true) return true;
  if (get(data, "subtype") === "compact_boundary") return true;
  return false;
}

// ───────────────────────── 主解析 ─────────────────────────

export function parseClaudeCodeTranscript(raw: string | undefined): ParsedTranscript {
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

  const addUsageFrom = (data: unknown): void => {
    const u = readUsage(get(get(data, "message"), "usage") ?? get(data, "usage"));
    if (!u) return;
    inputTokens += u.input;
    outputTokens += u.output;
    cacheReadTokens += u.cacheRead;
    requests += 1;
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
      // 压缩边界(在常规分类之前判,优先吃掉)。
      if (isCompactSummary(data)) {
        events.push({ type: "compaction" });
        compactions += 1;
        continue;
      }

      const type = get(data, "type");
      const role = get(data, "role");

      if (type === "user" || role === "user") {
        addUsageFrom(data);
        const arr = getContentArray(data);
        const toolResults = arr?.filter((b) => get(b, "type") === "tool_result") ?? [];
        if (toolResults.length > 0) {
          for (const r of toolResults) {
            const callId = String(get(r, "tool_use_id") ?? get(r, "id") ?? "unknown");
            const isError = get(r, "is_error") === true || !!get(r, "error");
            events.push({
              type: "action.result",
              callId,
              output: (get(r, "content") ?? null) as JsonValue,
              status: isError ? "failed" : "completed",
            });
          }
        } else {
          const text = extractText(data);
          if (text) events.push({ type: "message", role: "user", text });
        }
      } else if (type === "assistant" || role === "assistant") {
        addUsageFrom(data);

        const text = extractText(data);
        if (text) events.push({ type: "message", role: "assistant", text });

        const thinking = extractThinking(data);
        if (thinking) events.push({ type: "thinking", text: thinking });

        const arr = getContentArray(data);
        if (arr) {
          for (const b of arr) {
            if (get(b, "type") !== "tool_use") continue;
            const name = String(get(b, "name") ?? "unknown");
            const callId = String(get(b, "id") ?? "unknown");
            const input = (get(b, "input") ?? {}) as JsonValue;
            events.push({
              type: "action.called",
              callId,
              name,
              input,
              tool: normalizeToolName(name),
            });
          }
        }
      } else if (type === "tool_result" || type === "tool_response") {
        const callId = String(get(data, "tool_use_id") ?? get(data, "id") ?? "unknown");
        const isError = get(data, "is_error") === true || !!get(data, "error");
        events.push({
          type: "action.result",
          callId,
          output: (get(data, "content") ?? get(data, "output") ?? get(data, "result") ?? null) as JsonValue,
          status: isError ? "failed" : "completed",
        });
      } else if (type === "system" || role === "system") {
        // 系统行多为元数据,不进事件流(compact_boundary 已在上面吃掉)。
      } else if (type === "error" || get(data, "error")) {
        const err = get(data, "error");
        const msg = get(err, "message") ?? get(data, "message") ?? "error";
        events.push({ type: "error", message: String(msg) });
      }
    } catch {
      parseSuccess = false;
    }
  }

  const usage: Usage = { inputTokens, outputTokens };
  if (cacheReadTokens > 0) usage.cacheReadTokens = cacheReadTokens;
  if (requests > 0) usage.requests = requests;

  return { events, usage, compactions, parseSuccess };
}

/** 便捷形态:只要 StreamEvent[]。 */
export function parseClaudeCode(raw: string | undefined): StreamEvent[] {
  return parseClaudeCodeTranscript(raw).events;
}
