import { Either, ParseResult, Schema } from "effect";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { digestOf } from "../identity.ts";
import type { JsonValue } from "../../shared/types.ts";
import { dockerProfileError, type DockerProfileError } from "./errors.ts";

export const DOCKER_EXECUTION_PROFILE_SCHEMA_VERSION: 1 = 1;
export const DOCKER_PROFILE_SCHEMA_VERSION = DOCKER_EXECUTION_PROFILE_SCHEMA_VERSION;
export const DOCKER_PROFILE_NETWORK_POLICY_VERSION: 1 = 1;
export const DOCKER_PROFILE_NETWORK_DENY_CIDRS: readonly [string, ...string[]] = Object.freeze([
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
  "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16",
  "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4",
  "240.0.0.0/4", "::/0",
]);
const NETWORK_ALLOWED_PROTOCOLS: readonly ["dns", "https"] = Object.freeze(["dns", "https"]);
const PROFILE_CONTROLLERS: readonly ["cpu", "memory", "pids"] = Object.freeze([
  "cpu", "memory", "pids",
]);

export type DockerExecutionProfileSecurityLevel =
  | "managed-rootless/v1"
  | "managed-vm-rootless/v1";

export interface DockerProfileUnixEndpoint {
  readonly path: string;
  readonly peerUid: number;
}

/** Callback-free descriptor data that crosses the host deployment trust boundary. */
export interface DockerProfileNetworkPolicy {
  readonly version: 1;
  readonly dns: {
    readonly mode: "explicit";
    readonly servers: readonly [string, ...string[]];
  };
  readonly egress: {
    readonly mode: "rootless-nat";
    readonly allowedProtocols: readonly ["dns", "https"];
    readonly denyPrivateNetworks: true;
    readonly denySiblingSyntheticEndpoints: true;
    readonly denyCidrs: readonly [string, ...string[]];
    readonly ipv6: "disabled";
    readonly disableHostLoopback: true;
    readonly portDriver: "none";
    readonly daemonBridge: "none";
    readonly exclusiveNetwork: true;
    readonly icc: false;
  };
}

export interface DockerExecutionProfileV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly securityLevel: DockerExecutionProfileSecurityLevel;
  readonly semanticPolicyRevision: string;
  readonly transport: {
    readonly kind: "unix";
    readonly hostMachineIdentity: string;
    readonly dockerSocket: DockerProfileUnixEndpoint;
    readonly controlSocket: DockerProfileUnixEndpoint & {
      readonly protocol: "niceeval-docker-profile-control/v1";
    };
  };
  readonly backend: {
    readonly kind: "local-systemd" | "dedicated-linux-vm";
    readonly machineIdentity: string;
    readonly owner: { readonly uid: number; readonly gid: number };
    readonly filesystem: {
      readonly identity: string;
      readonly mountPath: string;
      readonly dockerRootDir: string;
      readonly limitBytes: number;
    };
    readonly cgroup: {
      readonly aggregatePath: string;
      readonly policyRevision: string;
      readonly controllers: readonly ["cpu", "memory", "pids"];
    };
  };
  readonly capacity: {
    readonly cpus: number;
    readonly memoryBytes: number;
    readonly memorySwapBytes: 0;
    readonly pids: number;
    readonly maxContainers: number;
    readonly maxBuilds: number;
    readonly aggregate: {
      readonly cpus: number;
      readonly memoryBytes: number;
      readonly memorySwapBytes: 0;
      readonly pids: number;
    };
  };
  readonly policy: {
    readonly hostLoopback: false;
    readonly tcpDockerEndpoint: false;
    readonly outerSocketInjection: false;
    readonly privilegedTranslation: "rootless-userns";
    readonly writableRoot: "declared-tmpfs-only";
    readonly network: DockerProfileNetworkPolicy;
  };
}

export type DockerExecutionProfileV1Draft =
  Omit<DockerExecutionProfileV1, "semanticPolicyRevision">;

/** A deliberately narrow view: never exposes host endpoints, paths, owners, or policy. */
export interface DockerProfilePublicSummary {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly securityLevel: DockerExecutionProfileSecurityLevel;
  readonly semanticPolicyRevision: string;
  readonly capacity: DockerExecutionProfileV1["capacity"];
}

type DockerExecutionProfileSemanticInput = Pick<
  DockerExecutionProfileV1,
  "securityLevel" | "backend" | "policy"
>;

const ParseOptions = Object.freeze({
  errors: "all" as const,
  exact: true,
  onExcessProperty: "error" as const,
});

