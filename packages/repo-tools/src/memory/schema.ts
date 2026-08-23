import { Schema } from "effect";

const NonEmpty = Schema.NonEmptyTrimmedString;

export const ProblemResolutionSchema = Schema.Struct({
  kind: Schema.Literal("fixed", "not-a-bug", "wont-fix", "external-fixed"),
  proof: Schema.Array(NonEmpty).pipe(Schema.minItems(1)),
});
export type ProblemResolution = typeof ProblemResolutionSchema.Type;

export const PromotionSchema = Schema.Struct({
  kind: Schema.Literal("roadmap", "feature", "engineering"),
  current: Schema.optional(Schema.Struct({ path: NonEmpty, anchor: NonEmpty })),
  history: Schema.Array(Schema.Struct({ path: NonEmpty, anchor: NonEmpty, commit: NonEmpty })),
});
export type Promotion = typeof PromotionSchema.Type;

export const MemoryKindSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("problem"),
    state: Schema.Literal("open", "resolved"),
    resolution: Schema.optional(ProblemResolutionSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("decision"),
    state: Schema.Literal("adopted", "superseded"),
    supersededBy: Schema.optional(NonEmpty),
  }),
  Schema.Struct({
    type: Schema.Literal("insight"),
    state: Schema.Literal("current", "superseded"),
    supersededBy: Schema.optional(NonEmpty),
  }),
);

export const MemoryV1Schema = Schema.Struct({
  format: Schema.Literal("niceeval.memory/v1"),
  id: NonEmpty,
  title: NonEmpty,
  createdAt: NonEmpty,
  kind: MemoryKindSchema,
  promotions: Schema.Array(PromotionSchema),
});
export type MemoryV1 = typeof MemoryV1Schema.Type;

export interface StructuredMemoryDocument {
  readonly metadata: MemoryV1;
  readonly body: string;
}

export interface LegacyMemoryDocument {
  readonly legacy: true;
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export type MemoryDocument = StructuredMemoryDocument | LegacyMemoryDocument;
