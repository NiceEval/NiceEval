// Shared decoding contracts for the E2E runner.
//
// This module is intentionally the one Schema owner for the runner migration.
// Consumers opt into it as they migrate; it does not alter their current paths.

import { Data, Either, ParseResult, Schema } from "effect";

export const OwnDecodeOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

export class ContractDecodeError extends Data.TaggedError("ContractDecodeError")<{
  readonly schema: string;
  readonly issue: ParseResult.ParseError;
}> {}

export const decodeOwned = <S extends Schema.Schema.AnyNoContext>(schema: S, name: string) =>
  (input: unknown): Either.Either<Schema.Schema.Type<S>, ContractDecodeError> =>
    Either.mapLeft(
      Schema.decodeUnknownEither(schema, OwnDecodeOptions)(input),
      (issue) => new ContractDecodeError({ schema: name, issue }),
    );

/** Third-party documents are decoded only as the projection the runner consumes. */
export const decodeExternal = <S extends Schema.Schema.AnyNoContext>(schema: S, name: string) =>
  (input: unknown): Either.Either<Schema.Schema.Type<S>, ContractDecodeError> =>
    Either.mapLeft(
      Schema.decodeUnknownEither(schema)(input),
      (issue) => new ContractDecodeError({ schema: name, issue }),
    );

const nonEmpty = (value: string): boolean => value.length > 0;
const unique = (values: ReadonlyArray<string>): boolean => new Set(values).size === values.length;
const isCanonicalPath = (value: string): boolean =>
  value.length > 0 &&
  value === value.trim() &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  !value.includes(":") &&
  !/[\r\n]/.test(value) &&
  !value.startsWith("/") &&
  value !== "." &&
  value !== ".." &&
  !value.startsWith("../") &&
  !value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..");

export const LaneSchema = Schema.Literal("pr", "main", "nightly", "release");
export const AreaSchema = Schema.Literal(
  "eval",
  "cli",
  "report",
  "record",
  "package",
  "runner",
  "adapter",
  "sandbox",
  "lifecycle",
);
export const PlatformSchema = Schema.Literal("linux", "darwin");
export const BrowserSchema = Schema.Literal("chromium", "firefox", "webkit");
export const PlanModeSchema = Schema.Literal("invalid", "affected", "full", "fail-open-full");
export const CategorySchema = Schema.Literal("pass", "regression", "infra", "configuration", "cancelled");
export const StageNameSchema = Schema.Literal(
  "preflight",
  "prepare",
  "install",
  "injection",
  "browser",
  "test",
  "collect",
  "cleanup",
);

export const RepoIdSchema = Schema.String.pipe(
  Schema.filter(isCanonicalPath, { identifier: "E2ERepoId", description: "a canonical contained E2E repo id" }),
);
export const BatchIdSchema = Schema.String.pipe(
  Schema.filter((value) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value), {
    identifier: "E2EBatchId",
    description: "a canonical lowercase batch id",
  }),
);
export const ArtifactPatternSchema = Schema.String.pipe(
  Schema.filter((value) => {
    if (value.endsWith("/**")) return isCanonicalPath(value.slice(0, -3)) && !/[\[\]{}*?]/.test(value.slice(0, -3));
    return value.length > 0 && value === value.trim() && !/[\\/\0:\r\n]/.test(value) && value !== "." && value !== "..";
  }, { identifier: "E2EArtifactPattern", description: "a top-level glob or canonical directory/**" }),
);
export const PositiveSafeIntegerSchema = Schema.JsonNumber.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value > 0, {
    identifier: "PositiveSafeInteger",
    description: "a positive JSON-safe integer",
  }),
);
const PositiveFiniteNumberSchema = Schema.Number.pipe(
  Schema.filter((value) => Number.isFinite(value) && value > 0, {
    identifier: "PositiveFiniteNumber",
    description: "a finite positive number",
  }),
);
export const Sha256HexSchema = Schema.String.pipe(
  Schema.filter((value) => /^[a-f0-9]{64}$/.test(value), { identifier: "Sha256Hex", description: "a lowercase SHA-256 hex digest" }),
);
export const SriSchema = Schema.String.pipe(
  Schema.filter((value) => /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(value), {
    identifier: "SRI",
    description: "a SHA SRI digest",
  }),
);

