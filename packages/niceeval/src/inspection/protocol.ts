// @concord-file
// @concord-implements docs/feature/inspection/README.md
// @concord-implements docs/feature/inspection/architecture.md
// @concord-implements docs/feature/inspection/use-case/inspection-check-completeness.md
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { AssertionEntryIdSchema } from "../assertions/record/codec.ts";
import { ATTEMPT_LOCATOR_PATTERN } from "../attempt-locator.ts";
import { ArtifactIdSchema, ExperimentIdSchema, RunIdSchema } from "../record/codec/identifiers.ts";
import { InspectionArtifactLimitSchema, InspectionArtifactOffsetSchema, InspectionArtifactResultSchema } from "./artifacts.ts";
import { InspectionRunCoreSchema } from "./planned-attempt.ts";
import { InspectionArtifactMetadataSchema, InspectionArtifactsPageLimitSchema, InspectionArtifactsValueSchema } from "./artifact-list.ts";
import { isCommandId, isItemId, isToolOccurrenceId } from "../record/family/source-receipt/model.ts";
import { AssertionDetailResultSchema } from "./assertion-projection.ts";
import { InspectionProjectResultSchema } from "./project-result.ts";
import { InspectionRepricingInputSchema, InspectionRepricingResultSchema } from "./repricing.ts";
import {
  InspectionAttemptDiffResultSchema, InspectionAttemptResultSchema,
  InspectionAttemptTimingResultSchema, InspectionAttemptUsageResultSchema,
  InspectionExperimentResultSchema, InspectionOverviewResultSchema,
  InspectionRunResultSchema, InspectionRunListResultSchema,
  InspectionSourcesResultSchema,
  InspectionTraceDetailResultSchema, InspectionTraceResultSchema,
} from "./results.ts";

import { AssertionMatrixSchema } from "./assertion-matrix.ts";

const AttemptLocatorSchema = Schema.String.pipe(Schema.refine(
  (value): value is string => ATTEMPT_LOCATOR_PATTERN.test(value),
  { identifier: "AttemptLocator", description: "a canonical @-prefixed Attempt locator" },
));

const ItemIdSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isItemId)));
const ToolOccurrenceIdSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isToolOccurrenceId)));
const CommandIdSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isCommandId)));
const RunIdsSchema = Schema.Array(RunIdSchema);
const ProjectExperimentIdsSchema = Schema.Array(ExperimentIdSchema).check(Schema.makeFilter((ids) => ids.length > 0 && new Set(ids).size === ids.length));
const operation = <Kind extends string, Fields extends Schema.Struct.Fields>(kind: Kind, fields: Fields) =>
  Schema.Struct({ kind: Schema.Literal(kind), ...fields });

const SourceSchema = Schema.Struct({
  kind: Schema.Literals(["project-record", "external-record"]), publicationCutoffIdentity: Schema.String,
});
const PublicationCutoffSchema = Schema.Struct({
  storeGeneration: Schema.String, revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
const SelectionSchema = Schema.Struct({
  requestedRunIds: Schema.Array(Schema.String), selectedRunIds: Schema.Array(Schema.String), missingRunIds: Schema.Array(Schema.String),
});
export const InspectionLinkSchema = Schema.Struct({
  rel: Schema.Literals(["assertion", "diff", "file-change", "execution", "execution-item", "timing", "usage", "source", "artifact", "run", "attempt", "experiment", "next-page"]),
  command: Schema.String,
});
export type InspectionLink = Schema.Schema.Type<typeof InspectionLinkSchema>;
const LinksSchema = Schema.Array(InspectionLinkSchema);
const SuccessMetadataSchema = Schema.Struct({
  outcome: Schema.Literal("success"),

  source: SourceSchema, publicationCutoff: PublicationCutoffSchema, selection: SelectionSchema,
  issues: Schema.Tuple([]), evidence: Schema.Struct({ refs: Schema.Array(Schema.String) }),
});
const RunsListSuccessMetadataSchema = Schema.Struct({
  outcome: Schema.Literal("success"),

  source: SourceSchema,
  publicationCutoff: PublicationCutoffSchema,
  selection: Schema.Struct({
    requestedRunIds: Schema.Array(Schema.String), selectedRunIds: Schema.Array(Schema.String), missingRunIds: Schema.Array(Schema.String),
    returnedRunCount: Schema.Number, truncated: Schema.Boolean,
  }),
  issues: Schema.Tuple([]), evidence: Schema.Struct({ refs: Schema.Array(Schema.String) }),
});
const CompareIssueSchema = Schema.Union([
  Schema.Struct({ code: Schema.Literal("selection-run-missing"), side: Schema.Literals(["left", "right"]), runId: Schema.String }),
  Schema.Struct({ code: Schema.Literal("comparison-member-set-mismatch") }),
]);
const CompareSuccessMetadataSchema = SuccessMetadataSchema.pipe(Schema.fieldsAssign({ issues: Schema.Array(CompareIssueSchema) }));

const ArtifactsResultSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("not-recorded") }),
  Schema.Struct({
    state: Schema.Literal("available"), value: InspectionArtifactsValueSchema,
    collection: Schema.Struct({ state: Schema.Literals(["complete-page", "bounded-page"]), items: Schema.Array(InspectionArtifactMetadataSchema), hasMore: Schema.Boolean, nextOffset: Schema.NullOr(InspectionArtifactOffsetSchema), total: InspectionArtifactOffsetSchema }),
    contents: Schema.Array(Schema.Struct({ logicalHandle: Schema.String, byteLength: Schema.Number, digest: Schema.String })),
    contentsTruncated: Schema.Boolean,
  }),
]);
const ComparisonMemberSchema = Schema.Struct({
  key: Schema.String, runId: Schema.String, plannedAttemptId: Schema.String, evalId: Schema.String,
  attemptOrdinal: Schema.Number, locator: Schema.String,
});
const RunsCompareResultSchema = Schema.Struct({
  mode: Schema.Literals(["side-by-side", "exact", "paired"]),
  left: Schema.Struct({ runs: Schema.Array(InspectionRunCoreSchema), members: Schema.Array(ComparisonMemberSchema) }),
  right: Schema.Struct({ runs: Schema.Array(InspectionRunCoreSchema), members: Schema.Array(ComparisonMemberSchema) }),
  exactMemberSet: Schema.Boolean,
  pairs: Schema.Array(Schema.Struct({ key: Schema.String, left: ComparisonMemberSchema, right: ComparisonMemberSchema })),
});

