#!/usr/bin/env -S npx tsx
// Create exactly one candidate .tgz at the requested path and print its
// independently recomputed sha512/sha256 digests.

import { mkdtemp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

import { repoRootDir } from "./discovery.ts";
import { buildCandidateTarball, readCandidateTarball, type CandidateTarball } from "./injection.ts";
import type { E2EExecutionControl } from "./owned-process.ts";

export interface PackDependencies {
  buildCandidateTarball?: typeof buildCandidateTarball;
  readCandidateTarball?: typeof readCandidateTarball;
}

export interface PackCli {
  out: string;
}

export function parsePackCli(argv: readonly string[]): PackCli {
  const { values } = parseArgs({
    args: [...argv],
    options: { out: { type: "string" } },
    allowPositionals: false,
    strict: true,
  });
  if (typeof values.out !== "string" || values.out.length === 0) {
    throw new Error("pack requires --out <exact .tgz>");
  }
  if (!values.out.endsWith(".tgz")) {
    throw new Error(`pack --out must end with .tgz, got ${JSON.stringify(values.out)}`);
  }
  return { out: values.out };
}

/** Pack once into a private directory, then move the one resulting file exactly to out. */
export async function packCandidate(
  repoRoot: string,
  out: string,
  dependencies: PackDependencies = {},
  execution: E2EExecutionControl | undefined = undefined,
): Promise<CandidateTarball> {
  const outputPath = resolve(out);
  if (!outputPath.endsWith(".tgz")) {
    throw new Error(`pack --out must end with .tgz, got ${JSON.stringify(out)}`);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "niceeval-e2e-pack-"));
  try {
    const build = dependencies.buildCandidateTarball ?? buildCandidateTarball;
    const read = dependencies.readCandidateTarball ?? readCandidateTarball;
    const packed = await build(repoRoot, temporaryDirectory, { quiet: true, control: execution });
    const generated = (await readdir(temporaryDirectory)).filter((name) => name.endsWith(".tgz"));
    if (generated.length !== 1) {
      throw new Error(`expected exactly one generated candidate in ${temporaryDirectory}`);
    }
    await rename(join(temporaryDirectory, generated[0]), outputPath);
    const fingerprint = read(outputPath);
    return { ...fingerprint, name: packed.name, version: packed.version };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  execution: E2EExecutionControl | undefined = undefined,
): Promise<void> {
  try {
    const cli = parsePackCli(argv);
    const candidate = await packCandidate(repoRootDir(), cli.out, {}, execution);
    console.log(JSON.stringify({ path: candidate.path, sha512: candidate.integrity, sha256: candidate.sha256 }));
  } catch (error) {
    console.error(`[e2e] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
