import type {
  CommandIdV1,
  DiagnosticIdV1,
  IntervalIdV1,
  ObservabilityOwnerV1,
} from "./model.ts";

/**
 * Producer-safe failures. The union intentionally carries only stable codes,
 * owner names, and minted IDs; raw frames, errors, paths, and secrets never
 * cross this boundary.
 */
export type ObservabilityCaptureError =
  | {
      readonly code: "observability-capture-sealed";
      readonly owner: ObservabilityOwnerV1;
    }
  | {
      readonly code: "observability-command-not-registered";
      readonly commandId: CommandIdV1;
    }
  | {
      readonly code: "observability-command-result-already-recorded";
      readonly commandId: CommandIdV1;
    }
  | {
      readonly code: "observability-input-not-safe";
      readonly field: "text" | "manifest" | "diagnostic";
    };

export function observabilityCaptureSealedErrorV1(
  owner: ObservabilityOwnerV1,
): ObservabilityCaptureError {
  return Object.freeze({ code: "observability-capture-sealed" as const, owner });
}

export function observabilityCommandNotRegisteredErrorV1(
  commandId: CommandIdV1,
): ObservabilityCaptureError {
  return Object.freeze({
    code: "observability-command-not-registered" as const,
    commandId,
  });
}

export function observabilityCommandResultAlreadyRecordedErrorV1(
  commandId: CommandIdV1,
): ObservabilityCaptureError {
  return Object.freeze({
    code: "observability-command-result-already-recorded" as const,
    commandId,
  });
}

export function observabilityInputNotSafeErrorV1(
  field: "text" | "manifest" | "diagnostic",
): ObservabilityCaptureError {
  return Object.freeze({ code: "observability-input-not-safe" as const, field });
}

/** Aggregate-only failures. Each value is safe to retain in a run diagnostic. */
export type ObservabilityRecordContractError =
  | {
      readonly code: "observability-required-attachment-missing";
      readonly owner: ObservabilityOwnerV1;
      readonly schemaId: string;
    }
  | {
      readonly code: "observability-owner-or-schema-invalid";
      readonly owner: ObservabilityOwnerV1;
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
      readonly intervalId: IntervalIdV1;
    }
  | {
      readonly code: "observability-source-frame-invalid";
      readonly diagnosticId: DiagnosticIdV1;
    };

export function observabilityRequiredAttachmentMissingErrorV1(
  owner: ObservabilityOwnerV1,
  schemaId: string,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-required-attachment-missing" as const,
    owner,
    schemaId,
  });
}

export function observabilityOwnerOrSchemaInvalidErrorV1(
  owner: ObservabilityOwnerV1,
  schemaId: string,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-owner-or-schema-invalid" as const,
    owner,
    schemaId,
  });
}

export function observabilityIdentityInvalidErrorV1(
  schemaId: string,
  entity: string,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-identity-invalid" as const,
    schemaId,
    entity,
  });
}

export function observabilityCrossReferenceInvalidErrorV1(
  schemaId: string,
  sourceId: string,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-cross-reference-invalid" as const,
    schemaId,
    sourceId,
  });
}

export function observabilityTimingTreeInvalidErrorV1(
  intervalId: IntervalIdV1,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-timing-tree-invalid" as const,
    intervalId,
  });
}

export function observabilitySourceFrameInvalidErrorV1(
  diagnosticId: DiagnosticIdV1,
): ObservabilityRecordContractError {
  return Object.freeze({
    code: "observability-source-frame-invalid" as const,
    diagnosticId,
  });
}
