import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { userDatabaseHost } from "../user-database/index.ts";
import { userDatabasePaths } from "../user-database/path.ts";
import { sandboxActionStateCovers } from "./action.ts";
import {
  e2bCacheRepositoryFromUserDatabase,
  type E2BCacheRepository,
  type E2BCacheSnapshotCleanup,
} from "./e2b-cache-repository.ts";
import {
  SandboxSetupPrefixCacheCaptureError,
  SandboxSetupPrefixCacheLookupError,
  SandboxSetupPrefixCacheRestoreError,
  SandboxSetupPrefixCacheValidationError,
  type SandboxSetupPrefixCacheCapability,
  type SandboxSetupPrefixCacheCaptureResult,
  type SandboxSetupPrefixCacheEligibility,
  type SandboxSetupPrefixCacheLookupResult,
  type SandboxSetupPrefixCacheOperation,
} from "./backend.ts";

export interface E2BSetupPrefixRootOwnership {
  readonly release: () => Promise<void>;
}

export interface E2BSetupPrefixCacheTarget {
  readonly eligibility: () => SandboxSetupPrefixCacheEligibility;
  readonly captureSnapshot: () => Promise<string>;
  readonly deleteSnapshot: (snapshotId: string) => Promise<boolean>;
  readonly rebaseToSnapshot: (snapshotId: string, signal: AbortSignal) => Promise<{ readonly sandboxId: string }>;
  readonly recoverCleanBase: (signal: AbortSignal) => Promise<{ readonly sandboxId: string }>;
  readonly adoptSetupPrefixRoot: (root: E2BSetupPrefixRootOwnership) => void;
}

const LeaseDurationMs = 15 * 60 * 1_000;
const repository = e2bCacheRepositoryFromUserDatabase(userDatabaseHost.open);

function now(): string {
  return new Date().toISOString();
}

function leaseUntil(): string {
  return new Date(Date.now() + LeaseDurationMs).toISOString();
}

function legacyCachePath(): string {
  return join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
    "niceeval",
    "cache",
    "v2",
    "e2b-setup-prefix.sqlite",
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") return false;
    throw cause;
  }
}

/**
 * The old XDG database has no proven relation to UserDatabase. Never open or
 * migrate it: a stale standalone file and a split-brain pair both fail closed.
 */
async function assertNoLegacyCache(input: SandboxSetupPrefixCacheOperation): Promise<void> {
  const legacyPath = legacyCachePath();
  try {
    const [legacyExists, databaseExists] = await Promise.all([
      exists(legacyPath),
      exists(userDatabasePaths().database),
    ]);
    if (!legacyExists) return;
    const relation = databaseExists
      ? `coexists with ${userDatabasePaths().database}`
      : `exists without ${userDatabasePaths().database}`;
    throw new Error(
      `Legacy E2B setup-prefix cache ${legacyPath} ${relation}. ` +
        "Remove it explicitly before using E2B setup-prefix cache; NiceEval will not read or migrate it.",
    );
  } catch (cause) {
    throw cause instanceof SandboxSetupPrefixCacheValidationError
      ? cause
      : validationFailure(input, cause);
  }
}

function declarationDigest(input: SandboxSetupPrefixCacheOperation): string {
  if (input.manifest.setupPrefixKey.length === 0 || input.manifest.setupManifestDigest !== `sha256:${input.manifest.setupPrefixKey.slice(7)}`) {
    throw new Error("E2B setup-prefix key and manifest digest do not agree");
  }
  return JSON.stringify(input.manifest.declarationMetadata);
}

function replacementScope(input: SandboxSetupPrefixCacheOperation): string {
  const metadata = input.manifest.declarationMetadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error("E2B setup-prefix declaration metadata is not a record");
  }
  const scope = (metadata as { readonly replacementScope?: unknown }).replacementScope;
  if (scope === undefined) throw new Error("E2B setup-prefix declaration has no replacement scope");
  return JSON.stringify(scope);
}

function validate(target: E2BSetupPrefixCacheTarget, input: SandboxSetupPrefixCacheOperation): void {
  const eligibility = target.eligibility();
  if (eligibility._tag === "Unsupported") throw new Error(eligibility.reason);
  if (eligibility.baseImageId !== input.manifest.baseImageId) throw new Error("E2B setup-prefix Base identity changed");
  if (!sandboxActionStateCovers(eligibility.coverage, input.manifest.requiredState)) throw new Error("E2B snapshot does not cover the requested state");
  declarationDigest(input);
}

function validationFailure(input: SandboxSetupPrefixCacheOperation, cause: unknown): SandboxSetupPrefixCacheValidationError {
  return new SandboxSetupPrefixCacheValidationError({
    operation: "validate E2B setup-prefix snapshot",
    reason: cause instanceof Error ? cause.message : String(cause),
    setupPrefixKey: input.manifest.setupPrefixKey,
    cause,
  });
}