const NonEmptyStringSchema = Schema.String.pipe(Schema.filter(nonEmpty, { identifier: "NonEmptyString" }));
const StringListSchema = Schema.Array(Schema.String);
const UniqueStringListSchema = StringListSchema.pipe(Schema.filter(unique, { identifier: "UniqueStringList" }));
const NonEmptyUniqueStringListSchema = Schema.NonEmptyArray(NonEmptyStringSchema).pipe(
  Schema.filter(unique, { identifier: "NonEmptyUniqueStringList" }),
);
const UniqueAreaListSchema = Schema.NonEmptyArray(AreaSchema).pipe(Schema.filter(unique, { identifier: "UniqueAreas" }));
const UniqueLaneListSchema = Schema.NonEmptyArray(LaneSchema).pipe(Schema.filter(unique, { identifier: "UniqueLanes" }));
const UniquePlatformListSchema = Schema.Array(PlatformSchema).pipe(Schema.filter(unique, { identifier: "UniquePlatforms" }));
const UniqueBrowserListSchema = Schema.Array(BrowserSchema).pipe(Schema.filter(unique, { identifier: "UniqueBrowsers" }));

export const ExecutorSchema = Schema.Struct({ kind: Schema.Literal("host") });
export const RepoRequiresSchema = Schema.Struct({
  docker: Schema.optional(Schema.Boolean),
  externalNetwork: Schema.optional(Schema.Boolean),
  platforms: Schema.optional(UniquePlatformListSchema),
  runtimes: Schema.optional(UniqueStringListSchema),
  browsers: Schema.optional(UniqueBrowserListSchema),
});
export const RepoHarnessSchema = Schema.Struct({ testkit: Schema.optional(Schema.Boolean) });

/** The target metadata itself: repo identity is deliberately derived by discovery. */
export const ManifestMetadataSchema = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  batch: BatchIdSchema,
  areas: UniqueAreaListSchema,
  lanes: UniqueLaneListSchema,
  executor: ExecutorSchema,
  command: Schema.NonEmptyArray(NonEmptyStringSchema),
  timeoutMinutes: PositiveFiniteNumberSchema,
  secrets: UniqueStringListSchema,
  requires: Schema.optional(RepoRequiresSchema),
  harness: Schema.optional(RepoHarnessSchema),
  artifacts: Schema.Array(ArtifactPatternSchema),
});
export const ManifestSchema = Schema.extend(
  ManifestMetadataSchema,
  Schema.Struct({ id: RepoIdSchema }),
);

export const PlanRangeSchema = Schema.Struct({ base: NonEmptyStringSchema, head: NonEmptyStringSchema });
export const PlanEntrySchema = Schema.Struct({
  id: NonEmptyStringSchema,
  repoIds: Schema.NonEmptyArray(RepoIdSchema).pipe(Schema.filter(unique, { identifier: "UniquePlanRepoIds" })),
  batch: BatchIdSchema,
  dir: Schema.optional(RepoIdSchema),
  dirs: Schema.NonEmptyArray(RepoIdSchema).pipe(Schema.filter(unique, { identifier: "UniquePlanDirs" })),
  executor: ExecutorSchema,
  capabilities: UniqueAreaListSchema,
  shard: NonEmptyStringSchema,
  requires: Schema.optional(RepoRequiresSchema),
}).pipe(
  Schema.filter((entry) => entry.dir === undefined || entry.dirs.includes(entry.dir), { identifier: "PlanEntryDirectoryCoherence" }),
);
export const PlanDocumentSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  mode: Schema.Literal("affected", "full", "fail-open-full"),
  reason: NonEmptyStringSchema,
  detail: Schema.optional(Schema.String),
  lane: LaneSchema,
  range: Schema.optional(PlanRangeSchema),
  changedPaths: UniqueStringListSchema,
  projectIds: UniqueStringListSchema,
  cells: Schema.Array(PlanEntrySchema).pipe(
    Schema.filter((cells) => unique(cells.map((cell) => cell.id)), { identifier: "UniquePlanCellIds" }),
  ),
  graph: Schema.Struct({
    selector: Schema.Literal("nx show projects --affected --with-target e2e"),
    nxVersion: NonEmptyStringSchema,
    affectedProjectNames: UniqueStringListSchema,
    selectedE2EProjectNames: UniqueStringListSchema,
    e2eProjectNames: UniqueStringListSchema,
  }),
});
export const InvalidPlanOutputSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  mode: Schema.Literal("invalid"),
  reason: Schema.Literal("invalid-plan"),
  detail: NonEmptyStringSchema,
  cells: Schema.Tuple(),
  projectIds: Schema.Tuple(),
  changedPaths: Schema.Tuple(),
});
/** Minimal plan cell projection consumed by a run command. */
export const PlanRunCellSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  repoIds: Schema.NonEmptyArray(RepoIdSchema).pipe(Schema.filter(unique, { identifier: "UniquePlanRunCellRepoIds" })),
  batch: BatchIdSchema,
  dirs: Schema.NonEmptyArray(RepoIdSchema).pipe(Schema.filter(unique, { identifier: "UniquePlanRunCellDirs" })),
  executor: ExecutorSchema,
  requires: Schema.optional(RepoRequiresSchema),
});

