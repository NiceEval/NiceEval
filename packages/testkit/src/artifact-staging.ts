import { constants } from "node:fs";
import { copyFile, cp, lstat, mkdir, mkdtemp, readdir, realpath, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type ArtifactStageEntry = {
  /** Non-empty path relative to sourceRoot. */
  source: string;
  /** Non-empty path relative to destinationRoot. */
  target: string;
  /** Missing sources fail unless this is explicitly true. */
  optional?: boolean;
};

export type StageArtifactsOptions = {
  /** Existing absolute directory that contains every source entry. */
  sourceRoot: string;
  /** Existing absolute directory that receives every target entry. */
  destinationRoot: string;
  entries: readonly ArtifactStageEntry[];
  collision: "error";
};

export type ArtifactStageCopyReceipt = {
  source: string;
  target: string;
};

export type ArtifactStageSkipReceipt = ArtifactStageCopyReceipt & {
  reason: "optional-source-missing";
};

export type StageArtifactsReceipt = {
  copied: readonly ArtifactStageCopyReceipt[];
  skipped: readonly ArtifactStageSkipReceipt[];
};

type PreparedEntry = {
  entry: ArtifactStageEntry;
  sourcePath: string;
  targetPath: string;
  kind?: "file" | "directory";
  stagingPath?: string;
};

type CreatedItem = {
  path: string;
  kind: "file" | "directory";
  dev: number;
  ino: number;
};

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code as string | undefined
    : undefined;
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function assertAbsoluteDirectoryRoot(root: string, label: string): string {
  if (!isAbsolute(root)) {
    throw new Error(`${label} must be an absolute path: ${root}`);
  }
  return resolve(root);
}

async function resolveDirectoryRoot(root: string, label: string): Promise<string> {
  const absoluteRoot = assertAbsoluteDirectoryRoot(root, label);
  await assertDirectoryWithoutSymlink(absoluteRoot, label);
  const before = await lstat(absoluteRoot);
  const physicalRoot = await realpath(absoluteRoot);
  await assertDirectoryWithoutSymlink(physicalRoot, label);
  const after = await lstat(physicalRoot);
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error(`${label} changed while resolving its physical path: ${absoluteRoot}`);
  }
  return physicalRoot;
}

function assertRelativeEntry(root: string, entry: string, label: string): string {
  if (entry.length === 0) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (isAbsolute(entry)) {
    throw new Error(`${label} must be relative: ${entry}`);
  }

  const path = resolve(root, entry);
  const rel = relative(root, path);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} escapes its root: ${entry}`);
  }
  return path;
}

function isNestedPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || isNestedPath(left, right) || isNestedPath(right, left);
}

async function assertDirectoryWithoutSymlink(path: string, label: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }
}

async function inspectSourceTree(path: string, entry: string): Promise<"file" | "directory"> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`artifact source is a symlink: ${entry}`);
  }
  if (stat.isFile()) return "file";
  if (!stat.isDirectory()) {
    throw new Error(`artifact source must be a regular file or directory: ${entry}`);
  }

  for (const name of await readdir(path)) {
    await inspectSourceTree(join(path, name), entry);
  }
  return "directory";
}

async function inspectSourceEntry(path: string, entry: string): Promise<"file" | "directory" | undefined> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  return inspectSourceTree(path, entry);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function assertDestinationParentChain(
  destinationRoot: string,
  targetPath: string,
): Promise<void> {
  const parent = dirname(targetPath);
  const parentRelative = relative(destinationRoot, parent);
  let current = destinationRoot;

  if (parentRelative === "") return;
  for (const segment of parentRelative.split(sep)) {
    current = join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`artifact destination parent must not be a symlink: ${current}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`artifact destination parent must be a directory: ${current}`);
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

async function createDestinationParents(
  destinationRoot: string,
  targetPath: string,
  createdDirectories: string[],
): Promise<void> {
  const parent = dirname(targetPath);
  const parentRelative = relative(destinationRoot, parent);
  let current = destinationRoot;

  if (parentRelative === "") return;
  for (const segment of parentRelative.split(sep)) {
    current = join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`artifact destination parent must not be a symlink: ${current}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`artifact destination parent must be a directory: ${current}`);
      }
      continue;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }

    try {
      await mkdir(current);
      createdDirectories.push(current);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }

    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`artifact destination parent must not be a symlink: ${current}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`artifact destination parent must be a directory: ${current}`);
    }
  }
}

function assertDistinctTargets(entries: readonly PreparedEntry[]): void {
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index]!;
    for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
      const other = entries[otherIndex]!;
      if (current.targetPath === other.targetPath) {
        throw new Error(`artifact targets duplicate: ${current.entry.target}`);
      }
      if (isNestedPath(current.targetPath, other.targetPath) || isNestedPath(other.targetPath, current.targetPath)) {
        throw new Error(
          `artifact targets overlap: ${other.entry.target} and ${current.entry.target}`,
        );
      }
    }
  }
}

async function recordCreatedItem(
  path: string,
  kind: CreatedItem["kind"],
  createdItems: CreatedItem[],
): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) {
    throw new Error(`artifact target changed while being committed: ${path}`);
  }
  createdItems.push({ path, kind, dev: stat.dev, ino: stat.ino });
}

async function copyStagedDirectoryContents(
  sourceDirectory: string,
  targetDirectory: string,
  createdItems: CreatedItem[],
): Promise<void> {
  for (const name of await readdir(sourceDirectory)) {
    const source = join(sourceDirectory, name);
    const target = join(targetDirectory, name);
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) {
      throw new Error(`private artifact staging tree unexpectedly contains a symlink: ${source}`);
    }
    if (stat.isDirectory()) {
      await mkdir(target);
      await recordCreatedItem(target, "directory", createdItems);
      await copyStagedDirectoryContents(source, target, createdItems);
      continue;
    }
    if (stat.isFile()) {
      await copyFile(source, target, constants.COPYFILE_EXCL);
      await recordCreatedItem(target, "file", createdItems);
      continue;
    }
    throw new Error(`private artifact staging tree contains an unsupported entry: ${source}`);
  }
}

