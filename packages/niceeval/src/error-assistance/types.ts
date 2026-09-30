import type { JsonValue } from "../shared/types.ts";

export type ErrorSource =
  | {
      readonly state: "located";
      readonly file: string;
      readonly line: number;
      readonly column: number;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "not-recorded" | "unresolvable" | "budget-exhausted";
    };

export interface MigrationOccurrence {
  readonly guideId: string;
  readonly source: ErrorSource;
  readonly subject: string;
}

export interface MigrationGuide {
  readonly id: string;
  readonly language: "en";
  readonly format: "markdown";
  readonly content: string;
}

/**
 * A feature-owned, safe explanation of a failure. `summary` and `nextStep`
 * must be static owner text; thrown values and secrets never enter this type.
 */
export interface ErrorDiagnostic {
  readonly code: string;
  readonly owner: string;
  readonly summary: string;
  readonly repairTarget: string;
  readonly nextStep: string;
  /** Safe owner-supplied label, never a serialization of the failed value. */
  readonly affectedObject: string;
  /** Distinguishes services that can use the same repair target. */
  readonly service?: string;
  readonly guideId?: string;
  readonly source?: ErrorSource;
}

export interface ErrorAssistanceData {
  readonly __niceevalErrorAssistance: 1;
  readonly owner: string;
  readonly repairTarget: string;
  readonly nextStep: string;
  readonly service?: string;
  readonly guideId?: string;
  readonly sources: readonly JsonValue[];
  readonly affected: readonly JsonValue[];
  readonly sourceLocationsOmitted: number;
  readonly affectedObjectsOmitted: number;
}

export interface ErrorAffectedAttempt {
  readonly experimentId?: string;
  readonly evalId: string;
  readonly attempt: number;
}

export interface ErrorFeedbackDiagnostic {
  readonly key: string;
  readonly code: string;
  readonly severity: "error";
  readonly message: string;
  readonly data: Readonly<Record<string, JsonValue>>;
}
