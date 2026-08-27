export const EVALUATION_KINDS = ["pass", "score"] as const;
export type EvaluationKind = (typeof EVALUATION_KINDS)[number];
