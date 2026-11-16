import { Effect } from "effect";
import type { JsonValue } from "../shared/types.ts";
import { omitUndefined } from "../shared/omit-undefined.ts";
import { computeCaseKey } from "./identity.ts";
import {
  defineSandboxTemplate,
  sandboxProviderPlan,
  SandboxProviderPlanningError,
  type SandboxLayer,
} from "./layer.ts";
import { INCUS_PLANNER_REVISION, incusProviderModule, toPlanningError } from "./incus/materialize.ts";
import { displayIncusOrigin, parseIncusImageLocator, type IncusImageLocator } from "./incus/image.ts";
import {
  planIncusSandboxEffect,
  type IncusSandboxOptions,
  type NormalizedIncusSandboxResources,
  type NormalizedIncusSandboxOptions,
} from "./incus/plan.ts";

export type { IncusSandboxOptions, IncusSandboxResources } from "./incus/plan.ts";
export {
  doctorIncusProvider,
  doctorIncusProviderEffect,
  doctorExitCode,
  renderIncusDoctorReport,
  type IncusDoctorOptions,
  type IncusDoctorReport,
} from "./incus/doctor.ts";

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw new TypeError(`${path}.${key} is not supported`);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive safe integer`);
  }
  return value;
}

function resourcesOf(value: unknown): NormalizedIncusSandboxResources {
  const input = value === undefined ? {} : value;
  assertRecord(input, "incusSandbox options.resources");
  assertOnlyKeys(input, ["cpus", "memoryBytes", "dockerDataBytes"], "incusSandbox options.resources");
  return {
    cpus: optionalPositiveInteger(input.cpus, "incusSandbox options.resources.cpus"),
    memoryBytes: optionalPositiveInteger(input.memoryBytes, "incusSandbox options.resources.memoryBytes"),
    dockerDataBytes: optionalPositiveInteger(input.dockerDataBytes, "incusSandbox options.resources.dockerDataBytes"),
  };
}

function imageOf(value: unknown): IncusImageLocator {
  try {
    return parseIncusImageLocator(value, "incusSandbox options.image");
  } catch (cause) {
    throw new TypeError(cause instanceof Error ? cause.message : String(cause));
  }
}

// @concord-code
// @concord-implements docs/feature/sandbox-nested-docker/library.md
// @concord-implements docs/feature/sandbox-nested-docker/architecture/README.md
export function normalizeIncusSandboxOptions(options: IncusSandboxOptions): NormalizedIncusSandboxOptions {
  assertRecord(options, "incusSandbox options");
  assertOnlyKeys(
    options,
    ["image", "project", "storagePool", "resources", "acceptDevelopmentDomain"],
    "incusSandbox options",
  );
  const acceptDevelopmentDomain =
    options.acceptDevelopmentDomain === undefined ? false : options.acceptDevelopmentDomain === true;
  if (options.acceptDevelopmentDomain !== undefined && typeof options.acceptDevelopmentDomain !== "boolean") {
    throw new TypeError("incusSandbox options.acceptDevelopmentDomain must be a boolean");
  }
  return {
    image: imageOf(options.image),
    project: nonEmptyString(options.project, "incusSandbox options.project"),
    storagePool: nonEmptyString(options.storagePool, "incusSandbox options.storagePool"),
    resources: resourcesOf(options.resources),
    acceptDevelopmentDomain,
  };
}

function planningError(failure: ReturnType<typeof toPlanningError>): SandboxProviderPlanningError {
  return new SandboxProviderPlanningError({
    code: failure.code,
    provider: "incus",
    summary: failure.summary,
    actions: failure.actions,
    cause: failure,
  });
}

function resourcesJson(resources: NormalizedIncusSandboxResources): JsonValue {
  // Identity material boundary: omitted resource overrides remain absent keys.
  return omitUndefined(resources);
}

// @concord-code
// @concord-implements docs/feature/sandbox-nested-docker/README.md
// @concord-implements docs/feature/sandbox-nested-docker/library.md
// @concord-implements docs/feature/sandbox-nested-docker/use-case/nested-docker-capability.md
/** Declares a disposable Incus VM as the Sandbox template. Select an explicit project, storage pool and image rather than assuming a host-global default. */
export function incusSandbox(options: IncusSandboxOptions): SandboxLayer<"template-bearing"> {
  const normalized = normalizeIncusSandboxOptions(options);
  const origin = displayIncusOrigin({
    image: normalized.image.locator,
    project: normalized.project,
    storagePool: normalized.storagePool,
  });
  const privateIdentity: JsonValue = {
    provider: "incus",
    kind: "vm",
    image: normalized.image.locator,
    project: normalized.project,
    storagePool: normalized.storagePool,
    resources: resourcesJson(normalized.resources),
    acceptDevelopmentDomain: normalized.acceptDevelopmentDomain,
    origin,
  };
  const publishableIdentity: JsonValue = {
    kind: "vm",
    image: normalized.image.locator,
    project: normalized.project,
    storagePool: normalized.storagePool,
    acceptDevelopmentDomain: normalized.acceptDevelopmentDomain,
    resources: resourcesJson(normalized.resources),
  };
  return defineSandboxTemplate({
    provider: "incus",
    kind: "vm",
    publishableIdentity,
    privateFingerprintIdentity: privateIdentity,
    commandPlanLocator: {
      _tag: "Exact",
      fields: [{ name: "image", value: normalized.image.locator }],
    },
    leakGate: { _tag: "None" },
    plan: () =>
      planIncusSandboxEffect(normalized).pipe(
        Effect.map((planned) =>
          sandboxProviderPlan({
            provider: "incus",
            plannerRevision: INCUS_PLANNER_REVISION,
            caseKind: "prebuilt",
            target: {
              platform: {
                _tag: "Linux" as const,
                os: "linux" as const,
                arch: "x64",
                libc: "gnu" as const,
              },
              source: "provider-standard" as const,
            },
            scheduling: {
              recommendedConcurrency: planned.domain.maxInstances,
              lane: {
                key: `incus:${planned.domain.project}:${planned.domain.storagePool}`,
                limit: planned.domain.maxInstances,
              },
              admission: { _tag: "Shared" as const },
            },
            module: incusProviderModule(planned.dockerExecution),
            runtimePlan: planned.runtime,
            build: {
              _tag: "None" as const,
              caseKey: computeCaseKey({
                caseKind: "prebuilt",
                materializerRevision: INCUS_PLANNER_REVISION,
                buildKeys: [],
                caseParams: privateIdentity,
              }),
              buildKeys: [] as const,
            },
            publishableIdentity: {
              kind: "vm",
              image: normalized.image.locator,
              project: normalized.project,
              storagePool: normalized.storagePool,
              acceptDevelopmentDomain: normalized.acceptDevelopmentDomain,
              resources: resourcesJson(normalized.resources),
              executionDomain: planned.dockerExecution.executionDomain,
              executionDomainId: planned.dockerExecution.executionDomainId,
              origin,
            },
            privateFingerprintIdentity: {
              provider: "incus",
              kind: "vm",
              image: normalized.image.locator,
              project: normalized.project,
              storagePool: normalized.storagePool,
              resources: resourcesJson(normalized.resources),
              acceptDevelopmentDomain: normalized.acceptDevelopmentDomain,
              executionDomainId: planned.dockerExecution.executionDomainId,
              imageFingerprint: planned.image.fingerprint,
              origin,
            },

            interruptibleAcquisition: false,
            identityMarker: undefined,
          }),
        ),
        Effect.mapError((cause) => planningError(toPlanningError(cause))),
      ),
  });
}
