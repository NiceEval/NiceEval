import type { InspectionCodecError } from "../codec.ts";
import type { CliFeatureError } from "../../cli/contribution.ts";
import {
  type InspectionOperationError,
  type InspectionSourceError,
  type InspectionFailureDocument,
  type InspectionOperationId,
} from "../index.ts";
import type { InspectionCliCause } from "./cause.ts";
type Error = CliFeatureError<InspectionCliCause>;
export const INSPECTION_FAILURE_EXIT_CODE = 2;
export function inspectionFailureDocument(error: Error, operation?: InspectionOperationId): InspectionFailureDocument {
  const detail = inspectionFailureDetail(error);
  return {
    outcome: "failure" as const,
    operation: operation ?? null,
    failure: detail,
  };
}

function inspectionFailureDetail(error: Error): InspectionFailureDocument["failure"] {
  const cause = error.cause;
  switch (cause._tag) {
    case "CurrentTargetUnavailable":
      return {
        code: "current-target-unavailable",
        reason: `${cause.reason} Use overview.get or an exact run.get to read recorded results.`,
        correction: "fix-request",
      };
    case "InspectionOperationError":
      return operationFailureDetail(cause);
    case "InspectionIntegrityError":
      return {
        code: cause.code,
        reason: "The selected sealed Run does not form a closed Record publication.",
        identity: { runId: cause.runId },
        correction: "fix-record-source" as const,
      };
    case "InspectionSourceError":
      return inspectionSourceFailureDetail(cause);
    case "InspectionCodecFailure":
      return codecFailureDetail(cause.error);
    case "Error":
    case "Object":
    case "ThrownValue":
      break;
    default:
      return cause satisfies never;
  }
  const requestFailure = ["parse arguments", "read request", "parse request JSON", "decode request"].includes(
    error.operation,
  );
  return requestFailure
    ? {
        code: "inspection-request-invalid" as const,
        reason: "The Inspection request could not be read as an Inspection request.",
        correction: "fix-request" as const,
      }
    : {
        code: "inspection-operation-failed" as const,
        reason: "The fixed Inspection operation could not be completed.",
        correction: "retry" as const,
      };
}

function operationFailureDetail(cause: InspectionOperationError): InspectionFailureDocument["failure"] {
  const failure = cause.failure;
  switch (failure._tag) {
    case "current-target-unavailable":
      return {
        code: cause.code,
        reason: `${cause.reason} Use overview.get or an exact run.get to read recorded results.`,
        correction: "fix-request",
      };
    case "inspection-read-deadline-exceeded":
      return { code: cause.code, reason: cause.reason, correction: cause.correction ?? "upgrade-or-report" };
    case "inspection-selection-missing":
      return { code: cause.code, reason: cause.reason, correction: "choose-existing-selection" };
    case "inspection-result-invalid":
      return { code: cause.code, reason: cause.reason, correction: "upgrade-or-report" };
    case "inspection-record-integrity-failure":
      return {
        code: cause.code,
        reason: "The selected sealed Run does not form a closed Record publication.",
        identity: cause.identity,
        correction: "fix-record-source",
      };
    case "restart-required":
      return { code: cause.code, reason: cause.reason, correction: "restart" };
    case "evidence-budget-exceeded":
      return { code: cause.code, reason: cause.reason, correction: "retry" };
    case "unsupported-format":
    case "inspection-request-invalid":
    case "inspection-operation-failed":
      return {
        code: cause.code,
        reason: "The fixed Inspection operation could not be completed.",
        correction: "retry",
      };
    default:
      return failure satisfies never;
  }
}

function codecFailureDetail(cause: InspectionCodecError): InspectionFailureDocument["failure"] {
  switch (cause.code) {
    case "inspection-request-invalid":
      return {
        code: cause.code,
        issues: cause.issues,
        omittedIssueCount: cause.omittedIssueCount,
        reason: "The Inspection request does not match an Inspection request.",
        correction: "fix-request",
      };
    case "inspection-result-invalid":
      return {
        code: cause.code,
        reason: "NiceEval could not encode the fixed Inspection result.",
        correction: "upgrade-or-report",
      };
    default:
      return cause satisfies never;
  }
}

export function inspectionSourceFailureDetail(cause: InspectionSourceError): InspectionFailureDocument["failure"] {
  const recordError = cause.cause;
  if (recordError === undefined || recordError._tag !== "SqliteRecordError") {
    return {
      code: "inspection-source-invalid",
      reason: `The selected Record source could not be opened: ${cause.reason}`,
      correction: "fix-record-source",
    };
  }
  const failure = recordError.reason;
  const detail = (
    code: "inspection-operation-failed" | "inspection-source-invalid",
    correction: "retry" | "upgrade-or-report" | "fix-record-source",
    reason = cause.reason,
  ): InspectionFailureDocument["failure"] => ({
    code,
    reason: `The selected Record source could not be opened: [${recordError.code}; ${recordError.operation}] ${reason}`,
    correction,
  });
  switch (failure._tag) {
    case "record-write-busy":
      return detail("inspection-operation-failed", "retry");
    case "record-resource-limit-exceeded":
      return detail("inspection-operation-failed", "upgrade-or-report");
    case "record-runtime-unsupported":
      return detail("inspection-source-invalid", "upgrade-or-report");
    case "record-schema-unsupported":
      return detail(
        "inspection-source-invalid",
        "fix-record-source",
        "This Record was written by an older version of NiceEval. Rerun the experiment or remove this Record storage.",
      );
    case "record-database-invalid":
    case "record-command-conflict":
    case "record-seal-incomplete":
    case "record-content-invalid":
    case "record-sqlite-error":
      return detail("inspection-source-invalid", "fix-record-source");
    default:
      return failure satisfies never;
  }
}
