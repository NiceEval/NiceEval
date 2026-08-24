import { Schema } from "effect";

import {
  recordAttachmentIssue,
  type RecordAttachmentIssue,
} from "../../attachment/index.ts";
import { TurnIdSchema } from "../source-receipt/codec.ts";
import { isCanonicalTurnLabel } from "../../../shared/turn-label.ts";
import {
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
} from "../common.ts";
import {
  SourceReceiptCollectionSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
} from "../source-receipt/index.ts";

const ActivityOutcomeSchema = Schema.Literal(
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "unknown",
);

const CanonicalTurnLabelSchema = Schema.String.pipe(
  Schema.filter(isCanonicalTurnLabel),
);

const ActivityBase = {
  segmentId: SourceSegmentIdSchema,
  activityId: SafeIdentifierSchema,
  sequence: PositiveSafeIntegerSchema,
  startOffsetMs: NonNegativeSafeIntegerSchema,
  durationMs: NonNegativeSafeIntegerSchema,
  parentActivityId: Schema.NullOr(SafeIdentifierSchema),
  outcome: ActivityOutcomeSchema,
} as const;

export const AttemptRunnerActivityReceiptSchema = Schema.Union(
  Schema.Struct({
    ...ActivityBase,
    turnId: TurnIdSchema,
    phase: Schema.Literal("agent.send"),
    label: CanonicalTurnLabelSchema,
  }),
  Schema.Struct({
    ...ActivityBase,
    turnId: Schema.Null,
    phase: Schema.Literal(
      "attempt.setup",
      "sandbox.prepare",
      "agent.ensure",
      "eval.run",
      "sandbox.command",
      "assertion.evaluate",
      "verdict.fold",
      "attempt.teardown",
    ),
    label: SafeIdentifierSchema,
  }),
);

export const RunRunnerActivityReceiptSchema = Schema.Struct({
  ...ActivityBase,
  turnId: Schema.Null,
  phase: Schema.Literal(
    "run.setup",
    "run.discovery",
    "run.plan",
    "run.dispatch",
    "run.teardown",
  ),
  label: SafeIdentifierSchema,
});

interface ActivityForValidation {
  readonly segmentId: string;
  readonly sequence: number;
  readonly activityId: string;
  readonly parentActivityId: string | null;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly outcome: string;
  readonly phase: string;
  readonly turnId: string | null;
}

function validateRunnerActivities(input: {
  readonly collection: { readonly state: string; readonly limitations: readonly unknown[] };
  readonly segments: readonly ActivityForValidation[];
}): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (!hasCanonicalSourceSegments(input.segments)) {
    issues.push(recordAttachmentIssue("record-attachment-schema-invalid", ["segments"]));
  }
  const byId = new Map<string, ActivityForValidation>();
  const turnIds = new Set<string>();
  for (const [index, activity] of input.segments.entries()) {
    if (byId.has(activity.activityId)) {
      issues.push(recordAttachmentIssue(
        "record-attachment-schema-invalid",
        ["segments", String(index), "activityId"],
      ));
    }
    if (activity.phase === "agent.send") {
      if (activity.turnId === null || turnIds.has(activity.turnId)) {
        issues.push(recordAttachmentIssue(
          "record-attachment-schema-invalid",
          ["segments", String(index), "turnId"],
        ));
      }
      if (activity.turnId !== null) turnIds.add(activity.turnId);
    } else if (activity.turnId !== null) {
      issues.push(recordAttachmentIssue(
        "record-attachment-schema-invalid",
        ["segments", String(index), "turnId"],
      ));
    }
    byId.set(activity.activityId, activity);
  }
  for (const [index, activity] of input.segments.entries()) {
    const end = activity.startOffsetMs + activity.durationMs;
    if (!Number.isSafeInteger(end)) {
      issues.push(recordAttachmentIssue(
        "record-attachment-schema-invalid",
        ["segments", String(index), "durationMs"],
      ));
    }
    const seen = new Set<string>([activity.activityId]);
    let child = activity;
    while (child.parentActivityId !== null) {
      const parent = byId.get(child.parentActivityId);
      if (parent === undefined || seen.has(parent.activityId)) {
        issues.push(recordAttachmentIssue(
          "record-attachment-schema-invalid",
          ["segments", String(index), "parentActivityId"],
        ));
        break;
      }
      const parentEnd = parent.startOffsetMs + parent.durationMs;
      if (
        !Number.isSafeInteger(parentEnd) ||
        parent.startOffsetMs > child.startOffsetMs ||
        child.startOffsetMs + child.durationMs > parentEnd
      ) {
        issues.push(recordAttachmentIssue(
          "record-attachment-schema-invalid",
          ["segments", String(index), "parentActivityId"],
        ));
        break;
      }
      seen.add(parent.activityId);
      child = parent;
    }
  }
  if (
    input.collection.state === "complete" &&
    input.segments.some((activity) => activity.outcome === "unknown")
  ) {
    issues.push(recordAttachmentIssue("record-attachment-schema-invalid", ["collection"]));
  }
  return Object.freeze(issues);
}

function validateSourceLimitations(value: {
  readonly collection: { readonly limitations: readonly {
    readonly code: string;
    readonly stage?: string;
    readonly target: string;
  }[] };
}): readonly RecordAttachmentIssue[] {
  return Object.freeze(value.collection.limitations.flatMap((limitation, index) =>
    (limitation.stage === undefined || limitation.stage === "runner-clock" ||
        limitation.stage === "attempt-finalizer" || limitation.stage === "run-teardown") &&
      (limitation.target === "activity" || limitation.target === "value-byte")
      ? []
      : [recordAttachmentIssue(
          "record-attachment-schema-invalid",
          ["collection", "limitations", String(index)],
        )]
  ));
}

export const AttemptRunnerActivitiesAttachmentSchema = Schema.Struct({
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(AttemptRunnerActivityReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
});

export const RunRunnerActivitiesAttachmentSchema = Schema.Struct({
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(RunRunnerActivityReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
});

export type AttemptRunnerActivitiesAttachment = Schema.Schema.Type<
  typeof AttemptRunnerActivitiesAttachmentSchema
>;
export type RunRunnerActivitiesAttachment = Schema.Schema.Type<
  typeof RunRunnerActivitiesAttachmentSchema
>;

export function validateAttemptRunnerActivitiesAttachment(
  value: AttemptRunnerActivitiesAttachment,
): readonly RecordAttachmentIssue[] {
  return Object.freeze([
    ...validateRunnerActivities(value),
    ...validateSourceLimitations(value),
  ]);
}

export function validateRunRunnerActivitiesAttachment(
  value: RunRunnerActivitiesAttachment,
): readonly RecordAttachmentIssue[] {
  return Object.freeze([
    ...validateRunnerActivities(value),
    ...validateSourceLimitations(value),
  ]);
}
