import { createHash } from "node:crypto";
import { Result, Schema } from "effect";
import {
  canonicalRecordJsonText,
  defineRecordCore,
  type RecordJsonObject,
} from "../definition/index.ts";
import {
  ExperimentIdSchema,
  EvalIdSchema,
  ExecutionIdentityDigestSchema,
  RunIdSchema,
  SlotIdSchema,
  UtcMillisSchema,
} from "./identifiers.ts";
import {
  ATTEMPT_PUBLICATION_CLOSURE_FORMAT,
  decodeAttemptPublicationClosure,
  decodeRunDocument,
  encodeRunDocument,
} from "./core.ts";
import { RecordCoreDocumentLimits } from "../model/definition.ts";
import type { RunContextJsonValue } from "../model/run-context.ts";

export type LegacyProjectDatabaseFormat =
  | "niceeval.project-database/0.15"
  | "niceeval.project-database/0.16";

const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const LegacyJsonValueSchema: Schema.Codec<RunContextJsonValue> = Schema.suspend(() => Schema.Union([
  Schema.Null,
  Schema.Boolean,
  Schema.Number,
  Schema.String,
  Schema.Array(LegacyJsonValueSchema),
  Schema.Record(Schema.String, LegacyJsonValueSchema),
]));
const LegacyFlagsSchema = Schema.Record(Schema.String, LegacyJsonValueSchema);
const LegacyLabelsSchema = Schema.Record(Schema.String, Schema.String);

// The 0.15/0.16 slot fields were identical, but this historical aggregate is
// intentionally fixed here rather than importing the evolving current Core.
const LegacyRecordSlotIdentitySchema = Schema.Struct({
  slotId: SlotIdSchema,
  evalId: EvalIdSchema,
  attemptOrdinal: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  executionIdentityDigest: ExecutionIdentityDigestSchema,
});

const Legacy15RunContextSchema = Schema.Struct({
  experimentId: ExperimentIdSchema,
  execution: Schema.Struct({
    agentId: NonEmptyStringSchema,
    model: Schema.NullOr(Schema.String),
    reasoningEffort: Schema.NullOr(Schema.String),
    flags: LegacyFlagsSchema,
  }),
  labels: LegacyLabelsSchema,
});

const Legacy16ApplicationIdentitySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("agent"), name: NonEmptyStringSchema }),
  Schema.Struct({
    kind: Schema.Literal("application"),
    name: NonEmptyStringSchema,
    contract: NonEmptyStringSchema,
    behaviorRevision: Schema.NullOr(NonEmptyStringSchema),
  }),
]);

const Legacy16RunContextSchema = Schema.Struct({
  experimentId: ExperimentIdSchema,
  execution: Schema.Struct({
    application: Legacy16ApplicationIdentitySchema,
    model: Schema.NullOr(Schema.String),
    reasoningEffort: Schema.NullOr(Schema.String),
    flags: LegacyFlagsSchema,
  }),
  labels: LegacyLabelsSchema,
});

function runDocumentSchema<Context>(context: Schema.Codec<Context>) {
  return Schema.Struct({
    runId: RunIdSchema,
    experimentId: ExperimentIdSchema,
    context,
    startedAt: UtcMillisSchema,
    completedAt: UtcMillisSchema,
    expectedSlots: Schema.Array(LegacyRecordSlotIdentitySchema),
  });
}

const Legacy15RunDocumentDefinition = defineRecordCore({
  schema: runDocumentSchema(Legacy15RunContextSchema),
  limits: RecordCoreDocumentLimits,
});
const Legacy16RunDocumentDefinition = defineRecordCore({
  schema: runDocumentSchema(Legacy16RunContextSchema),
  limits: RecordCoreDocumentLimits,
});

function closureSchema<Run>(run: Schema.Codec<Run>) {
  return Schema.Union([
    Schema.Struct({ format: Schema.Literal(ATTEMPT_PUBLICATION_CLOSURE_FORMAT), originRun: run }),
    Schema.Struct({ originRun: run }),
  ]);
}

const Legacy15ClosureDefinition = defineRecordCore({
  schema: closureSchema(runDocumentSchema(Legacy15RunContextSchema)),
  limits: RecordCoreDocumentLimits,
});
const Legacy16ClosureDefinition = defineRecordCore({
  schema: closureSchema(runDocumentSchema(Legacy16RunContextSchema)),
  limits: RecordCoreDocumentLimits,
});

type Legacy15Run = Schema.Schema.Type<typeof Legacy15RunDocumentDefinition.schema>;
type Legacy16Run = Schema.Schema.Type<typeof Legacy16RunDocumentDefinition.schema>;

const utf8 = new TextDecoder("utf-8", { fatal: true });

