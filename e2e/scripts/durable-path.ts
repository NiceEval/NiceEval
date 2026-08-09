// Durable artifact-path boundary for the root E2E runner.
//
// `resolve()` only proves lexical containment. It cannot show whether a
// later write will follow a symlink. A declared durable root may live under a
// system alias such as macOS /var -> /private/var, so this module first
// resolves only that root's ancestors to a physical anchor. The declared root
// itself, and every component below it, must then be a real directory.

import { copyFile, lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

async function lstatOrUndefined(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function isContainedRelative(path: string): boolean {
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function relativeSegments(root: string, target: string, label: string, allowRoot = false): string[] {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const tail = relative(rootPath, targetPath);
  if (tail === "") {
    if (allowRoot) return [];
    throw new Error(`${label} must be below its durable root: ${target}`);
  }
  if (!isContainedRelative(tail)) throw new Error(`${label} escapes its durable root: ${target}`);
  const parts = tail.split(sep);
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error(`${label} has an invalid durable path segment: ${target}`);
  }
  return parts;
}

/** Lexical containment is necessary; durable read/write helpers also pin a physical root below. */
export function containedDurablePath(root: string, target: string, label: string, allowRoot = false): string {
  const targetPath = resolve(target);
  relativeSegments(root, targetPath, label, allowRoot);
  return targetPath;
}

function assertRealDirectoryStat(
  stat: Awaited<ReturnType<typeof lstat>>,
  path: string,
  label: string,
): void {
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symlink or special file: ${path}`);
  }
}

async function resolveExistingDurableRoot(declaredRoot: string, label: string): Promise<string> {
  const before = await lstatOrUndefined(declaredRoot);
  if (before === undefined) throw new Error(`${label} directory is missing: ${declaredRoot}`);
  // This lstat intentionally addresses the declared path. It rejects a root
  // symlink before realpath can hide it, while allowing a system-level parent
  // alias to normalize below.
  assertRealDirectoryStat(before, declaredRoot, label);
  const physicalRoot = await realpath(declaredRoot);
  const after = await lstat(physicalRoot);
  assertRealDirectoryStat(after, physicalRoot, label);
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error(`${label} changed while resolving its physical durable root: ${declaredRoot}`);
  }
  return physicalRoot;
}

async function nearestExistingAncestor(path: string): Promise<{ path: string; missing: string[] }> {
  let current = path;
  const missing: string[] = [];
  while (true) {
    if (await lstatOrUndefined(current)) return { path: current, missing };
    const parent = dirname(current);
    if (parent === current) throw new Error(`could not find an existing ancestor for durable root ${path}`);
    missing.unshift(basename(current));
    current = parent;
  }
}

async function createDeclaredDurableRoot(declaredRoot: string, label: string): Promise<string> {
  const ancestor = await nearestExistingAncestor(declaredRoot);
  const physicalAncestor = await realpath(ancestor.path);
  const ancestorStat = await lstat(physicalAncestor);
  assertRealDirectoryStat(ancestorStat, physicalAncestor, `${label} ancestor`);

  let current = physicalAncestor;
  for (const part of ancestor.missing) {
    assertRealDirectoryStat(await lstat(current), current, label);
    const next = join(current, part);
    let stat = await lstatOrUndefined(next);
    if (stat === undefined) {
      await mkdir(next);
      stat = await lstat(next);
    }
    assertRealDirectoryStat(stat, next, label);
    current = next;
  }

  // Re-check through the declared spelling. A root symlink introduced during
  // creation is rejected rather than silently becoming the trusted anchor.
  return resolveExistingDurableRoot(declaredRoot, label);
}

/**
 * Return the physical durable-root anchor. Ancestor aliases are normalized;
 * the declared root itself must exist as a real directory.
 */
async function resolveDurableRoot(root: string, label: string, createMissing: boolean): Promise<string> {
  const declaredRoot = resolve(root);
  const stat = await lstatOrUndefined(declaredRoot);
  if (stat !== undefined) return resolveExistingDurableRoot(declaredRoot, label);
  if (!createMissing) throw new Error(`${label} directory is missing: ${declaredRoot}`);
  return createDeclaredDurableRoot(declaredRoot, label);
}

async function walkBelowPhysicalRoot(
  physicalRoot: string,
  parts: readonly string[],
  createMissing: boolean,
  label: string,
): Promise<string> {
  let current = physicalRoot;
  for (const part of parts) {
    assertRealDirectoryStat(await lstat(current), current, label);
    const next = join(current, part);
    let stat = await lstatOrUndefined(next);
    if (stat === undefined && createMissing) {
      await mkdir(next);
      stat = await lstat(next);
    }
    if (stat === undefined) throw new Error(`${label} directory is missing: ${next}`);
    assertRealDirectoryStat(stat, next, label);
    current = next;
  }
  return current;
}

async function physicalTarget(
  root: string,
  target: string,
  label: string,
  allowRoot: boolean,
  createRoot: boolean,
): Promise<{ physicalRoot: string; parts: string[] }> {
  const parts = relativeSegments(root, target, label, allowRoot);
  const physicalRoot = await resolveDurableRoot(root, `${label} root`, createRoot);
  return { physicalRoot, parts };
}

/** Ensure a declared durable root exists and return its physical anchor. */
export async function ensureRealDirectory(path: string, label: string): Promise<string> {
  return resolveDurableRoot(path, label, true);
}

/** Assert a declared durable root exists and return its physical anchor. */
export async function assertRealDirectory(path: string, label: string): Promise<string> {
  return resolveDurableRoot(path, label, false);
}

/** Ensure a contained directory has no symlink at or below its physical durable root. */
export async function ensureContainedRealDirectory(root: string, target: string, label: string): Promise<string> {
  const anchored = await physicalTarget(root, target, label, true, true);
  return walkBelowPhysicalRoot(anchored.physicalRoot, anchored.parts, true, label);
}

/** Prepare a regular-file target below the physical root without following a symlink. */
export async function prepareContainedRegularFile(root: string, target: string, label: string): Promise<string> {
  const anchored = await physicalTarget(root, target, label, false, true);
  const parentParts = anchored.parts.slice(0, -1);
  const fileName = anchored.parts.at(-1);
  if (fileName === undefined) throw new Error(`${label} must name a file below its durable root`);
  const parent = await walkBelowPhysicalRoot(anchored.physicalRoot, parentParts, true, `${label} parent`);
  const physicalTargetPath = join(parent, fileName);
  const existing = await lstatOrUndefined(physicalTargetPath);
  if (existing !== undefined && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error(`${label} target is not a regular non-symlink file: ${physicalTargetPath}`);
  }
  return physicalTargetPath;
}

/** Assert an existing regular file and every directory component below the physical root. */
export async function assertContainedRegularFile(root: string, target: string, label: string): Promise<string> {
  const anchored = await physicalTarget(root, target, label, false, false);
  const parentParts = anchored.parts.slice(0, -1);
  const fileName = anchored.parts.at(-1);
  if (fileName === undefined) throw new Error(`${label} must name a file below its durable root`);
  const parent = await walkBelowPhysicalRoot(anchored.physicalRoot, parentParts, false, `${label} parent`);
  const physicalTargetPath = join(parent, fileName);
  const stat = await lstatOrUndefined(physicalTargetPath);
  if (stat === undefined || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be an existing regular non-symlink file: ${physicalTargetPath}`);
  }
  return physicalTargetPath;
}

/** Write a durable UTF-8 receipt/summary only after its full physical directory chain has been verified. */
export async function writeContainedUtf8File(root: string, target: string, contents: string, label: string): Promise<string> {
  const targetPath = await prepareContainedRegularFile(root, target, label);
  await writeFile(targetPath, contents, "utf8");
  return assertContainedRegularFile(root, target, label);
}

/** Copy one file into a verified durable target and confirm it did not become a symlink. */
export async function copyIntoContainedFile(root: string, source: string, target: string, label: string): Promise<string> {
  const targetPath = await prepareContainedRegularFile(root, target, label);
  await copyFile(source, targetPath);
  return assertContainedRegularFile(root, target, label);
}
