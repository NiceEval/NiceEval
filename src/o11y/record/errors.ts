import type {
  CommandId,
  DiagnosticId,
  IntervalId,
  ObservabilityOwner,
} from "./model.ts";

/**
 * Producer-safe failures. The union intentionally carries only stable codes,
 * owner names, and minted IDs; raw frames, errors, paths, and secrets never
 * cross this boundary.
 */
export type ObservabilityCaptureError =
  | {
      readonly code: "observability-capture-sealed";
      readonly owner: ObservabilityOwner;
    }
  | {
      readonly code: "observability-command-not-registered";
      readonly commandId: CommandId;
    }
  | {
      readonly code: "observability-command-result-already-recorded";
      readonly commandId: CommandId;
    }
  | {
      readonly code: "observability-input-not-safe";
      readonly field: "text" | "manifest" | "diagnostic";
    };

export function observabilityCaptureSealedError(
  owner: ObservabilityOwner,
): ObservabilityCaptureError {
  return Object.freeze({ code: "observability-capture-sealed" as const, owner });
}

export function observabilityCommandNotRegisteredError(
  commandId: CommandId,
): ObservabilityCaptureError {
  return Object.freeze({
    code: "observability-command-not-registered" as const,
    commandId,
  });
}

export function observabilityCommandResultAlreadyRecordedError(
  commandId: CommandId,
): ObservabilityCaptureError {
  return Object.freeze({
    code: "observability-command-result-already-recorded" as const,
    commandId,
  });
}

export function observabilityInputNotSafeError(
  field: "text" | "manifest" | "diagnostic",
): ObservabilityCaptureError {
  return Object.freeze({ code: "observability-input-not-safe" as const, field });
}

/** Aggregate-only failures. Each value is safe to retain in a run diagnostic. */
export type ObservabilityRecordContractError =
  | {
      readonly code: "observability-required-attachment-missing";
      readonly owner: ObservabilityOwner;
      readonly schemaId: string;
    }
  | {
      readonly code: "observability-owner-or-schema-invalid";
      readonly owner: ObservabilityOwner;
      readonly schemaId: string;
    }
  | {
      readonly code: "observability-identity-invalid";
      readonly schemaId: string;
      readonly entity: string;
    }
  | {
      readonly code: "observability-cross-reference-invalid";
      readonly schemaId: string;
      readonly sourceId: string;
    }
  | {
      readonly code: "observability-timing-tree-invalid";
      readonly intervalId: IntervalId;
    }
  | {
      readonly code: "observability-source-frame-invalid";
      readonly diagnosticId: DiagnosticId;
    };

export function observabilityRequiredAttachmentMissingError(
  owner: ObservabilityOwner,
  schemaId: string,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-required-attachment-missing" as const,
    owner,
    schemaId,
  });
}

export function observabilityOwnerOrSchemaInvalidError(
  owner: ObservabilityOwner,
  schemaId: string,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-owner-or-schema-invalid" as const,
    owner,
    schemaId,
  });
}

export function observabilityIdentityInvalidError(
  schemaId: string,
  entity: string,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-identity-invalid" as const,
    schemaId,
    entity,
  });
}

export function observabilityCrossReferenceInvalidError(
  schemaId: string,
  sourceId: string,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-cross-reference-invalid" as const,
    schemaId,
    sourceId,
  });
}

export function observabilityTimingTreeInvalidError(
  intervalId: IntervalId,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-timing-tree-invalid" as const,
    intervalId,
  });
}

export function observabilitySourceFrameInvalidError(
  diagnosticId: DiagnosticId,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-source-frame-invalid" as const,
    diagnosticId,
  });
}
