import { Schema } from "effect";

const NonEmptyTrimmedString = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));

export const TermScopeSchema = Schema.Union([Schema.Literal("docs"), Schema.Literal("all"), Schema.Literal("site")]);
export type TermScope = typeof TermScopeSchema.Type;

export const BannedTermSchema = Schema.Struct({
  term: NonEmptyTrimmedString,
  use: NonEmptyTrimmedString,
  why: NonEmptyTrimmedString,
  exempt: Schema.optional(Schema.Array(NonEmptyTrimmedString)),
  allowIn: Schema.optional(Schema.Array(NonEmptyTrimmedString)),
});
export type BannedTerm = typeof BannedTermSchema.Type;

export const WritingRulesFieldsSchema = Schema.Struct({
  siteBannedTerms: Schema.Array(NonEmptyTrimmedString),
  siteOnlyBannedTerms: Schema.Array(BannedTermSchema),
  bannedTerms: Schema.Array(BannedTermSchema),
});

export const JsonObjectSchema = Schema.Record(Schema.String, Schema.Unknown);

export const AddTermInputSchema = Schema.Struct({
  term: NonEmptyTrimmedString,
  use: NonEmptyTrimmedString,
  why: NonEmptyTrimmedString,
  scope: TermScopeSchema,
  allowIn: Schema.Array(NonEmptyTrimmedString),
  exempt: Schema.Array(NonEmptyTrimmedString),
});
export type AddTermInput = typeof AddTermInputSchema.Type;

export const DocsCheckSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("docs-lint"), paths: Schema.Array(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("docs-site-lint"), paths: Schema.Array(Schema.String) }),
  Schema.Struct({
    kind: Schema.Literal("command"),
    script: NonEmptyTrimmedString,
    args: Schema.Array(Schema.String),
  }),
]);
export type DocsCheck = typeof DocsCheckSchema.Type;

export const DocsWorkItemSchema = Schema.Struct({
  format: Schema.Literal("niceeval.docs-work-item/v1"),
  runId: NonEmptyTrimmedString,
  id: NonEmptyTrimmedString,
  goal: NonEmptyTrimmedString,
  baseCommit: NonEmptyTrimmedString,
  read: Schema.Array(Schema.String),
  write: Schema.Array(Schema.String),
  blockedBy: Schema.Array(Schema.String),
  checks: Schema.Array(DocsCheckSchema),
  finalizerOnly: Schema.Array(Schema.String),
});
export type DocsWorkItem = typeof DocsWorkItemSchema.Type;

export const DocsWorkRunSchema = Schema.Struct({
  format: Schema.Literal("niceeval.docs-work-run/v1"),
  runId: NonEmptyTrimmedString,
  baseCommit: NonEmptyTrimmedString,
  createdAt: NonEmptyTrimmedString,
  items: Schema.Array(NonEmptyTrimmedString),
});
export type DocsWorkRun = typeof DocsWorkRunSchema.Type;

export const DocsWorkShowReceiptSchema = Schema.Struct({
  format: Schema.Literal("niceeval.docs-work-show/v1"),
  run: DocsWorkRunSchema,
  items: Schema.Array(DocsWorkItemSchema),
});
export type DocsWorkShowReceipt = typeof DocsWorkShowReceiptSchema.Type;

export const DocsCheckResultSchema = Schema.Struct({
  kind: Schema.Union([Schema.Literal("docs-lint"), Schema.Literal("docs-site-lint"), Schema.Literal("command")]),
  status: Schema.Union([Schema.Literal("passed"), Schema.Literal("failed")]),
  summary: Schema.String,
});

export const DocsWorkReceiptSchema = Schema.Struct({
  format: Schema.Literal("niceeval.docs-work-receipt/v1"),
  runId: NonEmptyTrimmedString,
  itemId: NonEmptyTrimmedString,
  baseCommit: NonEmptyTrimmedString,
  checkedAt: NonEmptyTrimmedString,
  readDigest: Schema.String,
  writeDigest: Schema.String,
  changedPaths: Schema.Array(Schema.String),
  status: Schema.Literals(["reported", "verified"]),
  reportedReceipt: Schema.optional(Schema.String),
  checks: Schema.Array(DocsCheckResultSchema),
});
export type DocsWorkReceipt = typeof DocsWorkReceiptSchema.Type;

export const CommandReceiptSchema = Schema.Struct({
  format: Schema.Literal("niceeval.docs-command-receipt/v1"),
  command: NonEmptyTrimmedString,
  status: Schema.Literal("completed"),
  changedPaths: Schema.Array(Schema.String),
  summary: Schema.String,
});
export type CommandReceipt = typeof CommandReceiptSchema.Type;

export const DocsFinalizeReceiptSchema = Schema.Struct({
  format: Schema.Literal("niceeval.docs-work-finalize/v1"),
  runId: NonEmptyTrimmedString,
  status: Schema.Literal("finalized"),
  receipts: Schema.Array(Schema.String),
  checks: Schema.Array(DocsCheckResultSchema),
});
export type DocsFinalizeReceipt = typeof DocsFinalizeReceiptSchema.Type;

export type TermsReceipt =
  | { readonly command: "list"; readonly terms: readonly (BannedTerm & { readonly scope: TermScope })[] }
  | { readonly command: "add" | "remove"; readonly term: string; readonly dryRun: boolean; readonly document: unknown }
  | { readonly command: "check"; readonly lint: CommandReceipt };

export type DocsReceipt =
  | TermsReceipt
  | CommandReceipt
  | DocsWorkRun
  | DocsWorkShowReceipt
  | DocsWorkReceipt
  | DocsFinalizeReceipt;
