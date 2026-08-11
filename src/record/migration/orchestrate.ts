import { Effect, Either } from "effect";
import {
  recordAttachmentRegistryFamily,
  resolveRecordAttachmentMigration,
} from "../attachment/runtime.ts";
import type {
  AnyRecordAttachmentFamily,
  RecordAttachmentMigrationResolution,
  RecordAttachmentRegistry,
} from "../attachment/types.ts";
import type { RecordCoreV1 } from "../model/core.ts";
import type { RecordFormatId } from "../model/identifiers.ts";
import type {
  RecordGitError,
  RecordMaintenanceLockError,
} from "../platform/errors.ts";
import type { RecordRoot } from "../platform/root.ts";
import {
  RecordFileSystem,
  RecordGit,
  RecordMaintenanceLock,
  recordPortablePath,
  type RecordBackupState,
} from "../platform/services.ts";
import {
  recordAttachmentMigrationStepFailed,
  recordCoreMigrationStepFailed,
  recordMigrationAuthorizationInvalid,
  recordMigrationConfirmationRequired,
  recordMigrationPlanStale,
  RecordMigrationInterruptedState,
  type RecordCoreMigrationPlanInvalid,
} from "./errors.ts";
import type {
  RecordMigrationAttachmentSource,
  RecordMigrationSource,
  RecordMigrationStorage,
  RecordMigrationStorageError,
} from "./internal.ts";
import {
  makeRecordCoreMigrationPlan,
  recordCoreMigrationPlanResolution,
  type RecordCoreMigrationPlan,
  type RecordCoreMigrationPlanSummary,
} from "./plan.ts";
import {
  RecordMigrationRegistry,
  type RecordCoreMigrationRegistry,
  type RecordMigrationRegistryService,
} from "./registry.ts";

export type RecordMigrationAuthorization =
  | { readonly state: "git-restore-point" }
  | { readonly state: "accept-data-loss" };

export type RecordMigrationAttachmentPlanState =
  | "current"
  | "migrate"
  | "migration-unavailable"
  | "unsupported";

export interface RecordMigrationAttachmentPlanSummary {
  readonly owner: "run" | "attempt";
  readonly name: string;
  readonly schemaId: string;
  readonly state: RecordMigrationAttachmentPlanState;
  readonly reason?: string;
}

export interface RecordMigrationPlanSummary {
  readonly core: RecordCoreMigrationPlanSummary;
  readonly attachments: readonly RecordMigrationAttachmentPlanSummary[];
  readonly backup: RecordBackupState;
  readonly state: "needed" | "not-needed";
}

interface RecordMigrationAttachmentPlanEntry {
  readonly source: RecordMigrationAttachmentSource;
  readonly family: AnyRecordAttachmentFamily | undefined;
  readonly resolution: RecordAttachmentMigrationResolution | undefined;
}

interface RecordMigrationPlanState<CoreValue> {
  readonly source: RecordMigrationSource<CoreValue>;
  readonly core: RecordCoreMigrationPlan<CoreValue>;
  readonly attachments: readonly RecordMigrationAttachmentPlanEntry[];
  readonly backup: RecordBackupState;
  readonly storage: RecordMigrationStorage<CoreValue>;
}

/** Exact plan identity prevents a copied public summary from becoming executable. */
const migrationPlanStates = new WeakMap<object, unknown>();
const migrationPlanRegistries = new WeakMap<
  object,
  RecordMigrationRegistryService
>();

function snapshotBackupState(backup: RecordBackupState): RecordBackupState {
  switch (backup.state) {
    case "git-restore-point":
      return Object.freeze({ state: backup.state, commit: backup.commit });
    case "portable-root-dirty":
      return Object.freeze({
        state: backup.state,
        entries: Object.freeze([...backup.entries]),
      });
    case "not-git-worktree":
    case "root-outside-worktree":
      return Object.freeze({ state: backup.state });
  }
}

function snapshotMigrationSource<CoreValue>(
  source: RecordMigrationSource<CoreValue>,
): RecordMigrationSource<CoreValue> {
  return Object.freeze({
    root: source.root,
    fingerprint: source.fingerprint,
    core: Object.freeze({
      format: source.core.format,
      value: source.core.value,
    }),
    attachments: Object.freeze(
      source.attachments.map((attachment) =>
        Object.freeze({
          directory: attachment.directory,
          owner: attachment.owner,
          name: attachment.name,
          schemaId: attachment.schemaId,
        }),
      ),
    ),
  });
}

/**
 * Package-created plan bound to the source snapshot and Git observation. It
 * contains no CLI confirmation and cannot be reconstructed from its summary.
 */
export class RecordMigrationPlan<CoreValue = RecordCoreV1> {
  private constructor(readonly summary: RecordMigrationPlanSummary) {
    Object.freeze(this);
  }

