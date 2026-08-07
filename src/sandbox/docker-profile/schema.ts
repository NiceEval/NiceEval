import { Schema } from "effect";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { digestOf } from "../identity.ts";
import type { JsonValue } from "../../shared/types.ts";
import {
  dockerProfileError,
  type DockerProfileError,
} from "./errors.ts";

export const DOCKER_EXECUTION_PROFILE_SCHEMA_VERSION: 1 = 1;
export const DOCKER_PROFILE_SCHEMA_VERSION = DOCKER_EXECUTION_PROFILE_SCHEMA_VERSION;
export const DOCKER_PROFILE_NETWORK_POLICY_VERSION: 1 = 1;
export const DOCKER_PROFILE_NETWORK_DENY_CIDRS: readonly [string, ...string[]] = Object.freeze([
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "::/0",
]);
const NETWORK_ALLOWED_PROTOCOLS: readonly ["dns", "https"] = Object.freeze(["dns", "https"]);
const PROFILE_CONTROLLERS: readonly ["cpu", "memory", "pids"] = Object.freeze(["cpu", "memory", "pids"]);
const ZERO_SWAP: 0 = 0;

function frozenNonEmptyStrings(values: readonly string[]): readonly [string, ...string[]] {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error("expected a non-empty string tuple");
  return Object.freeze([first, ...rest]);
}

export type DockerExecutionProfileSecurityLevel =
  | "managed-rootless/v1"
  | "managed-vm-rootless/v1";

export interface DockerProfileUnixEndpoint {
  readonly path: string;
  readonly peerUid: number;
}

/** 可由 descriptor 直接声明、并由宿主 attestation 重新核对的 outer 网络策略。 */
export interface DockerProfileNetworkPolicy {
  readonly version: typeof DOCKER_PROFILE_NETWORK_POLICY_VERSION;
  readonly dns: {
    readonly mode: "explicit";
    readonly servers: readonly [string, ...string[]];
  };
  readonly egress: {
    readonly mode: "rootless-nat";
    readonly allowedProtocols: readonly ["dns", "https"];
    readonly denyPrivateNetworks: true;
    readonly denySiblingSyntheticEndpoints: true;
    /** rootlesskit/slirp4netns 与宿主私网/loopback 的 fail-closed deny 集合。 */
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
  /** 已扣除宿主 daemon/build/watchdog/recovery headroom，可授予 Attempt 的容量。 */
  readonly capacity: {
    readonly cpus: number;
    readonly memoryBytes: number;
    readonly memorySwapBytes: 0;
    readonly pids: number;
    readonly maxContainers: number;
    readonly maxBuilds: number;
    /** aggregate cgroup 硬上限，不是可授予 Attempt 的容量。 */
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

export type DockerExecutionProfileV1Draft = Omit<DockerExecutionProfileV1, "semanticPolicyRevision">;

export interface DockerProfilePublicSummary {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly securityLevel: DockerExecutionProfileSecurityLevel;
  readonly semanticPolicyRevision: string;
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
}

type DockerExecutionProfileSemanticInput = Pick<
  DockerExecutionProfileV1,
  "securityLevel" | "backend" | "policy"
>;

function isRecord(value: unknown): value is globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(
  code: Parameters<typeof dockerProfileError>[0]["code"],
  message: string,
  path?: string,
): never {
  throw dockerProfileError({ code, message, ...(path === undefined ? {} : { path }) });
}

function objectAt(value: unknown, path: string): globalThis.Record<string, unknown> {
  if (!isRecord(value)) fail("sandbox.docker-profile-schema-invalid", `${path} must be a plain object`, path);
  return value;
}

function onlyKeys(value: globalThis.Record<string, unknown>, allowed: readonly string[], path: string): void {
  const known = new Set(allowed);
  const unsupported = Object.keys(value).find((key) => !known.has(key));
  if (unsupported !== undefined) {
    fail(
      "sandbox.docker-profile-schema-invalid",
      `${path}.${unsupported} is not supported by Docker execution profile v1`,
      `${path}.${unsupported}`,
    );
  }
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail("sandbox.docker-profile-schema-invalid", `${path} must be a non-empty string`, path);
  }
  if (value.includes("\u0000")) {
    fail("sandbox.docker-profile-schema-invalid", `${path} must not contain NUL`, path);
  }
  return value;
}

function absolutePath(value: unknown, path: string): string {
  const result = requiredString(value, path);
  if (!isAbsolute(result)) {
    fail("sandbox.docker-profile-schema-invalid", `${path} must be an absolute path`, path);
  }
  return result;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("sandbox.docker-profile-schema-invalid", `${path} must be a non-negative safe integer`, path);
  }
  return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail("sandbox.docker-profile-schema-invalid", `${path} must be a positive safe integer`, path);
  }
  return value;
}

function positiveFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail("sandbox.docker-profile-schema-invalid", `${path} must be a positive finite number`, path);
  }
  return value;
}

function endpoint(value: unknown, path: string): DockerProfileUnixEndpoint {
  const record = objectAt(value, path);
  onlyKeys(record, ["path", "peerUid"], path);
  return Object.freeze({
    path: absolutePath(record.path, `${path}.path`),
    peerUid: nonNegativeSafeInteger(record.peerUid, `${path}.peerUid`),
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
        dns: {
          mode: input.policy.network.dns.mode,
          servers: [...input.policy.network.dns.servers],
        },
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

/** 从受信 schema 字段重新计算语义 policy revision；profileId、alias、socket 与容量不参与。 */
export function dockerExecutionProfileSemanticPolicyRevisionOf(
  input: DockerExecutionProfileSemanticInput,
): string {
  return digestOf(semanticPolicyJson(input)).slice(0, 8);
}

export const dockerProfileSemanticPolicyRevisionOf = dockerExecutionProfileSemanticPolicyRevisionOf;

function canonicalJson(profile: DockerExecutionProfileV1): JsonValue {
  return {
    schemaVersion: profile.schemaVersion,
    profileId: profile.profileId,
    securityLevel: profile.securityLevel,
    semanticPolicyRevision: profile.semanticPolicyRevision,
    transport: {
      kind: profile.transport.kind,
      hostMachineIdentity: profile.transport.hostMachineIdentity,
      dockerSocket: {
        path: profile.transport.dockerSocket.path,
        peerUid: profile.transport.dockerSocket.peerUid,
      },
      controlSocket: {
        path: profile.transport.controlSocket.path,
        peerUid: profile.transport.controlSocket.peerUid,
        protocol: profile.transport.controlSocket.protocol,
      },
    },
    backend: {
      kind: profile.backend.kind,
      machineIdentity: profile.backend.machineIdentity,
      owner: { uid: profile.backend.owner.uid, gid: profile.backend.owner.gid },
      filesystem: {
        identity: profile.backend.filesystem.identity,
        mountPath: profile.backend.filesystem.mountPath,
        dockerRootDir: profile.backend.filesystem.dockerRootDir,
        limitBytes: profile.backend.filesystem.limitBytes,
      },
      cgroup: {
        aggregatePath: profile.backend.cgroup.aggregatePath,
        policyRevision: profile.backend.cgroup.policyRevision,
        controllers: [...profile.backend.cgroup.controllers],
      },
    },
    capacity: {
      cpus: profile.capacity.cpus,
      memoryBytes: profile.capacity.memoryBytes,
      memorySwapBytes: profile.capacity.memorySwapBytes,
      pids: profile.capacity.pids,
      maxContainers: profile.capacity.maxContainers,
      maxBuilds: profile.capacity.maxBuilds,
      aggregate: {
        cpus: profile.capacity.aggregate.cpus,
        memoryBytes: profile.capacity.aggregate.memoryBytes,
        memorySwapBytes: profile.capacity.aggregate.memorySwapBytes,
        pids: profile.capacity.aggregate.pids,
      },
    },
    policy: {
      hostLoopback: profile.policy.hostLoopback,
      tcpDockerEndpoint: profile.policy.tcpDockerEndpoint,
      outerSocketInjection: profile.policy.outerSocketInjection,
      privilegedTranslation: profile.policy.privilegedTranslation,
      writableRoot: profile.policy.writableRoot,
      network: {
        version: profile.policy.network.version,
        dns: {
          mode: profile.policy.network.dns.mode,
          servers: [...profile.policy.network.dns.servers],
        },
        egress: {
          mode: profile.policy.network.egress.mode,
          allowedProtocols: [...profile.policy.network.egress.allowedProtocols],
          denyPrivateNetworks: profile.policy.network.egress.denyPrivateNetworks,
          denySiblingSyntheticEndpoints: profile.policy.network.egress.denySiblingSyntheticEndpoints,
          denyCidrs: [...profile.policy.network.egress.denyCidrs],
          ipv6: profile.policy.network.egress.ipv6,
          disableHostLoopback: profile.policy.network.egress.disableHostLoopback,
          portDriver: profile.policy.network.egress.portDriver,
          daemonBridge: profile.policy.network.egress.daemonBridge,
          exclusiveNetwork: profile.policy.network.egress.exclusiveNetwork,
          icc: profile.policy.network.egress.icc,
        },
      },
    },
  };
}

/** 对规范化 descriptor 求稳定 canonical digest；返回值可直接作为 descriptor digest。 */
export function dockerExecutionProfileV1Digest(profile: DockerExecutionProfileV1): string {
  return `sha256:${digestOf(canonicalJson(parseDockerExecutionProfileV1(profile)))}`;
}

export const dockerProfileDigestOf = dockerExecutionProfileV1Digest;

function isPublicDnsServer(value: string): boolean {
  const kind = isIP(value);
  if (kind === 4) {
    const octets = value.split(".").map(Number);
    const first = octets[0];
    const second = octets[1];
    const third = octets[2];
    if (first === undefined || second === undefined || third === undefined) return false;
    if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
    if (first === 100 && second >= 64 && second <= 127) return false;
    if (first === 169 && second === 254) return false;
    if (first === 172 && second >= 16 && second <= 31) return false;
    if (first === 192 && second === 168) return false;
    if (first === 192 && second === 0 && third === 0) return false;
    if (first === 192 && second === 0 && third === 2) return false;
    if (first === 198 && (second === 18 || second === 19)) return false;
    if (first === 198 && second === 51 && third === 100) return false;
    if (first === 203 && second === 0 && third === 113) return false;
    return true;
  }
  if (kind === 6) {
    const normalized = value.toLowerCase();
    if (normalized.startsWith("::ffff:")) return isPublicDnsServer(normalized.slice("::ffff:".length));
    return normalized !== "::" && normalized !== "::1" &&
      !normalized.startsWith("fc") && !normalized.startsWith("fd") &&
      !normalized.startsWith("fe8") && !normalized.startsWith("fe9") &&
      !normalized.startsWith("fea") && !normalized.startsWith("feb") &&
      !normalized.startsWith("ff") &&
      !normalized.startsWith("2001:db8:");
  }
  return false;
}

function parseNetworkPolicy(value: unknown, path: string): DockerProfileNetworkPolicy {
  const record = objectAt(value, path);
  onlyKeys(record, ["version", "dns", "egress"], path);
  if (record.version !== DOCKER_PROFILE_NETWORK_POLICY_VERSION) {
    fail("sandbox.docker-profile-schema-invalid", `${path}.version must be 1`, `${path}.version`);
  }
  const dnsPath = `${path}.dns`;
  const dns = objectAt(record.dns, dnsPath);
  onlyKeys(dns, ["mode", "servers"], dnsPath);
  if (dns.mode !== "explicit") {
    fail("sandbox.docker-profile-schema-invalid", `${dnsPath}.mode must be "explicit"`, `${dnsPath}.mode`);
  }
  if (!Array.isArray(dns.servers) || dns.servers.length === 0) {
    fail("sandbox.docker-profile-schema-invalid", `${dnsPath}.servers must be a non-empty array`, `${dnsPath}.servers`);
  }
  const servers = dns.servers.map((server, index) => {
    const parsed = requiredString(server, `${dnsPath}.servers[${index}]`);
    if (!isPublicDnsServer(parsed)) {
      fail(
        "sandbox.docker-profile-schema-invalid",
        `${dnsPath}.servers[${index}] must be a public IP address, not a private or synthetic endpoint`,
        `${dnsPath}.servers[${index}]`,
      );
    }
    return parsed;
  });
  const egressPath = `${path}.egress`;
  const egress = objectAt(record.egress, egressPath);
  onlyKeys(egress, [
    "mode",
    "allowedProtocols",
    "denyPrivateNetworks",
    "denySiblingSyntheticEndpoints",
    "denyCidrs",
    "ipv6",
    "disableHostLoopback",
    "portDriver",
    "daemonBridge",
    "exclusiveNetwork",
    "icc",
  ], egressPath);
  if (egress.mode !== "rootless-nat") {
    fail("sandbox.docker-profile-schema-invalid", `${egressPath}.mode must be "rootless-nat"`, `${egressPath}.mode`);
  }
  if (!Array.isArray(egress.allowedProtocols) || egress.allowedProtocols.length !== 2 ||
      egress.allowedProtocols[0] !== "dns" || egress.allowedProtocols[1] !== "https") {
    fail(
      "sandbox.docker-profile-schema-invalid",
      `${egressPath}.allowedProtocols must be ["dns", "https"]`,
      `${egressPath}.allowedProtocols`,
    );
  }
  if (egress.denyPrivateNetworks !== true) {
    fail("sandbox.docker-profile-schema-invalid", `${egressPath}.denyPrivateNetworks must be true`, `${egressPath}.denyPrivateNetworks`);
  }
  if (egress.denySiblingSyntheticEndpoints !== true) {
    fail(
      "sandbox.docker-profile-schema-invalid",
      `${egressPath}.denySiblingSyntheticEndpoints must be true`,
      `${egressPath}.denySiblingSyntheticEndpoints`,
    );
  }
  if (!Array.isArray(egress.denyCidrs) || egress.denyCidrs.length !== DOCKER_PROFILE_NETWORK_DENY_CIDRS.length ||
      egress.denyCidrs.some((cidr, index) => cidr !== DOCKER_PROFILE_NETWORK_DENY_CIDRS[index])) {
    fail(
      "sandbox.docker-profile-schema-invalid",
      `${egressPath}.denyCidrs must be the v1 fail-closed CIDR set`,
      `${egressPath}.denyCidrs`,
    );
  }
  if (egress.ipv6 !== "disabled") {
    fail("sandbox.docker-profile-schema-invalid", `${egressPath}.ipv6 must be "disabled"`, `${egressPath}.ipv6`);
  }
  if (egress.disableHostLoopback !== true) {
    fail("sandbox.docker-profile-schema-invalid", `${egressPath}.disableHostLoopback must be true`, `${egressPath}.disableHostLoopback`);
  }
  if (egress.portDriver !== "none") {
    fail("sandbox.docker-profile-schema-invalid", `${egressPath}.portDriver must be "none"`, `${egressPath}.portDriver`);
  }
  if (egress.daemonBridge !== "none") {
    fail("sandbox.docker-profile-schema-invalid", `${egressPath}.daemonBridge must be "none"`, `${egressPath}.daemonBridge`);
  }
  if (egress.exclusiveNetwork !== true) {
    fail("sandbox.docker-profile-schema-invalid", `${egressPath}.exclusiveNetwork must be true`, `${egressPath}.exclusiveNetwork`);
  }
  if (egress.icc !== false) {
    fail("sandbox.docker-profile-schema-invalid", `${egressPath}.icc must be false`, `${egressPath}.icc`);
  }
  return Object.freeze({
    version: DOCKER_PROFILE_NETWORK_POLICY_VERSION,
    dns: Object.freeze({ mode: "explicit", servers: frozenNonEmptyStrings(servers) }),
    egress: Object.freeze({
      mode: "rootless-nat",
      allowedProtocols: NETWORK_ALLOWED_PROTOCOLS,
      denyPrivateNetworks: true,
      denySiblingSyntheticEndpoints: true,
      denyCidrs: DOCKER_PROFILE_NETWORK_DENY_CIDRS,
      ipv6: "disabled",
      disableHostLoopback: true,
      portDriver: "none",
      daemonBridge: "none",
      exclusiveNetwork: true,
      icc: false,
    }),
  });
}

function parsePolicy(value: unknown, path: string): DockerExecutionProfileV1["policy"] {
  const record = objectAt(value, path);
  onlyKeys(record, [
    "hostLoopback",
    "tcpDockerEndpoint",
    "outerSocketInjection",
    "privilegedTranslation",
    "writableRoot",
    "network",
  ], path);
  if (record.hostLoopback !== false) fail("sandbox.docker-profile-schema-invalid", `${path}.hostLoopback must be false`, `${path}.hostLoopback`);
  if (record.tcpDockerEndpoint !== false) fail("sandbox.docker-profile-schema-invalid", `${path}.tcpDockerEndpoint must be false`, `${path}.tcpDockerEndpoint`);
  if (record.outerSocketInjection !== false) fail("sandbox.docker-profile-schema-invalid", `${path}.outerSocketInjection must be false`, `${path}.outerSocketInjection`);
  if (record.privilegedTranslation !== "rootless-userns") {
    fail("sandbox.docker-profile-schema-invalid", `${path}.privilegedTranslation must be "rootless-userns"`, `${path}.privilegedTranslation`);
  }
  if (record.writableRoot !== "declared-tmpfs-only") {
    fail("sandbox.docker-profile-schema-invalid", `${path}.writableRoot must be "declared-tmpfs-only"`, `${path}.writableRoot`);
  }
  return Object.freeze({
    hostLoopback: false,
    tcpDockerEndpoint: false,
    outerSocketInjection: false,
    privilegedTranslation: "rootless-userns",
    writableRoot: "declared-tmpfs-only",
    network: parseNetworkPolicy(record.network, `${path}.network`),
  });
}

function parseTransport(value: unknown): DockerExecutionProfileV1["transport"] {
  const path = "profile.transport";
  const record = objectAt(value, path);
  onlyKeys(record, ["kind", "hostMachineIdentity", "dockerSocket", "controlSocket"], path);
  if (record.kind !== "unix") fail("sandbox.docker-profile-schema-invalid", `${path}.kind must be "unix"`, `${path}.kind`);
  const controlPath = "profile.transport.controlSocket";
  const control = objectAt(record.controlSocket, controlPath);
  onlyKeys(control, ["path", "peerUid", "protocol"], controlPath);
  if (control.protocol !== "niceeval-docker-profile-control/v1") {
    fail("sandbox.docker-profile-schema-invalid", `${controlPath}.protocol is unsupported`, `${controlPath}.protocol`);
  }
  return Object.freeze({
    kind: "unix",
    hostMachineIdentity: requiredString(record.hostMachineIdentity, `${path}.hostMachineIdentity`),
    dockerSocket: endpoint(record.dockerSocket, "profile.transport.dockerSocket"),
    controlSocket: Object.freeze({
      path: absolutePath(control.path, `${controlPath}.path`),
      peerUid: nonNegativeSafeInteger(control.peerUid, `${controlPath}.peerUid`),
      protocol: "niceeval-docker-profile-control/v1",
    }),
  });
}

function parseBackend(value: unknown): DockerExecutionProfileV1["backend"] {
  const path = "profile.backend";
  const record = objectAt(value, path);
  onlyKeys(record, ["kind", "machineIdentity", "owner", "filesystem", "cgroup"], path);
  if (record.kind !== "local-systemd" && record.kind !== "dedicated-linux-vm") {
    fail("sandbox.docker-profile-schema-invalid", `${path}.kind is unsupported`, `${path}.kind`);
  }
  const ownerPath = `${path}.owner`;
  const owner = objectAt(record.owner, ownerPath);
  onlyKeys(owner, ["uid", "gid"], ownerPath);
  const filesystemPath = `${path}.filesystem`;
  const filesystem = objectAt(record.filesystem, filesystemPath);
  onlyKeys(filesystem, ["identity", "mountPath", "dockerRootDir", "limitBytes"], filesystemPath);
  const cgroupPath = `${path}.cgroup`;
  const cgroup = objectAt(record.cgroup, cgroupPath);
  onlyKeys(cgroup, ["aggregatePath", "policyRevision", "controllers"], cgroupPath);
  if (!Array.isArray(cgroup.controllers) || cgroup.controllers.length !== 3 ||
      cgroup.controllers[0] !== "cpu" || cgroup.controllers[1] !== "memory" || cgroup.controllers[2] !== "pids") {
    fail("sandbox.docker-profile-schema-invalid", `${cgroupPath}.controllers must be ["cpu", "memory", "pids"]`, `${cgroupPath}.controllers`);
  }
  return Object.freeze({
    kind: record.kind,
    machineIdentity: requiredString(record.machineIdentity, `${path}.machineIdentity`),
    owner: Object.freeze({
      uid: nonNegativeSafeInteger(owner.uid, `${ownerPath}.uid`),
      gid: nonNegativeSafeInteger(owner.gid, `${ownerPath}.gid`),
    }),
    filesystem: Object.freeze({
      identity: requiredString(filesystem.identity, `${filesystemPath}.identity`),
      mountPath: absolutePath(filesystem.mountPath, `${filesystemPath}.mountPath`),
      dockerRootDir: absolutePath(filesystem.dockerRootDir, `${filesystemPath}.dockerRootDir`),
      limitBytes: positiveSafeInteger(filesystem.limitBytes, `${filesystemPath}.limitBytes`),
    }),
    cgroup: Object.freeze({
      aggregatePath: absolutePath(cgroup.aggregatePath, `${cgroupPath}.aggregatePath`),
      policyRevision: requiredString(cgroup.policyRevision, `${cgroupPath}.policyRevision`),
      controllers: PROFILE_CONTROLLERS,
    }),
  });
}

function parseCapacity(value: unknown): DockerExecutionProfileV1["capacity"] {
  const path = "profile.capacity";
  const record = objectAt(value, path);
  onlyKeys(record, ["cpus", "memoryBytes", "memorySwapBytes", "pids", "maxContainers", "maxBuilds", "aggregate"], path);
  const aggregatePath = `${path}.aggregate`;
  const aggregate = objectAt(record.aggregate, aggregatePath);
  onlyKeys(aggregate, ["cpus", "memoryBytes", "memorySwapBytes", "pids"], aggregatePath);
  if (record.memorySwapBytes !== 0) fail("sandbox.docker-profile-schema-invalid", `${path}.memorySwapBytes must be 0`, `${path}.memorySwapBytes`);
  if (aggregate.memorySwapBytes !== 0) fail("sandbox.docker-profile-schema-invalid", `${aggregatePath}.memorySwapBytes must be 0`, `${aggregatePath}.memorySwapBytes`);
  const parsed = {
    cpus: positiveFinite(record.cpus, `${path}.cpus`),
    memoryBytes: positiveSafeInteger(record.memoryBytes, `${path}.memoryBytes`),
    memorySwapBytes: ZERO_SWAP,
    pids: positiveSafeInteger(record.pids, `${path}.pids`),
    maxContainers: positiveSafeInteger(record.maxContainers, `${path}.maxContainers`),
    maxBuilds: positiveSafeInteger(record.maxBuilds, `${path}.maxBuilds`),
    aggregate: {
      cpus: positiveFinite(aggregate.cpus, `${aggregatePath}.cpus`),
      memoryBytes: positiveSafeInteger(aggregate.memoryBytes, `${aggregatePath}.memoryBytes`),
      memorySwapBytes: ZERO_SWAP,
      pids: positiveSafeInteger(aggregate.pids, `${aggregatePath}.pids`),
    },
  };
  if (parsed.aggregate.cpus < parsed.cpus || parsed.aggregate.memoryBytes < parsed.memoryBytes || parsed.aggregate.pids < parsed.pids) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-capacity-invalid",
      path,
      message: "profile.capacity.aggregate must be at least as large as allocatable CPU, memory and PID capacity",
    });
  }
  return Object.freeze({
    cpus: parsed.cpus,
    memoryBytes: parsed.memoryBytes,
    memorySwapBytes: parsed.memorySwapBytes,
    pids: parsed.pids,
    maxContainers: parsed.maxContainers,
    maxBuilds: parsed.maxBuilds,
    aggregate: Object.freeze({ ...parsed.aggregate }),
  });
}

