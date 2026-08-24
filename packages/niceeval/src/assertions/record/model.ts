import type { AssertionEntryId } from "../identity.ts";

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

/** JSON-only material bounded before it enters a Record content source. */
export type BoundedJsonValue =
  | BoundedJsonPrimitive
  | readonly BoundedJsonValue[]
  | BoundedJsonObject;

export interface AssertionDisplay {
  readonly key?: string;
  readonly label?: string;
  readonly groupPath: readonly string[];
}

export type AssertionFactValue =
  | { readonly kind: "unavailable"; readonly reason: "not-recorded" | "not-declared" | "source-unavailable" }
  | { readonly kind: "value"; readonly value: BoundedJsonPrimitive }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly AssertionFactValue[] }
  | { readonly kind: "fields"; readonly fields: readonly AssertionFactField[] };

export interface AssertionFactField {
  readonly label: string;
  readonly value: AssertionFactValue;
}

export interface AssertionDecisionPolicy {
  readonly requirement:
    | { readonly state: "available"; readonly value: "required" | "optional" }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
  readonly condition:
    | {
        readonly state: "available";
        readonly value:
          | { readonly kind: "boolean"; readonly expected: true }
          | { readonly kind: "at-least"; readonly threshold: number }
          | { readonly kind: "record-only" };
      }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
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
      readonly data: {
        readonly subject: "explicit-value";
        readonly matcher: { readonly state: "declared"; readonly name: string } | { readonly state: "unavailable" };
      };
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

export type AssertionMaterial<Content> =
  | {
      readonly kind: "unavailable";
      readonly reason: "not-recorded";
    }
  | {
      readonly kind: "content";
      readonly content: Content;
      /** How the producer encoded the logical material into the sealed content. */
      readonly encoding: "json" | "utf-8" | "binary";
      readonly byteLength: number;
      /** Safe retained display metadata from capture; null when none was declared. */
      readonly preview: string | null;
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

export interface AssertionCollectionReceipt {
  readonly examined: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly unavailable: number;
  readonly knownTotal: number | null;
  readonly complete: boolean;
  readonly exhaustive: boolean;
  readonly decisive: boolean;
}

export type SealedAssertionResult =
  | {
      readonly state: "matched";
      readonly gate: "not-gate" | "satisfied";
      readonly score: NoScoreContribution | EarnedScoreContribution;
      /** Bounded evaluator diagnostics, including ToolMatch evidence paths. */
      readonly diagnostic?: BoundedJsonObject;
      readonly receipt?: AssertionCollectionReceipt;
    }
  | {
      readonly state: "mismatched";
      readonly reason: "condition-not-met";
      readonly gate: "not-gate" | "failed";
      readonly score: NoScoreContribution | EarnedScoreContribution;
      readonly diagnostic?: BoundedJsonObject;
      readonly receipt?: AssertionCollectionReceipt;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "evidence-unavailable" | "source-unavailable" | "redacted";
      readonly gate: "not-gate" | "unavailable";
      readonly score: NoScoreContribution | UnavailableScoreContribution;
      readonly diagnostic?: BoundedJsonObject;
      readonly receipt?: AssertionCollectionReceipt;
    }
  | {
      readonly state: "errored";
      readonly reason: "evaluator-failed" | "producer-interrupted" | "invalid-subject";
      readonly gate: "not-gate" | "unavailable";
      readonly score: NoScoreContribution | UnavailableScoreContribution;
      readonly diagnostic?: BoundedJsonObject;
      readonly receipt?: AssertionCollectionReceipt;
    }
  | {
      readonly state: "not-applicable";
      readonly reason: "coverage-not-applicable";
      readonly gate: "not-gate" | "not-applicable";
      readonly score: NoScoreContribution | UnavailableScoreContribution;
      readonly diagnostic?: BoundedJsonObject;
      readonly receipt?: AssertionCollectionReceipt;
    };

export type AssertionCriterionRecord =
  | { readonly state: "available"; readonly value: WritableCriterionEnvelope }
  | { readonly state: "unavailable"; readonly reason: "not-recorded" };

export type AssertionCriterionRecordOuter =
  | { readonly state: "available"; readonly value: BoundedJsonObject }
  | { readonly state: "unavailable"; readonly reason: "not-recorded" };

export interface AssertionMaterials<Content> {
  readonly source: AssertionMaterial<Content>;
  readonly evidence: readonly AssertionMaterial<Content>[];
  readonly coverage: AssertionCoverage;
  readonly limitations: readonly AssertionLimitation[];
}

export interface AssertionEvaluation {
  readonly observed: AssertionFactValue;
  readonly receipt?: AssertionCollectionReceipt;
}

export interface AssertionDecision {
  readonly result: "matched" | "mismatched" | "unavailable" | "errored" | "not-applicable";
  readonly reason:
    | "condition-not-met"
    | "evidence-unavailable"
    | "source-unavailable"
    | "redacted"
    | "evaluator-failed"
    | "producer-interrupted"
    | "invalid-subject"
    | "coverage-not-applicable"
    | null;
  readonly gate: GateDisposition;
}

export function sealedAssertionResult(entry: Pick<AssertionEntry<unknown>, "decision" | "contribution" | "evaluation">): SealedAssertionResult {
  const receipt = entry.evaluation.receipt === undefined ? {} : { receipt: entry.evaluation.receipt };
  switch (entry.decision.result) {
    case "matched":
      return Object.freeze({ state: "matched", gate: entry.decision.gate as "not-gate" | "satisfied", score: entry.contribution as NoScoreContribution | EarnedScoreContribution, ...receipt });
    case "mismatched":
      return Object.freeze({ state: "mismatched", reason: "condition-not-met", gate: entry.decision.gate as "not-gate" | "failed", score: entry.contribution as NoScoreContribution | EarnedScoreContribution, ...receipt });
    case "unavailable":
      return Object.freeze({ state: "unavailable", reason: entry.decision.reason as "evidence-unavailable" | "source-unavailable" | "redacted", gate: entry.decision.gate as "not-gate" | "unavailable", score: entry.contribution as NoScoreContribution | UnavailableScoreContribution, ...receipt });
    case "errored":
      return Object.freeze({ state: "errored", reason: entry.decision.reason as "evaluator-failed" | "producer-interrupted" | "invalid-subject", gate: entry.decision.gate as "not-gate" | "unavailable", score: entry.contribution as NoScoreContribution | UnavailableScoreContribution, ...receipt });
    case "not-applicable":
      return Object.freeze({ state: "not-applicable", reason: "coverage-not-applicable", gate: entry.decision.gate as "not-gate" | "not-applicable", score: entry.contribution as NoScoreContribution | UnavailableScoreContribution, ...receipt });
  }
}

export type ExplanationRetention =
  | { readonly state: "retained"; readonly value: AssertionFactValue }
  | { readonly state: "unavailable"; readonly reason: "not-recorded" };

/** The sole current semantic entry. Each fact has exactly one durable owner. */
export interface AssertionEntry<Content> {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionDisplay;
  readonly criterion: AssertionCriterionRecord;
  readonly materials: AssertionMaterials<Content>;
  readonly evaluation: AssertionEvaluation;
  readonly decision: AssertionDecision;
  readonly policy: AssertionDecisionPolicy;
  readonly contribution: ScoreContribution;
  readonly explanationRetention: ExplanationRetention;
}

/**
 * Reader framing intentionally leaves `criterion` as bounded JSON.  This
 * lets a bad plugin or future criterion affect its entry only after every
 * other entry boundary has already been verified.
 */
export interface AssertionEntryOuter<Content> {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionDisplay;
  readonly criterion: AssertionCriterionRecordOuter;
  readonly materials: AssertionMaterials<Content>;
  readonly evaluation: AssertionEvaluation;
  readonly decision: AssertionDecision;
  readonly policy: AssertionDecisionPolicy;
  readonly contribution: ScoreContribution;
  readonly explanationRetention: ExplanationRetention;
}

export interface AssertionsDocument<Content> {
  readonly entries: readonly AssertionEntry<Content>[];
}

export interface AssertionsDocumentOuter<Content> {
  readonly entries: readonly AssertionEntryOuter<Content>[];
}

export type AssertionEntryRead<Content> =
  | { readonly state: "available"; readonly entry: AssertionEntry<Content> }
  | {
      readonly state: "unsupported";
      readonly entry: AssertionEntryOuter<Content>;
      readonly reason: "builtin-unknown" | "third-party-schema-unavailable";
    }
  | {
      readonly state: "invalid";
      readonly entry: AssertionEntryOuter<Content>;
      readonly reason: "criterion-envelope-invalid" | "criterion-data-invalid";
    };

export interface AssertionsProjection<Content> {
  readonly entries: readonly AssertionEntryRead<Content>[];
}
