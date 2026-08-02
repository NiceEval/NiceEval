// 从归一化的 StreamEvent[] 折叠出结构化事实。
//   - deriveRunFacts:断言层吃的 DerivedFacts(按 operationId 把 started+finished 折成 ToolCall);
//   - buildO11ySummary:给人看的 o11y 摘要,同时是宿主侧 `t.o11y` 与落盘 o11y.json 的同一份算法。
// 一旦事件流归一好了,这两个折叠对所有 agent 通用。

import type {
  StreamEvent,
  DerivedFacts,
  ToolCall,
  SubagentCall,
  InputRequest,
  O11ySummary,
  TraceSpan,
  Usage,
  ToolName,
  JsonValue,
} from "../types.ts";

// ───────────────────────── 小工具 ─────────────────────────

/** 把 JsonValue 当对象取字段;非对象返回 undefined。 */
function field(input: JsonValue | undefined, key: string): JsonValue | undefined {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return (input as globalThis.Record<string, JsonValue>)[key];
  }
  return undefined;
}

/** 按候选 key 顺序取第一个字符串。 */
function pickString(input: JsonValue | undefined, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = field(input, k);
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/** command 可能是 string 或 string[],归一成一行命令文本。 */
function pickCommand(input: JsonValue | undefined): string | undefined {
  const cmd = field(input, "command") ?? field(input, "cmd");
  if (typeof cmd === "string") return cmd;
  if (Array.isArray(cmd)) return cmd.filter((p) => typeof p === "string").join(" ");
  const program = field(input, "program");
  const args = field(input, "args");
  if (typeof program === "string" && Array.isArray(args)) {
    return `${program} ${args.filter((p) => typeof p === "string").join(" ")}`;
  }
  return undefined;
}

/** 从工具结果 output 里抠 exit_code(codex shell 结果常嵌在 output / metadata 里)。 */
function pickExitCode(output: JsonValue | undefined): number | undefined {
  const direct = field(output, "exit_code") ?? field(output, "exitCode");
  if (typeof direct === "number") return direct;
  const meta = field(output, "metadata");
  const nested = field(meta, "exit_code") ?? field(meta, "exitCode");
  if (typeof nested === "number") return nested;
  return undefined;
}

// ───────────────────────── deriveRunFacts ─────────────────────────

export function deriveRunFacts(events: readonly StreamEvent[]): DerivedFacts {
  // 折叠是逐条按发生顺序进行的:started 追加一条新操作,finished 回填「当前还没配上 finished 的
  // 同 operationId 操作」。operationId 只在一个 started→finished 配对内保证稳定,不保证跨轮唯一。
  // 同一个 id 在 finished 后再次 started 是一条新操作，不覆盖前一轮记录。
  const toolCalls: ToolCall[] = [];
  const openToolByOperationId = new Map<string, number>();
  const subagentCalls: SubagentCall[] = [];
  const openSubagentByOperationId = new Map<string, number>();
  const inputRequests: InputRequest[] = [];
  let messageCount = 0;
  let compactions = 0;
  let contextInjections = 0;

  for (const ev of events) {
    switch (ev.type) {
      case "message":
        messageCount += 1;
        break;

      case "context.injected":
        contextInjections += 1;
        break;

      case "operation.started": {
        if (ev.operation.kind === "tool") {
          openToolByOperationId.set(ev.operationId, toolCalls.length);
          toolCalls.push({
            operationId: ev.operationId,
            name: ev.operation.tool ?? "unknown",
            originalName: ev.operation.name,
            input: ev.operation.input,
            status: "pending",
          });
        } else {
          openSubagentByOperationId.set(ev.operationId, subagentCalls.length);
          subagentCalls.push({
            operationId: ev.operationId,
            name: ev.operation.name,
            remoteUrl: ev.operation.remoteUrl,
            status: "pending",
          });
        }
        break;
      }

      case "operation.finished": {
        if (ev.kind === "tool") {
          const idx = openToolByOperationId.get(ev.operationId);
          if (idx !== undefined) {
            toolCalls[idx].output = ev.output;
            toolCalls[idx].status = ev.status;
            openToolByOperationId.delete(ev.operationId);
          } else {
            toolCalls.push({
              operationId: ev.operationId,
              name: "unknown",
              input: null,
              output: ev.output,
              status: ev.status,
            });
          }
        } else {
          const idx = openSubagentByOperationId.get(ev.operationId);
          if (idx !== undefined) {
            subagentCalls[idx].output = ev.output;
            subagentCalls[idx].status = ev.status;
            openSubagentByOperationId.delete(ev.operationId);
          } else {
            subagentCalls.push({
              operationId: ev.operationId,
              name: "unknown",
              output: ev.output,
              status: ev.status,
            });
          }
        }
        break;
      }

      case "input.requested":
        inputRequests.push(ev.request);
        break;

      case "compaction":
        compactions += 1;
        break;

      default:
        break;
    }
  }

  // parked:最后一条「有意义」的事件是 input.requested(忽略 thinking / compaction 这类尾随噪声)。
  let parked = false;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].type;
    if (t === "thinking" || t === "compaction") continue;
    parked = t === "input.requested";
    break;
  }

  return {
    toolCalls,
    subagentCalls,
    inputRequests,
    parked,
    messageCount,
    compactions,
    contextInjections,
  };
}

