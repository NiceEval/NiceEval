import { Result, Schema } from "effect";

import { AssertionEntryIdSchema } from "../assertions/record/codec.ts";
import { ATTEMPT_LOCATOR_PATTERN } from "../attempt-locator.ts";
import { ExperimentIdSchema, RunIdSchema } from "../record/codec/identifiers.ts";
import { RunDocumentSchema } from "../record/codec/core.ts";
import { ArtifactSchema, ArtifactsAttachmentSchema } from "../record/family/artifacts/schema.ts";
import { isCommandId, isItemId, isToolOccurrenceId } from "../record/family/source-receipt/model.ts";
import { QUERY_PROTOCOL } from "./protocol-values.ts";
import { AssertionDetailResultSchema } from "./assertion-projection.ts";
import {
  InspectionAttemptDiffResultSchema, InspectionAttemptResultSchema,
  InspectionAttemptTimingResultSchema, InspectionAttemptUsageResultSchema,
  InspectionExperimentResultSchema, InspectionOverviewResultSchema,
  InspectionRunOverviewResultSchema, InspectionRunResultSchema,
  InspectionRunSummaryResultSchema, InspectionSourcesResultSchema,
  InspectionTraceDetailResultSchema, InspectionTraceResultSchema,
} from "./results.ts";

const AttemptLocatorSchema = Schema.String.pipe(Schema.refine(
  (value): value is string => ATTEMPT_LOCATOR_PATTERN.test(value),
  { identifier: "AttemptLocator", description: "a canonical @-prefixed Attempt locator" },
));

const ItemIdSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isItemId)));
const ToolOccurrenceIdSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isToolOccurrenceId)));
const CommandIdSchema = Schema.String.pipe(Schema.check(Schema.makeFilter(isCommandId)));
const RunIdsSchema = Schema.Array(RunIdSchema);
const operation = <Kind extends string, Fields extends Schema.Struct.Fields>(kind: Kind, fields: Fields) =>
  Schema.Struct({ kind: Schema.Literal(kind), ...fields });

const SourceSchema = Schema.Struct({
  kind: Schema.Literals(["operational", "record-snapshot"]), sealedCutoffIdentity: Schema.String,
});
const SealedCutoffSchema = Schema.Struct({
  kind: Schema.Literal("inspection-sealed-cutoff"), identity: Schema.String, runCount: Schema.Number,
  runs: Schema.Array(Schema.Struct({ runId: Schema.String, logicalSealIdentity: Schema.String })),
});
const SelectionSchema = Schema.Struct({
  requestedRunIds: Schema.Array(Schema.String), selectedRunIds: Schema.Array(Schema.String), missingRunIds: Schema.Array(Schema.String),
});
const SuccessMetadataSchema = Schema.Struct({
  protocol: Schema.Literal(QUERY_PROTOCOL), outcome: Schema.Literal("success"),
  source: SourceSchema, sealedCutoff: SealedCutoffSchema, selection: SelectionSchema,
  issues: Schema.Tuple([]), evidence: Schema.Struct({ refs: Schema.Array(Schema.String) }),
});
const RunsListSuccessMetadataSchema = Schema.Struct({
  protocol: Schema.Literal(QUERY_PROTOCOL), outcome: Schema.Literal("success"),
  source: SourceSchema,
  sealedCutoff: Schema.Struct({ kind: Schema.Literal("inspection-sealed-cutoff"), identity: Schema.String, runCount: Schema.Number }),
  selection: Schema.Struct({
    requestedRunIds: Schema.Array(Schema.String), selectedRunIds: Schema.Array(Schema.String), missingRunIds: Schema.Array(Schema.String),
    returnedRunCount: Schema.Number, totalRunCount: Schema.Number, truncated: Schema.Boolean,
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
    state: Schema.Literal("available"), value: Schema.toType(ArtifactsAttachmentSchema),
    collection: Schema.Struct({ state: Schema.Literals(["complete-page", "bounded-page"]), items: Schema.Array(Schema.toType(ArtifactSchema)), hasMore: Schema.Boolean }),
    contents: Schema.Array(Schema.Struct({ logicalHandle: Schema.String, byteLength: Schema.Number, digest: Schema.String })),
    contentsTruncated: Schema.Boolean,
  }),
]);
const SealedRunSummarySchema = Schema.Struct({
  runId: Schema.String, writerGeneration: Schema.String, startedAt: Schema.String, logicalSealIdentity: Schema.String,
  slotCount: Schema.Number, memberCount: Schema.Number, attemptCount: Schema.Number, attachmentCount: Schema.Number,
  contentCount: Schema.Number, contentByteLength: Schema.Number, sealEntryCount: Schema.Number,
});
const ComparisonMemberSchema = Schema.Struct({
  key: Schema.String, runId: Schema.String, slotId: Schema.String, evalId: Schema.String,
  attemptOrdinal: Schema.Number, locator: Schema.String,
});
const RunsCompareResultSchema = Schema.Struct({
  mode: Schema.Literals(["side-by-side", "exact", "paired"]),
  left: Schema.Struct({ runs: Schema.Array(RunDocumentSchema), members: Schema.Array(ComparisonMemberSchema) }),
  right: Schema.Struct({ runs: Schema.Array(RunDocumentSchema), members: Schema.Array(ComparisonMemberSchema) }),
  exactMemberSet: Schema.Boolean,
  pairs: Schema.Array(Schema.Struct({ key: Schema.String, left: ComparisonMemberSchema, right: ComparisonMemberSchema })),
});

