import { Schema } from "effect";

const NonEmptyTrimmedString = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));

export const RESEARCH_FORMAT = "niceeval.research/v1" as const;
export const RESEARCH_MARKER = "<!-- niceeval-research: v1 -->" as const;

const SegmentSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/u));
export const ResearchPathSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/u));
export const ResearchRefSchema = Schema.String.check(Schema.isPattern(/^research:docs\/research(?:\/[a-z0-9][a-z0-9-]*)*\/(?:README|[a-z0-9][a-z0-9-]*)\.md$/u));
export const ResearchUrlSchema = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/u));
export const ObservationDateSchema = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));
const MarkdownAnswerSchema = NonEmptyTrimmedString;

export const ResearchContentSchema = Schema.Struct({
  title: NonEmptyTrimmedString,
  observedOn: ObservationDateSchema,
  version: Schema.optional(NonEmptyTrimmedString),
  sources: Schema.Array(ResearchUrlSchema).pipe(Schema.check(Schema.isMinLength(1))),
  boundary: MarkdownAnswerSchema,
  mapping: MarkdownAnswerSchema,
  absorb: MarkdownAnswerSchema,
  nextEvidence: MarkdownAnswerSchema,
});
export type ResearchContent = typeof ResearchContentSchema.Type;

export const ResearchCreatePageInputSchema = Schema.Struct({
  command: Schema.Literal("create-page"),
  path: ResearchPathSchema,
  content: ResearchContentSchema,
  dryRun: Schema.Boolean,
});
export type ResearchCreatePageInput = typeof ResearchCreatePageInputSchema.Type;

export const ResearchCreatePackageInputSchema = Schema.Struct({
  command: Schema.Literal("create-package"),
  path: ResearchPathSchema,
  content: ResearchContentSchema,
  dryRun: Schema.Boolean,
});
export type ResearchCreatePackageInput = typeof ResearchCreatePackageInputSchema.Type;

export const ResearchAddPageInputSchema = Schema.Struct({
  command: Schema.Literal("add-page"),
  parent: ResearchRefSchema,
  page: SegmentSchema,
  content: ResearchContentSchema,
  dryRun: Schema.Boolean,
});
export type ResearchAddPageInput = typeof ResearchAddPageInputSchema.Type;

export const ResearchCheckInputSchema = Schema.Struct({
  command: Schema.Literal("check"),
  ref: ResearchRefSchema,
});
export type ResearchCheckInput = typeof ResearchCheckInputSchema.Type;

export const ResearchCommandInputSchema = Schema.Union([
  ResearchCreatePageInputSchema,
  ResearchCreatePackageInputSchema,
  ResearchAddPageInputSchema,
  ResearchCheckInputSchema,
]);
export type ResearchCommandInput = typeof ResearchCommandInputSchema.Type;

export const ResearchFrontmatterSchema = Schema.Struct({
  research: Schema.Literal(RESEARCH_FORMAT),
  title: NonEmptyTrimmedString,
  "observed-on": ObservationDateSchema,
  version: Schema.optional(NonEmptyTrimmedString),
  "primary-sources": Schema.Array(ResearchUrlSchema).pipe(Schema.check(Schema.isMinLength(1))),
  parent: Schema.optional(ResearchRefSchema),
});
export type ResearchFrontmatter = typeof ResearchFrontmatterSchema.Type;

export interface ResearchMutationReceipt {
  readonly format: "niceeval.docs-research/receipt/v1";
  readonly command: "create-page" | "create-package" | "add-page";
  readonly dryRun: boolean;
  readonly ref: string;
  readonly target: string;
  readonly changedPaths: readonly string[];
  readonly preimage: { readonly kind: "absent" };
  readonly contentDigest: string;
  readonly summary: string;
}

export interface ResearchCheckFinding {
  readonly path: string;
  readonly code:
    | "legacy-unmanaged"
    | "unmanaged-v1"
    | "invalid-v1"
    | "missing-required-block"
    | "missing-primary-source-link"
    | "invalid-package-root";
  readonly message: string;
}

export interface ResearchCheckReceipt {
  readonly format: "niceeval.docs-research/check/v1";
  readonly command: "check";
  readonly ok: boolean;
  readonly ref: string;
  readonly target: string;
  readonly checkedPaths: readonly string[];
  readonly findings: readonly ResearchCheckFinding[];
  readonly summary: string;
}

export type ResearchOutcome = ResearchMutationReceipt | ResearchCheckReceipt;
