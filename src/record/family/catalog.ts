import { Either, Schema } from "effect";
import {
  isRecordBlobRef,
  makeFixedAttachmentWriteSpec,
} from "../attachment/internal.ts";
import type {
  FixedAttachmentWriteSpec,
  RecordAttachmentBlobBudget,
  RecordAttachmentBlobRefs,
  RecordAttachmentMaterializedRefine,
  RecordAttachmentWrite,
  RecordBlobRef,
} from "../attachment/types.ts";
import { RecordExactParseOptions } from "../codec/core.ts";
import {
  defineRecordAttachment,
  defineRecordProperty,
  defineRecordValue,
  type RecordAttachmentDefinition,
  type RecordAttachmentAdjacentMigrationLink,
  type RecordPropertyMap,
  type RecordValueDefinition,
  type RecordValueIssue,
  type RecordValueLimits,
} from "../definition/index.ts";
import {
  AssertionsAttachmentSchema,
  AssertionsEntriesSchema,
  AssertionSourceSitesSchema,
  assertionsAttachmentIntegrityIssues,
  assertionsBlobRefs,
  type AssertionsAttachment,
} from "./assertions.ts";
import {
  ArtifactSchema,
  ArtifactsAttachmentSchema,
  artifactsAttachmentIntegrityIssues,
  artifactBlobRefs,
  type ArtifactsAttachment,
} from "./artifacts.ts";
import {
  CollectionStateSchema,
  NiceEvalFamilySchema,
  type FixedRecordAttachmentOwner,
  type NiceEvalFamily,
} from "./common.ts";
import {
  FileChangeSchema,
  FileChangesAttachmentSchema,
  fileChangesAttachmentIntegrityIssues,
  fileChangesBlobRefs,
  type FileChangesAttachment,
} from "./file-changes.ts";
import {
  AttemptCommandsCollectionSchema,
  AttemptConversationCollectionSchema,
  AttemptDiagnosticsCollectionSchema,
  AttemptObservabilityAttachmentSchema,
  AttemptTimingCollectionSchema,
  AttemptUsageCollectionSchema,
  RunDiagnosticsCollectionSchema,
  RunObservabilityAttachmentSchema,
  RunTimingCollectionSchema,
  observabilityBlobRefs,
  observabilityAttachmentIntegrityIssues,
  type AttemptObservabilityAttachment,
  type RunObservabilityAttachment,
} from "./observability.ts";
import {
  SourceItemSchema,
  SourcesAttachmentSchema,
  sourcesAttachmentIntegrityIssues,
  sourcesBlobRefs,
  type SourcesAttachment,
} from "./sources.ts";

const AttachmentValueLimits: RecordValueLimits = Object.freeze({
  maximumJsonBytes: 16 * 1024 * 1024,
  maximumDepth: 32,
  maximumNodes: 200_000,
  maximumObjectKeys: 50_000,
  maximumArrayItems: 100_000,
  maximumKeyUtf8Bytes: 256,
  maximumStringUtf8Bytes: 1024 * 1024,
});

const FixedBlobBudgets = Object.freeze({
  assertions: Object.freeze({ maximumBlobs: 20_000, maximumBlobBytes: 16 * 1024 * 1024, maximumTotalBytes: 64 * 1024 * 1024 }),
  observabilityAttempt: Object.freeze({ maximumBlobs: 4_000, maximumBlobBytes: 16 * 1024 * 1024, maximumTotalBytes: 64 * 1024 * 1024 }),
  observabilityRun: Object.freeze({ maximumBlobs: 256, maximumBlobBytes: 16 * 1024 * 1024, maximumTotalBytes: 16 * 1024 * 1024 }),
  fileChanges: Object.freeze({ maximumBlobs: 20_000, maximumBlobBytes: 16 * 1024 * 1024, maximumTotalBytes: 128 * 1024 * 1024 }),
  sources: Object.freeze({ maximumBlobs: 20_000, maximumBlobBytes: 16 * 1024 * 1024, maximumTotalBytes: 128 * 1024 * 1024 }),
  artifactsAttempt: Object.freeze({ maximumBlobs: 4_000, maximumBlobBytes: 64 * 1024 * 1024, maximumTotalBytes: 128 * 1024 * 1024 }),
  artifactsRun: Object.freeze({ maximumBlobs: 4_000, maximumBlobBytes: 64 * 1024 * 1024, maximumTotalBytes: 128 * 1024 * 1024 }),
});

