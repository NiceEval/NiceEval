import {
  dockerProfileError,
  DockerProfileError,
} from "./errors.ts";
import {
  dockerExecutionProfileV1Digest,
  parseDockerExecutionProfileV1,
  type DockerExecutionProfileV1,
} from "./schema.ts";

/** 由宿主 registry loader 提供的文件事实；本模块不会自行读文件或执行路径。 */
export interface DockerProfileRegistryFileFacts {
  readonly isSymlink?: boolean;
  readonly ownerUid?: number;
  readonly mode?: number;
  readonly parentWritable?: boolean;
  readonly parentModes?: readonly number[];
}

export interface DockerProfileRegistryEntry {
  readonly alias: string;
  readonly profile?: unknown;
  readonly descriptor?: unknown;
  readonly source?: string;
  readonly fileFacts?: DockerProfileRegistryFileFacts;
}

export interface DockerProfileRegistryOptions {
  /** descriptor 必须由 root 持有；未提供 file facts 时纯解析不会臆造权限事实。 */
  readonly expectedOwnerUid?: number;
}

export interface ResolvedDockerProfileEntry {
  readonly alias: string;
  readonly profile: DockerExecutionProfileV1;
  readonly profileId: string;
  readonly descriptorDigest: string;
  readonly source?: string;
}

export interface DockerProfileRegistryIndex {
  readonly entries: readonly ResolvedDockerProfileEntry[];
}

export type DockerProfileRegistryInput =
  | readonly DockerProfileRegistryEntry[]
  | Readonly<globalThis.Record<string, unknown>>
  | { readonly entries: readonly DockerProfileRegistryEntry[] };

function isRecord(value: unknown): value is globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(record: globalThis.Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function requiredAlias(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path,
      message: `${path} must be a non-empty alias`,
    });
  }
  if (value.includes("\u0000") || value.includes("/") || value.includes("\\")) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path,
      message: `${path} must be a single non-empty alias segment`,
    });
  }
  return value;
}

function requiredSource(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\u0000")) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path,
      message: `${path} must be a non-empty source string without NUL`,
    });
  }
  return value;
}

function requiredSelector(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\u0000")) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path,
      message: `${path} must be a non-empty selector without NUL`,
    });
  }
  return value;
}

function sourceFacts(value: unknown, path: string): DockerProfileRegistryFileFacts | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path,
      message: `${path} must be a plain object`,
    });
  }
  const allowed = new Set(["isSymlink", "ownerUid", "mode", "parentWritable", "parentModes"]);
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported !== undefined) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path: `${path}.${unsupported}`,
      message: `${path}.${unsupported} is not supported`,
    });
  }
  if (value.isSymlink !== undefined && typeof value.isSymlink !== "boolean") {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path: `${path}.isSymlink`,
      message: `${path}.isSymlink must be boolean`,
    });
  }
  const ownerUid = value.ownerUid;
  if (ownerUid !== undefined && (typeof ownerUid !== "number" || !Number.isSafeInteger(ownerUid) || ownerUid < 0)) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path: `${path}.ownerUid`,
      message: `${path}.ownerUid must be a non-negative safe integer`,
    });
  }
  const mode = value.mode;
  if (mode !== undefined && (typeof mode !== "number" || !Number.isInteger(mode) || mode < 0 || mode > 0o7777)) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path: `${path}.mode`,
      message: `${path}.mode must be an integer between 0 and 0o7777`,
    });
  }
  if (value.parentWritable !== undefined && typeof value.parentWritable !== "boolean") {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path: `${path}.parentWritable`,
      message: `${path}.parentWritable must be boolean`,
    });
  }
  const parentModes = value.parentModes;
  if (parentModes !== undefined && (!Array.isArray(parentModes) || parentModes.some(
    (mode) => typeof mode !== "number" || !Number.isInteger(mode) || mode < 0 || mode > 0o7777,
  ))) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path: `${path}.parentModes`,
      message: `${path}.parentModes must contain file modes`,
    });
  }
  return Object.freeze({
    ...(value.isSymlink === undefined ? {} : { isSymlink: value.isSymlink }),
    ...(ownerUid === undefined ? {} : { ownerUid }),
    ...(mode === undefined ? {} : { mode }),
    ...(value.parentWritable === undefined ? {} : { parentWritable: value.parentWritable }),
    ...(parentModes === undefined ? {} : { parentModes: Object.freeze([...parentModes]) }),
  });
}

function checkSourceFacts(
  facts: DockerProfileRegistryFileFacts | undefined,
  path: string,
  expectedOwnerUid: number,
): void {
  if (facts === undefined) return;
  if (facts.isSymlink === true) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-symlink",
      path,
      message: "Docker profile descriptor must be a regular file, not a symbolic link",
    });
  }
  if (facts.ownerUid !== undefined && facts.ownerUid !== expectedOwnerUid) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-owner-invalid",
      path,
      message: `Docker profile descriptor must be owned by UID ${expectedOwnerUid}`,
      details: { expectedOwnerUid, actualOwnerUid: facts.ownerUid },
    });
  }
  if (facts.mode !== undefined && (facts.mode & 0o022) !== 0) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-mode-invalid",
      path,
      message: "Docker profile descriptor and registry file must not be group- or world-writable",
      details: { mode: facts.mode },
    });
  }
  if (facts.parentWritable === true || facts.parentModes?.some((mode) => (mode & 0o022) !== 0) === true) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-parent-writable",
      path,
      message: "Docker profile descriptor parent directories must not be group- or world-writable",
    });
  }
}

