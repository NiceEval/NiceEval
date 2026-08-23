import { Schema } from "effect";

import { isCanonicalTurnLabel } from "../../../shared/turn-label.ts";
import {
  AttemptTimingReferencesSchema,
  CollectionSchema,
  IntervalIdSchema,
  NonNegativeSafeIntegerSchema,
  RunTimingReferencesSchema,
  StableLabelSchema,
} from "../../../record/family/source-receipt/codec.ts";
import {
  MAX_TIMING_ATTACHMENT_BYTES,
  MAX_TIMING_INTERVALS,
} from "../../../record/family/source-receipt/limits.ts";
import { isStableLabel } from "../../../record/family/source-receipt/model.ts";
import {
  isAllowedCollection,
  isStrictlyOrderedById,
  payloadFits,
} from "./common.ts";

export const AttemptTimingPhaseSchema = Schema.Literal(
  "attempt.setup",
  "sandbox.prepare",
  "agent.ensure",
  "eval.run",
  "agent.send",
  "sandbox.command",
  "assertion.evaluate",
  "verdict.fold",
  "attempt.teardown",
);

export const RunTimingPhaseSchema = Schema.Literal(
  "run.setup",
  "run.discovery",
  "run.plan",
  "run.dispatch",
  "run.teardown",
);

const TimingOutcomeSchema = Schema.Literal(
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "unknown",
);

const CanonicalTurnLabelSchema = Schema.String.pipe(
  Schema.filter(
    (value): value is string => isCanonicalTurnLabel(value),
    { identifier: "CanonicalTurnLabel" },
  ),
);

const AttemptTimingIntervalBase = {
  intervalId: IntervalIdSchema,
  startOffsetMs: NonNegativeSafeIntegerSchema,
  durationMs: NonNegativeSafeIntegerSchema,
  parentIntervalId: Schema.NullOr(IntervalIdSchema),
  outcome: TimingOutcomeSchema,
  refs: AttemptTimingReferencesSchema,
} as const;

const AttemptTimingIntervalStructuralSchema = Schema.Struct({
  ...AttemptTimingIntervalBase,
  phase: AttemptTimingPhaseSchema,
  label: Schema.Union(StableLabelSchema, CanonicalTurnLabelSchema),
});

export const AttemptTimingIntervalSchema = AttemptTimingIntervalStructuralSchema.pipe(
  Schema.filter(
    (interval) => interval.phase === "agent.send" || isStableLabel(interval.label),
    {
      identifier: "AttemptTimingInterval",
      description: "canonical turn labels are reserved for agent.send intervals",
    },
  ),
);

export const RunTimingIntervalSchema = Schema.Struct({
  intervalId: IntervalIdSchema,
  phase: RunTimingPhaseSchema,
  label: StableLabelSchema,
  startOffsetMs: NonNegativeSafeIntegerSchema,
  durationMs: NonNegativeSafeIntegerSchema,
  parentIntervalId: Schema.NullOr(IntervalIdSchema),
  outcome: TimingOutcomeSchema,
  refs: RunTimingReferencesSchema,
});

export type AttemptTimingInterval = Schema.Schema.Type<
  typeof AttemptTimingIntervalSchema
>;
export type RunTimingInterval = Schema.Schema.Type<
  typeof RunTimingIntervalSchema
>;

function timingEnd(start: number, duration: number): number | undefined {
  const end = start + duration;
  return Number.isSafeInteger(end) ? end : undefined;
}

function isCanonicalTimingTree<
  Interval extends {
    readonly intervalId: string;
    readonly startOffsetMs: number;
    readonly durationMs: number;
    readonly parentIntervalId: string | null;
  },
>(intervals: readonly Interval[]): boolean {
  if (!isStrictlyOrderedById(intervals, (interval) => interval.intervalId)) return false;
  const byId = new Map(intervals.map((interval) => [interval.intervalId, interval] as const));
  for (const interval of intervals) {
    const end = timingEnd(interval.startOffsetMs, interval.durationMs);
    if (end === undefined) return false;
    const ancestors = new Set<string>([interval.intervalId]);
    let child: Interval = interval;
    while (child.parentIntervalId !== null) {
      const parent = byId.get(child.parentIntervalId);
      if (parent === undefined || ancestors.has(parent.intervalId)) {
        return false;
      }
      const parentEnd = timingEnd(parent.startOffsetMs, parent.durationMs);
      const childEnd = timingEnd(child.startOffsetMs, child.durationMs);
      if (
        parentEnd === undefined ||
        childEnd === undefined ||
        parent.startOffsetMs > child.startOffsetMs ||
        childEnd > parentEnd
      ) {
        return false;
      }
      ancestors.add(parent.intervalId);
      child = parent;
    }
  }
  return true;
}

const AttemptTimingAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  intervals: Schema.Array(AttemptTimingIntervalSchema),
});

function isCanonicalAttemptTimingAttachment(
  value: Schema.Schema.Type<typeof AttemptTimingAttachmentStructuralSchema>,
): boolean {
  return (
    value.intervals.length <= MAX_TIMING_INTERVALS &&
    payloadFits(value, MAX_TIMING_ATTACHMENT_BYTES) &&
    isAllowedCollection(value.collection, ["timing-interval"]) &&
    isCanonicalTimingTree(value.intervals) &&
    (!value.intervals.some((interval) => interval.outcome === "unknown") ||
      value.collection.state === "partial")
  );
}

export const AttemptTimingAttachmentSchema = AttemptTimingAttachmentStructuralSchema.pipe(
  Schema.filter(isCanonicalAttemptTimingAttachment, {
    identifier: "ObservabilityAttemptTimingAttachment",
    description: "a canonical, bounded attempt timing tree",
  }),
);

export type AttemptTimingAttachment = Schema.Schema.Type<
  typeof AttemptTimingAttachmentSchema
>;

const RunTimingAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  intervals: Schema.Array(RunTimingIntervalSchema),
});

function isCanonicalRunTimingAttachment(
  value: Schema.Schema.Type<typeof RunTimingAttachmentStructuralSchema>,
): boolean {
  return (
    value.intervals.length <= MAX_TIMING_INTERVALS &&
    payloadFits(value, MAX_TIMING_ATTACHMENT_BYTES) &&
    isAllowedCollection(value.collection, ["timing-interval"]) &&
    isCanonicalTimingTree(value.intervals) &&
    (!value.intervals.some((interval) => interval.outcome === "unknown") ||
      value.collection.state === "partial")
  );
}

export const RunTimingAttachmentSchema = RunTimingAttachmentStructuralSchema.pipe(
  Schema.filter(isCanonicalRunTimingAttachment, {
    identifier: "ObservabilityRunTimingAttachment",
    description: "a canonical, bounded run timing tree",
  }),
);

export type RunTimingAttachment = Schema.Schema.Type<typeof RunTimingAttachmentSchema>;