function materialization<Payload>(
  blobBudget: RecordAttachmentBlobBudget,
  refine: RecordAttachmentMaterializedRefine<Payload>,
) {
  return Object.freeze({
    blobBudget,
    materializedRefine: (payload: unknown, blobs: Parameters<RecordAttachmentMaterializedRefine<Payload>>[1]) =>
      refine(payload as Payload, blobs),
  });
}


function requireFixed<Result, Failure>(result: Either.Either<Result, Failure>, message: string): Result {
  if (Either.isLeft(result)) throw new Error(message);
  return result.right;
}

function currentValueIssues(
  schema: Schema.Schema.AnyNoContext,
  value: unknown,
): readonly RecordValueIssue[] {
  return Either.isRight(Schema.decodeUnknownEither(schema, RecordExactParseOptions)(value))
    ? Object.freeze([])
    : Object.freeze([{ code: "record-attachment-current-value-invalid", path: Object.freeze([]) }]);
}

/**
 * One owner value is a property map, not an attachment-sized wrapper. The
 * aggregate schema remains a refine only for relations between those fields.
 */
function defineFixedOwnerValue<
  const Properties extends RecordPropertyMap,
>(input: {
  readonly properties: Properties;
  readonly schema: Schema.Schema.AnyNoContext;
}) {
  return defineRecordValue({
    properties: input.properties,
    leaf: "json-with-blob-refs" as const,
    limits: AttachmentValueLimits,
    isBlobRef: isRecordBlobRef,
    refine: (value) => currentValueIssues(input.schema, value),
  });
}

const assertionsProperties = {
  entries: defineRecordProperty({
    id: "niceeval.assertions.entries",
    durableKey: "entries-data",
    schema: AssertionsEntriesSchema,
  }),
  sourceSites: defineRecordProperty({
    id: "niceeval.assertions.source-sites",
    durableKey: "source-sites-data",
    schema: AssertionSourceSitesSchema,
  }),
} as const;

const attemptObservabilityProperties = {
  owner: defineRecordProperty({
    id: "niceeval.observability.attempt.owner",
    durableKey: "owner-kind",
    schema: Schema.Literal("attempt"),
  }),
  conversation: defineRecordProperty({
    id: "niceeval.observability.attempt.conversation",
    durableKey: "conversation-data",
    schema: AttemptConversationCollectionSchema,
  }),
  commands: defineRecordProperty({
    id: "niceeval.observability.attempt.commands",
    durableKey: "commands-data",
    schema: AttemptCommandsCollectionSchema,
  }),
  usage: defineRecordProperty({
    id: "niceeval.observability.attempt.usage",
    durableKey: "usage-data",
    schema: AttemptUsageCollectionSchema,
  }),
  timing: defineRecordProperty({
    id: "niceeval.observability.attempt.timing",
    durableKey: "timing-data",
    schema: AttemptTimingCollectionSchema,
  }),
  diagnostics: defineRecordProperty({
    id: "niceeval.observability.attempt.diagnostics",
    durableKey: "diagnostics-data",
    schema: AttemptDiagnosticsCollectionSchema,
  }),
} as const;

