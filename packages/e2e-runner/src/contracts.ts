// Shared decoding contracts for the E2E runner.
//
// This module is intentionally the one Schema owner for the runner migration.
// Consumers opt into it as they migrate; it does not alter their current paths.

import { Data, Result, Schema } from "effect";

export const OwnDecodeOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

export class ContractDecodeError extends Data.TaggedError("ContractDecodeError")<{
  readonly schema: string;
  readonly issue: Schema.SchemaError;
}> {}

export const decodeOwned = <S extends Schema.ConstraintDecoder<unknown, never>>(schema: S, name: string) =>
  (input: unknown): Result.Result<S["Type"], ContractDecodeError> =>
    Result.mapError(
      Schema.decodeUnknownResult(schema, OwnDecodeOptions)(input),
      (issue) => new ContractDecodeError({ schema: name, issue }),
    );

/** Third-party documents are decoded only as the projection the runner consumes. */
export const decodeExternal = <S extends Schema.ConstraintDecoder<unknown, never>>(schema: S, name: string) =>
  (input: unknown): Result.Result<S["Type"], ContractDecodeError> =>
    Result.mapError(
      Schema.decodeUnknownResult(schema)(input),
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

export const LANES = ["pr", "main", "nightly", "release"] as const;
export const AREAS = [
  "eval",
  "cli",
  "inspection",
  "insight",
  "record",
  "package",
  "runner",
  "adapter",
  "sandbox",
  "lifecycle",
] as const;
export const PLATFORMS = ["linux", "darwin"] as const;
export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export const HOST_CAPABILITIES = ["linux-loop-project-quota"] as const;
export const HARNESS_ASSETS = ["docker-profile-host-scripts"] as const;
export const MANIFEST_SCHEMA_VERSION = 3 as const;
export const MANIFEST_SCHEMA_VERSIONS = [MANIFEST_SCHEMA_VERSION] as const;

export const LaneSchema = Schema.Literals(LANES);
export const AreaSchema = Schema.Literals(AREAS);
export const PlatformSchema = Schema.Literals(PLATFORMS);
export const BrowserSchema = Schema.Literals(BROWSERS);
export const HostCapabilitySchema = Schema.Literals(HOST_CAPABILITIES);
export const HarnessAssetSchema = Schema.Literals(HARNESS_ASSETS);
export const PlanModeSchema = Schema.Literals(["invalid", "affected", "full", "fail-open-full"]);
export const CategorySchema = Schema.Literals(["pass", "regression", "infra", "configuration", "cancelled"]);
export const StageNameSchema = Schema.Literals([
  "preflight",
  "prepare",
  "install",
  "injection",
  "browser",
  "test",
  "collect",
  "cleanup",
]);

export const RepoIdSchema = Schema.String.check(Schema.makeFilter(isCanonicalPath, { identifier: "E2ERepoId", description: "a canonical contained E2E repo id" }));
export const BatchIdSchema = Schema.String.check(Schema.makeFilter((value) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value), {
    identifier: "E2EBatchId",
    description: "a canonical lowercase batch id",
  }));
export const ArtifactPatternSchema = Schema.String.check(Schema.makeFilter((value) => {
    if (value.endsWith("/**")) return isCanonicalPath(value.slice(0, -3)) && !/[\[\]{}*?]/.test(value.slice(0, -3));
    return value.length > 0 && value === value.trim() && !/[\\/\0:\r\n]/.test(value) && value !== "." && value !== "..";
  }, { identifier: "E2EArtifactPattern", description: "a top-level glob or canonical directory/**" }));
export const PositiveSafeIntegerSchema = Schema.Number.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0, {
    identifier: "PositiveSafeInteger",
    description: "a positive JSON-safe integer",
  }));
const PositiveFiniteNumberSchema = Schema.Number.check(Schema.makeFilter((value) => Number.isFinite(value) && value > 0, {
    identifier: "PositiveFiniteNumber",
    description: "a finite positive number",
  }));
