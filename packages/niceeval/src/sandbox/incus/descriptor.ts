import { Either, Schema } from "effect";
import { readFile } from "node:fs/promises";
import { incusError, type IncusProviderError } from "./errors.ts";
import { parseIncusImageLocator } from "./image.ts";

export const INCUS_DESCRIPTOR_SCHEMA_VERSION = "niceeval.incus-provider/v1" as const;
export const DEFAULT_INCUS_DESCRIPTOR_PATH = "/etc/niceeval/incus-provider.json";
export const NICEEVAL_INCUS_DESCRIPTOR = "NICEEVAL_INCUS_DESCRIPTOR";
export const REFERENCE_PROJECT = "niceeval-eval";
export const REFERENCE_STORAGE_POOL = "niceeval-evals";
export const DEVELOPMENT_PROJECT = "niceeval-eval-dev";
export const DEVELOPMENT_STORAGE_POOL = "niceeval-sandbox-dev";
export const DEVELOPMENT_HOST_PATH = "/data/niceeval-sandbox-dev";
export const INCUS_WORKDIR = "/home/sandbox/workspace";
export const INCUS_USER = "node";
export const INCUS_UID = 1000;

const ParseOptions = Object.freeze({
  errors: "all" as const,
  exact: true,
  onExcessProperty: "error" as const,
});

const nonEmptyString = (identifier: string) =>
  Schema.String.pipe(Schema.filter(
    (value) => value.trim() !== "" && !value.includes("\0"),
    { identifier, description: "a non-empty string without NUL" },
  ));

const positiveSafeInteger = (identifier: string) =>
  Schema.Number.pipe(Schema.filter(
    (value) => Number.isSafeInteger(value) && value > 0,
    { identifier, description: "a positive safe integer" },
  ));

const DomainSchema = Schema.Struct({
  name: Schema.Literal("reference", "development"),
  status: Schema.Literal("configured", "undeployed"),
  reason: Schema.optional(nonEmptyString("IncusDomainReason")),
  executionDomainId: nonEmptyString("IncusExecutionDomainId"),
  project: nonEmptyString("IncusProject"),
  storagePool: nonEmptyString("IncusStoragePool"),
  network: nonEmptyString("IncusNetwork"),
  storage: Schema.Literal("dedicated-block", "development-dir"),
  quota: Schema.Literal("attested", "unattested"),
  maxInstances: positiveSafeInteger("IncusMaxInstances"),
  dockerDataBytes: Schema.optional(positiveSafeInteger("IncusDockerDataBytes")),
  workdir: Schema.Literal(INCUS_WORKDIR),
  user: Schema.Literal(INCUS_USER),
  hostGateway: nonEmptyString("IncusHostGateway"),
  targetAppProxyPort: Schema.optional(positiveSafeInteger("IncusTargetAppProxyPort")),
  source: Schema.optional(nonEmptyString("IncusPoolSource")),
  backingDevice: Schema.optional(nonEmptyString("IncusBackingDevice")),
  trustedImages: Schema.Array(Schema.String),
});

const DescriptorSchema = Schema.Struct({
  schemaVersion: Schema.Literal(INCUS_DESCRIPTOR_SCHEMA_VERSION),
  domains: Schema.Array(DomainSchema),
});

export type IncusDomainName = "reference" | "development";
export type IncusDomainStatus = "configured" | "undeployed";
export type IncusStorageKind = "dedicated-block" | "development-dir";
export type IncusQuota = "attested" | "unattested";

export interface IncusDomainDescriptor {
  readonly name: IncusDomainName;
  readonly status: IncusDomainStatus;
  readonly reason?: string;
  readonly executionDomainId: string;
  readonly project: string;
  readonly storagePool: string;
  readonly network: string;
  readonly storage: IncusStorageKind;
  readonly quota: IncusQuota;
  readonly maxInstances: number;
  readonly dockerDataBytes?: number;
  readonly workdir: typeof INCUS_WORKDIR;
  readonly user: typeof INCUS_USER;
  readonly hostGateway: string;
  readonly targetAppProxyPort?: number;
  readonly source?: string;
  readonly backingDevice?: string;
  readonly trustedImages: readonly string[];
}