  static make<CoreValue>(input: {
    readonly source: RecordMigrationSource<CoreValue>;
    readonly core: RecordCoreMigrationPlan<CoreValue>;
    readonly attachments: readonly RecordMigrationAttachmentPlanEntry[];
    readonly backup: RecordBackupState;
    readonly storage: RecordMigrationStorage<CoreValue>;
  }): RecordMigrationPlan<CoreValue> {
    const source = snapshotMigrationSource(input.source);
    const backup = snapshotBackupState(input.backup);
    const attachmentPlans = Object.freeze(
      input.attachments.map((entry, index) => {
        const sourceAttachment = source.attachments[index];
        if (sourceAttachment === undefined) {
          throw new Error("Record migration Attachment plan lost its source");
        }
        return Object.freeze({ ...entry, source: sourceAttachment });
      }),
    );
    const attachments = Object.freeze(
      attachmentPlans.map((entry) => summarizeAttachment(entry)),
    );
    const hasAttachmentMigration = attachments.some(
      (entry) => entry.state === "migrate",
    );
    const plan = new RecordMigrationPlan<CoreValue>(
      Object.freeze({
        core: input.core.summary,
        attachments,
        backup,
        state:
          input.core.summary.state === "needed" || hasAttachmentMigration
            ? "needed"
            : "not-needed",
      }),
    );
    migrationPlanStates.set(
      plan,
      Object.freeze({
        source,
        core: input.core,
        attachments: attachmentPlans,
        backup,
        storage: input.storage,
      }),
    );
    return plan;
  }
}

function recordMigrationPlanState<CoreValue>(
  plan: RecordMigrationPlan<CoreValue>,
): RecordMigrationPlanState<CoreValue> {
  const state = migrationPlanStates.get(plan);
  if (state === undefined) {
    throw new Error("Record migration plan is not package-created");
  }
  return state as RecordMigrationPlanState<CoreValue>;
}

function summarizeAttachment(
  entry: RecordMigrationAttachmentPlanEntry,
): RecordMigrationAttachmentPlanSummary {
  const base = {
    owner: entry.source.owner,
    name: entry.source.name,
    schemaId: entry.source.schemaId,
  } as const;
  if (entry.resolution === undefined || entry.resolution.state === "unsupported") {
    return Object.freeze({ ...base, state: "unsupported" as const });
  }
  switch (entry.resolution.state) {
    case "current":
      return Object.freeze({ ...base, state: "current" as const });
    case "migration-required":
      return Object.freeze({ ...base, state: "migrate" as const });
    case "migration-unavailable":
      return Object.freeze({
        ...base,
        state: "migration-unavailable" as const,
        reason: entry.resolution.reason,
      });
  }
}

function hasSameBackupState(
  left: RecordBackupState,
  right: RecordBackupState,
): boolean {
  if (left.state !== right.state) {
    return false;
  }
  if (left.state === "git-restore-point" && right.state === "git-restore-point") {
    return left.commit === right.commit;
  }
  if (left.state === "portable-root-dirty" && right.state === "portable-root-dirty") {
    return (
      left.entries.length === right.entries.length &&
      left.entries.every((entry, index) => entry === right.entries[index])
    );
  }
  return true;
}

function authorizationIsValid(
  backup: RecordBackupState,
  authorization: RecordMigrationAuthorization,
): boolean {
  return backup.state === "git-restore-point"
    ? authorization.state === "git-restore-point"
    : authorization.state === "accept-data-loss";
}

/**
 * Shared reader/open code may call this guard after acquiring its shared
 * maintenance lock. Presence alone is terminal; content is intentionally not
 * decoded and no recovery action is attempted.
 */
export function assertRecordMigrationNotInterrupted(
  root: RecordRoot,
) {
  return Effect.gen(function* () {
    const fileSystem = yield* RecordFileSystem;
    const present = yield* fileSystem.migrationSentinelPresent(root);
    if (present) {
      return yield* Effect.fail(
        new RecordMigrationInterruptedState({
          code: "record-migration-interrupted",
        }),
      );
    }
  });
}

function withExclusiveMaintenance<A, Error, R>(input: {
  readonly root: RecordRoot;
  readonly work: Effect.Effect<A, Error, R>;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const lock = yield* RecordMaintenanceLock;
      yield* lock.acquireExclusive(input.root);
      return yield* input.work;
    }),
  );
}

function resolveAttachmentPlanEntries<CoreValue>(input: {
  readonly source: readonly RecordMigrationAttachmentSource[];
  readonly registry: RecordAttachmentRegistry;
  readonly storage: RecordMigrationStorage<CoreValue>;
}): Effect.Effect<
  readonly RecordMigrationAttachmentPlanEntry[],
  RecordMigrationStorageError,
  RecordFileSystem