function lookupFailure(input: SandboxSetupPrefixCacheOperation, cause: unknown): SandboxSetupPrefixCacheLookupError {
  return new SandboxSetupPrefixCacheLookupError({
    operation: "restore E2B setup-prefix snapshot",
    reason: cause instanceof Error ? cause.message : String(cause),
    setupPrefixKey: input.manifest.setupPrefixKey,
    cause,
  });
}

function captureFailure(input: SandboxSetupPrefixCacheOperation, cause: unknown): SandboxSetupPrefixCacheCaptureError {
  return new SandboxSetupPrefixCacheCaptureError({
    operation: "capture E2B setup-prefix snapshot",
    reason: cause instanceof Error ? cause.message : String(cause),
    setupPrefixKey: input.manifest.setupPrefixKey,
    cause,
  });
}

function database<Result>(effect: Effect.Effect<Result, unknown>): Promise<Result> {
  return Effect.runPromise(effect);
}

/** A deletion is allowed only when this local registry returned the exact ID. */
async function deleteRegisteredSnapshot(target: E2BSetupPrefixCacheTarget, cleanup: E2BCacheSnapshotCleanup): Promise<void> {
  let deleted = false;
  try {
    deleted = await target.deleteSnapshot(cleanup.snapshotId);
  } catch {
    // Keep the registered entry in deleting state for a later reconciliation.
  }
  await database(repository.settleDelete({
    setupPrefixKey: cleanup.setupPrefixKey,
    generation: cleanup.generation,
    deleted,
  }));
}

async function reconcile(target: E2BSetupPrefixCacheTarget, options: {
  readonly replacementScope?: string;
  readonly exceptSetupPrefixKey?: string;
} = {}): Promise<void> {
  const result = await database(repository.reconcile({ now: now(), ...options }));
  for (const cleanup of result.cleanup) await deleteRegisteredSnapshot(target, cleanup);
}

async function releaseRoot(rootId: string, target: E2BSetupPrefixCacheTarget): Promise<void> {
  await database(repository.releaseRoot({ rootId }));
  await reconcile(target);
}

async function clearEntry(target: E2BSetupPrefixCacheTarget, setupPrefixKey: string): Promise<void> {
  const result = await database(repository.clear({ setupPrefixKey, now: now() }));
  if (result.cleanup !== null) await deleteRegisteredSnapshot(target, result.cleanup);
}

async function restore(
  target: E2BSetupPrefixCacheTarget,
  input: SandboxSetupPrefixCacheOperation,
  signal: AbortSignal,
): Promise<SandboxSetupPrefixCacheLookupResult> {
  try {
    await assertNoLegacyCache(input);
    validate(target, input);
  } catch (cause) {
    throw cause instanceof SandboxSetupPrefixCacheValidationError ? cause : validationFailure(input, cause);
  }
  let rootId: string | undefined;
  try {
    const allocatedRootId = randomUUID();
    rootId = allocatedRootId;
    const lookup = await database(repository.lookup({
      setupPrefixKey: input.manifest.setupPrefixKey,
      baseIdentity: input.manifest.baseImageId,
      rootId: allocatedRootId,
      now: now(),
    }));
    if (lookup.entry === null || lookup.root === null) return { _tag: "Miss", setupPrefixKey: input.manifest.setupPrefixKey };
    const snapshotId = lookup.entry.snapshotId;
    if (snapshotId === null) throw new Error("indexed E2B setup-prefix entry has no snapshot identity");
    const rebound = await target.rebaseToSnapshot(snapshotId, signal);
    const settled = await database(repository.settleRoot({ rootId: allocatedRootId, sandboxId: rebound.sandboxId, now: now() }));
    if (!settled.settled) throw new Error("E2B setup-prefix root lease was lost before rebase completed");
    target.adoptSetupPrefixRoot({ release: () => releaseRoot(allocatedRootId, target) });
    rootId = undefined;
    return {
      _tag: "Restored",
      setupPrefixKey: lookup.entry.setupPrefixKey,
      entryId: lookup.entry.setupPrefixKey,
      generation: lookup.entry.generation,
      artifactId: snapshotId,
      sandboxId: rebound.sandboxId,
    };
  } catch (cause) {
    if (rootId !== undefined) {
      await releaseRoot(rootId, target).catch(() => undefined);
      await clearEntry(target, input.manifest.setupPrefixKey).catch(() => undefined);
    }
    throw lookupFailure(input, cause);
  }
}

