import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { Predicate } from "effect";

import {
  validateFormalCaseReceipt,
  validateTakeoverCertificate,
  type FormalCaseReceiptV1,
  type TakeoverCertificateV1,
} from "./case-evidence.ts";

const EVIDENCE_ROOT = ".repo-tools/test-evidence";
const RED_ID = /^nered_[0-9A-HJKMNP-TV-Z]{16}$/;
const TAKEOVER_ID = /^netake_[0-9A-HJKMNP-TV-Z]{16}$/;
const IMPLEMENTATION_FILES = [
  "packages/e2e-runner/src/case-evidence.ts",
  "packages/e2e-runner/src/managed-evidence.ts",
  "packages/e2e-runner/src/red-evidence.ts",
  "packages/e2e-runner/src/takeover.ts",
  "packages/repo-tools/src/docs/test-case/cli-runtime.ts",
] as const;
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

interface ArtifactEntry { readonly key: string; readonly file: string; readonly sha256: string }
interface ManagedEvidenceManifest {
  readonly id: string;
  readonly kind: "red" | "takeover";
  readonly implementationDigest: string;
  readonly selector: string;
  readonly inventoryDigest: string;
  readonly candidateSha256: string;
  readonly candidateFile: string;
  readonly receiptArtifacts: readonly ArtifactEntry[];
  readonly certificateArtifact?: ArtifactEntry;
}

export interface ManagedRedEvidence {
  readonly id: string;
  readonly receipt: FormalCaseReceiptV1;
  readonly candidatePath: string;
}

export interface ManagedTakeoverEvidence {
  readonly id: string;
  readonly certificate: TakeoverCertificateV1;
  readonly receipts: ReadonlyMap<string, FormalCaseReceiptV1>;
  readonly candidatePath: string;
}

const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const implementationDigest = (root: string): string => sha256(IMPLEMENTATION_FILES.map((path) => readFileSync(resolve(root, path), "utf8")).join("\0"));
const evidenceRoot = (root: string): string => resolve(root, EVIDENCE_ROOT);
const evidencePath = (root: string, id: string): string => resolve(evidenceRoot(root), id);

function newId(prefix: "nered" | "netake"): string {
  const bytes = randomBytes(10);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let token = "";
  for (let index = 0; index < 16; index += 1) { token = crockford[Number(value & 31n)]! + token; value >>= 5n; }
  return `${prefix}_${token}`;
}

function jsonBytes(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }

function publishBundle(root: string, manifest: ManagedEvidenceManifest, files: ReadonlyMap<string, string | Uint8Array>, candidatePath: string): void {
  const parent = evidenceRoot(root);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stage = join(parent, `.stage-${manifest.id}-${randomBytes(6).toString("hex")}`);
  const target = evidencePath(root, manifest.id);
  mkdirSync(stage, { mode: 0o700 });
  try {
    for (const [path, bytes] of files) {
      const destination = join(stage, path);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, bytes, { mode: 0o600, flag: "wx" });
    }
    copyFileSync(candidatePath, join(stage, manifest.candidateFile));
    writeFileSync(join(stage, "manifest.json"), jsonBytes(manifest), { mode: 0o600, flag: "wx" });
    renameSync(stage, target);
  } catch (cause) {
    rmSync(stage, { recursive: true, force: true });
    throw cause;
  }
}

function artifact(key: string, file: string, value: unknown): { readonly entry: ArtifactEntry; readonly bytes: string } {
  const bytes = jsonBytes(value);
  return { entry: { key, file, sha256: sha256(bytes) }, bytes };
}

export function saveManagedRedEvidence(root: string, receipt: FormalCaseReceiptV1, candidatePath: string): string {
  validateFormalCaseReceipt(receipt);
  if (receipt.observation !== "red" || receipt.result.disposition !== "regression") throw new Error("managed red evidence requires a formal regression receipt");
  const candidateBytes = readFileSync(candidatePath);
  if (sha256(candidateBytes) !== receipt.candidate.sha256) throw new Error("red evidence candidate bytes do not match the formal receipt");
  const id = newId("nered");
  const stored = artifact("red", "red.json", receipt);
  const manifest: ManagedEvidenceManifest = {
    id, kind: "red", implementationDigest: implementationDigest(root), selector: receipt.selector,
    inventoryDigest: receipt.inventoryDigest, candidateSha256: receipt.candidate.sha256,
    candidateFile: "candidate.tgz", receiptArtifacts: [stored.entry],
  };
  publishBundle(root, manifest, new Map([[stored.entry.file, stored.bytes]]), candidatePath);
  return id;
}

