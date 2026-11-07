// OpenCode `run --format json` / `opencode export` 解析器。方言只住这里,不进 core
// (契约见 docs/feature/adapters/library/sdk/opencode/README.md)。

import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";
import { GENERIC_VERB_ALIASES, normalizeToolName as normalizeShared } from "../tool-names.ts";
import { normalizeJsonValue } from "../../shared/json-value.ts";
import { notCommandProjection, opaqueCommandProjection } from "../command-projection.ts";

export const OPENCODE_TOOL_ALIASES: globalThis.Record<string, ToolName> = {
  ...GENERIC_VERB_ALIASES,
  read: "file_read",
  write: "file_write",
  create: "file_write",
  edit: "file_edit",
  patch: "file_edit",
  // OpenCode 写文件主路径是 apply_patch;Add File 在下方按 patch 内容升成 file_write。
  apply_patch: "file_edit",
  bash: "shell",
  shell: "shell",
  webfetch: "web_fetch",
  websearch: "web_search",
};

/** 从 apply_patch 的 patchText 抠 path,并把 Add File 升成 file_write。 */
function enrichApplyPatchInput(input: JsonValue): { input: JsonValue; tool: ToolName } {
  const obj = input && typeof input === "object" && !Array.isArray(input)
    ? { ...(input as globalThis.Record<string, unknown>) }
    : ({ patchText: input } as globalThis.Record<string, unknown>);
  const patchText = typeof obj.patchText === "string" ? obj.patchText : "";
  const add = patchText.match(/\*\*\*\s*Add File:\s*(.+)/);
  const update = patchText.match(/\*\*\*\s*(?:Update|Delete) File:\s*(.+)/);
  const path = (add?.[1] ?? update?.[1] ?? "").trim();
  if (path) obj.path = path;
  return {
    input: obj as JsonValue,
    tool: add ? "file_write" : "file_edit",
  };
}

function normalizeToolName(name: string): ToolName {
  return normalizeShared(name, OPENCODE_TOOL_ALIASES);
}

