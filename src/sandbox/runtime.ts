// Provider-neutral physical plan -> live Sandbox materialization.
// Runner 只交付 pair-owned LinkedRunPlan；adapter 解析、SDK Promise lift 与 provider 分发都留在 sandbox 域。

import { randomUUID } from "node:crypto";
import { Data, Effect, Option, Schema } from "effect";
import { withProvisionRetry, type ProvisionSlot } from "./retry.ts";
import type { MaterializedSandboxCase, SandboxResourceGroup } from "./case-types.ts";
import type { PlannedSandboxCase } from "./case.ts";
import { materializeDockerComposeCase } from "./compose.ts";
import {
  collectComposeBuilds,
  composeCollectionIdentity,
  dockerComposeBuildProvider,
  normalizeBuildPlatform,
} from "./compose.ts";
import { collectDockerfileBuildFromPlan, dockerfileBuildProvider } from "./dockerfile-build.ts";
import type { SandboxBuildProvider, SandboxBuildWork } from "./build-coordinator.ts";
import { customSandboxBackend, type SandboxProviderBackend } from "./backend.ts";
import { normalizeSandboxPaths } from "./paths.ts";
import { registerSandbox, unregisterSandbox } from "./registry.ts";
import { currentRunIdentity } from "./run-identity.ts";
import {
  customSandboxTemplateRuntimeOf,
  sandboxProviderRuntimeOf,
  type SandboxRuntimePlan,
} from "./layer.ts";
import { computeCaseKey, digestOf, type BuildKey, type CaseKey, type SandboxCaseKind } from "./identity.ts";
import { linkedRunCarryEligible, type LinkedRunPlan } from "./plan.ts";
import type { JsonValue, Sandbox, ScopedFeedback } from "../types.ts";

const StringRecord = Schema.Record({ key: Schema.String, value: Schema.String });
const Location = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Path"), value: Schema.NonEmptyTrimmedString }),
  Schema.Struct({ _tag: Schema.Literal("Url"), value: Schema.NonEmptyTrimmedString }),
);
const Lifetime = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("ProviderDefault") }),
  Schema.Struct({ _tag: Schema.Literal("Configured"), milliseconds: Schema.Positive }),
);
const DockerComposeInput = Schema.Struct({
  file: Location,
  workspaceService: Schema.NonEmptyTrimmedString,
  build: Schema.Literal("on-demand", "prebuilt"),
  executionUser: Schema.Union(
    Schema.Struct({ _tag: Schema.Literal("ImageDefault") }),
    Schema.Struct({ _tag: Schema.Literal("Configured"), value: Schema.NonEmptyTrimmedString }),
  ),
  env: StringRecord,
  plannedBuildKeys: Schema.Array(Schema.NonEmptyTrimmedString),
  plannedCaseIdentityDigest: Schema.NonEmptyTrimmedString,
});
const DockerfileInput = Schema.Struct({
  context: Location,
  dockerfile: Schema.NonEmptyTrimmedString,
  buildArgs: StringRecord,
  plannedBuildKey: Schema.NonEmptyTrimmedString,
});
const DockerImageInput = Schema.Struct({ image: Schema.NonEmptyTrimmedString });
const E2BInput = Schema.Struct({ template: Schema.NonEmptyTrimmedString, lifetime: Lifetime });
const VercelInput = Schema.Struct({ snapshotId: Schema.NonEmptyTrimmedString, lifetime: Lifetime });
const LocalInput = Schema.Struct({ directory: Schema.NonEmptyTrimmedString });

export type SandboxRuntimeDeadline =
  | { readonly _tag: "Unlimited" }
  | { readonly _tag: "Bounded"; readonly timeoutMs: number; readonly deadlineAt: number };

export interface SandboxRuntimeMaterializeInput {
  readonly plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>;
  readonly evalId: string;
  readonly deadline: SandboxRuntimeDeadline;
  readonly feedback: ScopedFeedback;
  readonly signal: AbortSignal;
  readonly buildLocators: ReadonlyMap<BuildKey, string>;
  readonly provisionSlot:
    | { readonly _tag: "Detached" }
    | { readonly _tag: "Bound"; readonly value: ProvisionSlot };
  readonly services: SandboxRuntimeServices;
}

