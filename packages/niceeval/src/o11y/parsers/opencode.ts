// OpenCode 1.18.5 JSONL and whole-session export protocol boundary.
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import type { StreamEvent, Usage, ToolName, JsonValue } from "../../types.ts";
import type { ParsedTranscript } from "./index.ts";
import { GENERIC_VERB_ALIASES, normalizeToolName as normalizeShared } from "../tool-names.ts";
import { notCommandProjection, opaqueCommandProjection } from "../command-projection.ts";
import { assertNever, field, jsonField, lineDecoder, nonEmptyString, unrecognized, UnknownPart } from "./shared.ts";
import { addUsage, normalizeUsage, TokenUsage, transcriptUsage } from "./usage.ts";

export const OPENCODE_TOOL_ALIASES: globalThis.Record<string, ToolName> = {
  ...GENERIC_VERB_ALIASES,
  read: "file_read",
  write: "file_write",
  create: "file_write",
  edit: "file_edit",
  patch: "file_edit",
  apply_patch: "file_edit",
  bash: "shell",
  shell: "shell",
  webfetch: "web_fetch",
  websearch: "web_search",
};

const string = nonEmptyString;
const json = field(Schema.MutableJson);
const TextPart = Schema.Struct({ text: string });
const ToolPart = Schema.Struct({
  tool: Schema.NonEmptyString,
  callID: Schema.NonEmptyString,
  state: Schema.Struct({
    status: Schema.Literals(["pending", "running", "completed", "error"]),
    input: jsonField,
    output: json,
    error: json,
    metadata: field(Schema.Struct({ exit: field(Schema.Finite) })),
  }),
});
const FinishPart = Schema.Struct({ tokens: field(TokenUsage) });
const Part = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["text", "reasoning"]), ...TextPart.fields }),
  Schema.Struct({ type: Schema.Literal("tool"), ...ToolPart.fields }),
  Schema.Struct({ type: Schema.Literal("step-start") }),
  Schema.Struct({ type: Schema.Literal("step-finish"), ...FinishPart.fields }),
  UnknownPart,
]);
const Session = Schema.Struct({
  info: Schema.Struct({ id: string }),
  messages: Schema.Array(
    Schema.Struct({ info: Schema.Struct({ role: Schema.NonEmptyString }), parts: Schema.Array(Part) }),
  ),
});
const ExportEvent = Schema.Struct({ type: Schema.Literal("export"), session: Schema.toType(Session) });
const sessionID = string;
const OpenCodeEvent = Schema.Union([
  Session.pipe(
    Schema.decodeTo(ExportEvent, {
      decode: SchemaGetter.transform((session) => ({ type: "export" as const, session })),
      encode: SchemaGetter.transform((event) => event.session),
    }),
  ),
  Schema.Struct({ type: Schema.Literals(["text", "reasoning"]), sessionID, part: TextPart }),
  Schema.Struct({ type: Schema.Literal("tool_use"), sessionID, part: ToolPart }),
  Schema.Struct({ type: Schema.Literal("step_start"), sessionID }),
  Schema.Struct({ type: Schema.Literal("step_finish"), sessionID, part: FinishPart }),
  Schema.Struct({
    type: Schema.Literal("error"),
    sessionID,
    error: Schema.Struct({
      name: string,
      data: field(Schema.Struct({ message: string, statusCode: field(Schema.Unknown) })),
    }),
  }),
]);
const decodeLine = lineDecoder(OpenCodeEvent);

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

function enrichApplyPatchInput(input: JsonValue): { readonly input: JsonValue; readonly tool: ToolName } {
  const object: Record<string, JsonValue> =
    input !== null && typeof input === "object" && !Array.isArray(input) ? { ...input } : { patchText: input };
  const patchText = typeof object.patchText === "string" ? object.patchText : "";
  const add = patchText.match(/\*\*\*\s*Add File:\s*(.+)/);
  const update = patchText.match(/\*\*\*\s*(?:Update|Delete) File:\s*(.+)/);
  const path = (add?.[1] ?? update?.[1] ?? "").trim();
  if (path) object.path = path;
  return { input: object, tool: add ? "file_write" : "file_edit" };
}

function loadedSkillName(input: JsonValue): string | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const name = input.name;
  return typeof name === "string" && name ? name : undefined;
}

export function extractOpenCodeJsonl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const lines = raw.split("\n").filter((line) => {
    const value = line.trim();
    return value.startsWith("{") && value.endsWith("}");
  });
  return lines.length ? lines.join("\n") : undefined;
}