const runObservabilityProperties = {
  owner: defineRecordProperty({
    id: "niceeval.observability.run.owner",
    durableKey: "owner-kind",
    schema: Schema.Literal("run"),
  }),
  timing: defineRecordProperty({
    id: "niceeval.observability.run.timing",
    durableKey: "timing-data",
    schema: RunTimingCollectionSchema,
  }),
  diagnostics: defineRecordProperty({
    id: "niceeval.observability.run.diagnostics",
    durableKey: "diagnostics-data",
    schema: RunDiagnosticsCollectionSchema,
  }),
} as const;

const fileChangesProperties = {
  collection: defineRecordProperty({
    id: "niceeval.file-changes.collection",
    durableKey: "collection-data",
    schema: CollectionStateSchema,
  }),
  changes: defineRecordProperty({
    id: "niceeval.file-changes.changes",
    durableKey: "changes-data",
    schema: Schema.Array(FileChangeSchema),
  }),
} as const;

const sourcesProperties = {
  items: defineRecordProperty({
    id: "niceeval.sources.items",
    durableKey: "items-data",
    schema: Schema.Array(SourceItemSchema),
  }),
} as const;

const artifactsProperties = {
  collection: defineRecordProperty({
    id: "niceeval.artifacts.collection",
    durableKey: "collection-data",
    schema: CollectionStateSchema,
  }),
  artifacts: defineRecordProperty({
    id: "niceeval.artifacts.items",
    durableKey: "artifacts-data",
    schema: Schema.Array(ArtifactSchema),
  }),
} as const;

const assertionsOwnerValue = defineFixedOwnerValue({
  properties: assertionsProperties,
  schema: AssertionsAttachmentSchema,
});
const attemptObservabilityOwnerValue = defineFixedOwnerValue({
  properties: attemptObservabilityProperties,
  schema: AttemptObservabilityAttachmentSchema,
});
const runObservabilityOwnerValue = defineFixedOwnerValue({
  properties: runObservabilityProperties,
  schema: RunObservabilityAttachmentSchema,
});
const fileChangesOwnerValue = defineFixedOwnerValue({
  properties: fileChangesProperties,
  schema: FileChangesAttachmentSchema,
});
const sourcesOwnerValue = defineFixedOwnerValue({
  properties: sourcesProperties,
  schema: SourcesAttachmentSchema,
});
const attemptArtifactsOwnerValue = defineFixedOwnerValue({
  properties: artifactsProperties,
  schema: ArtifactsAttachmentSchema,
});
const runArtifactsOwnerValue = defineFixedOwnerValue({
  properties: artifactsProperties,
  schema: ArtifactsAttachmentSchema,
});

// Exactly five fixed declarations; dual-owner families are one `owners` map.
export const assertionsRecordAttachment = defineRecordAttachment({
  family: "niceeval.assertions",
  current: {
    schemaVersion: 1,
    owners: { attempt: assertionsOwnerValue },
    materialization: { attempt: materialization(FixedBlobBudgets.assertions, assertionsAttachmentIntegrityIssues) },
  },
});
export const observabilityRecordAttachment = defineRecordAttachment({
  family: "niceeval.observability",
  current: {
    schemaVersion: 1,
    owners: { attempt: attemptObservabilityOwnerValue, run: runObservabilityOwnerValue },
    materialization: {
      attempt: materialization(FixedBlobBudgets.observabilityAttempt, observabilityAttachmentIntegrityIssues),
      run: materialization(FixedBlobBudgets.observabilityRun, observabilityAttachmentIntegrityIssues),
    },
  },
});
export const fileChangesRecordAttachment = defineRecordAttachment({
  family: "niceeval.file-changes",
  current: {
    schemaVersion: 1,
    owners: { attempt: fileChangesOwnerValue },
    materialization: { attempt: materialization(FixedBlobBudgets.fileChanges, fileChangesAttachmentIntegrityIssues) },
  },
});
export const sourcesRecordAttachment = defineRecordAttachment({
  family: "niceeval.sources",
  current: {
    schemaVersion: 1,
    owners: { run: sourcesOwnerValue },
    materialization: { run: materialization(FixedBlobBudgets.sources, sourcesAttachmentIntegrityIssues) },
  },
});
export const artifactsRecordAttachment = defineRecordAttachment({
  family: "niceeval.artifacts",
  current: {
    schemaVersion: 1,
    owners: { attempt: attemptArtifactsOwnerValue, run: runArtifactsOwnerValue },
    materialization: {
      attempt: materialization(FixedBlobBudgets.artifactsAttempt, artifactsAttachmentIntegrityIssues),
      run: materialization(FixedBlobBudgets.artifactsRun, artifactsAttachmentIntegrityIssues),
    },
  },
});

