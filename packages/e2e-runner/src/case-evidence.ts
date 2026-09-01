import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Predicate } from "effect";
import { CASE_ID_PATTERN, type CaseInventoryReceipt, type CollectedCase } from "./inventory.ts";

export interface FormalCaseReceiptV1 {
  readonly format: "niceeval.e2e-case-receipt/v1"; readonly mode: "formal";
  readonly observation: "red" | "green" | "reliability"; readonly selector: string; readonly caseId: string;
  readonly inventoryDigest: string;
  readonly candidate: { readonly gitSha: string; readonly sha256: string; readonly sri: string };
  readonly source: { readonly checkout: string; readonly testFileSha256: string; readonly sidecarSha256: string };
  readonly runner: { readonly executor: "vitest" | "playwright"; readonly version: string; readonly argv: readonly string[] };
  readonly result: { readonly disposition: "regression" | "pass"; readonly stage: string; readonly exitCode: number | null; readonly signal: string | null };
  readonly cleanup: { readonly ok: boolean; readonly resources: readonly object[] };
  readonly invocationId: string; readonly receiptSha256: string;
}
export interface TakeoverCertificateV1 {
  readonly format: "niceeval.e2e-takeover-certificate/v1"; readonly selector: string; readonly caseId: string;
  readonly candidateSha256: string; readonly greenReceipt: string;
  readonly observations: { readonly isolatedCopies: readonly [string, string, string]; readonly sameCopy: readonly [string, string]; readonly defaultParallel: string; readonly singleCase: string; readonly cleanup: readonly string[] };
  readonly certificateSha256: string;
}

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (Predicate.isObject(value)) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  return JSON.stringify(value);
};
export const sha256Hex = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const MANAGED_INVENTORY_ID = /^neinv_[0-9A-HJKMNP-TV-Z]{16}$/;
const MANAGED_INVENTORY_IMPLEMENTATION_FILES = [
  "packages/e2e-runner/src/case-evidence.ts",
  "packages/e2e-runner/src/inventory.ts",
  "packages/e2e-runner/src/workspace-inventory.ts",
] as const;
export const managedInventoryImplementationDigest = (root: string): string =>
  `sha256:${sha256Hex(MANAGED_INVENTORY_IMPLEMENTATION_FILES.map((path) => readFileSync(resolve(root, path), "utf8")).join("\0"))}`;
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
export const exactCaseNativeArgs = (executor: "vitest" | "playwright", path: string, title: string): readonly string[] => {
  const escaped = "^" + title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
  return executor === "vitest" ? [path, "--testNamePattern", escaped] : [path, "--grep", escaped];
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
  for (const [index, value] of receipt.cases.entries()) { const entry = record(value, "inventory case " + index); exactKeys(entry, entry.project === undefined ? ["executor", "repo", "path", "titlePath", "caseId"] : ["executor", "repo", "path", "project", "titlePath", "caseId"], "inventory case " + index); if (entry.executor !== executor.name || entry.repo !== receipt.repo) throw new Error("inventory case executor/repo mismatch"); const selected = parseExactSelector(text(entry.path, "case.path") + "#" + text(entry.caseId, "case.caseId")); const titlePath = strings(entry.titlePath, "case.titlePath"); if (titlePath.length === 0 || !titlePath.at(-1)!.endsWith(" [" + selected.caseId + "]")) throw new Error("inventory case title does not carry its canonical token"); if (seenCases.has(selected.caseId)) throw new Error("inventory contains duplicate case id " + selected.caseId); seenCases.add(selected.caseId); if (!strings(receipt.files, "inventory.files").includes(selected.path)) throw new Error("inventory files omit case path " + selected.path); if (entry.project !== undefined) text(entry.project, "case.project"); }
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

export const signFormalCaseReceipt = (unsigned: Omit<FormalCaseReceiptV1, "receiptSha256">): FormalCaseReceiptV1 => ({ ...unsigned, receiptSha256: digestObject(unsigned, "receiptSha256") });
export const validateFormalCaseReceipt = (input: unknown): FormalCaseReceiptV1 => {
  const receipt = record(input, "formal case receipt");
  exactKeys(receipt, ["format", "mode", "observation", "selector", "caseId", "inventoryDigest", "candidate", "source", "runner", "result", "cleanup", "invocationId", "receiptSha256"], "formal case receipt");
  if (receipt.format !== "niceeval.e2e-case-receipt/v1" || receipt.mode !== "formal") throw new Error("receipt is not formal case evidence");
  const selector = parseExactSelector(text(receipt.selector, "receipt.selector"));
  if (receipt.caseId !== selector.caseId) throw new Error("receipt selector/caseId mismatch");
  if (!/^sha256:[a-f0-9]{64}$/.test(text(receipt.inventoryDigest, "receipt.inventoryDigest"))) throw new Error("receipt inventory digest is invalid");
  if (!["red", "green", "reliability"].includes(text(receipt.observation, "receipt.observation"))) throw new Error("receipt observation is invalid");
  const candidate = record(receipt.candidate, "receipt.candidate"); exactKeys(candidate, ["gitSha", "sha256", "sri"], "receipt.candidate");
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(text(candidate.gitSha, "candidate.gitSha")) || !/^[a-f0-9]{64}$/.test(text(candidate.sha256, "candidate.sha256")) || !/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(text(candidate.sri, "candidate.sri"))) throw new Error("formal receipt candidate identity is invalid");
  const source = record(receipt.source, "receipt.source"); exactKeys(source, ["checkout", "testFileSha256", "sidecarSha256"], "receipt.source");
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(text(source.checkout, "source.checkout")) || !/^[a-f0-9]{64}$/.test(text(source.testFileSha256, "source.testFileSha256")) || !/^[a-f0-9]{64}$/.test(text(source.sidecarSha256, "source.sidecarSha256"))) throw new Error("formal receipt source identity is invalid");
  const runner = record(receipt.runner, "receipt.runner"); exactKeys(runner, ["executor", "version", "argv"], "receipt.runner");
  if (runner.executor !== "vitest" && runner.executor !== "playwright") throw new Error("formal receipt executor is invalid"); strings(runner.argv, "runner.argv"); text(runner.version, "runner.version");
  const cleanup = record(receipt.cleanup, "receipt.cleanup"); exactKeys(cleanup, ["ok", "resources"], "receipt.cleanup"); if (cleanup.ok !== true || !Array.isArray(cleanup.resources) || cleanup.resources.some((resource) => !Predicate.isObject(resource))) throw new Error("formal receipt cleanup is missing or unsuccessful");
  const result = record(receipt.result, "receipt.result"); exactKeys(result, ["disposition", "stage", "exitCode", "signal"], "receipt.result"); if (result.disposition !== "pass" && result.disposition !== "regression") throw new Error("formal receipt disposition is invalid"); text(result.stage, "result.stage"); if (result.exitCode !== null && !Predicate.isNumber(result.exitCode)) throw new Error("result.exitCode is invalid"); if (result.signal !== null && !Predicate.isString(result.signal)) throw new Error("result.signal is invalid");
  text(receipt.invocationId, "receipt.invocationId");
  const expected = digestObject(receipt, "receiptSha256"); if (receipt.receiptSha256 !== expected) throw new Error("formal receipt digest mismatch: expected " + expected);
  return input as FormalCaseReceiptV1;
};
export const signTakeoverCertificate = (unsigned: Omit<TakeoverCertificateV1, "certificateSha256">): TakeoverCertificateV1 => ({ ...unsigned, certificateSha256: digestObject(unsigned, "certificateSha256") });
export const validateTakeoverCertificate = (input: unknown, receipts: ReadonlyMap<string, FormalCaseReceiptV1>): TakeoverCertificateV1 => {
  const certificate = record(input, "takeover certificate"); exactKeys(certificate, ["format", "selector", "caseId", "candidateSha256", "greenReceipt", "observations", "certificateSha256"], "takeover certificate");
  if (certificate.format !== "niceeval.e2e-takeover-certificate/v1") throw new Error("certificate format is invalid");
  const selector = parseExactSelector(text(certificate.selector, "certificate.selector")); if (certificate.caseId !== selector.caseId) throw new Error("certificate selector/caseId mismatch");
  const observations = record(certificate.observations, "certificate.observations"); exactKeys(observations, ["isolatedCopies", "sameCopy", "defaultParallel", "singleCase", "cleanup"], "certificate observations");
  const isolated = strings(observations.isolatedCopies, "isolatedCopies"); const sameCopy = strings(observations.sameCopy, "sameCopy"); const cleanup = strings(observations.cleanup, "cleanup");
  if (isolated.length !== 3 || sameCopy.length !== 2 || cleanup.length !== 7) throw new Error("certificate observation matrix is incomplete");
  const paths = [...isolated, ...sameCopy, text(observations.defaultParallel, "defaultParallel"), text(observations.singleCase, "singleCase")];
  if (new Set(paths).size !== 7 || new Set(cleanup).size !== 7 || paths.some((path) => !cleanup.includes(path))) throw new Error("certificate observations are duplicate or lack cleanup coverage");
  let baseline: FormalCaseReceiptV1 | undefined; const invocationIds = new Set<string>();
  for (const path of paths) { const receipt = receipts.get(path); if (receipt === undefined) throw new Error("certificate references missing receipt " + path); validateFormalCaseReceipt(receipt); if (receipt.selector !== certificate.selector || receipt.caseId !== certificate.caseId || receipt.candidate.sha256 !== certificate.candidateSha256 || receipt.result.disposition !== "pass") throw new Error("certificate evidence diverges at " + path); if (invocationIds.has(receipt.invocationId)) throw new Error("certificate reuses invocation id " + receipt.invocationId); invocationIds.add(receipt.invocationId); if (baseline === undefined) baseline = receipt; else if (receipt.inventoryDigest !== baseline.inventoryDigest || canonicalJson(receipt.candidate) !== canonicalJson(baseline.candidate) || canonicalJson(receipt.source) !== canonicalJson(baseline.source) || receipt.runner.executor !== baseline.runner.executor || receipt.runner.version !== baseline.runner.version) throw new Error("certificate receipts diverge in inventory, candidate, source, or executor identity"); }
  if (certificate.greenReceipt !== observations.singleCase) throw new Error("greenReceipt must be the single-case formal green receipt");
  for (const path of paths) {
    const expectedObservation = path === observations.singleCase ? "green" : "reliability";
    if (receipts.get(path)!.observation !== expectedObservation) throw new Error("certificate receipt " + path + " must have observation=" + expectedObservation);
  }
  const expected = digestObject(certificate, "certificateSha256"); if (certificate.certificateSha256 !== expected) throw new Error("certificate digest mismatch: expected " + expected);
  return input as TakeoverCertificateV1;
};
