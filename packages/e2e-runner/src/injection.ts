// Candidate identity and installed tarball attestation.

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";
import { Data, Effect } from "effect";
import * as FileSystem from "effect/FileSystem";

import { parsePnpmLockfile } from "./pnpm-lockfile.ts";
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
  return {
    path,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    shortHash: sha256.slice(0, 12),
    sha256,
    name: "unknown",
    version: "unknown",
  };
}

/** Recomputes candidate identity from bytes; the operation never invokes pnpm. */
export function readCandidateTarball(
  path: string,
): Effect.Effect<CandidateTarball, CandidatePackError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const resolved = resolve(path);
    if (!resolved.endsWith(".tgz"))
      return yield* Effect.fail(
        new CandidatePackError({ operation: "fingerprint", detail: `candidate must be a .tgz file, got ${path}` }),
      );
    const bytes = yield* (yield* FileSystem.FileSystem)
      .readFile(resolved)
      .pipe(Effect.mapError((error) => new CandidatePackError({ operation: "fingerprint", detail: error.message })));
    if (bytes.length === 0)
      return yield* Effect.fail(
        new CandidatePackError({ operation: "fingerprint", detail: `candidate tarball is empty: ${resolved}` }),
      );
    const candidate = fingerprint(bytes, resolved);
    const inputDigest = yield* tarballInputDigest(bytes).pipe(
      Effect.mapError((error) => new CandidatePackError({ operation: "fingerprint", detail: error.message })),
    );
    return { ...candidate, form: "tarball" as const, ...(inputDigest === undefined ? {} : { inputDigest }) };
  });
}

export function extractNiceevalIntegrity(lockfileText: string): string {
  const matches = [
    ...lockfileText.matchAll(
      /^ {2}niceeval@file:[^\n]*:\n {4}resolution:\s*\{[^}\n]*integrity:\s*(sha512-[A-Za-z0-9+/=]+)/gm,
    ),
  ];
  if (matches.length !== 1 || matches[0]?.[1] === undefined)
    throw new Error(
      matches.length === 0
        ? "no local niceeval candidate integrity found in pnpm-lock.yaml"
        : `found ${matches.length} local niceeval candidate entries; expected one`,
    );
  return matches[0][1];
}

export type InjectionVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };
export function verifyInjection(lockfileText: string, expectedIntegrity: string): InjectionVerdict {
  try {
    const actual = extractNiceevalIntegrity(lockfileText);
    return actual === expectedIntegrity
      ? { ok: true }
      : {
          ok: false,
          reason: `installed niceeval integrity (${actual}) does not match candidate tarball integrity (${expectedIntegrity})`,
        };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : "could not inspect installed candidate" };
  }
}

const effectPackages = ["effect", "@effect/platform-node", "@effect/platform-node-shared"] as const;

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

export function verifyEffectResolution(
  consumerRoot: string,
  candidateRoot: string,
  lockfileText: string,
  virtualStore: string | undefined,
): InjectionVerdict {
  try {
    const candidateManifest = join(candidateRoot, "package.json");
    const { dependencies: candidatePins = {} } = JSON.parse(readFileSync(candidateManifest, "utf8")) as PackageManifest;
    const fromCandidate = createRequire(candidateManifest);
    const consumerManifest = join(consumerRoot, "package.json");
    const consumer = JSON.parse(readFileSync(consumerManifest, "utf8")) as PackageManifest;
    const fromConsumer = createRequire(consumerManifest);
    const consumerDependencies = {
      ...consumer.dependencies,
      ...consumer.devDependencies,
      ...consumer.optionalDependencies,
      ...consumer.peerDependencies,
    };
    const resolutions = new Map<string, string>();
    for (const name of effectPackages) {
      const specifier = `${name}/package.json`;
      const path = realpathSync(fromCandidate.resolve(specifier));
      if (virtualStore !== undefined && !path.startsWith(`${virtualStore}${sep}`))
        return { ok: false, reason: `${name} resolution escapes the isolated pnpm virtual store: ${path}` };
      const installed = JSON.parse(readFileSync(path, "utf8")) as { name?: string; version?: string };
      const version = candidatePins[name];
      if (version === undefined || installed.name !== name || installed.version !== version)
        return { ok: false, reason: `${name} at ${path} does not match the candidate dependency ${name}@${version}` };

      // Directory links use the checkout's dependencies. Tarballs and their
      // consumers are installed into the same virtual store by pnpm.
      if (virtualStore !== undefined && Object.hasOwn(consumerDependencies, name)) {
        const consumerPath = realpathSync(fromConsumer.resolve(specifier));
        if (consumerPath !== path)
          return {
            ok: false,
            reason: `${name} resolves to ${path} from NiceEval and ${consumerPath} from the consumer`,
          };
      }
      resolutions.set(name, path);
    }
    for (const platform of effectPackages.slice(1)) {
      const path = resolutions.get(platform)!;
      const fromPlatform = createRequire(path);
      const dependencies =
        platform === "@effect/platform-node" ? ["effect", "@effect/platform-node-shared"] : ["effect"];
      for (const name of dependencies) {
        const resolved = realpathSync(fromPlatform.resolve(`${name}/package.json`));
        if (resolved !== resolutions.get(name))
          return {
            ok: false,
            reason: `${name} resolves to ${resolved} from ${platform} and ${resolutions.get(name)} from NiceEval`,
          };
      }
    }

    const lockfile = parsePnpmLockfile(lockfileText) as { packages?: Record<string, unknown> };
    for (const key of Object.keys(lockfile.packages ?? {})) {
      const pin = /^(effect|@effect\/[^@]+)@(.+)$/.exec(key);
      if (pin?.[1] !== undefined && pin[2] !== (candidatePins[pin[1]] ?? candidatePins.effect))
        return { ok: false, reason: `installed dependency graph contains a mismatched Effect resolution: ${key}` };
    }
    return { ok: true };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}
