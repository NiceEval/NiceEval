import type { AssertionEntryId } from "../identity.ts";
import type { Sha256Digest } from "../../record/model/identifiers.ts";

/**
 * `entryId` is only stable inside one Assertions Attachment. It is not an
 * authoring key and deliberately has no cross-Attempt meaning.
 */
export {
  ASSERTION_ENTRY_ID_BRAND,
} from "../identity.ts";
export type { AssertionEntryId } from "../identity.ts";

export type BoundedJsonPrimitive = null | boolean | number | string;

export interface BoundedJsonObject {
  readonly [key: string]: BoundedJsonValue;
}

/** JSON-only material that is bounded by the Assertions v1 decoder. */
export type BoundedJsonValue =
  | BoundedJsonPrimitive
  | readonly BoundedJsonValue[]
  | BoundedJsonObject;

export interface AssertionDisplay {
  readonly key?: string;
  readonly label?: string;
  readonly groupPath: readonly string[];
}

/** The outer builtin shape deliberately preserves an unknown future id. */
export interface BuiltInCriterionEnvelope {
  readonly kind: "builtin";
  readonly id: string;
  readonly data: BoundedJsonValue;
}

/** Third-party data is exact JSON owned by the named third-party schema. */
export interface ThirdPartyCriterion {
  readonly name: string;
  readonly schemaId: string;
  readonly data: BoundedJsonValue;
}

/** Raw identity envelope used by the reader's second decode phase. */
export type CriterionEnvelope =
  | BuiltInCriterionEnvelope
  | ThirdPartyCriterion;

export type CriterionOuterEnvelope = CriterionEnvelope;

export type BuiltInCriterion =
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
export type WritableCriterionEnvelope = BuiltInCriterion | ThirdPartyCriterion;

export type AssertionMaterial<BlobRef> =
  | {
      readonly kind: "snapshot";
      readonly value: BoundedJsonValue;
    }
  | {
      readonly kind: "blob";
      readonly ref: BlobRef;
      readonly encoding: "utf-8" | "binary";
      readonly byteLength: number;
      /** SHA-256 of the exact retained blob bytes. */
      readonly sha256: Sha256Digest;
      readonly preview: string;
    };

export type AssertionCoverage =
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

export type AssertionLimitation =
  | { readonly kind: "redacted"; readonly fieldCount: number }
  | {
      readonly kind: "sampled";
      readonly captured: number;
      readonly knownTotal?: number;
    }
  | { readonly kind: "truncated"; readonly omittedBytes: number }
  | { readonly kind: "provider-limited" };

export type GateDisposition =
  | "not-gate"
  | "satisfied"
  | "failed"
  | "unavailable"
  | "not-applicable";

export interface NoScoreContribution {
  readonly state: "not-scored";
}

export interface EarnedScoreContribution {
  readonly state: "earned";
  readonly points: number;
  readonly earned: number;
}

export interface UnavailableScoreContribution {
  readonly state: "unavailable";
  readonly points: number;
  readonly reason:
    | "source-unavailable"
    | "evaluation-errored"
    | "not-applicable";
}

export type ScoreContribution =
  | NoScoreContribution
  | EarnedScoreContribution
  | UnavailableScoreContribution;

export type SealedAssertionResult =
  | {
      readonly state: "matched";
      readonly gate: "not-gate" | "satisfied";
      readonly score: NoScoreContribution | EarnedScoreContribution;
      /** Bounded evaluator diagnostics, including ToolMatch evidence paths. */
      readonly diagnostic?: BoundedJsonObject;
    }
  | {
      readonly state: "mismatched";
      readonly reason: "condition-not-met";
      readonly gate: "not-gate" | "failed";
      readonly score: NoScoreContribution | EarnedScoreContribution;
      readonly diagnostic?: BoundedJsonObject;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "evidence-unavailable" | "source-unavailable" | "redacted";
      readonly gate: "not-gate" | "unavailable";
      readonly score: NoScoreContribution | UnavailableScoreContribution;
      readonly diagnostic?: BoundedJsonObject;
    }
  | {
      readonly state: "errored";
      readonly reason: "evaluator-failed" | "producer-interrupted" | "invalid-subject";
      readonly gate: "not-gate" | "unavailable";
      readonly score: NoScoreContribution | UnavailableScoreContribution;
      readonly diagnostic?: BoundedJsonObject;
    }
  | {
      readonly state: "not-applicable";
      readonly reason: "coverage-not-applicable";
      readonly gate: "not-gate" | "not-applicable";
      readonly score: NoScoreContribution | UnavailableScoreContribution;
      readonly diagnostic?: BoundedJsonObject;
    };

/** The exact v1 value that a producer is allowed to seal. */
export interface AssertionEntry<BlobRef> {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionDisplay;
  readonly criterion: WritableCriterionEnvelope;
  readonly subject: AssertionMaterial<BlobRef>;
  readonly evidence: readonly AssertionMaterial<BlobRef>[];
  readonly coverage: AssertionCoverage;
  readonly limitations: readonly AssertionLimitation[];
  readonly result: SealedAssertionResult;
}

/**
 * Reader framing intentionally leaves `criterion` as bounded JSON.  This
 * lets a bad plugin or future criterion affect its entry only after every
 * other entry boundary has already been verified.
 */
export interface AssertionEntryOuter<BlobRef> {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionDisplay;
  readonly criterion: BoundedJsonObject;
  readonly subject: AssertionMaterial<BlobRef>;
  readonly evidence: readonly AssertionMaterial<BlobRef>[];
  readonly coverage: AssertionCoverage;
  readonly limitations: readonly AssertionLimitation[];
  readonly result: SealedAssertionResult;
}

export interface AssertionsDocument<BlobRef> {
  readonly entries: readonly AssertionEntry<BlobRef>[];
}

export interface AssertionsDocumentOuter<BlobRef> {
  readonly entries: readonly AssertionEntryOuter<BlobRef>[];
}

export type AssertionEntryRead<BlobRef> =
  | { readonly state: "available"; readonly entry: AssertionEntry<BlobRef> }
  | {
      readonly state: "unsupported";
      readonly entry: AssertionEntryOuter<BlobRef>;
      readonly reason: "builtin-unknown" | "third-party-schema-unavailable";
    }
  | {
      readonly state: "invalid";
      readonly entry: AssertionEntryOuter<BlobRef>;
      readonly reason: "criterion-envelope-invalid" | "criterion-data-invalid";
    };

export interface AssertionsProjection<BlobRef> {
  readonly entries: readonly AssertionEntryRead<BlobRef>[];
}
