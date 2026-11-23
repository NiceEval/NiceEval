import * as Schema from "effect/Schema";
import type { Usage } from "../../types.ts";
import { field } from "./shared.ts";

const token = field(Schema.Finite);
const cached = Schema.Struct({ cached_tokens: token });
const reasoning = Schema.Struct({ reasoning_tokens: token });

/** Protocol names stay at the decoding boundary, including reported zeroes. */
export const TokenUsage = Schema.Struct({
  input_tokens: token,
  prompt_tokens: token,
  inputTokens: token,
  promptTokens: token,
  input: token,
  output_tokens: token,
  completion_tokens: token,
  outputTokens: token,
  completionTokens: token,
  output: token,
  cached_input_tokens: token,
  cached_tokens: token,
  cache_read_input_tokens: token,
  cache_read_tokens: token,
  cacheReadTokens: token,
  cacheRead: token,
  cache_creation_input_tokens: token,
  cache_write_tokens: token,
  cacheWriteTokens: token,
  cacheCreationTokens: token,
  cacheWrite: token,
  reasoning_output_tokens: token,
  reasoning_tokens: token,
  reasoningOutputTokens: token,
  reasoningTokens: token,
  prompt_tokens_details: field(cached),
  input_tokens_details: field(cached),
  output_tokens_details: field(reasoning),
  completion_tokens_details: field(reasoning),
  cache_creation: field(Schema.Struct({ ephemeral_5m_input_tokens: token, ephemeral_1h_input_tokens: token })),
  cache: field(Schema.Struct({ read: token, write: token })),
  cost: field(Schema.Union([Schema.Finite, Schema.Struct({ total: token })])),
  actual_cost_usd: token,
  actualCostUsd: token,
  api_call_count: token,
  apiCallCount: token,
});

type Protocol = "codex" | "claude-code" | "bub" | "hermes" | "openclaw" | "opencode";
type Tokens = typeof TokenUsage.Type;

function sumReported(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left + right;
}

/** One normalization owner, with protocol-specific cache and request evidence. */
export function normalizeUsage(protocol: Protocol, value: Tokens): Usage {
  const usage: Usage = {};
  let input: number | undefined;
  let output: number | undefined;
  let cacheRead: number | undefined;
  let cacheCreation: number | undefined;
  let reasoning: number | undefined;
  let cost: number | undefined;
  let requests: number | undefined;
  switch (protocol) {
    case "codex":
      input = value.input_tokens ?? value.prompt_tokens ?? value.inputTokens ?? value.promptTokens;
      output = value.output_tokens ?? value.completion_tokens ?? value.outputTokens ?? value.completionTokens;
      cacheRead =
        value.cached_input_tokens ??
        value.cache_read_input_tokens ??
        value.cache_read_tokens ??
        value.cacheReadTokens ??
        value.input_tokens_details?.cached_tokens ??
        value.prompt_tokens_details?.cached_tokens;
      reasoning =
        value.reasoning_output_tokens ??
        value.reasoning_tokens ??
        value.reasoningOutputTokens ??
        value.reasoningTokens ??
        value.output_tokens_details?.reasoning_tokens ??
        value.completion_tokens_details?.reasoning_tokens;
      break;
    case "claude-code":
      input = value.input_tokens ?? value.prompt_tokens ?? value.inputTokens;
      output = value.output_tokens ?? value.completion_tokens ?? value.outputTokens;
      cacheRead = value.cache_read_input_tokens ?? value.cached_input_tokens ?? value.cache_read_tokens;
      cacheCreation = value.cache_creation_input_tokens;
      if (cacheCreation === undefined && value.cache_creation !== undefined) {
        cacheCreation = sumReported(
          value.cache_creation.ephemeral_5m_input_tokens,
          value.cache_creation.ephemeral_1h_input_tokens,
        );
      }
      requests = 1; // claude-code/cost.md: each usage-bearing message is a real request.
      break;
    case "bub":
      input = value.input_tokens;
      output = value.output_tokens;
      cacheRead = value.cached_tokens;
      cacheCreation = value.cache_write_tokens;
      reasoning = value.reasoning_tokens;
      if (input !== undefined) input = Math.max(0, input - (cacheRead ?? 0) - (cacheCreation ?? 0));
      break;
    case "hermes":
      input = value.input_tokens ?? value.inputTokens;
      output = value.output_tokens ?? value.outputTokens;
      cacheRead = value.cache_read_tokens ?? value.cacheReadTokens;
      cacheCreation = value.cache_write_tokens ?? value.cacheWriteTokens ?? value.cacheCreationTokens;
      cost = value.actual_cost_usd ?? value.actualCostUsd;
      requests = value.api_call_count ?? value.apiCallCount;
      break;
    case "openclaw":
      input = value.input ?? value.input_tokens ?? value.inputTokens ?? value.prompt_tokens;
      output = value.output ?? value.output_tokens ?? value.outputTokens ?? value.completion_tokens;
      cacheRead = value.cacheRead ?? value.cache_read_input_tokens ?? value.cacheReadTokens;
      cacheCreation = value.cacheWrite ?? value.cache_creation_input_tokens ?? value.cacheCreationTokens;
      break;
    case "opencode":
      input = value.input;
      output = value.output;
      cacheRead = value.cache?.read;
      cacheCreation = value.cache?.write;
      requests = 1; // opencode/cost.md: step-finish usage is one real request.
      break;
  }
  // An absent cache measurement does not supply another bucket; a reported
  // subset is subtracted only when the enclosing input measurement exists.
  if (protocol === "codex" && input !== undefined) {
    const uncached = cacheRead === undefined ? input : input - cacheRead;
    input = Math.max(0, uncached);
  }
  if (input !== undefined) usage.inputTokens = input;
  if (output !== undefined) usage.outputTokens = output;
  if (cacheRead !== undefined) usage.cacheReadTokens = cacheRead;
  if (cacheCreation !== undefined) usage.cacheCreationTokens = cacheCreation;
  if (reasoning !== undefined) usage.reasoningTokens = reasoning;
  if (requests !== undefined) usage.requests = requests;
  if (cost !== undefined) usage.costUSD = cost;
  return usage;
}

/** Addition never turns an unreported bucket into zero. */
export function addUsage(total: Usage, next: Usage): void {
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheCreationTokens",
    "reasoningTokens",
    "requests",
    "costUSD",
  ] as const) {
    const value = next[key];
    if (value !== undefined) total[key] = (total[key] ?? 0) + value;
  }
}

/** Stable output key order belongs to the transcript boundary, not arrival order. */
export function transcriptUsage(protocol: Protocol, total: Usage): Usage {
  const usage: Usage = {};
  let keys: readonly (keyof Usage)[];
  switch (protocol) {
    case "hermes":
      keys = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "costUSD", "requests"];
      break;
    case "opencode":
      keys = ["inputTokens", "outputTokens", "requests", "cacheReadTokens", "cacheCreationTokens"];
      break;
    default:
      keys = [
        "inputTokens",
        "outputTokens",
        "cacheReadTokens",
        "cacheCreationTokens",
        "reasoningTokens",
        "requests",
        "costUSD",
      ];
  }
  for (const key of keys) {
    const value = total[key];
    if (value !== undefined) usage[key] = value;
  }
  return usage;
}
