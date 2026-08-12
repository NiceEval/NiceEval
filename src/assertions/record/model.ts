import type { Brand } from "effect";

/**
 * `entryId` is only stable inside one Assertions Attachment.  It is not an
 * authoring key and deliberately has no cross-Attempt meaning.
 */
export const ASSERTION_ENTRY_ID_BRAND =
  "@niceeval/assertions/AssertionEntryId" as const;

export type AssertionEntryId =
  string & Brand.Brand<typeof ASSERTION_ENTRY_ID_BRAND>;

export type BoundedJsonPrimitiveV1 = null | boolean | number | string;

export interface BoundedJsonObjectV1 {
  readonly [key: string]: BoundedJsonValueV1;
}

/** JSON-only material that is bounded by the Assertions v1 decoder. */
export type BoundedJsonValueV1 =
  | BoundedJsonPrimitiveV1
  | readonly BoundedJsonValueV1[]
  | BoundedJsonObjectV1;

export interface AssertionDisplayV1 {
  readonly key?: string;
  readonly label?: string;
  readonly groupPath: readonly string[];
}

/** The outer builtin shape deliberately preserves an unknown future id. */
export interface BuiltInCriterionEnvelopeV1 {
  readonly kind: "builtin";
  readonly id: string;
  readonly data: BoundedJsonValueV1;
}

/** Third-party data is exact JSON owned by the named third-party schema. */
export interface ThirdPartyCriterionV1 {
  readonly name: string;
  readonly schemaId: string;
  readonly data: BoundedJsonValueV1;
}

/** Raw identity envelope used by the reader's second decode phase. */
export type CriterionEnvelopeV1 =
  | BuiltInCriterionEnvelopeV1
  | ThirdPartyCriterionV1;

export type CriterionOuterEnvelopeV1 = CriterionEnvelopeV1;