// ───────────────────────── extractUsageFromSpans ─────────────────────────

/**
 * adapter 未报 usage 时的兜底:从 OTLP span 属性里提取 token 用量。
 * 按 OpenTelemetry GenAI 语义约定累加所有模型调用 span 的用量字段。
 * 返回 undefined 表示 span 里也没有用量信息。
 */
export function extractUsageFromSpans(spans: readonly TraceSpan[]): Usage | undefined {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  for (const span of spans) {
    const a = span.attributes ?? {};
    // OpenTelemetry GenAI 语义约定(新旧两套 key 都认);cache_read/cache_creation 是
    // 常见 vendor instrumentation(如 Anthropic OTel 插桩)对同一约定族的扩展属性。
    inputTokens += numAttr(a, "gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens");
    outputTokens += numAttr(a, "gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens");
    cacheReadTokens += numAttr(a, "gen_ai.usage.cache_read_input_tokens");
    cacheCreationTokens += numAttr(a, "gen_ai.usage.cache_creation_input_tokens");
  }

  if (inputTokens === 0 && outputTokens === 0) return undefined;
  const u: Usage = { inputTokens, outputTokens };
  if (cacheReadTokens > 0) u.cacheReadTokens = cacheReadTokens;
  if (cacheCreationTokens > 0) u.cacheCreationTokens = cacheCreationTokens;
  return u;
}

function numAttr(attrs: globalThis.Record<string, JsonValue>, ...keys: string[]): number {
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === "number" && v > 0) return v;
  }
  return 0;
}

// ───────────────────────── buildO11ySummary ─────────────────────────

export function buildO11ySummary(events: readonly StreamEvent[]): O11ySummary {
  const toolCalls: Partial<globalThis.Record<ToolName, number>> = {};
  let totalToolCalls = 0;
  const filesRead = new Set<string>();
  const filesModified = new Set<string>();
  const shellCommands: { command: string; exitCode?: number; success?: boolean }[] = [];
  const webFetches: { url: string; status?: number; success?: boolean }[] = [];
  const errors: string[] = [];
  let thinkingBlocks = 0;
  let compactions = 0;
  let totalTurns = 0;

  for (const ev of events) {
    switch (ev.type) {
      case "message":
        if (ev.role === "assistant") totalTurns += 1;
        break;

      case "thinking":
        thinkingBlocks += 1;
        break;

      case "compaction":
        compactions += 1;
        break;

      case "error":
        if (ev.message) errors.push(ev.message);
        break;

      default:
        break;
    }
  }

  // 人读摘要直接消费同一份严格配对后的 ToolCall，避免按 operationId 全局索引时把跨轮复用
  // 或 finished-before-started 容错事件错配给另一条操作。没有 originalName 的是孤儿 finished 占位。
  for (const call of deriveRunFacts(events).toolCalls) {
    if (call.originalName === undefined) continue;
    const canonical: ToolName = call.name;
    toolCalls[canonical] = (toolCalls[canonical] ?? 0) + 1;
    totalToolCalls += 1;

    if (canonical === "file_read") {
      const path = pickString(call.input, ["path", "file", "file_path", "filename"]);
      if (path) filesRead.add(path);
    } else if (canonical === "file_write" || canonical === "file_edit") {
      const path = pickString(call.input, ["path", "file", "file_path", "filename"]);
      if (path) filesModified.add(path);
    } else if (canonical === "shell") {
      const command = pickCommand(call.input);
      if (command) {
        const entry: { command: string; exitCode?: number; success?: boolean } = { command };
        if (call.status !== "pending") {
          entry.success = call.status === "completed";
          const exit = pickExitCode(call.output);
          if (exit !== undefined) entry.exitCode = exit;
        }
        shellCommands.push(entry);
      }
    } else if (canonical === "web_fetch") {
      const url = pickString(call.input, ["url", "uri", "endpoint", "href"]);
      if (url) {
        const entry: { url: string; status?: number; success?: boolean } = { url };
        if (call.status !== "pending") {
          entry.success = call.status === "completed";
          const status = field(call.output, "status");
          if (typeof status === "number") entry.status = status;
        }
        webFetches.push(entry);
      }
    }
  }

  return {
    totalTurns,
    toolCalls,
    totalToolCalls,
    filesRead: Array.from(filesRead),
    filesModified: Array.from(filesModified),
    shellCommands,
    webFetches,
    errors,
    thinkingBlocks,
    compactions,
  };
}
