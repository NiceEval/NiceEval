import { Effect } from "effect";

import type { EvalResult, PhaseTiming, TimingActivity } from "../types.ts";
import { formatTurnLabel } from "../../shared/turn-label.ts";
import {
  MAX_TIMING_INTERVALS,
} from "../../record/family/source-receipt/limits.ts";
import {
  compareObservabilityText,
  makeNonNegativeSafeInteger,
  makeStableLabel,
  type IntervalId,
  type NonNegativeSafeInteger,
  type ObservabilityEntityIdForKind,
  type ObservabilityEntityKind,
  type StableLabel,
  type TurnId,
} from "../../record/family/source-receipt/model.ts";
import type {
  AttemptTimingAttachment,
  AttemptTimingInterval,
} from "./model.ts";
import {
  RunnerCollectionLimitations,
  requiredNonNegative,
  type RunnerObservabilityProducerError,
} from "./support.ts";

type AttemptEntityMinter = <Kind extends ObservabilityEntityKind>(
  kind: Kind,
) => Effect.Effect<ObservabilityEntityIdForKind<Kind>, RunnerObservabilityProducerError>;

interface TimingConversationTurn {
  readonly turnId: TurnId;
}

function stableLabel(value: string): StableLabel | undefined {
  return makeStableLabel(value);
}

type AttemptTimingProjection =
  | {
      readonly kind: "attempt";
      readonly phase: AttemptTimingInterval["phase"];
      readonly label: StableLabel | ReturnType<typeof formatTurnLabel>;
    }
  | { readonly kind: "outside-attempt-domain" }
  | { readonly kind: "unsupported" };

function attemptTimingProjection(phase: string): AttemptTimingProjection {
  const label = stableLabel(phase);
  if (label === undefined) return Object.freeze({ kind: "unsupported" as const });
  switch (phase) {
    case "sandbox.create":
    case "workspace.baseline":
    case "agent.setup":
    case "telemetry.configure":
    case "sandbox.queue":
      return Object.freeze({ kind: "attempt" as const, phase: "attempt.setup" as const, label });
    case "sandbox.prepare":
    case "sandbox.prepare.eval":
    case "sandbox.prepare.group":
    case "sandbox.prepare.experiment":
      return Object.freeze({ kind: "attempt" as const, phase: "sandbox.prepare" as const, label });
    case "agent.ensure":
      return Object.freeze({ kind: "attempt" as const, phase: "agent.ensure" as const, label });
    case "eval.run":
      return Object.freeze({ kind: "attempt" as const, phase: "eval.run" as const, label });
    case "assertions.evaluate":
      return Object.freeze({ kind: "attempt" as const, phase: "assertion.evaluate" as const, label });
    case "agent.teardown":
    case "sandbox.cleanup":
    case "sandbox.suspend":
    case "sandbox.stop":
    case "workspace.diff":
    case "telemetry.collect":
      return Object.freeze({ kind: "attempt" as const, phase: "attempt.teardown" as const, label });
    case "judge.precheck":
    case "experiment.setup":
    case "experiment.teardown":
    case "agent.run":
      return Object.freeze({ kind: "outside-attempt-domain" as const });
    default:
      return Object.freeze({ kind: "unsupported" as const });
  }
}

function validPhaseDuration(value: PhaseTiming): NonNegativeSafeInteger | undefined {
  return makeNonNegativeSafeInteger(value.durationMs);
}

function validPhaseStartOffset(value: PhaseTiming): NonNegativeSafeInteger | undefined {
  return makeNonNegativeSafeInteger(value.startOffsetMs);
}

function timingActivityProjection(
  activity: TimingActivity,
): {
  readonly phase: AttemptTimingInterval["phase"];
  readonly label: StableLabel | ReturnType<typeof formatTurnLabel>;
} | undefined {
  const phase = (() => {
    switch (activity.key) {
    case "agent.turn":
      return "agent.send" as const;
    case "sandbox.command":
      return "sandbox.command" as const;
    case "sandbox.prepare":
      return "sandbox.prepare" as const;
    case "workspace.diff.export":
      return "attempt.teardown" as const;
    default:
      return undefined;
    }
  })();
  if (phase === undefined) return undefined;
  // Runner's activity label is human-facing and can contain spaces or other
  // SafeText punctuation. Standard activities retain a stable key when their
  // display label cannot cross the durable boundary. Native agent turns keep
  // their canonical slash coordinate so the Record writer never invents a
  // dot-encoded historical label.
  const label = activity.key === "agent.turn"
      && activity.sessionIndex !== undefined
      && activity.turnIndex !== undefined
    ? formatTurnLabel(activity.sessionIndex, activity.turnIndex)
    : stableLabel(activity.label) ?? stableLabel(activity.key);
  if (label === undefined) return undefined;
  return Object.freeze({ phase, label });
}

