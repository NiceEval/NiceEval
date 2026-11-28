import { Worker } from "node:worker_threads";
import { access } from "node:fs/promises";
import { Effect, type Scope } from "effect";
import { normalizeExternalCause } from "../shared/external-cause.ts";
import { isDockerCacheRepositoryResult } from "../sandbox/docker-cache-repository.ts";
import { isIncusRepositoryResult } from "../sandbox/incus/repository.ts";
import { isBeforeCacheSnapshotRepositoryResult } from "../sandbox/remote-snapshot/ledger.ts";
import {
  UserDatabaseBusy,
  UserDatabaseInvalid,
  UserDatabaseLegacyFound,
  UserDatabaseUnsupported,
  type UserDatabaseFailure,
} from "./errors.ts";
import { decodeUserDatabaseFailure } from "./failure-wire.ts";
import { userDatabasePaths } from "./path.ts";
import {
  DURABLE_STATE_REPOSITORY,
  type DurableStateEntry,
  type UserDatabaseRepositoryRequest,
  type UserDatabaseRepositoryResult,
  type UserDatabaseResultFor,
  isUserDatabaseWorkerFailure,
  type UserDatabaseWorkerRequestWithoutId,
  type UserDatabaseWorkerResponse,
  type UserDatabaseWorkerStartup,
  type UserDatabaseWorkerData,
} from "./protocol.ts";

const WorkerLimits = {
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 32,
  codeRangeSizeMb: 32,
  stackSizeMb: 4,
} as const;
const StartupMaximumMs = 120_000;

function workerExecArgv(): string[] {
  const retained: string[] = [];
  for (let index = 0; index < process.execArgv.length; index += 1) {
    const argument = process.execArgv[index]!;
    if (argument === "--import" || argument === "--loader") {
      const value = process.execArgv[index + 1];
      if (value !== undefined) {
        retained.push(argument, value);
        index += 1;
      }
    } else if (argument.startsWith("--import=") || argument.startsWith("--loader=")) {
      retained.push(argument);
    }
  }
  return retained;
}

function localFailure(cause: unknown): UserDatabaseFailure {
  if (
    cause instanceof UserDatabaseInvalid ||
    cause instanceof UserDatabaseBusy ||
    cause instanceof UserDatabaseUnsupported ||
    cause instanceof UserDatabaseLegacyFound
  )
    return cause;
  const normalizedCause = normalizeExternalCause(cause);
  return new UserDatabaseInvalid({
    code: "user-database-invalid",
    message: normalizedCause.message,
    repository: undefined,
    cause: normalizedCause,
  });
}

function isEntry(value: unknown): value is DurableStateEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof Reflect.get(value, "key") === "string" &&
    typeof Reflect.get(value, "value") === "string"
  );
}

function isResult(value: unknown): value is UserDatabaseRepositoryResult | { readonly kind: "void" } {
  if (typeof value !== "object" || value === null) return false;
  if (Reflect.get(value, "kind") === "void") return true;
  if (Reflect.get(value, "repository") !== DURABLE_STATE_REPOSITORY) {
    return (
      isDockerCacheRepositoryResult(value) ||
      isIncusRepositoryResult(value) ||
      isBeforeCacheSnapshotRepositoryResult(value)
    );
  }
  const operation = Reflect.get(value, "operation");
  if (operation === "put") return Number.isSafeInteger(Reflect.get(value, "changes"));
  if (operation === "get") return Reflect.get(value, "entry") === null || isEntry(Reflect.get(value, "entry"));
  return (
    operation === "list" &&
    Array.isArray(Reflect.get(value, "entries")) &&
    (Reflect.get(value, "entries") as unknown[]).every(isEntry)
  );
}

function isStartup(value: unknown): value is UserDatabaseWorkerStartup {
  return (
    typeof value === "object" &&
    value !== null &&
    (Reflect.get(value, "state") === "ready" ||
      (Reflect.get(value, "state") === "startup-failure" && isUserDatabaseWorkerFailure(Reflect.get(value, "error"))))
  );
}

function isResponse(value: unknown): value is UserDatabaseWorkerResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isSafeInteger(Reflect.get(value, "id")) &&
    ((Reflect.get(value, "state") === "success" && isResult(Reflect.get(value, "result"))) ||
      (Reflect.get(value, "state") === "failure" && isUserDatabaseWorkerFailure(Reflect.get(value, "error"))))
  );
}

type WorkerResult = UserDatabaseRepositoryResult | { readonly kind: "void" };
interface Pending {
  readonly resolve: (result: WorkerResult) => void;
  readonly reject: (failure: UserDatabaseFailure) => void;
}

class UserDatabaseWorkerClient {
  #nextId = 1;
  #closing = false;
  #closePromise: Promise<void> | undefined;
  readonly #pending = new Map<number, Pending>();

