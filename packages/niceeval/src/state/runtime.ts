import { Worker } from "node:worker_threads";
import { Effect, type Scope } from "effect";
import { defineStateService } from "./definition.ts";
import { userStatePath } from "./path.ts";
import {
  ServiceStateBusy,
  ServiceStateInvalid,
  ServiceStateMigrationRequired,
  ServiceStateUnsupported,
  type ServiceStateFailure,
  type StateOperation,
  type StateOperationResult,
  type StateService,
  type StateServiceModule,
  type UserStateStore,
  type UserStateStoreOpenOptions,
} from "./types.ts";
import type { StateWorkerCatalog, StateWorkerFailure, StateWorkerRequestWithoutId, StateWorkerResult, StateWorkerResponse, StateWorkerStartup } from "./worker-protocol.ts";

const STATE_WORKER_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, codeRangeSizeMb: 32, stackSizeMb: 4 });
const STATE_WORKER_STARTUP_MAX_MS = 120_000;

function serviceStateError(serviceId: string | undefined, cause: unknown): ServiceStateFailure {
  const text = cause instanceof Error ? cause.message : String(cause);
  if (/SQLITE_BUSY|database is locked/iu.test(text)) return new ServiceStateBusy({ code: "service-state-busy", serviceId, cause });
  return new ServiceStateInvalid({ code: "service-state-invalid", serviceId, reason: text, cause });
}

function workerFailure(failure: StateWorkerFailure): ServiceStateFailure {
  const cause = new Error(failure.message);
  switch (failure.code) {
    case "service-state-migration-required": return new ServiceStateMigrationRequired({ code: failure.code, serviceId: failure.serviceId ?? "unknown", currentRevision: failure.currentRevision ?? 0, requiredRevision: failure.requiredRevision ?? 0 });
    case "service-state-unsupported": return new ServiceStateUnsupported({ code: failure.code, serviceId: failure.serviceId ?? "unknown", databaseRevision: failure.databaseRevision ?? 0, supportedRevision: failure.supportedRevision ?? 0 });
    case "service-state-busy": return new ServiceStateBusy({ code: failure.code, serviceId: failure.serviceId, cause });
    default: return new ServiceStateInvalid({ code: "service-state-invalid", serviceId: failure.serviceId, reason: failure.message, cause });
  }
}

function catalogFor(modules: readonly StateServiceModule[]): StateWorkerCatalog {
  return Object.freeze(modules.map((module) => Object.freeze({
    serviceId: module.serviceId,
    currentRevision: module.currentRevision,
    migrations: Object.freeze(module.migrations.map((migration) => Object.freeze({ from: migration.from, to: migration.to, sql: Object.freeze([...migration.sql]), schema: Object.freeze(migration.schema.map((object) => Object.freeze({ ...object }))) }))),
    operations: Object.freeze(module.operations.map((operation) => Object.freeze({ name: operation.name, kind: operation.kind, sql: operation.sql }))),
  })));
}

function isStartup(value: unknown): value is StateWorkerStartup {
  return typeof value === "object" && value !== null && (Reflect.get(value, "state") === "ready" || Reflect.get(value, "state") === "startup-failure");
}

function isResponse(value: unknown): value is StateWorkerResponse {
  return typeof value === "object" && value !== null && Number.isSafeInteger(Reflect.get(value, "id")) && (Reflect.get(value, "state") === "success" || Reflect.get(value, "state") === "failure");
}

interface Pending { readonly resolve: (result: StateWorkerResult) => void; readonly reject: (cause: ServiceStateFailure) => void; }

class StateWorkerClient {
  #nextId = 1;
  #closing = false;
  #closePromise: Promise<void> | undefined;
  readonly #pending = new Map<number, Pending>();

  private constructor(private readonly worker: Worker) {
    worker.on("message", (value: unknown) => {
      if (!isResponse(value)) return;
      const pending = this.#pending.get(value.id);
      if (pending === undefined) return;
      this.#pending.delete(value.id);
      if (value.state === "success") pending.resolve(value.result);
      else pending.reject(workerFailure(value.error));
    });
    worker.on("error", (cause) => this.rejectAll(serviceStateError(undefined, cause)));
    worker.on("exit", (code) => { if (!this.#closing) this.rejectAll(serviceStateError(undefined, new Error(`State storage worker exited unexpectedly with code ${code}`))); });
  }

  static async open(input: { readonly path: string; readonly catalog: StateWorkerCatalog; readonly automaticMigrations: boolean; readonly busyTimeoutMs: number }): Promise<StateWorkerClient> {
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const worker = new Worker(new URL(`./storage-worker.${extension}`, import.meta.url), {
      workerData: input,
      resourceLimits: STATE_WORKER_LIMITS,
      execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type") && argument !== "--expose-gc"),
    });
    return new Promise<StateWorkerClient>((resolve, reject) => {
      let settled = false;
      const startupTimeoutMs = Math.min(STATE_WORKER_STARTUP_MAX_MS, Math.max(10_000, input.busyTimeoutMs + 5_000));
      const timer = setTimeout(() => finish(() => reject(serviceStateError(undefined, new Error(`State storage worker did not become ready within ${startupTimeoutMs}ms`))), true), startupTimeoutMs);
      const finish = (work: () => void, terminate = false): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
        work();
        if (terminate) void worker.terminate();
      };
      const onMessage = (value: unknown): void => {
        if (!isStartup(value)) return;
        if (value.state === "ready") finish(() => resolve(new StateWorkerClient(worker)));
        else finish(() => reject(workerFailure(value.error)), true);
      };
      const onError = (cause: unknown): void => finish(() => reject(serviceStateError(undefined, cause)), true);
      const onExit = (code: number): void => finish(() => reject(serviceStateError(undefined, new Error(`State storage worker exited during startup with code ${code}`))), true);
      worker.on("message", onMessage);
      worker.once("error", onError);
      worker.once("exit", onExit);
    });
  }

  request(request: StateWorkerRequestWithoutId): Promise<StateWorkerResult> {
    return this.#closing ? Promise.reject(serviceStateError(undefined, new Error("User State Store is closed"))) : this.send(request);
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closing = true;
    this.#closePromise = this.send({ operation: "close" }).then(() => undefined, () => undefined).finally(async () => {
      this.rejectAll(serviceStateError(undefined, new Error("User State Store is closed")));
      await this.worker.terminate();
    });
    return this.#closePromise;
  }

