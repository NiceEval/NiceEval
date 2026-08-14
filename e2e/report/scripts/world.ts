import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";

export const WORLD_MANIFEST = "world.json";

export type PreparedProfile =
  | {
      readonly status: "ready";
      readonly recordDir: string;
      readonly exportDir?: string;
      readonly seedDigest: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason: string;
    };

/** Public-CLI facts captured while producing the frozen classic Record. */
export interface PreparedClassicAttempt {
  readonly experimentId: string;
  readonly evalId: string;
  readonly locator: string;
  readonly verdict: "passed" | "failed";
}

export interface PreparedClassicHistoryAttempt extends PreparedClassicAttempt {
  /** Which of the two public producer commands emitted this locator. */
  readonly sourceRun: "full" | "memory-a-rerun";
}

export interface PreparedWorld {
  readonly schemaVersion: 1;
  readonly classic: PreparedProfile;
  readonly classicAttempts: readonly PreparedClassicAttempt[];
  readonly classicHistoryAttempts: readonly PreparedClassicHistoryAttempt[];
  readonly legacy: PreparedProfile;
}

const sortNames = (directory: string): readonly string[] =>
  readdirSync(directory).sort((left, right) => left.localeCompare(right));

const isWithin = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
};

const assertRelativePath = (path: string, label: string): void => {
  if (path === "" || path.startsWith("/") || path.split(/[\\/]/).includes("..")) {
    throw new Error(`${label} must be a non-empty relative path: ${path}`);
  }
};

const updateTreeDigest = (hash: ReturnType<typeof createHash>, root: string, current: string): void => {
  const entries = sortNames(current);
  for (const name of entries) {
    const entry = resolve(current, name);
    const info = lstatSync(entry);
    const path = relative(root, entry).split(sep).join("/");
    if (info.isSymbolicLink()) {
      throw new Error(`frozen World cannot contain a symbolic link: ${path}`);
    }
    if (info.isDirectory()) {
      hash.update(`directory:${path}\n`);
      updateTreeDigest(hash, root, entry);
      continue;
    }
    if (!info.isFile()) {
      throw new Error(`frozen World contains an unsupported entry: ${path}`);
    }
    hash.update(`file:${path}:${info.size}\n`);
    hash.update(readFileSync(entry));
  }
};

/** A content digest, intentionally independent from mtimes and modes. */
export const treeDigest = (directory: string): string => {
  const root = resolve(directory);
  if (!lstatSync(root).isDirectory()) {
    throw new Error(`expected a directory to digest: ${root}`);
  }
  const hash = createHash("sha256");
  updateTreeDigest(hash, root, root);
  return hash.digest("hex");
};

const assertNoSharedInodes = (source: string, destination: string): void => {
  for (const name of sortNames(source)) {
    const sourceEntry = resolve(source, name);
    const destinationEntry = resolve(destination, name);
    const sourceInfo = lstatSync(sourceEntry);
    const destinationInfo = lstatSync(destinationEntry);
    if (sourceInfo.isDirectory()) {
      assertNoSharedInodes(sourceEntry, destinationEntry);
      continue;
    }
    if (sourceInfo.isFile()) {
      const sourceStat = statSync(sourceEntry);
      const destinationStat = statSync(destinationEntry);
      if (sourceStat.dev === destinationStat.dev && sourceStat.ino === destinationStat.ino) {
        throw new Error(`consumer copy must not hard-link the frozen seed: ${relative(source, sourceEntry)}`);
      }
    }
  }
};

/**
 * Copies a frozen seed as ordinary bytes.  This is deliberately not a link:
 * every test receives a private mutable Record and cannot affect another test.
 */
export const copyTreePrivately = (source: string, destination: string, expectedDigest?: string): string => {
  const sourceRoot = resolve(source);
  const destinationRoot = resolve(destination);
  if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) {
    throw new Error(`frozen seed does not exist: ${sourceRoot}`);
  }
  if (existsSync(destinationRoot)) {
    throw new Error(`private destination already exists: ${destinationRoot}`);
  }
  mkdirSync(dirname(destinationRoot), { recursive: true });
  cpSync(sourceRoot, destinationRoot, { recursive: true, dereference: false, verbatimSymlinks: true });
  const actualDigest = treeDigest(destinationRoot);
  if (expectedDigest !== undefined && actualDigest !== expectedDigest) {
    throw new Error(`private copy digest mismatch: expected ${expectedDigest}, received ${actualDigest}`);
  }
  assertNoSharedInodes(sourceRoot, destinationRoot);
  return actualDigest;
};

