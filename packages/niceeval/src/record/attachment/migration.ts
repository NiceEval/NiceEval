import { Effect } from "effect";

import type { RecordAttachmentBlobDraft, RecordBlobDrafts } from "./types.ts";
import type { RecordAttachmentSpiFailure } from "./errors.ts";
import {
  isRecordAttachmentVersion,
  type AnyRecordAttachmentVersion,
  type RecordAttachmentVersion,
  type RecordAttachmentVersionValue,
} from "./version.ts";

const recordAttachmentMigrationTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentMigration",
);

const migrations = new WeakSet<object>();

/** Source drafts are data/capabilities already bounded by Core, never Host paths or I/O services. */
export interface RecordAttachmentMigrationInput<Value> {
  readonly value: Value;
  readonly sources: readonly RecordAttachmentBlobDraft<unknown, unknown>[];
}

export interface RecordAttachmentMigrationOutput<
  Value,
  Sources extends RecordBlobDrafts = RecordBlobDrafts,
> {
  readonly value: Value;
  readonly sources: Sources;
}

export interface RecordAttachmentMigration<
  From extends AnyRecordAttachmentVersion,
  To extends AnyRecordAttachmentVersion,
  Error,
> {
  readonly from: From;
  readonly to: To;
  readonly migrate: (
    input: RecordAttachmentMigrationInput<RecordAttachmentVersionValue<From>>,
  ) => Effect.Effect<
    RecordAttachmentMigrationOutput<RecordAttachmentVersionValue<To>>,
    Error,
    never
  >;
  readonly [recordAttachmentMigrationTypeId]: () => {
    readonly from: From;
    readonly to: To;
    readonly error: Error;
  };
}

export type AnyRecordAttachmentMigration = RecordAttachmentMigration<
  AnyRecordAttachmentVersion,
  AnyRecordAttachmentVersion,
  unknown
>;

/** Only the family compiler may accept this token into a migration chain. */
export function recordAttachmentMigration<
  const From extends AnyRecordAttachmentVersion,
  const To extends AnyRecordAttachmentVersion,
  Error,
>(input: {
  readonly from: From;
  readonly to: To;
  readonly migrate: (
    input: RecordAttachmentMigrationInput<RecordAttachmentVersionValue<From>>,
  ) => Effect.Effect<
    RecordAttachmentMigrationOutput<RecordAttachmentVersionValue<To>>,
    Error,
    never
  >;
}): RecordAttachmentMigration<From, To, Error> {
  const migration = {
    from: input.from,
    to: input.to,
    migrate: input.migrate,
    [recordAttachmentMigrationTypeId]: () => ({
      from: input.from,
      to: input.to,
      error: undefined as never,
    }),
  } as RecordAttachmentMigration<From, To, Error>;
  migrations.add(migration);
  return Object.freeze(migration);
}

export function isRecordAttachmentMigration(value: unknown): value is AnyRecordAttachmentMigration {
  return typeof value === "object" && value !== null && migrations.has(value);
}

/**
 * Run one already-validated adjacent step without services. Synchronous callback
 * throws and typed failures retain their original cause; defects/interruption in
 * the returned Effect remain in their native Cause channels.
 */
export function runRecordAttachmentMigration(
  migration: AnyRecordAttachmentMigration,
  input: RecordAttachmentMigrationInput<unknown>,
): Effect.Effect<RecordAttachmentMigrationOutput<unknown>, RecordAttachmentSpiFailure> {
  const from = migration.from.version;
  const to = migration.to.version;
  return Effect.try({
    try: () => migration.migrate(input as never),
    catch: (cause): RecordAttachmentSpiFailure => Object.freeze({
      code: "migration-step-failed",
      from,
      to,
      cause,
    }),
  }).pipe(
    Effect.flatten,
    Effect.mapError((cause): RecordAttachmentSpiFailure =>
      cause !== null && typeof cause === "object" && "code" in cause &&
        cause.code === "migration-step-failed"
        ? cause as RecordAttachmentSpiFailure
        : Object.freeze({ code: "migration-step-failed", from, to, cause })
    ),
  );
}
