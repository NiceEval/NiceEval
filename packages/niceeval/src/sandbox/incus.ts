import { Effect } from "effect";
import type { JsonValue } from "../shared/types.ts";
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
  type IncusSandboxResources,
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

function resourcesOf(value: unknown): IncusSandboxResources {
  if (value === undefined) return Object.freeze({});
  assertRecord(value, "incusSandbox options.resources");
  assertOnlyKeys(value, ["cpus", "memoryBytes", "dockerDataBytes"], "incusSandbox options.resources");
  return Object.freeze({
    ...(optionalPositiveInteger(value.cpus, "incusSandbox options.resources.cpus") === undefined
      ? {}
      : { cpus: value.cpus as number }),
    ...(optionalPositiveInteger(value.memoryBytes, "incusSandbox options.resources.memoryBytes") === undefined
      ? {}
      : { memoryBytes: value.memoryBytes as number }),
    ...(optionalPositiveInteger(value.dockerDataBytes, "incusSandbox options.resources.dockerDataBytes") === undefined
      ? {}
      : { dockerDataBytes: value.dockerDataBytes as number }),
  });
}

function imageOf(value: unknown): IncusImageLocator {
  try {
    return parseIncusImageLocator(value, "incusSandbox options.image");
  } catch (cause) {
    throw new TypeError(cause instanceof Error ? cause.message : String(cause));
  }
}

export function normalizeIncusSandboxOptions(options: IncusSandboxOptions): NormalizedIncusSandboxOptions {
  assertRecord(options, "incusSandbox options");
  assertOnlyKeys(
    options,
    ["image", "project", "storagePool", "resources", "acceptDevelopmentDomain"],
    "incusSandbox options",
  );
  const acceptDevelopmentDomain = options.acceptDevelopmentDomain === undefined
    ? false
    : options.acceptDevelopmentDomain === true;
  if (options.acceptDevelopmentDomain !== undefined && typeof options.acceptDevelopmentDomain !== "boolean") {
    throw new TypeError("incusSandbox options.acceptDevelopmentDomain must be a boolean");
  }
  return Object.freeze({
    image: imageOf(options.image),
    project: nonEmptyString(options.project, "incusSandbox options.project"),
    storagePool: nonEmptyString(options.storagePool, "incusSandbox options.storagePool"),
    resources: resourcesOf(options.resources),
    acceptDevelopmentDomain,
  });
}

function planningError(failure: ReturnType<typeof toPlanningError>): SandboxProviderPlanningError {
  return new SandboxProviderPlanningError({
    code: failure.code,
    provider: "incus",
    summary: failure.summary,
    actions: Object.freeze([...failure.actions]),
  });
}

function resourcesJson(resources: IncusSandboxResources): JsonValue {
  return {
    ...(resources.cpus === undefined ? {} : { cpus: resources.cpus }),
    ...(resources.memoryBytes === undefined ? {} : { memoryBytes: resources.memoryBytes }),
    ...(resources.dockerDataBytes === undefined ? {} : { dockerDataBytes: resources.dockerDataBytes }),
  };
}

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
    plan: () => planIncusSandboxEffect(normalized).pipe(
      Effect.map((planned) => sandboxProviderPlan({
        provider: "incus",
        plannerRevision: INCUS_PLANNER_REVISION,
        caseKind: "prebuilt",
        target: Object.freeze({
          platform: Object.freeze({ _tag: "Linux" as const, os: "linux" as const, arch: "x64", libc: "gnu" as const }),
          source: "provider-standard" as const,
        }),
        scheduling: Object.freeze({
          recommendedConcurrency: planned.domain.maxInstances,
          lane: Object.freeze({
            key: `incus:${planned.domain.project}:${planned.domain.storagePool}`,
            limit: planned.domain.maxInstances,
          }),
          admission: Object.freeze({ _tag: "Shared" as const }),
        }),
        module: incusProviderModule(planned.dockerExecution),
        runtimePlan: planned.runtime,
        build: Object.freeze({
          _tag: "None" as const,
          caseKey: computeCaseKey({
            caseKind: "prebuilt",
            materializerRevision: INCUS_PLANNER_REVISION,
            buildKeys: [],
            caseParams: privateIdentity,
          }),
          buildKeys: [] as const,
        }),
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
      })),
      Effect.mapError(planningError),
    ),
  });
}
