// 从归一化的 StreamEvent[] 折叠出结构化事实。
//   - deriveRunFacts:断言层吃的 DerivedFacts(按 callId 把 called+result 折成 ToolCall);
//   - buildO11ySummary:给人 / EVAL.ts 看的 o11y 摘要(注入 __fastevals__/results.json)。
// 一旦事件流归一好了,这两个折叠对所有 agent 通用。

import type {
  StreamEvent,
  DerivedFacts,
  ToolCall,
  SubagentCall,
  InputRequest,
  O11ySummary,
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
  const toolCallMap = new Map<string, ToolCall>();
  const toolCallOrder: string[] = [];
  const subagentMap = new Map<string, SubagentCall>();
  const subagentOrder: string[] = [];
  const inputRequests: InputRequest[] = [];
  let messageCount = 0;
  let compactions = 0;

  for (const ev of events) {
    switch (ev.type) {
      case "message":
        messageCount += 1;
        break;

      case "action.called": {
        if (!toolCallMap.has(ev.callId)) toolCallOrder.push(ev.callId);
        toolCallMap.set(ev.callId, {
          callId: ev.callId,
          name: ev.tool ?? "unknown",
          originalName: ev.name,
          input: ev.input,
          status: "completed",
        });
        break;
      }

      case "action.result": {
        const existing = toolCallMap.get(ev.callId);
        if (existing) {
          existing.output = ev.output;
          existing.status = ev.status;
        } else {
          // 只有结果、没配上调用:补一条占位 ToolCall。
          toolCallOrder.push(ev.callId);
          toolCallMap.set(ev.callId, {
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
        if (!subagentMap.has(ev.callId)) subagentOrder.push(ev.callId);
        subagentMap.set(ev.callId, {
          callId: ev.callId,
          name: ev.name,
          remoteUrl: ev.remoteUrl,
          status: "completed",
        });
        break;
      }

      case "subagent.completed": {
        const existing = subagentMap.get(ev.callId);
        if (existing) {
          existing.output = ev.output;
          existing.status = ev.status;
        } else {
          subagentOrder.push(ev.callId);
          subagentMap.set(ev.callId, {
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
    toolCalls: toolCallOrder.map((id) => toolCallMap.get(id)!),
    subagentCalls: subagentOrder.map((id) => subagentMap.get(id)!),
    inputRequests,
    parked,
    messageCount,
    compactions,
  };
}

// ───────────────────────── buildO11ySummary ─────────────────────────

export function buildO11ySummary(
  events: readonly StreamEvent[],
  usage: Usage,
  durationMs: number,
): O11ySummary {
  const toolCalls: Record<string, number> = {};
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
        const canonical: ToolName | string = ev.tool ?? "unknown";
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
    durationMs,
    usage,
  };
}
