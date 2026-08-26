import { Data, Schema } from "effect";

const DependencyMapSchema = Schema.Record({ key: Schema.String, value: Schema.String });

export const DownstreamManifestSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  packageManager: Schema.optional(Schema.String),
  devEngines: Schema.optional(Schema.Struct({
    packageManager: Schema.optional(Schema.Struct({
      name: Schema.String,
      version: Schema.String,
    })),
  })),
  dependencies: Schema.optional(DependencyMapSchema),
  devDependencies: Schema.optional(DependencyMapSchema),
  optionalDependencies: Schema.optional(DependencyMapSchema),
  peerDependencies: Schema.optional(DependencyMapSchema),
});

export const CandidateManifestSchema = Schema.Struct({
  name: Schema.NonEmptyTrimmedString,
  version: Schema.NonEmptyTrimmedString,
});

export const DownstreamCommandInputSchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal("check"),
    project: Schema.NonEmptyTrimmedString,
  }),
  Schema.Struct({
    operation: Schema.Literal("link"),
    project: Schema.NonEmptyTrimmedString,
    dryRun: Schema.Boolean,
  }),
);

export const DownstreamReceiptSchema = Schema.Struct({
  domain: Schema.Literal("link"),
  operation: Schema.Literal("check", "link"),
  dryRun: Schema.Boolean,
  ok: Schema.Boolean,
  candidate: Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    sourceRoot: Schema.String,
    sha256: Schema.optional(Schema.String),
  }),
  project: Schema.Struct({
    name: Schema.String,
    root: Schema.String,
    pnpmVersion: Schema.optional(Schema.String),
    declaresNiceeval: Schema.Boolean,
    nodeModulesInstalled: Schema.Boolean,
    currentNiceevalRoot: Schema.optional(Schema.String),
  }),
  actions: Schema.Array(Schema.String),
  problems: Schema.Array(Schema.String),
});

export type DownstreamManifest = typeof DownstreamManifestSchema.Type;
export type CandidateManifest = typeof CandidateManifestSchema.Type;
export type DownstreamCommandInput = typeof DownstreamCommandInputSchema.Type;
export type DownstreamReceipt = typeof DownstreamReceiptSchema.Type;

export class DownstreamInputError extends Data.TaggedError("DownstreamInputError")<{
  readonly message: string;
}> {}

export class DownstreamPathError extends Data.TaggedError("DownstreamPathError")<{
  readonly path: string;
  readonly message: string;
}> {}

export class DownstreamManifestError extends Data.TaggedError("DownstreamManifestError")<{
  readonly path: string;
  readonly operation: "read" | "parse" | "decode";
  readonly message: string;
}> {}

export class DownstreamCommandError extends Data.TaggedError("DownstreamCommandError")<{
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode?: number;
  readonly message: string;
}> {}

export class DownstreamValidationError extends Data.TaggedError("DownstreamValidationError")<{
  readonly receipt: DownstreamReceipt;
}> {}

export class DownstreamVerificationError extends Data.TaggedError("DownstreamVerificationError")<{
  readonly expected: string;
  readonly actual: string;
}> {}

export type DownstreamError =
  | DownstreamInputError
  | DownstreamPathError
  | DownstreamManifestError
  | DownstreamCommandError
  | DownstreamValidationError
  | DownstreamVerificationError;
