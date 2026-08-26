import { Data, Schema } from "effect";

export const PREVIEW_REPOSITORY = "https://github.com/NiceEval/NiceEval-Preview.git";
export const PREVIEW_COMMIT = "baaeada6ab27a709a7142e07cfc532bc82ec594f";
export const NETLIFY_SITE_ID = "af2b96d9-1119-4686-a238-d0ea14240bcd";
export const NICEEVAL_REPOSITORY_URL = "https://github.com/NiceEval/NiceEval";

const Sha256Schema = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{64}$/u));
const GitCommitSchema = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{40}$/u));
const NetlifyDeployUrlSchema = Schema.String.pipe(Schema.pattern(/^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app\/?$/u));
const NetlifyPrimeUrlSchema = Schema.String.pipe(Schema.pattern(/^https:\/\/[a-z0-9-]+\.netlify\.app\/?$/u));
const PositiveByteLengthSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
const StaticPathSchema = Schema.String.pipe(Schema.filter((path) => {
  const segments = path.split("/");
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}, { message: () => "must be a safe relative static-file path" }));

export const PreviewFileSchema = Schema.Struct({
  path: StaticPathSchema,
  byteLength: PositiveByteLengthSchema,
  sha256: Sha256Schema,
});

export const PreviewPlatformSchema = Schema.Union(
  Schema.Struct({ mode: Schema.Literal("local") }),
  Schema.Struct({
    mode: Schema.Literal("netlify"),
    kind: Schema.Literal("production"),
    siteId: Schema.Literal(NETLIFY_SITE_ID),
    repositoryUrl: Schema.Literal(NICEEVAL_REPOSITORY_URL),
    context: Schema.Literal("production"),
    branch: Schema.Literal("main"),
    commitRef: GitCommitSchema,
    deployId: Schema.String.pipe(Schema.pattern(/^[0-9a-f]{24}$/u)),
    deployUrl: NetlifyDeployUrlSchema,
    deployPrimeUrl: NetlifyPrimeUrlSchema,
  }),
  Schema.Struct({
    mode: Schema.Literal("netlify"),
    kind: Schema.Literal("pull-request"),
    siteId: Schema.Literal(NETLIFY_SITE_ID),
    repositoryUrl: Schema.Literal(NICEEVAL_REPOSITORY_URL),
    context: Schema.Literal("deploy-preview"),
    branch: Schema.NonEmptyTrimmedString,
    reviewId: Schema.String.pipe(Schema.pattern(/^[1-9][0-9]*$/u)),
    commitRef: GitCommitSchema,
    deployId: Schema.String.pipe(Schema.pattern(/^[0-9a-f]{24}$/u)),
    deployUrl: NetlifyDeployUrlSchema,
    deployPrimeUrl: NetlifyPrimeUrlSchema,
  }),
);

export const PreviewBuildReceiptSchema = Schema.Struct({
  format: Schema.Literal("niceeval.preview-build/v1"),
  platform: PreviewPlatformSchema,
  candidate: Schema.Struct({
    gitCommit: GitCommitSchema,
    packedArtifactSha256: Sha256Schema,
    installedRuntimeClosureSha256: Sha256Schema,
  }),
  orchestrator: Schema.Struct({
    repository: Schema.Literal(PREVIEW_REPOSITORY),
    commit: Schema.Literal(PREVIEW_COMMIT),
  }),
  files: Schema.Array(PreviewFileSchema).pipe(Schema.filter((files) =>
    files.every((file, index) => index === 0 || (files[index - 1]?.path ?? "") < file.path),
  { message: () => "manifest paths must be strictly sorted and unique" })),
  closureSha256: Sha256Schema,
});

export const PreviewAcceptanceInputSchema = Schema.Struct({
  buildReceipt: PreviewBuildReceiptSchema,
  deploy: Schema.Struct({
    state: Schema.String,
    id: Schema.String,
    siteId: Schema.String,
    reviewId: Schema.optional(Schema.String),
    commitRef: Schema.String,
    context: Schema.String,
    immutableUrl: NetlifyDeployUrlSchema,
    deployUrl: NetlifyDeployUrlSchema,
    deployPrimeUrl: NetlifyPrimeUrlSchema,
    functions: Schema.Array(Schema.Unknown),
    edgeFunctions: Schema.Array(Schema.Unknown),
  }),
  github: Schema.Struct({
    currentHead: GitCommitSchema,
    netlifyCheck: Schema.Struct({
      appSlug: Schema.Literal("netlify"),
      name: Schema.NonEmptyTrimmedString,
      headSha: GitCommitSchema,
      status: Schema.String,
      conclusion: Schema.String,
    }),
  }),
});

export const PreviewAcceptanceReceiptSchema = Schema.Struct({
  format: Schema.Literal("niceeval.preview-acceptance/v1"),
  buildReceiptClosureSha256: Sha256Schema,
  immutableUrl: NetlifyDeployUrlSchema,
  deployId: Schema.String.pipe(Schema.pattern(/^[0-9a-f]{24}$/u)),
  siteId: Schema.Literal(NETLIFY_SITE_ID),
  commitRef: GitCommitSchema,
  context: Schema.Literal("production", "deploy-preview"),
  verifiedFiles: Schema.Array(PreviewFileSchema),
  verifiedClosureSha256: Sha256Schema,
  remoteClosureClaim: Schema.Literal("manifest-files-only"),
});

export type PreviewFile = typeof PreviewFileSchema.Type;
export type PreviewPlatform = typeof PreviewPlatformSchema.Type;
export type PreviewBuildReceipt = typeof PreviewBuildReceiptSchema.Type;
export type PreviewAcceptanceInput = typeof PreviewAcceptanceInputSchema.Type;
export type PreviewAcceptanceReceipt = typeof PreviewAcceptanceReceiptSchema.Type;

export class PreviewInputError extends Data.TaggedError("PreviewInputError")<{
  readonly message: string;
}> {}

export class PreviewEnvironmentError extends Data.TaggedError("PreviewEnvironmentError")<{
  readonly field: string;
  readonly message: string;
}> {}

export class PreviewIoError extends Data.TaggedError("PreviewIoError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

export class PreviewCommandError extends Data.TaggedError("PreviewCommandError")<{
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode?: number;
  readonly message: string;
}> {}

export class PreviewVerificationError extends Data.TaggedError("PreviewVerificationError")<{
  readonly subject: string;
  readonly message: string;
}> {}

export class PreviewHttpError extends Data.TaggedError("PreviewHttpError")<{
  readonly url: string;
  readonly message: string;
}> {}

export type PreviewError =
  | PreviewInputError
  | PreviewEnvironmentError
  | PreviewIoError
  | PreviewCommandError
  | PreviewVerificationError
  | PreviewHttpError;

export function renderPreviewError(error: PreviewError): string {
  switch (error._tag) {
    case "PreviewInputError": return `${error._tag}: ${error.message}`;
    case "PreviewEnvironmentError": return `${error._tag} (${error.field}): ${error.message}`;
    case "PreviewIoError": return `${error._tag} (${error.operation} ${error.path}): ${error.message}`;
    case "PreviewCommandError": return `${error._tag} (${error.command} ${error.args.join(" ")} in ${error.cwd}): ${error.message}`;
    case "PreviewVerificationError": return `${error._tag} (${error.subject}): ${error.message}`;
    case "PreviewHttpError": return `${error._tag} (${error.url}): ${error.message}`;
  }
}