const spec = <Request extends Schema.Constraint, ResultFields extends Schema.Struct.Fields, const FactKinds extends readonly string[]>(fields: {
  readonly request: Request; readonly result: ResultFields; readonly factKinds: FactKinds;
}) => Object.freeze(fields);

/** The sole protocol catalog owner. Every request, result and descriptor projection is derived from this registry. */
export const inspectionProtocolRegistry = Object.freeze({
  "project.get": spec({ request: operation("project.get", { experimentIds: Schema.optional(ProjectExperimentIdsSchema) }), result: { project: InspectionProjectResultSchema }, factKinds: ["current-project", "core", "assertions", "attempt-cost"] }),
  "overview.get": spec({ request: operation("overview.get", { runIds: Schema.optional(RunIdsSchema) }), result: { overview: InspectionOverviewResultSchema }, factKinds: ["core", "assertions", "attempt-cost"] }),
  "experiments.assertions": spec({ request: operation("experiments.assertions", { experimentIds: Schema.Array(ExperimentIdSchema).check(Schema.makeFilter((ids) => ids.length > 0 && ids.length <= 32)), evalIdPrefix: Schema.optional(Schema.String) }), result: { matrix: AssertionMatrixSchema }, factKinds: ["core", "assertions"] }),
  "experiment.get": spec({ request: operation("experiment.get", { experimentId: ExperimentIdSchema }), result: { experiment: InspectionExperimentResultSchema }, factKinds: ["core", "attempt-note", "assertions", "attempt-cost", "agent-turns", "adapter-usage", "judge-usage"] }),
  "run.list": spec({ request: operation("run.list", { continuation: Schema.optional(Schema.String) }), result: { runs: InspectionRunListResultSchema, continuation: Schema.optional(Schema.String) }, factKinds: ["core"] }),
  "run.get": spec({ request: operation("run.get", { runId: RunIdSchema }), result: { run: InspectionRunResultSchema }, factKinds: ["core", "assertions", "agent-turns", "adapter-usage", "judge-usage"] }),
  "attempt.get": spec({ request: operation("attempt.get", { locator: AttemptLocatorSchema }), result: { attempt: InspectionAttemptResultSchema }, factKinds: ["core", "assertions", "attempt-note"] }),
  "attempt.assertion.detail": spec({ request: operation("attempt.assertion.detail", { locator: AttemptLocatorSchema, entryId: AssertionEntryIdSchema, projection: Schema.optional(Schema.Literals(["full", "compact"])) }), result: { assertion: AssertionDetailResultSchema }, factKinds: ["assertions", "agent-turns", "sources"] }),
  "attempt.assertion.image": spec({ request: operation("attempt.assertion.image", { locator: AttemptLocatorSchema,
    entryId: AssertionEntryIdSchema, imageId: Schema.String,
    offset: Schema.optional(InspectionArtifactOffsetSchema), limit: Schema.optional(InspectionArtifactLimitSchema) }),
    result: { image: Schema.Union([
      Schema.Struct({ state: Schema.Literal("available"), imageId: Schema.String, mediaType: Schema.Literals(["image/png", "image/jpeg"]),
        byteLength: Schema.Number, sha256: Schema.String, offset: Schema.Number, base64: Schema.String, nextOffset: Schema.NullOr(Schema.Number) }),
      Schema.Struct({ state: Schema.Literal("invalid") }), Schema.Struct({ state: Schema.Literal("not-recorded") }),
    ]) }, factKinds: ["assertions"] }),
  "attempt.trace": spec({ request: operation("attempt.trace", {
    locator: AttemptLocatorSchema,
    traceId: Schema.optional(Schema.String),
    sourceId: Schema.optional(Schema.String),
    actorId: Schema.optional(Schema.String),
    eventType: Schema.optional(Schema.String),
    continuation: Schema.optional(Schema.String),
  }), result: { trace: InspectionTraceResultSchema }, factKinds: ["execution-traces", "agent-turns", "turn-contexts", "sandbox-commands", "runner-activities", "runner-diagnostics"] }),
  "attempt.trace.detail": spec({ request: operation("attempt.trace.detail", { locator: AttemptLocatorSchema, selector: Schema.Union([
    operation("execution-event", { eventId: Schema.String }),
    operation("execution-evidence", {
      evidenceId: Schema.String,
      offset: Schema.optional(InspectionArtifactOffsetSchema),
      limit: Schema.optional(InspectionArtifactLimitSchema),
    }),
    operation("item", { itemId: ItemIdSchema }),
    operation("tool-occurrence", { toolOccurrenceId: ToolOccurrenceIdSchema }),
    operation("command", { commandId: CommandIdSchema }),
  ]) }), result: { detail: InspectionTraceDetailResultSchema }, factKinds: ["execution-traces", "agent-turns", "sandbox-commands", "artifacts"] }),
  "attempt.timing": spec({ request: operation("attempt.timing", { locator: AttemptLocatorSchema }), result: { timing: InspectionAttemptTimingResultSchema }, factKinds: ["runner-activities"] }),
  "attempt.usage": spec({ request: operation("attempt.usage", { locator: AttemptLocatorSchema }), result: { usage: InspectionAttemptUsageResultSchema }, factKinds: ["agent-turns", "adapter-usage", "judge-usage"] }),
  "attempt.reprice": spec({ request: operation("attempt.reprice", { locator: AttemptLocatorSchema, pricing: InspectionRepricingInputSchema }), result: { repricing: InspectionRepricingResultSchema }, factKinds: ["adapter-usage", "judge-usage"] }),
  "attempt.diff": spec({ request: operation("attempt.diff", { locator: AttemptLocatorSchema, changeId: Schema.optional(Schema.String) }), result: { diff: InspectionAttemptDiffResultSchema }, factKinds: ["file-changes"] }),
  "attempt.sources": spec({ request: operation("attempt.sources", { locator: AttemptLocatorSchema }), result: { sources: InspectionSourcesResultSchema }, factKinds: ["assertions", "sources"] }),
  "attempt.artifacts": spec({ request: operation("attempt.artifacts", { locator: AttemptLocatorSchema, offset: Schema.optional(InspectionArtifactOffsetSchema), limit: Schema.optional(InspectionArtifactsPageLimitSchema) }), result: { artifacts: ArtifactsResultSchema }, factKinds: ["artifacts"] }),
  "attempt.artifact": spec({ request: operation("attempt.artifact", { locator: AttemptLocatorSchema, artifactId: ArtifactIdSchema, offset: Schema.optional(InspectionArtifactOffsetSchema), limit: Schema.optional(InspectionArtifactLimitSchema) }), result: { artifact: InspectionArtifactResultSchema }, factKinds: ["artifacts"] }),
  "runs.compare": spec({ request: operation("runs.compare", { mode: Schema.Literals(["side-by-side", "exact", "paired"]), leftRunIds: RunIdsSchema, rightRunIds: RunIdsSchema }), result: { comparison: RunsCompareResultSchema }, factKinds: ["core"] }),
});

