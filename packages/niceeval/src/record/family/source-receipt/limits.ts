/**
 * Durable Observability v1 limits. These values are part of the Attachment
 * contract, so family implementations import them instead of restating
 * numeric literals beside their payload schemas or collectors.
 */

export const MAX_OBSERVABILITY_ENTITY_ID_ENTROPY_BYTES = 16;
export const OBSERVABILITY_ENTITY_ID_BASE32_LENGTH = 26;

export const MAX_SAFE_IDENTIFIER_BYTES = 64;
export const MAX_STABLE_LABEL_BYTES = 64;
export const MAX_SOURCE_NATIVE_TOOL_NAME_BYTES = 256;
export const MAX_CANONICAL_DECIMAL_BYTES = 64;
export const MAX_DIRECT_CROSS_FAMILY_REFS = 16;

export const MAX_CONVERSATION_ATTACHMENT_BYTES = 2_097_152;
export const MAX_CONVERSATION_ITEMS = 2_048;
export const MAX_CONVERSATION_TURNS = 256;
export const MAX_CONVERSATION_TEXT_BYTES = 16_384;

export const MAX_COMMANDS_ATTACHMENT_BYTES = 2_097_152;
export const MAX_COMMANDS = 256;
export const MAX_COMMANDS_CLOSURE_BYTES = 33_554_432;
export const MAX_COMMAND_EXECUTABLE_BYTES = 2_048;
export const MAX_COMMAND_SHELL_BYTES = 2_048;
export const MAX_COMMAND_ARGUMENTS = 64;
export const MAX_COMMAND_ARGUMENT_BYTES = 1_024;
export const MAX_COMMAND_PROJECT_RELATIVE_PATH_BYTES = 512;
export const MAX_COMMAND_STREAM_BYTES = 65_536;
export const MAX_COMMAND_INLINE_STREAM_BYTES = 4_096;

export const MAX_USAGE_ATTACHMENT_BYTES = 1_048_576;
export const MAX_USAGE_OBSERVATIONS = 2_048;

export const MAX_TIMING_ATTACHMENT_BYTES = 1_048_576;
export const MAX_TIMING_INTERVALS = 4_096;

export const MAX_DIAGNOSTICS_ATTACHMENT_BYTES = 524_288;
export const MAX_DIAGNOSTICS = 512;
export const MAX_DIAGNOSTIC_SUMMARY_BYTES = 1_024;
export const MAX_DIAGNOSTIC_CAUSE_SUMMARY_BYTES = 512;
export const MAX_DIAGNOSTIC_CAUSES = 8;
export const MAX_DIAGNOSTIC_CONTEXT_ITEMS = 16;

/** The family-wide caps required before a producer seals an Attachment. */
export const OBSERVABILITY_ATTACHMENT_LIMITS = Object.freeze({
  conversation: Object.freeze({
    maxPayloadBytes: MAX_CONVERSATION_ATTACHMENT_BYTES,
    maxItems: MAX_CONVERSATION_ITEMS,
    maxTurns: MAX_CONVERSATION_TURNS,
    maxClosureBytes: 0,
  }),
  commands: Object.freeze({
    maxPayloadBytes: MAX_COMMANDS_ATTACHMENT_BYTES,
    maxItems: MAX_COMMANDS,
    maxClosureBytes: MAX_COMMANDS_CLOSURE_BYTES,
  }),
  usage: Object.freeze({
    maxPayloadBytes: MAX_USAGE_ATTACHMENT_BYTES,
    maxItems: MAX_USAGE_OBSERVATIONS,
    maxClosureBytes: 0,
  }),
  timing: Object.freeze({
    maxPayloadBytes: MAX_TIMING_ATTACHMENT_BYTES,
    maxItems: MAX_TIMING_INTERVALS,
    maxClosureBytes: 0,
  }),
  diagnostics: Object.freeze({
    maxPayloadBytes: MAX_DIAGNOSTICS_ATTACHMENT_BYTES,
    maxItems: MAX_DIAGNOSTICS,
    maxClosureBytes: 0,
  }),
});
