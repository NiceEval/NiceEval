import { Schema } from "effect";

const NonEmpty = Schema.NonEmptyTrimmedString;
const NonEmptyRaw = Schema.String.pipe(Schema.minLength(1));

export const FeedbackSourceSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("issue"),
    repository: NonEmpty,
    number: Schema.Number.pipe(Schema.int(), Schema.positive()),
    url: NonEmpty,
  }),
  Schema.Struct({
    kind: Schema.Literal("dogfood"),
    repository: NonEmpty,
    originId: NonEmpty,
    commit: NonEmpty,
  }),
  Schema.Struct({
    kind: Schema.Literal("dev"),
    repository: NonEmpty,
    commit: Schema.optional(NonEmpty),
  }),
);

export const FeedbackMemoryRelationSchema = Schema.Struct({
  kind: Schema.Literal("investigation", "root-cause", "decision", "delivery"),
  memory: NonEmpty,
});

export const FeedbackClosureSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("fixed"), memory: NonEmpty, proof: Schema.Array(NonEmpty).pipe(Schema.minItems(1)) }),
  Schema.Struct({
    kind: Schema.Literal("delivered"),
    memory: NonEmpty,
    target: NonEmpty,
    proof: Schema.Array(NonEmpty).pipe(Schema.minItems(1)),
  }),
  Schema.Struct({ kind: Schema.Literal("duplicate"), canonical: NonEmpty }),
  Schema.Struct({ kind: Schema.Literal("declined"), memory: NonEmpty }),
  Schema.Struct({ kind: Schema.Literal("invalid"), evidence: Schema.Array(NonEmpty).pipe(Schema.minItems(1)) }),
  Schema.Struct({
    kind: Schema.Literal("external-fixed"),
    dependency: NonEmpty,
    version: NonEmpty,
    proof: Schema.Array(NonEmpty).pipe(Schema.minItems(1)),
  }),
);

export const FeedbackV1Schema = Schema.Struct({
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
  closure: Schema.optional(FeedbackClosureSchema),
});
export type FeedbackV1 = typeof FeedbackV1Schema.Type;
export type FeedbackClosure = typeof FeedbackClosureSchema.Type;
export type FeedbackMemoryRelation = typeof FeedbackMemoryRelationSchema.Type;

export const FeedbackEnvelopeV1Schema = Schema.Struct({
  format: Schema.Literal("niceeval.feedback-envelope/v1"),
  origin: Schema.Struct({ repository: NonEmpty, originId: NonEmpty, commit: NonEmpty }),
  candidate: Schema.optional(Schema.Struct({
    version: Schema.optional(NonEmpty),
    commit: Schema.optional(NonEmpty),
    sha256: Schema.optional(NonEmpty),
  })),
  source: Schema.Literal("issue", "dogfood", "dev"),
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
    artifacts: Schema.Array(Schema.Struct({
      path: NonEmpty,
      byteLength: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      sha256: NonEmpty,
    })),
    provenance: Schema.Struct({ kind: Schema.Literal("frog"), repository: NonEmpty }),
    memoryDisposition: MemoryDispositionSchema,
  })),
});
export type FrogMigrationReceipt = typeof FrogMigrationReceiptSchema.Type;