export type SandboxRuntimeServices =
  | { readonly _tag: "Live" }
  | {
      readonly _tag: "Test";
      readonly materializeCompose: typeof materializeDockerComposeCase;
    };

export const liveSandboxRuntimeServices: SandboxRuntimeServices = Object.freeze({ _tag: "Live" });

export type SandboxRuntimeRetention =
  | { readonly _tag: "DestroyOnly" }
  | { readonly _tag: "Suspendable" };

export interface SandboxRuntimeCapabilities {
  readonly provider: string;
  readonly schedulingLane: string;
  readonly admission: "Shared" | "Exclusive";
  readonly retention: SandboxRuntimeRetention;
  readonly reuse: "Supported" | "Unsupported";
  readonly sessionLimitMs: number | null;
}

export interface SandboxRuntimeBuildPreparation {
  readonly works: readonly SandboxBuildWork[];
  readonly provider: SandboxBuildProvider;
  readonly caseKey: CaseKey;
}

export class SandboxRuntimeMaterializationError extends Data.TaggedError(
  "SandboxRuntimeMaterializationError",
)<{
  readonly code: "sandbox.runtime-adapter-missing" | "sandbox.runtime-input-invalid" | "sandbox.materialization-failed";
  readonly adapter: string;
  readonly provider: string;
  readonly message: string;
  readonly cause: Error;
}> {}

function runtimeFailure(
  input: SandboxRuntimeMaterializeInput,
  code: SandboxRuntimeMaterializationError["code"],
  cause: unknown,
): SandboxRuntimeMaterializationError {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  return new SandboxRuntimeMaterializationError({
    code,
    adapter: input.plan.providerPlan.runtimeAdapter,
    provider: input.plan.providerPlan.provider,
    message: error.message,
    cause: error,
  });
}

function decode<A, I>(
  schema: Schema.Schema<A, I>,
  input: SandboxRuntimeMaterializeInput,
): Effect.Effect<A, SandboxRuntimeMaterializationError> {
  return Effect.flatMap(providerRuntime(input), (runtime) =>
    Schema.decodeUnknown(schema)(runtime.input).pipe(
      Effect.mapError((cause) => runtimeFailure(input, "sandbox.runtime-input-invalid", cause)),
    ));
}

function providerRuntime(
  input: SandboxRuntimeMaterializeInput,
): Effect.Effect<SandboxRuntimePlan, SandboxRuntimeMaterializationError> {
  return Option.match(sandboxProviderRuntimeOf(input.plan.providerPlan), {
    onNone: () => Effect.fail(runtimeFailure(
      input,
      "sandbox.runtime-adapter-missing",
      new Error(`Sandbox provider plan has no bound runtime for ${JSON.stringify(input.plan.providerPlan.runtimeAdapter)}`),
    )),
    onSome: Effect.succeed,
  });
}

function locationValue(value: Schema.Schema.Type<typeof Location>): string | URL {
  return value._tag === "Path" ? value.value : new URL(value.value);
}

function configuredLifetime(value: Schema.Schema.Type<typeof Lifetime>): number | undefined {
  return value._tag === "Configured" ? value.milliseconds : undefined;
}

function deadlineOptions(deadline: SandboxRuntimeDeadline): {
  readonly timeout?: number;
  readonly deadlineAt?: number;
} {
  return deadline._tag === "Unlimited"
    ? {}
    : { timeout: deadline.timeoutMs, deadlineAt: deadline.deadlineAt };
}

function boundProvisionSlot(input: SandboxRuntimeMaterializeInput): ProvisionSlot | undefined {
  return input.provisionSlot._tag === "Bound" ? input.provisionSlot.value : undefined;
}