function freezeProfile(profile: DockerExecutionProfileV1): DockerExecutionProfileV1 {
  return Object.freeze({
    schemaVersion: 1,
    profileId: profile.profileId,
    securityLevel: profile.securityLevel,
    semanticPolicyRevision: profile.semanticPolicyRevision,
    transport: Object.freeze({
      kind: "unix",
      hostMachineIdentity: profile.transport.hostMachineIdentity,
      dockerSocket: Object.freeze({ ...profile.transport.dockerSocket }),
      controlSocket: Object.freeze({ ...profile.transport.controlSocket }),
    }),
    backend: Object.freeze({
      kind: profile.backend.kind,
      machineIdentity: profile.backend.machineIdentity,
      owner: Object.freeze({ ...profile.backend.owner }),
      filesystem: Object.freeze({ ...profile.backend.filesystem }),
      cgroup: Object.freeze({
        aggregatePath: profile.backend.cgroup.aggregatePath,
        policyRevision: profile.backend.cgroup.policyRevision,
        controllers: PROFILE_CONTROLLERS,
      }),
    }),
    capacity: Object.freeze({
      cpus: profile.capacity.cpus,
      memoryBytes: profile.capacity.memoryBytes,
      memorySwapBytes: 0,
      pids: profile.capacity.pids,
      maxContainers: profile.capacity.maxContainers,
      maxBuilds: profile.capacity.maxBuilds,
      aggregate: Object.freeze({ ...profile.capacity.aggregate }),
    }),
    policy: Object.freeze({
      hostLoopback: profile.policy.hostLoopback,
      tcpDockerEndpoint: profile.policy.tcpDockerEndpoint,
      outerSocketInjection: profile.policy.outerSocketInjection,
      privilegedTranslation: profile.policy.privilegedTranslation,
      writableRoot: profile.policy.writableRoot,
      network: Object.freeze({
        version: profile.policy.network.version,
        dns: Object.freeze({
          mode: profile.policy.network.dns.mode,
          servers: frozenNonEmptyStrings(profile.policy.network.dns.servers),
        }),
        egress: Object.freeze({
          mode: profile.policy.network.egress.mode,
          allowedProtocols: NETWORK_ALLOWED_PROTOCOLS,
          denyPrivateNetworks: profile.policy.network.egress.denyPrivateNetworks,
          denySiblingSyntheticEndpoints: profile.policy.network.egress.denySiblingSyntheticEndpoints,
          denyCidrs: DOCKER_PROFILE_NETWORK_DENY_CIDRS,
          ipv6: profile.policy.network.egress.ipv6,
          disableHostLoopback: profile.policy.network.egress.disableHostLoopback,
          portDriver: profile.policy.network.egress.portDriver,
          daemonBridge: profile.policy.network.egress.daemonBridge,
          exclusiveNetwork: profile.policy.network.egress.exclusiveNetwork,
          icc: profile.policy.network.egress.icc,
        }),
      }),
    }),
  });
}

