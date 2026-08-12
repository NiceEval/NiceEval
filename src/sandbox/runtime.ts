// ProviderModule 的唯一运行入口：core 只调用 plan 私绑的闭包，不解释 adapter 名或 JSON runtime input。

import { randomUUID } from "node:crypto";
import { Data, Effect, Option, type Scope } from "effect";
import type { ProvisionSlot } from "./retry.ts";
import { withProvisionRetry } from "./retry.ts";
import type {
  MaterializedSandboxCase,
  SandboxResourceGroup,
  ServiceController,
} from "./case-types.ts";
import {
  collectComposeBuilds,
  composeCollectionIdentity,
  dockerComposeBuildProvider,
  materializeDockerComposeProviderCase,
  normalizeBuildPlatform,
} from "./compose.ts";
import { collectDockerfileBuildFromIdentity, dockerfileBuildProvider } from "./dockerfile-build.ts";
import {
  DockerfileAgentImageCoordinator,
  isDockerfileAgentCacheSafeInstaller,
  type DockerfileAgentCacheRequest,
  type DockerfileAgentDerivedImageBuildInput,
} from "./dockerfile-agent-cache.ts";
import type { SandboxBuildProvider, SandboxBuildWork } from "./build-coordinator.ts";
import {
  customSandboxBackend,
  providerBoundaryEffect,
  type SandboxProviderBackend,
} from "./backend.ts";
import { normalizeSandboxPaths } from "./paths.ts";
import { registerSandbox, unregisterSandbox } from "./registry.ts";
import { currentRunIdentity } from "./run-identity.ts";
import {
  sandboxProviderBindingOf,
  type SandboxProviderBinding,
  type CustomCaseProviderPlan,
  type CustomCaseMaterializeResult,
  type CustomCaseSandboxOptions,
  type CustomCaseServices,
  type CustomProviderPlan,
  type CustomProviderSandboxOptions,
  type DockerComposeProviderPlan,
  type DockerfileProviderPlan,
  type DockerImageProviderPlan,
  type E2BProviderPlan,
  type LocalProviderPlan,
  type SandboxProviderCapabilities,
  type SandboxProviderLifetime,
  type SandboxProviderPlan,
  type SandboxRuntimeDeadlineDeclaration,
  type VercelProviderPlan,
} from "./layer.ts";
import { digestOf, isPureDataIdentity, type BuildKey } from "./identity.ts";
import type { LinkedRunPlan } from "./plan.ts";
import { ArtifactPrepareCoordinator, platformKey, runAgentEnsure } from "../agents/provisioner.ts";
import { CLEANUP_TIMEOUT_MS, cleanupCallback } from "../runner/cleanup-timeout.ts";
import type { JsonValue, Sandbox, SandboxHook, SandboxHookContext, ScopedFeedback } from "../types.ts";
import type { AgentIdentity, SandboxAgent } from "../agents/types.ts";
import type { DockerSandbox } from "./docker.ts";
import type { E2BSandboxLifetime } from "./e2b.ts";
import {
  acquireDockerProfileReservation,
  commitDockerProfileReservation,
  createDockerProfileLease,
  releaseDockerProfileReservation,
  type DockerProfileLease,
  type DockerProfileRuntimeBinding,
} from "./docker-profile/runtime.ts";

export type SandboxRuntimeDeadline = SandboxRuntimeDeadlineDeclaration;

/** Scope 退出时的唯一释放协议；不以 optional callback 或 boolean 表达所有权。 */
export type SandboxRuntimeRelease =
  | { readonly _tag: "Stop" }
  | {
      readonly _tag: "Managed";
      readonly run: (owned: MaterializedSandboxCase) => Effect.Effect<void>;
    };

export interface SandboxRuntimeMaterializeInput {
  readonly plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>;
  readonly evalId: string;
  readonly deadline: SandboxRuntimeDeadline;
  readonly feedback: ScopedFeedback;
  readonly signal: AbortSignal;
  /** 物理实例 hook 的完成态上下文；由 fresh attempt 或 reuse pool 在创建边界绑定。 */
  readonly hookContext: SandboxHookContext;
  readonly buildLocators: ReadonlyMap<BuildKey, JsonValue>;
  readonly provisionSlot:
    | { readonly _tag: "Detached" }
    | { readonly _tag: "Bound"; readonly value: ProvisionSlot };
  readonly services: SandboxRuntimeServices;
  /** Internal runner input; only Dockerfile provider consumes the staged cache opt-in. */
  readonly agent?: SandboxAgent;
  /** Invocation-level timing tree for derived Dockerfile Agent image lookup/build. */
  readonly runTiming?: import("../runner/timing.ts").RunTimingRecorder;
  readonly release: SandboxRuntimeRelease;
}

/** ProviderModule 闭包收到的完整上下文；公开 plan 只提供中性 identity/scheduling 元数据。 */
export type SandboxRuntimeMaterializeContext = Omit<SandboxRuntimeMaterializeInput, "release">;

export type SandboxRuntimeServices =
  | { readonly _tag: "Live" }
  | {
      readonly _tag: "Test";
      readonly materializeCompose: typeof materializeDockerComposeProviderCase;
    };

export const liveSandboxRuntimeServices: SandboxRuntimeServices = Object.freeze({ _tag: "Live" });

const dockerfileAgentImageCoordinator = new DockerfileAgentImageCoordinator({
  imageExists: defaultDockerImageExists,
});

export interface SandboxRuntimeCapabilities {
  readonly provider: string;
  readonly schedulingLane: string;
  readonly admission: "Shared" | "Exclusive";
  readonly retention: SandboxProviderCapabilities["retention"];
  readonly reuse: SandboxProviderCapabilities["reuse"];
  readonly sessionLimit: SandboxProviderCapabilities["sessionLimit"];
}

export interface SandboxRuntimeBuildPreparation {
  readonly works: readonly SandboxBuildWork[];
  readonly provider: SandboxBuildProvider;
}

export class SandboxRuntimeMaterializationError extends Data.TaggedError(
  "SandboxRuntimeMaterializationError",
)<{
  readonly code:
    | "sandbox.provider-binding-missing"
    | "sandbox.build-input-drift"
    | "sandbox.build-locator-missing"
    | "sandbox.materialization-failed";
  readonly provider: string;
  readonly message: string;
  readonly cause: Error;
}> {}

