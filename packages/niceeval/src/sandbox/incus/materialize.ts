import { randomUUID } from "node:crypto";
import { Effect, Option, Scope } from "effect";
import type { JsonValue } from "../../shared/types.ts";
import { digestOf } from "../identity.ts";
import {
  providerBoundaryEffect,
  type SandboxProviderBackend,
} from "../backend.ts";
import { normalizeSandboxPaths } from "../paths.ts";
import { registerSandbox, unregisterSandbox } from "../registry.ts";
import { withProvisionRetry } from "../retry.ts";
import type { MaterializedSandboxCase } from "../case-types.ts";
import type {
  SandboxProviderCapabilities,
  SandboxProviderModule,
} from "../layer.ts";
import {
  SandboxRuntimeMaterializationError,
  type SandboxRuntimeBuildPreparation,
  type SandboxRuntimeMaterializeContext,
} from "../runtime.ts";
import {
  classifyIncusProvisionError,
  connectIncusMutation,
  INCUS_METADATA,
  isIncusCliTimeout,
  isIncusUnreachable,
  parseIncusSizeBytes,
  type IncusControl,
} from "./control.ts";
import { incusError, isIncusProviderError, type IncusProviderError } from "./errors.ts";
import {
  acquireDomainAdmissionLock,
  currentOwner,
  destroyAllocation,
  executionIdFor,
  instanceNameFor,
  metadataMatchesIntent,
  nextGeneration,
  readAllocationIntent,
  reconcileDomain,
  unionActiveAllocationIds,
  volumeMetadataMatchesIntent,
  volumeNameFor,
  writeAllocationIntent,
  type AllocationIntent,
} from "./ledger.ts";
import type { IncusRuntimePlan } from "./plan.ts";
import { cappedReadinessTimeoutMs, IncusSandbox, waitForReadiness } from "./sandbox.ts";

export const INCUS_PLANNER_REVISION = "incus-vm-1";
export const INCUS_MODULE_ID = "niceeval/incus-vm";

function runtimeFailure(
  context: SandboxRuntimeMaterializeContext,
  cause: unknown,
): SandboxRuntimeMaterializationError {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  return new SandboxRuntimeMaterializationError({
    code: "sandbox.materialization-failed",
    provider: "incus",
    message: error.message,
    cause: error,
  });
}

function wrapBackend(
  backend: SandboxProviderBackend,
  context: SandboxRuntimeMaterializeContext,
  facts: JsonValue,
): MaterializedSandboxCase {
  const provider = context.plan.providerPlan.provider;
  const sandbox = normalizeSandboxPaths(backend, provider);
  registerSandbox(sandbox);
  let stopped = false;
  let stopping: Promise<void> | undefined;
  return Object.freeze({
    sandbox,
    authorBackend: backend,
    group: {
      get primary() {
        return { sandboxId: backend.sandboxId, provider };
      },
      get resources() {
        return { kind: "single", provider, sandboxId: backend.sandboxId };
      },
      async stop() {
        if (stopped) return;
        if (stopping !== undefined) return stopping;
        const pending = (async () => {
          await backend.stop();
          stopped = true;
          unregisterSandbox(sandbox);
        })();
        stopping = pending;
        try {
          await pending;
        } finally {
          if (stopping === pending) stopping = undefined;
        }
      },
    },
    caseKind: context.plan.providerPlan.caseKind,
    caseKey: context.plan.providerPlan.build.caseKey,
    buildKeys: context.plan.providerPlan.build.buildKeys,
    identity: context.plan.providerPlan.identity,
    facts,
  });
}

function requirementDigestOf(context: SandboxRuntimeMaterializeContext): string {
  return digestOf({
    requirements: context.plan.pair.requirements.map((entry) => ({
      owner: { kind: entry.owner.kind, id: entry.owner.id },
      requirement: {
        _tag: entry.requirement._tag,
        docker: {
          api: entry.requirement.docker.api,
          compose: entry.requirement.docker.compose,
          isolation: entry.requirement.docker.isolation,
          minimumDataBytes: entry.requirement.docker.minimumDataBytes,
        },
      },
    })),
  });
}

function configFor(intent: AllocationIntent): Record<string, string> {
  return {
    [INCUS_METADATA.allocationId]: intent.allocationId,
    [INCUS_METADATA.executionId]: intent.executionId,
    [INCUS_METADATA.generation]: String(intent.generation),
    [INCUS_METADATA.artifactDigest]: intent.artifactDigest,
    [INCUS_METADATA.executionDomainId]: intent.executionDomainId,
    [INCUS_METADATA.provisionToken]: intent.provisionToken,
    [INCUS_METADATA.host]: intent.owner.host,
    [INCUS_METADATA.pid]: String(intent.owner.pid),
    [INCUS_METADATA.startedAt]: intent.owner.startedAt,
  };
}

