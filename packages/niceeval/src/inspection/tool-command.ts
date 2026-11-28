import * as Schema from "effect/Schema";

import type { ObservedToolCommand } from "../o11y/observed.ts";
import { isToolOccurrenceId, type ToolOccurrenceId } from "../record/family/source-receipt/model.ts";
import { utf8ByteLength } from "./bytes.ts";

const TOOL_COMMAND_PREVIEW_BYTES = 1_024;
const TOOL_COMMAND_INLINE_BYTES = 16 * 1_024;
const TOOL_COMMAND_EVIDENCE_PREFIX = "ev_argv_";

type CommandNormalization = "identity" | "pnpm-exec" | "npx";

const ToolCommandNormalizationSchema = Schema.Literals(["identity", "pnpm-exec", "npx"]);
const ToolCommandAvailableFields = {
  kind: Schema.Literal("command"),
  state: Schema.Literal("available"),
  normalization: ToolCommandNormalizationSchema,
} as const;
const ToolCommandUnresolvedSchemas = [
  Schema.Struct({ kind: Schema.Literal("unclassified") }),
  Schema.Struct({ kind: Schema.Literal("not-command") }),
  Schema.Struct({ kind: Schema.Literal("command"), state: Schema.Literal("opaque"), reason: Schema.String }),
] as const;
export const InspectionToolCommandPreviewSchema = Schema.Union([
  ...ToolCommandUnresolvedSchemas,
  Schema.Struct({
    ...ToolCommandAvailableFields,
    argv: Schema.Struct({
      preview: Schema.String,
      omittedBytes: Schema.Number,
      evidenceId: Schema.optionalKey(Schema.String),
    }),
  }),
]);
export const InspectionToolCommandDetailSchema = Schema.Union([
  ...ToolCommandUnresolvedSchemas,
  Schema.Struct({
    ...ToolCommandAvailableFields,
    executable: Schema.String,
    args: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    ...ToolCommandAvailableFields,
    preview: Schema.String,
    content: Schema.Struct({ evidenceId: Schema.String, byteLength: Schema.Number }),
  }),
]);

export type InspectionToolCommandPreview = Schema.Schema.Type<typeof InspectionToolCommandPreviewSchema>;
export type InspectionToolCommandDetail = Schema.Schema.Type<typeof InspectionToolCommandDetailSchema>;

type AvailableCommand = Extract<
  Extract<ObservedToolCommand, { readonly kind: "command" }>["logical"],
  { readonly state: "available" }
>;
type UnresolvedCommand = Exclude<InspectionToolCommandPreview, { readonly state: "available" }>;

function classify(command: ObservedToolCommand | undefined): UnresolvedCommand | AvailableCommand {
  if (command === undefined) return { kind: "unclassified" };
  if (command.kind === "not-command") return command;
  const logical = command.logical;
  if (logical.state === "available") return logical;
  return {
    kind: "command",
    state: "opaque",
    reason: logical.reason === "original-opaque" ? logical.originalReason : logical.reason,
  };
}

function evidenceIdForToolCommand(toolOccurrenceId: ToolOccurrenceId): string {
  return TOOL_COMMAND_EVIDENCE_PREFIX + toolOccurrenceId;
}

export function toolOccurrenceForCommandEvidence(evidenceId: string): ToolOccurrenceId | undefined {
  if (!evidenceId.startsWith(TOOL_COMMAND_EVIDENCE_PREFIX)) return undefined;
  const occurrence = evidenceId.slice(TOOL_COMMAND_EVIDENCE_PREFIX.length);
  return isToolOccurrenceId(occurrence) ? occurrence : undefined;
}

export function toolCommandBytes(logical: AvailableCommand): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(logical));
}

export function toolCommandPreview(
  command: ObservedToolCommand | undefined,
  toolOccurrenceId: ToolOccurrenceId,
): InspectionToolCommandPreview {
  const logical = classify(command);
  if ("kind" in logical) return logical;
  const argv = boundedPreview(formatArgv(logical.executable, logical.args), TOOL_COMMAND_PREVIEW_BYTES);
  return {
    kind: "command",
    state: "available",
    normalization: logical.normalization,
    argv: {
      ...argv,
      ...(argv.omittedBytes === 0 ? {} : { evidenceId: evidenceIdForToolCommand(toolOccurrenceId) }),
    },
  };
}

export function toolCommandDetail(
  command: ObservedToolCommand | undefined,
  toolOccurrenceId: ToolOccurrenceId,
  inlineBytes = TOOL_COMMAND_INLINE_BYTES,
): InspectionToolCommandDetail {
  const logical = classify(command);
  if ("kind" in logical) return logical;
  const byteLength = toolCommandBytes(logical).byteLength;
  if (byteLength <= inlineBytes) return { kind: "command", ...logical };
  return {
    kind: "command",
    state: "available",
    normalization: logical.normalization,
    preview: boundedPreview(formatArgv(logical.executable, logical.args), TOOL_COMMAND_PREVIEW_BYTES).preview,
    content: { evidenceId: evidenceIdForToolCommand(toolOccurrenceId), byteLength },
  };
}

/** Tokens that need quoting use POSIX single quotes. */
function formatArgv(executable: string, args: readonly string[]): string {
  return [executable, ...args].map(quoteToken).join(" ");
}

/** Human-readable text of a classification, used for ledger detail fields. */
export function toolCommandText(detail: InspectionToolCommandDetail | InspectionToolCommandPreview): string {
  switch (detail.kind) {
    case "unclassified":
      return "unclassified";
    case "not-command":
      return "not a command";
    case "command":
      if (detail.state === "opaque") return `opaque command (${detail.reason})`;
      if ("argv" in detail) {
        return detail.argv.omittedBytes === 0 ? detail.argv.preview : `${detail.argv.preview}…`;
      }
      if ("content" in detail) return `${detail.preview}…${normalizationSuffix(detail.normalization)}`;
      return `${formatArgv(detail.executable, detail.args)}${normalizationSuffix(detail.normalization)}`;
  }
}

/** Names a wrapper removed by logical normalization. */
export function normalizationSuffix(normalization: CommandNormalization): string {
  return normalization === "identity" ? "" : ` (via ${normalization === "pnpm-exec" ? "pnpm exec" : "npx"})`;
}

function quoteToken(token: string): string {
  if (token.length > 0 && /^[A-Za-z0-9_@%+=:,./-]+$/u.test(token)) return token;
  return `'${token.replaceAll("'", `'"'"'`)}'`;
}

function boundedPreview(
  value: string,
  maximumBytes: number,
): { readonly preview: string; readonly omittedBytes: number } {
  const total = utf8ByteLength(value);
  if (total <= maximumBytes) return { preview: value, omittedBytes: 0 };
  let preview = "";
  let bytes = 0;
  for (const character of value) {
    const size = utf8ByteLength(character);
    if (bytes + size > maximumBytes) break;
    preview += character;
    bytes += size;
  }
  return { preview, omittedBytes: total - bytes };
}
