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

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  createUnmanagedExecutionControl,
  hasConfirmedOwnedGroupCleanup,
  hasSuccessfulOwnedProcessResult,
  isExecutionCancelled,
  E2EExecutionCancelledError,
  type OwnedProcessResult,
  type E2EExecutionControl,
} from "./owned-process.ts";
import { acquireCandidatePackLock } from "./candidate-pack-lock.ts";

const PACK_FAILURE_STDERR_LIMIT = 8_192;

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

function boundedStderr(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.length === 0) return "stderr was empty";
  if (trimmed.length <= PACK_FAILURE_STDERR_LIMIT) return trimmed;
  const omitted = trimmed.length - PACK_FAILURE_STDERR_LIMIT;
  return `… ${omitted} earlier stderr character(s) omitted …\n${trimmed.slice(-PACK_FAILURE_STDERR_LIMIT)}`;
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
  options: { quiet?: boolean; control?: E2EExecutionControl } = {},
): Promise<CandidateTarball> {
  mkdirSync(destDir, { recursive: true });
  const packageRoot = join(repoRoot, "packages", "niceeval");

  const control = options.control ?? createUnmanagedExecutionControl();
  // `pnpm pack` runs package prepack and therefore writes package-local shared output.
  // Keep only that lifecycle inside the lease; all later tarball inspection and
  // all scenario execution remain invocation-local and can run concurrently.
  const packLock = await acquireCandidatePackLock(repoRoot, control);
  let packed: OwnedProcessResult;
  try {
    packed = await control.supervisor.run(["pnpm", "pack", "--pack-destination", destDir], {
      cwd: packageRoot,
      env: process.env,
      // Always retain stderr for an actionable pack failure. `stream` still
      // keeps non-quiet callers' normal lifecycle output live on the terminal.
      output: "capture",
      stream: options.quiet !== true,
      timeoutMs: 30 * 60_000,
      abortSignal: control.abortSignal,
    });
  } finally {
    await packLock.release();
  }
  if (packed.cancelled || isExecutionCancelled(control)) {
    throw new E2EExecutionCancelledError("e2e candidate packing cancelled");
  }
  if (!hasSuccessfulOwnedProcessResult(packed)) {
    throw new Error(
      `pnpm pack failed (${packed.timedOut
        ? "timed out after TERM → grace → KILL"
        : !hasConfirmedOwnedGroupCleanup(packed)
          ? packed.groupCleanup.detail
          : packed.error ?? packed.signal ?? `exit ${packed.exitCode}`}) while building the candidate niceeval tarball from ${repoRoot} — fix the build before running the e2e matrix` +
        `\n--- pnpm pack stderr (last ${PACK_FAILURE_STDERR_LIMIT} characters) ---\n${boundedStderr(packed.stderr)}`,
    );
  }

  const tgzFiles = readdirSync(destDir).filter((f) => f.endsWith(".tgz"));
  const [tgzFile] = tgzFiles;
  if (tgzFile === undefined || tgzFiles.length !== 1) {
    throw new Error(
      `expected exactly one .tgz in ${destDir} after \`pnpm pack\`, found ${tgzFiles.length}: ${JSON.stringify(tgzFiles)}`,
    );
  }

  const tarballPath = join(destDir, tgzFile);
  const candidate = readCandidateTarball(tarballPath);

  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };

  return { ...candidate, name: pkg.name, version: pkg.version };
}

/**
 * Extract the `resolution.integrity` pnpm recorded for the `niceeval@file:...`
 * package entry in a pnpm-lock.yaml. Registry-pinned historical producer
 * aliases are deliberately outside this candidate identity. Throws (does not
 * guess) unless there is exactly one local-tarball candidate entry.
 */
export function extractNiceevalIntegrity(lockfileText: string): string {
  const entryRe = /^ {2}niceeval@file:[^\n]*:\n {4}resolution:\s*\{[^}\n]*integrity:\s*(sha512-[A-Za-z0-9+/=]+)/gm;
  const matches = [...lockfileText.matchAll(entryRe)];

  if (matches.length === 0) {
    throw new Error(
      'no "niceeval@file:..." package entry with a resolution.integrity found in pnpm-lock.yaml — niceeval may not have resolved to the injected tarball at all',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `found ${matches.length} "niceeval@file:..." package entries in pnpm-lock.yaml — expected exactly one local candidate; a partial or ambiguous injection`,
    );
  }
  const integrity = matches[0]?.[1];
  if (integrity === undefined) {
    throw new Error('the local "niceeval@file:..." package entry is missing resolution.integrity');
  }
  return integrity;
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
