import { foldRecordedAttemptVerdict, type VerdictState } from "../eval/record/verdict.ts";
import { recordedAttemptExecutionFailed } from "../eval/record/sealed-assertion.ts";
import type { InspectionJson } from "./codec.ts";
import { readInspectionAssertions, type ResolvedInspectionAttempt } from "./facts.ts";

export function attemptVerdict(
  resolved: ResolvedInspectionAttempt,
  assertions = readInspectionAssertions(resolved),
): VerdictState | undefined {
  if (assertions.state === "available") {
    return foldRecordedAttemptVerdict({
      ...resolved.attempt,
      assertions: assertions.value,
    });
  }
  if (assertions.state !== "failed" || assertions.attachment === undefined) {
    return undefined;
  }
  if (recordedAttemptExecutionFailed(resolved.attempt)) return "errored";
  if (containsRequiredAssertionError(assertions.attachment.value)) return "errored";
  return containsFailedDecision(assertions.attachment.value) ? "failed" : undefined;
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

/** Bounded preview; counts are folded over every recorded required failure. */
export function attemptVerdictCauses(
  verdict: VerdictState | undefined,
  assertions: ReturnType<typeof readInspectionAssertions>,
): import("./results.ts").InspectionAttemptResult["verdictCauses"] {
  if (verdict !== "errored" || assertions.state !== "available") return undefined;
  type Causes = NonNullable<import("./results.ts").InspectionAttemptResult["verdictCauses"]>;
  const items: Causes["items"][number][] = [];
  const groups = new Map<string, Causes["groups"][number]>();
  const limit = 20;
  let total = 0;
  for (const entry of assertions.value.entries) {
    if (
      entry.policy.requirement.state !== "available" ||
      entry.policy.requirement.value !== "required" ||
      (entry.decision.result !== "unavailable" && entry.decision.result !== "errored")
    )
      continue;
    const detail = entry.explanationRetention.state === "retained" ? entry.explanationRetention.value : undefined;
    const failureDetail = detail === undefined ? null : (retainedFailureCode(detail) ?? null);
    const cause = {
      result: entry.decision.result,
      reason: entry.decision.reason as Causes["items"][number]["reason"],
      failureDetail,
    };
    total++;
    if (items.length < limit)
      items.push({ entryId: entry.entryId, label: entry.display.label ?? entry.entryId, ...cause });
    const key = JSON.stringify(cause);
    const previous = groups.get(key);
    groups.set(key, { ...cause, count: (previous?.count ?? 0) + 1 });
  }
  if (total === 0) return undefined;
  return {
    items,
    groups: [...groups.values()].slice(0, limit),
    total,
    hasMore: total > items.length,
    omittedCount: total - items.length,
    omittedGroupCount: Math.max(0, groups.size - limit),
  };
}

function retainedFailureCode(value: import("../assertions/record/model.ts").AssertionFactValue): string | undefined {
  if (value.kind !== "fields") return undefined;
  // These are retained evaluator detail fields, never inferred from human messages.
  for (const name of ["failureDetail", "code"]) {
    const field = value.fields.find((field) => field.label === name)?.value;
    if (field?.kind === "value" && typeof field.value === "string") return field.value;
  }
  for (const field of value.fields) {
    if (field.label !== "detail") continue;
    const code = retainedFailureCode(field.value);
    if (code !== undefined) return code;
  }
  return undefined;
}