/** 严格解析未知输入；不会执行 descriptor 中的 callback、命令或其它代码。 */
export function parseDockerExecutionProfileV1(value: unknown): DockerExecutionProfileV1 {
  const root = objectAt(value, "profile");
  onlyKeys(root, ["schemaVersion", "profileId", "securityLevel", "semanticPolicyRevision", "transport", "backend", "capacity", "policy"], "profile");
  if (root.schemaVersion === undefined) {
    fail("sandbox.docker-profile-schema-invalid", "profile.schemaVersion is required", "profile.schemaVersion");
  }
  if (root.schemaVersion !== DOCKER_EXECUTION_PROFILE_SCHEMA_VERSION) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-unknown-version",
      path: "profile.schemaVersion",
      message: `Unsupported Docker execution profile schema version ${JSON.stringify(root.schemaVersion)}; expected 1`,
    });
  }
  if (root.securityLevel !== "managed-rootless/v1" && root.securityLevel !== "managed-vm-rootless/v1") {
    throw dockerProfileError({
      code: "sandbox.docker-profile-security-level-unsupported",
      path: "profile.securityLevel",
      message: `Unsupported Docker execution profile security level ${JSON.stringify(root.securityLevel)}`,
    });
  }
  const profileId = requiredString(root.profileId, "profile.profileId");
  const semanticPolicyRevision = requiredString(root.semanticPolicyRevision, "profile.semanticPolicyRevision");
  const profile = freezeProfile({
    schemaVersion: 1,
    profileId,
    securityLevel: root.securityLevel,
    semanticPolicyRevision,
    transport: parseTransport(root.transport),
    backend: parseBackend(root.backend),
    capacity: parseCapacity(root.capacity),
    policy: parsePolicy(root.policy, "profile.policy"),
  });
  const expectedRevision = dockerExecutionProfileSemanticPolicyRevisionOf(profile);
  if (semanticPolicyRevision !== expectedRevision) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-semantic-policy-mismatch",
      path: "profile.semanticPolicyRevision",
      message: `profile.semanticPolicyRevision does not match the canonical semantic policy revision ${expectedRevision}`,
      details: { expected: expectedRevision, actual: semanticPolicyRevision },
    });
  }
  return profile;
}

