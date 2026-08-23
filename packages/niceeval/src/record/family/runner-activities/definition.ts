import { Schema } from "effect";

import { TurnIdSchema } from "../../../o11y/record/codec.ts";
import { isCanonicalTurnLabel } from "../../../shared/turn-label.ts";
import { defineRecordAttachment } from "../../definition/index.ts";
import {
  FixedAttachmentValueLimits,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
} from "../common.ts";
import {
  NoBlobSourceReceiptBudget,
  SourceReceiptCollectionSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
} from "../source-receipt.ts";

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

function canonicalActivities(input: {
  readonly collection: { readonly state: string; readonly limitations: readonly unknown[] };
  readonly segments: readonly ActivityForValidation[];
}): boolean {
  if (!hasCanonicalSourceSegments(input.segments)) return false;
  const byId = new Map<string, ActivityForValidation>();
  const turnIds = new Set<string>();
  for (const activity of input.segments) {
    if (byId.has(activity.activityId)) return false;
    if (activity.phase === "agent.send") {
      if (activity.turnId === null || turnIds.has(activity.turnId)) return false;
      turnIds.add(activity.turnId);
    } else if (activity.turnId !== null) {
      return false;
    }
    byId.set(activity.activityId, activity);
  }
  for (const activity of input.segments) {
    const end = activity.startOffsetMs + activity.durationMs;
    if (!Number.isSafeInteger(end)) return false;
    const seen = new Set<string>([activity.activityId]);
    let child = activity;
    while (child.parentActivityId !== null) {
      const parent = byId.get(child.parentActivityId);
      if (parent === undefined || seen.has(parent.activityId)) return false;
      const parentEnd = parent.startOffsetMs + parent.durationMs;
      if (
        !Number.isSafeInteger(parentEnd) ||
        parent.startOffsetMs > child.startOffsetMs ||
        child.startOffsetMs + child.durationMs > parentEnd
      ) return false;
      seen.add(parent.activityId);
      child = parent;
    }
  }
  return input.collection.state !== "complete" ||
    input.segments.every((activity) => activity.outcome !== "unknown");
}

function sourceLimitations(value: {
  readonly collection: { readonly limitations: readonly {
    readonly code: string;
    readonly stage?: string;
    readonly target: string;
  }[] };
}): boolean {
  return value.collection.limitations.every((limitation) =>
    (limitation.stage === undefined || limitation.stage === "runner-clock" ||
      limitation.stage === "attempt-finalizer" || limitation.stage === "run-teardown") &&
    (limitation.target === "activity" || limitation.target === "payload-byte")
  );
}

export const AttemptRunnerActivitiesAttachmentSchema = Schema.Struct({
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(AttemptRunnerActivityReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
}).pipe(
  Schema.filter((value) => canonicalActivities(value) && sourceLimitations(value)),
);

export const RunRunnerActivitiesAttachmentSchema = Schema.Struct({
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(RunRunnerActivityReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
}).pipe(
  Schema.filter((value) => canonicalActivities(value) && sourceLimitations(value)),
);

export type AttemptRunnerActivitiesAttachment = Schema.Schema.Type<
  typeof AttemptRunnerActivitiesAttachmentSchema
>;
export type RunRunnerActivitiesAttachment = Schema.Schema.Type<
  typeof RunRunnerActivitiesAttachmentSchema
>;

export const runnerActivitiesRecordAttachment = defineRecordAttachment({
  family: "niceeval.runner-activities",
  current: {
    schemaVersion: 1,
    owners: {
      attempt: {
        schema: AttemptRunnerActivitiesAttachmentSchema,
        limits: FixedAttachmentValueLimits,
        blobs: {
          refs: () => Object.freeze([]),
          budget: NoBlobSourceReceiptBudget,
          verify: () => Object.freeze([]),
        },
      },
      run: {
        schema: RunRunnerActivitiesAttachmentSchema,
        limits: FixedAttachmentValueLimits,
        blobs: {
          refs: () => Object.freeze([]),
          budget: NoBlobSourceReceiptBudget,
          verify: () => Object.freeze([]),
        },
      },
    },
  },
});