export interface FixedRecordFamilyDescriptor<
  Family extends NiceEvalFamily,
  Owner extends FixedRecordAttachmentOwner,
  Payload,
  Value extends RecordValueDefinition<any, "json-with-blob-refs", RecordBlobRef> = RecordValueDefinition<any, "json-with-blob-refs", RecordBlobRef>,
> {
  readonly family: Family;
  readonly schemaVersion: number;
  readonly owner: Owner;
  /** Exact declaration-owned current value and its property tokens. */
  readonly value: Value;
  readonly properties: Value["properties"];
  /** The sole low-level closure/write primitive derived from that exact value. */
  readonly write: FixedAttachmentWriteSpec<Owner, Payload>;
  /** Static owner policy duplicated on the descriptor for read/seal integration. */
  readonly blobBudget: RecordAttachmentBlobBudget;
  readonly materializedRefine: RecordAttachmentMaterializedRefine<Payload>;
  /** Declared adjacent upgrade graph; implementations remain lazy. */
  readonly adjacentMigrationLinks: readonly RecordAttachmentAdjacentMigrationLink[];
}

function fixedFamily<
  Family extends NiceEvalFamily,
  Owner extends FixedRecordAttachmentOwner,
  Payload,
  Value extends RecordValueDefinition<any, "json-with-blob-refs", RecordBlobRef>,
>(input: {
  readonly declaration: RecordAttachmentDefinition<Family>;
  readonly owner: Owner;
  readonly value: Value;
  readonly blobRefs: RecordAttachmentBlobRefs<Payload>;
}): FixedRecordFamilyDescriptor<Family, Owner, Payload, Value> {
  if (input.declaration.current.owners[input.owner] !== input.value) {
    throw new Error(`Fixed Record family ${input.declaration.family} lost its declared ${input.owner} owner value`);
  }
  const materialization = input.declaration.current.materialization[input.owner];
  if (materialization === undefined) {
    throw new Error(`Fixed Record family ${input.declaration.family} lost its ${input.owner} materialization policy`);
  }
  const write = requireFixed(
    makeFixedAttachmentWriteSpec({
      owner: input.owner,
      family: input.declaration.family,
      schemaVersion: input.declaration.current.schemaVersion,
      value: input.value,
      blobRefs: input.blobRefs,
      blobBudget: materialization.blobBudget,
      materializedRefine: materialization.materializedRefine as RecordAttachmentMaterializedRefine<Payload>,
    }),
    `Fixed Record family ${input.declaration.family} must have a valid owner primitive`,
  );
  return Object.freeze({
    family: input.declaration.family,
    schemaVersion: input.declaration.current.schemaVersion,
    owner: input.owner,
    value: input.value,
    properties: input.value.properties,
    write,
    blobBudget: write.blobBudget,
    materializedRefine: write.materializedRefine,
    adjacentMigrationLinks: input.declaration.adjacentMigrationLinks,
  });
}

export const assertionsRecordFamily = fixedFamily({
  declaration: assertionsRecordAttachment,
  owner: "attempt",
  value: assertionsOwnerValue,
  blobRefs: assertionsBlobRefs,
});
export const attemptObservabilityRecordFamily = fixedFamily<
  "niceeval.observability",
  "attempt",
  AttemptObservabilityAttachment,
  typeof attemptObservabilityOwnerValue
