// Candidate tarball fingerprint + optional pack helper + post-install injection
// verification. See docs/engineering/testing/e2e/README.md §3.2 and §5 point 4.
//
// The trust chain is entirely local and independently re-derivable:
//   1. We hash the exact candidate tarball bytes (pack.ts is the only caller
//      that creates a new candidate).
//   2. pnpm records that exact same hash as `resolution.integrity` in the
//      lockfile of whatever project installs the tarball via a `file:`
//      specifier pointing at it (verified empirically: the SRI string pnpm
//      writes is `sha512-<base64 of sha512(tarball bytes)>`, byte for byte).
//   3. So after install, we read the lockfile back and compare — never the
//      repo's own printed version/producer string.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createGunzip } from "node:zlib";
import * as tar from "tar-stream";

export interface CandidateTarball {
  /** Absolute path to the built .tgz. */
  path: string;
  /** SRI-form integrity of the tarball's own bytes: "sha512-<base64>". */
  integrity: string;
  /** Short sha256 hex, for human-readable logs only — not used for comparison. */
  shortHash: string;
  /** Full sha256 hex, independently recomputed from the candidate bytes. */
  sha256: string;
  name: string;
  version: string;
}

function runInherited(cmd: string, args: string[], cwd: string, quiet: boolean): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: quiet ? "ignore" : "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

function fingerprint(bytes: Buffer, tarballPath: string): CandidateTarball {
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    path: tarballPath,
    integrity: `sha512-${sha512}`,
    shortHash: sha256.slice(0, 12),
    sha256,
    name: "unknown",
    version: "unknown",
  };
}

/** Recompute both digests from one existing .tgz file; never invokes pnpm. */
export function readCandidateTarball(tarballPath: string): CandidateTarball {
  const resolvedPath = resolve(tarballPath);
  if (!resolvedPath.endsWith(".tgz")) {
    throw new Error(`candidate must be a .tgz file, got ${tarballPath}`);
  }
  const bytes = readFileSync(resolvedPath);
  if (bytes.length === 0) throw new Error(`candidate tarball is empty: ${resolvedPath}`);
  return fingerprint(bytes, resolvedPath);
}

/**
 * Build the current niceeval checkout into an installable tarball via
 * `pnpm pack`, once, into destDir. Returns the tarball path plus a content
 * fingerprint computed independently from the bytes on disk (not from
 * anything `pnpm pack` prints).
 */
export async function buildCandidateTarball(
  repoRoot: string,
  destDir: string,
  options: { quiet?: boolean } = {},
): Promise<CandidateTarball> {
  mkdirSync(destDir, { recursive: true });

  const code = await runInherited("pnpm", ["pack", "--pack-destination", destDir], repoRoot, options.quiet === true);
  if (code !== 0) {
    throw new Error(
      `pnpm pack failed (exit ${code}) while building the candidate niceeval tarball from ${repoRoot} — fix the build before running the e2e matrix`,
    );
  }

  const tgzFiles = readdirSync(destDir).filter((f) => f.endsWith(".tgz"));
  if (tgzFiles.length !== 1) {
    throw new Error(
      `expected exactly one .tgz in ${destDir} after \`pnpm pack\`, found ${tgzFiles.length}: ${JSON.stringify(tgzFiles)}`,
    );
  }

  const tarballPath = join(destDir, tgzFiles[0]);
  const candidate = readCandidateTarball(tarballPath);

  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };

  return { ...candidate, name: pkg.name, version: pkg.version };
}

/**
 * Extract the `resolution.integrity` pnpm recorded for the `niceeval@file:...`
 * package entry in a pnpm-lock.yaml. Throws (does not guess) if there isn't
 * exactly one such entry — zero means niceeval never resolved to a local
 * tarball at all, more than one means an ambiguous/partial injection.
 */
export function extractNiceevalIntegrity(lockfileText: string): string {
  const entryRe = /^ {2}niceeval@[^\n]*:\n {4}resolution:\s*\{[^}\n]*integrity:\s*(sha512-[A-Za-z0-9+/=]+)/gm;
  const matches = [...lockfileText.matchAll(entryRe)];

  if (matches.length === 0) {
    throw new Error(
      'no "niceeval@..." package entry with a resolution.integrity found in pnpm-lock.yaml — niceeval may not have resolved to the injected tarball at all',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `found ${matches.length} "niceeval@..." package entries in pnpm-lock.yaml — expected exactly one; a partial or ambiguous injection`,
    );
  }
  return matches[0][1];
}

export interface TestkitTarball {
  /** Absolute path to the local @niceeval/testkit .tgz. */
  path: string;
  /** SRI-form integrity of the tarball's own bytes: "sha512-<base64>". */
  integrity: string;
  /** Short sha256 hex, for human-readable logs only — not used for comparison. */
  shortHash: string;
  /** Full sha256 hex, independently recomputed from the tarball bytes. */
  sha256: string;
  /** npm package name; verified to be exactly "@niceeval/testkit". */
  name: string;
  version: string;
}

/**
 * Stream a gzipped tarball and capture only `package/package.json` — the npm
 * package identity — while discarding every other entry. The runner never
 * reads Testkit source or internal files, so Testkit's internal volume and
 * layout stay freely refactorable and never load into memory here.
 */
