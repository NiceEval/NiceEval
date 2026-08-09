#!/usr/bin/env -S npx tsx
// Local, structured release receipt verification. This command never publishes
// or invokes workflow logic; it verifies that a planned grid all exercised the
// exact candidate bytes supplied to it.

import { readFile, readdir } from "node:fs/promises";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import * as tar from "tar-stream";

import { readCandidateTarball, type CandidateTarball } from "./injection.ts";

interface ReleasePlanEntry {
  id: string;
}

interface ReceiptCandidate {
  sha256?: unknown;
  integrity?: unknown;
  artifactPath?: unknown;
  exactReplay?: unknown;
}

interface ReleaseReceipt {
  repoId?: unknown;
  category?: unknown;
  candidate?: ReceiptCandidate;
}

export interface VerifyReleaseCli {
  planPath: string;
  candidatePath: string;
  receiptRoot: string;
  tag: string;
}

export function parseVerifyReleaseCli(argv: readonly string[]): VerifyReleaseCli {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      plan: { type: "string" },
      candidate: { type: "string" },
      "receipt-root": { type: "string" },
      tag: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const plan = values.plan;
  const candidate = values.candidate;
  const receiptRoot = values["receipt-root"];
  const tag = values.tag;
  if (typeof plan !== "string" || plan.length === 0) throw new Error("verify-release requires --plan");
  if (typeof candidate !== "string" || candidate.length === 0) throw new Error("verify-release requires --candidate");
  if (typeof receiptRoot !== "string" || receiptRoot.length === 0) throw new Error("verify-release requires --receipt-root");
  if (typeof tag !== "string" || tag.length === 0) throw new Error("verify-release requires --tag");
  return {
    planPath: resolve(plan),
    candidatePath: resolve(candidate),
    receiptRoot: resolve(receiptRoot),
    tag,
  };
}