function runtimeCaseKind(plan: SandboxRuntimeMaterializeInput["plan"]): SandboxCaseKind {
  switch (plan.providerPlan.caseKind) {
    case "compose":
      return "compose";
    case "on-demand-build":
      return "on-demand-build";
    case "custom":
    case "custom-provider":
      return "custom";
    default:
      return "prebuilt";
  }
}

function caseKey(plan: SandboxRuntimeMaterializeInput["plan"]): CaseKey {
  return digestOf({ version: 1, providerPlan: plan.providerPlan.identity }) as CaseKey;
}

function wrapSingleSandbox(
  backend: SandboxProviderBackend,
  input: SandboxRuntimeMaterializeInput,
  facts: JsonValue,
): MaterializedSandboxCase {
  const provider = input.plan.providerPlan.provider;
  const sandbox = normalizeSandboxPaths(backend, provider);
  registerSandbox(sandbox);
  const group: SandboxResourceGroup = {
    primary: { sandboxId: sandbox.sandboxId, provider },
    resources: { kind: "single", provider, sandboxId: sandbox.sandboxId },
    async stop() {
      try {
        await sandbox.stop();
      } finally {
        unregisterSandbox(sandbox);
      }
    },
  };
  return {
    sandbox,
    group,
    caseKind: runtimeCaseKind(input.plan),
    caseKey: caseKey(input.plan),
    buildKeys: [...input.buildLocators.keys()],
    identity: input.plan.providerPlan.identity,
    carryEligible: linkedRunCarryEligible(input.plan),
    facts,
  };
}

function wrapAuthorSandbox(
  sandbox: Sandbox,
  input: SandboxRuntimeMaterializeInput,
  facts: JsonValue,
): MaterializedSandboxCase {
  return wrapSingleSandbox(customSandboxBackend(sandbox), input, facts);
}

function normalizeMaterialized(
  materialized: MaterializedSandboxCase,
  input: SandboxRuntimeMaterializeInput,
): MaterializedSandboxCase {
  const candidate = materialized.sandbox as Sandbox & Partial<SandboxProviderBackend>;
  const sandbox = candidate.capabilities === undefined
    ? normalizeSandboxPaths(customSandboxBackend(materialized.sandbox), input.plan.providerPlan.provider)
    : normalizeSandboxPaths(candidate as SandboxProviderBackend, input.plan.providerPlan.provider);
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
  return { ...materialized, sandbox, group };
}

function legacyComposePlan(
  input: SandboxRuntimeMaterializeInput,
  decoded: Schema.Schema.Type<typeof DockerComposeInput>,
): PlannedSandboxCase {
  const source = {
    kind: "compose" as const,
    file: locationValue(decoded.file),
    mainService: decoded.workspaceService,
    build: decoded.build,
    ...(decoded.executionUser._tag === "Configured" ? { executionUser: decoded.executionUser.value } : {}),
    env: decoded.env,
    __brand: "niceeval.sandboxSource.compose" as const,
  };
  return {
    evalId: input.evalId,
    profile: input.evalId,
    caseKind: "compose",
    sourceKind: "compose",
    via: "builtin",
    caseKey: caseKey(input.plan),
    buildKeys: [...input.buildLocators.keys()],
    identity: input.plan.providerPlan.identity,
    carryEligible: linkedRunCarryEligible(input.plan),
    declaration: {
      form: "source",
      value: source,
      materializer: {
        kind: "compose",
        revision: input.plan.providerPlan.plannerRevision,
        materialize: () => Promise.reject(new Error("provider runtime owns Compose materialization")),
      },
    },
  };
}

function legacyDockerfilePlan(
  input: SandboxRuntimeMaterializeInput,
  decoded: Schema.Schema.Type<typeof DockerfileInput>,
): PlannedSandboxCase {
  const source = {
    kind: "dockerfile" as const,
    context: locationValue(decoded.context),
    dockerfile: decoded.dockerfile,
    buildArgs: decoded.buildArgs,
    __brand: "niceeval.sandboxSource.dockerfile" as const,
  };
  return {
    evalId: input.evalId,
    profile: input.evalId,
    caseKind: "on-demand-build",
    sourceKind: "dockerfile",
    via: "builtin",
    caseKey: caseKey(input.plan),
    buildKeys: [],
    identity: input.plan.providerPlan.identity,
    carryEligible: linkedRunCarryEligible(input.plan),
    declaration: { form: "dockerfile", provider: "docker", value: source },
  };
}

