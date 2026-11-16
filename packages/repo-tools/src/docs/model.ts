import { Schema } from "effect";

const NonEmptyTrimmedString = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));

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
  format: Schema.Literal("niceeval-docs-work/current"),
  runId: NonEmptyTrimmedString,
  baseCommit: NonEmptyTrimmedString,
  createdAt: NonEmptyTrimmedString,
  items: Schema.Array(NonEmptyTrimmedString),
});
export type DocsWorkRun = typeof DocsWorkRunSchema.Type;

export const DocsWorkShowReceiptSchema = Schema.Struct({
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
  command: NonEmptyTrimmedString,
  status: Schema.Literal("completed"),
  changedPaths: Schema.Array(Schema.String),
  summary: Schema.String,
});
export type CommandReceipt = typeof CommandReceiptSchema.Type;

export const DocsFinalizeReceiptSchema = Schema.Struct({
  runId: NonEmptyTrimmedString,
  status: Schema.Literal("finalized"),
  receipts: Schema.Array(Schema.String),
  checks: Schema.Array(DocsCheckResultSchema),
});
export type DocsFinalizeReceipt = typeof DocsFinalizeReceiptSchema.Type;

export type DocsReceipt = CommandReceipt | DocsWorkRun | DocsWorkShowReceipt | DocsWorkReceipt | DocsFinalizeReceipt;