> {
  return Effect.forEach(input.source, (attachment) => {
    const family = recordAttachmentRegistryFamily(
      input.registry,
      attachment.owner,
      attachment.name,
    );
    if (family === undefined) {
      return Effect.succeed(
        Object.freeze({
          source: attachment,
          family: undefined,
          resolution: undefined,
        }),
      );
    }
    const resolution = resolveRecordAttachmentMigration(
      family,
      attachment.schemaId,
    );
    if (resolution === undefined) {
      throw new Error("RecordAttachment registry returned a forged family");
    }
    if (resolution.state !== "migration-required") {
      return Effect.succeed(Object.freeze({ source: attachment, family, resolution }));
    }
    const readiness = input.storage.preflightAttachmentMigration;
    if (readiness === undefined) {
      return Effect.succeed(Object.freeze({ source: attachment, family, resolution }));
    }
    return Effect.map(
      readiness({ source: attachment, family, resolution }),
      (state): RecordMigrationAttachmentPlanEntry =>
        state.state === "ready"
          ? Object.freeze({ source: attachment, family, resolution })
          : Object.freeze({
              source: attachment,
              family,
              resolution: Object.freeze({
                state: "migration-unavailable" as const,
                from: resolution.from,
                to: resolution.to,
                reason: state.reason,
              }),
            }),
    );
  }).pipe(Effect.map((entries) => Object.freeze(entries)));
}

/**
 * Read-only preflight. It holds the real exclusive maintenance lock, checks
 * the sentinel before opening the source, delegates exact decode/closure/path
 * validation to storage, and records the platform Git backup state.
 */
/** @internal Generic seam for layout adapters and synthetic migration tests. */
export function planRecordMigrationWithStorage<CoreValue>(input: {
  readonly root: RecordRoot;
  readonly core: RecordCoreMigrationRegistry<CoreValue>;
  readonly attachments: RecordAttachmentRegistry;
  readonly storage: RecordMigrationStorage<CoreValue>;
}) {
  return withExclusiveMaintenance({
    root: input.root,
    work: Effect.gen(function* () {
      yield* assertRecordMigrationNotInterrupted(input.root);
      const source = yield* input.storage.inspectSource({
        root: input.root,
        attachments: input.attachments,
      });
      if (source.root !== input.root) {
        throw new Error("Record migration storage returned a source for another root");
      }
      const git = yield* RecordGit;
      const backup = yield* git.inspectBackupState(input.root);
      const core = makeRecordCoreMigrationPlan({
        registry: input.core,
        sourceFormat: source.core.format,
      });
      if (Either.isLeft(core)) {
        return yield* Effect.fail(core.left);
      }
      const attachments = yield* resolveAttachmentPlanEntries({
        source: source.attachments,
        registry: input.attachments,
        storage: input.storage,
      });
      return RecordMigrationPlan.make({
        source,
        core: core.right,
        attachments,
        backup,
        storage: input.storage,
      });
    }),
  });
}

export interface RecordMigrationReceipt {
  readonly state: "migrated" | "not-needed";
  readonly plan: RecordMigrationPlanSummary;
}

function currentAttachmentFamily(
  entry: RecordMigrationAttachmentPlanEntry,
): AnyRecordAttachmentFamily {
  if (entry.family === undefined) {
    throw new Error("A migration-required Attachment must have a registered family");
  }
  return entry.family;
}

/**
 * Execute a package-issued plan in place. No handler catches interruption or
 * defects, and no failure path removes the sentinel. Thus converter, I/O, and
 * cancellation failure leave the root fail-closed for Git/backup recovery.
 */