async function commitEntryExclusively(
  entry: PreparedEntry,
  createdItems: CreatedItem[],
): Promise<void> {
  const stagingPath = entry.stagingPath;
  if (stagingPath === undefined || entry.kind === undefined) {
    throw new Error(`artifact entry was not staged: ${entry.entry.source}`);
  }

  if (entry.kind === "file") {
    await copyFile(stagingPath, entry.targetPath, constants.COPYFILE_EXCL);
    await recordCreatedItem(entry.targetPath, "file", createdItems);
    return;
  }

  await mkdir(entry.targetPath);
  await recordCreatedItem(entry.targetPath, "directory", createdItems);
  await copyStagedDirectoryContents(stagingPath, entry.targetPath, createdItems);
}

async function rollbackCreated(
  items: readonly CreatedItem[],
  directories: readonly string[],
  stagingRoot: string | undefined,
): Promise<unknown[]> {
  const rollbackErrors: unknown[] = [];

  for (const item of [...items].reverse()) {
    try {
      const stat = await lstat(item.path);
      if (stat.dev !== item.dev || stat.ino !== item.ino) continue;
      if (item.kind === "directory") {
        await rmdir(item.path);
      } else {
        await rm(item.path, { force: false });
      }
    } catch (error) {
      if (errorCode(error) !== "ENOENT" && errorCode(error) !== "ENOTEMPTY") {
        rollbackErrors.push(error);
      }
    }
  }

  for (const directory of [...directories].reverse()) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (errorCode(error) !== "ENOENT" && errorCode(error) !== "ENOTEMPTY") {
        rollbackErrors.push(error);
      }
    }
  }

  if (stagingRoot !== undefined) {
    try {
      await rm(stagingRoot, { recursive: true, force: true });
    } catch (error) {
      rollbackErrors.push(error);
    }
  }

  return rollbackErrors;
}

/**
 * Copy declared artifact entries into a durable destination without deleting or
 * overwriting any pre-existing target. Sources are copied through a private
 * OS-temp directory, then committed only after preflight passes. Keeping the
 * staging tree outside destinationRoot prevents concurrent project copies from
 * observing a directory that another artifact operation is about to remove.
 */
export async function stageArtifacts(options: StageArtifactsOptions): Promise<StageArtifactsReceipt> {
  if (options.collision !== "error") {
    throw new Error(`artifact collision policy must be "error": ${String(options.collision)}`);
  }

  const sourceRoot = await resolveDirectoryRoot(options.sourceRoot, "artifact sourceRoot");
  const destinationRoot = await resolveDirectoryRoot(options.destinationRoot, "artifact destinationRoot");
  if (pathsOverlap(sourceRoot, destinationRoot)) {
    throw new Error("artifact sourceRoot and destinationRoot must not overlap");
  }

  const entries: PreparedEntry[] = options.entries.map((entry) => ({
    entry,
    sourcePath: assertRelativeEntry(sourceRoot, entry.source, "artifact source"),
    targetPath: assertRelativeEntry(destinationRoot, entry.target, "artifact target"),
  }));
  assertDistinctTargets(entries);

  for (const entry of entries) {
    await assertDestinationParentChain(destinationRoot, entry.targetPath);
    if (await pathExists(entry.targetPath)) {
      throw new Error(`artifact target already exists: ${entry.entry.target}`);
    }
  }

  const copied: ArtifactStageCopyReceipt[] = [];
  const skipped: ArtifactStageSkipReceipt[] = [];
  const pending: PreparedEntry[] = [];
  for (const entry of entries) {
    const kind = await inspectSourceEntry(entry.sourcePath, entry.entry.source);
    if (kind === undefined) {
      if (entry.entry.optional === true) {
        skipped.push({
          source: entry.entry.source,
          target: entry.entry.target,
          reason: "optional-source-missing",
        });
        continue;
      }
      throw new Error(`required artifact source is missing: ${entry.entry.source}`);
    }
    entry.kind = kind;
    pending.push(entry);
  }

  if (pending.length === 0) return { copied, skipped };

  let stagingRoot: string | undefined;
  const createdItems: CreatedItem[] = [];
  const createdDirectories: string[] = [];

  try {
    stagingRoot = await mkdtemp(join(tmpdir(), "niceeval-artifact-stage-"));
    for (const [index, entry] of pending.entries()) {
      const stagingPath = join(stagingRoot, String(index));
      await cp(entry.sourcePath, stagingPath, {
        recursive: true,
        dereference: false,
        force: false,
        errorOnExist: true,
      });
      entry.stagingPath = stagingPath;
    }

    for (const entry of pending) {
      await createDestinationParents(destinationRoot, entry.targetPath, createdDirectories);
      if (await pathExists(entry.targetPath)) {
        throw new Error(`artifact target already exists: ${entry.entry.target}`);
      }
      await commitEntryExclusively(entry, createdItems);
      copied.push({ source: entry.entry.source, target: entry.entry.target });
    }

    await rm(stagingRoot, { recursive: true, force: false });
    stagingRoot = undefined;
    return { copied, skipped };
  } catch (error) {
    const rollbackErrors = await rollbackCreated(createdItems, createdDirectories, stagingRoot);
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "artifact staging and rollback failed",
        { cause: error },
      );
    }
    throw error;
  }
}