function runtimeFailure(
  context: SandboxRuntimeMaterializeContext,
  code: SandboxRuntimeMaterializationError["code"],
  cause: unknown,
): SandboxRuntimeMaterializationError {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  return new SandboxRuntimeMaterializationError({
    code,
    provider: context.plan.providerPlan.provider,
    message: error.message,
    cause: error,
  });
}

function buildFailure(
  plan: SandboxProviderPlan,
  code: SandboxRuntimeMaterializationError["code"],
  cause: unknown,
): SandboxRuntimeMaterializationError {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  return new SandboxRuntimeMaterializationError({
    code,
    provider: plan.provider,
    message: error.message,
    cause: error,
  });
}

function providerBinding(
  plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
): Effect.Effect<SandboxProviderBinding, SandboxRuntimeMaterializationError> {
  const binding = sandboxProviderBindingOf(plan.providerPlan);
  return Option.match(binding, {
    onNone: () => Effect.fail(new SandboxRuntimeMaterializationError({
      code: "sandbox.provider-binding-missing",
      provider: plan.providerPlan.provider,
      message: `Sandbox provider plan ${JSON.stringify(plan.providerPlan.provider)} was not created by its bound ProviderModule.`,
      cause: new Error("provider module binding missing"),
    })),
    onSome: Effect.succeed,
  });
}

function deadlineOptions(deadline: SandboxRuntimeDeadline): {
  readonly timeout?: number;
  readonly deadlineAt?: number;
} {
  return deadline._tag === "Unlimited"
    ? {}
    : { timeout: deadline.timeoutMs, deadlineAt: deadline.deadlineAt };
}

function configuredLifetime(
  value: SandboxProviderLifetime,
): number | undefined {
  return value._tag === "Configured" ? value.milliseconds : undefined;
}

async function managedContainerSession(
  binding: DockerProfileRuntimeBinding,
  resources: Readonly<import("./layer.ts").DockerSandboxResources>,
): Promise<{
  readonly lease: DockerProfileLease;
  readonly reservation: import("./docker-profile/runtime.ts").DockerProfileReservation;
  readonly labels: Readonly<Record<string, string>>;
  readonly finish: () => Promise<void>;
}> {
  const lease = await createDockerProfileLease(binding);
  try {
    const reservation = await acquireDockerProfileReservation(lease, "container", {
      cpus: resources.cpus ?? 0,
      memoryBytes: resources.memoryBytes ?? 0,
      pids: resources.pidsLimit ?? 0,
      containers: 1,
    });
    const labels = Object.freeze({
      "niceeval.profile-id": binding.profile.profileId,
      "niceeval.invocation-id": lease.invocationId,
      "niceeval.reservation-id": reservation.reservationId,
      "niceeval.provision-token": reservation.provisionToken,
    });
    let finished = false;
    return {
      lease,
      reservation,
      labels,
      finish: async () => {
        if (finished) return;
        finished = true;
        try {
          await releaseDockerProfileReservation(lease, reservation.reservationId);
        } finally {
          await lease.stopHeartbeat();
        }
      },
    };
  } catch (error) {
    await lease.stopHeartbeat().catch(() => undefined);
    throw error;
  }
}

/**
 * E2B 的 SDK 默认 TTL 不是 attempt 时限的一个来源。bounded attempt 在创建时必须把
 * deadline 加收尾预留写进 provider；作者另有声明时，它是上限承诺而不是可被静默加长的 hint。
 */
export function e2bLifetimeRequest(
  lifetime: SandboxProviderLifetime,
  deadline: SandboxRuntimeDeadline,
): E2BSandboxLifetime {
  const declared = configuredLifetime(lifetime);
  if (deadline._tag === "Unlimited") {
    return declared === undefined
      ? { _tag: "ProviderDefault" }
      : { _tag: "Requested", milliseconds: declared, source: "explicit" };
  }

  const required = deadline.timeoutMs + CLEANUP_TIMEOUT_MS;
  if (declared !== undefined) {
    if (declared < required) {
      throw new Error(
        `e2bSandbox lifetimeMs=${declared}ms is shorter than this attempt's required ${required}ms ` +
          `(timeoutMs=${deadline.timeoutMs}ms plus cleanup reserve ${CLEANUP_TIMEOUT_MS}ms). ` +
          "Increase lifetimeMs or lower timeoutMs; niceeval will not silently lengthen a declared sandbox lifetime.",
      );
    }
    return { _tag: "Requested", milliseconds: declared, source: "explicit" };
  }
  return { _tag: "Requested", milliseconds: required, source: "attempt-deadline" };
}

function boundProvisionSlot(context: SandboxRuntimeMaterializeContext): ProvisionSlot | undefined {
  return context.provisionSlot._tag === "Bound" ? context.provisionSlot.value : undefined;
}

function wrapSingleSandbox(
  backend: SandboxProviderBackend,
  context: SandboxRuntimeMaterializeContext,
  facts: JsonValue,
): MaterializedSandboxCase {
  const provider = context.plan.providerPlan.provider;
  const sandbox = normalizeSandboxPaths(backend, provider);
  registerSandbox(sandbox);
  let stopped = false;
  let stopping: Promise<void> | undefined;
  const group: SandboxResourceGroup = {
    primary: { sandboxId: sandbox.sandboxId, provider },
    resources: { kind: "single", provider, sandboxId: sandbox.sandboxId },
    async stop() {
      if (stopped) return;
      if (stopping !== undefined) return stopping;
      const pending = (async () => {
        // runtime 的 finalizer 通过 providerBoundaryEffect(group.stop) 执行这条 provider Promise；
        // 不要从内部反向启动 Sandbox 的外层运行时。
        await backend.stop();
        stopped = true;
        unregisterSandbox(sandbox);
      })();
      stopping = pending;
      try {
        await pending;
      } finally {
        // stop 失败回到 Open，保留 registry 所有权；成功则进入不可逆的 Stopped。
        if (stopping === pending) stopping = undefined;
      }
    },
  };
  return Object.freeze({
    sandbox,
    group,
    caseKind: context.plan.providerPlan.caseKind,
    caseKey: context.plan.providerPlan.build.caseKey,
    buildKeys: context.plan.providerPlan.build.buildKeys,
    identity: context.plan.providerPlan.identity,
    facts,
  });
}