  private readonly worker: Worker;
  private constructor(worker: Worker) {
    this.worker = worker;
    worker.on("message", (value: unknown) => {
      if (!isResponse(value)) return;
      const pending = this.#pending.get(value.id);
      if (pending === undefined) return;
      this.#pending.delete(value.id);
      if (value.state === "success") pending.resolve(value.result);
      else pending.reject(decodeUserDatabaseFailure(value.error));
    });
    worker.on("error", (cause) => this.rejectAll(localFailure(cause)));
    worker.on("exit", (code) => {
      if (!this.#closing)
        this.rejectAll(localFailure(new Error(`UserDatabase storage worker exited unexpectedly with code ${code}`)));
    });
  }

  static open(input: UserDatabaseWorkerData): Promise<UserDatabaseWorkerClient> {
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const worker = new Worker(new URL(`./storage-worker.${extension}`, import.meta.url), {
      workerData: input,
      resourceLimits: WorkerLimits,
      execArgv: workerExecArgv(),
    });
    return new Promise<UserDatabaseWorkerClient>((resolve, reject) => {
      let settled = false;
      const startupTimeoutMs = Math.min(StartupMaximumMs, Math.max(10_000, input.busyTimeoutMs + 5_000));
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
      const timer = setTimeout(
        () =>
          finish(
            () =>
              reject(
                localFailure(
                  new Error(`UserDatabase storage worker did not become ready within ${startupTimeoutMs}ms`),
                ),
              ),
            true,
          ),
        startupTimeoutMs,
      );
      const onMessage = (value: unknown): void => {
        if (!isStartup(value)) return;
        if (value.state === "ready") finish(() => resolve(new UserDatabaseWorkerClient(worker)));
        else finish(() => reject(decodeUserDatabaseFailure(value.error)), true);
      };
      const onError = (cause: unknown): void => finish(() => reject(localFailure(cause)), true);
      const onExit = (code: number): void =>
        finish(
          () => reject(localFailure(new Error(`UserDatabase storage worker exited during startup with code ${code}`))),
          true,
        );
      worker.on("message", onMessage);
      worker.once("error", onError);
      worker.once("exit", onExit);
    });
  }

  request(request: UserDatabaseWorkerRequestWithoutId): Promise<WorkerResult> {
    return this.#closing ? Promise.reject(localFailure(new Error("UserDatabase is closed"))) : this.send(request);
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closing = true;
    this.#closePromise = this.send({ kind: "close" })
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(async () => {
        this.rejectAll(localFailure(new Error("UserDatabase is closed")));
        await this.worker.terminate();
      });
    return this.#closePromise;
  }

  private send(request: UserDatabaseWorkerRequestWithoutId): Promise<WorkerResult> {
    const id = this.#nextId++;
    return new Promise<WorkerResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ ...request, id });
      } catch (cause) {
        this.#pending.delete(id);
        reject(localFailure(cause));
      }
    });
  }

  private rejectAll(failure: UserDatabaseFailure): void {
    for (const pending of this.#pending.values()) pending.reject(failure);
    this.#pending.clear();
  }
}

export interface UserDatabase {
  readonly path: string;
  readonly dispatch: <Request extends UserDatabaseRepositoryRequest>(
    request: Request,
  ) => Effect.Effect<UserDatabaseResultFor<Request>, UserDatabaseFailure>;
}

export interface UserDatabaseOpenOptions {
  readonly home?: string | undefined;
  readonly busyTimeoutMs?: number | undefined;
}

class UserDatabaseRuntime implements UserDatabase {
  readonly path: string;
  private readonly worker: UserDatabaseWorkerClient;
  constructor(path: string, worker: UserDatabaseWorkerClient) {
    this.path = path;
    this.worker = worker;
  }

  readonly dispatch = <Request extends UserDatabaseRepositoryRequest>(
    request: Request,
  ): Effect.Effect<UserDatabaseResultFor<Request>, UserDatabaseFailure> =>
    Effect.tryPromise({
      try: async () => {
        const result = await this.worker.request({ kind: "repository", request });
        if ("kind" in result)
          throw new Error("UserDatabase worker returned a maintenance result for a repository request");
        return result as UserDatabaseResultFor<Request>;
      },
      catch: localFailure,
    });

  close(): Promise<void> {
    return this.worker.close();
  }
}

export const userDatabaseHost = Object.freeze({
  checkFormat: (): Effect.Effect<void, UserDatabaseUnsupported> =>
    Effect.tryPromise({
      try: async () => {
        const paths = userDatabasePaths();
        await access(paths.database);
        const worker = await UserDatabaseWorkerClient.open({
          databasePath: paths.database,
          legacyPath: paths.legacy,
          busyTimeoutMs: 5_000,
          readOnly: true,
        });
        await worker.close();
      },
      catch: localFailure,
    }).pipe(
      Effect.catch((failure) => (failure._tag === "UserDatabaseUnsupported" ? Effect.fail(failure) : Effect.void)),
    ),
  open: (options: UserDatabaseOpenOptions = {}): Effect.Effect<UserDatabase, UserDatabaseFailure, Scope.Scope> => {
    const timeout = options.busyTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) {
      return Effect.fail(
        new UserDatabaseInvalid({
          code: "user-database-invalid",
          message: "UserDatabase busy timeout must be an integer from 1 to 120000ms",
          repository: undefined,
          cause: undefined,
        }),
      );
    }
    const paths = userDatabasePaths({ home: options.home });
    return Effect.acquireRelease(
      Effect.tryPromise({
        try: async () =>
          new UserDatabaseRuntime(
            paths.database,
            await UserDatabaseWorkerClient.open({
              databasePath: paths.database,
              legacyPath: paths.legacy,
              busyTimeoutMs: timeout,
              readOnly: false,
            }),
          ),
        catch: localFailure,
      }),
      (database) => Effect.orDie(Effect.promise(() => database.close())),
    );
  },
});
