import { Schema } from "effect";

import { RepoRefSchema } from "../docs/trace/ref.js";
import { ADOPTABLE_DOCS_NODE_KINDS } from "../docs/trace/model.js";

const NonEmpty = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));
const UniqueRepoRefs = Schema.UniqueArray(RepoRefSchema);

export const PROBLEM_RESOLUTION_KINDS = ["fixed", "not-a-bug", "wont-fix", "external-fixed"] as const;
export const MemoryKind = Object.freeze({
  Problem: "problem",
  Decision: "decision",
  Insight: "insight",
} as const);
export const MEMORY_KINDS = [MemoryKind.Problem, MemoryKind.Decision, MemoryKind.Insight] as const;

export const ProblemResolutionSchema = Schema.Struct({
  kind: Schema.Literals(PROBLEM_RESOLUTION_KINDS),
  proof: Schema.NonEmptyArray(NonEmpty),
});
export type ProblemResolution = typeof ProblemResolutionSchema.Type;

export const PromotionKindSchema = Schema.Literals(ADOPTABLE_DOCS_NODE_KINDS);
export type PromotionKind = typeof PromotionKindSchema.Type;

export const PromotionSchema = Schema.Struct({
  kind: PromotionKindSchema,
  current: UniqueRepoRefs,
  history: Schema.Array(Schema.Struct({ target: RepoRefSchema, commit: NonEmpty })),
});
export type Promotion = typeof PromotionSchema.Type;

export const MemoryKindSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal(MemoryKind.Problem), state: Schema.Literals(["open", "resolved"]), resolution: Schema.optional(ProblemResolutionSchema) }),
  Schema.Struct({ type: Schema.Literal(MemoryKind.Decision), state: Schema.Literals(["adopted", "superseded"]), supersededBy: Schema.optional(NonEmpty) }),
  Schema.Struct({ type: Schema.Literal(MemoryKind.Insight), state: Schema.Literals(["current", "superseded"]), supersededBy: Schema.optional(NonEmpty) }),
]);

export const MemoryV1Schema = Schema.Struct({
  format: Schema.Literal("niceeval.memory/v1"),
  id: NonEmpty,
  title: NonEmpty,
  createdAt: NonEmpty,
  kind: MemoryKindSchema,
  promotions: Schema.Array(PromotionSchema).check(Schema.makeFilter(
    (values) => new Set(values.map((item) => item.kind)).size === values.length,
    { identifier: "UniquePromotionKinds", description: "at most one promotion bucket is allowed for each kind" },
  )),
});
export type MemoryV1 = typeof MemoryV1Schema.Type;

export interface StructuredMemoryDocument { readonly metadata: MemoryV1; readonly body: string }
export interface LegacyMemoryDocument { readonly legacy: true; readonly id: string; readonly title: string; readonly body: string }
export type MemoryDocument = StructuredMemoryDocument | LegacyMemoryDocument;