function normalizeMaterialized(
  materialized: MaterializedSandboxCase,
  context: SandboxRuntimeMaterializeContext,
): MaterializedSandboxCase {
  const sandbox = normalizeSandboxPaths(
    customSandboxBackend(materialized.sandbox),
    context.plan.providerPlan.provider,
  );
  registerSandbox(sandbox);
  let stopped = false;
  let stopping: Promise<void> | undefined;
  const group: SandboxResourceGroup = {
    ...materialized.group,
    async stop() {
      if (stopped) return;
      if (stopping !== undefined) return stopping;
      const pending = (async () => {
        await materialized.group.stop();
        stopped = true;
        unregisterSandbox(sandbox);
      })();
      stopping = pending;
      try {
        await pending;
      } finally {
        // 失败回 Open 并保留 registry 所有权，让同轮强清或 orphan 恢复链真正重试。
        if (stopping === pending) stopping = undefined;
      }
    },
  };
  return Object.freeze({ ...materialized, sandbox, group });
}

function materializationEffect(
  context: SandboxRuntimeMaterializeContext,
  acquire: () => Promise<MaterializedSandboxCase>,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  return Effect.tryPromise({
    try: acquire,
    catch: (cause) => runtimeFailure(context, "sandbox.materialization-failed", cause),
  });
}

export function materializeDockerComposeProviderPlan(
  plan: DockerComposeProviderPlan,
  context: SandboxRuntimeMaterializeContext,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  const materialize = context.services._tag === "Live"
    ? materializeDockerComposeProviderCase
    : context.services.materializeCompose;
  return materializationEffect(context, async () => normalizeMaterialized(await materialize({
    evalId: context.evalId,
    profile: context.evalId,
    mainService: plan.workspaceService,
    ...(plan.user._tag === "Configured" ? { user: plan.user.value } : {}),
    env: plan.env,
    pathPrepend: plan.pathPrepend,
    collection: plan.collection,
    caseKey: context.plan.providerPlan.build.caseKey,
    identity: context.plan.providerPlan.identity,
  }, {
    ctx: {
      evalId: context.evalId,
      profile: context.evalId,
      signal: context.signal,
      buildLocators: context.buildLocators,
    },
    ...deadlineOptions(context.deadline),
    feedback: context.feedback,
    provisionSlot: boundProvisionSlot(context),
    lifetimeMs: configuredLifetime(plan.lifetime),
  }), context));
}

export function materializeDockerfileProviderPlan(
  plan: DockerfileProviderPlan,
  context: SandboxRuntimeMaterializeContext,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  return Option.match(Option.fromNullable(context.buildLocators.get(plan.buildKey)), {
    onNone: () => Effect.fail(runtimeFailure(
      context,
      "sandbox.build-locator-missing",
      new Error(`Dockerfile build ${plan.buildKey} has no prepared locator.`),
    )),
    onSome: (locator) => typeof locator !== "string"
      ? Effect.fail(runtimeFailure(
          context,
          "sandbox.materialization-failed",
          new TypeError(`Dockerfile build locator for ${plan.buildKey} must be a string.`),
        ))
      : Effect.flatMap(
        resolveDockerfileAgentImage(plan, context, locator).pipe(
          Effect.mapError((cause) => runtimeFailure(context, "sandbox.materialization-failed", cause)),
        ),
        (resolved) => Effect.flatMap(
          Effect.try({
            try: () => context.hookContext.fact("agent.image.cache", resolved.status),
            catch: (cause) => runtimeFailure(context, "sandbox.materialization-failed", cause),
          }),
          () => materializationEffect(context, async () => {
            const { DockerSandbox, classifyProvisionError, reconcileProvision } = await import("./docker.ts");
            const managed = plan.profileBinding === undefined
              ? undefined
              : await managedContainerSession(plan.profileBinding, plan.resources);
            const provisionToken = managed?.reservation.provisionToken ?? randomUUID();
            let backend: DockerSandbox;
            try {
              backend = await withProvisionRetry(
                () => DockerSandbox.create({
                  ...deadlineOptions(context.deadline),
                  runtime: "node24",
                  image: resolved.locator,
                  ...(plan.user._tag === "Configured" ? { user: plan.user.value } : {}),
                  privileged: plan.privileged,
                  ...(plan.dockerAccess === undefined ? {} : { dockerAccess: plan.dockerAccess }),
                  resources: plan.resources,
                  ...(plan.readiness === undefined ? {} : { readiness: plan.readiness }),
                  lifetimeMs: configuredLifetime(plan.lifetime),
                  pathPrepend: plan.pathPrepend,
                  feedback: context.feedback,
                  provisionToken,
                  runIdentity: currentRunIdentity(),
                  ...(plan.profileBinding === undefined ? {} : {
                    dockerSocketPath: plan.profileBinding.dockerSocketPath,
                    dns: plan.profileBinding.profile.policy.network.dns.servers,
                    managedLabels: managed?.labels,
                    rootlessAttestation: {
                      daemonId: plan.profileBinding.daemonId,
                      dataRoot: plan.profileBinding.profile.backend.filesystem.dockerRootDir,
                    },
                    afterStop: managed?.finish,
                  }),
                }),
                classifyProvisionError,
                boundProvisionSlot(context),
                context.feedback,
                () => reconcileProvision(provisionToken, plan.profileBinding?.dockerSocketPath),
              );
              if (managed !== undefined) {
                await commitDockerProfileReservation(managed.lease, managed.reservation.reservationId, {
                  containerId: backend.sandboxId,
                  ...(backend.managedNetworkId === undefined ? {} : { networkId: backend.managedNetworkId }),
                  attemptId: context.evalId,
                });
              }
            } catch (error) {
              await managed?.finish().catch(() => undefined);
              throw error;
            }
            return wrapSingleSandbox(backend, context, { image: resolved.locator });
          }),
        ),
      ),
  });
}

