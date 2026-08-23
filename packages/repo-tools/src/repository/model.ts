import { Data, Schema } from "effect";

export const RepositoryCommandInputSchema = Schema.Union(
  Schema.Struct({ operation: Schema.Literal("check") }),
  Schema.Struct({ operation: Schema.Literal("setup"), dryRun: Schema.Boolean }),
);

export const HostRequirementReceiptSchema = Schema.Struct({
  tool: Schema.Literal("node", "pnpm", "git"),
  expected: Schema.String,
  actual: Schema.String,
  ok: Schema.Boolean,
});

export const RepositoryReceiptSchema = Schema.Struct({
  domain: Schema.Literal("repository"),
  operation: Schema.Literal("check", "setup"),
  status: Schema.Literal("checked", "configured", "skipped"),
  dryRun: Schema.Boolean,
  ok: Schema.Boolean,
  repositoryRoot: Schema.String,
  hooks: Schema.Union(
    Schema.Struct({
      status: Schema.Literal("checked"),
      expected: Schema.String,
      current: Schema.optional(Schema.String),
      directoryExists: Schema.Boolean,
      configured: Schema.Boolean,
    }),
    Schema.Struct({
      status: Schema.Literal("skipped"),
      reason: Schema.Literal("not-a-git-checkout"),
    }),
  ),
  host: Schema.Array(HostRequirementReceiptSchema),
  actions: Schema.Array(Schema.String),
  problems: Schema.Array(Schema.String),
});

export type RepositoryCommandInput = typeof RepositoryCommandInputSchema.Type;
export type HostRequirementReceipt = typeof HostRequirementReceiptSchema.Type;
export type RepositoryReceipt = typeof RepositoryReceiptSchema.Type;

export class RepositoryInputError extends Data.TaggedError("RepositoryInputError")<{
  readonly message: string;
}> {}

export class RepositoryManifestError extends Data.TaggedError("RepositoryManifestError")<{
  readonly operation: "read" | "parse" | "decode";
  readonly path: string;
  readonly message: string;
}> {}

export class RepositoryCommandError extends Data.TaggedError("RepositoryCommandError")<{
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode?: number;
  readonly message: string;
}> {}

export class RepositoryFileError extends Data.TaggedError("RepositoryFileError")<{
  readonly path: string;
  readonly message: string;
}> {}

export class RepositoryPrerequisiteError extends Data.TaggedError("RepositoryPrerequisiteError")<{
  readonly receipt: RepositoryReceipt;
}> {}

export type RepositoryError =
  | RepositoryInputError
  | RepositoryManifestError
  | RepositoryCommandError
  | RepositoryFileError
  | RepositoryPrerequisiteError;
