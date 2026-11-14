// Candidate identity and installed tarball attestation.

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Data, Effect } from "effect";
import * as FileSystem from "effect/FileSystem";

import { tarballInputDigest } from "./tarball-input.ts";


export interface CandidateTarball {
  readonly form?: import("./candidate-cache.ts").CandidateForm;
  readonly inputDigest?: string;
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
    const candidate = fingerprint(bytes, resolved);
    const inputDigest = yield* tarballInputDigest(bytes).pipe(Effect.mapError((error) => new CandidatePackError({ operation: "fingerprint", detail: error.message })));
    return { ...candidate, form: "tarball" as const, ...(inputDigest === undefined ? {} : { inputDigest }) };
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
