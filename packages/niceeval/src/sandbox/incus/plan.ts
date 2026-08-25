import { Effect } from "effect";
import type { DockerExecutionCapability } from "../layer.ts";
import { IncusControl, type IncusImage } from "./control.ts";
import {
  DEVELOPMENT_PROJECT,
  DEVELOPMENT_STORAGE_POOL,
  domainByName,
  INCUS_USER,
  INCUS_WORKDIR,
  loadIncusDescriptor,
  matchDomain,
  REFERENCE_PROJECT,
  REFERENCE_STORAGE_POOL,
  type IncusDomainDescriptor,
  type IncusDomainName,
  type IncusProviderDescriptor,
} from "./descriptor.ts";
import { incusError, type IncusProviderError } from "./errors.ts";
import { parseIncusImageLocator, type IncusImageLocator } from "./image.ts";
import { countActiveAllocations, listAllocationIntents } from "./ledger.ts";

export interface IncusSandboxResources {
  readonly cpus?: number;
  readonly memoryBytes?: number;
  readonly dockerDataBytes?: number;
}

export interface IncusSandboxOptions {
  readonly image: string;
  readonly project: string;
  readonly storagePool: string;
  readonly resources?: IncusSandboxResources;
  readonly acceptDevelopmentDomain?: boolean;
}

export interface NormalizedIncusSandboxOptions {
  readonly image: IncusImageLocator;
  readonly project: string;
  readonly storagePool: string;
  readonly resources: IncusSandboxResources;
  readonly acceptDevelopmentDomain: boolean;
}

export interface IncusRuntimePlan {
  readonly image: IncusImageLocator;
  readonly imageFingerprint: string;
  readonly project: string;
  readonly storagePool: string;
  readonly network: string;
  readonly workdir: typeof INCUS_WORKDIR;
  readonly user: typeof INCUS_USER;
  readonly hostGateway: string;
  readonly targetAppProxyPort?: number;
  readonly resources: IncusSandboxResources;
  readonly allocatedDockerDataBytes: number;
  readonly acceptDevelopmentDomain: boolean;
  readonly executionDomain: IncusDomainName;
  readonly executionDomainId: string;
  readonly storage: IncusDomainDescriptor["storage"];
  readonly quota: IncusDomainDescriptor["quota"];
  readonly maxInstances: number;
  readonly artifactProject: string;
  readonly artifactMaxInstances: number;
}

export interface IncusPlannedSandbox {
  readonly descriptor: IncusProviderDescriptor;
  readonly domain: IncusDomainDescriptor;
  readonly image: IncusImage;
  readonly runtime: IncusRuntimePlan;
  readonly dockerExecution: DockerExecutionCapability;
}

function developmentRejected(domain: IncusDomainDescriptor): IncusProviderError {
  return incusError(
    "sandbox-capability-unsatisfied",
    `Incus development domain ${JSON.stringify(domain.executionDomainId)} requires acceptDevelopmentDomain: true ` +
      `and project ${JSON.stringify(DEVELOPMENT_PROJECT)} / storagePool ${JSON.stringify(DEVELOPMENT_STORAGE_POOL)}.`,
    [
      "Keep the reference domain for attested runs.",
      "For the isolated development Incus domain only, set acceptDevelopmentDomain: true explicitly; this does not attest capacity or make the run reference-comparable.",
    ],
  );
}

function undeployed(domain: IncusDomainDescriptor): IncusProviderError {
  return incusError(
    "incus-undeployed",
    `Incus domain ${JSON.stringify(domain.name)} (${domain.executionDomainId}) is undeployed` +
      (domain.reason === undefined ? "." : `: ${domain.reason}`),
    ["Deploy the requested Incus execution domain before planning or creating sandboxes."],
  );
}

