import { repositoryImplementationDigest } from "concord-sdlc/repository/identity";
import {
  NativeCaseReceiptSchema,
  NativeReliabilityCertificateSchema,
  evidenceSignature,
  type NativeCaseReceipt,
  type NativeReliabilityCertificate,
} from "concord-sdlc/evidence-policy";
import { decodeRepositorySourceIdentityV4, type RepositorySourceIdentityV4 } from "concord-sdlc/repository/source-identity";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Predicate, Schema } from "effect";
import { CASE_ID_PATTERN, type CaseInventoryReceipt, type CollectedCase } from "./inventory.ts";

export type EvidenceJson = null | boolean | number | string | readonly EvidenceJson[] | { readonly [key: string]: EvidenceJson };
export type EvidenceResource = Readonly<Record<string, EvidenceJson>>;
export type FormalCaseReceiptV2 = Omit<NativeCaseReceipt, "source" | "cleanup"> & {
  readonly source: RepositorySourceIdentityV4;
  readonly cleanup: { readonly ok: boolean; readonly resources: readonly EvidenceResource[] };
};
export type FormalCaseReceipt = FormalCaseReceiptV2;
export type TakeoverCertificateV2 = NativeReliabilityCertificate;
export type TakeoverCertificate = NativeReliabilityCertificate;

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (Predicate.isObject(value)) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  return JSON.stringify(value);
};
export const sha256Hex = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const sha256Sri = (digest: string): string => {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("candidate sha256 must be 64 lowercase hexadecimal characters");
  return `sha256-${Buffer.from(digest, "hex").toString("base64")}`;
};
const MANAGED_INVENTORY_ID = /^neinv_[0-9A-HJKMNP-TV-Z]{16}$/;
export const managedInventoryImplementationDigest = (root: string): string =>
  `sha256:${sha256Hex([
    repositoryImplementationDigest(),
    readFileSync(resolve(root, "concord.repository.json"), "utf8"),
    ...readdirSync(resolve(root, "packages/e2e-runner/src"))
      .filter((name) => name.endsWith(".ts"))
      .sort()
      .map((name) => `${name}\0${readFileSync(resolve(root, "packages/e2e-runner/src", name), "utf8")}`),
  ].join("\0"))}`;
const digestObject = (value: object, digestKey: string): string => sha256Hex(canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => key !== digestKey))));
const record = (value: unknown, name: string): Record<string, unknown> => {
  if (!Predicate.isObject(value) || Array.isArray(value)) throw new Error(name + " must be an object");
  return value;
};
const text = (value: unknown, name: string): string => {
  if (!Predicate.isString(value) || value.length === 0) throw new Error(name + " must be a non-empty string");
  return value;
};
const strings = (value: unknown, name: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((entry) => !Predicate.isString(entry))) throw new Error(name + " must be a string array");
  return value;
};
const exactKeys = (value: object, keys: readonly string[], name: string): void => {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(name + " has unknown or missing fields: " + actual.join(", "));
};

