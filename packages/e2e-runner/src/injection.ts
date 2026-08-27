// Candidate tarball identity and scoped `pnpm pack` execution.

import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { Data, Effect } from "effect";
import * as FileSystem from "effect/FileSystem";

import { acquireCandidatePackLock } from "./candidate-pack-lock.ts";
import { hasConfirmedOwnedGroupCleanup, hasSuccessfulOwnedProcessResult, runOwnedProcess } from "./owned-process.ts";

const PACK_FAILURE_STDERR_LIMIT = 8_192;

export interface CandidateTarball {
  readonly path: string;
  readonly integrity: string;
  readonly shortHash: string;
  readonly sha256: string;
  readonly name: string;
  readonly version: string;
}

export class CandidatePackError extends Data.TaggedError("CandidatePackError")<{
  readonly operation: "prepare" | "pack" | "fingerprint";
  readonly detail: string;
}> {}

function fingerprint(bytes: Uint8Array, path: string): CandidateTarball {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { path, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`, shortHash: sha256.slice(0, 12), sha256, name: "unknown", version: "unknown" };
}

/** Recomputes candidate identity from bytes; the operation never invokes pnpm. */
export function readCandidateTarball(path: string): Effect.Effect<CandidateTarball, CandidatePackError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const resolved = resolve(path);
    if (!resolved.endsWith(".tgz")) return yield* Effect.fail(new CandidatePackError({ operation: "fingerprint", detail: `candidate must be a .tgz file, got ${path}` }));
    const bytes = yield* (yield* FileSystem.FileSystem).readFile(resolved).pipe(Effect.mapError((error) => new CandidatePackError({ operation: "fingerprint", detail: error.message })));
    if (bytes.length === 0) return yield* Effect.fail(new CandidatePackError({ operation: "fingerprint", detail: `candidate tarball is empty: ${resolved}` }));
    return fingerprint(bytes, resolved);
  });
}

function boundedStderr(stderr: string): string {
  const text = stderr.trim();
  return text.length === 0 ? "stderr was empty" : text.length <= PACK_FAILURE_STDERR_LIMIT ? text : `… ${text.length - PACK_FAILURE_STDERR_LIMIT} earlier stderr character(s) omitted …\\n${text.slice(-PACK_FAILURE_STDERR_LIMIT)}`;
}

/** Builds one candidate while the Scope owns both the pack lease and command group. */
export function buildCandidateTarball(
  repoRoot: string,
  destination: string,
  options: { readonly quiet?: boolean } = {},
): Effect.Effect<CandidateTarball, CandidatePackError, import("effect").Scope.Scope | import("./owned-process.ts").OwnedProcess | FileSystem.FileSystem> {
  const packageRoot = join(repoRoot, "packages", "niceeval");
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(destination, { recursive: true }).pipe(Effect.mapError((error) => new CandidatePackError({ operation: "prepare", detail: error.message })));
    yield* acquireCandidatePackLock(repoRoot).pipe(Effect.mapError((error) => new CandidatePackError({ operation: "pack", detail: error.detail })));
    const result = yield* runOwnedProcess(["pnpm", "pack", "--pack-destination", destination], { cwd: packageRoot, env: process.env, output: "capture", stream: options.quiet !== true, timeoutMs: 30 * 60_000 }).pipe(Effect.mapError((error) => new CandidatePackError({ operation: "pack", detail: error.detail })));
    if (!hasSuccessfulOwnedProcessResult(result)) return yield* Effect.fail(new CandidatePackError({ operation: "pack", detail: `pnpm pack failed (${result.timedOut ? "timed out after TERM → grace → KILL" : !hasConfirmedOwnedGroupCleanup(result) ? result.groupCleanup.detail : result.error ?? result.signal ?? `exit ${result.exitCode}`}) while building candidate from ${repoRoot}\\n--- pnpm pack stderr (last ${PACK_FAILURE_STDERR_LIMIT} characters) ---\\n${boundedStderr(result.stderr)}` }));
    const files = yield* fs.readDirectory(destination).pipe(Effect.map((entries) => entries.filter((entry) => entry.endsWith(".tgz"))), Effect.mapError((error) => new CandidatePackError({ operation: "fingerprint", detail: error.message })));
    if (files.length !== 1 || files[0] === undefined) return yield* Effect.fail(new CandidatePackError({ operation: "fingerprint", detail: `expected exactly one .tgz in ${destination}, found ${files.length}: ${JSON.stringify(files)}` }));
    const candidate = yield* readCandidateTarball(join(destination, files[0]));
    const packageJson = yield* fs.readFileString(join(packageRoot, "package.json")).pipe(Effect.mapError((error) => new CandidatePackError({ operation: "fingerprint", detail: error.message })));
    const pkg = yield* Effect.try({ try: () => JSON.parse(packageJson) as unknown, catch: (cause) => new CandidatePackError({ operation: "fingerprint", detail: cause instanceof Error ? cause.message : "could not decode candidate package metadata" }) });
    if (pkg === null || typeof pkg !== "object" || typeof (pkg as { name?: unknown }).name !== "string" || typeof (pkg as { version?: unknown }).version !== "string") return yield* Effect.fail(new CandidatePackError({ operation: "fingerprint", detail: "candidate package.json has no valid name/version" }));
    return { ...candidate, name: (pkg as { name: string }).name, version: (pkg as { version: string }).version };
  });
}

export function extractNiceevalIntegrity(lockfileText: string): string {
  const matches = [...lockfileText.matchAll(/^ {2}niceeval@file:[^\n]*:\n {4}resolution:\s*\{[^}\n]*integrity:\s*(sha512-[A-Za-z0-9+/=]+)/gm)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) throw new Error(matches.length === 0 ? "no local niceeval candidate integrity found in pnpm-lock.yaml" : `found ${matches.length} local niceeval candidate entries; expected one`);
  return matches[0][1];
}

export type InjectionVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };
export function verifyInjection(lockfileText: string, expectedIntegrity: string): InjectionVerdict {
  try { const actual = extractNiceevalIntegrity(lockfileText); return actual === expectedIntegrity ? { ok: true } : { ok: false, reason: `installed niceeval integrity (${actual}) does not match candidate tarball integrity (${expectedIntegrity})` }; }
  catch (cause) { return { ok: false, reason: cause instanceof Error ? cause.message : "could not inspect installed candidate" }; }
}
