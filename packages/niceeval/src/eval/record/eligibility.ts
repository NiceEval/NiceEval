import { Result, Schema } from "effect";
import {
  ExactEvaluationParseOptions,
  FiniteNonNegativeNumberSchema,
} from "./attachment.ts";

/**
 * Eligibility is a current reuse-policy calculation. Record persists neither
 * an eligibility payload nor a second duration claim: source identity lives in
 * Core and source timing lives in Runner Activity receipts.
 */
export const EXECUTION_DURATION_DOMAIN = "niceeval.execution-duration/v1" as const;
export const EQUALITY_TOKEN_DOMAIN_MAXIMUM_LENGTH = 255 as const;
export const EQUALITY_TOKEN_VALUE_MAXIMUM_LENGTH = 4096 as const;

function isBoundedNonEmptyText(value: string, maximumLength: number): boolean {
  return value.length > 0 && value.length <= maximumLength;
}

export const EqualityTokenSchema = Schema.Struct({
  domain: Schema.String.pipe(Schema.refine((value): value is string => isBoundedNonEmptyText(value, EQUALITY_TOKEN_DOMAIN_MAXIMUM_LENGTH))),
  value: Schema.String.pipe(Schema.refine((value): value is string => isBoundedNonEmptyText(value, EQUALITY_TOKEN_VALUE_MAXIMUM_LENGTH))),
});
export type EqualityToken = Schema.toType<typeof EqualityTokenSchema>["Type"];

export const DurationLimitSchema = Schema.Struct({
  domain: Schema.String.pipe(Schema.refine((value): value is string => isBoundedNonEmptyText(value, EQUALITY_TOKEN_DOMAIN_MAXIMUM_LENGTH))),
  milliseconds: FiniteNonNegativeNumberSchema,
});
export type DurationLimit = Schema.toType<typeof DurationLimitSchema>["Type"];

export function isEqualityToken(value: unknown): value is EqualityToken {
  return Result.isSuccess(Schema.decodeUnknownResult(EqualityTokenSchema, ExactEvaluationParseOptions)(value));
}

export function isDurationLimit(value: unknown): value is DurationLimit {
  return Result.isSuccess(Schema.decodeUnknownResult(DurationLimitSchema, ExactEvaluationParseOptions)(value));
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

/** The narrow Runner Activity receipt surface needed for execution-time policy. */
export interface AttemptExecutionTimingFacts {
  readonly collection: { readonly state: string };
  readonly segments: readonly {
    readonly startOffsetMs: number;
    readonly durationMs: number;
    readonly parentActivityId: string | null;
  }[];
}

/**
 * Derive the policy's duration only from a complete, gap-free union of root
 * timing windows. Overlapping roots are concurrent credible observations, not
 * duplicate duration. A partial collection, an omitted root, or a gap is not
 * a trustworthy execution-duration fact and therefore must not be treated as
 * zero.
 */
export function readAttemptExecutionDuration(
  activities: AttemptExecutionTimingFacts,
): AttemptExecutionDurationRead {
  if (activities.collection.state !== "complete") {
    return Object.freeze({ state: "unavailable" as const, reason: "timing-partial" as const });
  }
  const roots = activities.segments.filter((activity) => activity.parentActivityId === null);
  if (roots.length === 0) {
    return Object.freeze({ state: "unavailable" as const, reason: "timing-empty" as const });
  }
  const sortedRoots = [...roots].sort((left, right) => left.startOffsetMs - right.startOffsetMs);
  let coveredEnd = 0;
  for (const activity of sortedRoots) {
    const end = activity.startOffsetMs + activity.durationMs;
    if (
      !Number.isSafeInteger(activity.startOffsetMs)
      || activity.startOffsetMs < 0
      || !Number.isSafeInteger(activity.durationMs)
      || activity.durationMs < 0
      || !Number.isSafeInteger(end)
      || activity.startOffsetMs > coveredEnd
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
