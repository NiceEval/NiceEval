/**
 * Node capabilities used by an application host while observing a project.
 * They intentionally do not model a general filesystem: credentials delivery
 * and trusted config-module loading are the two distinct capabilities here.
 */
import { Context, Data, Deferred, Effect, Layer } from "effect";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfigModuleOnce, rebuildConfigModule } from "../load-config.ts";
import type { Config } from "../runner/types.ts";

export class ProjectCredentialsError extends Data.TaggedError("ProjectCredentialsError")<{
  readonly cwd: string;
  readonly operation: "read-dotenv";
  readonly cause: unknown;
}> {}

export class ProjectCredentialsConflict extends Data.TaggedError("ProjectCredentialsConflict")<{
  readonly preparedCwd: string;
  readonly requestedCwd: string;
}> {}

export type ProjectCredentialsFailure = ProjectCredentialsError | ProjectCredentialsConflict;

export interface ProjectCredentialsService {
  /** Deliver missing credential variables from this project's .env exactly once. */
  readonly prepare: (cwd: string) => Effect.Effect<void, ProjectCredentialsFailure>;
}

export class ProjectCredentials extends Context.Tag("niceeval/cli/ProjectCredentials")<
  ProjectCredentials,
  ProjectCredentialsService
>() {}

type CredentialState =
  | { readonly _tag: "idle" }
  | { readonly _tag: "preparing"; readonly cwd: string; readonly done: Deferred.Deferred<void, ProjectCredentialsError> }
  | { readonly _tag: "prepared"; readonly cwd: string };

function normalizedCwd(cwd: string): string {
  return resolve(cwd);
}

function applyMissingEnvironment(raw: string): void {
  for (const line of raw.split("\n")) {
    const entry = line.trim();
    if (entry.length === 0 || entry.startsWith("#")) continue;
    const equals = entry.indexOf("=");
    if (equals < 0) continue;
    const key = entry.slice(0, equals).trim();
    if (key.length === 0 || process.env[key] !== undefined) continue;
    let value = entry.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/** One Layer-owned state machine; failed preparation deliberately returns to idle. */
export const ProjectCredentialsLive = Layer.effect(ProjectCredentials, Effect.gen(function* () {
  let state: CredentialState = { _tag: "idle" };
  const mutex = yield* Effect.makeSemaphore(1);
  const prepare = (inputCwd: string): Effect.Effect<void, ProjectCredentialsFailure> => Effect.suspend(() => {
    const cwd = normalizedCwd(inputCwd);
    return Effect.gen(function* () {
      const fresh = yield* Deferred.make<void, ProjectCredentialsError>();
      // This is the complete atomic decision. No waiting or Node I/O occurs
      // while the semaphore is held, so completion can always re-enter it.
      const decision = yield* mutex.withPermits(1)(Effect.sync(() => {
        if (state._tag === "prepared") {
          return state.cwd === cwd
            ? { _tag: "ready" as const }
            : { _tag: "conflict" as const, preparedCwd: state.cwd };
        }
        if (state._tag === "preparing") {
          return state.cwd === cwd
            ? { _tag: "await" as const, done: state.done }
            : { _tag: "conflict" as const, preparedCwd: state.cwd };
        }
        state = { _tag: "preparing", cwd, done: fresh };
        return { _tag: "start" as const, done: fresh };
      }));
      if (decision._tag === "ready") return;
      if (decision._tag === "conflict") {
        return yield* Effect.fail(new ProjectCredentialsConflict({
          preparedCwd: decision.preparedCwd,
          requestedCwd: cwd,
        }));
      }
      if (decision._tag === "start") {
        // Daemon ownership makes an interrupted initiating caller harmless:
        // it still settles the shared Deferred and restores idle on failure.
        yield* Effect.forkDaemon(Effect.tryPromise({
          try: async () => {
            const path = join(cwd, ".env");
            if (existsSync(path)) applyMissingEnvironment(await readFile(path, "utf8"));
          },
          catch: (cause) => new ProjectCredentialsError({ cwd, operation: "read-dotenv", cause }),
        }).pipe(
          Effect.exit,
          Effect.flatMap((exit) => mutex.withPermits(1)(Effect.gen(function* () {
            if (state._tag === "preparing" && state.done === decision.done) {
              state = exit._tag === "Success" ? { _tag: "prepared", cwd } : { _tag: "idle" };
            }
            yield* Deferred.done(decision.done, exit);
          }))),
        ));
      }
      return yield* Deferred.await(decision.done);
    });
  });
  return { prepare } satisfies ProjectCredentialsService;
}));

export class ConfigModuleLoadError extends Data.TaggedError("ConfigModuleLoadError")<{
  readonly cwd: string;
  readonly operation: "loadOnce" | "rebuild";
  readonly cause: unknown;
}> {}

export interface ConfigModuleLoaderService {
  readonly loadOnce: (cwd: string) => Effect.Effect<Config, ConfigModuleLoadError>;
  readonly rebuild: (cwd: string) => Effect.Effect<Config, ConfigModuleLoadError>;
}

export class ConfigModuleLoader extends Context.Tag("niceeval/cli/ConfigModuleLoader")<
  ConfigModuleLoader,
  ConfigModuleLoaderService
>() {}

/** Serial module loader. A failed rebuild never hands out a previous Config. */
export const ConfigModuleLoaderLive = Layer.effect(ConfigModuleLoader, Effect.gen(function* () {
  let canonical: { cwd: string; config: Config } | undefined;
  const mutex = yield* Effect.makeSemaphore(1);
  const load = (operation: "loadOnce" | "rebuild", inputCwd: string) => mutex.withPermits(1)(Effect.tryPromise({
    try: async () => {
      const cwd = normalizedCwd(inputCwd);
      if (operation === "loadOnce" && canonical?.cwd === cwd) return canonical.config;
      const config = await (operation === "rebuild" ? rebuildConfigModule(cwd) : loadConfigModuleOnce(cwd));
      canonical = { cwd, config };
      return config;
    },
    catch: (cause) => new ConfigModuleLoadError({ cwd: normalizedCwd(inputCwd), operation, cause }),
  }));
  return { loadOnce: (cwd) => load("loadOnce", cwd), rebuild: (cwd) => load("rebuild", cwd) } satisfies ConfigModuleLoaderService;
}));

/** The sole CLI application facade fixes the required credentials → config order. */
export interface ProjectConfigurationService {
  readonly prepare: (cwd: string) => Effect.Effect<void, ProjectCredentialsFailure>;
  readonly load: (cwd: string) => Effect.Effect<Config, ProjectCredentialsFailure | ConfigModuleLoadError>;
  readonly rebuild: (cwd: string) => Effect.Effect<Config, ProjectCredentialsFailure | ConfigModuleLoadError>;
}

export class ProjectConfiguration extends Context.Tag("niceeval/cli/ProjectConfiguration")<
  ProjectConfiguration,
  ProjectConfigurationService
>() {}

/** Application composition only: callers must provide concrete capabilities. */
export const ProjectConfigurationLayer = Layer.effect(ProjectConfiguration, Effect.gen(function* () {
  const credentials = yield* ProjectCredentials;
  const loader = yield* ConfigModuleLoader;
  return {
    prepare: credentials.prepare,
    load: (cwd) => credentials.prepare(cwd).pipe(Effect.zipRight(loader.loadOnce(cwd))),
    rebuild: (cwd) => credentials.prepare(cwd).pipe(Effect.zipRight(loader.rebuild(cwd))),
  } satisfies ProjectConfigurationService;
}));
