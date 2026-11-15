import { Effect } from "effect";
import { IncusControl } from "./control.ts";
import { domainByName, incusDescriptorPath, loadIncusDescriptor, type IncusDomainName } from "./descriptor.ts";
import { incusError, isIncusProviderError, type IncusProviderError } from "./errors.ts";
import {
  INCUS_GUEST_INIT_BLOCK_DOCKER_DATA,
  INCUS_IMAGE_GUEST_INIT_PROPERTY,
  parseIncusImageLocator,
} from "./image.ts";
import { countActiveAllocations, listAllocationIntents } from "./ledger.ts";
import { readArtifactInventory } from "./inventory.ts";
import { dockerExecutionCapability } from "./plan.ts";
import { incusRepositoryHost, type IncusRepository } from "./repository.ts";
import { artifactByteEstimate, inspectArtifactStorage } from "./storage.ts";
import { artifactBelongsToDomain } from "./inventory.ts";

export type IncusDoctorStatus = "PASS" | "FAIL";

export type IncusDoctorCheckId =
  | "descriptor"
  | "control"
  | "project"
  | "storage-pool"
  | "domain"
  | "trusted-image"
  | "capacity"
  | "artifact-inventory"
  | "artifact-storage"
  | "artifact-capacity";

export interface IncusDoctorCheck {
  readonly id: IncusDoctorCheckId;
  readonly status: IncusDoctorStatus;
  readonly code: string | undefined;
  readonly detail: string;
}

export interface IncusDoctorReport {
  readonly provider: "incus";
  readonly domain: IncusDomainName;
  readonly status: IncusDoctorStatus;
  readonly descriptorPath: string;
  readonly failClosed: true;
  readonly checks: readonly IncusDoctorCheck[];
  readonly dockerExecution: ReturnType<typeof dockerExecutionCapability> | undefined;
}

export interface IncusDoctorOptions {
  readonly domain?: IncusDomainName | undefined;
}

function check(id: IncusDoctorCheckId, status: IncusDoctorStatus, detail: string, code?: string): IncusDoctorCheck {
  return {
    id,
    status,
    detail,
    code,
  };
}

function failRest(after: readonly IncusDoctorCheckId[], code: string, detail: string): IncusDoctorCheck[] {
  return after.map((id) => check(id, "FAIL", detail, code));
}

