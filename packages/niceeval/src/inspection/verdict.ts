import { foldRecordedAttemptVerdict, type VerdictState } from "../eval/record/verdict.ts";
import type { InspectionJson } from "./codec.ts";
import { readInspectionAssertions, type ResolvedInspectionAttempt } from "./facts.ts";

export function attemptVerdict(
  resolved: ResolvedInspectionAttempt,
  assertions = readInspectionAssertions(resolved),
): VerdictState | null {
  if (assertions.state === "available") {
    return foldRecordedAttemptVerdict({
      outcome: resolved.attempt.outcome,
      assertions: assertions.value,
    });
  }
  if (assertions.state !== "failed" || assertions.attachment === undefined) {
    return null;
  }
  if (resolved.attempt.outcome === "errored" || resolved.attempt.outcome === "interrupted") return "errored";
  if (containsRequiredAssertionError(assertions.attachment.value)) return "errored";
  return containsFailedDecision(assertions.attachment.value) ? "failed" : null;
}

function containsFailedDecision(value: InspectionJson): boolean {
  const entries = assertionWireEntries(value);
  return (
    entries?.some((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
      const decision = (entry as Readonly<Record<string, InspectionJson>>).decision;
      if (typeof decision !== "object" || decision === null || Array.isArray(decision)) return false;
      const record = decision as Readonly<Record<string, InspectionJson>>;
      return record.result === "mismatched" && record.gate === "failed";
    }) ?? false
  );
}

function containsRequiredAssertionError(value: InspectionJson): boolean {
  const entries = assertionWireEntries(value);
  return (
    entries?.some((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
      const record = entry as Readonly<Record<string, InspectionJson>>;
      const decision = record.decision;
      const policy = record.policy;
      const requirement =
        typeof policy === "object" && policy !== null && !Array.isArray(policy)
          ? (policy as Readonly<Record<string, InspectionJson>>).requirement
          : undefined;
      if (
        typeof decision !== "object" ||
        decision === null ||
        Array.isArray(decision) ||
        typeof requirement !== "object" ||
        requirement === null ||
        Array.isArray(requirement)
      )
        return false;
      const decisionRecord = decision as Readonly<Record<string, InspectionJson>>;
      const requirementRecord = requirement as Readonly<Record<string, InspectionJson>>;
      return (
        (decisionRecord.result === "unavailable" || decisionRecord.result === "errored") &&
        decisionRecord.gate === "unavailable" &&
        requirementRecord.state === "available" &&
        requirementRecord.value === "required"
      );
    }) ?? false
  );
}

function assertionWireEntries(value: InspectionJson): readonly InspectionJson[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = (value as Readonly<Record<string, InspectionJson>>)["entries-data"];
  return Array.isArray(entries) ? entries : undefined;
}
