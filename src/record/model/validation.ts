import { Either } from "effect";
import {
  nonEmptyRecordIssues,
  recordIssue,
  type RecordIssue,
} from "../errors/record-errors.ts";
import { recordAttemptReferenceKey } from "./core.ts";
import {
  canonicalizeRunContext,
  validateRunContext,
} from "./run-context.ts";
import type {
  AttemptDocument,
  MembershipAction,
  RecordAttemptRef,
  RecordCore,
  RecordSlotIdentity,
  RunCore,
  RunDocument,
} from "./core.ts";
import {
  compareCanonicalIdentity,
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

function isStrictlyAfter(previous: string | undefined, current: string): boolean {
  return previous === undefined || compareCanonicalIdentity(previous, current) < 0;
}

/** Rejects duplicate or non-canonically ordered immutable Slot identities. */
export function validateExpectedSlots(
  expectedSlots: readonly RecordSlotIdentity[],
): readonly RecordIssue[] {
  const issues: RecordIssue[] = [];
  const seenSlotIds = new Set<string>();
  const seenEvalOrdinals = new Set<string>();
  let previous: string | undefined;

  for (const [index, slot] of expectedSlots.entries()) {
    const path = ["expectedSlots", String(index), "slotId"];
    if (!isStrictlyAfter(previous, slot.slotId)) {
      issues.push(
        recordIssue(
          previous === slot.slotId
            ? "record-expected-slot-duplicate"
            : "record-expected-slot-order-invalid",
          path,
        ),
      );
    }
    if (seenSlotIds.has(slot.slotId) && previous !== slot.slotId) {
      issues.push(recordIssue("record-expected-slot-duplicate", path));
    }
    const ordinalKey = `${slot.evalId}\u0000${String(slot.attemptOrdinal)}`;
    if (seenEvalOrdinals.has(ordinalKey)) {
      issues.push(recordIssue(
        "record-expected-slot-duplicate",
        ["expectedSlots", String(index), "attemptOrdinal"],
      ));
    }
    seenSlotIds.add(slot.slotId);
    seenEvalOrdinals.add(ordinalKey);
    previous = slot.slotId;
  }

  return Object.freeze(issues);
}

/** Validates invariants entirely contained by the durable `run.json`. */
export function validateRunDocument(
  run: RunDocument,
): readonly RecordIssue[] {
  const issues: RecordIssue[] = [];
  if (run.completedAt < run.startedAt) {
    issues.push(recordIssue("record-run-time-order-invalid", ["completedAt"]));
  }
  const contextIssues = validateRunContext(run.context);
  appendIssues(issues, ["context"], contextIssues);
  const context = canonicalizeRunContext(run.context);
  if (Either.isRight(context) && context.right.experimentId !== run.experimentId) {
    issues.push(
      recordIssue("record-run-context-experiment-mismatch", ["context", "experimentId"]),
    );
  }
  appendIssues(issues, [], validateExpectedSlots(run.expectedSlots));
  return Object.freeze(issues);
}

/** Validates the action/reference coupling in one durable Member document. */
export function validateMemberDocument(member: {
  readonly action: MembershipAction;
  readonly attempt: RecordAttemptRef | null;
}): readonly RecordIssue[] {
  const requiresAttempt =
    member.action === "executed" ||
    member.action === "carried" ||
    member.action === "accepted";
  return requiresAttempt === (member.attempt !== null)
    ? Object.freeze([])
    : Object.freeze([recordIssue("record-member-action-invalid", ["attempt"])]);
}

/** Attempt-local shape is fully captured by its exact schema. */
export function validateAttemptDocument(
  _attempt: AttemptDocument,
): readonly RecordIssue[] {
  return Object.freeze([]);
}

interface AttemptLocation {
  readonly runIndex: number;
  readonly attemptIndex: number;
  readonly attempt: AttemptDocument;
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

function expectedSlotsById(
  run: RunDocument,
): ReadonlyMap<string, RecordSlotIdentity> {
  return new Map(run.expectedSlots.map((slot) => [slot.slotId, slot]));
}

function sameSlotIdentity(
  left: RecordSlotIdentity,
  right: RecordSlotIdentity,
): boolean {
  return left.slotId === right.slotId
    && left.evalId === right.evalId
    && left.attemptOrdinal === right.attemptOrdinal
    && left.executionIdentityDigest === right.executionIdentityDigest;
}

function validateRunMembers(
  runCore: RunCore,
  runIndex: number,
  issues: RecordIssue[],
): void {
  const expectedSlots = expectedSlotsById(runCore.run);
  const members = new Set<string>();
  let previous: string | undefined;

  for (const [memberIndex, member] of runCore.members.entries()) {
    const path = memberPrefix(runIndex, memberIndex);
    appendIssues(issues, path, validateMemberDocument(member));
    if (!isStrictlyAfter(previous, member.slotId)) {
      issues.push(
        recordIssue(
          previous === member.slotId
            ? "record-member-slot-duplicate"
            : "record-member-slot-order-invalid",
          [...path, "slotId"],
        ),
      );
    }
    if (members.has(member.slotId) && previous !== member.slotId) {
      issues.push(recordIssue("record-member-slot-duplicate", [...path, "slotId"]));
    }
    if (!expectedSlots.has(member.slotId)) {
      issues.push(recordIssue("record-member-slot-unexpected", [...path, "slotId"]));
    }
    members.add(member.slotId);
    previous = member.slotId;
  }

  // A completed Run owns one terminal Member for every Slot in its frozen
  // denominator. A partial directory must never look available merely because
  // the Run document itself decodes successfully.
  for (const [slotIndex, slot] of runCore.run.expectedSlots.entries()) {
    if (!members.has(slot.slotId)) {
      issues.push(
        recordIssue("record-member-slot-missing", [
          ...runPrefix(runIndex),
          "run",
          "expectedSlots",
          String(slotIndex),
          "slotId",
        ]),
      );
    }
  }
}

/**
 * Validates the non-durable aggregation of exact Core documents. The aggregate
 * is only a validator input: membership remains one `members/<SlotId>.json`
 * document per item and never becomes a field in `run.json`.
 */
export function validateRecordCore(
  core: RecordCore,
): readonly RecordIssue[] {
  const issues: RecordIssue[] = [];
  const runs = new Map<string, number>();
  const attempts = new Map<string, AttemptLocation>();
  let previousRunId: string | undefined;

  for (const [runIndex, runCore] of core.runs.entries()) {
    const runId = runCore.run.runId;
    const prefix = runPrefix(runIndex);
    if (!isStrictlyAfter(previousRunId, runId)) {
      issues.push(
        recordIssue(
          previousRunId === runId ? "record-run-duplicate" : "record-run-order-invalid",
          [...prefix, "run", "runId"],
        ),
      );
    }
    if (runs.has(runId) && previousRunId !== runId) {
      issues.push(recordIssue("record-run-duplicate", [...prefix, "run", "runId"]));
    }
    runs.set(runId, runIndex);
    previousRunId = runId;

    appendIssues(issues, [...prefix, "run"], validateRunDocument(runCore.run));
    validateRunMembers(runCore, runIndex, issues);

    const expectedSlots = expectedSlotsById(runCore.run);
    let previousAttemptId: string | undefined;
    for (const [attemptIndex, attempt] of runCore.attempts.entries()) {
      const path = attemptPrefix(runIndex, attemptIndex);
      appendIssues(issues, path, validateAttemptDocument(attempt));
      if (!isStrictlyAfter(previousAttemptId, attempt.attemptId)) {
        issues.push(
          recordIssue(
            previousAttemptId === attempt.attemptId
              ? "record-attempt-duplicate"
              : "record-attempt-order-invalid",
            [...path, "attemptId"],
          ),
        );
      }
      previousAttemptId = attempt.attemptId;

      if (attempt.originRunId !== runId) {
        issues.push(recordIssue("record-attempt-owner-invalid", [...path, "originRunId"]));
        continue;
      }

      const slot = expectedSlots.get(attempt.slotId);
      if (slot === undefined) {
        issues.push(recordIssue("record-attempt-slot-unexpected", [...path, "slotId"]));
      } else {
        if (slot.evalId !== attempt.evalId) {
          issues.push(recordIssue("record-attempt-eval-mismatch", [...path, "evalId"]));
        }
        if (slot.executionIdentityDigest !== attempt.executionIdentityDigest) {
          issues.push(
            recordIssue("record-attempt-digest-mismatch", [
              ...path,
              "executionIdentityDigest",
            ]),
          );
        }
      }

      const key = referenceKey({ originRunId: runId, attemptId: attempt.attemptId });
      if (attempts.has(key)) {
        issues.push(recordIssue("record-attempt-duplicate", [...path, "attemptId"]));
      } else {
        attempts.set(key, { runIndex, attemptIndex, attempt });
      }
    }
  }

  const originMemberCounts = new Map<string, number>();
  for (const [runIndex, runCore] of core.runs.entries()) {
    for (const [memberIndex, member] of runCore.members.entries()) {
      if (member.attempt === null) continue;
      const path = memberPrefix(runIndex, memberIndex);
      const target = attempts.get(referenceKey(member.attempt));
      if (target === undefined) {
        issues.push(recordIssue("record-attempt-reference-missing", [...path, "attempt"]));
        continue;
      }
      // Carried / executed Members occupy the origin Slot identity. Accepted
      // reference Members may point at an origin Attempt whose Slot identity
      // differs from the current target Slot (explicit adoption / rename).
      if (member.action !== "accepted") {
        const targetExpected = expectedSlotsById(runCore.run).get(member.slotId);
        const originExpected = expectedSlotsById(
          core.runs[target.runIndex]!.run,
        ).get(target.attempt.slotId);
        if (
          targetExpected === undefined
          || originExpected === undefined
          || !sameSlotIdentity(targetExpected, originExpected)
        ) {
          issues.push(recordIssue("record-attempt-slot-mismatch", [...path, "attempt"]));
        }
      }
      if (member.action === "executed") {
        if (member.attempt.originRunId !== runCore.run.runId) {
          issues.push(recordIssue("record-member-action-invalid", [...path, "action"]));
          continue;
        }
        const key = referenceKey(member.attempt);
        originMemberCounts.set(key, (originMemberCounts.get(key) ?? 0) + 1);
      } else if (member.attempt.originRunId === runCore.run.runId) {
        issues.push(recordIssue("record-member-action-invalid", [...path, "action"]));
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

/** Converts validator output to the non-empty form carried by invalid read states. */
export { nonEmptyRecordIssues };
