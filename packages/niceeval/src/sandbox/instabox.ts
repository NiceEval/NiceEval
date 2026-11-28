import { Effect, Option, Schema } from "effect";
import type { JsonValue } from "../shared/types.ts";
import { computeCaseKey } from "./identity.ts";
import { defineSandboxTemplate, sandboxProviderPlan, type SandboxLayer, type SandboxProviderModule } from "./layer.ts";
import { providerBoundaryEffect } from "./backend.ts";
import { SandboxRuntimeMaterializationError } from "./runtime.ts";
import { remoteSnapshotPreparer } from "./remote-snapshot/preparer.ts";
import { instaboxSnapshotDriver } from "./instabox/snapshot-driver.ts";

export const INSTABOX_MACHINE_SPECS = {
  "2/4": { vcpus: 2, memMiB: 4096 },
  "4/8": { vcpus: 4, memMiB: 8192 },
  "8/16": { vcpus: 8, memMiB: 16384 },
  "16/32": { vcpus: 16, memMiB: 32768 },
  "32/64": { vcpus: 32, memMiB: 65536 },
  "instabox-small": { vcpus: 2, memMiB: 4096 },
  "instabox-medium": { vcpus: 4, memMiB: 8192 },
  "instabox-large": { vcpus: 8, memMiB: 16384 },
  "instabox-xlarge": { vcpus: 16, memMiB: 32768 },
  "instabox-2xlarge": { vcpus: 32, memMiB: 65536 },
} as const;

/** Selects a named Instabox machine size; use explicit resource settings only according to the factory's selection rules. */
export type InstaboxMachineSpec = keyof typeof INSTABOX_MACHINE_SPECS;

/** Names an official Instabox template; arbitrary custom template IDs use the wider InstaboxTemplateId type. */
export type InstaboxOfficialTemplateId =
  | "universal"
  | "agent-browser"
  | "android"
  | "ci"
  | "herdr"
  | "orca"
  | "t3"
  | "omarchy";

/** Accepts an official or custom Instabox template ID; it names a template rather than a saved snapshot. */
export type InstaboxTemplateId = InstaboxOfficialTemplateId | (string & {});

/** Selects an Instabox template or snapshot and resource limits; lifetimeMs uses milliseconds while explicit memory resources use MiB. */
export interface InstaboxSandboxOptions {
  readonly snapshotId?: string | undefined;
  readonly templateId?: InstaboxTemplateId | undefined;
  readonly template?: InstaboxTemplateId | undefined;
  readonly lifetimeMs?: number | undefined;
  readonly spec?: InstaboxMachineSpec | undefined;
  readonly resources?: { readonly vcpus: number; readonly memMiB: number } | undefined;
  readonly pathPrepend?: readonly string[] | undefined;
}

export interface InstaboxProviderPlan {
  readonly source:
    | { readonly _tag: "Snapshot"; readonly id: string }
    | { readonly _tag: "Template"; readonly id: InstaboxTemplateId };
  readonly lifetimeMs: number | undefined;
  readonly resources: { readonly vcpus: number; readonly memMiB: number };
  readonly explicitSize: boolean;
  readonly pathPrepend: readonly string[];
}

const positiveInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));
const Options = Schema.Struct({
  snapshotId: Schema.optional(Schema.String.check(Schema.isPattern(/^sn_[A-Za-z0-9_-]+$/))),
  templateId: Schema.optional(Schema.String),
  template: Schema.optional(Schema.String),
  lifetimeMs: Schema.optional(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 60_000, maximum: 86_400_000 }),
      Schema.isMultipleOf(1000),
    ),
  ),
  resources: Schema.optional(Schema.Struct({ vcpus: positiveInteger, memMiB: positiveInteger })),
  spec: Schema.optional(Schema.Literals(Object.keys(INSTABOX_MACHINE_SPECS) as InstaboxMachineSpec[])),
  pathPrepend: Schema.optional(Schema.Array(Schema.String.check(Schema.isPattern(/^\/[^\0:\r\n]*$/)))),
});
const decodeOptions = Schema.decodeUnknownSync(Options, { onExcessProperty: "error" });
const revision = "instabox-snapshot-1";
const providerModule: SandboxProviderModule<InstaboxProviderPlan> = {
  id: "niceeval/instabox-snapshot",
  beforeCache: { _tag: "RunPrepared", coverage: "all", preparer: remoteSnapshotPreparer(instaboxSnapshotDriver) },
  capabilities: {
    retention: { _tag: "DestroyOnly" },
    reuse: { _tag: "Unsupported", reason: "Instabox machines belong to one Attempt." },
    sessionLimit: { _tag: "ProviderValidated", reason: "Instabox validates the declared deletion deadline." },

    dockerExecution: undefined,
  },
  collectBuildPreparation: () => Effect.succeed(Option.none()),
  materialize: (plan, context) =>
    Effect.flatMap(
      providerBoundaryEffect(() => import("./instabox/materialize.ts")),
      (module) => module.materializeInstabox(plan, context),
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof SandboxRuntimeMaterializationError
          ? cause
          : new SandboxRuntimeMaterializationError({
              code: "sandbox.materialization-failed",
              provider: "instabox",
              message: cause.message,
              cause,
            }),
      ),
    ),
};

/** Start an independent Instabox machine from a snapshot or template (default: universal). */
export function instaboxSandbox(options: InstaboxSandboxOptions): SandboxLayer<"template-bearing"> {
  const parsed = decodeOptions(options);
  const plan: InstaboxProviderPlan = {
    source:
      parsed.snapshotId !== undefined
        ? { _tag: "Snapshot", id: parsed.snapshotId }
        : { _tag: "Template", id: parsed.templateId ?? parsed.template ?? "universal" },
    lifetimeMs: parsed.lifetimeMs,
    resources: { ...(parsed.resources ?? INSTABOX_MACHINE_SPECS[parsed.spec ?? "instabox-medium"]) },
    explicitSize: parsed.resources !== undefined || parsed.spec !== undefined,
    pathPrepend: [...(parsed.pathPrepend ?? [])],
  };
  const identity: JsonValue = {
    provider: "instabox",
    origin: "https://api.instabox.sh",
    revision,
    ...(plan.source._tag === "Snapshot" ? { snapshotId: plan.source.id } : { templateId: plan.source.id }),
    ...(plan.lifetimeMs === undefined ? {} : { lifetimeMs: plan.lifetimeMs }),
    resources: plan.resources,
    ...(parsed.spec === undefined ? {} : { spec: parsed.spec }),
    pathPrepend: [...plan.pathPrepend],
  };
  return defineSandboxTemplate({
    provider: "instabox",
    kind: "snapshot",
    publishableIdentity: identity,
    privateFingerprintIdentity: identity,
    commandPlanLocator: {
      _tag: "Exact",
      fields: [
        plan.source._tag === "Snapshot"
          ? { name: "snapshotId", value: plan.source.id }
          : { name: "templateId", value: plan.source.id },
      ],
    },
    leakGate: { _tag: "None" },
    plan: () =>
      Effect.succeed(
        sandboxProviderPlan({
          provider: "instabox",
          plannerRevision: revision,
          caseKind: "prebuilt",
          target: { platform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" }, source: "provider-defined" },
          scheduling: {
            recommendedConcurrency: 10,
            lane: { key: "instabox", limit: 10 },
            admission: { _tag: "Shared" },
          },
          module: providerModule,
          runtimePlan: plan,
          build: {
            _tag: "None",
            caseKey: computeCaseKey({
              caseKind: "prebuilt",
              materializerRevision: revision,
              buildKeys: [],
              caseParams: identity,
            }),
            buildKeys: [],
          },
          publishableIdentity: identity,
          privateFingerprintIdentity: identity,

          interruptibleAcquisition: false,
          identityMarker: undefined,
        }),
      ),
  });
}