const OwnedProcessGroupCleanupSchema = Schema.Struct({
  owned: Schema.Boolean,
  checked: Schema.Boolean,
  aliveAfterLeaderClose: Schema.NullOr(Schema.Boolean),
  groupId: Schema.optional(PositiveSafeIntegerSchema),
  signalsSent: StringListSchema,
  gone: Schema.NullOr(Schema.Boolean),
  detail: Schema.String,
});
export const CommandCaptureSchema = Schema.Struct({
  exitCode: Schema.NullOr(Schema.JsonNumber),
  signal: Schema.NullOr(Schema.String),
  timedOut: Schema.Boolean,
  cancelled: Schema.Boolean,
  stdout: Schema.String,
  stderr: Schema.String,
  error: Schema.optional(Schema.String),
  processGroupOwned: Schema.Boolean,
  groupCleanup: OwnedProcessGroupCleanupSchema,
});
export const CapabilityCheckSchema = Schema.Struct({
  kind: Schema.Literal("platform", "runtime", "docker", "browser", "secret", "externalNetwork"),
  subject: Schema.String,
  ok: Schema.Boolean,
  verification: Schema.optional(Schema.Literal("checked", "declared-unverified")),
  failureCategory: Schema.optional(Schema.Literal("configuration", "infra")),
  detail: Schema.String,
  command: Schema.optional(Schema.Array(Schema.String)),
  capture: Schema.optional(CommandCaptureSchema),
});
export const StageReceiptSchema = Schema.Struct({
  stage: StageNameSchema,
  ok: Schema.Boolean,
  cancelled: Schema.optional(Schema.Boolean),
  failureCategory: Schema.optional(Schema.Literal("configuration", "infra")),
  detail: Schema.optional(Schema.String),
  command: Schema.optional(Schema.Array(Schema.String)),
  capture: Schema.optional(CommandCaptureSchema),
  attempt: Schema.optional(PositiveSafeIntegerSchema),
  invocationId: Schema.optional(NonEmptyStringSchema),
  checks: Schema.optional(Schema.Array(CapabilityCheckSchema)),
  collected: Schema.optional(Schema.Array(RepoIdSchema)),
  path: Schema.optional(Schema.String),
});
export const SelectionReceiptSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  mode: Schema.Literal("affected", "full", "fail-open-full"),
  reason: NonEmptyStringSchema,
  lane: LaneSchema,
  cellId: NonEmptyStringSchema,
  range: Schema.optional(PlanRangeSchema),
});
export const CandidateIdentitySchema = Schema.Struct({
  sha256: Sha256HexSchema,
  integrity: SriSchema,
  artifactPath: Schema.optional(RepoIdSchema),
  reproduce: NonEmptyStringSchema,
  exactReplay: Schema.Boolean,
});
export const TestkitReceiptSchema = Schema.Struct({
  version: NonEmptyStringSchema,
  sourcePath: Schema.Literal("packages/testkit"),
  resolvedPath: NonEmptyStringSchema,
  digest: Sha256HexSchema,
});
export const RepoReceiptV1Schema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  repoId: RepoIdSchema,
  selection: Schema.optional(SelectionReceiptSchema),
  invocationIds: NonEmptyUniqueStringListSchema,
  testInvocations: Schema.JsonNumber.pipe(Schema.filter((value) => Number.isSafeInteger(value) && value >= 0, { identifier: "NonNegativeSafeInteger" })),
  copyId: Schema.optional(NonEmptyStringSchema),
  runLabel: Schema.optional(NonEmptyStringSchema),
  sourceSnapshotDigest: Schema.optional(Sha256HexSchema),
  artifactDir: NonEmptyStringSchema,
  receiptPath: NonEmptyStringSchema,
  stages: Schema.Array(StageReceiptSchema),
  exitCode: Schema.NullOr(Schema.JsonNumber),
  category: CategorySchema,
  detail: Schema.String,
  candidate: CandidateIdentitySchema,
  testkit: Schema.optional(TestkitReceiptSchema),
}).pipe(
  Schema.filter((receipt) => receipt.testInvocations <= receipt.invocationIds.length, { identifier: "ReceiptInvocationCoherence" }),
);