/** Names one operation in the fixed Inspection catalog; applications cannot register ad hoc query operations. */
export type InspectionOperationId = keyof typeof inspectionProtocolRegistry;
export const INSPECTION_OPERATION_IDS = Object.freeze(Object.keys(inspectionProtocolRegistry) as InspectionOperationId[]);
export const InspectionOperationIdSchema = Schema.Literals(INSPECTION_OPERATION_IDS);
const specs = Object.entries(inspectionProtocolRegistry);
export const InspectionRequestSchema = Schema.Struct({

  operation: Schema.Union(specs.map(([, entry]) => entry.request)),
});
/** A request for one fixed Inspection operation. */
export type InspectionRequest = Schema.Schema.Type<typeof InspectionRequestSchema>;
/** Selects one fixed Inspection operation and its declared inputs; arbitrary SQL, JSON paths and callbacks are not accepted. */
export type InspectionOperation = InspectionRequest["operation"];
/** Selects the request shape for one operation ID; selectors and limits belong to that operation's declared contract. */
export type InspectionOperationFor<Kind extends InspectionOperationId> = Extract<
  InspectionOperation,
  { readonly kind: Kind }
>;

const successSchema = (
  id: InspectionOperationId,
  entry: (typeof inspectionProtocolRegistry)[InspectionOperationId],
): Schema.Codec<InspectionSuccessDocument, InspectionSuccessEncoded> => {
  const fields = Schema.fieldsAssign({ operation: Schema.Literal(id), links: LinksSchema, ...entry.result });
  const schema = id === "run.list" ? RunsListSuccessMetadataSchema.pipe(fields)
    : id === "runs.compare" ? CompareSuccessMetadataSchema.pipe(fields)
    : SuccessMetadataSchema.pipe(fields);
  // Object.entries erases the ID/result correlation established by the registry.
  return schema as unknown as Schema.Codec<InspectionSuccessDocument, InspectionSuccessEncoded>;
};
export const InspectionSuccessDocumentSchema: Schema.Union<readonly Schema.Codec<InspectionSuccessDocument, InspectionSuccessEncoded>[]> =
  Schema.Union(specs.map(([id, entry]) => successSchema(id as InspectionOperationId, entry)));

