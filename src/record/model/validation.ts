import {
  nonEmptyRecordIssues,
  recordIssue,
  type RecordIssue,
} from "../errors/record-errors.ts";
import { recordAttemptReferenceKey } from "./core.ts";
import type {
  RecordAttachmentEnvelopeV1,
  RecordCoreV1,
  RecordAttemptRef,
  RunCoreV1,
  RunDocumentV1,
} from "./core.ts";
import {
  compareCanonicalIdentity,
  recordAttachmentNameTextOfSchemaId,
  type SlotId,
} from "./identifiers.ts";

function appendIssues(
  destination: RecordIssue[],
  prefix: readonly string[],
  nested: readonly RecordIssue[],
): void {
  for (const issue of nested) {
    destination.push(recordIssue(issue.code, [...prefix, ...issue.path]));
  }
}

/** Rejects duplicate or non-canonically ordered slot denominators. */
export function validateExpectedSlots(
  expectedSlots: readonly SlotId[],
): readonly RecordIssue[] {
  const issues: RecordIssue[] = [];
  const seen = new Set<string>();
  let previous: SlotId | undefined;

  for (const [index, slotId] of expectedSlots.entries()) {
    const path = ["expectedSlots", String(index)];
    if (previous !== undefined && compareCanonicalIdentity(previous, slotId) > 0) {
      issues.push(recordIssue("record-expected-slot-order-invalid", path));
    }
    if (seen.has(slotId)) {
      issues.push(recordIssue("record-expected-slot-duplicate", path));
    }
    seen.add(slotId);
    previous = slotId;
  }

  return Object.freeze(issues);
}

/** Validates invariants entirely contained by `run.json`. */
export function validateRunDocumentV1(
  run: RunDocumentV1,
): readonly RecordIssue[] {
  const issues: RecordIssue[] = [];
  if (run.completedAt < run.startedAt) {
    issues.push(recordIssue("record-run-time-order-invalid", ["completedAt"]));
  }
  appendIssues(issues, [], validateExpectedSlots(run.expectedSlots));
  return Object.freeze(issues);
}

/** Validates the name/schema identity coupling in `attachment.json`. */
export function validateRecordAttachmentEnvelopeV1(
  envelope: RecordAttachmentEnvelopeV1,
): readonly RecordIssue[] {
  const schemaName = recordAttachmentNameTextOfSchemaId(envelope.schemaId);
  if (schemaName === envelope.name) {
    return [];
  }
  return Object.freeze([
    recordIssue("record-attachment-schema-id-mismatch", ["schemaId"]),
  ]);
}

interface AttemptLocation {
  readonly runIndex: number;
  readonly attemptIndex: number;
}

function runPrefix(runIndex: number): readonly string[] {
  return ["runs", String(runIndex)];
}

function memberPrefix(runIndex: number, memberIndex: number): readonly string[] {
  return [...runPrefix(runIndex), "members", String(memberIndex)];
}

function attemptPrefix(runIndex: number, attemptIndex: number): readonly string[] {
  return [...runPrefix(runIndex), "attempts", String(attemptIndex)];
}

function referenceKey(ref: RecordAttemptRef): string {
  return recordAttemptReferenceKey(ref);
}

/**
 * Validates the Core facts that need all published documents in one frozen
 * Record snapshot: denominator membership, owner identity, and exact refs.
 */
export function validateRecordCoreV1(
  core: RecordCoreV1,
): readonly RecordIssue[] {
  const issues: RecordIssue[] = [];
  const runs = new Map<string, number>();
  const attempts = new Map<string, AttemptLocation>();

  for (const [runIndex, runCore] of core.runs.entries()) {
    const runId = runCore.run.runId;
    const prefix = runPrefix(runIndex);
    const priorRunIndex = runs.get(runId);
    if (priorRunIndex !== undefined) {
      issues.push(recordIssue("record-run-duplicate", [...prefix, "run", "runId"]));
    } else {
      runs.set(runId, runIndex);
    }

    appendIssues(issues, [...prefix, "run"], validateRunDocumentV1(runCore.run));
    validateRunMembers(runCore, runIndex, issues);

    for (const [attemptIndex, attempt] of runCore.attempts.entries()) {
      const path = attemptPrefix(runIndex, attemptIndex);
      if (attempt.originRunId !== runId) {
        issues.push(recordIssue("record-attempt-owner-invalid", [...path, "originRunId"]));
        continue;
      }

      const key = referenceKey({ originRunId: runId, attemptId: attempt.attemptId });
      if (attempts.has(key)) {
        issues.push(recordIssue("record-attempt-duplicate", [...path, "attemptId"]));
      } else {
        attempts.set(key, { runIndex, attemptIndex });
      }
    }
  }

  const originMemberCounts = new Map<string, number>();
  for (const [runIndex, runCore] of core.runs.entries()) {
    for (const [memberIndex, member] of runCore.members.entries()) {
      const key = referenceKey(member.attempt);
      if (!attempts.has(key)) {
        issues.push(
          recordIssue("record-attempt-reference-missing", [
            ...memberPrefix(runIndex, memberIndex),
            "attempt",
          ]),
        );
        continue;
      }

      if (member.attempt.originRunId === runCore.run.runId) {
        originMemberCounts.set(key, (originMemberCounts.get(key) ?? 0) + 1);
      }
    }
  }

  for (const [key, location] of attempts.entries()) {
    const count = originMemberCounts.get(key) ?? 0;
    const path = attemptPrefix(location.runIndex, location.attemptIndex);
    if (count === 0) {
      issues.push(recordIssue("record-origin-member-missing", path));
    } else if (count > 1) {
      issues.push(recordIssue("record-origin-member-duplicate", path));
    }
  }

  return Object.freeze(issues);
}

function validateRunMembers(
  runCore: RunCoreV1,
  runIndex: number,
  issues: RecordIssue[],
): void {
  const expectedSlots = new Set<string>(runCore.run.expectedSlots);
  const members = new Set<string>();

  for (const [memberIndex, member] of runCore.members.entries()) {
    const path = memberPrefix(runIndex, memberIndex);
    if (!expectedSlots.has(member.slotId)) {
      issues.push(recordIssue("record-member-slot-unexpected", [...path, "slotId"]));
    }
    if (members.has(member.slotId)) {
      issues.push(recordIssue("record-member-slot-duplicate", [...path, "slotId"]));
    }
    members.add(member.slotId);
  }
}

/** Converts validator output to the non-empty form carried by invalid read states. */
export { nonEmptyRecordIssues };