function materializeBuiltin(
  input: SandboxRuntimeMaterializeInput,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  const adapter = input.plan.providerPlan.runtimeAdapter;
  const common = deadlineOptions(input.deadline);
  switch (adapter) {
    case "niceeval/docker-compose":
      return Effect.flatMap(decode(DockerComposeInput, input), (decoded) =>
        Effect.tryPromise({
          try: async () => normalizeMaterialized(await (
            input.services._tag === "Live" ? materializeDockerComposeCase : input.services.materializeCompose
          )(
            legacyComposePlan(input, decoded),
            {
              ctx: {
                evalId: input.evalId,
                profile: input.evalId,
                signal: input.signal,
                buildLocators: input.buildLocators,
              },
              ...common,
              feedback: input.feedback,
              provisionSlot: boundProvisionSlot(input),
            },
          ), input),
          catch: (cause) => runtimeFailure(input, "sandbox.materialization-failed", cause),
        }));
    case "niceeval/dockerfile":
      return Effect.flatMap(decode(DockerfileInput, input), () => Effect.tryPromise({
        try: async () => {
          const locator = [...input.buildLocators.values()][0];
          if (locator === undefined) throw new Error("Dockerfile materialization requires its Run build locator");
          const { DockerSandbox, classifyProvisionError, reconcileProvision } = await import("./docker.ts");
          const provisionToken = randomUUID();
          const backend = await withProvisionRetry(
            () => DockerSandbox.create({
              ...common,
              runtime: "node24",
              image: locator,
              feedback: input.feedback,
              provisionToken,
              runIdentity: currentRunIdentity(),
            }),
            classifyProvisionError,
            boundProvisionSlot(input),
            input.feedback,
            () => reconcileProvision(provisionToken),
          );
          return wrapSingleSandbox(backend, input, { image: locator });
        },
        catch: (cause) => runtimeFailure(input, "sandbox.materialization-failed", cause),
      }));
    case "niceeval/docker-image":
      return Effect.flatMap(decode(DockerImageInput, input), ({ image }) => Effect.tryPromise({
        try: async () => {
          const { DockerSandbox, classifyProvisionError, reconcileProvision } = await import("./docker.ts");
          const provisionToken = randomUUID();
          const backend = await withProvisionRetry(
            () => DockerSandbox.create({
              ...common,
              runtime: "node24",
              image,
              feedback: input.feedback,
              provisionToken,
              runIdentity: currentRunIdentity(),
            }),
            classifyProvisionError,
            boundProvisionSlot(input),
            input.feedback,
            () => reconcileProvision(provisionToken),
          );
          return wrapSingleSandbox(backend, input, { image });
        },
        catch: (cause) => runtimeFailure(input, "sandbox.materialization-failed", cause),
      }));
    case "niceeval/e2b-template":
      return Effect.flatMap(decode(E2BInput, input), ({ template, lifetime }) => Effect.tryPromise({
        try: async () => {
          const { E2BSandbox, classifyProvisionError, reconcileProvision } = await import("./e2b.ts");
          const provisionToken = randomUUID();
          const backend = await withProvisionRetry(
            () => E2BSandbox.create({
              ...common,
              runtime: "node24",
              template,
              lifetimeMs: configuredLifetime(lifetime),
              provisionToken,
              runIdentity: currentRunIdentity(),
            }),
            classifyProvisionError,
            boundProvisionSlot(input),
            input.feedback,
            () => reconcileProvision(provisionToken),
          );
          return wrapSingleSandbox(backend, input, { template });
        },
        catch: (cause) => runtimeFailure(input, "sandbox.materialization-failed", cause),
      }));
    case "niceeval/vercel-snapshot":
      return Effect.flatMap(decode(VercelInput, input), ({ snapshotId }) => Effect.tryPromise({
        try: async () => {
          const { VercelSandbox, classifyProvisionError } = await import("./vercel.ts");
          const backend = await withProvisionRetry(
            () => VercelSandbox.create({
              ...common,
              runtime: "node24",
              snapshotId,
              feedback: input.feedback,
            }),
            classifyProvisionError,
            boundProvisionSlot(input),
            input.feedback,
          );
          return wrapSingleSandbox(backend, input, { snapshotId });
        },
        catch: (cause) => runtimeFailure(input, "sandbox.materialization-failed", cause),
      }));
    case "niceeval/local-directory":
      return Effect.flatMap(decode(LocalInput, input), ({ directory }) => Effect.tryPromise({
        try: async () => {
          const { LocalSandbox } = await import("./local.ts");
          return wrapSingleSandbox(await LocalSandbox.create({ ...common, dir: directory }), input, { directory });
        },
        catch: (cause) => runtimeFailure(input, "sandbox.materialization-failed", cause),
      }));
    default:
      return Effect.fail(runtimeFailure(
        input,
        "sandbox.runtime-adapter-missing",
        new Error(`No Sandbox runtime adapter is registered for ${JSON.stringify(adapter)}`),
      ));
  }
}

