import { Schema } from "effect";

import { RepoRefSchema } from "../docs/trace/ref.js";

const NonEmpty = Schema.NonEmptyTrimmedString;
const NonEmptyRaw = Schema.String.pipe(Schema.minLength(1));
const MemoryId = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u));
const Sha256Digest = Schema.String.pipe(Schema.pattern(/^sha256:[0-9a-f]{64}$/u));
const GitCommit = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{40}$/u));
const UniqueRepoRefs = Schema.Array(RepoRefSchema).pipe(
  Schema.filter((values) => new Set(values).size === values.length, { message: () => "RepoRefs must be exact and unique" }),
);

export const FeedbackSourceSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("issue"), repository: NonEmpty, number: Schema.Number.pipe(Schema.int(), Schema.positive()), url: NonEmpty }),
  Schema.Struct({ kind: Schema.Literal("dogfood"), repository: NonEmpty, originId: NonEmpty, commit: NonEmpty }),
  Schema.Struct({ kind: Schema.Literal("dev"), repository: NonEmpty, commit: Schema.optional(NonEmpty) }),
);

export const FeedbackMemoryRelationSchema = Schema.Struct({
  kind: Schema.Literal("investigation", "root-cause", "decision", "delivery"),
  memory: MemoryId,
});
const UniqueFeedbackMemoryRelations = Schema.Array(FeedbackMemoryRelationSchema).pipe(
  Schema.filter((values) => new Set(values.map((item) => `${item.kind}\0${item.memory}`)).size === values.length, {
    message: () => "Memory relations must be unique by kind and Memory ID",
  }),
);

export const FeedbackClosureSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("fixed"), memory: MemoryId, proof: Schema.Array(NonEmpty).pipe(Schema.minItems(1)) }),
  Schema.Struct({ kind: Schema.Literal("delivered"), memory: MemoryId, target: RepoRefSchema, proof: Schema.Array(NonEmpty).pipe(Schema.minItems(1)) }),
  Schema.Struct({ kind: Schema.Literal("duplicate"), canonical: NonEmpty }),
  Schema.Struct({ kind: Schema.Literal("declined"), memory: MemoryId }),
  Schema.Struct({ kind: Schema.Literal("invalid"), evidence: Schema.Array(NonEmpty).pipe(Schema.minItems(1)) }),
  Schema.Struct({ kind: Schema.Literal("external-fixed"), dependency: NonEmpty, version: NonEmpty, proof: Schema.Array(NonEmpty).pipe(Schema.minItems(1)) }),
);

export const FeedbackAdoptionsSchema = Schema.Struct({
  current: UniqueRepoRefs,
  history: Schema.Array(Schema.Struct({ target: RepoRefSchema, commit: NonEmpty })),
});

const FeedbackFields = {
  format: Schema.Literal("niceeval.feedback/v2"),
  id: NonEmpty,
  title: NonEmpty,
  state: Schema.Literal("open", "closed"),
  reportedAt: NonEmpty,
  source: FeedbackSourceSchema,
  subject: Schema.Literal("product", "repository", "dependency"),
  claim: Schema.Literal("defect", "friction", "request"),
  observation: NonEmptyRaw,
  impact: NonEmptyRaw,
  memoryRelations: UniqueFeedbackMemoryRelations,
  closure: Schema.optional(FeedbackClosureSchema),
} as const;

export const FeedbackV2Schema = Schema.Struct({ ...FeedbackFields, adoptions: FeedbackAdoptionsSchema });
export type FeedbackV2 = typeof FeedbackV2Schema.Type;
export type FeedbackClosure = typeof FeedbackClosureSchema.Type;
export type FeedbackMemoryRelation = typeof FeedbackMemoryRelationSchema.Type;

export const FeedbackCreateSchema = Schema.Struct({ ...FeedbackFields, adoptions: Schema.optional(FeedbackAdoptionsSchema) });
export type FeedbackCreate = typeof FeedbackCreateSchema.Type;

const FeedbackV1ClosureSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("fixed"), memory: NonEmpty, proof: Schema.Array(NonEmpty).pipe(Schema.minItems(1)) }),
  Schema.Struct({ kind: Schema.Literal("delivered"), memory: NonEmpty, target: NonEmpty, proof: Schema.Array(NonEmpty).pipe(Schema.minItems(1)) }),
  Schema.Struct({ kind: Schema.Literal("duplicate"), canonical: NonEmpty }),
  Schema.Struct({ kind: Schema.Literal("declined"), memory: NonEmpty }),
  Schema.Struct({ kind: Schema.Literal("invalid"), evidence: Schema.Array(NonEmpty).pipe(Schema.minItems(1)) }),
  Schema.Struct({ kind: Schema.Literal("external-fixed"), dependency: NonEmpty, version: NonEmpty, proof: Schema.Array(NonEmpty).pipe(Schema.minItems(1)) }),
);