async function createReadySandbox(
  control: IncusControl,
  plan: IncusRuntimePlan,
  context: SandboxRuntimeMaterializeContext,
  signal?: AbortSignal,
): Promise<IncusSandbox> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Incus materialize aborted");
  }
  await control.assertGuestInitMountsBlockDockerData(plan.project, plan.imageFingerprint);
  const lock = await acquireDomainAdmissionLock(plan.executionDomainId);
  let reserved: AllocationIntent | undefined;
  try {
    const { intents, instances } = await reconcileDomain(control, {
      executionDomainId: plan.executionDomainId,
      project: plan.project,
      storagePool: plan.storagePool,
    });
    const volumes = await control.listVolumes(plan.project, plan.storagePool);
    const active = unionActiveAllocationIds(intents, instances, {
      executionDomainId: plan.executionDomainId,
      project: plan.project,
    }, volumes).size;
    if (active >= plan.maxInstances) {
      throw incusError(
        "sandbox-capacity-unavailable",
        `Incus domain ${JSON.stringify(plan.executionDomainId)} has no free allocation at create time.`,
        ["Wait for in-flight allocations to destroy."],
      );
    }
    const allocationId = randomUUID();
    const executionId = executionIdFor(allocationId);
    const previous = await readAllocationIntent(allocationId);
    const generation = nextGeneration(previous);
    const provisionToken = randomUUID();
    reserved = await writeAllocationIntent({
      allocationId,
      executionId,
      provider: "incus",
      generation,
      requirementDigest: requirementDigestOf(context),
      artifactDigest: plan.imageFingerprint,
      requestedDockerDataBytes: plan.allocatedDockerDataBytes,
      executionDomainId: plan.executionDomainId,
      project: plan.project,
      storagePool: plan.storagePool,
      provisionToken,
      owner: currentOwner(),
      expectedTerminal: "destroyed",
      state: "reserved",
    });
  } finally {
    lock.release();
  }

  if (reserved === undefined) {
    throw incusError(
      "sandbox-allocation-lost",
      "Incus allocation was not reserved before create.",
      ["Retry materialize; do not create a VM without a durable ledger intent."],
    );
  }
  const name = instanceNameFor(reserved.allocationId);
  const volumeName = volumeNameFor(reserved.allocationId);
  const creating = await writeAllocationIntent({
    ...reserved,
    state: "creating",
    providerLocator: name,
    dockerDataVolume: volumeName,
  });
  const cpus = plan.resources.cpus;
  const memoryBytes = plan.resources.memoryBytes;
  let createStage: "volume-create" | "instance-create" | "known" = "volume-create";
  try {
    await control.createVolume({
      project: plan.project,
      pool: plan.storagePool,
      name: volumeName,
      contentType: "block",
      sizeBytes: plan.allocatedDockerDataBytes,
      config: configFor(creating),
    });
    const createdVolume = await control.getVolume(plan.project, plan.storagePool, volumeName);
    if (
      createdVolume === undefined
      || createdVolume.contentType !== "block"
      || !volumeMetadataMatchesIntent(createdVolume, creating)
      || parseIncusSizeBytes(createdVolume.config.size) !== plan.allocatedDockerDataBytes
    ) {
      throw incusError(
        "sandbox-artifact-unverified",
        `Incus Docker data volume ${JSON.stringify(volumeName)} did not round-trip type, size, and allocation metadata.`,
        ["Destroy the volume and retry; NiceEval will not attach an unverified Docker data disk."],
      );
    }
    createStage = "instance-create";
    await control.createInstance({
      name,
      project: plan.project,
      fingerprint: plan.imageFingerprint,
      storagePool: plan.storagePool,
      network: plan.network,
      config: {
        ...configFor(creating),
        ...(cpus === undefined ? {} : { "limits.cpu": String(cpus) }),
        ...(memoryBytes === undefined ? {} : { "limits.memory": `${memoryBytes}` }),
      },
      dockerDataVolume: volumeName,
      dockerDataContentType: "block",
    });
    const created = await control.getInstance(plan.project, name);
    if (created === undefined) {
      throw incusError(
        "sandbox-allocation-lost",
        `Incus instance ${JSON.stringify(name)} was not present after create.`,
        ["Inspect Incus inventory; do not recreate from a guessed locator."],
      );
    }
    if (!metadataMatchesIntent(created, creating)) {
      throw incusError(
        "sandbox-artifact-unverified",
        `Incus instance ${JSON.stringify(name)} metadata did not round-trip allocation identity.`,
        ["Destroy the instance and retry; do not adopt an object with mismatched generation."],
      );
    }
    createStage = "known";
    await control.startInstance(plan.project, name);
    const located = await writeAllocationIntent({
      ...creating,
      providerLocator: name,
      dockerDataVolume: volumeName,
      state: "creating",
    });
    const readyTimeout = cappedReadinessTimeoutMs(
      context.deadline._tag === "Unlimited" ? undefined : context.deadline.deadlineAt,
    );
    await waitForReadiness(control, plan, name, located, readyTimeout, signal);
    const ready = await writeAllocationIntent({ ...located, state: "ready" });
    return new IncusSandbox(
      control,
      plan,
      name,
      ready,
      context.deadline._tag === "Unlimited" ? undefined : context.deadline.timeoutMs,
      context.deadline._tag === "Unlimited" ? undefined : context.deadline.deadlineAt,
    );
  } catch (cause) {
    let toDestroy = await readAllocationIntent(creating.allocationId) ?? creating;
    if (isIncusCliTimeout(cause) || isIncusUnreachable(cause)) {
      if (createStage !== "known") {
        await writeAllocationIntent({
          ...toDestroy,
          state: "destroy-requested",
          quarantined: true,
          acceptanceUnknown: createStage,
          providerLocator: name,
          dockerDataVolume: volumeName,
        });
        throw cause;
      }
    }
    try {
      await destroyAllocation(control, toDestroy, plan.project);
    } catch (destroyCause) {
      throw destroyCause;
    }
    throw cause;
  }
}

