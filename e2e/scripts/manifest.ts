// E2E repo manifest schema and strict validation.
//
// Contract: docs/engineering/testing/e2e/scenario-repos.md「Repo Manifest」.
// This is the stable contract between the root orchestrator and every e2e
// repo: schemaVersion/id/areas/lanes/executor/command/timeoutMinutes/secrets/
// requires/harness/paths/artifacts. Unknown fields are rejected, never
// ignored, and there is no legacy `group` compatibility. `harness.testkit:
// true` is the only true source of Testkit consumption intent — scenario
// source package.json/lockfiles never declare @niceeval/testkit
// (docs/engineering/testing/testkit.md「构建与采用门禁」6).

import { posix } from "node:path";

export const SCHEMA_VERSION = 1 as const;

export const AREAS = [
  "eval",
  "cli",
  "report",
  "record",
  "package",
  "runner",
  "adapter",
  "sandbox",
  "lifecycle",
] as const;
export type Area = (typeof AREAS)[number];

export const LANES = ["pr", "main", "nightly", "release"] as const;
export type Lane = (typeof LANES)[number];

export const PLATFORMS = ["linux", "darwin"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type Browser = (typeof BROWSERS)[number];

/** The root runner currently executes scenario commands on the host only. */
export type Executor = { kind: "host" };

export interface RepoRequires {
  docker?: boolean;
  externalNetwork?: boolean;
  platforms?: readonly Platform[];
  runtimes?: readonly string[];
  browsers?: readonly Browser[];
}

export interface RepoHarness {
  /** Declares that the repo consumes @niceeval/testkit; injection intent. */
  testkit?: boolean;
}

export interface E2ERepoManifest {
  schemaVersion: 1;
  id: string;
  areas: readonly Area[];
  lanes: readonly Lane[];
  executor: Executor;
  command: readonly [string, ...string[]];
  timeoutMinutes: number;
  secrets: readonly string[];
  requires?: RepoRequires;
  harness?: RepoHarness;
  paths: readonly string[];
  artifacts: readonly string[];
}

export type ManifestParseResult =
  | { ok: true; manifest: E2ERepoManifest }
  | { ok: false; errors: string[] };

const TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "id",
  "areas",
  "lanes",
  "executor",
  "command",
  "timeoutMinutes",
  "secrets",
  "requires",
  "harness",
  "paths",
  "artifacts",
]);

const EXECUTOR_FIELDS = new Set(["kind"]);
const REQUIRES_FIELDS = new Set([
  "docker",
  "externalNetwork",
  "platforms",
  "runtimes",
  "browsers",
]);
const HARNESS_FIELDS = new Set(["testkit"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

/** Non-empty array whose every element is a member of `allowed` (areas/lanes). */
function isEnumArray<T extends string>(v: unknown, allowed: readonly T[]): v is T[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((item) => typeof item === "string" && (allowed as readonly string[]).includes(item))
  );
}

/** Array whose every element is a member of `allowed`; an empty list is allowed (requires fields). */
function isEnumList<T extends string>(v: unknown, allowed: readonly T[]): v is T[] {
  return (
    Array.isArray(v) &&
    v.every((item) => typeof item === "string" && (allowed as readonly string[]).includes(item))
  );
}

function unknownFields(fields: Set<string>, r: Record<string, unknown>, source: string): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(r)) {
    if (!fields.has(key)) {
      errors.push(`${source}: unknown field ${JSON.stringify(key)}`);
    }
  }
  return errors;
}

function enumMembers(values: readonly string[]): string {
  return values.join("|");
}

/**
 * A manifest id is also an artifact-directory relative path. Keep it in one
 * portable canonical spelling so `adapter/ai-sdk` remains valid while root
 * escapes, empty segments, backslashes, and dot traversal cannot reach the
 * caller's artifact root.
 */
export function isCanonicalRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value === value.trim() &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.includes(":") &&
    !/[\r\n]/.test(value) &&
    !posix.isAbsolute(value) &&
    value !== "." &&
    value !== ".." &&
    !value.startsWith("../") &&
    posix.normalize(value) === value
  );
}

function isCanonicalArtifactDirectory(value: string): boolean {
  return isCanonicalRelativePath(value) && !/[\[\]{}*?]/.test(value);
}

/**
 * Only a canonical directory subtree or a top-level filename glob is a valid
 * collector input. The latter deliberately has no path separator, so even a
 * broad `*` remains inside the isolated copy root.
 */
export function artifactPatternError(value: string): string | undefined {
  if (value.endsWith("/**")) {
    const directory = value.slice(0, -3);
    return isCanonicalArtifactDirectory(directory)
      ? undefined
      : "must use a canonical contained directory before /**";
  }
  if (
    value.length === 0 ||
    value !== value.trim() ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes(":") ||
    value === "." ||
    value === ".."
  ) {
    return "must be a top-level filename glob or canonical dir/**";
  }
  return undefined;
}

/**
 * Parse and strictly validate one `e2e.json` value.
 *
 * All problems are collected and returned; the caller treats any non-empty
 * `errors` as fatal for the whole discovery result. `source` names the file
 * in error messages (typically its path relative to the discovery root).
 */