export interface IncusProviderDescriptor {
  readonly schemaVersion: typeof INCUS_DESCRIPTOR_SCHEMA_VERSION;
  readonly domains: readonly IncusDomainDescriptor[];
  readonly path: string;
}

function freezeDomain(domain: IncusDomainDescriptor): IncusDomainDescriptor {
  return Object.freeze({
    name: domain.name,
    status: domain.status,
    ...(domain.reason === undefined ? {} : { reason: domain.reason }),
    executionDomainId: domain.executionDomainId,
    project: domain.project,
    storagePool: domain.storagePool,
    network: domain.network,
    storage: domain.storage,
    quota: domain.quota,
    maxInstances: domain.maxInstances,
    ...(domain.dockerDataBytes === undefined ? {} : { dockerDataBytes: domain.dockerDataBytes }),
    workdir: INCUS_WORKDIR,
    user: INCUS_USER,
    hostGateway: domain.hostGateway,
    ...(domain.targetAppProxyPort === undefined ? {} : { targetAppProxyPort: domain.targetAppProxyPort }),
    ...(domain.source === undefined ? {} : { source: domain.source }),
    ...(domain.backingDevice === undefined ? {} : { backingDevice: domain.backingDevice }),
    trustedImages: Object.freeze([...domain.trustedImages]),
  });
}

function semanticError(domain: IncusDomainDescriptor, path: string, message: string): IncusProviderError {
  return incusError(
    "incus-descriptor-invalid",
    `Incus descriptor domain ${JSON.stringify(domain.name)} ${path}: ${message}`,
    ["Fix /etc/niceeval/incus-provider.json or point NICEEVAL_INCUS_DESCRIPTOR at a valid v1 descriptor."],
  );
}

function validateDomain(domain: IncusDomainDescriptor): IncusProviderError | undefined {
  if (domain.name === "reference") {
    if (domain.project !== REFERENCE_PROJECT || domain.storagePool !== REFERENCE_STORAGE_POOL) {
      return semanticError(
        domain,
        "project/storagePool",
        `reference domain must use project ${REFERENCE_PROJECT} and storagePool ${REFERENCE_STORAGE_POOL}`,
      );
    }
    if (domain.storage !== "dedicated-block") {
      return semanticError(domain, "storage", "reference domain must use dedicated-block storage");
    }
    if (domain.quota !== "attested") {
      return semanticError(domain, "quota", "reference domain must attest quota");
    }
    if (domain.dockerDataBytes === undefined) {
      return semanticError(domain, "dockerDataBytes", "reference domain must declare a positive dockerDataBytes quota");
    }
    if (domain.status === "configured" && (domain.backingDevice === undefined || domain.source === undefined)) {
      return semanticError(
        domain,
        "source/backingDevice",
        "configured reference domain must pin source and backingDevice for attestation",
      );
    }
  }
  if (domain.name === "development") {
    if (domain.project !== DEVELOPMENT_PROJECT || domain.storagePool !== DEVELOPMENT_STORAGE_POOL) {
      return semanticError(
        domain,
        "project/storagePool",
        `development domain must use project ${DEVELOPMENT_PROJECT} and storagePool ${DEVELOPMENT_STORAGE_POOL}`,
      );
    }
    if (domain.storage !== "development-dir") {
      return semanticError(domain, "storage", "development domain must use development-dir storage");
    }
    if (domain.quota !== "unattested") {
      return semanticError(domain, "quota", "development domain quota is unattested");
    }
    if (domain.status === "configured" && domain.dockerDataBytes === undefined) {
      return semanticError(
        domain,
        "dockerDataBytes",
        "configured development domain must declare the default Docker data disk size",
      );
    }
  }
  for (const [index, image] of domain.trustedImages.entries()) {
    try {
      parseIncusImageLocator(image, `trustedImages[${index}]`);
    } catch (cause) {
      if (cause instanceof Error && "code" in cause) return cause as IncusProviderError;
      return semanticError(domain, `trustedImages[${index}]`, "must be name@sha256:<64 lowercase hex>");
    }
  }
  return undefined;
}