/** OpenCode 的 shell action 只保留 source/input，不把它误拆成 argv。 */
function commandProjectionForOpenCodeTool(name: string) {
  switch (name.toLowerCase()) {
    case "bash":
    case "shell":
    case "exec":
      return opaqueCommandProjection("unsupported-protocol");
    default:
      return notCommandProjection();
  }
}

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as globalThis.Record<string, unknown>)[key] : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function num(obj: unknown, ...keys: string[]): number {
  for (const k of keys) {
    const v = get(obj, k);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

function loadedSkillName(input: JsonValue): string | undefined {
  return input && typeof input === "object" && !Array.isArray(input)
    ? str((input as globalThis.Record<string, unknown>)["name"])
    : undefined;
}

/**
 * 从 stdout / export 的 JSONL(或夹杂日志的文本)里抽出 JSON 对象行。
 */
export function extractOpenCodeJsonl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const lines = raw.split("\n").filter((line) => {
    const t = line.trim();
    return t.startsWith("{") && t.endsWith("}");
  });
  return lines.length ? lines.join("\n") : undefined;
}

/** Decode only OpenCode's fixed JSONL event and whole export shapes. */
function transcriptEntries(raw: string): unknown[] {
  try {
    return [JSON.parse(raw)];
  } catch {
    return (extractOpenCodeJsonl(raw) ?? raw).split("\n").filter((line) => line.trim()).map((line) => {
      try { return JSON.parse(line) as unknown; } catch { return undefined; }
    });
  }
}

/** `sessionID` on JSONL events; `info.id` on a session export. */
export function sessionIdFromOpenCodeTranscript(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  for (const entry of transcriptEntries(raw)) {
    const id = str(get(entry, "sessionID"))
      ?? (Array.isArray(get(entry, "messages")) ? str(get(get(entry, "info"), "id")) : undefined);
    if (id) return id;
  }
  return undefined;
}

/** OpenCode 1.18.5 JSONL / export → normalized events and observed usage. */
export function parseOpenCodeTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  const unrecognizedEvents: Record<string, number> = Object.create(null);
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let requests = 0;
  let parseSuccess = true;
  const unrecognized = (type: string): void => {
    unrecognizedEvents[type] = (unrecognizedEvents[type] ?? 0) + 1;
  };
  const addUsage = (tokens: unknown): void => {
    if (!tokens || typeof tokens !== "object") return;
    // OpenCode's input is already exclusive of cache buckets. Its cost is an
    // estimate from model metadata, not observed billing.
    inputTokens += num(tokens, "input");
    outputTokens += num(tokens, "output");
    cacheReadTokens += num(get(tokens, "cache"), "read");
    cacheCreationTokens += num(get(tokens, "cache"), "write");
    requests += 1;
  };
  const toolPart = (part: unknown): void => {
    const name = str(get(part, "tool"));
    const callId = str(get(part, "callID"));
    const state = get(part, "state");
    const status = str(get(state, "status"));
    if (!name || !callId || !["pending", "running", "completed", "error"].includes(status ?? "")) {
      parseSuccess = false;
      return;
    }
    let input = normalizeJsonValue(get(state, "input"), {});
    let tool = normalizeToolName(name);
    if (name === "apply_patch") {
      const enriched = enrichApplyPatchInput(input);
      input = enriched.input;
      tool = enriched.tool;
    }
    const skill = name === "skill" && status === "completed" ? loadedSkillName(input) : undefined;
    if (skill !== undefined) {
      events.push({ type: "skill.loaded", skill, operationId: callId });
      return;
    }
    events.push({ type: "operation.started", operationId: callId,
      operation: { kind: "tool", name, input, tool, command: commandProjectionForOpenCodeTool(name) } });
    if (status === "completed" || status === "error") {
      const exit = get(get(state, "metadata"), "exit");
      events.push({ type: "operation.finished", operationId: callId, kind: "tool",
        output: normalizeJsonValue(get(state, status === "error" ? "error" : "output"), null),
        status: status === "error" || (name === "bash" && typeof exit === "number" && exit !== 0) ? "failed" : "completed" });
    }
  };
  const partEvent = (type: string, part: unknown, role: string): void => {
    switch (type) {
      case "text": {
        const text = str(get(part, "text"));
        if (text && role === "assistant") events.push({ type: "message", role, text });
        break;
      }
      case "reasoning": {
        const text = str(get(part, "text"));
        if (text && role === "assistant") events.push({ type: "thinking", text });
        break;
      }
      case "tool": toolPart(part); break;
      case "step-start": break;
      case "step-finish": addUsage(get(part, "tokens")); break;
      default: unrecognized(`part:${type}`);
    }
  };
  for (const entry of transcriptEntries(raw ?? "")) {
    if (entry === undefined) { parseSuccess = false; continue; }
    const messages = get(entry, "messages");
    if (Array.isArray(messages) && get(entry, "info")) {
      for (const message of messages) {
        const role = str(get(get(message, "info"), "role"));
        const parts = get(message, "parts");
        if (!role || !Array.isArray(parts)) { parseSuccess = false; continue; }
        for (const part of parts) partEvent(str(get(part, "type")) ?? "<missing-type>", part, role);
      }
      continue;
    }
    const type = str(get(entry, "type"));
    const part = get(entry, "part");
    switch (type) {
      case "text": case "reasoning":
        partEvent(type, part, "assistant"); break;
      case "tool_use": toolPart(part); break;
      case "step_start": break;
      case "step_finish": addUsage(get(part, "tokens")); break;
      case "error": {
        // NamedError is the fixed protocol: some variants only carry a name.
        const error = get(entry, "error");
        const message = str(get(get(error, "data"), "message")) ?? str(get(error, "name"));
        if (message) events.push({ type: "error", message });
        else parseSuccess = false;
        break;
      }
      default: unrecognized(type ?? "<missing-type>");
    }
  }
  const usage: Usage = requests > 0 ? { inputTokens, outputTokens, requests } : {};
  if (cacheReadTokens) usage.cacheReadTokens = cacheReadTokens;
  if (cacheCreationTokens) usage.cacheCreationTokens = cacheCreationTokens;
  return { events, usage, compactions: 0, parseSuccess, unrecognizedEvents };
}
