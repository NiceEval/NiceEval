// Candidate tarball build + content fingerprint + post-install injection
// verification. See docs/engineering/e2e-ci/README.md §3.2 and §5 point 4.
//
// The trust chain is entirely local and independently re-derivable:
//   1. We build the tarball ourselves (`pnpm pack`) and hash its bytes.
//   2. pnpm records that exact same hash as `resolution.integrity` in the
//      lockfile of whatever project installs the tarball via a `file:`
//      specifier pointing at it (verified empirically: the SRI string pnpm
//      writes is `sha512-<base64 of sha512(tarball bytes)>`, byte for byte).
//   3. So after install, we read the lockfile back and compare — never the
//      repo's own printed version/producer string.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface CandidateTarball {
  /** Absolute path to the built .tgz. */
  path: string;
  /** SRI-form integrity of the tarball's own bytes: "sha512-<base64>". */
  integrity: string;
  /** Short sha256 hex, for human-readable logs only — not used for comparison. */
  shortHash: string;
  name: string;
  version: string;
}

function runInherited(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

/**
 * Build the current niceeval checkout into an installable tarball via
 * `pnpm pack`, once, into destDir. Returns the tarball path plus a content
 * fingerprint computed independently from the bytes on disk (not from
 * anything `pnpm pack` prints).
 */
export async function buildCandidateTarball(repoRoot: string, destDir: string): Promise<CandidateTarball> {
  mkdirSync(destDir, { recursive: true });

  const code = await runInherited("pnpm", ["pack", "--pack-destination", destDir], repoRoot);
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
  const bytes = readFileSync(tarballPath);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const shortHash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);

  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };

  return { path: tarballPath, integrity, shortHash, name: pkg.name, version: pkg.version };
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
