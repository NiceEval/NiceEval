// External artifact collection for isolated e2e repo runs.
//
// Declared patterns are copied from the isolated copy into an independent
// artifactRoot/<repo-id>/ — never into the source repo, and never into the
// ephemeral scratchRoot that holds working copies (those are deleted).
// A declared `.niceeval` path is diagnostic evidence only: this module
// never parses those files or feeds them into a pass/fail decision.

import { basename, join, relative, resolve, sep } from "node:path";
import { lstat, readdir } from "node:fs/promises";

import {
  assertContainedRegularFile,
  assertRealDirectory as assertRealDirectoryChain,
  copyIntoContainedFile,
  ensureContainedRealDirectory,
} from "./durable-path.ts";
import { artifactPatternError, isCanonicalRelativePath } from "./manifest.ts";

function isContained(root: string, target: string, allowRoot = false): boolean {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  return (allowRoot && resolvedTarget === resolvedRoot) || resolvedTarget.startsWith(`${resolvedRoot}${sep}`);
}

function containedPath(root: string, target: string, label: string, allowRoot = false): string {
  const resolved = resolve(target);
  if (!isContained(root, resolved, allowRoot)) {
    throw new Error(`${label} escapes its containment root: ${target}`);
  }
  return resolved;
}

async function lstatOrUndefined(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Create only contained real directories; never follow a destination symlink. */
async function ensureSafeDirectory(root: string, target: string): Promise<string> {
  const rootPath = resolve(root);
  const targetPath = containedPath(rootPath, target, "artifact destination", true);
  return ensureContainedRealDirectory(rootPath, targetPath, "artifact destination");
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  await assertRealDirectoryChain(path, label);
}

async function copySafeFile(source: string, destinationRoot: string, destination: string): Promise<void> {
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`artifact source must be a regular non-symlink file: ${source}`);
  }
  const destinationPath = await copyIntoContainedFile(
    destinationRoot,
    source,
    destination,
    "artifact destination",
  );
  await assertContainedRegularFile(destinationRoot, destinationPath, "artifact destination");
}

/** Recursively copy only real directories and regular files, rejecting every source symlink. */
async function copySafeTree(
  sourceRoot: string,
  source: string,
  destinationRoot: string,
  destination: string,
): Promise<void> {
  const sourcePath = containedPath(sourceRoot, source, "artifact source", true);
  const sourceStat = await lstat(sourcePath);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`artifact directory source must be a real directory: ${sourcePath}`);
  }
  const destinationPath = await ensureSafeDirectory(destinationRoot, destination);
  const entries = await readdir(sourcePath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const childSource = containedPath(sourceRoot, join(sourcePath, entry.name), "artifact source");
    const childDestination = containedPath(destinationRoot, join(destinationPath, entry.name), "artifact destination");
    const childStat = await lstat(childSource);
    if (childStat.isSymbolicLink()) {
      throw new Error(`artifact source symlink is not allowed: ${childSource}`);
    }
    if (childStat.isDirectory()) {
      await copySafeTree(sourceRoot, childSource, destinationRoot, childDestination);
    } else if (childStat.isFile()) {
      await copySafeFile(childSource, destinationRoot, childDestination);
    } else {
      throw new Error(`artifact source special file is not allowed: ${childSource}`);
    }
  }
}

/** Per-repo directory under the durable artifactRoot (not under scratchRoot). */
export function repoArtifactDir(artifactRoot: string, repoId: string): string {
  if (!isCanonicalRelativePath(repoId)) {
    throw new Error(`repo id is not a canonical contained artifact path: ${JSON.stringify(repoId)}`);
  }
  return containedPath(artifactRoot, join(artifactRoot, repoId), "repo artifact directory");
}

/** Absolute path of the structured receipt JSON for one repo. */
export function repoReceiptPath(artifactRoot: string, repoId: string): string {
  return join(repoArtifactDir(artifactRoot, repoId), "receipt.json");
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`);
}

export interface CollectResult {
  /** Paths relative to destDir that were written. */
  collected: string[];
  warnings: string[];
}

/**
 * Copy project.json E2E `artifacts` patterns out of the isolated copy into destDir.
 * The manifest has already rejected unsafe patterns; this remains a defensive
 * second boundary for direct callers. Paths are containment checked before
 * every read/write, and source symlinks/special files are rejected rather
 * than copied into a durable upload root.
 */
export async function collectArtifacts(
  copyDir: string,
  destDir: string,
  patterns: readonly string[],
): Promise<CollectResult> {
  const collected: string[] = [];
  const warnings: string[] = [];
  const copyRoot = resolve(copyDir);
  let destinationRoot = resolve(destDir);
  await assertRealDirectory(copyRoot, "isolated artifact copy root");
  destinationRoot = await ensureSafeDirectory(destinationRoot, destinationRoot);

  for (const pattern of patterns) {
    const patternError = artifactPatternError(pattern);
    if (patternError !== undefined) {
      throw new Error(`unsafe artifact pattern ${JSON.stringify(pattern)}: ${patternError}`);
    }
    if (pattern.endsWith("/**")) {
      const dirName = pattern.slice(0, -3);
      const src = containedPath(copyRoot, join(copyRoot, dirName), "artifact source");
      if (await lstatOrUndefined(src)) {
        const dest = containedPath(destinationRoot, join(destinationRoot, dirName), "artifact destination");
        await copySafeTree(copyRoot, src, destinationRoot, dest);
        collected.push(dirName);
      }
      continue;
    }
    const regex = globToRegExp(pattern);
    const entries = await readdir(copyRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!regex.test(entry.name)) continue;
      const source = containedPath(copyRoot, join(copyRoot, entry.name), "artifact source");
      const destination = containedPath(destinationRoot, join(destinationRoot, entry.name), "artifact destination");
      const sourceStat = await lstat(source);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        throw new Error(`top-level artifact glob matched a non-regular or symlink source: ${source}`);
      }
      await copySafeFile(source, destinationRoot, destination);
      collected.push(entry.name);
    }
  }

  return { collected, warnings };
}

/** Relative path helper for logs — never used for verdict. */
export function describeCollected(destDir: string, relativePath: string): string {
  return relative(destDir, join(destDir, relativePath)) || relativePath;
}

export function isDiagnosticNiceevalPattern(pattern: string): boolean {
  const base = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
  return base === ".niceeval" || basename(base) === ".niceeval";
}