function defaultDockerImageExists(locator: string): Effect.Effect<boolean> {
  // dockerode 是 optional peer；只在 Dockerfile Agent 缓存路径真查镜像时加载。
  // 缺少 peer、daemon 不可用和镜像不存在在此 lookup 的语义里都只是 cache miss。
  return providerBoundaryEffect(async () => {
    const { default: Docker } = await import("dockerode");
    await new Docker().getImage(locator).inspect();
    return true;
  }).pipe(Effect.catchAll(() => Effect.succeed(false)));
}

function resolveDockerfileAgentImage(
  plan: DockerfileProviderPlan,
  context: SandboxRuntimeMaterializeContext,
  taskLocator: string,
): Effect.Effect<{ readonly status: "hit" | "built" | "unsupported"; readonly locator: string }, Error> {
  // Derived Agent image coordination is still bound to the default Docker endpoint.
  // A profile Dockerfile must never cross daemons, so consume the task image directly.
  if (plan.profileBinding !== undefined || plan.dockerAccess !== undefined) {
    return Effect.succeed({ status: "unsupported", locator: taskLocator });
  }
  const request = dockerfileAgentCacheRequest(
    plan,
    context.agent,
    taskLocator,
    context.plan.providerPlan.target.platform,
  );
  if (request === undefined) return Effect.succeed({ status: "unsupported", locator: taskLocator });
  return dockerfileAgentImageCoordinator.resolve(
    request,
    context.signal,
    (input, signal) => buildDockerfileAgentImage(
      input,
      request,
      context.plan.providerPlan.target.platform,
      signal,
    ),
    context.runTiming,
  );
}

function dockerfileAgentCacheRequest(
  plan: DockerfileProviderPlan,
  agent: SandboxAgent | undefined,
  taskLocator: string,
  targetPlatform: import("../agents/types.ts").AgentArtifactPlatform,
): DockerfileAgentCacheRequest | undefined {
  if (agent === undefined || agent.ensure.length !== 1) return undefined;
  const ensure = agent.ensure[0];
  if (ensure === undefined) return undefined;
  const installer = agent.installers.find((candidate) =>
    candidate.installMode === "staged" &&
    isDockerfileAgentCacheSafeInstaller(candidate) &&
    sameAgentIdentity(candidate.identity, ensure.identity)
  );
  if (installer === undefined) return undefined;
  return {
    taskLocator,
    platform: `${plan.platform}|${platformKey(targetPlatform)}`,
    ensure,
    installer,
  };
}

function sameAgentIdentity(a: AgentIdentity, b: AgentIdentity): boolean {
  return a.agent === b.agent && a.version === b.version && a.revision === b.revision;
}

function buildDockerfileAgentImage(
  input: DockerfileAgentDerivedImageBuildInput,
  request: DockerfileAgentCacheRequest,
  targetPlatform: import("../agents/types.ts").AgentArtifactPlatform,
  signal: AbortSignal,
): Effect.Effect<void, Error> {
  return buildDockerfileAgentImageWithServices(input, request, targetPlatform, signal);
}

export interface DockerfileAgentImageProvisionSandbox {
  readonly operations: import("./types.ts").SandboxOperations;
  readonly sandboxId: string;
  stop(): Promise<void>;
}

export interface DockerfileAgentImageProvisionServices {
  readonly create: (taskLocator: string) => Effect.Effect<DockerfileAgentImageProvisionSandbox, Error>;
  readonly commit: (sandboxId: string, derivedLocator: string) => Effect.Effect<void, Error>;
}

const liveDockerfileAgentImageProvisionServices: DockerfileAgentImageProvisionServices = Object.freeze({
  create: (taskLocator: string) => providerBoundaryEffect(async () => {
    const { DockerSandbox } = await import("./docker.ts");
    const sandbox = await DockerSandbox.create({ image: taskLocator, runtime: "node24" });
    return { operations: sandbox, sandboxId: sandbox.sandboxId, stop: () => sandbox.stop() };
  }),
  commit: (sandboxId: string, derivedLocator: string) => providerBoundaryEffect(async () => {
    // dockerode 是 optional peer；commit 派生镜像时才加载（与 keep/orphans 同模式）。
    const { default: Docker } = await import("dockerode");
    await new Docker().getContainer(sandboxId).commit(dockerCommitReference(derivedLocator));
  }),
});

/** Dockerode 的 commit 参数把仓库与 tag 分开；不能把 `repo:tag` 整串塞进 repo。 */
export function dockerCommitReference(locator: string): { readonly repo: string; readonly tag?: string } {
  const slash = locator.lastIndexOf("/");
  const colon = locator.lastIndexOf(":");
  if (colon > slash) {
    return { repo: locator.slice(0, colon), tag: locator.slice(colon + 1) };
  }
  return { repo: locator };
}

export function buildDockerfileAgentImageWithServices(
  input: DockerfileAgentDerivedImageBuildInput,
  request: DockerfileAgentCacheRequest,
  targetPlatform: import("../agents/types.ts").AgentArtifactPlatform,
  signal: AbortSignal,
  services: DockerfileAgentImageProvisionServices = liveDockerfileAgentImageProvisionServices,
): Effect.Effect<void, Error> {
  return Effect.scoped(Effect.gen(function* () {
    // AbortSignal 属于外层 invocation 的中断语义；绝不伪造为一个 typed provisioning error。
    if (signal.aborted) return yield* Effect.interrupt;
    const provisioned = yield* Effect.acquireRelease(
      services.create(input.taskLocator),
      // acquireRelease finalizer 必须是 never-fail。这里仍尝试真实 stop；它失败时保留原有
      // build cause，而不是在 cleanup 路径把 interruption/defect 改写成 typed failure。
      (sandbox) => providerBoundaryEffect(() => sandbox.stop()).pipe(Effect.catchAll(() => Effect.void)),
    );
    yield* runAgentEnsure(
      [request.ensure],
      [request.installer],
      provisioned.operations,
      {
        fact: () => {},
        coordinator: Option.some(new ArtifactPrepareCoordinator()),
        targetPlatform,
        signal,
        progress: () => {},
      },
    );
    yield* services.commit(provisioned.sandboxId, input.derivedLocator);
  }));
}