const spec = <Request extends Schema.Constraint, ResultFields extends Schema.Struct.Fields, const FactKinds extends readonly string[]>(fields: {
  readonly request: Request; readonly result: ResultFields; readonly factKinds: FactKinds;
  readonly metadata?: typeof SuccessMetadataSchema | typeof RunsListSuccessMetadataSchema | typeof CompareSuccessMetadataSchema;
}) => Object.freeze(fields);

/** The sole 16-operation protocol owner. Every request, result and descriptor projection is derived from this registry. */
export const inspectionProtocolRegistry = Object.freeze({
  "overview.get": spec({ request: operation("overview.get", {}), result: { overview: InspectionOverviewResultSchema }, factKinds: ["core", "assertions", "attempt-cost"] }),
  "experiment.get": spec({ request: operation("experiment.get", { experimentId: ExperimentIdSchema }), result: { experiment: InspectionExperimentResultSchema }, factKinds: ["core", "assertions", "attempt-cost"] }),
  "runs.list": spec({ request: operation("runs.list", { continuation: Schema.optional(Schema.String) }), result: { runs: Schema.Array(SealedRunSummarySchema), continuation: Schema.optional(Schema.String) }, factKinds: ["core"], metadata: RunsListSuccessMetadataSchema }),
  "run.get": spec({ request: operation("run.get", { runId: RunIdSchema }), result: { run: InspectionRunResultSchema }, factKinds: ["core"] }),
  "run.summary": spec({ request: operation("run.summary", { runId: RunIdSchema }), result: { summary: InspectionRunSummaryResultSchema }, factKinds: ["core", "assertions", "agent-turns"] }),
  "run.overview": spec({ request: operation("run.overview", { runId: RunIdSchema }), result: { runOverview: InspectionRunOverviewResultSchema }, factKinds: ["core", "assertions", "agent-turns"] }),
  "attempt.get": spec({ request: operation("attempt.get", { locator: AttemptLocatorSchema }), result: { attempt: InspectionAttemptResultSchema }, factKinds: ["core", "assertions"] }),
  "attempt.assertion.detail": spec({ request: operation("attempt.assertion.detail", { locator: AttemptLocatorSchema, entryId: AssertionEntryIdSchema }), result: { assertion: AssertionDetailResultSchema }, factKinds: ["assertions", "agent-turns", "sources"] }),
  "attempt.trace": spec({ request: operation("attempt.trace", { locator: AttemptLocatorSchema }), result: { trace: InspectionTraceResultSchema }, factKinds: ["agent-turns", "turn-contexts", "sandbox-commands", "runner-activities", "runner-diagnostics"] }),
  "attempt.trace.detail": spec({ request: operation("attempt.trace.detail", { locator: AttemptLocatorSchema, selector: Schema.Union([operation("item", { itemId: ItemIdSchema }), operation("tool-occurrence", { toolOccurrenceId: ToolOccurrenceIdSchema }), operation("command", { commandId: CommandIdSchema })]) }), result: { detail: InspectionTraceDetailResultSchema }, factKinds: ["agent-turns", "sandbox-commands"] }),
  "attempt.timing": spec({ request: operation("attempt.timing", { locator: AttemptLocatorSchema }), result: { timing: InspectionAttemptTimingResultSchema }, factKinds: ["runner-activities"] }),
  "attempt.usage": spec({ request: operation("attempt.usage", { locator: AttemptLocatorSchema }), result: { usage: InspectionAttemptUsageResultSchema }, factKinds: ["agent-turns"] }),
  "attempt.diff": spec({ request: operation("attempt.diff", { locator: AttemptLocatorSchema }), result: { diff: InspectionAttemptDiffResultSchema }, factKinds: ["file-changes"] }),
  "attempt.sources": spec({ request: operation("attempt.sources", { locator: AttemptLocatorSchema }), result: { sources: InspectionSourcesResultSchema }, factKinds: ["assertions", "sources"] }),
  "attempt.artifacts": spec({ request: operation("attempt.artifacts", { locator: AttemptLocatorSchema }), result: { artifacts: ArtifactsResultSchema }, factKinds: ["artifacts"] }),
  "runs.compare": spec({ request: operation("runs.compare", { mode: Schema.Literals(["side-by-side", "exact", "paired"]), leftRunIds: RunIdsSchema, rightRunIds: RunIdsSchema }), result: { comparison: RunsCompareResultSchema }, factKinds: ["core"], metadata: CompareSuccessMetadataSchema }),
});