function materializeCustom(
  input: SandboxRuntimeMaterializeInput,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  const binding = customSandboxTemplateRuntimeOf(input.plan.pair.template);
  if (binding._tag === "Unbound") return materializeBuiltin(input);
  const runtime = binding.runtime;
  if (runtime._tag === "CustomProvider") {
    return Effect.tryPromise({
      try: async () => wrapAuthorSandbox(await runtime.create({
        ...deadlineOptions(input.deadline),
        runtime: "node24",
        feedback: input.feedback,
      }), input, { provider: input.plan.providerPlan.provider }),
      catch: (cause) => runtimeFailure(input, "sandbox.materialization-failed", cause),
    });
  }
  return Effect.tryPromise({
    try: async () => {
      const materialized = await runtime.materialize({
        evalId: input.evalId,
        profile: input.evalId,
        signal: input.signal,
        buildLocators: input.buildLocators,
      });
      const normalized = normalizeMaterialized({
        ...materialized,
        caseKind: "custom",
        caseKey: caseKey(input.plan),
        buildKeys: [...input.buildLocators.keys()],
        identity: input.plan.providerPlan.identity,
        carryEligible: linkedRunCarryEligible(input.plan),
        facts: materialized.facts ?? {},
      }, input);
      return normalized;
    },
    catch: (cause) => runtimeFailure(input, "sandbox.materialization-failed", cause),
  });
}

/** 完整 plan 的唯一物化入口。成功值由调用方显式拥有，且必须调用 `group.stop()`。 */
export function materializeSandboxRunPlan(
  input: SandboxRuntimeMaterializeInput,
): Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError> {
  return materializeCustom(input);
}

