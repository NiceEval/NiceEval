// Claude Code transcript 解析器。
// Claude Code 把会话存成 JSONL:~/.claude/projects/{path}/{session}.jsonl。
//   - 每行 { type:"user"|"assistant", message:{ content:[...], usage:{...} } };
//   - assistant 行的 content 里混着 text / tool_use / thinking 块;
//   - 工具结果以 user 行里的 tool_result 块回来(按 tool_use_id 配对)。
// 目标:归一成 niceeval StreamEvent[]。

import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";
import { normalizeToolName as normalizeShared } from "../tool-names.ts";

// ───────────────────────── 工具名归一 ─────────────────────────

/**
 * Claude Code 特有别名(键小写;PascalCase 原名靠共享层的 toLowerCase 兜住);通用别名走基表。
 * 裸名 read/write/edit/webfetch/websearch/task 必须在这里:它们是 Claude Code 的核心工具
 * (Read/Write/Edit/WebFetch/WebSearch/Task),基表刻意不收裸动词。
 */
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

function normalizeToolName(name: string): ToolName {
  return normalizeShared(name, CLAUDE_TOOL_ALIASES);
}

// ───────────────────────── Skill 加载识别 ─────────────────────────

/**
 * Claude Code 原生调用 Skill 时,tool_use 块的 name 恒为 "Skill"(核对过 Claude Code CLI
 * 自带的 SkillTool 定义:`buildTool({ name: SKILL_TOOL_NAME, ... })`,`SKILL_TOOL_NAME = "Skill"`,
 * 严格大小写;这里放宽成大小写不敏感比较,只是防御性兜底,不代表原生真的会变大小写),
 * input 的 schema 是 `z.object({ skill: z.string(), args: z.string().optional() })`——
 * skill 名在 `input.skill`(不是 `command`),可能是限定名如 "ms-office-suite:pdf"。
 */
const SKILL_TOOL_NAME = "skill";

/** name 是 Skill 工具、且 input.skill 是非空字符串时返回 skill 名;否则 undefined(交给调用方走普通 action.called)。 */
function extractSkillName(name: string, input: JsonValue): string | undefined {
  if (name.toLowerCase() !== SKILL_TOOL_NAME) return undefined;
  const skill = get(input, "skill");
  return typeof skill === "string" && skill ? skill : undefined;
}

// ───────────────────────── 小工具 ─────────────────────────

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as globalThis.Record<string, unknown>)[key] : undefined;
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

function readUsage(u: unknown): { input: number; output: number; cacheRead: number; cacheCreation: number } | null {
  if (!u || typeof u !== "object") return null;
  const o = u as globalThis.Record<string, unknown>;
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
  const cacheCreation = readCacheCreation(o);
  if (input === 0 && output === 0 && cacheRead === 0 && cacheCreation === 0) return null;
  return { input, output, cacheRead, cacheCreation };
}

/**
 * cache_creation_input_tokens 顶层字段是缓存写入总量;某些版本额外拆到
 * `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` 两档 ttl 明细,
 * 顶层字段存在时已经是二者之和,不重复相加。
 */
function readCacheCreation(o: globalThis.Record<string, unknown>): number {
  const top = o["cache_creation_input_tokens"];
  if (typeof top === "number" && Number.isFinite(top)) return top;
  const detail = o["cache_creation"];
  if (detail && typeof detail === "object") {
    const d = detail as globalThis.Record<string, unknown>;
    const five = typeof d["ephemeral_5m_input_tokens"] === "number" ? (d["ephemeral_5m_input_tokens"] as number) : 0;
    const hour = typeof d["ephemeral_1h_input_tokens"] === "number" ? (d["ephemeral_1h_input_tokens"] as number) : 0;
    return five + hour;
  }
  return 0;
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
  let cacheCreationTokens = 0;
  let requests = 0;
  let compactions = 0;
  let parseSuccess = true;
  // 已识别成 skill.loaded 的 tool_use callId:对应的 tool_result 回来时要吃掉、
  // 不再补发一条 action.result(否则会凭空多出一个没有 action.called 配对的孤儿事件,
  // ExecutionTree 会把它当成占位工具调用节点,而 Skill 加载已经由 skill.loaded 表达过了)。
  const skillCallIds = new Set<string>();

  if (!raw || !raw.trim()) {
    return { events, usage: {}, compactions: 0, parseSuccess: true };
  }

  const addUsageFrom = (data: unknown): void => {
    const u = readUsage(get(get(data, "message"), "usage") ?? get(data, "usage"));
    if (!u) return;
    inputTokens += u.input;
    outputTokens += u.output;
    cacheReadTokens += u.cacheRead;
    cacheCreationTokens += u.cacheCreation;
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
            if (skillCallIds.has(callId)) continue; // Skill 加载的结果已经由 skill.loaded 表达过,不重复计入。
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

            const skill = extractSkillName(name, input);
            if (skill !== undefined) {
              events.push({ type: "skill.loaded", skill, callId });
              skillCallIds.add(callId);
              continue;
            }

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
        if (skillCallIds.has(callId)) continue; // 同上:Skill 加载的结果不重复计入 action.result。
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

  // requests > 0 意味着至少一行真的带回了 usage;整份 transcript 没有任何 usage 行时
  // (比如純工具调用、无模型请求的边角 fixture)input/output 也不该垫成 0。
  const usage: Usage = requests > 0 ? { inputTokens, outputTokens } : {};
  if (cacheReadTokens > 0) usage.cacheReadTokens = cacheReadTokens;
  if (cacheCreationTokens > 0) usage.cacheCreationTokens = cacheCreationTokens;
  if (requests > 0) usage.requests = requests;

  return { events, usage, compactions, parseSuccess };
}

/** 便捷形态:只要 StreamEvent[]。 */
export function parseClaudeCode(raw: string | undefined): StreamEvent[] {
  return parseClaudeCodeTranscript(raw).events;
}
