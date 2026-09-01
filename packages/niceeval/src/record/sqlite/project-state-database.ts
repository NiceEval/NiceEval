import { Context, Effect, Layer } from "effect";
import { SqliteRecordError } from "./errors.ts";
import { makeStorageWorkerClient, type StorageWorkerClient } from "./client.ts";
import { finalizeInvocationPortable, recordSqlitePath } from "./database.ts";
import type {
  KeptSandboxLeaseRow,
  KeptSandboxRow,
  SharedStateGenerationRow,
  TeardownObligationRow,
} from "./registry-repository.ts";

const OPERATION_DEADLINE_MS = 5_000;

type CommandInput<Tag extends string, Input extends object = object> = Input & { readonly _tag: Tag };

export interface TeardownFacet {
  readonly put: (input: CommandInput<"teardown-put", { readonly id: string; readonly experimentId: string; readonly ownerPid: number; readonly ownerHost: string; readonly payload: Uint8Array }>) => Promise<void>;
  readonly get: (id: string) => Promise<TeardownObligationRow | undefined>;
  readonly list: () => Promise<readonly TeardownObligationRow[]>;
  readonly claim: (id: string) => Promise<boolean>;
}

export interface SharedStateFacet {
  readonly list: (key: string) => Promise<readonly SharedStateGenerationRow[]>;
  readonly append: (input: CommandInput<"shared-append", { readonly key: string; readonly expectedGeneration: number; readonly generation: number; readonly parentGeneration: number; readonly kind: "active" | "recovering" | "free"; readonly ownerToken: string; readonly ownerPid: number; readonly ownerHost: string; readonly ownerProcessIdentity: string; readonly heartbeatAt: string; readonly payload: Uint8Array }>) => Promise<boolean>;
  readonly heartbeat: (input: CommandInput<"shared-heartbeat", { readonly key: string; readonly generation: number; readonly ownerToken: string; readonly heartbeatAt: string }>) => Promise<boolean>;
}

export interface KeepFacet {
  readonly put: (input: CommandInput<"keep-put", { readonly id: string; readonly provider: string; readonly sandboxId: string; readonly keptAt: string; readonly payload: Uint8Array }>) => Promise<void>;
  readonly get: (id: string) => Promise<KeptSandboxRow | undefined>;
  readonly list: () => Promise<readonly KeptSandboxRow[]>;
  readonly update: (id: string, payload: Uint8Array) => Promise<boolean>;
  readonly delete: (id: string) => Promise<void>;
  readonly getLease: (id: string) => Promise<KeptSandboxLeaseRow | undefined>;
  readonly acquireLease: (input: CommandInput<"keep-lease-acquire", { readonly id: string; readonly token: string; readonly holder: string; readonly operation: string; readonly acquiredAt: string; readonly ttlMs: number; readonly ownerPid: number; readonly ownerHost: string; readonly ownerProcessIdentity: string }>) => Promise<{ readonly acquired: true; readonly generation: number } | { readonly acquired: false; readonly lease: KeptSandboxLeaseRow }>;
  readonly releaseLease: (input: CommandInput<"keep-lease-release", { readonly id: string; readonly generation: number; readonly token: string; readonly ownerPid: number; readonly ownerHost: string; readonly ownerProcessIdentity: string }>) => Promise<boolean>;
}

export interface CaseCoordinationFacet {
  readonly execute: <A extends import("./worker-protocol.ts").StorageWorkerResult>(
    command: import("./worker-protocol.ts").CaseCoordinationCommand,
  ) => Promise<A>;
}

export interface InvocationFacet {
  readonly execute: <A extends import("./worker-protocol.ts").StorageWorkerResult>(
    command: import("./worker-protocol.ts").InvocationCommand,
  ) => Promise<A>;
}

export interface RunFacet {
  readonly execute: <A extends import("./worker-protocol.ts").StorageWorkerResult>(
    command: import("./worker-protocol.ts").RunCommand,
  ) => Promise<A>;
}

export interface AdmissionFacet {
  readonly execute: <A extends import("./worker-protocol.ts").StorageWorkerResult>(
    command: import("../../coordination/platform/node-record-admission-protocol.ts").AdmissionInput,
  ) => Promise<A>;
}