export type InspectionOperationId = keyof typeof inspectionProtocolRegistry;
export const INSPECTION_OPERATION_IDS = Object.freeze(Object.keys(inspectionProtocolRegistry) as InspectionOperationId[]);
export const InspectionOperationIdSchema = Schema.Literals(INSPECTION_OPERATION_IDS);
const specs = Object.entries(inspectionProtocolRegistry);
export const InspectionRequestSchema = Schema.Struct({
  protocol: Schema.Literal(QUERY_PROTOCOL),
  operation: Schema.Union(specs.map(([, entry]) => entry.request)),
});
export type InspectionRequest = Schema.Schema.Type<typeof InspectionRequestSchema>;
export type InspectionOperation = InspectionRequest["operation"];
export type InspectionOperationFor<Kind extends InspectionOperationId> = Extract<
  InspectionOperation,
  { readonly kind: Kind }
>;

const successSchema = (id: InspectionOperationId, entry: (typeof inspectionProtocolRegistry)[InspectionOperationId]) => {
  const fields = Schema.fieldsAssign({ operation: Schema.Literal(id), ...entry.result });
  if (id === "runs.list") return RunsListSuccessMetadataSchema.pipe(fields);
  if (id === "runs.compare") return CompareSuccessMetadataSchema.pipe(fields);
  return SuccessMetadataSchema.pipe(fields);
};
export const InspectionSuccessDocumentSchema = Schema.Union(specs.map(([id, entry]) => successSchema(id as InspectionOperationId, entry)));

const explanationSchema = (id: InspectionOperationId, entry: (typeof inspectionProtocolRegistry)[InspectionOperationId]) => {
  const fields = Schema.fieldsAssign({
    outcome: Schema.Literal("explanation"), operation: Schema.Literal(id),
    factKinds: Schema.Tuple(entry.factKinds.map((value) => Schema.Literal(value))),
  });
  if (id === "runs.list") return RunsListSuccessMetadataSchema.pipe(fields);
  return SuccessMetadataSchema.pipe(fields);
};
export const InspectionExplanationDocumentSchema = Schema.Union(specs.map(([id, entry]) =>
  explanationSchema(id as InspectionOperationId, entry)
));