function entryFromArray(value: unknown, index: number): DockerProfileRegistryEntry {
  const path = `registry.entries[${index}]`;
  if (!isRecord(value)) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path,
      message: `${path} must be a plain object`,
    });
  }
  const allowed = new Set(["alias", "profile", "descriptor", "source", "fileFacts"]);
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported !== undefined) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path: `${path}.${unsupported}`,
      message: `${path}.${unsupported} is not supported`,
    });
  }
  if (hasOwn(value, "profile") && hasOwn(value, "descriptor")) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path,
      message: `${path} must provide either profile or descriptor, not both`,
    });
  }
  if (!hasOwn(value, "profile") && !hasOwn(value, "descriptor")) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path,
      message: `${path} must provide profile or descriptor`,
    });
  }
  const profile = hasOwn(value, "profile") ? value.profile : value.descriptor;
  return Object.freeze({
    alias: requiredAlias(value.alias, `${path}.alias`),
    profile,
    ...(value.source === undefined ? {} : { source: requiredSource(value.source, `${path}.source`) }),
    ...(value.fileFacts === undefined ? {} : { fileFacts: sourceFacts(value.fileFacts, `${path}.fileFacts`) }),
  });
}

function entryFromAlias(alias: string, value: unknown): DockerProfileRegistryEntry[] {
  const normalizedAlias = requiredAlias(alias, `registry.${alias}`);
  if (Array.isArray(value)) {
    return value.map((candidate) => Object.freeze({ alias: normalizedAlias, profile: candidate }));
  }
  return [Object.freeze({ alias: normalizedAlias, profile: value })];
}

function rawEntries(input: unknown): readonly DockerProfileRegistryEntry[] {
  if (Array.isArray(input)) return Object.freeze(input.map(entryFromArray));
  if (!isRecord(input)) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-entry-invalid",
      path: "registry",
      message: "registry must be an entries array or an alias-to-descriptor object",
    });
  }
  if (hasOwn(input, "entries")) {
    const unsupported = Object.keys(input).find((key) => key !== "entries");
    if (unsupported !== undefined) {
      throw dockerProfileError({
        code: "sandbox.docker-profile-registry-entry-invalid",
        path: `registry.${unsupported}`,
        message: `registry.${unsupported} is not supported`,
      });
    }
    if (!Array.isArray(input.entries)) {
      throw dockerProfileError({
        code: "sandbox.docker-profile-registry-entry-invalid",
        path: "registry.entries",
        message: "registry.entries must be an array",
      });
    }
    return Object.freeze(input.entries.map(entryFromArray));
  }
  const entries = Object.entries(input).flatMap(([alias, profile]) => entryFromAlias(alias, profile));
  return Object.freeze(entries);
}

function withAlias(error: DockerProfileError, alias: string): DockerProfileError {
  return dockerProfileError({
    code: error.code,
    message: `Docker profile alias ${JSON.stringify(alias)}: ${error.message}`,
    ...(error.path === undefined ? {} : { path: error.path }),
    alias,
    ...(error.profileId === undefined ? {} : { profileId: error.profileId }),
    ...(error.candidates === undefined ? {} : { candidates: error.candidates }),
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}

function resolveEntry(
  entry: DockerProfileRegistryEntry,
  index: number,
  options: DockerProfileRegistryOptions,
): ResolvedDockerProfileEntry {
  const alias = requiredAlias(entry.alias, `registry.entries[${index}].alias`);
  checkSourceFacts(entry.fileFacts, `registry.entries[${index}]`, options.expectedOwnerUid ?? 0);
  try {
    const profile = parseDockerExecutionProfileV1(entry.profile);
    return Object.freeze({
      alias,
      profile,
      profileId: profile.profileId,
      descriptorDigest: dockerExecutionProfileV1Digest(profile),
      ...(entry.source === undefined ? {} : { source: entry.source }),
    });
  } catch (error) {
    if (error instanceof DockerProfileError) throw withAlias(error, alias);
    throw error;
  }
}

/** 构造只含规范化 descriptor 的 registry index；不读文件、不执行 profile 内容。 */
export function indexDockerProfiles(
  input: DockerProfileRegistryInput | unknown,
  options: DockerProfileRegistryOptions = {},
): DockerProfileRegistryIndex {
  const entries = rawEntries(input).map((entry, index) => resolveEntry(entry, index, options));
  const byAlias = new Map<string, ResolvedDockerProfileEntry[]>();
  const byProfileId = new Map<string, ResolvedDockerProfileEntry[]>();
  for (const entry of entries) {
    byAlias.set(entry.alias, [...(byAlias.get(entry.alias) ?? []), entry]);
    byProfileId.set(entry.profileId, [...(byProfileId.get(entry.profileId) ?? []), entry]);
  }
  const ambiguous = [...byAlias.entries()].find(([, candidates]) => candidates.length > 1);
  if (ambiguous !== undefined) {
    const [alias, candidates] = ambiguous;
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-ambiguous-alias",
      alias,
      candidates: candidates.map((candidate) => candidate.profileId),
      message: `Docker profile alias ${JSON.stringify(alias)} resolves to multiple descriptors`,
    });
  }
  const duplicate = [...byProfileId.entries()].find(([, candidates]) => candidates.length > 1);
  if (duplicate !== undefined) {
    const [profileId, candidates] = duplicate;
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-duplicate-id",
      profileId,
      alias: candidates[0]?.alias,
      candidates: candidates.map((candidate) => candidate.alias),
      message: `Docker profile stable ID ${JSON.stringify(profileId)} is registered more than once`,
    });
  }
  return Object.freeze({ entries: Object.freeze(entries) });
}