export const Sha256HexSchema = Schema.String.check(Schema.makeFilter((value) => /^[a-f0-9]{64}$/.test(value), { identifier: "Sha256Hex", description: "a lowercase SHA-256 hex digest" }));
export const SriSchema = Schema.String.check(Schema.makeFilter((value) => /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(value), {
    identifier: "SRI",
    description: "a SHA SRI digest",
  }));

const NonEmptyStringSchema = Schema.String.check(Schema.makeFilter(nonEmpty, { identifier: "NonEmptyString" }));
const StringListSchema = Schema.Array(Schema.String);
const UniqueStringListSchema = StringListSchema.check(Schema.makeFilter(unique, { identifier: "UniqueStringList" }));
const NonEmptyUniqueStringListSchema = Schema.NonEmptyArray(NonEmptyStringSchema).check(Schema.makeFilter(unique, { identifier: "NonEmptyUniqueStringList" }));
const NonNegativeSafeIntegerSchema = Schema.Number.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0, {
    identifier: "NonNegativeSafeInteger",
    description: "a non-negative JSON-safe integer",
  }));
const UniqueAreaListSchema = Schema.NonEmptyArray(AreaSchema).check(Schema.makeFilter(unique, { identifier: "UniqueAreas" }));
const UniqueLaneListSchema = Schema.NonEmptyArray(LaneSchema).check(Schema.makeFilter(unique, { identifier: "UniqueLanes" }));
const UniquePlatformListSchema = Schema.Array(PlatformSchema).check(Schema.makeFilter(unique, { identifier: "UniquePlatforms" }));
const UniqueBrowserListSchema = Schema.Array(BrowserSchema).check(Schema.makeFilter(unique, { identifier: "UniqueBrowsers" }));
const UniqueHostCapabilityListSchema = Schema.Array(HostCapabilitySchema).check(Schema.makeFilter(unique, { identifier: "UniqueHostCapabilities" }));
const UniqueHarnessAssetListSchema = Schema.Array(HarnessAssetSchema).check(Schema.makeFilter(unique, { identifier: "UniqueHarnessAssets" }));

export const ExecutorSchema = Schema.Struct({ kind: Schema.Literals(["host"]) });
export const RepoRequiresSchema = Schema.Struct({
  docker: Schema.optional(Schema.Boolean),
  externalNetwork: Schema.optional(Schema.Boolean),
  platforms: Schema.optional(UniquePlatformListSchema),
  runtimes: Schema.optional(UniqueStringListSchema),
  browsers: Schema.optional(UniqueBrowserListSchema),
  hostCapabilities: Schema.optional(UniqueHostCapabilityListSchema),
});
export const RepoHarnessSchema = Schema.Struct({
  testkit: Schema.optional(Schema.Boolean),
  assets: Schema.optional(UniqueHarnessAssetListSchema),
});

/** The target metadata itself: repo identity is deliberately derived by discovery. */
export const ManifestMetadataSchema = Schema.Struct({
  schemaVersion: Schema.Literals(MANIFEST_SCHEMA_VERSIONS),
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
export const ManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literals(MANIFEST_SCHEMA_VERSIONS), batch: BatchIdSchema, areas: UniqueAreaListSchema,
  lanes: UniqueLaneListSchema, executor: ExecutorSchema, command: Schema.NonEmptyArray(NonEmptyStringSchema),
  timeoutMinutes: PositiveFiniteNumberSchema, secrets: UniqueStringListSchema,
  requires: Schema.optional(RepoRequiresSchema), harness: Schema.optional(RepoHarnessSchema),
  artifacts: Schema.Array(ArtifactPatternSchema), id: RepoIdSchema,
});