type PlainObject = Readonly<Record<PropertyKey, unknown>>;

const PlainObjectSchema = Schema.declare<PlainObject>(
  (value): value is PlainObject => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  },
  {
    identifier: "DockerProfilePlainObject",
    description: "a plain object or null-prototype record",
  },
);

const plainStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.compose(Schema.Struct(fields), { strict: false })(PlainObjectSchema);

const nonEmptyString = (identifier: string) =>
  Schema.String.pipe(Schema.filter(
    (value) => value.trim() !== "" && !value.includes("\0"),
    { identifier, description: "a non-empty string without NUL" },
  ));

const absolutePath = (identifier: string) =>
  nonEmptyString(identifier).pipe(Schema.filter(
    isAbsolute,
    { identifier, description: "an absolute path" },
  ));

const nonNegativeSafeInteger = (identifier: string) =>
  Schema.JsonNumber.pipe(Schema.filter(
    (value) => Number.isSafeInteger(value) && value >= 0,
    { identifier, description: "a non-negative safe integer" },
  ));

const positiveSafeInteger = (identifier: string) =>
  Schema.JsonNumber.pipe(Schema.filter(
    (value) => Number.isSafeInteger(value) && value > 0,
    { identifier, description: "a positive safe integer" },
  ));

const positiveFinite = (identifier: string) =>
  Schema.JsonNumber.pipe(Schema.filter(
    (value) => Number.isFinite(value) && value > 0,
    { identifier, description: "a positive finite number" },
  ));

function isPublicDnsServer(value: string): boolean {
  const kind = isIP(value);
  if (kind === 4) {
    const [first, second, third] = value.split(".").map(Number);
    if (first === undefined || second === undefined || third === undefined) return false;
    if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
    if (first === 100 && second >= 64 && second <= 127) return false;
    if (first === 169 && second === 254) return false;
    if (first === 172 && second >= 16 && second <= 31) return false;
    if (first === 192 && second === 168) return false;
    if (first === 192 && second === 0 && (third === 0 || third === 2)) return false;
    if (first === 198 && (second === 18 || second === 19)) return false;
    if (first === 198 && second === 51 && third === 100) return false;
    return !(first === 203 && second === 0 && third === 113);
  }
  if (kind !== 6) return false;
  const normalized = value.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPublicDnsServer(normalized.slice("::ffff:".length));
  }
  return normalized !== "::" && normalized !== "::1" &&
    !normalized.startsWith("fc") && !normalized.startsWith("fd") &&
    !normalized.startsWith("fe8") && !normalized.startsWith("fe9") &&
    !normalized.startsWith("fea") && !normalized.startsWith("feb") &&
    !normalized.startsWith("ff") && !normalized.startsWith("2001:db8:");
}

const DnsServerSchema = nonEmptyString("DockerProfilePublicDnsServer").pipe(Schema.filter(
  isPublicDnsServer,
  {
    identifier: "DockerProfilePublicDnsServer",
    description: "a public IP address, not a private or synthetic endpoint",
  },
));

const CidrsSchema = Schema.NonEmptyArray(Schema.String).pipe(Schema.filter(
  (value) => value.length === DOCKER_PROFILE_NETWORK_DENY_CIDRS.length &&
    value.every((cidr, index) => cidr === DOCKER_PROFILE_NETWORK_DENY_CIDRS[index]),
  { identifier: "DockerProfileDenyCidrs", description: "the v1 fail-closed CIDR set" },
));

const EndpointSchema = plainStruct({
  path: absolutePath("DockerProfileSocketPath"),
  peerUid: nonNegativeSafeInteger("DockerProfilePeerUid"),
});

const NetworkSchema = plainStruct({
  version: Schema.Literal(1),
  dns: plainStruct({
    mode: Schema.Literal("explicit"),
    servers: Schema.NonEmptyArray(DnsServerSchema),
  }),
  egress: plainStruct({
    mode: Schema.Literal("rootless-nat"),
    allowedProtocols: Schema.Tuple(Schema.Literal("dns"), Schema.Literal("https")),
    denyPrivateNetworks: Schema.Literal(true),
    denySiblingSyntheticEndpoints: Schema.Literal(true),
    denyCidrs: CidrsSchema,
    ipv6: Schema.Literal("disabled"),
    disableHostLoopback: Schema.Literal(true),
    portDriver: Schema.Literal("none"),
    daemonBridge: Schema.Literal("none"),
    exclusiveNetwork: Schema.Literal(true),
    icc: Schema.Literal(false),
  }),
});