export function parseManifest(raw: unknown, source: string): ManifestParseResult {
  const errors: string[] = [];

  if (!isPlainObject(raw)) {
    return { ok: false, errors: [`${source}: e2e.json must be a JSON object`] };
  }

  errors.push(...unknownFields(TOP_LEVEL_FIELDS, raw, source));

  if (raw.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${source}: "schemaVersion" must be ${SCHEMA_VERSION}, got ${JSON.stringify(raw.schemaVersion)}`);
  }

  if (typeof raw.id !== "string" || !isCanonicalRelativePath(raw.id)) {
    errors.push(
      `${source}: "id" must be a canonical contained relative path (for example "adapter/ai-sdk"), got ${JSON.stringify(raw.id)}`,
    );
  }

  if (!isEnumArray(raw.areas, AREAS)) {
    errors.push(`${source}: "areas" must be a non-empty array of ${enumMembers(AREAS)}, got ${JSON.stringify(raw.areas)}`);
  }

  if (!isEnumArray(raw.lanes, LANES)) {
    errors.push(`${source}: "lanes" must be a non-empty array of ${enumMembers(LANES)}, got ${JSON.stringify(raw.lanes)}`);
  }

  if (raw.executor !== undefined) {
    if (!isPlainObject(raw.executor)) {
      errors.push(`${source}: "executor" must be an object, got ${JSON.stringify(raw.executor)}`);
    } else {
      const ex = raw.executor;
      errors.push(...unknownFields(EXECUTOR_FIELDS, ex, source));

      if (typeof ex.kind !== "string" || ex.kind !== "host") {
        errors.push(
          `${source}: "executor.kind" must be host, got ${JSON.stringify(ex.kind)}`,
        );
      }
    }
  } else {
    errors.push(`${source}: "executor" is missing`);
  }

  if (
    !Array.isArray(raw.command) ||
    raw.command.length === 0 ||
    !raw.command.every((c) => typeof c === "string" && c.length > 0)
  ) {
    errors.push(
      `${source}: "command" must be a non-empty array of non-empty strings, got ${JSON.stringify(raw.command)}`,
    );
  }

  if (
    typeof raw.timeoutMinutes !== "number" ||
    !Number.isFinite(raw.timeoutMinutes) ||
    raw.timeoutMinutes <= 0
  ) {
    errors.push(
      `${source}: "timeoutMinutes" must be a positive number, got ${JSON.stringify(raw.timeoutMinutes)}`,
    );
  }

  if (!isStringArray(raw.secrets)) {
    errors.push(`${source}: "secrets" must be an array of strings, got ${JSON.stringify(raw.secrets)}`);
  }

  if (!isStringArray(raw.paths)) {
    errors.push(`${source}: "paths" must be an array of strings, got ${JSON.stringify(raw.paths)}`);
  }

  if (!isStringArray(raw.artifacts)) {
    errors.push(`${source}: "artifacts" must be an array of strings, got ${JSON.stringify(raw.artifacts)}`);
  } else {
    for (const artifact of raw.artifacts) {
      const error = artifactPatternError(artifact);
      if (error !== undefined) errors.push(`${source}: artifact pattern ${JSON.stringify(artifact)} ${error}`);
    }
  }

  let requires: RepoRequires | undefined;
  if (raw.requires !== undefined) {
    if (!isPlainObject(raw.requires)) {
      errors.push(`${source}: "requires" must be an object when present, got ${JSON.stringify(raw.requires)}`);
    } else {
      const req = raw.requires;
      errors.push(...unknownFields(REQUIRES_FIELDS, req, source));
      requires = {};

      if (req.docker !== undefined) {
        if (typeof req.docker !== "boolean") {
          errors.push(`${source}: "requires.docker" must be a boolean, got ${JSON.stringify(req.docker)}`);
        } else {
          requires.docker = req.docker;
        }
      }
      if (req.externalNetwork !== undefined) {
        if (typeof req.externalNetwork !== "boolean") {
          errors.push(
            `${source}: "requires.externalNetwork" must be a boolean, got ${JSON.stringify(req.externalNetwork)}`,
          );
        } else {
          requires.externalNetwork = req.externalNetwork;
        }
      }
      if (req.platforms !== undefined) {
        if (!isEnumList(req.platforms, PLATFORMS)) {
          errors.push(
            `${source}: "requires.platforms" must be an array of ${enumMembers(PLATFORMS)}, got ${JSON.stringify(req.platforms)}`,
          );
        } else {
          requires.platforms = req.platforms;
        }
      }
      if (req.runtimes !== undefined) {
        if (!isStringArray(req.runtimes)) {
          errors.push(
            `${source}: "requires.runtimes" must be an array of strings, got ${JSON.stringify(req.runtimes)}`,
          );
        } else {
          requires.runtimes = req.runtimes;
        }
      }
      if (req.browsers !== undefined) {
        if (!isEnumList(req.browsers, BROWSERS)) {
          errors.push(
            `${source}: "requires.browsers" must be an array of ${enumMembers(BROWSERS)}, got ${JSON.stringify(req.browsers)}`,
          );
        } else {
          requires.browsers = req.browsers;
        }
      }
    }
  }

  let harness: RepoHarness | undefined;
  if (raw.harness !== undefined) {
    if (!isPlainObject(raw.harness)) {
      errors.push(`${source}: "harness" must be an object when present, got ${JSON.stringify(raw.harness)}`);
    } else {
      const h = raw.harness;
      errors.push(...unknownFields(HARNESS_FIELDS, h, source));
      harness = {};
      if (h.testkit !== undefined) {
        if (typeof h.testkit !== "boolean") {
          errors.push(`${source}: "harness.testkit" must be a boolean, got ${JSON.stringify(h.testkit)}`);
        } else {
          harness.testkit = h.testkit;
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const ex = raw.executor as Record<string, unknown>;
  const executor: Executor = { kind: "host" };

  return {
    ok: true,
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      id: raw.id as string,
      areas: raw.areas as readonly Area[],
      lanes: raw.lanes as readonly Lane[],
      executor,
      command: raw.command as [string, ...string[]],
      timeoutMinutes: raw.timeoutMinutes as number,
      secrets: raw.secrets as string[],
      requires,
      ...(harness === undefined ? {} : { harness }),
      paths: raw.paths as string[],
      artifacts: raw.artifacts as string[],
    },
  };
}