function errorCode(error: unknown): string {
  return isIncusProviderError(error) ? error.code : "incus-unreachable";
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function doctorIncusProviderWithRepository(
  repository: IncusRepository,
  options: IncusDoctorOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<IncusDoctorReport> {
  const domainName = options.domain ?? "reference";
  const descriptorPath = incusDescriptorPath(env);
  const checks: IncusDoctorCheck[] = [];
  const remaining = (after: IncusDoctorCheckId): IncusDoctorReport => {
    const rest: IncusDoctorCheckId[] = [
      "descriptor",
      "control",
      "project",
      "storage-pool",
      "domain",
      "trusted-image",
      "capacity",
      "artifact-inventory",
      "artifact-capacity",
      "artifact-storage",
    ].filter((id) => !checks.some((entry) => entry.id === id) && id !== after) as IncusDoctorCheckId[];
    checks.push(...failRest(rest, "PREREQUISITE_FAILED", "the preceding diagnostic stage failed closed"));
    return {
      provider: "incus",
      domain: domainName,
      status: "FAIL",
      descriptorPath,
      failClosed: true,
      checks,
      dockerExecution: undefined,
    };
  };

  let descriptor;
  try {
    descriptor = await loadIncusDescriptor(env);
  } catch (cause) {
    checks.push(check("descriptor", "FAIL", errorDetail(cause), errorCode(cause)));
    return remaining("descriptor");
  }

  const domain = domainByName(descriptor, domainName);
  if (domain === undefined) {
    checks.push(check("descriptor", "FAIL", `Incus descriptor has no ${domainName} domain.`, "incus-undeployed"));
    return remaining("descriptor");
  }
  checks.push(
    check("descriptor", "PASS", `loaded ${descriptorPath} domain ${domain.name} (${domain.executionDomainId})`),
  );
  if (domain.status !== "configured") {
    checks.push(check("domain", "FAIL", domain.reason ?? `domain ${domain.name} is undeployed`, "incus-undeployed"));
    return remaining("domain");
  }
  checks.push(
    check(
      "domain",
      "PASS",
      `${domain.name} · ${domain.executionDomainId} · project ${domain.project} · pool ${domain.storagePool} · ${domain.name === "development" ? "capacity not verified for reference comparisons" : "dedicated storage with verified capacity"}`,
    ),
  );

  if (domain.trustedBaseImages.length === 0) {
    checks.push(check("trusted-image", "FAIL", "trustedBaseImages is empty", "sandbox-artifact-unverified"));
    return remaining("trusted-image");
  }

  let control: IncusControl;
  try {
    control = await IncusControl.connectReadOnly(env);
    checks.push(check("control", "PASS", `Incus control plane reachable via ${control.mode}`));
  } catch (cause) {
    checks.push(check("control", "FAIL", errorDetail(cause), errorCode(cause)));
    return remaining("control");
  }

  try {
    if (!(await control.projectExists(domain.project))) {
      checks.push(check("project", "FAIL", `project ${JSON.stringify(domain.project)} is absent`, "incus-undeployed"));
      return remaining("project");
    }
    checks.push(check("project", "PASS", `project ${domain.project} is present`));
  } catch (cause) {
    checks.push(check("project", "FAIL", errorDetail(cause), errorCode(cause)));
    return remaining("project");
  }

  try {
    if (domain.name === "reference") {
      if (domain.source === undefined || domain.backingDevice === undefined) {
        throw incusError("incus-undeployed", "Configured reference domain is missing pinned source/backingDevice.", [
          "Pin source and backingDevice in the descriptor.",
        ]);
      }
      const storage = await control.attestReferenceStorage(domain.project, domain.storagePool, domain.network, {
        source: domain.source,
        backingDevice: domain.backingDevice,
      });
      checks.push(
        check(
          "storage-pool",
          "PASS",
          `attested ${storage.driver} pool ${storage.name} backing=${storage.backingDevice}`,
        ),
      );
    } else {
      const storage = await control.attestDevelopmentStorage(domain.project, domain.storagePool);
      checks.push(check("storage-pool", "PASS", `development directory pool ${storage.name} at ${storage.source}`));
    }
  } catch (cause) {
    checks.push(check("storage-pool", "FAIL", errorDetail(cause), errorCode(cause)));
    return remaining("storage-pool");
  }

  try {
    const images = await control.listImages(domain.project);
    const trusted = domain.trustedBaseImages.map((entry, index) =>
      parseIncusImageLocator(entry, `trustedBaseImages[${index}]`),
    );
    const present = trusted.filter((image) =>
      images.some((candidate) => candidate.fingerprint === image.digest && candidate.aliases.includes(image.name)),
    );
    if (present.length === 0) {
      checks.push(
        check(
          "trusted-image",
          "FAIL",
          "none of the digest-pinned trusted images are present locally as that exact locator and digest",
          "sandbox-artifact-unverified",
        ),
      );
      return remaining("trusted-image");
    }
    const mountable = present.filter((image) =>
      images.some(
        (candidate) =>
          candidate.fingerprint === image.digest &&
          candidate.aliases.includes(image.name) &&
          candidate.type === "virtual-machine" &&
          candidate.properties[INCUS_IMAGE_GUEST_INIT_PROPERTY] === INCUS_GUEST_INIT_BLOCK_DOCKER_DATA,
      ),
    );
    if (mountable.length === 0) {
      checks.push(
        check(
          "trusted-image",
          "FAIL",
          `present trusted images do not prove guest-init can mount a block Docker data disk (${INCUS_IMAGE_GUEST_INIT_PROPERTY}=${INCUS_GUEST_INIT_BLOCK_DOCKER_DATA})`,
          "sandbox-artifact-unverified",
        ),
      );
      return remaining("trusted-image");
    }
    checks.push(
      check("trusted-image", "PASS", `present trusted digests: ${present.map((image) => image.digest).join(", ")}`),
    );
  } catch (cause) {
    checks.push(check("trusted-image", "FAIL", errorDetail(cause), errorCode(cause)));
    return remaining("trusted-image");
  }

  try {
    const instances = await control.listInstances(domain.project);
    const volumes = await control.listVolumes(domain.project, domain.storagePool);
    const intents = await listAllocationIntents(repository);
    const active = countActiveAllocations(intents, instances, domain.executionDomainId, domain.project, volumes);
    const free = Math.max(0, domain.maxInstances - active);
    if (free === 0) {
      checks.push(
        check(
          "capacity",
          "FAIL",
          `no free allocations (${active}/${domain.maxInstances})`,
          "sandbox-capacity-unavailable",
        ),
      );
    } else {
      checks.push(check("capacity", "PASS", `${free} free of ${domain.maxInstances}`));
    }
  } catch (cause) {
    checks.push(check("capacity", "FAIL", errorDetail(cause), errorCode(cause)));
    return remaining("capacity");
  }

  try {
    const inventory = await readArtifactInventory(repository, control, domain);
    const artifacts = inventory.entries.filter((entry) => entry.intent.state !== "released");
    const committed = artifacts.filter((entry) => entry.intent.state === "committed");
    const drifted = artifacts.filter(
      (entry) => entry.verification !== "verified" || entry.intent.state !== "committed",
    );
    if (inventory.orphans.length !== 0 || drifted.length !== 0) {
      checks.push(
        check(
          "artifact-inventory",
          "FAIL",
          `${drifted.length} caches with missing or changed resources; ${inventory.orphans.length} unregistered resources`,
          "sandbox-artifact-unverified",
        ),
      );
    } else {
      checks.push(
        check(
          "artifact-inventory",
          "PASS",
          `${committed.length} saved caches, ${committed.filter((entry) => entry.verification === "verified").length} verified VM and volume pairs; project=${domain.artifactProject} pool=${domain.storagePool}`,
        ),
      );
    }
    const free = Math.max(0, domain.artifactMaxInstances - artifacts.length);
    if (free === 0) {
      checks.push(
        check(
          "artifact-capacity",
          "FAIL",
          `no free cache slots (${artifacts.length}/${domain.artifactMaxInstances})`,
          "sandbox-capacity-unavailable",
        ),
      );
    } else {
      checks.push(check("artifact-capacity", "PASS", `${free} free of ${domain.artifactMaxInstances}`));
    }
  } catch (cause) {
    checks.push(check("artifact-capacity", "FAIL", errorDetail(cause), errorCode(cause)));
    return remaining("artifact-capacity");
  }

  try {
    const estimate = artifactByteEstimate(
      (await repository.listArtifacts()).filter((entry) => artifactBelongsToDomain(entry, domain)),
      domain.artifactEstimatedBytes,
    );
    const storage = await inspectArtifactStorage(
      control,
      domain.artifactProject,
      domain.storagePool,
      domain.artifactStorageReserveBytes,
      estimate,
    );
    checks.push(
      check(
        "artifact-storage",
        "PASS",
        `pool ${domain.storagePool}: free ${storage.free} bytes, required ${storage.required} bytes, reserved for builds ${storage.inFlightReservedBytes} bytes; ${storage.estimatedArtifactBytes} bytes estimate, not additive`,
      ),
    );
  } catch (cause) {
    checks.push(check("artifact-storage", "FAIL", errorDetail(cause), errorCode(cause)));
  }

  const failed = checks.some((entry) => entry.status === "FAIL");
  return {
    provider: "incus",
    domain: domainName,
    status: failed ? "FAIL" : "PASS",
    descriptorPath,
    failClosed: true,
    checks,
    dockerExecution: dockerExecutionCapability(domain, domainName === "development", domain.dockerDataBytes ?? 1),
  };
}

export function doctorIncusProvider(
  options: IncusDoctorOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<IncusDoctorReport> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const repository = yield* incusRepositoryHost.open({ env });
        return yield* Effect.tryPromise({
          try: () => doctorIncusProviderWithRepository(repository, options, env),
          catch: (cause) => cause,
        });
      }),
    ),
  );
}