function decodeDescriptor(value: unknown, path: string): IncusProviderDescriptor {
  const decoded = Schema.decodeUnknownEither(DescriptorSchema, ParseOptions)(value);
  if (Either.isLeft(decoded)) {
    throw incusError(
      "incus-descriptor-invalid",
      `Incus descriptor ${JSON.stringify(path)} is not niceeval.incus-provider/v1.`,
      ["Fix the descriptor schemaVersion, domains array, and required domain fields."],
      decoded.left,
    );
  }
  const names = new Set<string>();
  const domains: IncusDomainDescriptor[] = [];
  for (const domain of decoded.right.domains) {
    if (names.has(domain.name)) {
      throw incusError(
        "incus-descriptor-invalid",
        `Incus descriptor ${JSON.stringify(path)} declares domain ${JSON.stringify(domain.name)} more than once.`,
        ["Keep a single reference domain and a single development domain."],
      );
    }
    names.add(domain.name);
    const frozen = freezeDomain(domain);
    const invalid = validateDomain(frozen);
    if (invalid !== undefined) throw invalid;
    domains.push(frozen);
  }
  if (domains.length === 0) {
    throw incusError(
      "incus-descriptor-invalid",
      `Incus descriptor ${JSON.stringify(path)} has no domains.`,
      ["Declare a reference domain and optionally a development domain."],
    );
  }
  return Object.freeze({
    schemaVersion: INCUS_DESCRIPTOR_SCHEMA_VERSION,
    domains: Object.freeze(domains),
    path,
  });
}

export function incusDescriptorPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[NICEEVAL_INCUS_DESCRIPTOR];
  return override !== undefined && override.trim() !== "" ? override : DEFAULT_INCUS_DESCRIPTOR_PATH;
}

export async function loadIncusDescriptor(env: NodeJS.ProcessEnv = process.env): Promise<IncusProviderDescriptor> {
  const path = incusDescriptorPath(env);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    const code = cause !== null && typeof cause === "object" && "code" in cause
      ? String((cause as { readonly code?: unknown }).code)
      : "";
    if (code === "ENOENT") {
      throw incusError(
        "incus-undeployed",
        `Incus provider descriptor ${JSON.stringify(path)} is not deployed.`,
        [
          "Install the Incus provider descriptor at /etc/niceeval/incus-provider.json.",
          "For isolated dogfood, set NICEEVAL_INCUS_DESCRIPTOR to that descriptor path.",
        ],
        cause,
      );
    }
    throw incusError(
      "incus-descriptor-invalid",
      `Failed to read Incus provider descriptor ${JSON.stringify(path)}.`,
      ["Ensure the descriptor is readable without sudo and is valid JSON."],
      cause,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw incusError(
      "incus-descriptor-invalid",
      `Incus provider descriptor ${JSON.stringify(path)} is not valid JSON.`,
      ["Replace the descriptor with a JSON object of schemaVersion niceeval.incus-provider/v1."],
      cause,
    );
  }
  return decodeDescriptor(parsed, path);
}

export function domainByName(
  descriptor: IncusProviderDescriptor,
  name: IncusDomainName,
): IncusDomainDescriptor | undefined {
  return descriptor.domains.find((domain) => domain.name === name);
}

export function matchDomain(
  descriptor: IncusProviderDescriptor,
  project: string,
  storagePool: string,
): IncusDomainDescriptor | undefined {
  return descriptor.domains.find((domain) => domain.project === project && domain.storagePool === storagePool);
}