const explanationSchema = (id: InspectionOperationId, entry: (typeof inspectionProtocolRegistry)[InspectionOperationId]) => {
  const fields = Schema.fieldsAssign({
    outcome: Schema.Literal("explanation"), operation: Schema.Literal(id),
    factKinds: Schema.Tuple(entry.factKinds.map((value) => Schema.Literal(value))),
  });
  if (id === "run.list") return RunsListSuccessMetadataSchema.pipe(fields);
  return SuccessMetadataSchema.pipe(fields);
};
export const InspectionExplanationDocumentSchema = Schema.Union(specs.map(([id, entry]) =>
  explanationSchema(id as InspectionOperationId, entry)
));

export const InspectionFailureDocumentSchema = Schema.Struct({
  outcome: Schema.Literal("failure"),
  operation: Schema.NullOr(InspectionOperationIdSchema),
  failure: Schema.Struct({
    code: Schema.Literals(["unsupported-format", "inspection-request-invalid", "inspection-selection-missing", "inspection-source-invalid", "inspection-record-integrity-failure", "inspection-operation-failed", "inspection-result-invalid", "evidence-budget-exceeded", "restart-required", "current-target-unavailable"]),
    reason: Schema.String,
    issues: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String, expected: Schema.String, received: Schema.String }))),
    omittedIssueCount: Schema.optional(Schema.Number),
    availableOperations: Schema.optional(Schema.Array(InspectionOperationIdSchema)),
    identity: Schema.optional(Schema.Struct({ runId: Schema.String })),
    correction: Schema.Literals(["fix-request", "choose-existing-selection", "fix-record-source", "retry", "upgrade-or-report", "restart"]),
  }),
});
export const InspectionDocumentSchema: Schema.Union<readonly [
  typeof InspectionSuccessDocumentSchema,
  typeof InspectionExplanationDocumentSchema, typeof InspectionFailureDocumentSchema,
]> = Schema.Union([
  InspectionSuccessDocumentSchema,
  InspectionExplanationDocumentSchema, InspectionFailureDocumentSchema,
]);

type Registry = typeof inspectionProtocolRegistry;
type MetadataFor<Kind extends InspectionOperationId> = Kind extends "run.list"
  ? Schema.Schema.Type<typeof RunsListSuccessMetadataSchema>
  : Kind extends "runs.compare"
    ? Schema.Schema.Type<typeof CompareSuccessMetadataSchema>
    : Schema.Schema.Type<typeof SuccessMetadataSchema>;
