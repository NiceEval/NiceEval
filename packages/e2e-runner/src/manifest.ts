// E2E target metadata validation.
//
// Registration metadata and runner plans use the current strict contracts.ts shapes.

import { Result, Schema, SchemaIssue } from "effect";

import {
  ArtifactPatternSchema,
  AREAS,
  BatchIdSchema,
  BROWSERS,
  HARNESS_ASSETS,
  HOST_CAPABILITIES,
  LANES,
  PLATFORMS,
  RepoIdSchema,
  decodeManifestMetadata,
  type Manifest,
  type ManifestMetadata,
} from "./contracts.ts";

export { AREAS, BROWSERS, HARNESS_ASSETS, HOST_CAPABILITIES, LANES, PLATFORMS };

export type { Area, BatchId, Browser, HarnessAsset, HostCapability, Lane, Platform } from "./contracts.ts";
export type Executor = ManifestMetadata["executor"];
export type RepoRequires = NonNullable<ManifestMetadata["requires"]>;
export type RepoHarness = NonNullable<ManifestMetadata["harness"]>;
export type E2ERepoManifest = Manifest;
export type ManifestParseResult = Result.Result<ManifestMetadata, import("./contracts.ts").ContractDecodeError>;

const isRepoId = Schema.is(RepoIdSchema);
const isBatchId = Schema.is(BatchIdSchema);
const isArtifactPattern = Schema.is(ArtifactPatternSchema);

/** A scenario id is a canonical, contained artifact-relative path. */
export const isCanonicalRelativePath = (value: string): boolean => isRepoId(value);

/** Stable and directly reusable in matrix, artifact, and diagnostic ids. */
export const isCanonicalBatchId = (value: string): boolean => isBatchId(value);

/** Keeps the legacy diagnostic helper while delegating its grammar to Schema. */
export const artifactPatternError = (value: string): string | undefined =>
  isArtifactPattern(value) ? undefined : "must be a top-level filename glob or canonical dir/**";

/** Strictly decode one targets.e2e.metadata.niceeval document. */
export const parseManifest = (raw: unknown): ManifestParseResult => decodeManifestMetadata(raw);

export const formatManifestError = (source: string, error: import("./contracts.ts").ContractDecodeError): string =>
  `${source}: ${SchemaIssue.makeFormatterDefault()(error.issue.issue)}`;