export function materializeDockerImageProviderPlan(
  plan: DockerImageProviderPlan,
  context: SandboxRuntimeMaterializeContext,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  return materializationEffect(context, async () => {
    const { DockerSandbox, classifyProvisionError, reconcileProvision } = await import("./docker.ts");
    const managed = plan.profileBinding === undefined
      ? undefined
      : await managedContainerSession(plan.profileBinding, plan.resources);
    const provisionToken = managed?.reservation.provisionToken ?? randomUUID();
    let backend: DockerSandbox;
    try {
      backend = await withProvisionRetry(
        () => DockerSandbox.create({
        ...deadlineOptions(context.deadline),
        runtime: "node24",
        image: plan.image,
        ...(plan.user._tag === "Configured" ? { user: plan.user.value } : {}),
        privileged: plan.privileged,
        ...(plan.dockerAccess === undefined ? {} : { dockerAccess: plan.dockerAccess }),
        resources: plan.resources,
        ...(plan.readiness === undefined ? {} : { readiness: plan.readiness }),
        lifetimeMs: configuredLifetime(plan.lifetime),
        pathPrepend: plan.pathPrepend,
        feedback: context.feedback,
        provisionToken,
        runIdentity: currentRunIdentity(),
        ...(plan.profileBinding === undefined ? {} : {
          dockerSocketPath: plan.profileBinding.dockerSocketPath,
          dns: plan.profileBinding.profile.policy.network.dns.servers,
          managedLabels: managed?.labels,
          rootlessAttestation: {
            daemonId: plan.profileBinding.daemonId,
            dataRoot: plan.profileBinding.profile.backend.filesystem.dockerRootDir,
          },
          afterStop: managed?.finish,
        }),
      }),
      classifyProvisionError,
      boundProvisionSlot(context),
      context.feedback,
        () => reconcileProvision(provisionToken, plan.profileBinding?.dockerSocketPath),
      );
      if (managed !== undefined) {
        await commitDockerProfileReservation(managed.lease, managed.reservation.reservationId, {
          containerId: backend.sandboxId,
          ...(backend.managedNetworkId === undefined ? {} : { networkId: backend.managedNetworkId }),
          attemptId: context.evalId,
        });
      }
    } catch (error) {
      await managed?.finish().catch(() => undefined);
      throw error;
    }
    return wrapSingleSandbox(backend, context, { image: plan.image });
  });
}

export function materializeE2BProviderPlan(
  plan: E2BProviderPlan,
  context: SandboxRuntimeMaterializeContext,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  return materializationEffect(context, async () => {
    const lifetime = e2bLifetimeRequest(plan.lifetime, context.deadline);
    const { E2BSandbox, classifyProvisionError, reconcileProvision } = await import("./e2b.ts");
    const provisionToken = randomUUID();
    const backend = await withProvisionRetry(
      () => E2BSandbox.create({
        ...deadlineOptions(context.deadline),
        runtime: "node24",
        template: plan.template,
        ...(plan.user._tag === "Configured" ? { user: plan.user.value } : {}),
        lifetime,
        pathPrepend: plan.pathPrepend,
        provisionToken,
        runIdentity: currentRunIdentity(),
      }),
      classifyProvisionError,
      boundProvisionSlot(context),
      context.feedback,
      () => reconcileProvision(provisionToken),
    );
    return wrapSingleSandbox(backend, context, { template: plan.template });
  });
}

export function materializeVercelProviderPlan(
  plan: VercelProviderPlan,
  context: SandboxRuntimeMaterializeContext,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  return materializationEffect(context, async () => {
    const { VercelSandbox, classifyProvisionError } = await import("./vercel.ts");
    const backend = await withProvisionRetry(
      () => VercelSandbox.create({
        ...deadlineOptions(context.deadline),
        runtime: "node24",
        snapshotId: plan.snapshotId,
        lifetimeMs: configuredLifetime(plan.lifetime),
        pathPrepend: plan.pathPrepend,
        feedback: context.feedback,
      }),
      classifyProvisionError,
      boundProvisionSlot(context),
      context.feedback,
    );
    return wrapSingleSandbox(backend, context, { snapshotId: plan.snapshotId });
  });
}

export function materializeLocalProviderPlan(
  plan: LocalProviderPlan,
  context: SandboxRuntimeMaterializeContext,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  return materializationEffect(context, async () => {
    const { LocalSandbox } = await import("./local.ts");
    return wrapSingleSandbox(
      await LocalSandbox.create({
        ...deadlineOptions(context.deadline),
        dir: plan.directory,
        pathPrepend: plan.pathPrepend,
      }),
      context,
      { directory: plan.directory },
    );
  });
}

export function materializeCustomProviderPlan(
  plan: CustomProviderPlan,
  context: SandboxRuntimeMaterializeContext,
  create: CustomProviderSandboxOptions["create"],
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  return Effect.flatMap(
    create({ deadline: context.deadline, runtime: "node24", feedback: context.feedback }).pipe(
      Effect.mapError((cause) => runtimeFailure(context, "sandbox.materialization-failed", cause)),
    ),
    (sandbox) => Effect.try({
      try: () => wrapSingleSandbox(customSandboxBackend(sandbox), context, { provider: plan.name }),
      catch: (cause) => runtimeFailure(context, "sandbox.materialization-failed", cause),
    }).pipe(
      // create 已经交出真实资源，但 acquireRelease 只有在本 Effect 成功后才会登记 finalizer。
      // facade 归一化若在这个窄窗口失败，必须原地 stop，不能让裸资源逃出 Scope。
      Effect.tapError(() => Effect.tryPromise({
        try: () => sandbox.stop(),
        catch: () => undefined,
      }).pipe(Effect.ignore)),
    ),
  );
}