export function saveManagedTakeoverEvidence(root: string, certificate: TakeoverCertificateV1, receipts: ReadonlyMap<string, FormalCaseReceiptV1>, candidatePath: string): string {
  validateTakeoverCertificate(certificate, receipts);
  const candidateBytes = readFileSync(candidatePath);
  if (sha256(candidateBytes) !== certificate.candidateSha256) throw new Error("takeover candidate bytes do not match the certificate");
  const id = newId("netake");
  const files = new Map<string, string>();
  const entries = [...receipts].map(([key, receipt], index) => {
    const stored = artifact(key, `receipts/${String(index + 1).padStart(2, "0")}.json`, receipt);
    files.set(stored.entry.file, stored.bytes);
    return stored.entry;
  });
  const storedCertificate = artifact("certificate", "certificate.json", certificate);
  files.set(storedCertificate.entry.file, storedCertificate.bytes);
  const firstReceipt = receipts.values().next().value as FormalCaseReceiptV1 | undefined;
  if (firstReceipt === undefined) throw new Error("takeover evidence has no formal receipts");
  const manifest: ManagedEvidenceManifest = {
    id, kind: "takeover", implementationDigest: implementationDigest(root), selector: certificate.selector,
    inventoryDigest: firstReceipt.inventoryDigest, candidateSha256: certificate.candidateSha256,
    candidateFile: "candidate.tgz", receiptArtifacts: entries, certificateArtifact: storedCertificate.entry,
  };
  publishBundle(root, manifest, files, candidatePath);
  return id;
}

function readManifest(root: string, id: string, kind: "red" | "takeover"): { readonly directory: string; readonly manifest: ManagedEvidenceManifest } {
  if (!(kind === "red" ? RED_ID : TAKEOVER_ID).test(id)) throw new Error(`${id} is not a managed ${kind} evidence ID`);
  const directory = evidencePath(root, id);
  const path = join(directory, "manifest.json");
  if (!existsSync(path)) throw new Error(`${id} is unavailable; generate fresh formal evidence`);
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Predicate.isObject(value) || value.id !== id || value.kind !== kind || value.implementationDigest !== implementationDigest(root) || !Predicate.isString(value.selector) || !Predicate.isString(value.inventoryDigest) || !Predicate.isString(value.candidateSha256) || !Predicate.isString(value.candidateFile) || !Array.isArray(value.receiptArtifacts)) {
    throw new Error(`${id} is stale or invalid; generate fresh formal evidence`);
  }
  return { directory, manifest: value as unknown as ManagedEvidenceManifest };
}

function readArtifact(directory: string, entry: ArtifactEntry): unknown {
  const path = resolve(directory, entry.file);
  if (!path.startsWith(`${directory}/`)) throw new Error("managed evidence artifact escapes its bundle");
  const bytes = readFileSync(path, "utf8");
  if (sha256(bytes) !== entry.sha256) throw new Error(`managed evidence artifact failed integrity: ${entry.file}`);
  return JSON.parse(bytes) as unknown;
}

function candidatePath(directory: string, manifest: ManagedEvidenceManifest): string {
  const path = resolve(directory, manifest.candidateFile);
  if (!path.startsWith(`${directory}/`) || sha256(readFileSync(path)) !== manifest.candidateSha256) throw new Error("managed evidence candidate failed integrity");
  return path;
}

export function readManagedRedEvidence(root: string, id: string): ManagedRedEvidence {
  const { directory, manifest } = readManifest(root, id, "red");
  if (manifest.receiptArtifacts.length !== 1) throw new Error("managed red evidence must contain one receipt");
  const receipt = validateFormalCaseReceipt(readArtifact(directory, manifest.receiptArtifacts[0]!));
  if (receipt.selector !== manifest.selector || receipt.inventoryDigest !== manifest.inventoryDigest || receipt.candidate.sha256 !== manifest.candidateSha256 || receipt.observation !== "red" || receipt.result.disposition !== "regression") throw new Error("managed red evidence manifest does not bind its receipt");
  return { id, receipt, candidatePath: candidatePath(directory, manifest) };
}

export function readManagedTakeoverEvidence(root: string, id: string): ManagedTakeoverEvidence {
  const { directory, manifest } = readManifest(root, id, "takeover");
  if (manifest.certificateArtifact === undefined) throw new Error("managed takeover evidence has no certificate");
  const receipts = new Map(manifest.receiptArtifacts.map((entry) => [entry.key, validateFormalCaseReceipt(readArtifact(directory, entry))]));
  const certificate = readArtifact(directory, manifest.certificateArtifact) as TakeoverCertificateV1;
  validateTakeoverCertificate(certificate, receipts);
  if (certificate.selector !== manifest.selector || certificate.candidateSha256 !== manifest.candidateSha256 || [...receipts.values()].some((receipt) => receipt.inventoryDigest !== manifest.inventoryDigest)) throw new Error("managed takeover evidence manifest does not bind its receipts");
  return { id, certificate, receipts, candidatePath: candidatePath(directory, manifest) };
}