function parseCanonical(bytes: Uint8Array): unknown {
  return JSON.parse(utf8.decode(bytes)) as unknown;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value: RecordJsonObject): Uint8Array {
  return new TextEncoder().encode(canonicalRecordJsonText(value));
}

function assertHistoricalCanonical(source: Uint8Array, value: unknown): void {
  const canonical = new TextEncoder().encode(canonicalRecordJsonText(value as RecordJsonObject));
  if (canonical.byteLength !== source.byteLength || canonical.some((byte, index) => byte !== source[index])) {
    throw new Error("legacy Record JSON is not the exact canonical historical encoding");
  }
}

function migrateRun(run: Legacy15Run | Legacy16Run, format: LegacyProjectDatabaseFormat): RecordJsonObject {
  const legacyExecution = run.context.execution;
  const adapter = format === "niceeval.project-database/0.15"
    ? {
        name: (legacyExecution as Legacy15Run["context"]["execution"]).agentId,
        contract: "niceeval.agent/v1",
        behaviorRevision: null,
      }
    : (() => {
        const application = (legacyExecution as Legacy16Run["context"]["execution"]).application;
        return application.kind === "agent"
          ? { name: application.name, contract: "niceeval.agent/v1", behaviorRevision: null }
          : {
              name: application.name,
              contract: application.contract,
              behaviorRevision: application.behaviorRevision,
            };
      })();
  const migrated = {
    ...run,
    context: {
      ...run.context,
      execution: {
        adapter,
        model: legacyExecution.model,
        reasoningEffort: legacyExecution.reasoningEffort,
        flags: legacyExecution.flags,
      },
    },
  };
  const decoded = decodeRunDocument(migrated);
  if (Result.isFailure(decoded)) throw new Error("legacy Run does not convert to the exact current Run schema");
  const encoded = encodeRunDocument(decoded.success);
  if (Result.isFailure(encoded)) throw new Error("converted Run cannot be encoded by the current Run codec");
  return encoded.success;
}

function decodeLegacyRun(format: LegacyProjectDatabaseFormat, input: unknown): Legacy15Run | Legacy16Run {
  if (format === "niceeval.project-database/0.15") {
    const decoded = Legacy15RunDocumentDefinition.decode(input);
    if (Result.isFailure(decoded)) throw new Error(`Run does not match the exact ${format} codec`);
    return decoded.success;
  }
  const decoded = Legacy16RunDocumentDefinition.decode(input);
  if (Result.isFailure(decoded)) throw new Error(`Run does not match the exact ${format} codec`);
  return decoded.success;
}

export function migrateLegacyRunBytes(
  format: LegacyProjectDatabaseFormat,
  source: Uint8Array,
): { readonly runId: string; readonly bytes: Uint8Array; readonly digest: string } {
  const parsed = parseCanonical(source);
  const run = decodeLegacyRun(format, parsed);
  assertHistoricalCanonical(source, parsed);
  const bytes = canonicalBytes(migrateRun(run, format));
  return Object.freeze({ runId: run.runId, bytes, digest: digest(bytes) });
}

export function migrateLegacyClosureBytes(
  format: LegacyProjectDatabaseFormat,
  source: Uint8Array,
): { readonly originRunId: string; readonly bytes: Uint8Array; readonly digest: string } {
  const parsed = parseCanonical(source);
  let legacy: { readonly format?: typeof ATTEMPT_PUBLICATION_CLOSURE_FORMAT; readonly originRun: Legacy15Run | Legacy16Run };
  if (format === "niceeval.project-database/0.15") {
    const decoded = Legacy15ClosureDefinition.decode(parsed);
    if (Result.isFailure(decoded)) throw new Error(`Attempt closure does not match the exact ${format} codec`);
    legacy = decoded.success as unknown as typeof legacy;
  } else {
    const decoded = Legacy16ClosureDefinition.decode(parsed);
    if (Result.isFailure(decoded)) throw new Error(`Attempt closure does not match the exact ${format} codec`);
    legacy = decoded.success as unknown as typeof legacy;
  }
  assertHistoricalCanonical(source, parsed);
  const originRun = migrateRun(legacy.originRun, format);
  const migrated: RecordJsonObject = Object.hasOwn(legacy, "format")
    ? { format: ATTEMPT_PUBLICATION_CLOSURE_FORMAT, originRun }
    : { originRun };
  const current = decodeAttemptPublicationClosure(migrated);
  if (Result.isFailure(current)) throw new Error("converted Attempt closure does not match the current closure codec");
  const bytes = canonicalBytes(migrated);
  return Object.freeze({ originRunId: legacy.originRun.runId, bytes, digest: digest(bytes) });
}