async function readPlan(planPath: string): Promise<ReleasePlanEntry[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(planPath, "utf8"));
  } catch (error) {
    throw new Error(`could not parse release plan ${planPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("release plan must be a non-empty JSON array emitted by `pnpm e2e plan --lane release --json`");
  }
  const ids = new Set<string>();
  const entries: ReleasePlanEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || typeof (entry as { id?: unknown }).id !== "string") {
      throw new Error("release plan contains an entry without a string id");
    }
    const id = (entry as { id: string }).id;
    if (id.length === 0) throw new Error("release plan contains an empty repo id");
    if (ids.has(id)) throw new Error(`release plan contains duplicate repo id ${JSON.stringify(id)}`);
    ids.add(id);
    entries.push({ id });
  }
  return entries;
}

async function findReceiptFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) throw new Error(`receipt root does not exist: ${root}`);
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name === "receipt.json") {
        files.push(path);
      }
    }
  };
  await walk(root);
  return files.sort((left, right) => left.localeCompare(right));
}

async function parseReceipt(path: string): Promise<ReleaseReceipt> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("root is not an object");
    }
    return parsed as ReleaseReceipt;
  } catch (error) {
    throw new Error(`could not parse receipt ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readPackagedMetadata(candidatePath: string): Promise<{ name: string; version: string }> {
  let tarball: Buffer;
  try {
    tarball = gunzipSync(readFileSync(candidatePath));
  } catch (error) {
    throw new Error(`could not decompress candidate tarball ${candidatePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const packageJson = await new Promise<Buffer>((resolvePromise, reject) => {
    const extract = tar.extract();
    const matches: Buffer[] = [];
    extract.on("entry", (header, stream, next) => {
      if (header.type !== "file" || header.name !== "package/package.json") {
        stream.resume();
        stream.once("end", () => next());
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.once("error", reject);
      stream.once("end", () => {
        matches.push(Buffer.concat(chunks));
        next();
      });
    });
    extract.once("error", reject);
    extract.once("finish", () => {
      if (matches.length !== 1) {
        reject(new Error(`candidate tarball must contain exactly one package/package.json, found ${matches.length}`));
        return;
      }
      resolvePromise(matches[0]!);
    });
    extract.end(tarball);
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson.toString("utf8"));
  } catch (error) {
    throw new Error(`candidate package/package.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("candidate package/package.json is not an object");
  }
  const { name, version } = parsed as { name?: unknown; version?: unknown };
  if (typeof name !== "string" || name.length === 0 || typeof version !== "string" || version.length === 0) {
    throw new Error("candidate package/package.json must contain non-empty name and version strings");
  }
  return { name, version };
}

function isInside(root: string, path: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${sep}`);
}

function assertReceiptCandidate(
  receipt: ReleaseReceipt,
  receiptPath: string,
  receiptRoot: string,
  candidate: CandidateTarball,
): void {
  const identity = receipt.candidate;
  if (identity === undefined || identity === null || typeof identity !== "object") {
    throw new Error(`receipt ${receiptPath} has no candidate identity`);
  }
  if (identity.sha256 !== candidate.sha256 || identity.integrity !== candidate.integrity) {
    throw new Error(`receipt ${receiptPath} candidate digest does not match the supplied tarball`);
  }
  if (identity.exactReplay !== true || typeof identity.artifactPath !== "string" || identity.artifactPath.length === 0) {
    throw new Error(`receipt ${receiptPath} does not retain an exact candidate tarball artifact`);
  }
  const retainedPath = resolve(receiptRoot, identity.artifactPath);
  if (!isInside(receiptRoot, retainedPath) || !existsSync(retainedPath)) {
    throw new Error(`receipt ${receiptPath} candidate artifactPath is missing or escapes receipt root: ${JSON.stringify(identity.artifactPath)}`);
  }
  const retainedStat = lstatSync(retainedPath);
  if (!retainedStat.isFile() || retainedStat.isSymbolicLink()) {
    throw new Error(`receipt ${receiptPath} candidate artifactPath must be a regular non-symlink file`);
  }
  const retained = readCandidateTarball(retainedPath);
  if (retained.sha256 !== candidate.sha256 || retained.integrity !== candidate.integrity) {
    throw new Error(`receipt ${receiptPath} retained candidate tarball digest does not match the supplied tarball`);
  }
}

export interface ReleaseVerification {
  ok: true;
  planRepoIds: readonly string[];
  receiptRepoIds: readonly string[];
  candidate: { name: string; version: string; sha256: string; integrity: string };
  tag: string;
}

export async function verifyRelease(cli: VerifyReleaseCli): Promise<ReleaseVerification> {
  const plan = await readPlan(cli.planPath);
  const expectedIds = new Set(plan.map((entry) => entry.id));
  const candidate = readCandidateTarball(cli.candidatePath);
  const metadata = await readPackagedMetadata(cli.candidatePath);
  if (metadata.name !== "niceeval") {
    throw new Error(`candidate package name must be "niceeval", got ${JSON.stringify(metadata.name)}`);
  }
  if (cli.tag !== `v${metadata.version}`) {
    throw new Error(`tag ${JSON.stringify(cli.tag)} must exactly equal v${metadata.version} for candidate ${metadata.name}`);
  }

  const files = await findReceiptFiles(cli.receiptRoot);
  if (files.length === 0) throw new Error(`no receipt.json files found under ${cli.receiptRoot}`);
  const byId = new Map<string, string>();
  for (const file of files) {
    const receipt = await parseReceipt(file);
    if (typeof receipt.repoId !== "string" || receipt.repoId.length === 0) {
      throw new Error(`receipt ${file} has no non-empty repoId`);
    }
    if (byId.has(receipt.repoId)) {
      throw new Error(`duplicate receipt repoId ${JSON.stringify(receipt.repoId)} in ${byId.get(receipt.repoId)} and ${file}`);
    }
    byId.set(receipt.repoId, file);
    if (receipt.category !== "pass") {
      throw new Error(`receipt ${file} for ${receipt.repoId} is ${JSON.stringify(receipt.category)}, not "pass"`);
    }
    assertReceiptCandidate(receipt, file, cli.receiptRoot, candidate);
  }

  const actualIds = new Set(byId.keys());
  const missing = [...expectedIds].filter((id) => !actualIds.has(id));
  const extra = [...actualIds].filter((id) => !expectedIds.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `receipt repo IDs must exactly match the plan; missing=${JSON.stringify(missing.sort())} extra=${JSON.stringify(extra.sort())}`,
    );
  }

  return {
    ok: true,
    planRepoIds: [...expectedIds].sort(),
    receiptRepoIds: [...actualIds].sort(),
    candidate: { name: metadata.name, version: metadata.version, sha256: candidate.sha256, integrity: candidate.integrity },
    tag: cli.tag,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const verification = await verifyRelease(parseVerifyReleaseCli(argv));
    console.log(JSON.stringify(verification, null, 2));
  } catch (error) {
    console.error(`[e2e] release verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  void main();
}