/** @internal Executes a plan issued by `planRecordMigrationWithStorage`. */
export function migrateRecordWithStorage<CoreValue>(input: {
  readonly plan: RecordMigrationPlan<CoreValue>;
  readonly authorization: RecordMigrationAuthorization;
}) {
  return Effect.suspend(() => {
    const state = recordMigrationPlanState(input.plan);
    return withExclusiveMaintenance({
      root: state.source.root,
      work: Effect.gen(function* () {
        yield* assertRecordMigrationNotInterrupted(state.source.root);
        const git = yield* RecordGit;
        const backup = yield* git.inspectBackupState(state.source.root);
        if (!hasSameBackupState(state.backup, backup)) {
          return yield* Effect.fail(recordMigrationPlanStale());
        }
        const sourceCurrent = yield* state.storage.isSourceCurrent(state.source);
        if (!sourceCurrent) {
          return yield* Effect.fail(recordMigrationPlanStale());
        }
        if (input.plan.summary.state === "not-needed") {
          return Object.freeze({
            state: "not-needed" as const,
            plan: input.plan.summary,
          });
        }
        if (!authorizationIsValid(backup, input.authorization)) {
          return yield* Effect.fail(
            backup.state === "git-restore-point"
              ? recordMigrationAuthorizationInvalid()
              : recordMigrationConfirmationRequired(),
          );
        }

        const fileSystem = yield* RecordFileSystem;
        // A portable mutation must never begin until the fail-closed marker is
        // durable. Keeping this pair uninterruptible also means cancellation
        // during publication leaves the sentinel in place rather than creating
        // an ambiguous partially-started migration.
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            yield* fileSystem.createMigrationSentinel(state.source.root);
            yield* fileSystem.syncDirectory(recordPortablePath(state.source.root));
          }),
        );

        let core = state.source.core.value;
        const coreResolution = recordCoreMigrationPlanResolution(state.core);
        if (coreResolution.state === "migration-required") {
          for (const edge of coreResolution.edges) {
            core = yield* edge.convert(core).pipe(
              Effect.catchAll(() =>
                Effect.fail(
                  recordCoreMigrationStepFailed({ from: edge.from, to: edge.to }),
                ),
              ),
            );
          }
        }

        yield* state.storage.stageCore({ source: state.source, value: core });
        for (const entry of state.attachments) {
          if (entry.resolution?.state !== "migration-required") {
            yield* state.storage.preserveAttachment({
              source: entry.source,
              targetCore: core,
            });
            continue;
          }
          let value = yield* state.storage.readAttachment({
            source: entry.source,
            family: currentAttachmentFamily(entry),
          });
          for (const edge of entry.resolution.edges) {
            const write = yield* state.storage
              .convertAttachment({ edge, source: value })
              .pipe(
                Effect.catchAll(() =>
                  Effect.fail(
                    recordAttachmentMigrationStepFailed({
                      owner: entry.source.owner,
                      name: entry.source.name,
                      schemaId: entry.source.schemaId,
                    }),
                  ),
                ),
              );
            value = yield* state.storage.persistAttachment({
              source: entry.source,
              targetCore: core,
              edge,
              write,
            });
          }
        }

        // The root document remains interruptible while it is being written:
        // cancellation there leaves the marker. Once that synced last write
        // completes, deletion and directory sync form the tiny commit point.
        yield* Effect.uninterruptibleMask((restore) =>
          restore(
            state.storage.writeRecordDocumentLast({
              source: state.source,
              value: core,
            }),
          ).pipe(
            Effect.zipRight(fileSystem.removeMigrationSentinel(state.source.root)),
            Effect.zipRight(
              fileSystem.syncDirectory(recordPortablePath(state.source.root)),
            ),
          ),
        );
        return Object.freeze({
          state: "migrated" as const,
          plan: input.plan.summary,
        });
      }),
    });
  });
}

/**
 * Public migration preflight. Applications install the current Core registry,
 * selected Attachment families, and layout adapter once through
 * `RecordMigrationRegistry`; callers only supply the durable Record root.
 */
export function planRecordMigration(input: { readonly root: RecordRoot }) {
  return Effect.gen(function* () {
    const registry = yield* RecordMigrationRegistry;
    const plan = yield* planRecordMigrationWithStorage({
      root: input.root,
      core: registry.core,
      attachments: registry.attachments,
      storage: registry.storage,
    });
    yield* Effect.sync(() => {
      migrationPlanRegistries.set(plan, registry);
    });
    return plan;
  });
}

/**
 * Public in-place execution remains bound to the exact installed registry
 * observed during preflight. Re-providing a different registry makes the plan
 * stale instead of allowing a copied summary to select different converters.
 */
export function migrateRecord(input: {
  readonly plan: RecordMigrationPlan;
  readonly authorization: RecordMigrationAuthorization;
}) {
  return Effect.flatMap(RecordMigrationRegistry, (registry) => {
    const plannedRegistry = migrationPlanRegistries.get(input.plan);
    return plannedRegistry === registry
      ? migrateRecordWithStorage(input)
      : Effect.fail(recordMigrationPlanStale());
  });
}

export type RecordMigrationPlanError =
  | RecordMigrationStorageError
  | RecordCoreMigrationPlanInvalid
  | RecordMigrationInterruptedState
  | RecordGitError
  | RecordMaintenanceLockError;

export type RecordMigrationError =
  | RecordMigrationStorageError
  | RecordMigrationInterruptedState
  | RecordGitError
  | RecordMaintenanceLockError
  | ReturnType<typeof recordMigrationPlanStale>
  | ReturnType<typeof recordMigrationConfirmationRequired>
  | ReturnType<typeof recordMigrationAuthorizationInvalid>
  | ReturnType<typeof recordCoreMigrationStepFailed>
  | ReturnType<typeof recordAttachmentMigrationStepFailed>;