export function dockerExecutionCapability(
  domain: IncusDomainDescriptor,
  acceptDevelopmentDomain: boolean,
  allocatedDockerDataBytes: number,
): DockerExecutionCapability {
  if (domain.name === "development") {
    return Object.freeze({
      api: "docker/v1",
      compose: "v2",
      isolation: "dedicated-kernel/v1",
      daemon: "sandbox-private",
      executionDomain: "development",
      executionDomainId: domain.executionDomainId,
      capacity: Object.freeze({
        _tag: "Unattested" as const,
        acceptedByExperiment: acceptDevelopmentDomain,
        reason: "development Incus domain does not attest Docker data capacity",
      }),
    });
  }
  return Object.freeze({
    api: "docker/v1",
    compose: "v2",
    isolation: "dedicated-kernel/v1",
    daemon: "sandbox-private",
    executionDomain: "reference",
    executionDomainId: domain.executionDomainId,
    capacity: Object.freeze({
      _tag: "Attested" as const,
      bytes: allocatedDockerDataBytes,
    }),
  });
}

export async function selectDomain(
  descriptor: IncusProviderDescriptor,
  options: NormalizedIncusSandboxOptions,
): Promise<IncusDomainDescriptor> {
  const domain = matchDomain(descriptor, options.project, options.storagePool);
  if (domain === undefined) {
    throw incusError(
      "incus-domain-mismatch",
      `No Incus descriptor domain matches project ${JSON.stringify(options.project)} ` +
        `and storagePool ${JSON.stringify(options.storagePool)}.`,
      [
        `Reference uses ${REFERENCE_PROJECT}/${REFERENCE_STORAGE_POOL}; development uses ${DEVELOPMENT_PROJECT}/${DEVELOPMENT_STORAGE_POOL}.`,
      ],
    );
  }
  if (domain.status !== "configured") throw undeployed(domain);
  if (domain.name === "development") {
    if (
      options.project !== DEVELOPMENT_PROJECT
      || options.storagePool !== DEVELOPMENT_STORAGE_POOL
      || options.acceptDevelopmentDomain !== true
    ) {
      throw developmentRejected(domain);
    }
  } else if (options.acceptDevelopmentDomain === true) {
    throw incusError(
      "sandbox-capability-unsatisfied",
      "acceptDevelopmentDomain is only valid for the isolated development Incus domain.",
      [`Omit acceptDevelopmentDomain, or select project ${DEVELOPMENT_PROJECT} and storagePool ${DEVELOPMENT_STORAGE_POOL}.`],
    );
  } else if (options.project !== REFERENCE_PROJECT || options.storagePool !== REFERENCE_STORAGE_POOL) {
    throw incusError(
      "incus-domain-mismatch",
      `Reference Incus domain requires project ${REFERENCE_PROJECT} and storagePool ${REFERENCE_STORAGE_POOL}.`,
      ["Point incusSandbox at the reference project and pool."],
    );
  }
  return domain;
}

function allocatedBytes(options: NormalizedIncusSandboxOptions, domain: IncusDomainDescriptor): number {
  const requested = options.resources.dockerDataBytes ?? domain.dockerDataBytes;
  if (requested === undefined) {
    throw incusError(
      "sandbox-capability-unsatisfied",
      "The configured Incus domain has no default Docker data disk size.",
      ["Set domain.dockerDataBytes in the host descriptor, or override resources.dockerDataBytes for this Experiment."],
    );
  }
  if (domain.quota === "attested" && domain.dockerDataBytes !== undefined && requested > domain.dockerDataBytes) {
    throw incusError(
      "sandbox-capacity-unavailable",
      `Requested dockerDataBytes ${requested} exceeds attested domain quota ${domain.dockerDataBytes}.`,
      ["Lower resources.dockerDataBytes or deploy a larger attested Docker data disk."],
    );
  }
  return requested;
}

