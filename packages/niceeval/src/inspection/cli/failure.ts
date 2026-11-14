import type { InspectionCodecError } from "../codec.ts";
import { CliFeatureError } from "../../cli/contribution.ts";
import {
  InspectionIntegrityError,
  InspectionOperationError,
  InspectionSourceError,
  type InspectionFailureDocument,
  type InspectionOperationId,
} from "../index.ts";
import { SqliteRecordError } from "../../record/sqlite/errors.ts";
import { CurrentTargetUnavailable } from "../../experiment/host/current.ts";
type Error = CliFeatureError;
export const INSPECTION_FAILURE_EXIT_CODE = 2;
export function inspectionFailureDocument(error: Error, operation?: InspectionOperationId): InspectionFailureDocument {
  const detail = inspectionFailureDetail(error);
  return Object.freeze({
    outcome: "failure" as const,
    operation: operation ?? null,
    failure: Object.freeze(detail),
  });
}

function inspectionFailureDetail(error: Error): InspectionFailureDocument["failure"] {
  const cause = error.cause;
  if (
    cause instanceof CurrentTargetUnavailable ||
    (cause instanceof InspectionOperationError && cause.code === "current-target-unavailable")
  )
    return {
      code: "current-target-unavailable",
      reason: `${cause.reason} Use overview.get or an exact run.get to read recorded results.`,
      correction: "fix-request",
    };
  if (cause instanceof InspectionOperationError) {
    if (cause.code === "inspection-selection-missing") {
      return Object.freeze({
        code: cause.code,
        reason: cause.reason,
        correction: "choose-existing-selection" as const,
      });
    }
    if (cause.code === "inspection-result-invalid") {
      return Object.freeze({
        code: cause.code,
        reason: cause.reason,
        correction: "upgrade-or-report" as const,
      });
    }
    if (cause.code === "inspection-record-integrity-failure") {
      return Object.freeze({
        code: cause.code,
        reason: "The selected sealed Run does not form a closed Record publication.",
        identity: cause.identity,
        correction: "fix-record-source" as const,
      });
    }
    if (cause.code === "restart-required") {
      return Object.freeze({
        code: cause.code,
        reason: cause.reason,
        correction: "restart" as const,
      });
    }
    if (cause.code === "evidence-budget-exceeded") {
      return Object.freeze({
        code: cause.code,
        reason: cause.reason,
        correction: "retry" as const,
      });
    }
    return Object.freeze({
      code: cause.code,
      reason: "The fixed Inspection operation could not be completed.",
      correction: "retry" as const,
    });
  }
  if (cause instanceof InspectionIntegrityError) {
    return Object.freeze({
      code: cause.code,
      reason: "The selected sealed Run does not form a closed Record publication.",
      identity: Object.freeze({ runId: cause.runId }),
      correction: "fix-record-source" as const,
    });
  }
  if (cause instanceof InspectionSourceError) {
    const recordError = cause.cause instanceof SqliteRecordError ? cause.cause : undefined;
    const operationalFailure =
      recordError?.code === "record-write-busy" || recordError?.code === "record-resource-limit-exceeded";
    const diagnostic =
      recordError?.code === "record-schema-unsupported"
        ? "This Record was written by an older version of NiceEval. Rerun the experiment or remove this Record storage."
        : recordError === undefined
          ? cause.reason
          : `[${recordError.code}; ${recordError.operation}] ${cause.reason}`;
    return Object.freeze({
      code: operationalFailure ? ("inspection-operation-failed" as const) : ("inspection-source-invalid" as const),
      reason: `The selected Record source could not be opened: ${diagnostic}`,
      correction:
        recordError?.code === "record-write-busy"
          ? ("retry" as const)
          : recordError?.code === "record-resource-limit-exceeded" || recordError?.code === "record-runtime-unsupported"
            ? ("upgrade-or-report" as const)
            : ("fix-record-source" as const),
    });
  }
  if (isInspectionCodecFailure(cause)) {
    return Object.freeze({
      code: cause.code,
      ...((cause as InspectionCodecError).issues === undefined
        ? {}
        : {
            issues: (cause as InspectionCodecError).issues,
            omittedIssueCount: (cause as InspectionCodecError).omittedIssueCount,
          }),
      reason:
        cause.code === "inspection-request-invalid"
          ? "The Inspection request does not match an Inspection request."
          : "NiceEval could not encode the fixed Inspection result.",
      correction:
        cause.code === "inspection-request-invalid" ? ("fix-request" as const) : ("upgrade-or-report" as const),
    });
  }
  const requestFailure = ["parse arguments", "read request", "parse request JSON", "decode request"].includes(
    error.operation,
  );
  return requestFailure
    ? Object.freeze({
        code: "inspection-request-invalid" as const,
        reason: "The Inspection request could not be read as an Inspection request.",
        correction: "fix-request" as const,
      })
    : Object.freeze({
        code: "inspection-operation-failed" as const,
        reason: "The fixed Inspection operation could not be completed.",
        correction: "retry" as const,
      });
}

function isInspectionCodecFailure(
  value: unknown,
): value is { readonly code: "inspection-request-invalid" | "inspection-result-invalid" } {
  return (
    typeof value === "object" &&
    value !== null &&
    (Reflect.get(value, "code") === "inspection-request-invalid" ||
      Reflect.get(value, "code") === "inspection-result-invalid")
  );
}