type ResultFields<Kind extends InspectionOperationId> = {
  readonly [Field in keyof Registry[Kind]["result"]]: Registry[Kind]["result"][Field] extends Schema.Constraint
    ? Schema.Schema.Type<Registry[Kind]["result"][Field]>
    : never
};
/** Types one successful operation's metadata and result fields; operation identity must match before consuming these fields. */
export type InspectionSuccessDocumentFor<Kind extends InspectionOperationId> = Kind extends InspectionOperationId
  ? MetadataFor<Kind> & { readonly operation: Kind; readonly links: readonly InspectionLink[] } & ResultFields<Kind>
  : never;
/** Contains a successful fixed-operation result with its metadata; missing and partial evidence remain explicit inside the result. */
export type InspectionSuccessDocument = InspectionSuccessDocumentFor<InspectionOperationId>;
type SuccessEncodedFor<Kind extends InspectionOperationId> = Kind extends InspectionOperationId
  ? (Kind extends "run.list" ? Schema.Codec.Encoded<typeof RunsListSuccessMetadataSchema>
      : Kind extends "runs.compare" ? Schema.Codec.Encoded<typeof CompareSuccessMetadataSchema>
      : Schema.Codec.Encoded<typeof SuccessMetadataSchema>)
    & { readonly operation: Kind; readonly links: readonly InspectionLink[] }
    & { readonly [Field in keyof Registry[Kind]["result"]]: Registry[Kind]["result"][Field] extends Schema.Constraint
        ? Schema.Codec.Encoded<Registry[Kind]["result"][Field]> : never }
  : never;
type InspectionSuccessEncoded = SuccessEncodedFor<InspectionOperationId>;
/** Narrows an explanation to one fixed operation and its fact kinds; it carries metadata rather than queried result fields. */
export type InspectionExplanationDocumentFor<Kind extends InspectionOperationId> = Kind extends InspectionOperationId
  ? Omit<MetadataFor<Kind>, "outcome"> & { readonly outcome: "explanation"; readonly operation: Kind; readonly factKinds: Registry[Kind]["factKinds"] }
  : never;
/** Explains a supported operation's sources and interpretation without executing it; it is not a successful data result. */
export type InspectionExplanationDocument = InspectionExplanationDocumentFor<InspectionOperationId>;
/** Contains either an explanation or successful operation result; inspect outcome before treating it as queried facts. */
export type InspectionOperationDocument = InspectionSuccessDocument | InspectionExplanationDocument;
/** Reports an Inspection protocol or execution failure; failure to read evidence must not be interpreted as a failed Attempt. */
export type InspectionFailureDocument = Schema.Schema.Type<typeof InspectionFailureDocumentSchema>;
/** A decoded success, explanation or failure document; check its outcome before accessing operation-specific facts. */
export type InspectionDocument = InspectionOperationDocument | InspectionFailureDocument;
/** Returns a decoded protocol value or a reason for rejection; check success before reading value. */
export type InspectionProtocolDecodeResult<A> = { readonly success: true; readonly value: A } | { readonly success: false; readonly reason: string };

// @concord-code
// @concord-implements docs/feature/inspection/architecture.md
/** Strictly validates an Inspection response envelope. A successful decode may still contain a failure outcome, so inspect outcome separately. */
export function decodeInspectionDocument(input: unknown): InspectionProtocolDecodeResult<InspectionDocument> {
  const decoded = Schema.decodeUnknownResult(InspectionDocumentSchema, { errors: "all", onExcessProperty: "error" })(input);
  return Result.isSuccess(decoded)
    ? { success: true, value: input as InspectionDocument }
    : { success: false, reason: String(decoded.failure) };
}

/** Checks that a decoded document is a successful result for the requested operation. Protocol decoding alone does not establish this narrower outcome. */
export function narrowInspectionSuccess<Kind extends InspectionOperationId>(
  document: InspectionDocument,
  operationId: Kind,
): InspectionProtocolDecodeResult<InspectionSuccessDocumentFor<Kind>> {
  return document.outcome === "success" && document.operation === operationId
    ? { success: true, value: document as InspectionSuccessDocumentFor<Kind> }
    : { success: false, reason: `expected success ${operationId}, received ${document.outcome}${"operation" in document ? ` ${document.operation}` : ""}` };
}

/** Checks that a decoded document is an explanation for the requested operation. Returns a rejection reason rather than casting a different outcome. */
export function narrowInspectionExplanation<Kind extends InspectionOperationId>(
  document: InspectionDocument,
  operationId: Kind,
): InspectionProtocolDecodeResult<InspectionExplanationDocumentFor<Kind>> {
  return document.outcome === "explanation" && document.operation === operationId
    ? { success: true, value: document as InspectionExplanationDocumentFor<Kind> }
    : { success: false, reason: `expected explanation ${operationId}, received ${document.outcome}${"operation" in document ? ` ${document.operation}` : ""}` };
}