export function materializeIncusProviderPlan(
  plan: IncusRuntimePlan,
  context: SandboxRuntimeMaterializeContext,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError, Scope.Scope> {
  return Effect.gen(function* () {
    if (context.admission._tag === "Bound") yield* context.admission.value.granted;
    const control = yield* connectIncusMutation().pipe(Effect.mapError((cause) => runtimeFailure(context, cause)));
    const backend = yield* withProvisionRetry(
      providerBoundaryEffect((signal) => createReadySandbox(control, plan, context, signal)),
      classifyIncusProvisionError,
      context.provisionSlot._tag === "Bound" ? context.provisionSlot.value : undefined,
      context.feedback,
      providerBoundaryEffect(async () => {
        await reconcileDomain(control, {
          executionDomainId: plan.executionDomainId,
          project: plan.project,
          storagePool: plan.storagePool,
        });
      }),
    ).pipe(Effect.mapError((cause) => runtimeFailure(context, cause)));
    return yield* Effect.try({
      try: () => wrapBackend(backend, context, Object.freeze({
        instance: backend.sandboxId,
        project: plan.project,
        storagePool: plan.storagePool,
        executionDomainId: plan.executionDomainId,
        imageFingerprint: plan.imageFingerprint,
      })),
      catch: (cause) => runtimeFailure(context, cause),
    }).pipe(
      Effect.tapError(() => providerBoundaryEffect(() => backend.stop()).pipe(Effect.ignore)),
    );
  }).pipe(Effect.mapError((cause) => runtimeFailure(context, cause)));
}

export function incusProviderModule(
  dockerExecution: SandboxProviderCapabilities["dockerExecution"],
): SandboxProviderModule<IncusRuntimePlan> {
  return Object.freeze({
    id: INCUS_MODULE_ID,
    capabilities: Object.freeze({
      retention: Object.freeze({ _tag: "DestroyOnly" as const }),
      reuse: Object.freeze({
        _tag: "Unsupported" as const,
        reason: "Incus V1 sandboxes are disposable VMs and do not support reuse.",
      }),
      setupPrefix: Object.freeze({ _tag: "InvocationLocal" as const }),
      sessionLimit: Object.freeze({ _tag: "Unlimited" as const }),
      ...(dockerExecution === undefined ? {} : { dockerExecution }),
    }),
    materialize: (plan: IncusRuntimePlan, context: SandboxRuntimeMaterializeContext) =>
      materializeIncusProviderPlan(plan, context),
    collectBuildPreparation: (): Effect.Effect<
      Option.Option<SandboxRuntimeBuildPreparation>,
      SandboxRuntimeMaterializationError
    > => Effect.succeed(Option.none()),
  });
}

export function toPlanningError(cause: unknown): IncusProviderError {
  return isIncusProviderError(cause)
    ? cause
    : incusError(
        "incus-unreachable",
        cause instanceof Error ? cause.message : String(cause),
        ["Make the Incus control plane reachable and retry."],
        cause,
      );
}
