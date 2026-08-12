/**
 * Durable Observability v1 limits. These values are part of the Attachment
 * contract, so family implementations import them instead of restating
 * numeric literals beside their payload schemas or collectors.
 */

export const MAX_OBSERVABILITY_ENTITY_ID_ENTROPY_BYTES_V1 = 16;
export const OBSERVABILITY_ENTITY_ID_BASE32_LENGTH_V1 = 26;

export const MAX_SAFE_IDENTIFIER_BYTES_V1 = 64;
export const MAX_STABLE_LABEL_BYTES_V1 = 64;
export const MAX_SOURCE_NATIVE_TOOL_NAME_BYTES_V1 = 256;
export const MAX_CANONICAL_DECIMAL_BYTES_V1 = 64;
export const MAX_DIRECT_CROSS_FAMILY_REFS_V1 = 16;

export const MAX_CONVERSATION_ATTACHMENT_BYTES_V1 = 2_097_152;
export const MAX_CONVERSATION_ITEMS_V1 = 2_048;
export const MAX_CONVERSATION_TURNS_V1 = 256;
export const MAX_CONVERSATION_TEXT_BYTES_V1 = 16_384;

export const MAX_COMMANDS_ATTACHMENT_BYTES_V1 = 2_097_152;
export const MAX_COMMANDS_V1 = 256;
export const MAX_COMMANDS_CLOSURE_BYTES_V1 = 33_554_432;
export const MAX_COMMAND_EXECUTABLE_BYTES_V1 = 2_048;
export const MAX_COMMAND_SHELL_BYTES_V1 = 2_048;
export const MAX_COMMAND_ARGUMENTS_V1 = 64;
export const MAX_COMMAND_ARGUMENT_BYTES_V1 = 1_024;
export const MAX_COMMAND_PROJECT_RELATIVE_PATH_BYTES_V1 = 512;
export const MAX_COMMAND_STREAM_BYTES_V1 = 65_536;
export const MAX_COMMAND_INLINE_STREAM_BYTES_V1 = 4_096;

export const MAX_USAGE_ATTACHMENT_BYTES_V1 = 1_048_576;
export const MAX_USAGE_OBSERVATIONS_V1 = 2_048;

export const MAX_TIMING_ATTACHMENT_BYTES_V1 = 1_048_576;
export const MAX_TIMING_INTERVALS_V1 = 4_096;

export const MAX_DIAGNOSTICS_ATTACHMENT_BYTES_V1 = 524_288;
export const MAX_DIAGNOSTICS_V1 = 512;
export const MAX_DIAGNOSTIC_SUMMARY_BYTES_V1 = 1_024;
export const MAX_DIAGNOSTIC_CAUSE_SUMMARY_BYTES_V1 = 512;
export const MAX_DIAGNOSTIC_CAUSES_V1 = 8;
export const MAX_DIAGNOSTIC_CONTEXT_ITEMS_V1 = 16;

/** The family-wide caps required before a producer seals an Attachment. */
export const OBSERVABILITY_ATTACHMENT_LIMITS_V1 = Object.freeze({
  conversation: Object.freeze({
    maxPayloadBytes: MAX_CONVERSATION_ATTACHMENT_BYTES_V1,
    maxItems: MAX_CONVERSATION_ITEMS_V1,
    maxTurns: MAX_CONVERSATION_TURNS_V1,
    maxClosureBytes: 0,
  }),
  commands: Object.freeze({
    maxPayloadBytes: MAX_COMMANDS_ATTACHMENT_BYTES_V1,
    maxItems: MAX_COMMANDS_V1,
    maxClosureBytes: MAX_COMMANDS_CLOSURE_BYTES_V1,
  }),
  usage: Object.freeze({
    maxPayloadBytes: MAX_USAGE_ATTACHMENT_BYTES_V1,
    maxItems: MAX_USAGE_OBSERVATIONS_V1,
    maxClosureBytes: 0,
  }),
  timing: Object.freeze({
    maxPayloadBytes: MAX_TIMING_ATTACHMENT_BYTES_V1,
    maxItems: MAX_TIMING_INTERVALS_V1,
    maxClosureBytes: 0,
  }),
  diagnostics: Object.freeze({
    maxPayloadBytes: MAX_DIAGNOSTICS_ATTACHMENT_BYTES_V1,
    maxItems: MAX_DIAGNOSTICS_V1,
    maxClosureBytes: 0,
  }),
});