/** Historical source decoder used only by the one-time v1 → v2 receipt verifier. */
export const FeedbackV1MigrationSourceSchema = Schema.Struct({
  format: Schema.Literal("niceeval.feedback/v1"),
  id: NonEmpty,
  title: NonEmpty,
  state: Schema.Literal("open", "closed"),
  reportedAt: NonEmpty,
  source: FeedbackSourceSchema,
  subject: Schema.Literal("product", "repository", "dependency"),
  claim: Schema.Literal("defect", "friction", "request"),
  observation: NonEmptyRaw,
  impact: NonEmptyRaw,
  adoptedContract: Schema.optional(Schema.Struct({ path: NonEmpty, anchor: NonEmpty })),
  memoryRelations: Schema.Array(FeedbackMemoryRelationSchema),
  duplicateOf: Schema.optional(NonEmpty),
  closure: Schema.optional(FeedbackV1ClosureSchema),
});
export type FeedbackV1MigrationSource = typeof FeedbackV1MigrationSourceSchema.Type;

export const FeedbackEnvelopeV1Schema = Schema.Struct({
  format: Schema.Literal("niceeval.feedback-envelope/v1"),
  origin: Schema.Struct({ repository: NonEmpty, originId: NonEmpty, commit: NonEmpty }),
  candidate: Schema.optional(Schema.Struct({ version: Schema.optional(NonEmpty), commit: Schema.optional(NonEmpty), sha256: Schema.optional(NonEmpty) })),
  source: Schema.Literal("dogfood"),
  observation: NonEmptyRaw,
  impact: NonEmptyRaw,
  artifacts: Schema.Array(Schema.Struct({
    path: NonEmpty,
    byteLength: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    sha256: NonEmpty,
  })),
  digest: NonEmpty,
});
export type FeedbackEnvelopeV1 = typeof FeedbackEnvelopeV1Schema.Type;

export const MemoryDispositionSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("existing", "problem", "insight"), memory: NonEmpty }),
  Schema.Struct({ kind: Schema.Literal("none"), reason: NonEmpty }),
);

export const FrogMigrationReceiptSchema = Schema.Struct({
  format: Schema.Literal("niceeval.frog-migration/v1"),
  sourceRoot: Schema.Literal(".agents/friction-log"),
  expectedCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  migratedCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  entries: Schema.Array(Schema.Struct({
    legacyId: NonEmpty,
    legacyPath: NonEmpty,
    feedbackId: NonEmpty,
    originalTime: NonEmpty,
    severity: Schema.Literal("minor", "major"),
    body: NonEmptyRaw,
    bodySha256: NonEmpty,
    artifacts: Schema.Array(Schema.Struct({ path: NonEmpty, byteLength: Schema.Number.pipe(Schema.int(), Schema.nonNegative()), sha256: NonEmpty })),
    provenance: Schema.Struct({ kind: Schema.Literal("frog"), repository: NonEmpty }),
    memoryDisposition: MemoryDispositionSchema,
  })),
});
export type FrogMigrationReceipt = typeof FrogMigrationReceiptSchema.Type;

export const FeedbackV2MigrationReceiptSchema = Schema.Struct({
  format: Schema.Literal("niceeval.feedback-schema-migration/v2"),
  sourceCommit: GitCommit,
  before: Schema.Struct({ v1: Schema.Number.pipe(Schema.int(), Schema.nonNegative()), v2: Schema.Number.pipe(Schema.int(), Schema.nonNegative()) }),
  after: Schema.Struct({ v1: Schema.Number.pipe(Schema.int(), Schema.nonNegative()), v2: Schema.Number.pipe(Schema.int(), Schema.nonNegative()) }),
  entries: Schema.Array(Schema.Struct({
    id: NonEmpty,
    v1MetadataDigest: Sha256Digest,
    v2MetadataDigest: Sha256Digest,
    observationDigest: Sha256Digest,
    impactDigest: Sha256Digest,
    bodyDigest: Sha256Digest,
    artifacts: Schema.Array(Schema.Struct({ path: NonEmpty, byteLength: Schema.Number.pipe(Schema.int(), Schema.nonNegative()), digest: Sha256Digest })),
  })),
});
export type FeedbackV2MigrationReceipt = typeof FeedbackV2MigrationReceiptSchema.Type;
