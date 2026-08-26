import { Data, Schema } from "effect";

export const TierContractSchema = Schema.Literals(["verbatim", "overlay"]);
const TrimmedNonEmptyString = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));

export const TierPendingSchema = Schema.Struct({
  upstreamTree: TrimmedNonEmptyString,
  needsInstall: Schema.Boolean,
});

export const TierPairSchema = Schema.Struct({
  from: TrimmedNonEmptyString,
  to: TrimmedNonEmptyString,
  contract: TierContractSchema,
  baseTree: TrimmedNonEmptyString,
  pending: Schema.optional(TierPendingSchema),
});

export const TierStateSchema = Schema.Struct({
  pairs: Schema.Array(TierPairSchema),
});

export const ExamplesCommandInputSchema = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("check"),
    name: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    operation: Schema.Literal("sync"),
    name: Schema.optional(TrimmedNonEmptyString),
  }),
]);

export const TierPairReceiptSchema = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  status: Schema.Literals([
    "current",
    "would-sync",
    "synced",
    "pending-conflict",
    "conflict",
    "blocked",
    "invalid",
  ]),
  upstreamTree: Schema.optional(Schema.String),
  tierTree: Schema.optional(Schema.String),
  changed: Schema.Array(Schema.String),
  problems: Schema.Array(Schema.String),
});

export const ExamplesReceiptSchema = Schema.Struct({
  domain: Schema.Literal("examples"),
  operation: Schema.Literals(["check", "sync"]),
  ok: Schema.Boolean,
  pairs: Schema.Array(TierPairReceiptSchema),
});

export type TierPair = typeof TierPairSchema.Type;
export type TierState = typeof TierStateSchema.Type;
export type ExamplesCommandInput = typeof ExamplesCommandInputSchema.Type;
export type TierPairReceipt = typeof TierPairReceiptSchema.Type;
export type ExamplesReceipt = typeof ExamplesReceiptSchema.Type;

export class ExamplesInputError extends Data.TaggedError("ExamplesInputError")<{
  readonly message: string;
}> {}

export class ExamplesStateError extends Data.TaggedError("ExamplesStateError")<{
  readonly operation: "read" | "parse" | "decode" | "write" | "topology";
  readonly path: string;
  readonly message: string;
}> {}

export class ExamplesGitError extends Data.TaggedError("ExamplesGitError")<{
  readonly args: readonly string[];
  readonly message: string;
  readonly exitCode?: number;
}> {}

export class ExamplesProcessError extends Data.TaggedError("ExamplesProcessError")<{
  readonly command: string;
  readonly args: readonly string[];
  readonly message: string;
}> {}

export class ExamplesFileError extends Data.TaggedError("ExamplesFileError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

export class ExamplesDirtyTreeError extends Data.TaggedError("ExamplesDirtyTreeError")<{
  readonly paths: readonly string[];
}> {}

export class ExamplesConflictError extends Data.TaggedError("ExamplesConflictError")<{
  readonly receipt: ExamplesReceipt;
}> {}

export class ExamplesInstallError extends Data.TaggedError("ExamplesInstallError")<{
  readonly directory: string;
  readonly message: string;
}> {}

export type ExamplesError =
  | ExamplesInputError
  | ExamplesStateError
  | ExamplesGitError
  | ExamplesProcessError
  | ExamplesFileError
  | ExamplesDirtyTreeError
  | ExamplesConflictError
  | ExamplesInstallError;
