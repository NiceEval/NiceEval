import { Data, type Effect } from "effect";

/** A value accepted by a fixed SQLite prepared statement. */
export type StateSqlValue = null | number | bigint | string | Uint8Array;

export type StateOperationKind = "one" | "many" | "run";

export interface StateRowDecodeSuccess<Value> {
  readonly _tag: "StateRowDecodeSuccess";
  readonly value: Value;
}

export interface StateRowDecodeFailure {
  readonly _tag: "StateRowDecodeFailure";
  readonly reason: string;
}

export type StateRowDecode<Value> = StateRowDecodeSuccess<Value> | StateRowDecodeFailure;

/**
 * A statically declared operation. `sql` is prepared by the Host after it
 * replaces the Host-owned `{{namespace}}` token; callers can only supply bind
 * values, never SQL or a table name.
 */
export interface StateOperation<Name extends string, Input, Value, Kind extends StateOperationKind> {
  readonly name: Name;
  readonly kind: Kind;
  readonly sql: string;
  // A method-shaped property intentionally keeps operation inputs local to the
  // operation instead of making a readonly mixed-operation tuple contravariant.
  readonly bind: { bivarianceHack(input: Input): readonly StateSqlValue[] }["bivarianceHack"];
  readonly decode: Kind extends "run" ? undefined : (row: unknown) => StateRowDecode<Value>;
}

export interface StateSchemaObject {
  readonly type: "table" | "index";
  /** A suffix below the Host-derived namespace; never a physical table name. */
  readonly logicalName: string;
  /** Required by indexes so the Host can verify their exact namespace owner. */
  readonly tableLogicalName?: string;
  /** Exact checked-in SQL after substituting `{{namespace}}`. */
  readonly sql: string;
}

/** One checked-in, adjacent schema transition. */
export interface StateMigration {
  readonly from: number;
  readonly to: number;
  readonly sql: readonly string[];
  /** The complete namespace schema expected immediately after this transition. */
  readonly schema: readonly StateSchemaObject[];
}

export interface StateServiceModule<Operations extends readonly StateOperation<string, unknown, unknown, StateOperationKind>[] = readonly StateOperation<string, unknown, unknown, StateOperationKind>[]> {
  readonly serviceId: string;
  readonly currentRevision: number;
  readonly migrations: readonly StateMigration[];
  readonly operations: Operations;
}

export type StateOperationInput<Operation> =
  Operation extends StateOperation<string, infer Input, unknown, StateOperationKind> ? Input : never;

export type StateOperationValue<Operation> =
  Operation extends StateOperation<string, unknown, infer Value, StateOperationKind> ? Value : never;

export type StateOperationResult<Operation> =
  Operation extends StateOperation<string, unknown, unknown, "one"> ? StateOperationValue<Operation> | null
    : Operation extends StateOperation<string, unknown, unknown, "many"> ? readonly StateOperationValue<Operation>[]
    : { readonly changes: number; readonly lastInsertRowid: number | bigint };

export class ServiceStateInvalid extends Data.TaggedError("ServiceStateInvalid")<{
  readonly code: "service-state-invalid";
  readonly serviceId?: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export class ServiceStateMigrationRequired extends Data.TaggedError("ServiceStateMigrationRequired")<{
  readonly code: "service-state-migration-required";
  readonly serviceId: string;
  readonly currentRevision: number;
  readonly requiredRevision: number;
}> {}

export class ServiceStateUnsupported extends Data.TaggedError("ServiceStateUnsupported")<{
  readonly code: "service-state-unsupported";
  readonly serviceId: string;
  readonly databaseRevision: number;
  readonly supportedRevision: number;
}> {}

export class ServiceStateBusy extends Data.TaggedError("ServiceStateBusy")<{
  readonly code: "service-state-busy";
  readonly serviceId?: string;
  readonly cause: unknown;
}> {}

export type ServiceStateFailure =
  | ServiceStateInvalid
  | ServiceStateMigrationRequired
  | ServiceStateUnsupported
  | ServiceStateBusy;

export interface StateService<Module extends StateServiceModule> {
  readonly execute: <Operation extends Module["operations"][number]>(
    operation: Operation,
    input: StateOperationInput<Operation>,
  ) => Effect.Effect<StateOperationResult<Operation>, ServiceStateFailure>;
}

export interface UserStateStore {
  readonly path: string;
  readonly service: <Module extends StateServiceModule>(module: Module) => StateService<Module>;
  readonly migrateAll: Effect.Effect<void, ServiceStateFailure>;
}

export interface UserStateStoreOpenOptions {
  /** Absolute user-state root. Defaults to NICEEVAL_HOME or ~/.niceeval. */
  readonly home?: string;
  /** Operations migrate their own module unless this is explicitly disabled. */
  readonly automaticMigrations?: boolean;
  readonly busyTimeoutMs?: number;
}