function validTimingActivityStart(activity: TimingActivity): NonNegativeSafeInteger | undefined {
  return makeNonNegativeSafeInteger(activity.startOffsetMs);
}

function validTimingActivityDuration(activity: TimingActivity): NonNegativeSafeInteger | undefined {
  return makeNonNegativeSafeInteger(activity.durationMs);
}

function timingSpanContains(input: {
  readonly parentStartOffsetMs: NonNegativeSafeInteger;
  readonly parentDurationMs: NonNegativeSafeInteger;
  readonly childStartOffsetMs: NonNegativeSafeInteger;
  readonly childDurationMs: NonNegativeSafeInteger;
}): boolean {
  const parentEnd = input.parentStartOffsetMs + input.parentDurationMs;
  const childEnd = input.childStartOffsetMs + input.childDurationMs;
  return (
    Number.isSafeInteger(parentEnd) &&
    Number.isSafeInteger(childEnd) &&
    input.parentStartOffsetMs <= input.childStartOffsetMs &&
    childEnd <= parentEnd
  );
}

interface NormalizedAttemptTimingWithTurnIntervals {
  readonly timing: AttemptTimingAttachment;
  readonly intervalByTurnId: ReadonlyMap<TurnId, IntervalId>;
}

export function normalizeAttemptTiming(input: {
  readonly result: EvalResult;
  readonly mint: AttemptEntityMinter;
  readonly turns: readonly TimingConversationTurn[];
}): Effect.Effect<NormalizedAttemptTimingWithTurnIntervals, RunnerObservabilityProducerError> {
  return Effect.gen(function* () {
    const limitations = new RunnerCollectionLimitations();
    const turnsById = new Map<string, TimingConversationTurn>(
      input.turns.map((turn) => [turn.turnId, turn] as const),
    );
    const intervalByTurnId = new Map<TurnId, IntervalId>();
    const ambiguousTurnIntervals = new Set<TurnId>();
    const phases = input.result.phases;
    if (phases === undefined) {
      limitations.addCaptureFailed("timing-capture", "timing-interval");
      return Object.freeze({
        timing: Object.freeze({ collection: limitations.collection(), intervals: Object.freeze([]) }),
        intervalByTurnId: new Map(),
      });
    }

    const intervals: AttemptTimingInterval[] = [];
    const appendActivities = (
      activities: readonly TimingActivity[] | undefined,
      parent: {
        readonly intervalId: IntervalId;
        readonly startOffsetMs: NonNegativeSafeInteger;
        /** Offset in the Runner's unfiltered phase clock. */
        readonly sourceStartOffsetMs: NonNegativeSafeInteger;
        readonly durationMs: NonNegativeSafeInteger;
      } | undefined,
      ancestors: ReadonlySet<TimingActivity>,
    ): Effect.Effect<void, RunnerObservabilityProducerError> => Effect.gen(function* () {
      for (const activity of activities ?? []) {
        if (ancestors.has(activity)) {
          limitations.addUnsupported("timing-interval");
          continue;
        }
        const projection = timingActivityProjection(activity);
        const sourceStartOffsetMs = validTimingActivityStart(activity);
        const durationMs = validTimingActivityDuration(activity);
        const relativeStartOffsetMs = parent === undefined || sourceStartOffsetMs === undefined
          ? sourceStartOffsetMs
          : makeNonNegativeSafeInteger(sourceStartOffsetMs - parent.sourceStartOffsetMs);
        const translatedStartOffsetMs = parent === undefined || relativeStartOffsetMs === undefined
          ? relativeStartOffsetMs
          : makeNonNegativeSafeInteger(parent.startOffsetMs + relativeStartOffsetMs);
        // A known activity with safe source-clock values remains a fact even
        // when this parent-relative conversion cannot be proven. Persist its
        // original interval as a root rather than turning a missing causal
        // edge into an unsupported-input limitation.
        const startOffsetMs = translatedStartOffsetMs ?? sourceStartOffsetMs;
        if (
          projection === undefined
          || sourceStartOffsetMs === undefined
          || startOffsetMs === undefined
          || durationMs === undefined
        ) {
          limitations.addUnsupported("timing-interval");
          continue;
        }
        if (intervals.length >= MAX_TIMING_INTERVALS) {
          limitations.addCap("timing-interval", intervals.length);
          continue;
        }
        const intervalId = yield* input.mint("interval");
        const parentIntervalId = parent === undefined || translatedStartOffsetMs === undefined
          ? null
          : timingSpanContains({
              parentStartOffsetMs: parent.startOffsetMs,
              parentDurationMs: parent.durationMs,
              childStartOffsetMs: startOffsetMs,
              childDurationMs: durationMs,
            })
            ? parent.intervalId
            : null;
        intervals.push(Object.freeze({
          intervalId,
          phase: projection.phase,
          label: projection.label,
          startOffsetMs,
          durationMs,
          parentIntervalId,
          outcome: activity.failed ? "failed" as const : "completed" as const,
          refs: Object.freeze([]),
        }));
        if (activity.key === "agent.turn" && activity.turnId !== undefined) {
          const turnId = turnsById.get(activity.turnId)?.turnId;
          if (turnId !== undefined) {
            if (intervalByTurnId.has(turnId) || ambiguousTurnIntervals.has(turnId)) {
              intervalByTurnId.delete(turnId);
              ambiguousTurnIntervals.add(turnId);
            } else {
              intervalByTurnId.set(turnId, intervalId);
            }
          }
        }
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(activity);
        yield* appendActivities(
          activity.children,
          Object.freeze({
            intervalId,
            startOffsetMs,
            sourceStartOffsetMs,
            durationMs,
          }),
          nextAncestors,
        );
      }
    });
    // `phases` also carries a few known Run-owned anchors for first-dispatched
    // work. Keep their raw clock for child translation, but do not let them
    // create gaps in the Attempt execution-duration clock.
    let attemptOffset: NonNegativeSafeInteger | undefined = requiredNonNegative(0);
    for (const source of phases) {
      const duration = validPhaseDuration(source);
      const sourceStartOffsetMs = validPhaseStartOffset(source);
      const projection = attemptTimingProjection(source.name);
      if (
        duration === undefined
        || sourceStartOffsetMs === undefined
        || projection.kind === "unsupported"
        || attemptOffset === undefined
      ) {
        limitations.addUnsupported("timing-interval");
      } else if (projection.kind === "attempt" && intervals.length >= MAX_TIMING_INTERVALS) {
        limitations.addCap("timing-interval", intervals.length);
      } else if (projection.kind === "attempt") {
        const intervalId = yield* input.mint("interval");
        intervals.push(Object.freeze({
          intervalId,
          phase: projection.phase,
          label: projection.label,
          startOffsetMs: attemptOffset,
          durationMs: duration,
          parentIntervalId: null,
          outcome: source.failed ? "failed" as const : "completed" as const,
          refs: Object.freeze([]),
        }));
        yield* appendActivities(
          source.children,
          Object.freeze({
            intervalId,
            startOffsetMs: attemptOffset,
            sourceStartOffsetMs,
            durationMs: duration,
          }),
          new Set(),
        );
      }
      if (
        duration === undefined
        || sourceStartOffsetMs === undefined
        || attemptOffset === undefined
      ) {
        attemptOffset = undefined;
      } else {
        if (projection.kind !== "outside-attempt-domain") {
          attemptOffset = makeNonNegativeSafeInteger(attemptOffset + duration);
        }
      }
    }
    return Object.freeze({
      timing: Object.freeze({
        collection: limitations.collection(),
        // The durable timing family canonically orders by opaque entity id; the
        // offsets retain the Runner's actual lifecycle order.
        intervals: Object.freeze(
          [...intervals].sort((left, right) =>
            compareObservabilityText(left.intervalId, right.intervalId),
          ),
        ),
      }),
      intervalByTurnId: new Map(intervalByTurnId),
    });
  });
}
