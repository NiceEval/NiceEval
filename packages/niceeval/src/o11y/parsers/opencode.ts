// OpenCode `run --format json` / `opencode export` 解析器。方言只住这里,不进 core
// (契约见 docs/feature/adapters/sdk/opencode/README.md)。

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
  const patchText = typeof obj.patchText === "string" ? obj.patchText : typeof obj.patch === "string" ? obj.patch : "";
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

/** 事件行上的 sessionID / sessionId。 */
export function sessionIdFromOpenCodeTranscript(raw: string | undefined): string | undefined {
  const jsonl = extractOpenCodeJsonl(raw) ?? raw;
  if (!jsonl) return undefined;
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t) as globalThis.Record<string, unknown>;
      const id = str(obj.sessionID) ?? str(obj.sessionId) ?? str(get(obj, "session_id"));
      if (id) return id;
    } catch {
      // skip
    }
  }
  return undefined;
}

/**
 * OpenCode JSON 事件流 → 标准事件 + usage。
 * 认 `tool_use` / `text` / `step_finish` 主路径,并兼容少量 legacy 形状。
 */
export function parseOpenCodeTranscript(raw: string | undefined): ParsedTranscript {
  const events: StreamEvent[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let requests = 0;
  let parseSuccess = true;
  let synth = 0;
  const nextSynthId = (): string => `oc_${++synth}`;
  const pending: string[] = [];

  const jsonl = extractOpenCodeJsonl(raw) ?? raw;
  if (!jsonl?.trim()) {
    return { events, usage: {}, compactions: 0, parseSuccess: true };
  }

  const addUsage = (usage: unknown): void => {
    if (!usage || typeof usage !== "object") return;
    // OpenCode derives its cost fields from model metadata. Keep only the
    // recorded usage facts; Usage.costUSD is reserved for observed billing.
    const rawInput = num(usage, "input", "input_tokens", "inputTokens", "prompt_tokens");
    const output = num(usage, "output", "output_tokens", "outputTokens", "completion_tokens");
    let cacheRead = num(usage, "cacheRead", "cache_read", "cache_read_input_tokens", "cacheReadTokens");
    if (cacheRead === 0) cacheRead = num(get(usage, "prompt_tokens_details"), "cached_tokens");
    const cacheCreation = num(usage, "cacheWrite", "cache_write", "cache_creation_input_tokens");
    if (rawInput === 0 && output === 0 && cacheRead === 0 && cacheCreation === 0) return;
    // Chat Completions 口径的 prompt_tokens 可能含缓存命中
    const input = Math.max(0, rawInput - cacheRead);
    inputTokens += input;
    outputTokens += output;
    cacheReadTokens += cacheRead;
    cacheCreationTokens += cacheCreation;
    requests += 1;
  };

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let data: globalThis.Record<string, unknown>;
    try {
      data = JSON.parse(trimmed) as globalThis.Record<string, unknown>;
    } catch {
      parseSuccess = false;
      continue;
    }

    try {
      const eventType = str(data.type) ?? str(data.kind) ?? str(data.event);
      const part = get(data, "part") as globalThis.Record<string, unknown> | undefined;
      const state = part ? (get(part, "state") as globalThis.Record<string, unknown> | undefined) : undefined;

      if (eventType === "tool_use" && part && str(get(part, "tool"))) {
        const name = str(get(part, "tool"))!;
        let input = coerceArgs(get(state, "input") ?? get(part, "input"));
        let tool = normalizeToolName(name);
        if (name.toLowerCase() === "apply_patch" || name.toLowerCase() === "patch") {
          const enriched = enrichApplyPatchInput(input);
          input = enriched.input;
          tool = enriched.tool;
        }
        const callId =
          str(get(part, "callID")) ??
          str(get(part, "callId")) ??
          str(get(part, "id")) ??
          str(get(data, "id")) ??
          nextSynthId();
        const skill = name.toLowerCase() === "skill" ? loadedSkillName(input) : undefined;
        if (skill !== undefined) {
          events.push({ type: "skill.loaded", skill, operationId: callId });
          continue;
        }
        if (!str(get(part, "callID")) && !str(get(part, "callId")) && !str(get(part, "id"))) {
          pending.push(callId);
        }
        events.push({
          type: "operation.started",
          operationId: callId,
          operation: {
            kind: "tool",
            name,
            input,
            tool,
            command: commandProjectionForOpenCodeTool(name),
          },
        });
        const status = str(get(state, "status"));
        if (status === "completed" || status === "error" || get(state, "output") !== undefined) {
          const output = (get(state, "output") ?? get(state, "error") ?? null) as JsonValue;
          const metadata = get(state, "metadata") as globalThis.Record<string, unknown> | undefined;
          const exitCode = typeof get(metadata, "exit") === "number" ? (get(metadata, "exit") as number) : undefined;
          const isShell = ["bash", "shell", "exec"].includes(name.toLowerCase());
          const success = isShell
            ? exitCode === 0 || exitCode === undefined
            : status !== "error" && !get(state, "error");
          events.push({
            type: "operation.finished",
            operationId: callId,
            kind: "tool",
            output,
            status: success ? "completed" : "failed",
          });
        }
        continue;
      }

      if (eventType === "text") {
        const text = str(get(part, "text")) ?? str(data.text) ?? str(data.content);
        if (text?.trim()) events.push({ type: "message", role: "assistant", text });
        continue;
      }

      if (eventType === "step_finish" || eventType === "step_start") {
        // OpenCode 1.18 把 token 用量放在 part.tokens({input,output,...})。
        // part.cost 是目录价格推导值，不能进入 observed Usage。
        const tokens = get(part, "tokens") ?? get(data, "tokens");
        if (tokens && typeof tokens === "object") {
          addUsage(tokens);
        } else {
          addUsage(get(data, "usage") ?? get(part, "usage") ?? get(state, "usage"));
        }
        continue;
      }

      if (eventType === "message" || eventType === "assistant" || eventType === "response") {
        const text =
          str(get(get(data, "message"), "content")) ?? str(data.content) ?? str(data.text);
        if (text?.trim()) events.push({ type: "message", role: "assistant", text });
        addUsage(get(data, "usage"));
        continue;
      }

      if (eventType === "error") {
        const message =
          str(get(get(data, "error"), "message")) ?? str(data.message) ?? str(data.content) ?? "opencode error";
        events.push({ type: "error", message });
        continue;
      }

      // export 形态:顶层 messages[]
      const messages = get(data, "messages");
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          const info = get(msg, "info") as globalThis.Record<string, unknown> | undefined;
          const role = str(get(info, "role")) ?? str(get(msg, "role"));
          const parts = get(msg, "parts");
          if (Array.isArray(parts)) {
            for (const p of parts) {
              const pType = str(get(p, "type"));
              if (pType === "text") {
                const text = str(get(p, "text"));
                if (text?.trim() && role !== "user") {
                  events.push({ type: "message", role: "assistant", text });
                }
              } else if (pType === "tool" || pType === "tool_use") {
                const name = str(get(p, "tool")) ?? str(get(p, "name")) ?? "unknown";
                const callId = str(get(p, "callID")) ?? str(get(p, "id")) ?? nextSynthId();
                const input = coerceArgs(get(get(p, "state"), "input") ?? get(p, "input"));
                const skill = name.toLowerCase() === "skill" ? loadedSkillName(input) : undefined;
                if (skill !== undefined) {
                  events.push({ type: "skill.loaded", skill, operationId: callId });
                  continue;
                }
                events.push({
                  type: "operation.started",
                  operationId: callId,
                  operation: {
                    kind: "tool",
                    name,
                    input,
                    tool: normalizeToolName(name),
                    command: commandProjectionForOpenCodeTool(name),
                  },
                });
                const st = get(p, "state") as globalThis.Record<string, unknown> | undefined;
                if (st && (str(get(st, "status")) === "completed" || get(st, "output") !== undefined)) {
                  events.push({
                    type: "operation.finished",
                    operationId: callId,
                    kind: "tool",
                    output: (get(st, "output") ?? null) as JsonValue,
                    status: str(get(st, "status")) === "error" ? "failed" : "completed",
                  });
                }
              }
            }
          } else {
            const text = str(get(msg, "content")) ?? str(get(msg, "text"));
            if (text?.trim() && role !== "user") {
              events.push({ type: "message", role: "assistant", text });
            }
          }
          addUsage(get(info, "usage") ?? get(msg, "usage"));
        }
      }
    } catch {
      parseSuccess = false;
    }
  }

  const usage: Usage = {};
  if (inputTokens) usage.inputTokens = inputTokens;
  if (outputTokens) usage.outputTokens = outputTokens;
  if (cacheReadTokens) usage.cacheReadTokens = cacheReadTokens;
  if (cacheCreationTokens) usage.cacheCreationTokens = cacheCreationTokens;
  if (requests) usage.requests = requests;

  return { events, usage, compactions: 0, parseSuccess };
}