export async function planIncusSandbox(
  options: NormalizedIncusSandboxOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<IncusPlannedSandbox> {
  const descriptor = await loadIncusDescriptor(env);
  const domain = await selectDomain(descriptor, options);
  if (domain.trustedBaseImages.length === 0) {
    throw incusError(
      "sandbox-artifact-unverified",
      `Incus domain ${JSON.stringify(domain.name)} has an empty trustedBaseImages list.`,
      ["Publish at least one digest-pinned trusted image before planning."],
    );
  }
  const allocatedDockerDataBytes = allocatedBytes(options, domain);
  const control = await IncusControl.connectReadOnly(env);
  if (!(await control.projectExists(domain.project))) {
    throw incusError(
      "incus-undeployed",
      `Incus project ${JSON.stringify(domain.project)} is not present.`,
      ["Create the descriptor project in Incus before planning sandboxes."],
    );
  }
  if (domain.name === "reference") {
    if (domain.source === undefined || domain.backingDevice === undefined) {
      throw incusError(
        "incus-undeployed",
        "Configured reference domain is missing pinned source/backingDevice.",
        ["Pin source and backingDevice in the descriptor; undeployed reference may omit them and fail closed."],
      );
    }
    await control.attestReferenceStorage(domain.project, domain.storagePool, domain.network, {
      source: domain.source,
      backingDevice: domain.backingDevice,
    });
  } else {
    await control.attestDevelopmentStorage(domain.project, domain.storagePool);
  }
  const image = await control.resolveTrustedImage(domain.project, options.image, domain.trustedBaseImages);
  await control.assertGuestInitMountsBlockDockerData(domain.project, image.fingerprint);
  const instances = await control.listInstances(domain.project);
  const volumes = await control.listVolumes(domain.project, domain.storagePool);
  const intents = await listAllocationIntents(env);
  const active = countActiveAllocations(
    intents,
    instances,
    domain.executionDomainId,
    domain.project,
    volumes,
  );
  if (active >= domain.maxInstances) {
    throw incusError(
      "sandbox-capacity-unavailable",
      `Incus domain ${JSON.stringify(domain.executionDomainId)} has no free allocation ` +
        `(${active}/${domain.maxInstances} in use).`,
      ["Wait for in-flight Incus allocations to destroy, or raise the domain maxInstances after attesting capacity."],
    );
  }
  const dockerExecution = dockerExecutionCapability(domain, options.acceptDevelopmentDomain, allocatedDockerDataBytes);
  const runtime: IncusRuntimePlan = Object.freeze({
    image: options.image,
    imageFingerprint: image.fingerprint,
    project: domain.project,
    storagePool: domain.storagePool,
    network: domain.network,
    workdir: INCUS_WORKDIR,
    user: INCUS_USER,
    hostGateway: domain.hostGateway,
    ...(domain.targetAppProxyPort === undefined ? {} : { targetAppProxyPort: domain.targetAppProxyPort }),
    resources: Object.freeze({ ...options.resources, dockerDataBytes: allocatedDockerDataBytes }),
    allocatedDockerDataBytes,
    acceptDevelopmentDomain: options.acceptDevelopmentDomain,
    executionDomain: domain.name,
    executionDomainId: domain.executionDomainId,
    storage: domain.storage,
    quota: domain.quota,
    maxInstances: domain.maxInstances,
    artifactProject: domain.artifactProject,
    artifactMaxInstances: domain.artifactMaxInstances,
  });
  return Object.freeze({ descriptor, domain, image, runtime, dockerExecution });
}


export function planIncusSandboxEffect(
  options: NormalizedIncusSandboxOptions,
): Effect.Effect<IncusPlannedSandbox, IncusProviderError> {
  return Effect.tryPromise({
    try: () => planIncusSandbox(options),
    catch: (cause) => cause instanceof Error && "code" in cause
      ? cause as IncusProviderError
      : incusError(
          "incus-unreachable",
          `Incus planning failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          ["Make the Incus control plane reachable and retry planning."],
          cause,
        ),
  });
}

export function loadDomainForDoctor(
  name: IncusDomainName,
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<
  { readonly descriptor: IncusProviderDescriptor; readonly domain: IncusDomainDescriptor },
  IncusProviderError
> {
  return Effect.tryPromise({
    try: async () => {
      const descriptor = await loadIncusDescriptor(env);
      const domain = domainByName(descriptor, name);
      if (domain === undefined) {
        throw incusError(
          "incus-undeployed",
          `Incus descriptor has no ${name} domain.`,
          ["Add the requested domain to the Incus provider descriptor."],
        );
      }
      return Object.freeze({ descriptor, domain });
    },
    catch: (cause) => cause instanceof Error && "code" in cause
      ? cause as IncusProviderError
      : incusError(
          "incus-descriptor-invalid",
          `Failed to load Incus descriptor: ${cause instanceof Error ? cause.message : String(cause)}`,
          ["Fix the Incus provider descriptor and retry doctor."],
          cause,
        ),
  });
}
