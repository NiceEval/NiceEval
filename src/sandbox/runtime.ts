// ProviderModule 的唯一运行入口：core 只调用 plan 私绑的闭包，不解释 adapter 名或 JSON runtime input。

import { randomUUID } from "node:crypto";
import Docker from "dockerode";
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
import { customSandboxBackend, type SandboxProviderBackend } from "./backend.ts";
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
import { CLEANUP_TIMEOUT_MS, withCleanupTimeout } from "../runner/cleanup-timeout.ts";
import type { JsonValue, Sandbox, SandboxHook, SandboxHookContext, ScopedFeedback } from "../types.ts";
import type { AgentIdentity, SandboxAgent } from "../agents/types.ts";
import type { DockerSandbox } from "./docker.ts";
import type { E2BSandboxLifetime } from "./e2b.ts";

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
  const group: SandboxResourceGroup = {
    primary: { sandboxId: sandbox.sandboxId, provider },
    resources: { kind: "single", provider, sandboxId: sandbox.sandboxId },
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        await sandbox.stop();
      } finally {
        unregisterSandbox(sandbox);
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
  const group: SandboxResourceGroup = {
    ...materialized.group,
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        await materialized.group.stop();
      } finally {
        unregisterSandbox(sandbox);
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
      : materializationEffect(context, async () => {
      const resolved = await resolveDockerfileAgentImage(plan, context, locator);
      context.hookContext.fact("agent.image.cache", resolved.status);
      const { DockerSandbox, classifyProvisionError, reconcileProvision } = await import("./docker.ts");
      const provisionToken = randomUUID();
      const backend = await withProvisionRetry(
        () => DockerSandbox.create({
          ...deadlineOptions(context.deadline),
          runtime: "node24",
          image: resolved.locator,
          ...(plan.user._tag === "Configured" ? { user: plan.user.value } : {}),
          lifetimeMs: configuredLifetime(plan.lifetime),
          feedback: context.feedback,
          provisionToken,
          runIdentity: currentRunIdentity(),
        }),
        classifyProvisionError,
        boundProvisionSlot(context),
        context.feedback,
        () => reconcileProvision(provisionToken),
      );
      return wrapSingleSandbox(backend, context, { image: resolved.locator });
    }),
  });
}

async function defaultDockerImageExists(locator: string): Promise<boolean> {
  try {
    await new Docker().getImage(locator).inspect();
    return true;
  } catch {
    return false;
  }
}