export interface ProjectStateFacets {
  readonly record: StorageWorkerClient;
  readonly teardown: TeardownFacet;
  readonly sharedState: SharedStateFacet;
  readonly keep: KeepFacet;
  readonly caseCoordination: CaseCoordinationFacet;
  readonly invocation: InvocationFacet;
  readonly run: RunFacet;
  readonly admission: AdmissionFacet;
}

export interface ProjectStateDatabaseService {
  /** Bind this composition's single storage worker to its one canonical root. */
  readonly bind: (portableRoot: string) => Effect.Effect<ProjectStateFacets, SqliteRecordError>;
  /** Invocation owner only: stop operational commands before its portable gate. */
  readonly closeOperational: (portableRoot: string) => Effect.Effect<void, SqliteRecordError>;
  /** Invocation outer owner only: operational shutdown followed by the unique portable gate. */
  readonly closeInvocationPortable: (portableRoot: string) => Effect.Effect<void, SqliteRecordError>;
}

export class ProjectStateDatabase extends Context.Service<
  ProjectStateDatabase,
  ProjectStateDatabaseService
>()("@niceeval/record/ProjectStateDatabase") {}

interface ProjectStateResource {
  readonly service: ProjectStateDatabaseService;
  readonly close: () => Promise<void>;
}