// Third-party/foreign JSON projections: additional fields are expressly allowed.
const UnknownRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });
export const PackageJsonSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  dependencies: Schema.optional(UnknownRecordSchema),
  devDependencies: Schema.optional(UnknownRecordSchema),
  optionalDependencies: Schema.optional(UnknownRecordSchema),
  peerDependencies: Schema.optional(UnknownRecordSchema),
  exports: Schema.optional(Schema.Unknown),
});
export const TestkitPackageSchema = Schema.Struct({
  path: NonEmptyStringSchema,
  sourcePath: Schema.Literal("packages/testkit"),
  name: Schema.Literal("@niceeval/testkit"),
  version: NonEmptyStringSchema,
  digest: Sha256HexSchema,
});
export const PnpmLockSchema = Schema.Struct({
  lockfileVersion: Schema.optional(Schema.Union(Schema.String, Schema.JsonNumber)),
  importers: Schema.optional(UnknownRecordSchema),
  packages: Schema.optional(UnknownRecordSchema),
  snapshots: Schema.optional(UnknownRecordSchema),
});
export const NxProjectSchema = Schema.Struct({
  data: Schema.Struct({
    root: Schema.String,
    tags: Schema.optional(Schema.Array(Schema.String)),
    targets: Schema.optional(UnknownRecordSchema),
  }),
});
export const NxGraphSchema = Schema.Struct({
  graph: Schema.Struct({
    nodes: Schema.Record({ key: Schema.String, value: NxProjectSchema }),
    dependencies: Schema.Record({
      key: Schema.String,
      value: Schema.Array(Schema.Struct({ source: Schema.String, target: Schema.String })),
    }),
  }),
});
export const CandidatePackOwnerSchema = Schema.Struct({
  token: NonEmptyStringSchema,
  pid: PositiveSafeIntegerSchema,
  host: NonEmptyStringSchema,
  createdAtMs: Schema.JsonNumber,
  heartbeatAtMs: Schema.JsonNumber,
});
export const TarPackageMetadataSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
});
/** Projection used by release verification; receipt extras remain opaque. */
export const ReleaseReceiptProjectionSchema = Schema.Struct({
  repoId: Schema.optional(RepoIdSchema),
  category: Schema.optional(CategorySchema),
  candidate: Schema.optional(Schema.Struct({
    sha256: Schema.optional(Sha256HexSchema),
    integrity: Schema.optional(SriSchema),
    artifactPath: Schema.optional(RepoIdSchema),
    exactReplay: Schema.optional(Schema.Boolean),
  })),
});