export async function extractPackageJsonFromTarball(tarballBytes: Buffer): Promise<Buffer | undefined> {
  return new Promise((resolvePromise, reject) => {
    let found: Buffer | undefined;
    const extract = tar.extract();
    const gunzip = createGunzip();

    extract.on("entry", (header, stream, next) => {
      if (header.name === "package/package.json") {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          found = Buffer.concat(chunks);
          next();
        });
      } else {
        stream.resume();
        stream.on("end", () => next());
      }
      stream.on("error", (err: unknown) => reject(err));
    });
    extract.on("finish", () => resolvePromise(found));
    extract.on("error", (err: unknown) => reject(err));
    gunzip.on("error", (err: unknown) => reject(err));

    gunzip.pipe(extract);
    gunzip.end(tarballBytes);
  });
}

/**
 * Read a local @niceeval/testkit tarball for explicit local injection:
 * resolvable exact path, non-empty bytes, and npm package identity checked
 * against the tarball's own `package/package.json` `name` field. Anything
 * else — wrong package name, missing package.json, non-tgz, empty bytes —
 * fails loudly instead of guessing. This never reads Testkit source or
 * internal files, so Testkit internals stay freely refactorable.
 */
export async function readTestkitTarball(tarballPath: string): Promise<TestkitTarball> {
  const resolvedPath = resolve(tarballPath);
  if (!resolvedPath.endsWith(".tgz")) {
    throw new Error(`testkit must be a .tgz file, got ${tarballPath}`);
  }
  const bytes = readFileSync(resolvedPath);
  if (bytes.length === 0) throw new Error(`testkit tarball is empty: ${resolvedPath}`);

  const packageJsonEntry = await extractPackageJsonFromTarball(bytes);
  if (packageJsonEntry === undefined) {
    throw new Error(
      `testkit tarball ${resolvedPath} has no package/package.json — cannot verify npm package identity`,
    );
  }
  let pkg: { name?: unknown; version?: unknown };
  try {
    pkg = JSON.parse(packageJsonEntry.toString("utf8")) as { name?: unknown; version?: unknown };
  } catch (err) {
    throw new Error(
      `testkit tarball ${resolvedPath} has an unreadable package/package.json: ${(err as Error).message}`,
    );
  }
  if (pkg.name !== "@niceeval/testkit") {
    throw new Error(
      `testkit tarball must contain package @niceeval/testkit, got ${JSON.stringify(pkg.name)} (${resolvedPath})`,
    );
  }
  return {
    ...fingerprint(bytes, resolvedPath),
    name: pkg.name,
    version: typeof pkg.version === "string" ? pkg.version : "unknown",
  };
}

/**
 * Extract the `resolution.integrity` pnpm recorded for the
 * `@niceeval/testkit@file:...` package entry in a pnpm-lock.yaml. Throws if
 * there isn't exactly one such entry — zero means the isolated copy never
 * resolved the local testkit tarball, more than one means an ambiguous or
 * partial injection.
 */
export function extractTestkitIntegrity(lockfileText: string): string {
  // pnpm quotes scoped file: keys in pnpm-lock.yaml ("@..." starts with the
  // YAML-reserved @), so the key may or may not be quoted.
  const entryRe = /^ {2}'?@niceeval\/testkit@[^\n]*'?:\n {4}resolution:\s*\{[^}\n]*integrity:\s*(sha512-[A-Za-z0-9+/=]+)/gm;
  const matches = [...lockfileText.matchAll(entryRe)];

  if (matches.length === 0) {
    throw new Error(
      'no "@niceeval/testkit@..." package entry with a resolution.integrity found in pnpm-lock.yaml — @niceeval/testkit may not have resolved to the injected local tarball at all',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `found ${matches.length} "@niceeval/testkit@..." package entries in pnpm-lock.yaml — expected exactly one; a partial or ambiguous injection`,
    );
  }
  return matches[0][1];
}

export type InjectionVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Compare what actually got installed (read from the isolated copy's own
 * pnpm-lock.yaml) against the candidate tarball's independently-computed
 * fingerprint. This is the only thing that gets to call a repo run's exit
 * code trustworthy — never the repo's own printed version/producer line.
 */
export function verifyInjection(lockfileText: string, expectedIntegrity: string): InjectionVerdict {
  let actual: string;
  try {
    actual = extractNiceevalIntegrity(lockfileText);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (actual !== expectedIntegrity) {
    return {
      ok: false,
      reason: `installed niceeval integrity (${actual}) does not match candidate tarball integrity (${expectedIntegrity}) — the resolved package is not the injected candidate`,
    };
  }
  return { ok: true };
}

/**
 * Same lockfile-integrity comparison for an explicitly injected local
 * @niceeval/testkit tarball. Only runs when --testkit was passed; without it
 * the repo keeps its lockfile's exact registry version and nothing changes.
 */
export function verifyTestkitInjection(lockfileText: string, expectedIntegrity: string): InjectionVerdict {
  let actual: string;
  try {
    actual = extractTestkitIntegrity(lockfileText);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (actual !== expectedIntegrity) {
    return {
      ok: false,
      reason: `installed @niceeval/testkit integrity (${actual}) does not match the local tarball integrity (${expectedIntegrity}) — the resolved testkit is not the injected tarball`,
    };
  }
  return { ok: true };
}