>({
  declaration: observabilityRecordAttachment,
  owner: "attempt",
  value: attemptObservabilityOwnerValue,
  blobRefs: observabilityBlobRefs as RecordAttachmentBlobRefs<AttemptObservabilityAttachment>,
});
export const runObservabilityRecordFamily = fixedFamily<
  "niceeval.observability",
  "run",
  RunObservabilityAttachment,
  typeof runObservabilityOwnerValue
>({
  declaration: observabilityRecordAttachment,
  owner: "run",
  value: runObservabilityOwnerValue,
  blobRefs: observabilityBlobRefs as RecordAttachmentBlobRefs<RunObservabilityAttachment>,
});
export const fileChangesRecordFamily = fixedFamily({
  declaration: fileChangesRecordAttachment,
  owner: "attempt",
  value: fileChangesOwnerValue,
  blobRefs: fileChangesBlobRefs,
});
export const sourcesRecordFamily = fixedFamily({
  declaration: sourcesRecordAttachment,
  owner: "run",
  value: sourcesOwnerValue,
  blobRefs: sourcesBlobRefs,
});
export const attemptArtifactsRecordFamily = fixedFamily({
  declaration: artifactsRecordAttachment,
  owner: "attempt",
  value: attemptArtifactsOwnerValue,
  blobRefs: artifactBlobRefs,
});
export const runArtifactsRecordFamily = fixedFamily({
  declaration: artifactsRecordAttachment,
  owner: "run",
  value: runArtifactsOwnerValue,
  blobRefs: artifactBlobRefs,
});

export const NiceEvalRecordFamilyCatalog = Object.freeze({
  assertions: assertionsRecordFamily,
  observability: Object.freeze({
    attempt: attemptObservabilityRecordFamily,
    run: runObservabilityRecordFamily,
  }),
  fileChanges: fileChangesRecordFamily,
  sources: sourcesRecordFamily,
  artifacts: Object.freeze({
    attempt: attemptArtifactsRecordFamily,
    run: runArtifactsRecordFamily,
  }),
});

export const FixedRecordAttachmentEnvelopeSchema: Schema.Schema<{
  readonly family: NiceEvalFamily;
  readonly schemaVersion: number;
}> = Schema.Struct({
  family: NiceEvalFamilySchema,
  schemaVersion: Schema.Int.pipe(Schema.positive()),
});

export function decodeFixedRecordAttachmentEnvelope(input: unknown): Either.Either<
  { readonly family: NiceEvalFamily; readonly schemaVersion: number },
  { readonly code: "record-fixed-family-envelope-invalid" }
> {
  const decoded = Schema.decodeUnknownEither(FixedRecordAttachmentEnvelopeSchema, RecordExactParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({ code: "record-fixed-family-envelope-invalid" as const }))
    : Either.right(decoded.right);
}

export function encodeFixedRecordAttachmentEnvelope(
  envelope: { readonly family: NiceEvalFamily; readonly schemaVersion: number },
): Either.Either<
  { readonly family: NiceEvalFamily; readonly schemaVersion: number },
  { readonly code: "record-fixed-family-envelope-invalid" }
> {
  const encoded = Schema.encodeUnknownEither(FixedRecordAttachmentEnvelopeSchema, RecordExactParseOptions)(envelope);
  return Either.isLeft(encoded)
    ? Either.left(Object.freeze({ code: "record-fixed-family-envelope-invalid" as const }))
    : Either.right(encoded.right);
}

export type FixedRecordFamilyPayload =
  | AssertionsAttachment
  | AttemptObservabilityAttachment
  | RunObservabilityAttachment
  | FileChangesAttachment
  | SourcesAttachment
  | ArtifactsAttachment;

export type FixedRecordFamilyWrite<
  Owner extends FixedRecordAttachmentOwner,
  Error = never,
  Requirements = never,
> = RecordAttachmentWrite<Owner, Error, Requirements>;