export type Lane = Schema.Schema.Type<typeof LaneSchema>;
export type Area = Schema.Schema.Type<typeof AreaSchema>;
export type Platform = Schema.Schema.Type<typeof PlatformSchema>;
export type Browser = Schema.Schema.Type<typeof BrowserSchema>;
export type PlanMode = Schema.Schema.Type<typeof PlanModeSchema>;
export type Category = Schema.Schema.Type<typeof CategorySchema>;
export type StageName = Schema.Schema.Type<typeof StageNameSchema>;
export type RepoId = Schema.Schema.Type<typeof RepoIdSchema>;
export type BatchId = Schema.Schema.Type<typeof BatchIdSchema>;
export type ArtifactPattern = Schema.Schema.Type<typeof ArtifactPatternSchema>;
export type PositiveSafeInteger = Schema.Schema.Type<typeof PositiveSafeIntegerSchema>;
export type Sha256Hex = Schema.Schema.Type<typeof Sha256HexSchema>;
export type Sri = Schema.Schema.Type<typeof SriSchema>;
export type ManifestMetadata = Schema.Schema.Type<typeof ManifestMetadataSchema>;
export type Manifest = Schema.Schema.Type<typeof ManifestSchema>;
export type PlanRange = Schema.Schema.Type<typeof PlanRangeSchema>;
export type PlanEntry = Schema.Schema.Type<typeof PlanEntrySchema>;
export type PlanDocument = Schema.Schema.Type<typeof PlanDocumentSchema>;
export type InvalidPlanOutput = Schema.Schema.Type<typeof InvalidPlanOutputSchema>;
export type PlanRunCell = Schema.Schema.Type<typeof PlanRunCellSchema>;
export type SelectionReceipt = Schema.Schema.Type<typeof SelectionReceiptSchema>;
export type CommandCapture = Schema.Schema.Type<typeof CommandCaptureSchema>;
export type CapabilityCheck = Schema.Schema.Type<typeof CapabilityCheckSchema>;
export type StageReceipt = Schema.Schema.Type<typeof StageReceiptSchema>;
export type CandidateIdentity = Schema.Schema.Type<typeof CandidateIdentitySchema>;
export type TestkitReceipt = Schema.Schema.Type<typeof TestkitReceiptSchema>;
export type RepoReceiptV1 = Schema.Schema.Type<typeof RepoReceiptV1Schema>;
export type PackageJson = Schema.Schema.Type<typeof PackageJsonSchema>;
export type TestkitPackage = Schema.Schema.Type<typeof TestkitPackageSchema>;
export type PnpmLock = Schema.Schema.Type<typeof PnpmLockSchema>;
export type NxProject = Schema.Schema.Type<typeof NxProjectSchema>;
export type NxGraph = Schema.Schema.Type<typeof NxGraphSchema>;
export type CandidatePackOwner = Schema.Schema.Type<typeof CandidatePackOwnerSchema>;
export type TarPackageMetadata = Schema.Schema.Type<typeof TarPackageMetadataSchema>;
export type ReleaseReceiptProjection = Schema.Schema.Type<typeof ReleaseReceiptProjectionSchema>;

export const decodeManifestMetadata = decodeOwned(ManifestMetadataSchema, "ManifestMetadata");
export const decodeManifest = decodeOwned(ManifestSchema, "Manifest");
export const decodePlanRange = decodeOwned(PlanRangeSchema, "PlanRange");
export const decodePlanEntry = decodeOwned(PlanEntrySchema, "PlanEntry");
export const decodePlanDocument = decodeOwned(PlanDocumentSchema, "PlanDocument");
export const decodeInvalidPlanOutput = decodeOwned(InvalidPlanOutputSchema, "InvalidPlanOutput");
export const decodePlanRunCell = decodeOwned(PlanRunCellSchema, "PlanRunCell");
export const decodeSelectionReceipt = decodeOwned(SelectionReceiptSchema, "SelectionReceipt");
export const decodeCommandCapture = decodeOwned(CommandCaptureSchema, "CommandCapture");
export const decodeCapabilityCheck = decodeOwned(CapabilityCheckSchema, "CapabilityCheck");
export const decodeStageReceipt = decodeOwned(StageReceiptSchema, "StageReceipt");
export const decodeCandidateIdentity = decodeOwned(CandidateIdentitySchema, "CandidateIdentity");
export const decodeTestkitReceipt = decodeOwned(TestkitReceiptSchema, "TestkitReceipt");
export const decodeRepoReceiptV1 = decodeOwned(RepoReceiptV1Schema, "RepoReceiptV1");

export const decodePackageJson = decodeExternal(PackageJsonSchema, "PackageJson");
export const decodeTestkitPackage = decodeExternal(TestkitPackageSchema, "TestkitPackage");
export const decodePnpmLock = decodeExternal(PnpmLockSchema, "PnpmLock");
export const decodeNxProject = decodeExternal(NxProjectSchema, "NxProject");
export const decodeNxGraph = decodeExternal(NxGraphSchema, "NxGraph");
export const decodeCandidatePackOwner = decodeExternal(CandidatePackOwnerSchema, "CandidatePackOwner");
export const decodeTarPackageMetadata = decodeExternal(TarPackageMetadataSchema, "TarPackageMetadata");
export const decodeReleaseReceiptProjection = decodeExternal(
  ReleaseReceiptProjectionSchema,
  "ReleaseReceiptProjection",
);
