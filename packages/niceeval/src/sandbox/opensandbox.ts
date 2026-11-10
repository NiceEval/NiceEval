import { Effect, Option } from "effect";
import type { JsonValue } from "../shared/types.ts";
import { computeCaseKey } from "./identity.ts";
import {
  defineSandboxTemplate, sandboxProviderPlan,
  type SandboxLayer, type SandboxProviderModule, type SandboxTargetPlatform,
} from "./layer.ts";
import { providerBoundaryEffect } from "./backend.ts";
import { SandboxRuntimeMaterializationError } from "./runtime.ts";
import { remoteSnapshotPreparer } from "./remote-snapshot/preparer.ts";
import { openSandboxSnapshotDriver } from "./opensandbox/snapshot-driver.ts";

export interface OpenSandboxOptions {
  readonly image: string;
  readonly targetPlatform: Extract<SandboxTargetPlatform, { readonly _tag: "Linux" }>;
  readonly resources?: { readonly cpu?: string; readonly memory?: string };
  readonly user?: string;
  /** Finite instance lifetime; normal completion still destroys it immediately. */
  readonly lifetimeMs?: number;
  readonly pathPrepend?: readonly string[];
}

const providerModule: SandboxProviderModule<OpenSandboxOptions> = {
  id: "niceeval/opensandbox-image",
  beforeCache: { _tag: "RunPrepared", coverage: "all", preparer: remoteSnapshotPreparer(openSandboxSnapshotDriver) },
  capabilities: {
    retention: { _tag: "DestroyOnly" },
    reuse: { _tag: "Unsupported", reason: "OpenSandbox instances belong to one Attempt." },
    sessionLimit: { _tag: "ProviderValidated", reason: "The OpenSandbox service validates instance lifetime." },
  },
  collectBuildPreparation: () => Effect.succeed(Option.none()),
  materialize: (plan, context) => Effect.flatMap(
    providerBoundaryEffect(async () => {
      try { return await import("./opensandbox/materialize.ts"); }
      catch (cause) {
        if (cause instanceof Error && /Cannot find (?:package|module).*@alibaba-group\/opensandbox/.test(cause.message)) {
          throw new Error("OpenSandbox requires '@alibaba-group/opensandbox'. Install it with: pnpm add @alibaba-group/opensandbox", { cause });
        }
        throw cause;
      }
    }),
    (module) => module.materializeOpenSandbox(plan, context),
  ).pipe(Effect.mapError((cause) => cause instanceof SandboxRuntimeMaterializationError ? cause : new SandboxRuntimeMaterializationError({
    code: "sandbox.materialization-failed", provider: "opensandbox",
    message: cause.message, cause,
  }))),
};

/** Use an image on an explicitly configured OpenSandbox service. */
export function openSandbox(options: OpenSandboxOptions): SandboxLayer<"template-bearing"> {
  if (options === null || typeof options !== "object") throw new TypeError("OpenSandbox options must be an object");
  const allowed = new Set(["image", "targetPlatform", "resources", "user", "lifetimeMs", "pathPrepend"]);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new TypeError(`Unknown OpenSandbox option: ${key}`);
  const nonempty = (value: string, field: string): string => {
    if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) throw new TypeError(`OpenSandbox ${field} must be a nonempty string`);
    return value;
  };
  const image = nonempty(options.image, "image");
  const platform = options.targetPlatform;
  if (platform?._tag !== "Linux" || platform.os !== "linux" || !["x64", "arm64"].includes(platform.arch) || !["gnu", "musl"].includes(platform.libc)) {
    throw new TypeError("OpenSandbox targetPlatform must specify Linux x64/arm64 and gnu/musl");
  }
  if (options.lifetimeMs !== undefined && (!Number.isSafeInteger(options.lifetimeMs) || options.lifetimeMs <= 0)) throw new TypeError("OpenSandbox lifetimeMs must be an explicit positive integer");
  if (options.pathPrepend !== undefined && !Array.isArray(options.pathPrepend)) throw new TypeError("OpenSandbox pathPrepend must be an array");
  const pathPrepend = (options.pathPrepend ?? []).map((value) => nonempty(value, "pathPrepend"));
  const resources: { cpu?: string; memory?: string } = {};
  if (options.resources !== undefined) {
    if (options.resources === null || typeof options.resources !== "object") throw new TypeError("OpenSandbox resources must be an object");
    for (const key of Object.keys(options.resources)) if (key !== "cpu" && key !== "memory") throw new TypeError(`Unknown OpenSandbox resource: ${key}`);
    if (options.resources.cpu !== undefined) resources.cpu = nonempty(options.resources.cpu, "resources.cpu");
    if (options.resources.memory !== undefined) resources.memory = nonempty(options.resources.memory, "resources.memory");
  }
  const plan: OpenSandboxOptions = Object.freeze({ image, ...(options.lifetimeMs === undefined ? {} : { lifetimeMs: options.lifetimeMs }), targetPlatform: Object.freeze({ ...platform }), resources: Object.freeze(resources), pathPrepend: Object.freeze(pathPrepend),
    ...(options.user === undefined ? {} : { user: nonempty(options.user, "user") }),
  });
  const identity: JsonValue = { image, ...(plan.lifetimeMs === undefined ? {} : { lifetimeMs: plan.lifetimeMs }), targetPlatform: { os: platform.os, arch: platform.arch, libc: platform.libc }, resources, pathPrepend,
    ...(plan.user === undefined ? {} : { user: plan.user }),
  };
  return defineSandboxTemplate({
    provider: "opensandbox", kind: "image", publishableIdentity: identity, privateFingerprintIdentity: identity,
    commandPlanLocator: { _tag: "Exact", fields: [{ name: "image", value: image }] }, leakGate: { _tag: "None" },
    plan: () => Effect.succeed(sandboxProviderPlan({
      provider: "opensandbox", plannerRevision: "opensandbox-image-1", caseKind: "prebuilt",
      target: { platform: plan.targetPlatform, source: "provider-defined" },
      scheduling: { recommendedConcurrency: 4, lane: { key: "opensandbox", limit: 4 }, admission: { _tag: "Shared" } },
      module: providerModule, runtimePlan: plan,
      build: { _tag: "None", caseKey: computeCaseKey({ caseKind: "prebuilt", materializerRevision: "opensandbox-image-1", buildKeys: [], caseParams: identity }), buildKeys: [] },
      publishableIdentity: identity, privateFingerprintIdentity: identity,
    })),
  });
}