export const parseExactSelector = (selector: string): { readonly path: string; readonly caseId: string } => {
  const separator = selector.lastIndexOf("#"); const path = separator < 0 ? "" : selector.slice(0, separator); const caseId = separator < 0 ? "" : selector.slice(separator + 1);
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part.length === 0 || part === "." || part === "..")) throw new Error("invalid exact case selector path: " + JSON.stringify(selector));
  if (!CASE_ID_PATTERN.test(caseId)) throw new Error("invalid exact case selector id: " + JSON.stringify(caseId));
  return { path, caseId };
};
const escapePattern = (value: string): string => value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
export const exactCaseNativeArgs = (executor: "vitest" | "playwright", path: string, titlePath: readonly string[]): readonly string[] => {
  if (titlePath.length === 0 || titlePath.some((title) => title.length === 0)) throw new Error("invalid exact case title path");
  const title = escapePattern(titlePath.join(" "));
  // Keep the native file path for scenario commands that route by extension.
  // Both runners filter paths; fresh collection in the execution copy proves
  // the complete argv selects exactly one case before formal execution.
  return executor === "vitest"
    ? [path, "--testNamePattern", `^${title}$`]
    : [path, "--grep", `(?:^| )${title}$`];
};
export const validateInventoryReceipt = (input: unknown): CaseInventoryReceipt => {
  const receipt = record(input, "inventory receipt");
  exactKeys(receipt, ["executor", "repo", "argv", "checkout", "files", "cases", "unassignedCases", "bodyExecutions", "forbiddenSetupExecutions", "findings", "digest", "exit", "signal"], "inventory receipt");
  if (receipt.bodyExecutions !== 0 || receipt.forbiddenSetupExecutions !== 0 || receipt.exit !== 0 || receipt.signal !== null) throw new Error("inventory does not prove side-effect-free successful collection");
  if (!Array.isArray(receipt.findings) || receipt.findings.length !== 0) throw new Error("inventory receipt contains findings");
  const executor = record(receipt.executor, "inventory.executor"); exactKeys(executor, ["name", "version"], "inventory.executor"); if (executor.name !== "vitest" && executor.name !== "playwright") throw new Error("inventory executor is invalid"); text(executor.version, "inventory.executor.version");
  text(receipt.repo, "inventory.repo"); text(receipt.checkout, "inventory.checkout"); strings(receipt.argv, "inventory.argv"); strings(receipt.files, "inventory.files");
  if (!Array.isArray(receipt.cases)) throw new Error("inventory.cases must be an array");
  const seenCases = new Set<string>();
  for (const [index, value] of receipt.cases.entries()) { const entry = record(value, "inventory case " + index); exactKeys(entry, entry.project === undefined ? ["executor", "repo", "path", "titlePath", "caseId"] : ["executor", "repo", "path", "project", "titlePath", "caseId"], "inventory case " + index); if (entry.executor !== executor.name || entry.repo !== receipt.repo) throw new Error("inventory case executor/repo mismatch"); const selected = parseExactSelector(text(entry.path, "case.path") + "#" + text(entry.caseId, "case.caseId")); const titlePath = strings(entry.titlePath, "case.titlePath"); if (titlePath.length === 0 || !CASE_ID_PATTERN.test(selected.caseId)) throw new Error("inventory case has invalid Concord reference"); if (seenCases.has(selected.caseId)) throw new Error("inventory contains duplicate case id " + selected.caseId); seenCases.add(selected.caseId); if (!strings(receipt.files, "inventory.files").includes(selected.path)) throw new Error("inventory files omit case path " + selected.path); if (entry.project !== undefined) text(entry.project, "case.project"); }
  const expected = "sha256:" + digestObject(receipt, "digest");
  if (receipt.digest !== expected) throw new Error("inventory digest mismatch: expected " + expected);
  return input as CaseInventoryReceipt;
};

export const readManagedInventoryReceipt = (root: string, inventoryId: string, selector: string): CaseInventoryReceipt => {
  if (!MANAGED_INVENTORY_ID.test(inventoryId)) throw new Error(`${inventoryId} is not a managed inventory ID`);
  const path = resolve(root, ".repo-tools/test-inventories", `${inventoryId}.json`);
  if (!existsSync(path)) throw new Error(`${inventoryId} is unavailable; collect a fresh inventory`);
  const stored = record(JSON.parse(readFileSync(path, "utf8")) as unknown, "managed inventory");
  if (stored.inventoryId !== inventoryId || stored.implementationDigest !== managedInventoryImplementationDigest(root)) throw new Error(`${inventoryId} is stale; collect a fresh inventory`);
  const inventory = record(stored.inventory, "managed inventory body");
  const repos = Array.isArray(inventory.repos) ? inventory.repos : [];
  const parsed = parseExactSelector(selector);
  const receipts = repos.flatMap((entry) => {
    const repo = record(entry, "managed inventory repo");
    return Array.isArray(repo.receipts) ? repo.receipts : [];
  }).map(validateInventoryReceipt);
  const matches = receipts.filter((receipt) => receipt.cases.some((entry) => entry.caseId === parsed.caseId && entry.path === parsed.path));
  if (matches.length !== 1) throw new Error(`${inventoryId} does not contain exactly one receipt for ${selector}`);
  return matches[0]!;
};
export const selectInventoryCase = (receipt: CaseInventoryReceipt, selector: string, repo: string): CollectedCase => {
  const exact = parseExactSelector(selector);
  if (receipt.repo !== repo) throw new Error("inventory repo does not match takeover repo");
  const matches = receipt.cases.filter((entry) => entry.caseId === exact.caseId);
  if (matches.length !== 1) throw new Error("inventory must contain exactly one case " + exact.caseId + ", found " + matches.length);
  const selected = matches[0]!;
  if (selected.path !== exact.path) throw new Error("case selector path is stale: expected " + selected.path + "#" + selected.caseId);
  return selected;
};

