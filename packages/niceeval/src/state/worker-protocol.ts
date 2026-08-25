import type { StateMigration, StateOperationKind, StateSqlValue } from "./types.ts";

export interface StateWorkerCatalogOperation { readonly name: string; readonly kind: StateOperationKind; readonly sql: string; }
export interface StateWorkerCatalogModule { readonly serviceId: string; readonly currentRevision: number; readonly migrations: readonly StateMigration[]; readonly operations: readonly StateWorkerCatalogOperation[]; }
export type StateWorkerCatalog = readonly StateWorkerCatalogModule[];
export interface StateWorkerData { readonly path: string; readonly catalog: StateWorkerCatalog; readonly automaticMigrations: boolean; readonly busyTimeoutMs: number; }
export type StateWorkerRequest =
  | { readonly id: number; readonly operation: "execute"; readonly serviceId: string; readonly operationName: string; readonly values: readonly StateSqlValue[] }
  | { readonly id: number; readonly operation: "migrate-all" }
  | { readonly id: number; readonly operation: "close" };
export type StateWorkerRequestWithoutId = StateWorkerRequest extends infer Request
  ? Request extends StateWorkerRequest ? Omit<Request, "id"> : never
  : never;
export type StateWorkerResult =
  | { readonly kind: "one"; readonly row: unknown | null }
  | { readonly kind: "many"; readonly rows: readonly unknown[] }
  | { readonly kind: "run"; readonly changes: number; readonly lastInsertRowid: number | bigint }
  | { readonly kind: "void" };
export interface StateWorkerFailure {
  readonly code: "service-state-invalid" | "service-state-migration-required" | "service-state-unsupported" | "service-state-busy";
  readonly message: string;
  readonly serviceId?: string;
  readonly currentRevision?: number;
  readonly requiredRevision?: number;
  readonly databaseRevision?: number;
  readonly supportedRevision?: number;
}
export type StateWorkerStartup = { readonly state: "ready" } | { readonly state: "startup-failure"; readonly error: StateWorkerFailure };
export type StateWorkerResponse = { readonly id: number; readonly state: "success"; readonly result: StateWorkerResult } | { readonly id: number; readonly state: "failure"; readonly error: StateWorkerFailure };
