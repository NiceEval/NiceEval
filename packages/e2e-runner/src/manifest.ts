// E2E target metadata validation.
//
// `schemaVersion: 3` belongs to the scenario-registration contract. Runner
// plans have no version field; their one current format lives in contracts.ts.

import { Result, Schema, SchemaIssue } from "effect";

import {
  ArtifactPatternSchema,
  BatchIdSchema,
  RepoIdSchema,
  decodeManifestMetadata,
  type Area,
  type BatchId,
  type Browser,
  type HostCapability,
  type HarnessAsset,
  type Lane,
  type Manifest,
  type ManifestMetadata,
  type Platform,
} from "./contracts.ts";

export const SCHEMA_VERSION = 3 as const;
export const AREAS = ["eval", "cli", "report", "record", "package", "runner", "adapter", "sandbox", "lifecycle"] as const;
export const LANES = ["pr", "main", "nightly", "release"] as const;
export const PLATFORMS = ["linux", "darwin"] as const;
export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export const HOST_CAPABILITIES = ["linux-loop-project-quota"] as const;
export const HARNESS_ASSETS = ["docker-profile-host-scripts"] as const;

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