const DescriptorSchema = Schema.Union(specs.map(([id]) => Schema.Struct({ id: Schema.Literal(id as InspectionOperationId) })));
export const InspectionDiscoveryDocumentSchema = Schema.Struct({
  protocol: Schema.Literal(QUERY_PROTOCOL), outcome: Schema.Literal("discovery"), operations: Schema.Array(DescriptorSchema),
});
export const InspectionFailureDocumentSchema = Schema.Struct({
  protocol: Schema.Literal(QUERY_PROTOCOL), outcome: Schema.Literal("failure"),
  operation: Schema.NullOr(InspectionOperationIdSchema),
  failure: Schema.Struct({
    code: Schema.Literals(["inspection-request-invalid", "inspection-selection-missing", "inspection-source-invalid", "inspection-record-integrity-failure", "inspection-operation-failed", "inspection-result-invalid"]),
    reason: Schema.String,
    identity: Schema.optional(Schema.Struct({ runId: Schema.String })),
    correction: Schema.Literals(["fix-request", "choose-existing-selection", "fix-record-source", "retry", "upgrade-or-report"]),
  }),
});
export const InspectionDocumentSchema = Schema.Union([
  InspectionDiscoveryDocumentSchema, InspectionSuccessDocumentSchema,
  InspectionExplanationDocumentSchema, InspectionFailureDocumentSchema,
]);

type Registry = typeof inspectionProtocolRegistry;
type MetadataFor<Kind extends InspectionOperationId> = Registry[Kind] extends { readonly metadata: infer Metadata extends Schema.Constraint }
  ? Schema.Schema.Type<Metadata>
  : Schema.Schema.Type<typeof SuccessMetadataSchema>;
type ResultFields<Kind extends InspectionOperationId> = {
  readonly [Field in keyof Registry[Kind]["result"]]: Registry[Kind]["result"][Field] extends Schema.Constraint
    ? Schema.Schema.Type<Registry[Kind]["result"][Field]>
    : never
};
export type InspectionSuccessDocumentFor<Kind extends InspectionOperationId> = Kind extends InspectionOperationId
  ? MetadataFor<Kind> & { readonly operation: Kind } & ResultFields<Kind>
  : never;
export type InspectionSuccessDocument = InspectionSuccessDocumentFor<InspectionOperationId>;
export type InspectionExplanationDocumentFor<Kind extends InspectionOperationId> = Kind extends InspectionOperationId
  ? Omit<MetadataFor<Kind>, "outcome"> & { readonly outcome: "explanation"; readonly operation: Kind; readonly factKinds: Registry[Kind]["factKinds"] }
  : never;
export type InspectionExplanationDocument = InspectionExplanationDocumentFor<InspectionOperationId>;
export type InspectionOperationDocument = InspectionSuccessDocument | InspectionExplanationDocument;
export type InspectionDiscoveryDocument = Schema.Schema.Type<typeof InspectionDiscoveryDocumentSchema>;
export type InspectionFailureDocument = Schema.Schema.Type<typeof InspectionFailureDocumentSchema>;
export type InspectionDocument = InspectionDiscoveryDocument | InspectionOperationDocument | InspectionFailureDocument;
export type InspectionProtocolDecodeResult<A> = { readonly success: true; readonly value: A } | { readonly success: false; readonly reason: string };

export function decodeInspectionDocument(input: unknown): InspectionProtocolDecodeResult<InspectionDocument> {
  const decoded = Schema.decodeUnknownResult(InspectionDocumentSchema, { errors: "all", onExcessProperty: "error" })(input);
  return Result.isSuccess(decoded)
    ? { success: true, value: input as InspectionDocument }
    : { success: false, reason: String(decoded.failure) };
}

export function narrowInspectionSuccess<Kind extends InspectionOperationId>(
  document: InspectionDocument,
  operationId: Kind,
): InspectionProtocolDecodeResult<InspectionSuccessDocumentFor<Kind>> {
  return document.outcome === "success" && document.operation === operationId
    ? { success: true, value: document as InspectionSuccessDocumentFor<Kind> }
    : { success: false, reason: `expected success ${operationId}, received ${document.outcome}${"operation" in document ? ` ${document.operation}` : ""}` };
}

export function narrowInspectionExplanation<Kind extends InspectionOperationId>(
  document: InspectionDocument,
  operationId: Kind,
): InspectionProtocolDecodeResult<InspectionExplanationDocumentFor<Kind>> {
  return document.outcome === "explanation" && document.operation === operationId
    ? { success: true, value: document as InspectionExplanationDocumentFor<Kind> }
    : { success: false, reason: `expected explanation ${operationId}, received ${document.outcome}${"operation" in document ? ` ${document.operation}` : ""}` };
}

export const inspectionOperationCatalog = Object.freeze(specs.map(([id]) => Object.freeze({ id })));
export type InspectionOperationDescriptor = (typeof inspectionOperationCatalog)[number];