const CapacitySchema = plainStruct({
  cpus: positiveFinite("DockerProfileCapacityCpus"),
  memoryBytes: positiveSafeInteger("DockerProfileCapacityMemoryBytes"),
  memorySwapBytes: Schema.Literal(0),
  pids: positiveSafeInteger("DockerProfileCapacityPids"),
  maxContainers: positiveSafeInteger("DockerProfileCapacityMaxContainers"),
  maxBuilds: positiveSafeInteger("DockerProfileCapacityMaxBuilds"),
  aggregate: plainStruct({
    cpus: positiveFinite("DockerProfileAggregateCpus"),
    memoryBytes: positiveSafeInteger("DockerProfileAggregateMemoryBytes"),
    memorySwapBytes: Schema.Literal(0),
    pids: positiveSafeInteger("DockerProfileAggregatePids"),
  }),
}).pipe(Schema.filter(
  (value) => value.aggregate.cpus >= value.cpus &&
    value.aggregate.memoryBytes >= value.memoryBytes &&
    value.aggregate.pids >= value.pids,
  {
    identifier: "DockerProfileCapacity",
    description: "aggregate capacity at least as large as allocatable CPU, memory and PID capacity",
  },
));

/** Wire structure only; semantic revision and frozen canonical values are checked after decode. */
export const DockerExecutionProfileV1Schema: Schema.Schema<
  DockerExecutionProfileV1,
  PlainObject
> = plainStruct({
  schemaVersion: Schema.Literal(1),
  profileId: nonEmptyString("DockerProfileId"),
  securityLevel: Schema.Literal("managed-rootless/v1", "managed-vm-rootless/v1"),
  semanticPolicyRevision: nonEmptyString("DockerProfileSemanticPolicyRevision"),
  transport: plainStruct({
    kind: Schema.Literal("unix"),
    hostMachineIdentity: nonEmptyString("DockerProfileHostMachineIdentity"),
    dockerSocket: EndpointSchema,
    controlSocket: plainStruct({
      path: absolutePath("DockerProfileControlSocketPath"),
      peerUid: nonNegativeSafeInteger("DockerProfileControlPeerUid"),
      protocol: Schema.Literal("niceeval-docker-profile-control/v1"),
    }),
  }),
  backend: plainStruct({
    kind: Schema.Literal("local-systemd", "dedicated-linux-vm"),
    machineIdentity: nonEmptyString("DockerProfileBackendMachineIdentity"),
    owner: plainStruct({
      uid: nonNegativeSafeInteger("DockerProfileOwnerUid"),
      gid: nonNegativeSafeInteger("DockerProfileOwnerGid"),
    }),
    filesystem: plainStruct({
      identity: nonEmptyString("DockerProfileFilesystemIdentity"),
      mountPath: absolutePath("DockerProfileMountPath"),
      dockerRootDir: absolutePath("DockerProfileDockerRootDir"),
      limitBytes: positiveSafeInteger("DockerProfileFilesystemLimitBytes"),
    }),
    cgroup: plainStruct({
      aggregatePath: absolutePath("DockerProfileAggregatePath"),
      policyRevision: nonEmptyString("DockerProfileCgroupPolicyRevision"),
      controllers: Schema.Tuple(
        Schema.Literal("cpu"),
        Schema.Literal("memory"),
        Schema.Literal("pids"),
      ),
    }),
  }),
  capacity: CapacitySchema,
  policy: plainStruct({
    hostLoopback: Schema.Literal(false),
    tcpDockerEndpoint: Schema.Literal(false),
    outerSocketInjection: Schema.Literal(false),
    privilegedTranslation: Schema.Literal("rootless-userns"),
    writableRoot: Schema.Literal("declared-tmpfs-only"),
    network: NetworkSchema,
  }),
});

export const DockerExecutionProfileSchema = DockerExecutionProfileV1Schema;

function frozenNonEmptyStrings(values: readonly string[]): readonly [string, ...string[]] {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error("expected a non-empty string tuple");
  return Object.freeze([first, ...rest]);
}