export function doctorIncusProviderEffect(options: IncusDoctorOptions = {}): Effect.Effect<IncusDoctorReport, never> {
  return Effect.promise(() => doctorIncusProvider(options));
}

export function renderIncusDoctorReport(report: IncusDoctorReport): string {
  const names: Readonly<Record<IncusDoctorCheckId, string>> = {
    descriptor: "Configuration",
    control: "Incus connection",
    project: "Project",
    "storage-pool": "Storage pool",
    domain: "Execution environment",
    "trusted-image": "Trusted image",
    capacity: "VM capacity",
    "artifact-inventory": "Saved caches",
    "artifact-capacity": "Cache capacity",
    "artifact-storage": "Cache storage",
  };
  const lines = [
    `niceeval sandbox provider doctor incus`,
    `domain: ${report.domain}`,
    `descriptor: ${report.descriptorPath}`,
    `status: ${report.status}`,
  ];
  for (const entry of report.checks) {
    if (entry.code === "PREREQUISITE_FAILED") continue;
    lines.push(`- ${names[entry.id]}: ${entry.status} ${entry.detail}`);
  }
  const notRun = report.checks.filter((entry) => entry.code === "PREREQUISITE_FAILED").length;
  if (notRun > 0) lines.push(`${notRun} checks not run: fix the failed check first.`);
  if (
    report.checks.some(
      (entry) => entry.status === "FAIL" && entry.code !== "PREREQUISITE_FAILED" && entry.id.startsWith("artifact-"),
    )
  ) {
    const domain = report.domain === "development" ? " --development" : "";
    lines.push(
      `Next: niceeval sandbox provider inventory incus${domain}`,
      `  niceeval sandbox provider gc incus${domain}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function doctorExitCode(report: IncusDoctorReport): number {
  return report.status === "PASS" ? 0 : 1;
}

export type { IncusProviderError };
