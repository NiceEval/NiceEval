import { Schema } from "effect";
import { ExperimentIdSchema, EvalIdSchema, RunIdSchema } from "../record/codec/identifiers.ts";
import { NonNegativeSafeIntegerSchema } from "../record/family/common.ts";
import { ATTEMPT_LOCATOR_PATTERN } from "../attempt-locator.ts";
import { InspectionOverviewResultSchema } from "./results.ts";

const LocatorSchema = Schema.String.check(Schema.makeFilter((value) => ATTEMPT_LOCATOR_PATTERN.test(value)));
const PositionFields = {
  experimentId: ExperimentIdSchema,
  evalId: EvalIdSchema,
  attemptOrdinal: NonNegativeSafeIntegerSchema,
};
const PreviousResultSchema = Schema.Struct({ sourceRunId: RunIdSchema, locator: LocatorSchema });
const ProjectIssueSchema: Schema.Codec<Schema.Json> = Schema.suspend(() => Schema.Union([
  Schema.Null, Schema.Boolean, Schema.Number, Schema.String,
  Schema.Array(ProjectIssueSchema), Schema.Record(Schema.String, ProjectIssueSchema),
]));

export const InspectionProjectGapReasonSchema = Schema.Literals([
  "no-result", "pending", "not-published", "identity-mismatch", "outcome-ineligible",
  "score-incomplete", "evidence-unavailable", "timeout-exceeded", "adoption-unproven",
]);

export const InspectionProjectSlotSchema = Schema.Union([
  Schema.Struct({
    ...PositionFields,
    state: Schema.Literal("reuse"),
    sourceRunId: RunIdSchema,
    locator: LocatorSchema,
    relation: Schema.Literals(["origin", "reference"]),
    action: Schema.Literals(["executed", "carried", "accepted"]),
  }),
  Schema.Struct({
    ...PositionFields,
    state: Schema.Literal("gap"),
    reason: InspectionProjectGapReasonSchema,
    issues: Schema.Array(ProjectIssueSchema),
    sourceRunId: Schema.NullOr(RunIdSchema),
    previous: Schema.NullOr(PreviousResultSchema),
  }),
]);

/** Current quality metrics retain the aggregate shapes owned by Inspection. */
export const InspectionProjectResultSchema = Schema.Struct({
  targetIdentity: Schema.NonEmptyString,
  coverage: Schema.Struct({
    expected: NonNegativeSafeIntegerSchema,
    covered: NonNegativeSafeIntegerSchema,
    gaps: NonNegativeSafeIntegerSchema,
  }),
  slots: Schema.Array(InspectionProjectSlotSchema),
  ...InspectionOverviewResultSchema.fields,
  history: Schema.Array(Schema.Struct({
    ...PositionFields,
    sourceRunId: RunIdSchema,
    locator: Schema.NullOr(LocatorSchema),
  })),
}).check(Schema.makeFilter((value) =>
  value.coverage.covered + value.coverage.gaps === value.coverage.expected
  && value.slots.length === value.coverage.expected
  && value.slots.filter((slot) => slot.state === "reuse").length === value.coverage.covered,
));

export type InspectionProjectResult = Schema.Schema.Type<typeof InspectionProjectResultSchema>;
export type InspectionProjectSlot = Schema.Schema.Type<typeof InspectionProjectSlotSchema>;