export const PlanRangeSchema = Schema.Struct({ base: NonEmptyStringSchema, head: NonEmptyStringSchema });
export const PlanEntrySchema = Schema.Struct({
  id: NonEmptyStringSchema,
  repoIds: Schema.NonEmptyArray(RepoIdSchema).check(Schema.makeFilter(unique, { identifier: "UniquePlanRepoIds" })),
  batch: BatchIdSchema,
  dir: Schema.optional(RepoIdSchema),
  dirs: Schema.NonEmptyArray(RepoIdSchema).check(Schema.makeFilter(unique, { identifier: "UniquePlanDirs" })),
  executor: ExecutorSchema,
  capabilities: UniqueAreaListSchema,
  shard: NonEmptyStringSchema,
  requires: Schema.optional(RepoRequiresSchema),
}).check(Schema.makeFilter((entry) => entry.dir === undefined || entry.dirs.includes(entry.dir), { identifier: "PlanEntryDirectoryCoherence" }));
export const PlanDocumentSchema = Schema.Struct({
  mode: Schema.Literals(["affected", "full", "fail-open-full"]),
  reason: NonEmptyStringSchema,
  detail: Schema.optional(Schema.String),
  lane: LaneSchema,
  range: Schema.optional(PlanRangeSchema),
  changedPaths: UniqueStringListSchema,
  projectIds: UniqueStringListSchema,
  cells: Schema.Array(PlanEntrySchema).check(Schema.makeFilter((cells) => unique(cells.map((cell) => cell.id)), { identifier: "UniquePlanCellIds" })),
  graph: Schema.Struct({
    selector: Schema.Literals(["nx show projects --affected --with-target e2e"]),
    nxVersion: NonEmptyStringSchema,
    affectedProjectNames: UniqueStringListSchema,
    selectedE2EProjectNames: UniqueStringListSchema,
    e2eProjectNames: UniqueStringListSchema,
  }),
});
export const InvalidPlanOutputSchema = Schema.Struct({
  mode: Schema.Literals(["invalid"]),
  reason: Schema.Literals(["invalid-plan"]),
  detail: NonEmptyStringSchema,
  cells: Schema.Tuple([]),
  projectIds: Schema.Tuple([]),
  changedPaths: Schema.Tuple([]),
});
/** Minimal plan cell projection consumed by a run command. */
export const PlanRunCellSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  repoIds: Schema.NonEmptyArray(RepoIdSchema).check(Schema.makeFilter(unique, { identifier: "UniquePlanRunCellRepoIds" })),
  batch: BatchIdSchema,
  dirs: Schema.NonEmptyArray(RepoIdSchema).check(Schema.makeFilter(unique, { identifier: "UniquePlanRunCellDirs" })),
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
  exitCode: Schema.NullOr(Schema.Number),
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
  kind: Schema.Literals(["platform", "runtime", "docker", "browser", "secret", "externalNetwork", "hostCapability"]),
  subject: Schema.String,
  ok: Schema.Boolean,
  verification: Schema.optional(Schema.Literals(["checked", "declared-unverified"])),
  failureCategory: Schema.optional(Schema.Literals(["configuration", "infra"])),
  detail: Schema.String,
  command: Schema.optional(Schema.Array(Schema.String)),
  capture: Schema.optional(CommandCaptureSchema),
});
export const StageReceiptSchema = Schema.Struct({
  stage: StageNameSchema,
  ok: Schema.Boolean,
  cancelled: Schema.optional(Schema.Boolean),
  failureCategory: Schema.optional(Schema.Literals(["configuration", "infra"])),
  detail: Schema.optional(Schema.String),
  command: Schema.optional(Schema.Array(Schema.String)),
  capture: Schema.optional(CommandCaptureSchema),
  attempt: Schema.optional(PositiveSafeIntegerSchema),
  invocationId: Schema.optional(NonEmptyStringSchema),
  checks: Schema.optional(Schema.Array(CapabilityCheckSchema)),
  assets: Schema.optional(UniqueHarnessAssetListSchema),
  collected: Schema.optional(Schema.Array(RepoIdSchema)),
  path: Schema.optional(Schema.String),
});
export const SelectionReceiptSchema = Schema.Struct({
  mode: Schema.Literals(["affected", "full", "fail-open-full"]),
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
  sourcePath: Schema.Literals(["packages/testkit"]),
  resolvedPath: NonEmptyStringSchema,
  digest: Sha256HexSchema,
});
export const RepoReceiptSchema = Schema.Struct({
  repoId: RepoIdSchema,
  selection: Schema.optional(SelectionReceiptSchema),
  invocationIds: NonEmptyUniqueStringListSchema,
  testInvocations: NonNegativeSafeIntegerSchema,
  copyId: Schema.optional(NonEmptyStringSchema),
  runLabel: Schema.optional(NonEmptyStringSchema),
  sourceSnapshotDigest: Schema.optional(Sha256HexSchema),
  artifactDir: NonEmptyStringSchema,
  receiptPath: NonEmptyStringSchema,
  stages: Schema.Array(StageReceiptSchema),
  exitCode: Schema.NullOr(Schema.Number),
  category: CategorySchema,
  detail: Schema.String,
  candidate: CandidateIdentitySchema,
  testkit: Schema.optional(TestkitReceiptSchema),
}).check(Schema.makeFilter((receipt) => receipt.testInvocations <= receipt.invocationIds.length, { identifier: "ReceiptInvocationCoherence" }));