export function materializeCustomCaseProviderPlan(
  plan: CustomCaseProviderPlan,
  context: SandboxRuntimeMaterializeContext,
  materialize: CustomCaseSandboxOptions["materialize"],
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  return Effect.flatMap(materialize({
    evalId: context.evalId,
    profile: context.evalId,
    signal: context.signal,
    buildLocators: context.buildLocators,
  }).pipe(
    Effect.mapError((cause) => runtimeFailure(context, "sandbox.materialization-failed", cause)),
  ), (rawResult) => Effect.try({
    try: () => {
      const result = validateCustomCaseMaterializeResult(rawResult, plan.services);
      return normalizeMaterialized({
        sandbox: result.sandbox,
        ...(result.services._tag === "Available" ? { services: result.services.value } : {}),
        group: result.group,
        caseKind: "custom",
        caseKey: context.plan.providerPlan.build.caseKey,
        buildKeys: context.plan.providerPlan.build.buildKeys,
        identity: context.plan.providerPlan.identity,
        facts: result.facts,
      }, context);
    },
    catch: (cause) => runtimeFailure(context, "sandbox.materialization-failed", cause),
  }).pipe(
    Effect.catchAll((failure) => Effect.zipRight(
      stopInvalidCustomCaseResult(rawResult),
      Effect.fail(failure),
    )),
  ));
}

function validateCustomCaseMaterializeResult(
  value: unknown,
  declaredServices: CustomCaseServices,
): CustomCaseMaterializeResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("defineSandboxCase materialize() must return an object");
  }
  const result = value as globalThis.Record<string, unknown>;
  const extra = Object.keys(result).filter(
    (key) => key !== "sandbox" && key !== "group" && key !== "services" && key !== "facts",
  );
  if (extra.length > 0) {
    throw new TypeError(
      `defineSandboxCase materialize() returned unsupported field(s): ${extra.join(", ")}`,
    );
  }
  if (result.sandbox === null || typeof result.sandbox !== "object") {
    throw new TypeError("defineSandboxCase materialize() must return sandbox");
  }
  const group = validateCustomCaseResourceGroup(result.group);
  const services = validateCustomCaseServices(result.services, declaredServices);
  if (!isPureDataIdentity(result.facts)) {
    throw new TypeError("defineSandboxCase materialize() facts must be pure JSON data");
  }
  return {
    sandbox: result.sandbox as Sandbox,
    group,
    services,
    facts: result.facts,
  };
}

function validateCustomCaseResourceGroup(value: unknown): SandboxResourceGroup {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("defineSandboxCase materialize() must return group");
  }
  const group = value as globalThis.Record<string, unknown>;
  const extra = Object.keys(group).filter(
    (key) => key !== "primary" && key !== "resources" && key !== "stop",
  );
  if (extra.length > 0) {
    throw new TypeError(
      `defineSandboxCase materialize() group returned unsupported field(s): ${extra.join(", ")}`,
    );
  }
  if (group.primary === null || typeof group.primary !== "object" || Array.isArray(group.primary)) {
    throw new TypeError("defineSandboxCase materialize() group.primary must be a SandboxLocator");
  }
  const primary = group.primary as globalThis.Record<string, unknown>;
  if (typeof primary.sandboxId !== "string" || primary.sandboxId.length === 0) {
    throw new TypeError("defineSandboxCase materialize() group.primary.sandboxId must be a non-empty string");
  }
  if (primary.provider !== undefined && typeof primary.provider !== "string") {
    throw new TypeError("defineSandboxCase materialize() group.primary.provider must be a string");
  }
  if (!isPureDataIdentity(group.resources)) {
    throw new TypeError("defineSandboxCase materialize() group.resources must be pure JSON data");
  }
  if (typeof group.stop !== "function") {
    throw new TypeError("defineSandboxCase materialize() group.stop must be a function");
  }
  return value as SandboxResourceGroup;
}

function validateCustomCaseServices(
  value: unknown,
  declared: CustomCaseServices,
): CustomCaseMaterializeResult["services"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("defineSandboxCase materialize() services must be a tagged value");
  }
  const services = value as globalThis.Record<string, unknown>;
  if (services._tag === "None") {
    if (Object.keys(services).some((key) => key !== "_tag")) {
      throw new TypeError('defineSandboxCase materialize() services "None" cannot contain a value');
    }
    if (declared._tag === "Supported") {
      throw new TypeError(
        'defineSandboxCase declared services "Supported" but materialize() returned "None"',
      );
    }
    return { _tag: "None" };
  }
  if (services._tag !== "Available") {
    throw new TypeError(
      'defineSandboxCase materialize() services must be { _tag: "None" } or { _tag: "Available", value }',
    );
  }
  if (Object.keys(services).some((key) => key !== "_tag" && key !== "value")) {
    throw new TypeError('defineSandboxCase materialize() services "Available" has unsupported fields');
  }
  if (declared._tag === "Unsupported") {
    throw new TypeError(
      'defineSandboxCase declared services "Unsupported" but materialize() returned "Available"',
    );
  }
  if (services.value === null || typeof services.value !== "object") {
    throw new TypeError('defineSandboxCase materialize() services "Available" needs a ServiceController');
  }
  const controller = services.value as globalThis.Record<string, unknown>;
  if (
    typeof controller.exec !== "function" ||
    typeof controller.collectLogs !== "function" ||
    typeof controller.stop !== "function"
  ) {
    throw new TypeError(
      'defineSandboxCase materialize() services "Available" needs exec, collectLogs, and stop functions',
    );
  }
  return { _tag: "Available", value: services.value as ServiceController };
}

function stopInvalidCustomCaseResult(value: unknown): Effect.Effect<void> {
  if (value === null || typeof value !== "object") return Effect.void;
  const group = (value as globalThis.Record<string, unknown>).group;
  if (group === null || typeof group !== "object") return Effect.void;
  const stop = (group as globalThis.Record<string, unknown>).stop;
  if (typeof stop !== "function") return Effect.void;
  return Effect.tryPromise({
    try: async () => {
      await stop.call(group);
    },
    catch: () => undefined,
  }).pipe(Effect.ignore);
}

export function collectDockerComposeProviderBuildPreparation(
  plan: DockerComposeProviderPlan,
  published: SandboxProviderPlan,
  evalId: string,
): Effect.Effect<Option.Option<SandboxRuntimeBuildPreparation>, SandboxRuntimeMaterializationError> {
  return Effect.gen(function* () {
    const file = plan.file._tag === "Url" ? new URL(plan.file.value) : plan.file.value;
    const collection = yield* collectComposeBuilds({
      file,
      mainService: plan.workspaceService,
      platform: plan.collection.platform,
      env: plan.env,
    }).pipe(Effect.mapError((cause) => buildFailure(published, "sandbox.build-input-drift", cause)));
    return yield* Effect.try({
      try: () => {
      assertSameBuildKeys(plan.collection.buildKeys, collection.buildKeys, "Compose");
      if (digestOf(composeCollectionIdentity(plan.collection)) !== digestOf(composeCollectionIdentity(collection))) {
        throw new Error("Compose case inputs changed after physical planning. Restart the Run to plan the new inputs.");
      }
      return Option.some({
        works: collection.works,
        provider: dockerComposeBuildProvider({ env: plan.env }),
      });
      },
      catch: (cause) => buildFailure(published, "sandbox.build-input-drift", cause),
    });
  });
}

