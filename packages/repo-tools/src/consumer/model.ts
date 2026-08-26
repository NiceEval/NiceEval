import { Data, Schema } from "effect";

const DependencyMapSchema = Schema.Record(Schema.String, Schema.String);
const TrimmedNonEmptyString = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));

export const ConsumerManifestSchema = Schema.Struct({
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
  name: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
});

export const ConsumerCommandInputSchema = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("check"),
    consumer: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    operation: Schema.Literal("link"),
    consumer: TrimmedNonEmptyString,
    dryRun: Schema.Boolean,
  }),
]);

export const ConsumerReceiptSchema = Schema.Struct({
  domain: Schema.Literal("consumer"),
  operation: Schema.Literals(["check", "link"]),
  dryRun: Schema.Boolean,
  ok: Schema.Boolean,
  candidate: Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    sourceRoot: Schema.String,
    sha256: Schema.optional(Schema.String),
  }),
  consumer: Schema.Struct({
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

export type ConsumerManifest = typeof ConsumerManifestSchema.Type;
export type CandidateManifest = typeof CandidateManifestSchema.Type;
export type ConsumerCommandInput = typeof ConsumerCommandInputSchema.Type;
export type ConsumerReceipt = typeof ConsumerReceiptSchema.Type;

export class ConsumerInputError extends Data.TaggedError("ConsumerInputError")<{
  readonly message: string;
}> {}

export class ConsumerPathError extends Data.TaggedError("ConsumerPathError")<{
  readonly path: string;
  readonly message: string;
}> {}

export class ConsumerManifestError extends Data.TaggedError("ConsumerManifestError")<{
  readonly path: string;
  readonly operation: "read" | "parse" | "decode";
  readonly message: string;
}> {}

export class ConsumerCommandError extends Data.TaggedError("ConsumerCommandError")<{
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode?: number;
  readonly message: string;
}> {}

export class ConsumerValidationError extends Data.TaggedError("ConsumerValidationError")<{
  readonly receipt: ConsumerReceipt;
}> {}

export class ConsumerVerificationError extends Data.TaggedError("ConsumerVerificationError")<{
  readonly expected: string;
  readonly actual: string;
}> {}

export type ConsumerError =
  | ConsumerInputError
  | ConsumerPathError
  | ConsumerManifestError
  | ConsumerCommandError
  | ConsumerValidationError
  | ConsumerVerificationError;