/** Canonicalize only after structural decoding; nested containers are immutable to callers. */
function freezeProfile(profile: DockerExecutionProfileV1): DockerExecutionProfileV1 {
  return Object.freeze({
    ...profile,
    transport: Object.freeze({
      ...profile.transport,
      dockerSocket: Object.freeze({ ...profile.transport.dockerSocket }),
      controlSocket: Object.freeze({ ...profile.transport.controlSocket }),
    }),
    backend: Object.freeze({
      ...profile.backend,
      owner: Object.freeze({ ...profile.backend.owner }),
      filesystem: Object.freeze({ ...profile.backend.filesystem }),
      cgroup: Object.freeze({ ...profile.backend.cgroup, controllers: PROFILE_CONTROLLERS }),
    }),
    capacity: Object.freeze({
      ...profile.capacity,
      memorySwapBytes: 0,
      aggregate: Object.freeze({ ...profile.capacity.aggregate, memorySwapBytes: 0 }),
    }),
    policy: Object.freeze({
      ...profile.policy,
      network: Object.freeze({
        ...profile.policy.network,
        dns: Object.freeze({
          ...profile.policy.network.dns,
          servers: frozenNonEmptyStrings(profile.policy.network.dns.servers),
        }),
        egress: Object.freeze({
          ...profile.policy.network.egress,
          allowedProtocols: NETWORK_ALLOWED_PROTOCOLS,
          denyCidrs: DOCKER_PROFILE_NETWORK_DENY_CIDRS,
        }),
      }),
    }),
  });
}

function semanticPolicyJson(input: DockerExecutionProfileSemanticInput): JsonValue {
  return {
    schemaVersion: DOCKER_EXECUTION_PROFILE_SCHEMA_VERSION,
    securityLevel: input.securityLevel,
    backend: {
      kind: input.backend.kind,
      cgroup: {
        policyRevision: input.backend.cgroup.policyRevision,
        controllers: [...input.backend.cgroup.controllers],
      },
    },
    policy: {
      hostLoopback: input.policy.hostLoopback,
      tcpDockerEndpoint: input.policy.tcpDockerEndpoint,
      outerSocketInjection: input.policy.outerSocketInjection,
      privilegedTranslation: input.policy.privilegedTranslation,
      writableRoot: input.policy.writableRoot,
      network: {
        version: input.policy.network.version,
        dns: { mode: input.policy.network.dns.mode, servers: [...input.policy.network.dns.servers] },
        egress: {
          mode: input.policy.network.egress.mode,
          allowedProtocols: [...input.policy.network.egress.allowedProtocols],
          denyPrivateNetworks: input.policy.network.egress.denyPrivateNetworks,
          denySiblingSyntheticEndpoints: input.policy.network.egress.denySiblingSyntheticEndpoints,
          denyCidrs: [...input.policy.network.egress.denyCidrs],
          ipv6: input.policy.network.egress.ipv6,
          disableHostLoopback: input.policy.network.egress.disableHostLoopback,
          portDriver: input.policy.network.egress.portDriver,
          daemonBridge: input.policy.network.egress.daemonBridge,
          exclusiveNetwork: input.policy.network.egress.exclusiveNetwork,
          icc: input.policy.network.egress.icc,
        },
      },
    },
  };
}

export function dockerExecutionProfileSemanticPolicyRevisionOf(
  input: DockerExecutionProfileSemanticInput,
): string {
  return digestOf(semanticPolicyJson(input)).slice(0, 8);
}

export const dockerProfileSemanticPolicyRevisionOf =
  dockerExecutionProfileSemanticPolicyRevisionOf;

function formatSchemaPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (result, segment) =>
      typeof segment === "number" ||
        (typeof segment === "string" && /^\\d+$/.test(segment))
        ? `${result}[${String(segment)}]`
        : `${result}.${String(segment)}`,
    "profile",
  );
}

function schemaError(value: unknown, error: ParseResult.ParseError): DockerProfileError {
  const issue = ParseResult.ArrayFormatter.formatErrorSync(error)[0];
  const path = issue === undefined ? "profile" : formatSchemaPath(issue.path);
  const root = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  if (path === "profile.schemaVersion") {
    if (root?.schemaVersion === undefined) {
      return dockerProfileError({
        code: "sandbox.docker-profile-schema-invalid",
        path,
        message: "profile.schemaVersion is required",
      });
    }
    return dockerProfileError({
      code: "sandbox.docker-profile-unknown-version",
      path,
      message: `Unsupported Docker execution profile schema version ${JSON.stringify(root.schemaVersion)}; expected 1`,
    });
  }
  if (path === "profile.securityLevel") {
    return dockerProfileError({
      code: "sandbox.docker-profile-security-level-unsupported",
      path,
      message: `Unsupported Docker execution profile security level ${JSON.stringify(root?.securityLevel)}`,
    });
  }
  return dockerProfileError({
    code: path === "profile.capacity"
      ? "sandbox.docker-profile-capacity-invalid"
      : "sandbox.docker-profile-schema-invalid",
    path,
    message: issue === undefined
      ? "profile is not a valid Docker execution profile v1"
      : `${path} ${issue.message}`,
  });
}