  private send(request: StateWorkerRequestWithoutId): Promise<StateWorkerResult> {
    const id = this.#nextId++;
    return new Promise<StateWorkerResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ ...request, id }); }
      catch (cause) { this.#pending.delete(id); reject(serviceStateError(undefined, cause)); }
    });
  }

  private rejectAll(cause: ServiceStateFailure): void {
    for (const pending of this.#pending.values()) pending.reject(cause);
    this.#pending.clear();
  }
}

class UserStateStoreRuntime implements UserStateStore {
  readonly path: string;
  readonly #modules = new Map<string, StateServiceModule>();

  constructor(private readonly client: StateWorkerClient, path: string, modules: readonly StateServiceModule[]) {
    this.path = path;
    for (const module of modules) this.#modules.set(module.serviceId, module);
  }

  get migrateAll(): Effect.Effect<void, ServiceStateFailure> {
    return Effect.tryPromise({ try: async () => { await this.client.request({ operation: "migrate-all" }); }, catch: (cause) => this.error(undefined, cause) });
  }

  service<Module extends StateServiceModule>(module: Module): StateService<Module> {
    if (this.#modules.get(module.serviceId) !== module) throw new TypeError(`User State Store does not compose ${module.serviceId}`);
    return Object.freeze({ execute: <Operation extends Module["operations"][number]>(operation: Operation, input: Parameters<Operation["bind"]>[0]) => this.execute(module, operation, input) });
  }

  close(): Promise<void> { return this.client.close(); }

  private execute<Module extends StateServiceModule, Operation extends Module["operations"][number]>(module: Module, operation: Operation, input: Parameters<Operation["bind"]>[0]): Effect.Effect<StateOperationResult<Operation>, ServiceStateFailure> {
    return Effect.tryPromise({
      try: async () => {
        if (!module.operations.includes(operation)) throw new ServiceStateInvalid({ code: "service-state-invalid", serviceId: module.serviceId, reason: "operation is not declared by this module" });
        const result = await this.client.request({ operation: "execute", serviceId: module.serviceId, operationName: operation.name, values: operation.bind(input) });
        if (operation.kind === "run") {
          if (result.kind !== "run") throw new Error("State storage worker returned the wrong operation result");
          return Object.freeze({ changes: result.changes, lastInsertRowid: result.lastInsertRowid }) as StateOperationResult<Operation>;
        }
        if (operation.kind === "one") {
          if (result.kind !== "one") throw new Error("State storage worker returned the wrong operation result");
          if (result.row === null) return null as StateOperationResult<Operation>;
          const decoded = operation.decode!(result.row);
          if (decoded._tag === "StateRowDecodeFailure") throw new ServiceStateInvalid({ code: "service-state-invalid", serviceId: module.serviceId, reason: decoded.reason });
          return decoded.value as StateOperationResult<Operation>;
        }
        if (result.kind !== "many") throw new Error("State storage worker returned the wrong operation result");
        return Object.freeze(result.rows.map((row) => {
          const decoded = operation.decode!(row);
          if (decoded._tag === "StateRowDecodeFailure") throw new ServiceStateInvalid({ code: "service-state-invalid", serviceId: module.serviceId, reason: decoded.reason });
          return decoded.value;
        })) as StateOperationResult<Operation>;
      },
      catch: (cause) => this.error(module.serviceId, cause),
    });
  }

  private error(serviceId: string | undefined, cause: unknown): ServiceStateFailure {
    return cause instanceof ServiceStateInvalid || cause instanceof ServiceStateBusy || cause instanceof ServiceStateMigrationRequired || cause instanceof ServiceStateUnsupported ? cause : serviceStateError(serviceId, cause);
  }
}

export interface UserStateStoreHost { readonly open: (options?: UserStateStoreOpenOptions) => Effect.Effect<UserStateStore, ServiceStateFailure, Scope.Scope>; }

export function makeUserStateStoreHost(input: { readonly modules: readonly StateServiceModule[] }): UserStateStoreHost {
  const modules = input.modules.map((module) => defineStateService(module));
  const ids = new Set<string>();
  for (const module of modules) {
    if (ids.has(module.serviceId)) throw new TypeError(`Duplicate Service state module: ${module.serviceId}`);
    ids.add(module.serviceId);
  }
  const staticModules = Object.freeze(modules);
  const catalog = catalogFor(staticModules);
  return Object.freeze({
    open: (options: UserStateStoreOpenOptions = {}) => Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const path = userStatePath({ home: options.home });
          const client = await StateWorkerClient.open({ path, catalog, automaticMigrations: options.automaticMigrations ?? true, busyTimeoutMs: options.busyTimeoutMs ?? 1_000 });
          return new UserStateStoreRuntime(client, path, staticModules);
        },
        catch: (cause) => cause instanceof ServiceStateInvalid || cause instanceof ServiceStateBusy || cause instanceof ServiceStateMigrationRequired || cause instanceof ServiceStateUnsupported ? cause : serviceStateError(undefined, cause),
      }),
      (runtime) => Effect.orDie(Effect.promise(() => runtime.close())),
    ),
  });
}
