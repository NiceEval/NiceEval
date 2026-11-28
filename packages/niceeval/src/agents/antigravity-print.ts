import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { notCommandProjection, opaqueCommandProjection } from "../o11y/command-projection.ts";
import { field, jsonField, nonEmptyString, unrecognized } from "../o11y/parsers/shared.ts";
import { addUsage } from "../o11y/parsers/usage.ts";
import { normalizeToolName } from "../o11y/tool-names.ts";
import type { ToolName } from "../o11y/types.ts";
import type { StreamEvent, Usage } from "../types.ts";

const Frame = Schema.Struct({
  event: Schema.NonEmptyString,
  conversation_id: nonEmptyString,
  step_update: jsonField,
  result: jsonField,
});
const TokenCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const StepUsage = Schema.Struct({
  input_tokens: field(TokenCount),
  output_tokens: field(TokenCount),
  cache_read_tokens: field(TokenCount),
});
const Step = Schema.Struct({
  conversation_id: Schema.NonEmptyString,
  step_index: TokenCount,
  step_type: Schema.NonEmptyString,
  state: Schema.NonEmptyString,
  text_delta: field(Schema.String),
  usage: field(StepUsage),
  tool_name: nonEmptyString,
  tool_info: field(
    Schema.Struct({
      name: nonEmptyString,
      parameters: jsonField,
      error: field(Schema.Struct({ type: nonEmptyString, message: nonEmptyString })),
    }),
  ),
});
const Terminal = Schema.Struct({
  conversation_id: nonEmptyString,
  status: Schema.NonEmptyString,
  finished_reason: field(Schema.Unknown),
  response: field(Schema.String),
  error: nonEmptyString,
});

const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(Frame));
const decodeStep = Schema.decodeUnknownOption(Step);
const decodeTerminal = Schema.decodeUnknownOption(Terminal);

const TOOL_ALIASES: Record<string, ToolName> = {
  find_by_name: "glob",
  grep_search: "grep",
  view_file: "file_read",
  view_file_outline: "file_read",
  write_to_file: "file_write",
  replace_file_content: "file_edit",
  multi_replace_file_content: "file_edit",
  search_web: "web_search",
  read_url_content: "web_fetch",
};

// @concord-code
// @concord-implements docs/feature/adapters/library/sdk/agy/README.md
// @concord-implements docs/feature/adapters/library/sdk/agy/cost.md
export function parseAntigravityPrint(stdout: string) {
  const events: StreamEvent[] = [];
  const unrecognizedEvents: Record<string, number> = Object.create(null);
  const toolSteps = new Map<string, "active" | "done">();
  const modelSteps = new Map<string, typeof StepUsage.Type | undefined>();
  let accepted = false;
  let sawDelta = false;
  let missingToolLifecycle = false;
  let malformedLine: number | undefined;
  let terminal: typeof Terminal.Type | undefined;
  let sessionId: string | undefined;

  for (const [index, line] of stdout.split("\n").entries()) {
    if (!line.trim()) continue;
    const decoded = decodeFrame(line);
    if (Option.isNone(decoded)) {
      malformedLine ??= index + 1;
      continue;
    }
    const frame = decoded.value;
    if (frame.event === "init") {
      sessionId ??= frame.conversation_id;
      continue;
    }
    if (frame.event === "result") {
      const result = decodeTerminal(frame.result);
      if (Option.isNone(result) || terminal !== undefined) {
        malformedLine ??= index + 1;
      } else {
        terminal = result.value;
        sessionId ??= terminal.conversation_id;
      }
      continue;
    }
    if (frame.event !== "step_update") {
      unrecognized(unrecognizedEvents, frame.event);
      continue;
    }
    const decodedStep = decodeStep(frame.step_update);
    if (Option.isNone(decodedStep)) {
      malformedLine ??= index + 1;
      continue;
    }
    const step = decodedStep.value;
    const stepId = JSON.stringify([step.conversation_id, step.step_index]);
    switch (step.step_type) {
      case "user_input":
        accepted = true;
        break;
      case "agent_response":
        accepted = true;
        if (step.text_delta !== undefined) {
          sawDelta = true;
          events.push({ type: "message", role: "assistant", text: step.text_delta });
        }
        // ACTIVE and DONE can both report on the same model step.
        if (step.usage !== undefined || !modelSteps.has(stepId)) modelSteps.set(stepId, step.usage);
        break;
      case "tool": {
        accepted = true;
        if (step.state === "ACTIVE") {
          if (toolSteps.has(stepId)) break;
          const name = step.tool_info?.name ?? step.tool_name;
          const input = step.tool_info?.parameters;
          if (name === undefined || input === undefined) {
            missingToolLifecycle = true;
            break;
          }
          toolSteps.set(stepId, "active");
          const tool = normalizeToolName(name, TOOL_ALIASES);
          const command =
            tool === "shell"
              ? opaqueCommandProjection("unsupported-protocol")
              : tool === "unknown"
                ? undefined
                : notCommandProjection();
          events.push({
            type: "operation.started",
            operationId: stepId,
            operation: { kind: "tool", name, input, tool, command },
          });
        } else if (step.state === "DONE") {
          const error = step.tool_info?.error;
          if (error !== undefined && toolSteps.get(stepId) !== "done") {
            events.push({
              type: "error",
              message: error.message ?? error.type ?? "Antigravity reported a tool error.",
            });
          }
          if (toolSteps.get(stepId) !== "active") {
            missingToolLifecycle ||= !toolSteps.has(stepId);
            break;
          }
          toolSteps.set(stepId, "done");
          // Print sometimes returns only a summary. Leave output unavailable to matchers.
          events.push({
            type: "operation.finished",
            operationId: stepId,
            kind: "tool",
            status: error === undefined ? "completed" : "failed",
          });
        } else {
          unrecognized(unrecognizedEvents, `step_update:tool:${step.state}`);
        }
        break;
      }
      default:
        unrecognized(unrecognizedEvents, `step_update:${step.step_type}`);
    }
  }

  if (!sawDelta && terminal?.response) {
    accepted = true;
    events.push({ type: "message", role: "assistant", text: terminal.response });
  }
  if (terminal?.error !== undefined) events.push({ type: "error", message: terminal.error });

  const usage: Usage = {};
  let missingUsage = false;
  for (const observation of modelSteps.values()) {
    if (observation === undefined) {
      missingUsage = true;
      continue;
    }
    const { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_tokens: cacheReadTokens } = observation;
    missingUsage ||= inputTokens === undefined || outputTokens === undefined || cacheReadTokens === undefined;
    addUsage(usage, { inputTokens, outputTokens, cacheReadTokens, requests: 1 });
  }
  return {
    accepted,
    events,
    terminal,
    malformedLine,
    sessionId,
    unrecognizedEvents,
    missingToolLifecycle: missingToolLifecycle || [...toolSteps.values()].includes("active"),
    usage: usage.requests === undefined ? undefined : usage,
    missingUsage,
  };
}