function transcriptEntries(raw: string): ReturnType<typeof decodeLine>[] {
  if (!raw.trim()) return [];
  const document = decodeLine(raw);
  if (document.kind !== "invalid-json" || !raw.includes("\n")) return [document];
  return (extractOpenCodeJsonl(raw) ?? raw)
    .split("\n")
    .filter((line) => line.trim())
    .map(decodeLine);
}

export function sessionIdFromOpenCodeTranscript(raw: string | undefined): string | undefined {
  for (const decoded of transcriptEntries(raw ?? "")) {
    if (decoded.kind !== "decoded") continue;
    const event = decoded.value;
    const id = event.type === "export" ? event.session.info.id : event.sessionID;
    if (id !== undefined) return id;
  }
  return undefined;
}

type OpenCodeUpstreamFailure = { readonly reason: string | undefined; readonly httpStatus: unknown };

export function parseOpenCodeTranscript(
  raw: string | undefined,
): ParsedTranscript & { readonly upstreamFailure: OpenCodeUpstreamFailure | undefined } {
  const events: StreamEvent[] = [];
  const usage: Usage = {};
  const unrecognizedEvents: Record<string, number> = Object.create(null);
  let parseSuccess = true;
  let upstreamFailure: OpenCodeUpstreamFailure | undefined;
  const toolPart = (part: typeof ToolPart.Type): void => {
    const { tool: name, callID: callId, state } = part;
    let input: JsonValue = state.input === undefined ? {} : state.input;
    let tool = normalizeShared(name, OPENCODE_TOOL_ALIASES);
    if (name === "apply_patch") {
      const enriched = enrichApplyPatchInput(input);
      input = enriched.input;
      tool = enriched.tool;
    }
    const skill = name === "skill" && state.status === "completed" ? loadedSkillName(input) : undefined;
    if (skill !== undefined) {
      events.push({ type: "skill.loaded", skill, operationId: callId });
      return;
    }
    events.push({
      type: "operation.started",
      operationId: callId,
      operation: { kind: "tool", name, input, tool, command: commandProjectionForOpenCodeTool(name) },
    });
    switch (state.status) {
      case "pending":
      case "running":
        return;
      case "completed":
      case "error":
        events.push({
          type: "operation.finished",
          operationId: callId,
          kind: "tool",
          output: (state.status === "error" ? state.error : state.output) ?? null,
          status:
            state.status === "error" ||
            (name === "bash" && state.metadata?.exit !== undefined && state.metadata.exit !== 0)
              ? "failed"
              : "completed",
        });
        return;
      default:
        assertNever(state.status);
    }
  };
  const partEvent = (part: typeof Part.Type, role: string): void => {
    switch (part.type) {
      case "text":
        if (part.text && role === "assistant") events.push({ type: "message", role, text: part.text });
        break;
      case "reasoning":
        if (part.text && role === "assistant") events.push({ type: "thinking", text: part.text });
        break;
      case "tool":
        toolPart(part);
        break;
      case "step-start":
        break;
      case "step-finish":
        if (part.tokens !== undefined) addUsage(usage, normalizeUsage("opencode", part.tokens));
        break;
      case "<unrecognized>":
        unrecognized(unrecognizedEvents, `part:${part.originalType ?? "<missing-type>"}`);
        break;
      default:
        assertNever(part);
    }
  };
  for (const decoded of transcriptEntries(raw ?? "")) {
    if (decoded.kind === "invalid-json") {
      parseSuccess = false;
      unrecognized(unrecognizedEvents, "<missing-kind>");
      continue;
    }
    if (decoded.kind === "unrecognized") {
      unrecognized(unrecognizedEvents, decoded.type);
      if (decoded.type === "tool_use" || decoded.type === "error") parseSuccess = false;
      continue;
    }
    const event = decoded.value;
    switch (event.type) {
      case "export":
        for (const message of event.session.messages)
          for (const part of message.parts) partEvent(part, message.info.role);
        break;
      case "text":
      case "reasoning":
        partEvent({ type: event.type, text: event.part.text }, "assistant");
        break;
      case "tool_use":
        toolPart(event.part);
        break;
      case "step_start":
        break;
      case "step_finish":
        if (event.part.tokens !== undefined) addUsage(usage, normalizeUsage("opencode", event.part.tokens));
        break;
      case "error": {
        if (event.error.name !== undefined || event.error.data?.statusCode !== undefined) {
          upstreamFailure = { reason: event.error.name, httpStatus: event.error.data?.statusCode };
        }
        const message = event.error.data?.message ?? event.error.name;
        if (message) events.push({ type: "error", message });
        else parseSuccess = false;
        break;
      }
      default:
        assertNever(event);
    }
  }
  return {
    events,
    usage: transcriptUsage("opencode", usage),
    compactions: 0,
    parseSuccess,
    unrecognizedEvents,
    upstreamFailure,
  };
}
