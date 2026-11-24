import * as Schema from "effect/Schema";
import { isStatePath } from "./paths.ts";

const Nonnegative = Schema.Number.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0));
const Positive = Nonnegative.check(Schema.isGreaterThan(0));
export const StateIdentitySchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/u));
export const StateDigestSchema = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/u));
const StatePathSchema = Schema.String.check(Schema.makeFilter(isStatePath));

export const StateLineageSchema = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)),
  version: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u)),
  cohort: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,63}$/u)),
  experimentId: Schema.NonEmptyString,
  evalGroupId: Schema.NonEmptyString,
});
export const StateCheckpointSchema = Schema.Struct({
  checkpointId: StateIdentitySchema,
  digest: StateDigestSchema,
  bytes: Nonnegative,
});
export const StateOriginSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("fresh") }),
  Schema.Struct({ kind: Schema.Literal("checkpoint"), checkpoint: StateCheckpointSchema }),
]);
export const StateFailureReasonSchema = Schema.Literals([
  "path-invalid",
  "layout-mismatch",
  "checkpoint-invalid",
  "initialize-failed",
  "restore-failed",
  "reset-failed",
  "prepare-failed",
  "cleanup-failed",
  "resource-failed",
  "not-quiescent",
  "provider-lost",
  "interrupted",
  "timeout",
  "capture-failed",
  "storage-failed",
  "owner-lost",
  "no-attempts",
  "recovered",
]);
export const StateRestoreSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("ready") }),
  Schema.Struct({ status: Schema.Literal("failed"), reason: StateFailureReasonSchema }),
]);
export const StateSaveSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("saved"), checkpoints: Schema.Array(StateCheckpointSchema) }),
  Schema.Struct({ status: Schema.Literals(["skipped", "failed"]), reason: StateFailureReasonSchema }),
  Schema.Struct({ status: Schema.Literal("conflict"), actual: Schema.Array(Schema.NullOr(StateCheckpointSchema)) }),
  Schema.Struct({ status: Schema.Literal("unknown"), reason: Schema.Literal("storage-failed") }),
]);
export const StateExecutionBindingSchema = Schema.Struct({
  lineage: StateLineageSchema,
  origin: StateOriginSchema,
});
export const StateExecutionSchema = Schema.Struct({
  executionId: StateIdentitySchema,
  runId: Schema.NonEmptyString,
  experimentId: Schema.NonEmptyString,
  evalGroupId: Schema.NonEmptyString,
  generation: Positive,
  bindings: Schema.NonEmptyArray(StateExecutionBindingSchema),
  restore: StateRestoreSchema,
  save: StateSaveSchema,
});
export const AttemptStateSchema = Schema.Struct({ executionId: StateIdentitySchema, earlierAttempts: Nonnegative });
export const RunSandboxStateSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("unavailable") }),
  Schema.Struct({ status: Schema.Literal("known"), executions: Schema.Array(StateExecutionSchema) }),
]);
export const AttemptStateResultSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("unavailable") }),
  Schema.Struct({ status: Schema.Literal("known"), context: Schema.NullOr(AttemptStateSchema) }),
]);
const StateEventIdentity = {
  type: Schema.Literal("state"),
  runId: Schema.String,
  executionId: StateIdentitySchema,
  lineage: StateLineageSchema,
};
export const StateEventSchema = Schema.Union([
  Schema.Struct({
    ...StateEventIdentity,
    event: Schema.Literals(["restored", "saved"]),
    checkpoint: StateCheckpointSchema,
  }),
  Schema.Struct({ ...StateEventIdentity, event: Schema.Literals(["initialized", "empty"]) }),
  Schema.Struct({
    ...StateEventIdentity,
    event: Schema.Literals(["restore-failed", "save-skipped", "save-failed"]),
    reason: StateFailureReasonSchema,
  }),
  Schema.Struct({
    ...StateEventIdentity,
    event: Schema.Literal("save-conflict"),
    expected: Schema.NullOr(StateCheckpointSchema),
    actual: Schema.NullOr(StateCheckpointSchema),
  }),
  Schema.Struct({
    ...StateEventIdentity,
    event: Schema.Literal("save-unknown"),
    reason: Schema.Literal("storage-failed"),
  }),
]);
export const StateManifestSchema = Schema.Struct({
  roots: Schema.NonEmptyArray(
    Schema.Struct({
      declared: StatePathSchema,
      resolved: StatePathSchema.check(Schema.makeFilter((path) => path.startsWith("/"))),
      present: Schema.Boolean,
    }),
  ),
});

export type StateLineage = typeof StateLineageSchema.Type;
export type StateCheckpoint = typeof StateCheckpointSchema.Type;
export type StateOrigin = typeof StateOriginSchema.Type;
export type StateFailureReason = typeof StateFailureReasonSchema.Type;
export type StateExecutionBinding = typeof StateExecutionBindingSchema.Type;
export type StateRestore = typeof StateRestoreSchema.Type;
export type StateSave = typeof StateSaveSchema.Type;
export type StateExecution = typeof StateExecutionSchema.Type;
export type AttemptState = typeof AttemptStateSchema.Type;
export type RunSandboxState = typeof RunSandboxStateSchema.Type;
export type AttemptStateResult = typeof AttemptStateResultSchema.Type;
export type StateManifest = typeof StateManifestSchema.Type;
export type StateEvent = typeof StateEventSchema.Type;

export function compareStateLineage(a: StateLineage, b: StateLineage): number {
  for (const key of ["name", "version", "cohort", "experimentId", "evalGroupId"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return 0;
}
