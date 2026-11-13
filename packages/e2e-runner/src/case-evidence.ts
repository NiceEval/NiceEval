import { bridgeBoundary, signPrivateArtifact, validatePrivateArtifact, managedImplementationDigest, decodeReliabilitySourceIdentity, sameRepositorySourceIdentity } from "./repository-evidence.ts";
import { ReceiptSchema as NativeCaseReceiptSchema, CertificateSchema as NativeReliabilityCertificateSchema, InventorySchema, type NativeCaseReceipt, type NativeReliabilityCertificate, type ReliabilitySourceIdentity } from "./bridge-wire.ts";
import { escapeTitlePattern, titlePathPattern, titleTemplate } from "./title-template.ts";
import { createHash } from "node:crypto";
import { Effect, Predicate } from "effect";
import { CASE_ID_PATTERN, type CaseInventoryReceipt, type CollectedCase } from "./inventory.ts";

export type EvidenceJson = null | boolean | number | string | readonly EvidenceJson[] | { readonly [key: string]: EvidenceJson };
export type EvidenceResource = Readonly<Record<string, EvidenceJson>>;
export type FormalCaseReceiptV2 = Omit<NativeCaseReceipt, "source" | "cleanup"> & {
  readonly source: ReliabilitySourceIdentity;
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
export const reliabilityImplementationDigest = managedImplementationDigest;
export const parseExactSelector = (selector: string): { readonly path: string; readonly caseId: string } => {
  const separator = selector.lastIndexOf("#"); const path = separator < 0 ? "" : selector.slice(0, separator); const caseId = separator < 0 ? "" : selector.slice(separator + 1);
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part.length === 0 || part === "." || part === "..")) throw new Error("invalid exact case selector path: " + JSON.stringify(selector));
  if (!CASE_ID_PATTERN.test(caseId)) throw new Error("invalid exact case selector id: " + JSON.stringify(caseId));
  return { path, caseId };
};
export const exactCaseNativeArgs = (executor: "vitest" | "playwright", path: string, titlePath: readonly string[]): readonly string[] => {
  if (titlePath.length === 0 || titlePath.some((title) => title.length === 0)) throw new Error("invalid exact case title path");
  const template = titleTemplate(titlePath.at(-1)!);
  const title = escapeTitlePattern(titlePath.join(" "));
  if (template.parameterized) return executor === "vitest"
    ? [path, "--testNamePattern", escapeTitlePattern(template.filter)]
    : [path, "--grep", `(?:^| )${titlePathPattern(titlePath).source.slice(1)}`];
  // Keep the native file path for scenario commands that route by extension.
  // Both runners filter paths; fresh collection in the execution copy proves
  // the complete argv selects exactly one declaration before formal execution.
  return executor === "vitest"
    ? [path, "--testNamePattern", `^${title}$`]
    : [path, "--grep", `(?:^| )${title}$`];
};
export const validateInventoryReceipt = Effect.fn("validateInventoryReceipt")(function* (input: unknown) {
  const receipt = yield* validatePrivateArtifact(input, "digest", InventorySchema);
  if (receipt.exit !== 0 || receipt.signal !== null || receipt.findings.length !== 0) throw new Error("inventory does not prove side-effect-free successful collection");
  if (receipt.executor.version.length === 0 || receipt.repo.length === 0 || receipt.checkout.length === 0) throw new Error("inventory identity is incomplete");
  const seen = new Set<string>();
  for (const entry of receipt.cases) {
    if (entry.executor !== receipt.executor.name || entry.repo !== receipt.repo) throw new Error("inventory case executor/repo mismatch");
    const selected = parseExactSelector(`${entry.path}#${entry.caseId}`);
    if (entry.titlePath.length === 0 || (entry.project !== undefined && entry.project.length === 0)) throw new Error("inventory case has invalid native identity");
    if (seen.has(selected.caseId)) throw new Error("inventory contains duplicate case id " + selected.caseId);
    seen.add(selected.caseId);
    if (!receipt.files.includes(selected.path)) throw new Error("inventory files omit case path " + selected.path);
  }
  return receipt;
}, bridgeBoundary);

export const selectInventoryCase = (receipt: CaseInventoryReceipt, selector: string, suiteId: string): CollectedCase => {
  const exact = parseExactSelector(selector);
  if (receipt.repo !== suiteId) throw new Error(`inventory suite ${receipt.repo} does not match selected suite ${suiteId}`);
  const matches = receipt.cases.filter((entry) => entry.caseId === exact.caseId);
  if (matches.length !== 1) throw new Error("inventory must contain exactly one case " + exact.caseId + ", found " + matches.length);
  const selected = matches[0]!;
  if (selected.path !== exact.path) throw new Error("case selector path is stale: expected " + selected.path + "#" + selected.caseId);
  return selected;
};

export const signFormalCaseReceipt = (unsigned: Omit<FormalCaseReceiptV2, "receiptSha256">) =>
  signPrivateArtifact(unsigned, "receiptSha256", NativeCaseReceiptSchema);