export function collectDockerfileProviderBuildPreparation(
  plan: DockerfileProviderPlan,
  published: SandboxProviderPlan,
  evalId: string,
): Effect.Effect<Option.Option<SandboxRuntimeBuildPreparation>, SandboxRuntimeMaterializationError> {
  return Effect.gen(function* () {
    const collection = yield* collectDockerfileBuildFromIdentity({
      provider: "docker",
      profile: evalId,
      context: plan.context,
      dockerfile: plan.dockerfile,
      buildArgs: plan.buildArgs,
      ...(plan.target === undefined ? {} : { target: plan.target }),
      platform: plan.platform,
      expected: plan.build,
      ...(plan.profileBinding === undefined ? {} : { dockerSocketPath: plan.profileBinding.dockerSocketPath }),
    }).pipe(Effect.mapError((cause) => buildFailure(published, "sandbox.build-input-drift", cause)));
    return yield* Effect.try({
      try: () => {
      if (collection.buildKey !== plan.buildKey) {
        throw new Error("Dockerfile build inputs changed after physical planning. Restart the Run to plan the new inputs.");
      }
      const provider = dockerfileBuildProvider([collection]);
      const managedProvider: SandboxBuildProvider = plan.profileBinding === undefined ? provider : {
        lookup: (work, signal) => provider.lookup(work, signal),
        async build(work, buildContext) {
          const lease = await createDockerProfileLease(plan.profileBinding!);
          let reservation: import("./docker-profile/runtime.ts").DockerProfileReservation | undefined;
          let network: import("dockerode").Network | undefined;
          try {
            reservation = await acquireDockerProfileReservation(lease, "build", {
              cpus: 0, memoryBytes: 0, pids: 0, containers: 0,
            });
            const labels = Object.freeze({
              "niceeval.profile-id": plan.profileBinding!.profile.profileId,
              "niceeval.invocation-id": lease.invocationId,
              "niceeval.reservation-id": reservation.reservationId,
              "niceeval.provision-token": reservation.provisionToken,
            });
            const [{ default: Docker }, { dockerManagedNetworkOptions }] = await Promise.all([
              import("dockerode"),
              import("./docker.ts"),
            ]);
            const docker = new Docker({ socketPath: plan.profileBinding!.dockerSocketPath });
            network = await docker.createNetwork(
              dockerManagedNetworkOptions(reservation.provisionToken, randomUUID(), labels),
            );
            await commitDockerProfileReservation(lease, reservation.reservationId, { networkId: network.id });
            const buildCollection = Object.freeze({
              ...collection,
              details: Object.freeze({ ...collection.details, dockerNetworkMode: network.id }),
            });
            const locator = await dockerfileBuildProvider([buildCollection]).build(work, buildContext);
            await network.remove();
            network = undefined;
            await releaseDockerProfileReservation(lease, reservation.reservationId, {
              daemonRequestTerminated: true,
              buildkitSessionGone: true,
              processActivityZero: true,
              provisionalRefResolvedOrRemoved: true,
            });
            return locator;
          } finally {
            await network?.remove().catch(() => undefined);
            if (reservation !== undefined) {
              await releaseDockerProfileReservation(lease, reservation.reservationId, {
                daemonRequestTerminated: true,
                buildkitSessionGone: true,
                processActivityZero: true,
                provisionalRefResolvedOrRemoved: true,
              }).catch(() => undefined);
            }
            await lease.stopHeartbeat().catch(() => undefined);
          }
        },
        ...(provider.cancel === undefined ? {} : { cancel: (work) => provider.cancel!(work) }),
      };
      return Option.some({
        works: [collection.work],
        provider: managedProvider,
      });
      },
      catch: (cause) => buildFailure(published, "sandbox.build-input-drift", cause),
    });
  });
}

function assertSameBuildKeys(planned: readonly string[], collected: readonly string[], label: string): void {
  const expected = [...planned].sort();
  const actual = [...collected].sort();
  if (expected.length === actual.length && expected.every((key, index) => key === actual[index])) return;
  throw new Error(
    `${label} build inputs changed after physical planning; planned ${expected.join(", ") || "none"}, ` +
      `collected ${actual.join(", ") || "none"}. Restart the Run to plan the new inputs.`,
  );
}

/** Public hook callbacks are an outer Promise boundary; runtime composition stays Effect-native. */
function runSetupHooks(
  hooks: readonly SandboxHook[],
  sandbox: Sandbox,
  context: SandboxHookContext,
): Effect.Effect<void, unknown> {
  return Effect.forEach(
    hooks,
    (hook) => Effect.tryPromise({
      try: () => Promise.resolve(hook(sandbox, context)),
      catch: (cause) => cause,
    }),
    { discard: true },
  );
}

