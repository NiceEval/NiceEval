// 从归一化的 StreamEvent[] 折叠出结构化事实。
//   - deriveRunFacts:断言层吃的 DerivedFacts(按 callId 把 called+result 折成 ToolCall);
//   - buildO11ySummary:给人 / EVAL.ts 看的 o11y 摘要(注入 __niceeval__/results.json)。
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
    return (input as Record<string, JsonValue>)[key];
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
  // 折叠是逐条按发生顺序进行的:called 追加一条新调用,result 回填「当前还没配上 result 的
  // 同 callId 调用」。callId 只在一个 called→result 配对内保证稳定,不保证跨轮唯一——adapter
  // 常按轮各自编号(OpenAI 兼容协议、transcript 归一都会复用 c1/c2…)。所以一个 callId 在其
  // result 之后再次以 called 出现,是新的一次调用,起一条新记录,不覆盖前一轮那条(否则跨轮
  // 聚合会把前面几轮的工具调用抹成「只剩最后一轮」)。用 open*ByCallId 只跟踪各 callId 当前
  // 敞口的那条,配上 result 即关闭。
  const toolCalls: ToolCall[] = [];
  const openToolByCallId = new Map<string, number>();
  const subagentCalls: SubagentCall[] = [];
  const openSubagentByCallId = new Map<string, number>();
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

      case "action.called": {
        openToolByCallId.set(ev.callId, toolCalls.length);
        toolCalls.push({
          callId: ev.callId,
          name: ev.tool ?? "unknown",
          originalName: ev.name,
          input: ev.input,
          // 只有 called、尚未等到 result 的调用是 pending(见 docs/feature/adapters/architecture/events.md)。
          status: "pending",
        });
        break;
      }

      case "action.result": {
        const idx = openToolByCallId.get(ev.callId);
        if (idx !== undefined) {
          toolCalls[idx].output = ev.output;
          toolCalls[idx].status = ev.status;
          openToolByCallId.delete(ev.callId);
        } else {
          // 只有结果、没配上调用:补一条占位 ToolCall。
          toolCalls.push({
            callId: ev.callId,
            name: "unknown",
            input: null,
            output: ev.output,
            status: ev.status,
          });
        }
        break;
      }

      case "subagent.called": {
        openSubagentByCallId.set(ev.callId, subagentCalls.length);
        subagentCalls.push({
          callId: ev.callId,
          name: ev.name,
          remoteUrl: ev.remoteUrl,
          // 只有 called、尚未等到 result 的调用是 pending(与 ToolCall 折叠同一条契约)。
          status: "pending",
        });
        break;
      }

      case "subagent.completed": {
        const idx = openSubagentByCallId.get(ev.callId);
        if (idx !== undefined) {
          subagentCalls[idx].output = ev.output;
          subagentCalls[idx].status = ev.status;
          openSubagentByCallId.delete(ev.callId);
        } else {
          subagentCalls.push({
            callId: ev.callId,
            name: "unknown",
            output: ev.output,
            status: ev.status,
          });
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

function numAttr(attrs: Record<string, JsonValue>, ...keys: string[]): number {
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === "number" && v > 0) return v;
  }
  return 0;
}

// ───────────────────────── buildO11ySummary ─────────────────────────

export function buildO11ySummary(events: readonly StreamEvent[]): O11ySummary {
  const toolCalls: Partial<Record<ToolName, number>> = {};
  let totalToolCalls = 0;
  const filesRead = new Set<string>();
  const filesModified = new Set<string>();
  const shellCommands: { command: string; exitCode?: number; success?: boolean }[] = [];
  const webFetches: { url: string; status?: number; success?: boolean }[] = [];
  const errors: string[] = [];
  let thinkingBlocks = 0;
  let compactions = 0;
  let totalTurns = 0;

  // 先把结果按 callId 建索引,供 shell / web 回填成败。
  const resultByCallId = new Map<string, Extract<StreamEvent, { type: "action.result" }>>();
  for (const ev of events) {
    if (ev.type === "action.result") resultByCallId.set(ev.callId, ev);
  }

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

      case "action.called": {
        const canonical: ToolName = ev.tool ?? "unknown";
        toolCalls[canonical] = (toolCalls[canonical] ?? 0) + 1;
        totalToolCalls += 1;

        const input = ev.input;
        const result = resultByCallId.get(ev.callId);

        if (ev.tool === "file_read") {
          const path = pickString(input, ["path", "file", "file_path", "filename"]);
          if (path) filesRead.add(path);
        } else if (ev.tool === "file_write" || ev.tool === "file_edit") {
          const path = pickString(input, ["path", "file", "file_path", "filename"]);
          if (path) filesModified.add(path);
        } else if (ev.tool === "shell") {
          const command = pickCommand(input);
          if (command) {
            const entry: { command: string; exitCode?: number; success?: boolean } = { command };
            if (result) {
              entry.success = result.status === "completed";
              const exit = pickExitCode(result.output);
              if (exit !== undefined) entry.exitCode = exit;
            }
            shellCommands.push(entry);
          }
        } else if (ev.tool === "web_fetch") {
          const url = pickString(input, ["url", "uri", "endpoint", "href"]);
          if (url) {
            const entry: { url: string; status?: number; success?: boolean } = { url };
            if (result) {
              entry.success = result.status === "completed";
              const status = field(result.output, "status");
              if (typeof status === "number") entry.status = status;
            }
            webFetches.push(entry);
          }
        }
        break;
      }

      default:
        break;
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
