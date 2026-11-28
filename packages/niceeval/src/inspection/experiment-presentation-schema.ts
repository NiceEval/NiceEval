import * as Schema from "effect/Schema";

export const InspectionRunSummarySchema = Schema.Struct({
  runId: Schema.String,
  experimentId: Schema.String,
  displayName: Schema.String,
  displayNameState: Schema.Literals(["recorded", "fallback-missing", "unavailable"]),
});

export const InspectionPresentationIssueSchema = Schema.Struct({
  code: Schema.Literal("experiment-presentation-unavailable"),
  runId: Schema.String,
  problems: Schema.Array(Schema.String),
});

export type InspectionRunSummary = Schema.Schema.Type<typeof InspectionRunSummarySchema>;
export type InspectionPresentationIssue = Schema.Schema.Type<typeof InspectionPresentationIssueSchema>;