function makeProjectStateResource(): ProjectStateResource {
  let invocationPortableClosed = false;
  let state:
    | { readonly kind: "unbound" }
    | { readonly kind: "opening"; readonly root: string; readonly client: Promise<StorageWorkerClient> }
    | { readonly kind: "open"; readonly root: string; readonly client: StorageWorkerClient }
    | { readonly kind: "closed" } = { kind: "unbound" };
  const currentState = () => state;

  const open = async (portableRoot: string): Promise<ProjectStateFacets> => {
    if (state.kind === "closed") throw new Error("ProjectStateDatabase is closed");
    if (state.kind !== "unbound" && state.root !== portableRoot) {
      throw new Error("ProjectStateDatabase is already bound to another canonical root");
    }
    const facets = (client: StorageWorkerClient): ProjectStateFacets => {
      const execute = <A extends import("./worker-protocol.ts").StorageWorkerResult>(command: import("./worker-protocol.ts").RegistryCommand) =>
        client.registry<A>(command, Date.now() + OPERATION_DEADLINE_MS);
      const teardown: TeardownFacet = Object.freeze({
        put: (input: Parameters<TeardownFacet["put"]>[0]) => execute<undefined>(input),
        get: (id: string) => execute<TeardownObligationRow | undefined>({ _tag: "teardown-get", id }),
        list: () => execute<readonly TeardownObligationRow[]>({ _tag: "teardown-list" }),
        claim: (id: string) => execute<boolean>({ _tag: "teardown-claim", id }),
      });
      const sharedState: SharedStateFacet = Object.freeze({
        list: (key: string) => execute<readonly SharedStateGenerationRow[]>({ _tag: "shared-list", key }),
        append: (input: Parameters<SharedStateFacet["append"]>[0]) => execute<boolean>(input),
        heartbeat: (input: Parameters<SharedStateFacet["heartbeat"]>[0]) => execute<boolean>(input),
      });
      const keep: KeepFacet = Object.freeze({
        put: (input: Parameters<KeepFacet["put"]>[0]) => execute<undefined>(input),
        get: (id: string) => execute<KeptSandboxRow | undefined>({ _tag: "keep-get", id }),
        list: () => execute<readonly KeptSandboxRow[]>({ _tag: "keep-list" }),
        update: (id: string, payload: Uint8Array) => execute<boolean>({ _tag: "keep-update", id, payload }),
        delete: (id: string) => execute<undefined>({ _tag: "keep-delete", id }),
        getLease: (id: string) => execute<KeptSandboxLeaseRow | undefined>({ _tag: "keep-lease-get", id }),
        acquireLease: (input: Parameters<KeepFacet["acquireLease"]>[0]) => execute<{ readonly acquired: true; readonly generation: number } | { readonly acquired: false; readonly lease: KeptSandboxLeaseRow }>(input),
        releaseLease: (input: Parameters<KeepFacet["releaseLease"]>[0]) => execute<boolean>(input),
      });
      const caseCoordination: CaseCoordinationFacet = Object.freeze({
        execute: <A extends import("./worker-protocol.ts").StorageWorkerResult>(command: import("./worker-protocol.ts").CaseCoordinationCommand) =>
          client.caseCoordination<A>(command),
      });
      const invocation: InvocationFacet = Object.freeze({
        execute: <A extends import("./worker-protocol.ts").StorageWorkerResult>(command: import("./worker-protocol.ts").InvocationCommand) =>
          client.invocation<A>(command),
      });
      const run: RunFacet = Object.freeze({
        execute: <A extends import("./worker-protocol.ts").StorageWorkerResult>(command: import("./worker-protocol.ts").RunCommand) =>
          client.run<A>(command),
      });
      const admission: AdmissionFacet = Object.freeze({
        execute: <A extends import("./worker-protocol.ts").StorageWorkerResult>(command: import("../../coordination/platform/node-record-admission-protocol.ts").AdmissionInput) =>
          client.admission<A>(command),
      });
      return Object.freeze({
        record: client,
        teardown,
        sharedState,
        keep,
        caseCoordination,
        invocation,
        run,
        admission,
      });
    };
    if (state.kind === "open") return facets(state.client);
    if (state.kind === "opening") {
      return facets(await state.client);
    }
    const pending = makeStorageWorkerClient(portableRoot);
    state = { kind: "opening", root: portableRoot, client: pending };
    try {
      const client = await pending;
      if (currentState().kind === "closed") {
        await client.close();
        throw new Error("ProjectStateDatabase closed while its storage worker was opening");
      }
      state = { kind: "open", root: portableRoot, client };
      return facets(client);
    } catch (cause) {
      if (currentState().kind !== "closed") state = { kind: "unbound" };
      throw cause;
    }
  };

  const close = async (expectedRoot?: string): Promise<void> => {
    const current = state;
    if (expectedRoot !== undefined && current.kind !== "unbound" && current.kind !== "closed" && current.root !== expectedRoot) {
      throw new Error("ProjectStateDatabase is bound to another canonical root");
    }
    state = { kind: "closed" };
    if (current.kind === "open") await current.client.close();
    if (current.kind === "opening") await (await current.client).close();
  };

  return {
    service: ProjectStateDatabase.of({
      bind: (portableRoot) => Effect.tryPromise({
        try: () => open(portableRoot),
        catch: (cause) => cause instanceof SqliteRecordError
          ? cause
          : new SqliteRecordError(
            "record-sqlite-error",
            "bind-project-state",
            "failed to bind ProjectStateDatabase",
            { cause },
          ),
      }),
      closeOperational: (portableRoot) => Effect.tryPromise({
        try: () => close(portableRoot),
        catch: (cause) => cause instanceof SqliteRecordError
          ? cause
          : new SqliteRecordError(
            "record-sqlite-error",
            "close-project-state",
            "failed to close ProjectStateDatabase operational worker",
            { cause },
          ),
      }),
      closeInvocationPortable: (portableRoot) => Effect.tryPromise({
        try: async () => {
          if (invocationPortableClosed) return;
          await close(portableRoot);
          // Another Invocation may still own project-local work. In that case
          // the gate atomically restores `open`; the last Invocation to close
          // will retry portability after its own terminal writes.
          finalizeInvocationPortable(recordSqlitePath(portableRoot));
          invocationPortableClosed = true;
        },
        catch: (cause) => cause instanceof SqliteRecordError
          ? cause
          : new SqliteRecordError(
            "record-sqlite-error",
            "close-invocation-portable",
            "failed to close the Invocation ProjectDatabase portable gate",
            { cause },
          ),
      }),
    }),
    close,
  };
}

export const ProjectStateDatabaseLive = Layer.effect(
  ProjectStateDatabase,
  Effect.acquireRelease(
    Effect.sync(makeProjectStateResource),
    (resource) => Effect.promise(() => resource.close().catch(() => undefined)),
  ).pipe(Effect.map((resource) => resource.service)),
);
