import { Either, Schema } from "effect";
import {
  ExactEvaluationParseOptions,
  FiniteNonNegativeNumberSchema,
} from "./attachment.ts";

/**
 * Eligibility is a current reuse-policy calculation. Record persists neither
 * an eligibility payload nor a second duration claim: source identity lives in
 * Core and source timing lives in fixed Observability.
 */
export const EXECUTION_DURATION_DOMAIN = "niceeval.execution-duration/v1" as const;
export const EQUALITY_TOKEN_DOMAIN_MAXIMUM_LENGTH = 255 as const;
export const EQUALITY_TOKEN_VALUE_MAXIMUM_LENGTH = 4096 as const;

function isBoundedNonEmptyText(value: string, maximumLength: number): boolean {
  return value.length > 0 && value.length <= maximumLength;
}

export const EqualityTokenSchema = Schema.Struct({
  domain: Schema.String.pipe(Schema.filter((value) => isBoundedNonEmptyText(value, EQUALITY_TOKEN_DOMAIN_MAXIMUM_LENGTH))),
  value: Schema.String.pipe(Schema.filter((value) => isBoundedNonEmptyText(value, EQUALITY_TOKEN_VALUE_MAXIMUM_LENGTH))),
});
export type EqualityToken = Schema.Schema.Type<typeof EqualityTokenSchema>;

export const DurationLimitSchema = Schema.Struct({
  domain: Schema.String.pipe(Schema.filter((value) => isBoundedNonEmptyText(value, EQUALITY_TOKEN_DOMAIN_MAXIMUM_LENGTH))),
  milliseconds: FiniteNonNegativeNumberSchema,
});
export type DurationLimit = Schema.Schema.Type<typeof DurationLimitSchema>;

export function isEqualityToken(value: unknown): value is EqualityToken {
  return Either.isRight(Schema.decodeUnknownEither(EqualityTokenSchema, ExactEvaluationParseOptions)(value));
}

export function isDurationLimit(value: unknown): value is DurationLimit {
  return Either.isRight(Schema.decodeUnknownEither(DurationLimitSchema, ExactEvaluationParseOptions)(value));
}

export type AttemptExecutionDurationRead =
  | { readonly state: "available"; readonly duration: DurationLimit }
  | {
      readonly state: "unavailable";
      readonly reason:
        | "timing-partial"
        | "timing-empty"
        | "timing-window-incomplete";
    };

/** The narrow fixed Observability surface needed for execution-time policy. */
export interface AttemptExecutionTimingFacts {
  readonly timing: {
    readonly collection: { readonly state: string };
    readonly intervals: readonly {
      readonly startOffsetMs: number;
      readonly durationMs: number;
      readonly parentIntervalId: string | null;
    }[];
  };
}

/**
 * Derive the policy's duration only from a complete, gap-free union of root
 * timing windows. Overlapping roots are concurrent credible observations, not
 * duplicate duration. A partial collection, an omitted root, or a gap is not
 * a trustworthy execution-duration fact and therefore must not be treated as
 * zero.
 */
export function readAttemptExecutionDuration(
  observability: AttemptExecutionTimingFacts,
): AttemptExecutionDurationRead {
  const timing = observability.timing;
  if (timing.collection.state !== "complete") {
    return Object.freeze({ state: "unavailable" as const, reason: "timing-partial" as const });
  }
  const roots = timing.intervals.filter((interval) => interval.parentIntervalId === null);
  if (roots.length === 0) {
    return Object.freeze({ state: "unavailable" as const, reason: "timing-empty" as const });
  }
  const sortedRoots = [...roots].sort((left, right) => left.startOffsetMs - right.startOffsetMs);
  let coveredEnd = 0;
  for (const interval of sortedRoots) {
    const end = interval.startOffsetMs + interval.durationMs;
    if (
      !Number.isSafeInteger(interval.startOffsetMs)
      || interval.startOffsetMs < 0
      || !Number.isSafeInteger(interval.durationMs)
      || interval.durationMs < 0
      || !Number.isSafeInteger(end)
      || interval.startOffsetMs > coveredEnd
    ) {
      return Object.freeze({
        state: "unavailable" as const,
        reason: "timing-window-incomplete" as const,
      });
    }
    coveredEnd = Math.max(coveredEnd, end);
  }
  return Object.freeze({
    state: "available" as const,
    duration: Object.freeze({
      domain: EXECUTION_DURATION_DOMAIN,
      milliseconds: coveredEnd,
    }),
  });
}