/** Teardown remains LIFO and diagnostic-only, but a teardown defect cannot skip the case finalizer. */
function runTeardownHooks(
  hooks: readonly SandboxHook[],
  sandbox: Sandbox,
  context: SandboxHookContext,
): Effect.Effect<void> {
  return Effect.forEach(
    [...hooks].reverse(),
    (hook) => {
      const cleanupContext = { ...context, signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS) };
      return cleanupCallback(() => hook(sandbox, cleanupContext)).pipe(Effect.catchAll((cause) => Effect.sync(() => {
        context.diagnostic({
          code: "sandbox-teardown-failed",
          level: "warning",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      })));
    },
    { discard: true },
  );
}

function reportReleaseFailure(
  input: SandboxRuntimeMaterializeInput,
  owned: MaterializedSandboxCase,
  cause: Error,
): Effect.Effect<void> {
  return Effect.sync(() => {
    const resources = owned.group.resources;
    const projectName =
      resources !== null && typeof resources === "object" && !Array.isArray(resources) &&
        typeof (resources as globalThis.Record<string, JsonValue>).projectName === "string"
        ? (resources as globalThis.Record<string, JsonValue>).projectName as string
        : undefined;
    input.feedback.diagnostic({
      code: "sandbox-stop-failed",
      level: "warning",
      message:
        `Sandbox ${owned.sandbox.sandboxId} provider cleanup failed: ${cause.message}.` +
        (projectName === undefined
          ? ""
          : ` Compose project ${projectName} remains recoverable with \`niceeval sandbox list --orphans\` / \`niceeval sandbox prune\`.`),
      data: {
        provider: input.plan.providerPlan.provider,
        sandboxId: owned.sandbox.sandboxId,
        ...(projectName !== undefined ? { projectName } : {}),
      },
      dedupeKey: projectName === undefined
        ? `sandbox-stop-failed:${owned.sandbox.sandboxId}`
        : `sandbox-stop-failed:${projectName}`,
    });
  });
}

function releaseOwned(input: SandboxRuntimeMaterializeInput, owned: MaterializedSandboxCase): Effect.Effect<void> {
  const release = input.release._tag === "Stop"
    ? providerBoundaryEffect(() => owned.group.stop())
    : input.release.run(owned);
  // catchAll only handles the provider's typed failure. Defects and interruption remain in their
  // original Cause, while ensuring guarantees the resource group release even if a hook defects.
  const releaseWithDiagnostic = release.pipe(
    Effect.catchAll((cause) => reportReleaseFailure(input, owned, cause)),
  );
  return runTeardownHooks(input.plan.pair.teardownHooks, owned.sandbox, input.hookContext).pipe(
    Effect.ensuring(releaseWithDiagnostic),
  );
}

function sortedBuildKeys(keys: Iterable<BuildKey>): readonly BuildKey[] {
  return Object.freeze([...keys].sort());
}

/** 动态 locator 只负责把已规划 BuildKey 绑定到产物；不能在物化时改写 physical plan。 */
function verifyBuildLocators(
  context: SandboxRuntimeMaterializeContext,
): Effect.Effect<void, SandboxRuntimeMaterializationError> {
  const planned = sortedBuildKeys(context.plan.providerPlan.build.buildKeys);
  const provided = sortedBuildKeys(context.buildLocators.keys());
  const missing = planned.filter((key) => !context.buildLocators.has(key));
  if (missing.length > 0) {
    return Effect.fail(runtimeFailure(
      context,
      "sandbox.build-locator-missing",
      new Error(`Missing build locators for planned BuildKey(s): ${missing.join(", ")}`),
    ));
  }
  if (planned.length !== provided.length || planned.some((key, index) => key !== provided[index])) {
    return Effect.fail(runtimeFailure(
      context,
      "sandbox.build-input-drift",
      new Error("Runtime build locator keys differ from the physical plan."),
    ));
  }
  return Effect.void;
}

/** Provider 产物是动态边界；出来即核验，不能把新的 CaseKey / BuildKey 带入领域态。 */
function verifyMaterializedIdentity(
  context: SandboxRuntimeMaterializeContext,
  owned: MaterializedSandboxCase,
): Effect.Effect<void, SandboxRuntimeMaterializationError> {
  const planned = context.plan.providerPlan.build;
  const actualKeys = sortedBuildKeys(owned.buildKeys);
  const plannedKeys = sortedBuildKeys(planned.buildKeys);
  if (
    owned.caseKey !== planned.caseKey ||
    actualKeys.length !== plannedKeys.length ||
    plannedKeys.some((key, index) => key !== actualKeys[index])
  ) {
    return Effect.fail(runtimeFailure(
      context,
      "sandbox.build-input-drift",
      new Error("Materialized CaseKey or BuildKey set differs from the physical plan."),
    ));
  }
  return Effect.void;
}

/** 完整 plan 的唯一物化入口；Scope 退出恒执行声明的 release，不允许裸资源逃逸。 */
export function materializeSandboxRunPlan(
  input: SandboxRuntimeMaterializeInput,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError, Scope.Scope> {
  const context: SandboxRuntimeMaterializeContext = {
    plan: input.plan,
    evalId: input.evalId,
    deadline: input.deadline,
    feedback: input.feedback,
    signal: input.signal,
    hookContext: input.hookContext,
    buildLocators: input.buildLocators,
    provisionSlot: input.provisionSlot,
    services: input.services,
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.runTiming !== undefined ? { runTiming: input.runTiming } : {}),
  };
  return Effect.zipRight(
    verifyBuildLocators(context),
    Effect.acquireRelease(
      Effect.flatMap(providerBinding(input.plan), (binding) => binding.materialize(context)),
      (owned) => releaseOwned(input, owned),
    ).pipe(
      Effect.tap((owned) => verifyMaterializedIdentity(context, owned)),
      Effect.tap((owned) => runSetupHooks(
        input.plan.pair.setupHooks,
        owned.sandbox,
        input.hookContext,
      ).pipe(Effect.mapError((cause) => runtimeFailure(context, "sandbox.materialization-failed", cause)))),
    ),
  );
}

/** Build preparation 同样只调用 private binding，不按 provider/module id 分支。 */
export function collectSandboxRuntimeBuildPreparation(
  plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
  evalId: string,
): Effect.Effect<Option.Option<SandboxRuntimeBuildPreparation>, SandboxRuntimeMaterializationError> {
  return Effect.flatMap(providerBinding(plan), (binding) => binding.collectBuildPreparation(evalId));
}

/** 调度能力来自完成态 ProviderModule binding；core 不从 provider 名推导。 */
export function sandboxRuntimeCapabilities(
  plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
): SandboxRuntimeCapabilities {
  const capabilities = plan.providerPlan.capabilities;
  return Object.freeze({
    provider: plan.providerPlan.provider,
    schedulingLane: plan.providerPlan.scheduling.lane.key,
    admission: plan.providerPlan.scheduling.admission._tag,
    retention: capabilities.retention,
    reuse: capabilities.reuse,
    sessionLimit: capabilities.sessionLimit,
  });
}