export const parseDockerExecutionProfile = parseDockerExecutionProfileV1;
export const decodeDockerExecutionProfileV1 = parseDockerExecutionProfileV1;

export function makeDockerExecutionProfileV1(input: DockerExecutionProfileV1Draft): DockerExecutionProfileV1 {
  const semanticPolicyRevision = dockerExecutionProfileSemanticPolicyRevisionOf(input);
  return parseDockerExecutionProfileV1({ ...input, semanticPolicyRevision });
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

/** Effect Schema 只负责把该纯数据边界暴露给 Effect consumers；稳定业务错误由 parse 函数提供。 */
export const DockerExecutionProfileV1Schema = Schema.declare(isDockerExecutionProfileV1, {
  identifier: "DockerExecutionProfileV1",
  description: "a callback-free NiceEval Docker execution profile v1",
});

export const DockerExecutionProfileSchema = DockerExecutionProfileV1Schema;

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
      cpus: normalized.capacity.cpus,
      memoryBytes: normalized.capacity.memoryBytes,
      memorySwapBytes: 0,
      pids: normalized.capacity.pids,
      maxContainers: normalized.capacity.maxContainers,
      maxBuilds: normalized.capacity.maxBuilds,
      aggregate: Object.freeze({ ...normalized.capacity.aggregate }),
    }),
  });
}