const visitTree = (directory: string, visit: (path: string, directory: boolean) => void): void => {
  for (const name of sortNames(directory)) {
    const entry = resolve(directory, name);
    const info = lstatSync(entry);
    if (info.isSymbolicLink()) {
      throw new Error(`World cannot be made writable/read-only through a symbolic link: ${entry}`);
    }
    if (info.isDirectory()) {
      visitTree(entry, visit);
      visit(entry, true);
      continue;
    }
    if (info.isFile()) {
      visit(entry, false);
    }
  }
};

export const makeTreeReadOnly = (directory: string): void => {
  visitTree(directory, (entry, isDirectory) => chmodSync(entry, isDirectory ? 0o555 : 0o444));
  chmodSync(directory, 0o555);
};

export const makeTreeWritable = (directory: string): void => {
  chmodSync(directory, 0o755);
  visitTree(directory, (entry, isDirectory) => chmodSync(entry, isDirectory ? 0o755 : 0o644));
};

const validateProfile = (worldRoot: string, profile: PreparedProfile, name: string): void => {
  if (profile.status === "unavailable") {
    return;
  }
  assertRelativePath(profile.recordDir, `${name}.recordDir`);
  const recordDir = resolve(worldRoot, profile.recordDir);
  if (!isWithin(worldRoot, recordDir) || !existsSync(recordDir)) {
    throw new Error(`${name} Record is outside or missing from the prepared World`);
  }
  if (treeDigest(recordDir) !== profile.seedDigest) {
    throw new Error(`${name} frozen Record digest no longer matches its manifest`);
  }
  if (profile.exportDir !== undefined) {
    assertRelativePath(profile.exportDir, `${name}.exportDir`);
    const exportDir = resolve(worldRoot, profile.exportDir);
    if (!isWithin(worldRoot, exportDir) || !existsSync(exportDir)) {
      throw new Error(`${name} static export is outside or missing from the prepared World`);
    }
  }
};

export const readPreparedWorld = (worldDirectory: string): PreparedWorld => {
  const worldRoot = resolve(worldDirectory);
  const manifestPath = resolve(worldRoot, WORLD_MANIFEST);
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    !("classic" in parsed) ||
    !("legacy" in parsed) ||
    !Array.isArray((parsed as { classicAttempts?: unknown }).classicAttempts) ||
    !Array.isArray((parsed as { classicHistoryAttempts?: unknown }).classicHistoryAttempts)
  ) {
    throw new Error(`invalid prepared World manifest: ${manifestPath}`);
  }
  const world = parsed as PreparedWorld;
  validateProfile(worldRoot, world.classic, "classic");
  validateProfile(worldRoot, world.legacy, "legacy");
  const identities = new Set<string>();
  for (const attempt of world.classicAttempts) {
    if (
      typeof attempt !== "object" ||
      attempt === null ||
      typeof attempt.experimentId !== "string" ||
      typeof attempt.evalId !== "string" ||
      typeof attempt.locator !== "string" ||
      (attempt.verdict !== "passed" && attempt.verdict !== "failed")
    ) {
      throw new Error(`invalid prepared classic attempt fact in ${manifestPath}`);
    }
    const key = `${attempt.experimentId}\0${attempt.evalId}`;
    if (identities.has(key)) throw new Error(`duplicate prepared classic attempt fact: ${attempt.experimentId} ${attempt.evalId}`);
    identities.add(key);
  }
  const historyLocators = new Set<string>();
  for (const attempt of world.classicHistoryAttempts) {
    if (
      typeof attempt !== "object" ||
      attempt === null ||
      typeof attempt.experimentId !== "string" ||
      typeof attempt.evalId !== "string" ||
      typeof attempt.locator !== "string" ||
      (attempt.verdict !== "passed" && attempt.verdict !== "failed") ||
      (attempt.sourceRun !== "full" && attempt.sourceRun !== "memory-a-rerun")
    ) {
      throw new Error(`invalid prepared classic history attempt fact in ${manifestPath}`);
    }
    if (historyLocators.has(attempt.locator)) {
      throw new Error(`duplicate prepared classic history locator: ${attempt.locator}`);
    }
    historyLocators.add(attempt.locator);
  }
  return world;
};

export const writePreparedWorld = (worldDirectory: string, world: PreparedWorld): void => {
  mkdirSync(worldDirectory, { recursive: true });
  writeFileSync(resolve(worldDirectory, WORLD_MANIFEST), `${JSON.stringify(world, null, 2)}\n`);
};

export const publishPreparedWorld = (draftDirectory: string, destination: string): void => {
  const draft = resolve(draftDirectory);
  const output = resolve(destination);
  if (existsSync(output)) {
    throw new Error(`prepared World destination already exists: ${output}`);
  }
  readPreparedWorld(draft);
  makeTreeReadOnly(draft);
  renameSync(draft, output);
};