async function resolveDockerfileAgentImage(
  plan: DockerfileProviderPlan,
  context: SandboxRuntimeMaterializeContext,
  taskLocator: string,
): Promise<{ readonly status: "hit" | "built" | "unsupported"; readonly locator: string }> {
  const request = dockerfileAgentCacheRequest(
    plan,
    context.agent,
    taskLocator,
    context.plan.providerPlan.target.platform,
  );
  if (request === undefined) return { status: "unsupported", locator: taskLocator };
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

async function buildDockerfileAgentImage(
  input: DockerfileAgentDerivedImageBuildInput,
  request: DockerfileAgentCacheRequest,
  targetPlatform: import("../agents/types.ts").AgentArtifactPlatform,
  signal: AbortSignal,
): Promise<void> {
  return buildDockerfileAgentImageWithServices(input, request, targetPlatform, signal);
}

export interface DockerfileAgentImageProvisionSandbox {
  readonly operations: import("./types.ts").SandboxOperations;
  readonly sandboxId: string;
  stop(): Promise<void>;
}

export interface DockerfileAgentImageProvisionServices {
  readonly create: (taskLocator: string) => Promise<DockerfileAgentImageProvisionSandbox>;
  readonly commit: (sandboxId: string, derivedLocator: string) => Promise<void>;
}

const liveDockerfileAgentImageProvisionServices: DockerfileAgentImageProvisionServices = Object.freeze({
  create: async (taskLocator: string) => {
    const { DockerSandbox } = await import("./docker.ts");
    const sandbox = await DockerSandbox.create({ image: taskLocator, runtime: "node24" });
    return { operations: sandbox, sandboxId: sandbox.sandboxId, stop: () => sandbox.stop() };
  },
  commit: async (sandboxId: string, derivedLocator: string) => {
    await new Docker().getContainer(sandboxId).commit(dockerCommitReference(derivedLocator));
  },
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

export async function buildDockerfileAgentImageWithServices(
  input: DockerfileAgentDerivedImageBuildInput,
  request: DockerfileAgentCacheRequest,
  targetPlatform: import("../agents/types.ts").AgentArtifactPlatform,
  signal: AbortSignal,
  services: DockerfileAgentImageProvisionServices = liveDockerfileAgentImageProvisionServices,
): Promise<void> {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Dockerfile Agent image build aborted");
  let provisioned: DockerfileAgentImageProvisionSandbox | undefined;
  try {
    provisioned = await services.create(input.taskLocator);
    const ensured = await Effect.runPromise(Effect.either(runAgentEnsure(
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
    )));
    if (ensured._tag === "Left") throw ensured.left;
    await services.commit(provisioned.sandboxId, input.derivedLocator);
  } finally {
    await provisioned?.stop();
  }
}

export function materializeDockerImageProviderPlan(
  plan: DockerImageProviderPlan,
  context: SandboxRuntimeMaterializeContext,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  return materializationEffect(context, async () => {
    const { DockerSandbox, classifyProvisionError, reconcileProvision } = await import("./docker.ts");
    const provisionToken = randomUUID();
    const backend = await withProvisionRetry(
      () => DockerSandbox.create({
        ...deadlineOptions(context.deadline),
        runtime: "node24",
        image: plan.image,
        ...(plan.user._tag === "Configured" ? { user: plan.user.value } : {}),
        lifetimeMs: configuredLifetime(plan.lifetime),
        feedback: context.feedback,
        provisionToken,
        runIdentity: currentRunIdentity(),
      }),
      classifyProvisionError,
      boundProvisionSlot(context),
      context.feedback,
      () => reconcileProvision(provisionToken),
    );
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
      await LocalSandbox.create({ ...deadlineOptions(context.deadline), dir: plan.directory }),
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
  return Effect.tryPromise({
    try: async () => {
      const file = plan.file._tag === "Url" ? new URL(plan.file.value) : plan.file.value;
      const collection = await collectComposeBuilds({
        file,
        mainService: plan.workspaceService,
        platform: plan.collection.platform,
        env: plan.env,
      });
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
}

export function collectDockerfileProviderBuildPreparation(
  plan: DockerfileProviderPlan,
  published: SandboxProviderPlan,
  evalId: string,
): Effect.Effect<Option.Option<SandboxRuntimeBuildPreparation>, SandboxRuntimeMaterializationError> {
  return Effect.tryPromise({
    try: async () => {
      const collection = await collectDockerfileBuildFromIdentity({
        provider: "docker",
        profile: evalId,
        context: plan.context,
        dockerfile: plan.dockerfile,
        buildArgs: plan.buildArgs,
        platform: plan.platform,
        expected: plan.build,
      });
      if (collection.buildKey !== plan.buildKey) {
        throw new Error("Dockerfile build inputs changed after physical planning. Restart the Run to plan the new inputs.");
      }
      return Option.some({
        works: [collection.work],
        provider: dockerfileBuildProvider([collection]),
      });
    },
    catch: (cause) => buildFailure(published, "sandbox.build-input-drift", cause),
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

async function runHooks(
  hooks: readonly SandboxHook[],
  sandbox: Sandbox,
  context: SandboxHookContext,
  reverse: boolean,
): Promise<void> {
  for (const hook of reverse ? [...hooks].reverse() : hooks) {
    try {
      if (reverse) {
        const cleanupContext = { ...context, signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS) };
        await withCleanupTimeout(() => hook(sandbox, cleanupContext));
      } else {
        await hook(sandbox, context);
      }
    } catch (cause) {
      if (!reverse) throw cause;
      context.diagnostic({
        code: "sandbox-teardown-failed",
        level: "warning",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}

function releaseOwned(input: SandboxRuntimeMaterializeInput, owned: MaterializedSandboxCase): Effect.Effect<void> {
  return Effect.promise(async () => {
    await runHooks(input.plan.pair.teardownHooks, owned.sandbox, input.hookContext, true);
    if (input.release._tag === "Stop") await owned.group.stop();
    else await Effect.runPromise(input.release.run(owned));
  });
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
      Effect.tap((owned) => Effect.tryPromise({
        try: () => runHooks(input.plan.pair.setupHooks, owned.sandbox, input.hookContext, false),
        catch: (cause) => runtimeFailure(context, "sandbox.materialization-failed", cause),
      })),
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
