export const EVALUATION_KINDS = ["pass", "score"] as const;
/** Selects Pass or Score evaluation semantics; a Score Eval's low score alone does not imply a failed Verdict. */
export type EvaluationKind = (typeof EVALUATION_KINDS)[number];
