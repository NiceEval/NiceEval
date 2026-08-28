import { Result, Schema } from "effect";
import {
  InspectionAttemptTimingResultSchema,
  InspectionTraceResultSchema,
  QUERY_PROTOCOL,
  type InspectionAttemptTimingDocument,
  type InspectionAttemptTraceDocument,
} from "niceeval/inspection/host";

const SourceSchema = Schema.Struct({
  kind: Schema.Literals(["operational", "record-snapshot"]),
  sealedCutoffIdentity: Schema.String,
});

const SealedCutoffSchema = Schema.Struct({
  kind: Schema.Literal("inspection-sealed-cutoff"),
  identity: Schema.String,
  runCount: Schema.Number,
  runs: Schema.Array(Schema.Struct({
    runId: Schema.String,
    logicalSealIdentity: Schema.String,
  })),
});

const SelectionSchema = Schema.Struct({
  requestedRunIds: Schema.Array(Schema.String),
  selectedRunIds: Schema.Array(Schema.String),
  missingRunIds: Schema.Array(Schema.String),
});

const MetadataFields = {
  protocol: Schema.Literal(QUERY_PROTOCOL),
  behaviorVersion: Schema.String,
  source: SourceSchema,
  sealedCutoff: SealedCutoffSchema,
  selection: SelectionSchema,
  issues: Schema.Tuple([]),
  evidence: Schema.Struct({ refs: Schema.Array(Schema.String) }),
} as const;

export const AttemptTraceDocumentSchema: Schema.Codec<InspectionAttemptTraceDocument, unknown, never> = Schema.Struct({
  ...MetadataFields,
  operation: Schema.Literal("attempt.trace"),
  trace: InspectionTraceResultSchema,
});

export const AttemptTimingDocumentSchema: Schema.Codec<InspectionAttemptTimingDocument, unknown, never> = Schema.Struct({
  ...MetadataFields,
  operation: Schema.Literal("attempt.timing"),
  timing: InspectionAttemptTimingResultSchema,
});

export type AttemptTraceDocument = InspectionAttemptTraceDocument;
export type AttemptTimingDocument = InspectionAttemptTimingDocument;

export function decodeQueryDocument<A>(
  schema: Schema.Codec<A, unknown, never>,
  input: unknown,
): Result.Result<A, unknown> {
  return Schema.decodeUnknownResult(schema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
}