async function capture(
  target: E2BSetupPrefixCacheTarget,
  input: SandboxSetupPrefixCacheOperation,
  signal: AbortSignal,
): Promise<SandboxSetupPrefixCacheCaptureResult> {
  try {
    await assertNoLegacyCache(input);
    validate(target, input);
  } catch (cause) {
    throw cause instanceof SandboxSetupPrefixCacheValidationError ? cause : validationFailure(input, cause);
  }
  if ((input.knownSensitiveValues ?? []).some((value) => value.length > 0)) {
    return { _tag: "ContinuedUncached", setupPrefixKey: input.manifest.setupPrefixKey, reason: "capture-failed", sandboxId: "e2b-sensitive-state" };
  }
  const leaseId = randomUUID();
  let reservation: { readonly generation: number; readonly leaseId: string } | undefined;
  let snapshotId: string | undefined;
  let published = false;
  try {
    const reserved = await database(repository.reserve({
      setupPrefixKey: input.manifest.setupPrefixKey,
      baseIdentity: input.manifest.baseImageId,
      declarationDigest: declarationDigest(input),
      replacementScope: replacementScope(input),
      leaseId,
      leaseUntil: leaseUntil(),
      now: now(),
    }));
    if (reserved.disposition !== "reserved") {
      return { _tag: "Contended", setupPrefixKey: input.manifest.setupPrefixKey, reason: reserved.disposition };
    }
    reservation = { generation: reserved.generation, leaseId };
    snapshotId = await target.captureSnapshot();
    if (snapshotId.length === 0) throw new Error("E2B returned an empty snapshot identity");
    signal.throwIfAborted();
    const settled = await database(repository.settle({
      setupPrefixKey: input.manifest.setupPrefixKey,
      generation: reserved.generation,
      leaseId,
      snapshotId,
      now: now(),
    }));
    if (!settled.settled) throw new Error("E2B setup-prefix publication lost its lease fence");
    published = true;
    await reconcile(target, { replacementScope: replacementScope(input), exceptSetupPrefixKey: input.manifest.setupPrefixKey }).catch(() => undefined);
    const rebound = await target.rebaseToSnapshot(snapshotId, signal);
    const rootId = randomUUID();
    const adopted = await database(repository.adoptRoot({
      setupPrefixKey: input.manifest.setupPrefixKey,
      generation: reserved.generation,
      snapshotId,
      rootId,
      sandboxId: rebound.sandboxId,
      now: now(),
    }));
    if (!adopted.adopted) throw new Error("E2B setup-prefix snapshot lost its root adoption fence");
    target.adoptSetupPrefixRoot({ release: () => releaseRoot(rootId, target) });
    return {
      _tag: "Captured",
      setupPrefixKey: input.manifest.setupPrefixKey,
      entryId: input.manifest.setupPrefixKey,
      generation: reserved.generation,
      artifactId: snapshotId,
      sandboxId: rebound.sandboxId,
    };
  } catch (cause) {
    if (reservation !== undefined) {
      await database(repository.abort({
        setupPrefixKey: input.manifest.setupPrefixKey,
        generation: reservation.generation,
        leaseId: reservation.leaseId,
      })).catch(() => undefined);
    }
    if (snapshotId !== undefined) {
      if (published) await clearEntry(target, input.manifest.setupPrefixKey).catch(() => undefined);
      else await target.deleteSnapshot(snapshotId).catch(() => undefined);
    }
    throw captureFailure(input, cause);
  }
}

export function makeE2BSetupPrefixCacheCapability(target: E2BSetupPrefixCacheTarget): SandboxSetupPrefixCacheCapability {
  return {
    eligibility: target.eligibility,
    lookupAndRebase: (input) => Effect.tryPromise({
      try: (signal) => restore(target, input, signal),
      catch: (cause) => cause instanceof SandboxSetupPrefixCacheValidationError ? cause : lookupFailure(input, cause),
    }),
    captureAndRebase: (input) => Effect.tryPromise({
      try: (signal) => capture(target, input, signal),
      catch: (cause) => cause instanceof SandboxSetupPrefixCacheValidationError ? cause : captureFailure(input, cause),
    }),
    recoverCleanBase: () => Effect.tryPromise({
      try: async (signal) => {
        await assertNoLegacyCache({
          operationId: "recover-clean-base",
          manifest: {
            baseImageId: "e2b-clean-base",
            setupPrefixKey: "sha256:recover-clean-base",
            setupManifestDigest: "sha256:recover-clean-base",
            requiredState: "all",
            storageSchemaRevision: "niceeval.e2b-setup-prefix-storage/v1",
            artifactFormatRevision: "niceeval.e2b-snapshot/v1",
            changeFrequency: 0,
            declarationMetadata: { replacementScope: "recover-clean-base" },
          },
        });
        const eligibility = target.eligibility();
        if (eligibility._tag === "Unsupported") throw new Error(eligibility.reason);
        return { _tag: "RecoveredCleanBase" as const, baseImageId: eligibility.baseImageId, sandboxId: (await target.recoverCleanBase(signal)).sandboxId };
      },
      catch: (cause) => cause instanceof SandboxSetupPrefixCacheValidationError
        ? cause
        : new SandboxSetupPrefixCacheRestoreError({
            operation: "recover E2B setup-prefix Base",
            reason: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
    }),
  };
}