export function parseDockerExecutionProfileV1(value: unknown): DockerExecutionProfileV1 {
  const decoded = Schema.decodeUnknownEither(DockerExecutionProfileV1Schema, ParseOptions)(value);
  if (Either.isLeft(decoded)) throw schemaError(value, decoded.left);
  const profile = freezeProfile(decoded.right);
  const expected = dockerExecutionProfileSemanticPolicyRevisionOf(profile);
  if (profile.semanticPolicyRevision !== expected) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-semantic-policy-mismatch",
      path: "profile.semanticPolicyRevision",
      message: `profile.semanticPolicyRevision does not match the canonical semantic policy revision ${expected}`,
      details: { expected, actual: profile.semanticPolicyRevision },
    });
  }
  return profile;
}

export const parseDockerExecutionProfile = parseDockerExecutionProfileV1;
export const decodeDockerExecutionProfileV1 = parseDockerExecutionProfileV1;

export function makeDockerExecutionProfileV1(
  input: DockerExecutionProfileV1Draft,
): DockerExecutionProfileV1 {
  return parseDockerExecutionProfileV1({
    ...input,
    semanticPolicyRevision: dockerExecutionProfileSemanticPolicyRevisionOf(input),
  });
}

export const createDockerExecutionProfileV1 = makeDockerExecutionProfileV1;

export function isDockerExecutionProfileV1(value: unknown): value is DockerExecutionProfileV1 {
  try {
    parseDockerExecutionProfileV1(value);
    return true;
  } catch {
    return false;
  }
}

/** Digest the fixed v1 wire shape, not incidental object insertion order. */
function canonicalJson(profile: DockerExecutionProfileV1): JsonValue {
  return {
    schemaVersion: profile.schemaVersion,
    profileId: profile.profileId,
    securityLevel: profile.securityLevel,
    semanticPolicyRevision: profile.semanticPolicyRevision,
    transport: {
      kind: profile.transport.kind,
      hostMachineIdentity: profile.transport.hostMachineIdentity,
      dockerSocket: { ...profile.transport.dockerSocket },
      controlSocket: { ...profile.transport.controlSocket },
    },
    backend: {
      kind: profile.backend.kind,
      machineIdentity: profile.backend.machineIdentity,
      owner: { ...profile.backend.owner },
      filesystem: { ...profile.backend.filesystem },
      cgroup: { ...profile.backend.cgroup, controllers: [...profile.backend.cgroup.controllers] },
    },
    capacity: {
      ...profile.capacity,
      aggregate: { ...profile.capacity.aggregate },
    },
    policy: {
      hostLoopback: profile.policy.hostLoopback,
      tcpDockerEndpoint: profile.policy.tcpDockerEndpoint,
      outerSocketInjection: profile.policy.outerSocketInjection,
      privilegedTranslation: profile.policy.privilegedTranslation,
      writableRoot: profile.policy.writableRoot,
      network: {
        version: profile.policy.network.version,
        dns: { mode: profile.policy.network.dns.mode, servers: [...profile.policy.network.dns.servers] },
        egress: {
          ...profile.policy.network.egress,
          allowedProtocols: [...profile.policy.network.egress.allowedProtocols],
          denyCidrs: [...profile.policy.network.egress.denyCidrs],
        },
      },
    },
  };
}

export function dockerExecutionProfileV1Digest(profile: DockerExecutionProfileV1): string {
  return `sha256:${digestOf(canonicalJson(parseDockerExecutionProfileV1(profile)))}`;
}

export const dockerProfileDigestOf = dockerExecutionProfileV1Digest;

export function dockerProfilePublicSummaryOf(
  profile: DockerExecutionProfileV1,
): DockerProfilePublicSummary {
  const normalized = parseDockerExecutionProfileV1(profile);
  return Object.freeze({
    schemaVersion: 1,
    profileId: normalized.profileId,
    securityLevel: normalized.securityLevel,
    semanticPolicyRevision: normalized.semanticPolicyRevision,
    capacity: Object.freeze({
      ...normalized.capacity,
      aggregate: Object.freeze({ ...normalized.capacity.aggregate }),
    }),
  });
}