export const ScratchDispositionSchema = Schema.Union([Schema.Struct({
    kind: Schema.Literals(["not-created"]),
    ok: Schema.Literals([true]),
    detail: Schema.String,
  }), Schema.Struct({
    kind: Schema.Literals(["removed", "retained"]),
    ok: Schema.Literals([true]),
    path: NonEmptyStringSchema,
    detail: Schema.String,
  }), Schema.Struct({
    kind: Schema.Literals(["remove-failed"]),
    ok: Schema.Literals([false]),
    path: NonEmptyStringSchema,
    detail: Schema.String,
  })]);
export const RunnerTerminalSummarySchema = Schema.Struct({
  category: Schema.Literals(["pass", "infra"]),
  detail: Schema.String,
  scratchDisposition: ScratchDispositionSchema,
}).check(Schema.makeFilter(
    (runner) =>
      runner.category === (runner.scratchDisposition.ok ? "pass" : "infra"),
    { identifier: "RunnerScratchDispositionCoherence" },
  ));
export const RunSummaryResultSchema = Schema.Struct({
  id: RepoIdSchema,
  exitCode: Schema.NullOr(Schema.Number),
  category: CategorySchema,
  detail: Schema.String,
  artifactDir: NonEmptyStringSchema,
  receiptPath: NonEmptyStringSchema,
});
export const RunSummarySchema = Schema.Struct({
  artifactRoot: NonEmptyStringSchema,
  summaryPath: NonEmptyStringSchema,
  results: Schema.Array(RunSummaryResultSchema).check(Schema.makeFilter((results) => unique(results.map((result) => result.id)), {
      identifier: "UniqueRunSummaryRepoIds",
    })),
  passed: NonNegativeSafeIntegerSchema,
  regression: NonNegativeSafeIntegerSchema,
  infra: NonNegativeSafeIntegerSchema,
  configuration: NonNegativeSafeIntegerSchema,
  cancelled: NonNegativeSafeIntegerSchema,
  total: NonNegativeSafeIntegerSchema,
  category: CategorySchema,
  detail: Schema.String,
  runner: RunnerTerminalSummarySchema,
  selection: Schema.optional(SelectionReceiptSchema),
}).check(Schema.makeFilter(
    (summary) =>
      summary.total === summary.results.length &&
      summary.passed === summary.results.filter((result) => result.category === "pass").length &&
      summary.regression === summary.results.filter((result) => result.category === "regression").length &&
      summary.infra === summary.results.filter((result) => result.category === "infra").length &&
      summary.configuration === summary.results.filter((result) => result.category === "configuration").length &&
      summary.cancelled === summary.results.filter((result) => result.category === "cancelled").length,
    { identifier: "RunSummaryCountCoherence" },
  ));