export const validateFormalCaseReceipt = Effect.fn("validateFormalCaseReceipt")(function* (input: unknown) {
  const receipt = yield* validatePrivateArtifact(input, "receiptSha256", NativeCaseReceiptSchema);
  const source = yield* decodeReliabilitySourceIdentity(receipt.source);
  const selector = parseExactSelector(receipt.selector);
  if (receipt.caseId !== selector.caseId || source.caseId !== selector.caseId || source.nativeTestFile !== selector.path) throw new Error("formal receipt source identity does not bind the selector");
  if (receipt.candidate.sri !== sha256Sri(receipt.candidate.sha256)) throw new Error("formal receipt candidate SRI does not identify its sha256 bytes");
  if (!receipt.cleanup.ok || receipt.result.signal !== null || receipt.result.timedOut || receipt.result.startupFailed) throw new Error("formal receipt records failed cleanup or abnormal termination");
  if (receipt.native.skipped !== 0 || receipt.native.retries !== 0 || receipt.native.passed + receipt.native.failed !== receipt.native.caseCount) throw new Error("formal receipt has skip, retry, or inconsistent native counts");
  if (receipt.observation === "red") {
    if (receipt.result.disposition !== "regression" || receipt.result.exitCode === null || receipt.result.exitCode <= 0 || receipt.native.failed < 1 || receipt.native.caseCount < 1) throw new Error("red receipt must record an ordinary native regression failure");
  } else if (receipt.result.disposition !== "pass" || receipt.result.exitCode !== 0 || receipt.native.failed !== 0 || receipt.native.passed !== receipt.native.caseCount) {
    throw new Error("green and reliability receipts must record successful native execution");
  }
  if (receipt.observation !== "reliability" && (receipt.native.mode !== "single" || receipt.native.caseCount < 1 || receipt.native.parallelism !== 1 || receipt.native.sequence !== 1)) throw new Error("red and green receipts must record one selected declaration");
  const resources = receipt.cleanup.resources;
  return { ...receipt, source, cleanup: { ...receipt.cleanup, resources } };
}, bridgeBoundary);
export const signTakeoverCertificate = (unsigned: Omit<TakeoverCertificateV2, "certificateSha256">) =>
  signPrivateArtifact(unsigned, "certificateSha256", NativeReliabilityCertificateSchema);
export const validateTakeoverCertificate = Effect.fn("validateTakeoverCertificate")(function* (input: unknown, receipts: ReadonlyMap<string, FormalCaseReceipt>) {
  const certificate = yield* validatePrivateArtifact(input, "certificateSha256", NativeReliabilityCertificateSchema);
  const observations = certificate.observations;
  const paths = [...observations.isolatedCopies, ...observations.sameCopy, observations.defaultParallel, observations.singleCase];
  if (new Set(paths).size !== 7 || observations.cleanup.length !== 7 || new Set(observations.cleanup).size !== 7 || paths.some((path) => !observations.cleanup.includes(path))) throw new Error("certificate observations are duplicate or lack cleanup coverage");
  const validated = yield* Effect.forEach(paths, (path) => Effect.gen(function* () {
    const receipt = receipts.get(path);
    if (receipt === undefined) throw new Error("certificate references missing receipt " + path);
    return yield* validateFormalCaseReceipt(receipt);
  }));
  const baseline = validated[0]!;
  if (validated.some((receipt) => receipt.selector !== certificate.selector || receipt.caseId !== certificate.caseId || receipt.candidate.sha256 !== certificate.candidateSha256 || receipt.result.disposition !== "pass" || receipt.inventoryDigest !== baseline.inventoryDigest || receipt.runner.implementationDigest !== baseline.runner.implementationDigest)) throw new Error("certificate receipts diverge from their selector, candidate, inventory, runner implementation, or source");
  for (const receipt of validated) {
    if (!(yield* sameRepositorySourceIdentity(receipt.source, baseline.source))) throw new Error("certificate receipts diverge from their complete source identity");
  }
  if (certificate.greenReceipt !== observations.singleCase || receipts.get(observations.singleCase)!.observation !== "green" || validated.slice(0, 6).some((receipt) => receipt.observation !== "reliability")) throw new Error("certificate observations do not distinguish green from reliability receipts");
  if (certificate.sourceDigest !== (yield* decodeReliabilitySourceIdentity(baseline.source)).projection.digest) throw new Error("certificate source digest does not bind its receipts");
  const isolated = validated.slice(0, 3).map((receipt) => receipt.native);
  const single = validated[6]!.native;
  const memberSet = (native: typeof single) => canonicalJson([...(native.items ?? [])].sort((a, b) => canonicalJson(a.titlePath).localeCompare(canonicalJson(b.titlePath))));
  if (validated.filter((_, index) => index !== 5).some(receipt => receipt.native.caseCount !== single.caseCount || memberSet(receipt.native) !== memberSet(single))) throw new Error("certificate selected declaration expansions differ across runs");
  if (isolated.some((native) => native.mode !== "isolated" || native.sequence !== 1 || native.caseCount < 1 || native.parallelism !== 1) || new Set(isolated.map((native) => native.copyId)).size !== 3 || new Set(isolated.map((native) => native.copyPath)).size !== 3) throw new Error("certificate isolated observations do not prove three fresh copies");
  const sameA = validated[3]!.native;
  const sameB = validated[4]!.native;
  if (sameA.mode !== "same" || sameB.mode !== "same" || sameA.copyId !== sameB.copyId || sameA.copyPath !== sameB.copyPath || sameB.sequence !== sameA.sequence + 1 || sameA.caseCount < 1 || sameB.caseCount !== sameA.caseCount || sameA.parallelism !== 1 || sameB.parallelism !== 1) throw new Error("certificate same-copy observations are not consecutive executions on one copy");
  if (validated[5]!.native.mode !== "parallel" || validated[5]!.native.parallelism < 2) throw new Error("certificate default-parallel observation lacks parallel capacity");
  if (new Set(validated.map((receipt) => receipt.invocationId)).size !== 7) throw new Error("certificate invocation identities must be unique");
  return certificate;
}, bridgeBoundary);
