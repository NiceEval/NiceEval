import { Effect, Option, Schema } from "effect";
import type { JsonValue } from "../shared/types.ts";
import { computeCaseKey } from "./identity.ts";
import { defineSandboxTemplate, sandboxProviderPlan, type SandboxLayer, type SandboxProviderModule } from "./layer.ts";
import { providerBoundaryEffect } from "./backend.ts";
import { SandboxRuntimeMaterializationError } from "./runtime.ts";
import { remoteSnapshotPreparer } from "./remote-snapshot/preparer.ts";
import { instaboxSnapshotDriver } from "./instabox/snapshot-driver.ts";

export interface InstaboxSandboxOptions {
  readonly snapshotId: string;
  readonly lifetimeMs: number;
  readonly resources?: { readonly vcpus: number; readonly memMiB: number };
  readonly pathPrepend?: readonly string[];
}

const positiveInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));
const Options = Schema.Struct({
  snapshotId: Schema.String.check(Schema.isPattern(/^sn_[A-Za-z0-9_-]+$/)),
  lifetimeMs: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 60_000, maximum: 86_400_000 }), Schema.isMultipleOf(1000)),
  resources: Schema.optionalKey(Schema.Struct({ vcpus: positiveInteger, memMiB: positiveInteger })),
  pathPrepend: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isPattern(/^\/[^\0:\r\n]*$/)))),
});
const decodeOptions = Schema.decodeUnknownSync(Options, { onExcessProperty: "error" });
const revision = "instabox-snapshot-1";
const providerModule: SandboxProviderModule<InstaboxSandboxOptions> = {
  id: "niceeval/instabox-snapshot",
  beforeCache: { _tag: "RunPrepared", coverage: "all", preparer: remoteSnapshotPreparer(instaboxSnapshotDriver) },
  capabilities: {
    retention: { _tag: "DestroyOnly" },
    reuse: { _tag: "Unsupported", reason: "Instabox machines belong to one Attempt." },
    sessionLimit: { _tag: "ProviderValidated", reason: "Instabox validates the declared deletion deadline." },
  },
  collectBuildPreparation: () => Effect.succeed(Option.none()),
  materialize: (plan, context) => Effect.flatMap(
    providerBoundaryEffect(() => import("./instabox/materialize.ts")),
    (module) => module.materializeInstabox(plan, context),
  ).pipe(Effect.mapError((cause) => cause instanceof SandboxRuntimeMaterializationError ? cause : new SandboxRuntimeMaterializationError({
    code: "sandbox.materialization-failed", provider: "instabox", message: cause.message, cause,
  }))),
};

/** Start an independent Instabox machine from a fixed snapshot. */
export function instaboxSandbox(options: InstaboxSandboxOptions): SandboxLayer<"template-bearing"> {
  const parsed = decodeOptions(options);
  const plan = Object.freeze({
    snapshotId: parsed.snapshotId,
    lifetimeMs: parsed.lifetimeMs,
    resources: Object.freeze({ ...(parsed.resources ?? { vcpus: 4, memMiB: 8192 }) }),
    pathPrepend: Object.freeze([...(parsed.pathPrepend ?? [])]),
  });
  const identity: JsonValue = { provider: "instabox", origin: "https://api.instabox.sh", revision, ...plan, pathPrepend: [...plan.pathPrepend] };
  return defineSandboxTemplate({
    provider: "instabox", kind: "snapshot", publishableIdentity: identity, privateFingerprintIdentity: identity,
    commandPlanLocator: { _tag: "Exact", fields: [{ name: "snapshotId", value: plan.snapshotId }] }, leakGate: { _tag: "None" },
    plan: () => Effect.succeed(sandboxProviderPlan({
      provider: "instabox", plannerRevision: revision, caseKind: "prebuilt",
      target: { platform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" }, source: "provider-defined" },
      scheduling: { recommendedConcurrency: 4, lane: { key: "instabox", limit: 4 }, admission: { _tag: "Shared" } },
      module: providerModule, runtimePlan: plan,
      build: { _tag: "None", caseKey: computeCaseKey({ caseKind: "prebuilt", materializerRevision: revision, buildKeys: [], caseParams: identity }), buildKeys: [] },
      publishableIdentity: identity, privateFingerprintIdentity: identity,
    })),
  });
}