// Third-party/foreign JSON projections: additional fields are expressly allowed.
const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
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
  sourcePath: Schema.Literals(["packages/testkit"]),
  name: Schema.Literals(["@niceeval/testkit"]),
  version: NonEmptyStringSchema,
  digest: Sha256HexSchema,
});
export const PnpmLockSchema = Schema.Struct({
  lockfileVersion: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
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
    nodes: Schema.Record(Schema.String, NxProjectSchema),
    dependencies: Schema.Record(Schema.String, Schema.Array(Schema.Struct({ source: Schema.String, target: Schema.String }))),
  }),
});
export const CandidatePackOwnerSchema = Schema.Struct({
  token: NonEmptyStringSchema,
  pid: PositiveSafeIntegerSchema,
  host: NonEmptyStringSchema,
  createdAtMs: Schema.Number,
  heartbeatAtMs: Schema.Number,
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

export type Lane = (typeof LaneSchema)["Type"];
export type Area = (typeof AreaSchema)["Type"];
export type Platform = (typeof PlatformSchema)["Type"];
export type Browser = (typeof BrowserSchema)["Type"];
export type HostCapability = (typeof HostCapabilitySchema)["Type"];
export type HarnessAsset = (typeof HarnessAssetSchema)["Type"];
export type PlanMode = (typeof PlanModeSchema)["Type"];
export type Category = (typeof CategorySchema)["Type"];
export type StageName = (typeof StageNameSchema)["Type"];
export type RepoId = (typeof RepoIdSchema)["Type"];
export type BatchId = (typeof BatchIdSchema)["Type"];
export type ArtifactPattern = (typeof ArtifactPatternSchema)["Type"];
export type PositiveSafeInteger = (typeof PositiveSafeIntegerSchema)["Type"];
export type Sha256Hex = (typeof Sha256HexSchema)["Type"];
export type Sri = (typeof SriSchema)["Type"];
export type ManifestMetadata = (typeof ManifestMetadataSchema)["Type"];
export type Manifest = (typeof ManifestSchema)["Type"];
export type PlanRange = (typeof PlanRangeSchema)["Type"];
export type PlanEntry = (typeof PlanEntrySchema)["Type"];
export type PlanDocument = (typeof PlanDocumentSchema)["Type"];
export type InvalidPlanOutput = (typeof InvalidPlanOutputSchema)["Type"];
export type PlanRunCell = (typeof PlanRunCellSchema)["Type"];
export type SelectionReceipt = (typeof SelectionReceiptSchema)["Type"];
export type CommandCapture = (typeof CommandCaptureSchema)["Type"];
export type CapabilityCheck = (typeof CapabilityCheckSchema)["Type"];
export type StageReceipt = (typeof StageReceiptSchema)["Type"];
export type CandidateIdentity = (typeof CandidateIdentitySchema)["Type"];
export type TestkitReceipt = (typeof TestkitReceiptSchema)["Type"];
export type RepoReceipt = (typeof RepoReceiptSchema)["Type"];
export type ScratchDisposition = (typeof ScratchDispositionSchema)["Type"];
export type RunnerTerminalSummary = (typeof RunnerTerminalSummarySchema)["Type"];
export type RunSummaryResult = (typeof RunSummaryResultSchema)["Type"];
export type RunSummary = (typeof RunSummarySchema)["Type"];
export type PackageJson = (typeof PackageJsonSchema)["Type"];
export type TestkitPackage = (typeof TestkitPackageSchema)["Type"];
export type PnpmLock = (typeof PnpmLockSchema)["Type"];
export type NxProject = (typeof NxProjectSchema)["Type"];
export type NxGraph = (typeof NxGraphSchema)["Type"];
export type CandidatePackOwner = (typeof CandidatePackOwnerSchema)["Type"];
export type TarPackageMetadata = (typeof TarPackageMetadataSchema)["Type"];
export type ReleaseReceiptProjection = (typeof ReleaseReceiptProjectionSchema)["Type"];

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
export const decodeRepoReceipt = decodeOwned(RepoReceiptSchema, "RepoReceipt");
export const decodeRunSummary = decodeOwned(RunSummarySchema, "RunSummary");

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