export const signFormalCaseReceipt = (unsigned: Omit<FormalCaseReceiptV2, "receiptSha256">): FormalCaseReceiptV2 => {
  const source = decodeRepositorySourceIdentityV4(unsigned.source);
  const receipt = { ...unsigned, source, receiptSha256: evidenceSignature({ ...unsigned, source }) };
  const decoded = Schema.decodeUnknownSync(NativeCaseReceiptSchema, { errors: "all", onExcessProperty: "error" })(receipt);
  return { ...decoded, source, cleanup: unsigned.cleanup };
};
export const validateFormalCaseReceipt = (input: unknown): FormalCaseReceipt => {
  const receipt = Schema.decodeUnknownSync(NativeCaseReceiptSchema, { errors: "all", onExcessProperty: "error" })(input);
  const source = decodeRepositorySourceIdentityV4(receipt.source);
  const selector = parseExactSelector(receipt.selector);
  if (receipt.caseId !== selector.caseId || source.caseId !== selector.caseId || source.nativeTestFile !== selector.path) throw new Error("formal receipt source identity does not bind the selector");
  if (receipt.candidate.sri !== sha256Sri(receipt.candidate.sha256)) throw new Error("formal receipt candidate SRI does not identify its sha256 bytes");
  if (!receipt.cleanup.ok || receipt.result.signal !== null || receipt.result.timedOut || receipt.result.startupFailed) throw new Error("formal receipt records failed cleanup or abnormal termination");
  if (receipt.native.skipped !== 0 || receipt.native.retries !== 0 || receipt.native.passed + receipt.native.failed !== receipt.native.caseCount) throw new Error("formal receipt has skip, retry, or inconsistent native counts");
  if (receipt.observation === "red") {
    if (receipt.result.disposition !== "regression" || receipt.result.exitCode === null || receipt.result.exitCode <= 0 || receipt.native.failed !== 1 || receipt.native.passed !== 0) throw new Error("red receipt must record one ordinary native regression failure");
  } else if (receipt.result.disposition !== "pass" || receipt.result.exitCode !== 0 || receipt.native.failed !== 0 || receipt.native.passed !== receipt.native.caseCount) {
    throw new Error("green and reliability receipts must record successful native execution");
  }
  if (receipt.observation !== "reliability" && (receipt.native.mode !== "single" || receipt.native.caseCount !== 1 || receipt.native.parallelism !== 1 || receipt.native.sequence !== 1)) throw new Error("red and green receipts must record one selected case");
  const expected = evidenceSignature(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receiptSha256")));
  if (receipt.receiptSha256 !== expected) throw new Error("formal receipt digest mismatch: expected " + expected);
  const resources = receipt.cleanup.resources;
  const isJson = (value: unknown): value is EvidenceJson => value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) || (Array.isArray(value) && value.every(isJson)) || (Predicate.isObject(value) && !Array.isArray(value) && Object.values(value).every(isJson));
  const isEvidenceResource = (resource: Readonly<Record<string, unknown>>): resource is EvidenceResource => Object.values(resource).every(isJson);
  if (!resources.every(isEvidenceResource)) throw new Error("formal receipt cleanup resources must be JSON values");
  return { ...receipt, source, cleanup: { ...receipt.cleanup, resources } };
};
export const signTakeoverCertificate = (unsigned: Omit<TakeoverCertificateV2, "certificateSha256">): TakeoverCertificateV2 => Schema.decodeUnknownSync(
  NativeReliabilityCertificateSchema,
  { errors: "all", onExcessProperty: "error" },
)({ ...unsigned, certificateSha256: evidenceSignature(unsigned) });
export const validateTakeoverCertificate = (input: unknown, receipts: ReadonlyMap<string, FormalCaseReceipt>): TakeoverCertificate => {
  const certificate = Schema.decodeUnknownSync(NativeReliabilityCertificateSchema, { errors: "all", onExcessProperty: "error" })(input);
  const expected = evidenceSignature(Object.fromEntries(Object.entries(certificate).filter(([key]) => key !== "certificateSha256")));
  if (certificate.certificateSha256 !== expected) throw new Error("certificate digest mismatch: expected " + expected);
  const observations = certificate.observations;
  const paths = [...observations.isolatedCopies, ...observations.sameCopy, observations.defaultParallel, observations.singleCase];
  if (new Set(paths).size !== 7 || observations.cleanup.length !== 7 || new Set(observations.cleanup).size !== 7 || paths.some((path) => !observations.cleanup.includes(path))) throw new Error("certificate observations are duplicate or lack cleanup coverage");
  const validated = paths.map((path) => {
    const receipt = receipts.get(path);
    if (receipt === undefined) throw new Error("certificate references missing receipt " + path);
    return validateFormalCaseReceipt(receipt);
  });
  const baseline = validated[0]!;
  if (validated.some((receipt) => receipt.selector !== certificate.selector || receipt.caseId !== certificate.caseId || receipt.candidate.sha256 !== certificate.candidateSha256 || receipt.result.disposition !== "pass" || receipt.inventoryDigest !== baseline.inventoryDigest || canonicalJson(receipt.problem) !== canonicalJson(baseline.problem) || receipt.runner.implementationDigest !== baseline.runner.implementationDigest || canonicalJson(receipt.source) !== canonicalJson(baseline.source))) throw new Error("certificate receipts diverge from their selector, candidate, inventory, Problem, runner implementation, or source");
  if (certificate.greenReceipt !== observations.singleCase || receipts.get(observations.singleCase)!.observation !== "green" || validated.slice(0, 6).some((receipt) => receipt.observation !== "reliability")) throw new Error("certificate observations do not distinguish green from reliability receipts");
  if (certificate.sourceDigest !== decodeRepositorySourceIdentityV4(baseline.source).projection.digest) throw new Error("certificate source digest does not bind its receipts");
  const isolated = validated.slice(0, 3).map((receipt) => receipt.native);
  if (isolated.some((native) => native.mode !== "isolated" || native.sequence !== 1 || native.caseCount !== 1 || native.parallelism !== 1) || new Set(isolated.map((native) => native.copyId)).size !== 3 || new Set(isolated.map((native) => native.copyPath)).size !== 3) throw new Error("certificate isolated observations do not prove three fresh copies");
  const sameA = validated[3]!.native;
  const sameB = validated[4]!.native;
  if (sameA.mode !== "same" || sameB.mode !== "same" || sameA.copyId !== sameB.copyId || sameA.copyPath !== sameB.copyPath || sameB.sequence !== sameA.sequence + 1 || sameA.caseCount !== 1 || sameB.caseCount !== 1 || sameA.parallelism !== 1 || sameB.parallelism !== 1) throw new Error("certificate same-copy observations are not consecutive executions on one copy");
  if (validated[5]!.native.mode !== "parallel" || validated[5]!.native.parallelism < 2) throw new Error("certificate default-parallel observation lacks parallel capacity");
  if (new Set(validated.map((receipt) => receipt.invocationId)).size !== 7) throw new Error("certificate invocation identities must be unique");
  return certificate;
};