export const createDockerProfileRegistry = indexDockerProfiles;
export const parseDockerProfileRegistry = indexDockerProfiles;

function isRegistryIndex(value: unknown): value is DockerProfileRegistryIndex {
  return isRecord(value) && Array.isArray(value.entries) && value.entries.every((entry) =>
    isRecord(entry) &&
    typeof entry.alias === "string" &&
    isRecord(entry.profile) &&
    typeof entry.profileId === "string" &&
    typeof entry.descriptorDigest === "string",
  );
}

function indexOf(input: DockerProfileRegistryIndex | DockerProfileRegistryInput | unknown): DockerProfileRegistryIndex {
  if (isRegistryIndex(input)) {
    const entries = input.entries.map((entry, index) => {
      const alias = requiredAlias(entry.alias, `registry.entries[${index}].alias`);
      try {
        const profile = parseDockerExecutionProfileV1(entry.profile);
        const descriptorDigest = dockerExecutionProfileV1Digest(profile);
        if (entry.profileId !== profile.profileId || entry.descriptorDigest !== descriptorDigest) {
          throw dockerProfileError({
            code: "sandbox.docker-profile-registry-entry-invalid",
            path: `registry.entries[${index}]`,
            message: "registry index profileId or descriptorDigest does not match its descriptor",
            details: {
              expectedProfileId: profile.profileId,
              actualProfileId: entry.profileId,
              expectedDescriptorDigest: descriptorDigest,
              actualDescriptorDigest: entry.descriptorDigest,
            },
          });
        }
        return Object.freeze({
          alias,
          profile,
          ...(entry.source === undefined ? {} : { source: requiredSource(entry.source, `registry.entries[${index}].source`) }),
        });
      } catch (error) {
        if (error instanceof DockerProfileError) throw withAlias(error, alias);
        throw error;
      }
    });
    return indexDockerProfiles(entries);
  }
  return indexDockerProfiles(input);
}

/** 只按宿主 alias 查找；没有 alias 时不猜 profile ID 或默认 Docker endpoint。 */
export function resolveDockerProfile(
  registry: DockerProfileRegistryIndex | DockerProfileRegistryInput | unknown,
  alias: string,
): ResolvedDockerProfileEntry {
  const normalizedAlias = requiredAlias(alias, "profile alias");
  const index = indexOf(registry);
  const match = index.entries.find((entry) => entry.alias === normalizedAlias);
  if (match !== undefined) return match;
  throw dockerProfileError({
    code: "sandbox.docker-profile-registry-alias-not-found",
    alias: normalizedAlias,
    message: `No Docker execution profile is registered for alias ${JSON.stringify(normalizedAlias)}`,
  });
}

export const resolveDockerProfileAlias = resolveDockerProfile;

/** detached 读面可显式按 alias 或 stable ID 查找；两者同时命中不同 descriptor 时拒绝猜测。 */
export function resolveDockerProfileSelector(
  registry: DockerProfileRegistryIndex | DockerProfileRegistryInput | unknown,
  selector: string,
): ResolvedDockerProfileEntry {
  const normalizedSelector = requiredSelector(selector, "profile selector");
  const index = indexOf(registry);
  const matches = index.entries.filter((entry) =>
    entry.alias === normalizedSelector || entry.profileId === normalizedSelector,
  );
  const first = matches[0];
  if (first === undefined) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-alias-not-found",
      alias: normalizedSelector,
      message: `No Docker execution profile matches selector ${JSON.stringify(normalizedSelector)}`,
    });
  }
  if (matches.length > 1) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-registry-ambiguous-alias",
      alias: normalizedSelector,
      candidates: matches.map((match) => match.alias),
      message: `Docker profile selector ${JSON.stringify(normalizedSelector)} is ambiguous`,
    });
  }
  return first;
}

export const resolveDockerExecutionProfile = resolveDockerProfile;