export type BuiltInCriterionV1 =
  | {
      readonly kind: "builtin";
      readonly id: "value-match/v1";
      readonly data: { readonly subject: "explicit-value" };
    }
  | {
      readonly kind: "builtin";
      readonly id: "scope-status/v1";
      readonly data: {
        readonly scope: "turn" | "session" | "attempt";
        readonly assertion: "succeeded" | "no-failed-actions";
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "occurrence/v1";
      readonly data: {
        readonly scope: "turn" | "session" | "attempt";
        readonly occurrence: "tool" | "skill" | "event";
        readonly assertion: "present" | "absent" | "count";
        /** Tool assertions retain the single managed matcher identity. */
        readonly matcher?: string;
        readonly quantifier?:
          | { readonly kind: "absent" }
          | { readonly kind: "at-least" | "exact"; readonly count: number };
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "judge-measurement/v1";
      readonly data: {
        readonly recipe: "closed-qa" | "factuality" | "summarizes";
        readonly scale: "unit-interval";
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "sandbox-result/v1";
      readonly data: {
        readonly operation: "changed-paths";
        readonly paths: readonly string[];
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "sandbox-result/v1";
      readonly data: { readonly operation: "no-changes" };
    }
  | {
      readonly kind: "builtin";
      readonly id: "sandbox-result/v1";
      readonly data: {
        readonly operation: "file-changed";
        readonly path: string;
        readonly status?: "added" | "modified" | "deleted";
        /** Persisted display identity only; evaluators retain the managed Match. */
        readonly before?: string;
        readonly after?: string;
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "sandbox-result/v1";
      readonly data: {
        readonly operation: "file-deleted";
        readonly path: string;
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "sandbox-result/v1";
      readonly data: {
        readonly operation: "not-in-diff";
        readonly pattern: string;
        readonly flags: string;
        readonly content: "added" | "removed" | "both";
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "direct-score/v1";
      readonly data: { readonly source: "author" };
    };

/** A v1 writer may only emit a known builtin or a versioned third-party schema. */
export type WritableCriterionEnvelopeV1 = BuiltInCriterionV1 | ThirdPartyCriterionV1;

export type AssertionMaterialV1<BlobRef> =
  | {
      readonly kind: "snapshot";
      readonly value: BoundedJsonValueV1;
    }
  | {
      readonly kind: "blob";
      readonly ref: BlobRef;
      readonly encoding: "utf-8" | "binary";
      readonly byteLength: number;
      readonly preview: string;
    }
  /**
   * An Assertion can name an exact, same-owner Attachment without receiving a
   * storage handle.  v1 deliberately exposes no hash, path, blob ref, or
   * evidence id here: the Evaluation Record contract verifies the matching
   * Attempt write before a complete marker can be published.
   */
  | {
      readonly kind: "record-attachment";
      readonly schemaId: "niceeval.diff/v1";
      readonly preview: string;
    };

export type AssertionCoverageV1 =
  | { readonly state: "complete" }
  | {
      readonly state: "partial";
      readonly reason: "sampled" | "truncated" | "redacted" | "provider-limited";
    }
  | {
      readonly state: "unavailable";
      readonly reason: "not-collected" | "source-unavailable" | "producer-failed";
    }
  | {
      readonly state: "not-applicable";
      readonly reason: "optional-material" | "unsupported-subject";
    };

export type AssertionLimitationV1 =
  | { readonly kind: "redacted"; readonly fieldCount: number }
  | {
      readonly kind: "sampled";
      readonly captured: number;
      readonly knownTotal?: number;
    }
  | { readonly kind: "truncated"; readonly omittedBytes: number }
  | { readonly kind: "provider-limited" };

export type GateDispositionV1 =
  | "not-gate"
  | "satisfied"
  | "failed"
  | "unavailable"
  | "not-applicable";

export interface NoScoreContributionV1 {
  readonly state: "not-scored";
}

export interface EarnedScoreContributionV1 {
  readonly state: "earned";
  readonly points: number;
  readonly earned: number;
}

export interface UnavailableScoreContributionV1 {
  readonly state: "unavailable";
  readonly points: number;
  readonly reason:
    | "source-unavailable"
    | "evaluation-errored"
    | "not-applicable";
}

export type ScoreContributionV1 =
  | NoScoreContributionV1
  | EarnedScoreContributionV1
  | UnavailableScoreContributionV1;

export type SealedAssertionResultV1 =
  | {
      readonly state: "matched";
      readonly gate: "not-gate" | "satisfied";
      readonly score: NoScoreContributionV1 | EarnedScoreContributionV1;
      /** Bounded evaluator diagnostics, including ToolMatch evidence paths. */
      readonly diagnostic?: BoundedJsonObjectV1;
    }
  | {
      readonly state: "mismatched";
      readonly reason: "condition-not-met";
      readonly gate: "not-gate" | "failed";
      readonly score: NoScoreContributionV1 | EarnedScoreContributionV1;
      readonly diagnostic?: BoundedJsonObjectV1;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "evidence-unavailable" | "source-unavailable" | "redacted";
      readonly gate: "not-gate" | "unavailable";
      readonly score: NoScoreContributionV1 | UnavailableScoreContributionV1;
      readonly diagnostic?: BoundedJsonObjectV1;
    }
  | {
      readonly state: "errored";
      readonly reason: "evaluator-failed" | "producer-interrupted" | "invalid-subject";
      readonly gate: "not-gate" | "unavailable";
      readonly score: NoScoreContributionV1 | UnavailableScoreContributionV1;
      readonly diagnostic?: BoundedJsonObjectV1;
    }
  | {
      readonly state: "not-applicable";
      readonly reason: "coverage-not-applicable";
      readonly gate: "not-gate" | "not-applicable";
      readonly score: NoScoreContributionV1 | UnavailableScoreContributionV1;
      readonly diagnostic?: BoundedJsonObjectV1;
    };

/** The exact v1 value that a producer is allowed to seal. */
export interface AssertionEntryV1<BlobRef> {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionDisplayV1;
  readonly criterion: WritableCriterionEnvelopeV1;
  readonly subject: AssertionMaterialV1<BlobRef>;
  readonly evidence: readonly AssertionMaterialV1<BlobRef>[];
  readonly coverage: AssertionCoverageV1;
  readonly limitations: readonly AssertionLimitationV1[];
  readonly result: SealedAssertionResultV1;
}

/**
 * Reader framing intentionally leaves `criterion` as bounded JSON.  This
 * lets a bad plugin or future criterion affect its entry only after every
 * other entry boundary has already been verified.
 */
export interface AssertionEntryOuterV1<BlobRef> {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionDisplayV1;
  readonly criterion: BoundedJsonObjectV1;
  readonly subject: AssertionMaterialV1<BlobRef>;
  readonly evidence: readonly AssertionMaterialV1<BlobRef>[];
  readonly coverage: AssertionCoverageV1;
  readonly limitations: readonly AssertionLimitationV1[];
  readonly result: SealedAssertionResultV1;
}

export interface AssertionsDocumentV1<BlobRef> {
  readonly entries: readonly AssertionEntryV1<BlobRef>[];
}

export interface AssertionsDocumentOuterV1<BlobRef> {
  readonly entries: readonly AssertionEntryOuterV1<BlobRef>[];
}

export type AssertionEntryReadV1<BlobRef> =
  | { readonly state: "available"; readonly entry: AssertionEntryV1<BlobRef> }
  | {
      readonly state: "unsupported";
      readonly entry: AssertionEntryOuterV1<BlobRef>;
      readonly reason: "builtin-unknown" | "third-party-schema-unavailable";
    }
  | {
      readonly state: "invalid";
      readonly entry: AssertionEntryOuterV1<BlobRef>;
      readonly reason: "criterion-envelope-invalid" | "criterion-data-invalid";
    };

export interface AssertionsProjectionV1<BlobRef> {
  readonly entries: readonly AssertionEntryReadV1<BlobRef>[];
}