/** Run 级 build coordinator 的 provider-owned 收集边界；无构建的 adapter 返回 Option.None。 */
export function collectSandboxRuntimeBuildPreparation(
  plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
  evalId: string,
): Effect.Effect<Option.Option<SandboxRuntimeBuildPreparation>, SandboxRuntimeMaterializationError> {
  const input: SandboxRuntimeMaterializeInput = {
    plan,
    evalId,
    deadline: { _tag: "Unlimited" },
    feedback: { progress: () => {}, diagnostic: () => {} },
    signal: new AbortController().signal,
    buildLocators: new Map(),
    provisionSlot: { _tag: "Detached" },
    services: liveSandboxRuntimeServices,
  };
  switch (plan.providerPlan.runtimeAdapter) {
    case "niceeval/docker-compose":
      return Effect.flatMap(decode(DockerComposeInput, input), (decoded) => Effect.tryPromise({
        try: async () => {
          const file = locationValue(decoded.file);
          const collection = await collectComposeBuilds({
            file,
            mainService: decoded.workspaceService,
            platform: plannedBuildPlatform(plan),
            env: decoded.env,
          });
          assertSameBuildKeys(decoded.plannedBuildKeys, collection.buildKeys, "Compose");
          if (decoded.plannedCaseIdentityDigest !== digestOf(composeCollectionIdentity(collection))) {
            throw new Error("Compose case inputs changed after physical planning. Restart the Run to plan the new inputs.");
          }
          return Option.some({
            works: collection.works,
            provider: dockerComposeBuildProvider({ env: decoded.env }),
            caseKey: computeCaseKey({
              caseKind: "compose",
              materializerRevision: plan.providerPlan.plannerRevision,
              composeBytes: collection.composeBytes,
              buildKeys: collection.buildKeys,
              serviceImageDigests: collection.imageRefs,
              bindMountDigests: collection.bindMountDigests,
              configContents: collection.configContents,
              caseParams: plan.providerPlan.identity,
            }),
          });
        },
        catch: (cause) => runtimeFailure(input, "sandbox.materialization-failed", cause),
      }));
    case "niceeval/dockerfile":
      return Effect.flatMap(decode(DockerfileInput, input), (decoded) => Effect.tryPromise({
        try: async () => {
          const collection = await collectDockerfileBuildFromPlan(legacyDockerfilePlan(input, decoded), {
            dockerPlatform: plannedBuildPlatform(plan),
          });
          if (collection === undefined) throw new Error("Dockerfile runtime did not produce a build work item");
          assertSameBuildKeys([decoded.plannedBuildKey], [collection.buildKey], "Dockerfile");
          return Option.some({
            works: [collection.work],
            provider: dockerfileBuildProvider([collection]),
            caseKey: collection.caseKey,
          });
        },
        catch: (cause) => runtimeFailure(input, "sandbox.materialization-failed", cause),
      }));
    default:
      return Effect.succeed(Option.none());
  }
}

function plannedBuildPlatform(plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>): string {
  const platform = plan.providerPlan.target.platform;
  const arch = platform.arch === "x64" ? "amd64" : platform.arch;
  return normalizeBuildPlatform(`${platform.os}/${arch}`);
}

function assertSameBuildKeys(
  planned: readonly string[],
  collected: readonly string[],
  label: string,
): void {
  const expected = [...planned].sort();
  const actual = [...collected].sort();
  if (expected.length === actual.length && expected.every((key, index) => key === actual[index])) return;
  throw new Error(
    `${label} build inputs changed after physical planning; planned ${expected.join(", ") || "none"}, ` +
      `collected ${actual.join(", ") || "none"}. Restart the Run to plan the new inputs.`,
  );
}

/** Runner 的调度/留存只读中性能力，不按 provider 名或 adapter tag 分支。 */
export function sandboxRuntimeCapabilities(
  plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
): SandboxRuntimeCapabilities {
  const adapter = plan.providerPlan.runtimeAdapter;
  const sessionLimitMs = adapter === "niceeval/vercel-snapshot"
    ? 1_200_000
    : adapter === "niceeval/e2b-template"
      ? 1_800_000
      : null;
  const retention: SandboxRuntimeRetention =
    adapter === "niceeval/docker-image" ||
      adapter === "niceeval/dockerfile" ||
      adapter === "niceeval/e2b-template" ||
      adapter === "niceeval/vercel-snapshot"
      ? { _tag: "Suspendable" }
      : { _tag: "DestroyOnly" };
  const reuse = adapter === "niceeval/local-directory" || adapter === "niceeval/custom-provider" || adapter === "niceeval/custom-case"
    ? "Unsupported"
    : "Supported";
  return Object.freeze({
    provider: plan.providerPlan.provider,
    schedulingLane: plan.providerPlan.scheduling.lane.key,
    admission: plan.providerPlan.scheduling.admission._tag,
    retention,
    reuse,
    sessionLimitMs,
  });
}
