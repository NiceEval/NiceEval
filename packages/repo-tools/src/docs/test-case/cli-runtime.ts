import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { Effect, Option, Result } from "effect";
import { collectRepoCaseInventory, collectWorkspaceCaseInventory, managedInventoryImplementationDigest, type WorkspaceInventoryReceipt } from "@niceeval/e2e-runner/inventory";
import { REPOSITORY_ROOT } from "../runtime.js";
import { compileTrace } from "../trace/index.js";
import { testingOwnerContracts } from "../trace/compiler.js";
import { markdownAnchor, validateRepoRefTarget } from "../trace/ref.js";
import { mutateTraceFiles, traceDigest } from "../trace/relation-mutation.js";
import { planCaseMove, planCaseRelation, type CaseRelationAction } from "./planner.js";
import { parseCaseSelector, selectCurrentCase, type CaseSelector } from "./selector.js";
import { decodeCaseRelationsSidecar, encodeCaseRelationsSidecar, type CaseIssue, type CaseRelationsSidecar } from "./sidecar.js";

type Maybe<A> = Option.Option<A> | A | undefined;
interface InventoryCase { readonly executor: "vitest" | "playwright"; readonly repo: string; readonly path: string; readonly project?: string; readonly titlePath: readonly string[]; readonly caseId: `necase_${string}` }
interface InventoryReceipt { readonly checkout: string; readonly repos: readonly { readonly id: string; readonly receipts: readonly unknown[] }[]; readonly digest: string; readonly findings: readonly string[]; readonly files: readonly string[]; readonly cases: readonly InventoryCase[]; readonly unassignedCases: readonly { readonly path: string; readonly project?: string; readonly titlePath: readonly string[] }[] }
interface MutationFlags { readonly dryRun: boolean }
export interface InventoryInput { readonly repo: string; readonly checkout: string }
export interface ListCasesInput { readonly pattern: Maybe<string>; readonly history: boolean; readonly inventory: Maybe<string> }
export interface ShowCaseInput { readonly selector: string; readonly history: boolean; readonly inventory: Maybe<string> }
export interface AuditCasesInput { readonly checkout: string }
export interface AttachCaseInput extends MutationFlags { readonly selector: string; readonly owner: string; readonly inventory: string }
export interface MoveCaseInput extends MutationFlags { readonly selector: string; readonly to: string; readonly inventory: string }
export interface RetireCaseInput extends MutationFlags { readonly selector: string; readonly reason: string }
export interface CreateOwnerInput extends MutationFlags { readonly owner: string; readonly contract: string; readonly description: string }
export interface SetOwnerContractInput extends MutationFlags { readonly owner: string; readonly contract: string }
export interface RetireOwnerInput extends MutationFlags { readonly owner: string; readonly reason: string }
export interface AddRegressionInput extends MutationFlags { readonly selector: string; readonly memory: string; readonly red: string; readonly green: string; readonly certificate: string; readonly inventory: string }
export interface RetireRegressionInput extends MutationFlags { readonly selector: string; readonly memory: string; readonly reason: string }
export interface AddIssueInput extends MutationFlags { readonly selector: string; readonly url: string; readonly provenance: "direct"; readonly verificationReceipt: Maybe<string> }
export interface RetireIssueInput extends MutationFlags { readonly selector: string; readonly url: string; readonly reason: string }

export class CaseCliError extends Error { readonly name = "CaseCliError"; constructor(readonly code: string, message: string) { super(message); } }
const optional = <A>(value: Maybe<A>): A | undefined => Option.isOption(value) ? Option.getOrUndefined(value) : value;
const sha = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const fail = (code: string, message: string): never => { throw new CaseCliError(code, message); };
const detail = (cause: unknown): string => typeof cause === "object" && cause !== null && "detail" in cause && typeof cause.detail === "string" ? cause.detail : cause instanceof Error ? cause.message : String(cause);
const sidecarPath = (testPath: string): string => `${testPath}.cases.json`;
const evidencePath = (testPath: string): string => `${testPath}.cases.evidence.json`;
const absolute = (path: string): string => resolve(REPOSITORY_ROOT, path);
const read = (path: string): string => readFileSync(absolute(path), "utf8");
const emptySidecar = (testFile: string): CaseRelationsSidecar => ({ format: "niceeval.e2e-case-relations/v1", testFile, current: {}, history: [], tombstones: [] });
const decodeSidecar = (path: string, allowAbsent = false): CaseRelationsSidecar => {
  if (!existsSync(absolute(path))) { if (allowAbsent) return emptySidecar(path.slice(0, -".cases.json".length)); return fail("CaseNotCurrent", `sidecar is missing: ${path}`); }
  const decoded = decodeCaseRelationsSidecar(path, read(path));
  return Result.isSuccess(decoded) ? decoded.success : fail(decoded.failure._tag, `${decoded.failure.path}: ${decoded.failure.message}`);
};
const selector = (text: string): CaseSelector => { const parsed = parseCaseSelector(text); return Result.isSuccess(parsed) ? parsed.success : fail(parsed.failure._tag, `invalid case selector: ${text}`); };

const INVENTORY_ROOT = resolve(REPOSITORY_ROOT, ".repo-tools/test-inventories");
const INVENTORY_ID = /^neinv_[0-9A-HJKMNP-TV-Z]{16}$/;
interface StoredInventory { readonly inventoryId: string; readonly implementationDigest: string; readonly inventory: InventoryReceipt }

function inventoryImplementationDigest(): string {
  return managedInventoryImplementationDigest(REPOSITORY_ROOT);
}
function decodeInventory(value: Partial<InventoryReceipt> & Record<string, unknown>, source: string): InventoryReceipt {
  if (typeof value.checkout !== "string" || !Array.isArray(value.repos) || !Array.isArray(value.files) || !Array.isArray(value.cases) || !Array.isArray(value.unassignedCases) || !Array.isArray(value.findings) || typeof value.digest !== "string") fail("InventoryInvalid", `${source} is not a current managed inventory`);
  if (value.findings!.length > 0) fail("InventoryInvalid", `inventory has findings: ${value.findings!.join("; ")}`);
  const { digest, ...unsigned } = value;
  const actualDigest = sha(canonicalJson(unsigned));
  if (digest !== actualDigest) fail("InventoryInvalid", `${source} failed its integrity check; collect a fresh inventory`);
  return value as InventoryReceipt;
}
function inventoryFile(inventoryId: string): string {
  if (!INVENTORY_ID.test(inventoryId)) fail("InventoryInvalid", `${inventoryId} is not a managed inventory ID`);
  return resolve(INVENTORY_ROOT, `${inventoryId}.json`);
}
function parseInventory(inventoryId: string): InventoryReceipt {
  const path = inventoryFile(inventoryId);
  if (!existsSync(path)) fail("InventoryNotFound", `${inventoryId} is unavailable; collect a fresh inventory`);
  let stored: StoredInventory;
  try { stored = JSON.parse(readFileSync(path, "utf8")) as StoredInventory; }
  catch { return fail("InventoryInvalid", `${inventoryId} is unreadable; collect a fresh inventory`); }
  if (stored.inventoryId !== inventoryId || stored.implementationDigest !== inventoryImplementationDigest()) {
    fail("InventoryStale", `${inventoryId} was produced by a different implementation; collect a fresh inventory`);
  }
  return decodeInventory(stored.inventory as Partial<InventoryReceipt> & Record<string, unknown>, inventoryId);
}
function saveInventory(inventory: InventoryReceipt): string {
  const inventoryId = newCaseId(new Set()).replace("necase_", "neinv_");
  mkdirSync(INVENTORY_ROOT, { recursive: true, mode: 0o700 });
  writeFileSync(inventoryFile(inventoryId), `${JSON.stringify({ inventoryId, implementationDigest: inventoryImplementationDigest(), inventory })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return inventoryId;
}
const collectInventory = Effect.fn("collectInventory")(function*(action: InventoryInput) {
  const checkout = yield* Effect.try({
    try: () => execFileSync("git", ["rev-parse", action.checkout], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim(),
    catch: (cause) => new CaseCliError("InventoryCheckoutInvalid", detail(cause)),
  });
  return yield* Effect.scoped(collectRepoCaseInventory(action.repo, checkout)).pipe(
    Effect.mapError((cause) => new CaseCliError("InventoryCollectionFailed", detail(cause))),
    Effect.map((inventory) => inventory as InventoryReceipt),
  );
});
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function newCaseId(used: Set<string>): `necase_${string}` {
  for (;;) {
    const bytes = randomBytes(10);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    let token = "";
    for (let index = 0; index < 16; index += 1) { token = crockford[Number(value & 31n)]! + token; value >>= 5n; }
    const caseId = `necase_${token}` as const;
    if (!used.has(caseId)) { used.add(caseId); return caseId; }
  }
}
function sidecarFiles(): readonly string[] {
  let output: string;
  try { output = execFileSync("rg", ["--files", "-g", "*.cases.json"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim(); }
  catch (cause) { const status = typeof cause === "object" && cause !== null && "status" in cause ? cause.status : undefined; if (status === 1) return []; throw cause; }
  return output === "" ? [] : output.split("\n").sort();
}
function reservedCaseIds(): Set<string> {
  const ids = new Set<string>();
  for (const path of sidecarFiles()) {
    const sidecar = decodeSidecar(path);
    for (const id of Object.keys(sidecar.current)) ids.add(id);
    for (const entry of sidecar.history) ids.add(entry.caseId);
    for (const entry of sidecar.tombstones) ids.add(entry.caseId);
  }
  let sourceTokens = "";
  try {
    sourceTokens = execFileSync("rg", ["--only-matching", "--no-filename", "necase_[0-9A-HJKMNP-TV-Z]{16}", "e2e"], { cwd: REPOSITORY_ROOT, encoding: "utf8" });
  } catch (cause) {
    const status = typeof cause === "object" && cause !== null && "status" in cause ? cause.status : undefined;
    if (status !== 1) throw cause;
  }
  for (const id of sourceTokens.trim().split("\n")) if (id !== "") ids.add(id);
  return ids;
}
export const allocateCaseId = Effect.fn("allocateCaseId")(function*() {
  return { caseId: newCaseId(reservedCaseIds()) };
});
function inventoryForId(id: Maybe<string>): InventoryReceipt | undefined { const value = optional(id); return value === undefined ? undefined : parseInventory(value); }
function records(history: boolean, inventory?: InventoryReceipt) {
  const collected = new Map(inventory?.cases.map((item) => [`${item.path}#${item.caseId}`, item]));
  return sidecarFiles().flatMap((path) => { const sidecar = decodeSidecar(path); const digest = traceDigest(read(path)); return [
    ...Object.entries(sidecar.current).map(([caseId, relation]) => {
      const evidenceFile = evidencePath(sidecar.testFile);
      const evidence = existsSync(absolute(evidenceFile)) ? JSON.parse(read(evidenceFile)) as { current?: Record<string, unknown> } : undefined;
      return { selector: `${sidecar.testFile}#${caseId}`, sidecar: path, digest, relation, evidence: evidence?.current?.[caseId] ?? {}, collected: collected?.get(`${sidecar.testFile}#${caseId}`) ?? null };
    }),
    ...(history ? sidecar.tombstones.map((entry) => ({ selector: entry.lastSelector, sidecar: path, digest, tombstone: entry })) : []),
  ]; });
}

function reconcileInventory(inventory: InventoryReceipt) {
  const inventoriedFiles = new Set(inventory.files);
  const current = records(false, inventory).filter((item) => inventoriedFiles.has(item.selector.slice(0, item.selector.lastIndexOf("#"))));
  const collected = new Map(inventory.cases.map((item) => [`${item.path}#${item.caseId}`, item]));
  const related = new Map(current.map((item) => [item.selector, item]));
  const findings = [
    ...inventory.cases.filter((item) => !related.has(`${item.path}#${item.caseId}`)).map((item) => ({ code: "MissingRelation", selector: `${item.path}#${item.caseId}` })),
    ...current.filter((item) => !collected.has(item.selector)).map((item) => ({ code: "CaseNotCollected", selector: item.selector })),
  ];
  const ids = new Map<string, string[]>();
  for (const item of inventory.cases) ids.set(item.caseId, [...(ids.get(item.caseId) ?? []), item.path]);
  findings.push(...[...ids].filter(([, paths]) => paths.length > 1).map(([caseId, paths]) => ({ code: "DuplicateCaseId", selector: `${caseId}: ${paths.join(", ")}` })));
  return { format: "niceeval.e2e-case-inventory-reconciliation/v1", inventory, cases: current, findings };
}

interface PlannedChange { readonly path: string; readonly bytes: string; readonly mode?: number; readonly expectedDigest: string | null }
function transactionReceipt(operation: string, dryRun: boolean, changes: readonly PlannedChange[], value: unknown) {
  return { format: "niceeval.e2e-case-command/v1", operation, dryRun, transactionId: `netxn_plan_${randomUUID().replaceAll("-", "")}`, generationBefore: null, generationAfter: null, subject: value, preimages: changes.map((c) => ({ path: c.path, digest: c.expectedDigest })), plannedDigests: changes.map((c) => ({ path: c.path, digest: traceDigest(c.bytes) })), findings: [], committed: false };
}
function publish(operation: string, dryRun: boolean, changes: readonly PlannedChange[], value: unknown): Effect.Effect<unknown, unknown> {
  const planned = transactionReceipt(operation, dryRun, changes, value);
  if (dryRun) return Effect.succeed(planned);
  return mutateTraceFiles({ root: REPOSITORY_ROOT, operation, changes }).pipe(Effect.map((receipt) => ({ ...planned, transactionId: receipt.transactionId, generationBefore: receipt.generationBefore, generationAfter: receipt.generationAfter, preimages: receipt.preimages, plannedDigests: receipt.plannedDigests, committed: true })));
}
function assertExpected(path: string, expected: Maybe<string>): string | null {
  const actual = existsSync(absolute(path)) ? traceDigest(read(path)) : null;
  const supplied = optional(expected);
  if (supplied !== undefined && supplied !== actual) fail("PreimageChanged", `expected digest for ${path} is stale (current ${actual ?? "absent"})`);
  return actual;
}
function audit() { return { atCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim(), transactionId: `netxn_${randomUUID().replaceAll("-", "")}` }; }
function planOne(action: CaseRelationAction, expected: Maybe<string>, operation: string, dryRun: boolean) {
  const path = sidecarPath(action.selector.path); const before = decodeSidecar(path, action._tag === "AttachCase"); const digest = assertExpected(path, expected);
  const planned = planCaseRelation(before, action, audit());
  if (Result.isFailure(planned)) fail(planned.failure._tag, JSON.stringify(planned.failure));
  const next = Result.match(planned, { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value });
  return publish(operation, dryRun, [{ path, bytes: encodeCaseRelationsSidecar(next), expectedDigest: digest }], `${action.selector.path}#${action.selector.caseId}`);
}
function validateOpenProblem(memory: string) { return compileTrace(REPOSITORY_ROOT).pipe(Effect.map((snapshot) => { const item = snapshot.memory.find((entry) => entry.path === memory); if (item?.kind !== "problem" || item.state !== "open") fail("RegressionTargetInvalid", `${memory} must be an open structured Problem Memory`); })); }
function validateRetirableProblem(memory: string) { return compileTrace(REPOSITORY_ROOT).pipe(Effect.map((snapshot) => { const item = snapshot.memory.find((entry) => entry.path === memory); if (item?.kind === "problem" && item.state === "resolved") fail("RegressionRequiresReopen", `${memory} is resolved; reopen it before retiring the regression`); })); }
function validateOwner(owner: string) {
  return compileTrace(REPOSITORY_ROOT).pipe(Effect.map((snapshot) => {
    const declared = snapshot.owners.find((item) => item.ref === owner);
    if (declared === undefined) fail("OwnerCardinality", `${owner} is not an exact declared testing owner`);
    // compileTrace validates each declared owner's exact target as a Feature or
    // leaf Use Case before exposing it in snapshot.owners.
  }));
}

interface FormalReceipt {
  readonly format: "niceeval.e2e-case-receipt/v1";
  readonly mode: "formal";
  readonly observation: "red" | "green" | "reliability";
  readonly selector: string;
  readonly caseId: string;
  readonly inventoryDigest: string;
  readonly candidate: { readonly sha256: string };
  readonly source: { readonly testFileSha256: string; readonly sidecarSha256: string };
  readonly result: { readonly disposition: "regression" | "pass" };
  readonly cleanup: { readonly ok: boolean };
  readonly invocationId: string;
  readonly receiptSha256: string;
}

function verifiedJsonDigest(path: string, digestField: string): Record<string, unknown> {
  const document = JSON.parse(readFileSync(resolve(path), "utf8")) as Record<string, unknown>;
  const declared = document[digestField];
  const unsigned = { ...document };
  delete unsigned[digestField];
  const actual = sha(canonicalJson(unsigned));
  if (declared !== actual) fail("EvidenceMismatch", `${path} has invalid ${digestField}; expected ${actual}`);
  return document;
}

function formalReceipt(path: string, expected: { selector: string; inventoryDigest: string }): FormalReceipt {
  const receipt = verifiedJsonDigest(path, "receiptSha256") as unknown as FormalReceipt;
  if (receipt.format !== "niceeval.e2e-case-receipt/v1" || receipt.mode !== "formal") fail("EvidenceMismatch", `${path} is not a formal case receipt`);
  if (receipt.selector !== expected.selector || receipt.caseId !== expected.selector.slice(expected.selector.lastIndexOf("#") + 1)) fail("EvidenceMismatch", `${path} does not bind ${expected.selector}`);
  if (receipt.inventoryDigest !== expected.inventoryDigest) fail("EvidenceMismatch", `${path} does not bind inventory ${expected.inventoryDigest}`);
  if (receipt.cleanup?.ok !== true || typeof receipt.invocationId !== "string" || receipt.invocationId.length === 0) fail("EvidenceMismatch", `${path} lacks successful cleanup or invocation identity`);
  return receipt;
}

function containedEvidenceSource(path: string): string {
  const candidate = resolve(path);
  const root = realpathSync(REPOSITORY_ROOT);
  const real = realpathSync(candidate);
  if (real !== candidate || !real.startsWith(`${root}/`) || lstatSync(candidate).isSymbolicLink() || !lstatSync(candidate).isFile()) fail("EvidenceMismatch", `${path} must be a real regular file contained by this checkout`);
  return real;
}

function validateRegressionEvidence(action: AddRegressionInput) {
  for (const path of [action.red, action.green, action.certificate]) containedEvidenceSource(path);
  const inventory = parseInventory(action.inventory);
  if (!inventory.cases.some((item) => `${item.path}#${item.caseId}` === action.selector)) fail("CaseNotCollected", action.selector);
  const red = formalReceipt(action.red, { selector: action.selector, inventoryDigest: inventory.digest });
  const green = formalReceipt(action.green, { selector: action.selector, inventoryDigest: inventory.digest });
  if (red.observation !== "red" || red.result.disposition !== "regression") fail("EvidenceMismatch", "red receipt must be a formal regression observation");
  if (green.observation !== "green" || green.result.disposition !== "pass") fail("EvidenceMismatch", "green receipt must be a formal passing observation");
  const certificate = verifiedJsonDigest(action.certificate, "certificateSha256");
  if (certificate.format !== "niceeval.e2e-takeover-certificate/v1" || certificate.selector !== action.selector || certificate.caseId !== green.caseId || certificate.candidateSha256 !== green.candidate.sha256 || certificate.greenReceipt !== action.green) fail("EvidenceMismatch", "takeover certificate does not bind the green receipt, selector, and candidate");
  const observations = certificate.observations as { isolatedCopies?: unknown; sameCopy?: unknown; defaultParallel?: unknown; singleCase?: unknown; cleanup?: unknown } | undefined;
  const paths = [...(Array.isArray(observations?.isolatedCopies) ? observations.isolatedCopies : []), ...(Array.isArray(observations?.sameCopy) ? observations.sameCopy : []), observations?.defaultParallel, observations?.singleCase].filter((item): item is string => typeof item === "string");
  if (paths.length !== 7 || !Array.isArray(observations?.cleanup) || observations.cleanup.length === 0) fail("EvidenceMismatch", "takeover certificate is missing the complete observation matrix");
  for (const path of paths) containedEvidenceSource(path);
  const reliability = paths.map((path) => formalReceipt(path, { selector: action.selector, inventoryDigest: inventory.digest }));
  if (reliability.some((item) => item.observation !== "reliability" || item.result.disposition !== "pass" || item.candidate.sha256 !== green.candidate.sha256)) fail("EvidenceMismatch", "takeover observations do not all pass on the green candidate");
  if (new Set([red.invocationId, green.invocationId, ...reliability.map((item) => item.invocationId)]).size !== reliability.length + 2) fail("EvidenceMismatch", "formal evidence reuses an invocation ID");
  return { inventory, red, green, certificate, reliabilityPaths: paths };
}

function addRegression(action: AddRegressionInput, parsed: CaseSelector) {
  const verified = validateRegressionEvidence(action);
  return validateOpenProblem(action.memory).pipe(Effect.andThen(Effect.suspend(() => {
    const relationPath = sidecarPath(parsed.path);
    const before = decodeSidecar(relationPath);
    const relationDigest = assertExpected(relationPath, undefined);
    const planned = planCaseRelation(before, { _tag: "AddRegression", selector: parsed, memory: action.memory }, audit());
    const next = Result.match(planned, { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value });
    const indexPath = evidencePath(parsed.path);
    const indexDigest = assertExpected(indexPath, undefined);
    const index = existsSync(absolute(indexPath))
      ? JSON.parse(read(indexPath)) as { format: string; current: Record<string, Record<string, unknown>> }
      : { format: "niceeval.e2e-case-evidence-index/v1", current: {} };
    if (index.format !== "niceeval.e2e-case-evidence-index/v1") fail("EvidenceMismatch", `${indexPath} has an unknown format`);
    const currentCase = index.current[parsed.caseId] ?? {};
    const evidenceRoot = `${parsed.path}.case-evidence/${parsed.caseId}/${action.memory.replaceAll("/", "_")}`;
    const inventoryEvidencePath = `${evidenceRoot}/inventory.json`;
    const copied = [
      { source: action.red, path: `${evidenceRoot}/red.json` },
      { source: action.green, path: `${evidenceRoot}/green.json` },
      ...verified.reliabilityPaths.map((source, index) => ({ source, path: `${evidenceRoot}/reliability-${index + 1}.json` })),
    ];
    const pathMap = new Map(copied.map((item) => [item.source, item.path]));
    const normalizedCertificateUnsigned: Record<string, unknown> = {
      ...(verified.certificate as Record<string, unknown>),
      greenReceipt: pathMap.get(action.green),
      observations: {
        isolatedCopies: verified.reliabilityPaths.slice(0, 3).map((path) => pathMap.get(path)),
        sameCopy: verified.reliabilityPaths.slice(3, 5).map((path) => pathMap.get(path)),
        defaultParallel: pathMap.get(verified.reliabilityPaths[5]!),
        singleCase: pathMap.get(verified.reliabilityPaths[6]!),
        cleanup: (verified.certificate.observations as { cleanup: unknown }).cleanup,
      },
    };
    delete normalizedCertificateUnsigned.certificateSha256;
    const normalizedCertificate = { ...normalizedCertificateUnsigned, certificateSha256: sha(canonicalJson(normalizedCertificateUnsigned)) };
    const certificatePath = `${evidenceRoot}/certificate.json`;
    const evidence = {
      red: { path: pathMap.get(action.red)!, digest: traceDigest(readFileSync(resolve(action.red))) },
      green: { path: pathMap.get(action.green)!, digest: traceDigest(readFileSync(resolve(action.green))) },
      certificate: { path: certificatePath, digest: traceDigest(`${JSON.stringify(normalizedCertificate, null, 2)}\n`) },
      inventory: { path: inventoryEvidencePath, digest: verified.inventory.digest },
    };
    const nextIndex = { ...index, current: { ...index.current, [parsed.caseId]: { ...currentCase, [action.memory]: evidence } } };
    return publish("test-regression-add", action.dryRun, [
      { path: relationPath, bytes: encodeCaseRelationsSidecar(next), expectedDigest: relationDigest },
      { path: indexPath, bytes: `${JSON.stringify(nextIndex, null, 2)}\n`, expectedDigest: indexDigest },
      { path: inventoryEvidencePath, bytes: `${JSON.stringify(verified.inventory, null, 2)}\n`, expectedDigest: null },
      ...copied.map((item) => ({ path: item.path, bytes: readFileSync(resolve(item.source), "utf8"), expectedDigest: null })),
      { path: certificatePath, bytes: `${JSON.stringify(normalizedCertificate, null, 2)}\n`, expectedDigest: null },
    ], action.selector);
  })));
}

function retireRegression(action: RetireRegressionInput, parsed: CaseSelector) {
  return validateRetirableProblem(action.memory).pipe(Effect.andThen(Effect.suspend(() => {
    const relationPath = sidecarPath(parsed.path);
    const before = decodeSidecar(relationPath);
    const relationDigest = assertExpected(relationPath, undefined);
    const planned = planCaseRelation(before, { _tag: "RetireRegression", selector: parsed, memory: action.memory, reason: action.reason }, audit());
    const next = Result.match(planned, { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value });
    const indexPath = evidencePath(parsed.path);
    const indexDigest = assertExpected(indexPath, undefined);
    const index = JSON.parse(read(indexPath)) as { format: string; current: Record<string, Record<string, unknown>>; history?: readonly unknown[] };
    const evidence = index.current[parsed.caseId]?.[action.memory];
    if (evidence === undefined) fail("EvidenceMismatch", `current evidence for ${action.memory} is missing`);
    const currentCase = { ...(index.current[parsed.caseId] ?? {}) };
    delete currentCase[action.memory];
    const nextIndex = {
      ...index,
      current: { ...index.current, [parsed.caseId]: currentCase },
      history: [...(index.history ?? []), { caseId: parsed.caseId, memory: action.memory, evidence, reason: action.reason, retiredAtCommit: audit().atCommit }],
    };
    return publish("test-regression-retire", action.dryRun, [
      { path: relationPath, bytes: encodeCaseRelationsSidecar(next), expectedDigest: relationDigest },
      { path: indexPath, bytes: `${JSON.stringify(nextIndex, null, 2)}\n`, expectedDigest: indexDigest },
    ], action.selector);
  })));
}

function verifyIssue(url: string, selectorText: string, injected: Maybe<string>): CaseIssue {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/([1-9][0-9]*)$/u.exec(url);
  if (match === null) return fail("IssueVerificationFailed", "Issue URL must be canonical https://github.com/owner/repo/issues/N");
  const repository = `github.com/${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}`; const number = Number(match[3]);
  const receiptPath = optional(injected);
  let document: Record<string, unknown>;
  if (receiptPath !== undefined) {
    if (process.env.NICEEVAL_TEST_CASE_ALLOW_VERIFIED_RECEIPT !== "1") return fail("IssueVerificationFailed", "injected verification receipts are disabled outside an explicit isolated fixture");
    document = JSON.parse(readFileSync(resolve(receiptPath), "utf8")) as Record<string, unknown>;
  }
  else {
    let remote: string; try { remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim(); } catch { return fail("IssueVerificationFailed", "cannot determine the canonical repository; refusing offline verification"); }
    const remoteMatch = /(?:github\.com[/:])([^/]+)\/([^/.]+)(?:\.git)?$/u.exec(remote);
    if (remoteMatch === null || `github.com/${remoteMatch[1]!.toLowerCase()}/${remoteMatch[2]!.toLowerCase()}` !== repository) return fail("IssueVerificationFailed", "Issue is not in this checkout's canonical repository");
    try { document = JSON.parse(execFileSync("gh", ["api", `repos/${match[1]}/${match[2]}/issues/${number}`], { cwd: REPOSITORY_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as Record<string, unknown>; }
    catch { return fail("IssueVerificationFailed", "GitHub read-only verification is unavailable; refusing local publication"); }
  }
  if (document.format === "niceeval.test-case-issue-verification/v1" && (document.selector !== selectorText || document.url !== url)) return fail("IssueVerificationFailed", "injected verification receipt does not bind this selector and URL");
  if (document.pull_request !== undefined || document.isPullRequest === true) return fail("IssueVerificationFailed", "target is a Pull Request, not an Issue");
  const body = typeof document.body === "string" ? document.body : ""; if (!body.includes(selectorText)) return fail("IssueVerificationFailed", "Issue body does not contain direct provenance for the exact selector");
  const nodeId = typeof document.node_id === "string" ? document.node_id : typeof document.nodeId === "string" ? document.nodeId : "";
  const title = typeof document.title === "string" ? document.title : ""; if (nodeId === "" || title === "") return fail("IssueVerificationFailed", "Issue identity receipt is incomplete");
  return { repository, number, url, nodeId, titleDigest: sha(title), checkedAt: new Date().toISOString(), provenance: "direct" };
}

function moveCaseMutation(action: MoveCaseInput) {
  const parsed = selector(action.selector);
  const inventory = parseInventory(action.inventory);
  if (inventory.cases.some((item) => item.caseId === parsed.caseId && item.path === parsed.path)) fail("CaseStillCollected", `${action.selector} remains collected at the old path`);
  if (!inventory.cases.some((item) => item.caseId === parsed.caseId && item.path === action.to)) fail("CaseNotCollected", `${action.to}#${parsed.caseId}`);
  const sourcePath = sidecarPath(parsed.path);
  const targetPath = sidecarPath(action.to);
  const source = decodeSidecar(sourcePath);
  const target = decodeSidecar(targetPath, true);
  const sourceDigest = assertExpected(sourcePath, undefined);
  const targetDigest = assertExpected(targetPath, undefined);
  const moved = planCaseMove(source, target, parsed, audit());
  const next = Result.match(moved, { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value });
  return publish("test-case-move", action.dryRun, [
    { path: sourcePath, bytes: encodeCaseRelationsSidecar(next.source), expectedDigest: sourceDigest },
    { path: targetPath, bytes: encodeCaseRelationsSidecar(next.target), expectedDigest: targetDigest },
  ], `${action.to}#${parsed.caseId}`);
}

function ownerParts(owner: string): { path: string; anchor: string } {
  const index = owner.lastIndexOf("#");
  if (index < 1 || index === owner.length - 1) fail("OwnerCardinality", "owner must be a repository path plus Markdown anchor");
  const path = owner.slice(0, index);
  if (!path.startsWith("docs/engineering/testing/e2e/") || !path.endsWith(".md")) {
    fail("OwnerCardinality", "owner must live in a testing-owner Markdown document");
  }
  return { path, anchor: owner.slice(index + 1) };
}

function contractLink(ownerPath: string, contract: string): string {
  const relative = posix.relative(posix.dirname(ownerPath), contract);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function assertPlannedOwner(path: string, bytes: string, owner: string, contract: string): void {
  const planned = testingOwnerContracts([[path, bytes]]).find((item) => item.ref === owner);
  if (planned === undefined || planned.contract !== contract) {
    fail("OwnerCardinality", `planned bytes do not compile to ${owner} with contract ${contract}`);
  }
}

function ownerMutation(action: CreateOwnerInput | SetOwnerContractInput | RetireOwnerInput) {
  const parts = ownerParts(action.owner);
  const source = existsSync(absolute(parts.path)) ? read(parts.path) : "";
  const digest = assertExpected(parts.path, undefined);
  return compileTrace(REPOSITORY_ROOT).pipe(Effect.flatMap((snapshot) => {
    const existing = snapshot.owners.find((item) => item.ref === action.owner);
    const liveCases = snapshot.tests.filter((item) => item.owner === action.owner);
    if ("description" in action) {
      const value = action;
        if (existing !== undefined || source.includes(`{#${parts.anchor}}`)) fail("OwnerCardinality", `${action.owner} already exists`);
        const targetPath = value.contract.split("#", 1)[0]!;
        const target = validateRepoRefTarget(snapshot, value.contract, ["feature", "use-case"], existsSync(absolute(targetPath)) ? read(targetPath) : undefined);
        if (Result.isFailure(target)) fail("ContractTargetInvalid", target.failure.message);
        const block = `\n## ${value.description} {#${parts.anchor}}\n\n<!-- niceeval.e2e-owner-contract/v1 -->\nContract: [${value.contract}](${contractLink(parts.path, value.contract)})\n\n${value.description}\n`;
        const bytes = `${source.trimEnd()}${block}`;
        assertPlannedOwner(parts.path, bytes, action.owner, value.contract);
        return publish("test-owner-create", value.dryRun, [{ path: parts.path, bytes, expectedDigest: digest }], action.owner);
    }
    if (!("reason" in action)) {
      const value = action;
        if (existing === undefined) fail("OwnerCardinality", `${action.owner} is not current`);
        const targetPath = value.contract.split("#", 1)[0]!;
        const target = validateRepoRefTarget(snapshot, value.contract, ["feature", "use-case"], existsSync(absolute(targetPath)) ? read(targetPath) : undefined);
        if (Result.isFailure(target)) fail("ContractTargetInvalid", target.failure.message);
        const oldLine = `Contract:`;
        const lines = source.split("\n");
        const heading = lines.findIndex((line) => markdownAnchor(line) === parts.anchor);
        const contractLine = lines.findIndex((line, index) => index > heading && line.startsWith(oldLine));
        if (heading < 0 || contractLine < 0) fail("OwnerCardinality", `${action.owner} managed block is missing`);
        lines[contractLine] = `Contract: [${value.contract}](${contractLink(parts.path, value.contract)})`;
        lines.splice(contractLine + 1, 0, `<!-- niceeval.e2e-owner-history/v1 action=set from=${existing!.contract} at=${audit().atCommit} -->`);
        const bytes = lines.join("\n");
        assertPlannedOwner(parts.path, bytes, action.owner, value.contract);
        return publish("test-owner-set", value.dryRun, [{ path: parts.path, bytes, expectedDigest: digest }], action.owner);
    }
    {
      const value = action as RetireOwnerInput;
        if (existing === undefined) fail("OwnerCardinality", `${action.owner} is not current`);
        if (liveCases.length > 0) fail("OwnerInUse", `${action.owner} still owns ${liveCases.map((item) => item.selector).join(", ")}`);
        const lines = source.split("\n");
        const heading = lines.findIndex((line) => markdownAnchor(line) === parts.anchor);
        const marker = lines.findIndex((line, index) => index > heading && line.trim() === "<!-- niceeval.e2e-owner-contract/v1 -->");
        if (marker < 0) fail("OwnerCardinality", `${action.owner} managed block is missing`);
        lines[marker] = `<!-- niceeval.e2e-owner-history/v1 action=retired reason=${JSON.stringify(value.reason)} at=${audit().atCommit} -->`;
        return publish("test-owner-retire", value.dryRun, [{ path: parts.path, bytes: lines.join("\n"), expectedDigest: digest }], action.owner);
    }
  }));
}

export const inventoryCases = Effect.fn("inventoryCases")(function*(input: InventoryInput) {
  const collected = yield* collectInventory(input);
  const inventoryId = yield* Effect.try({ try: () => saveInventory(collected), catch: (cause) => cause });
  const reconciliation = reconcileInventory(collected);
  return {
    inventory: inventoryId,
    repo: input.repo,
    checkout: collected.checkout,
    caseCount: collected.cases.length,
    unassignedCases: collected.unassignedCases,
    findings: reconciliation.findings,
  };
});

export const listCases = Effect.fn("listCases")(function*(input: ListCasesInput) {
  return yield* Effect.try({
    try: () => {
      const all = records(input.history, inventoryForId(input.inventory));
      const pattern = optional(input.pattern);
      return {
        format: "niceeval.e2e-case-list/v1",
        cases: pattern === undefined ? all : all.filter((item) => JSON.stringify(item).includes(pattern)),
      };
    },
    catch: (cause) => cause,
  });
});

export const showCase = Effect.fn("showCase")(function*(input: ShowCaseInput) {
  return yield* Effect.try({
    try: () => {
      const parsed = selector(input.selector);
      const canonical = `${parsed.path}#${parsed.caseId}`;
      return records(input.history, inventoryForId(input.inventory)).find((entry) => entry.selector === canonical)
        ?? fail("CaseNotCurrent", input.selector);
    },
    catch: (cause) => cause,
  });
});

export const auditCases = Effect.fn("auditCases")(function*(input: AuditCasesInput) {
  const inventory = yield* Effect.scoped(collectWorkspaceCaseInventory(input.checkout)).pipe(
    Effect.mapError((cause) => new CaseCliError("WorkspaceInventoryIncomplete", detail(cause))),
  );
  const snapshot = yield* compileTrace(REPOSITORY_ROOT);
  const current = records(false);
  const related = new Map(current.map((item) => [item.selector, item]));
  const collected = new Map(inventory.cases.map((item) => [`${item.path}#${item.caseId}`, item]));
  const ownerContracts = new Map(snapshot.owners.map((owner) => [owner.ref, owner.contract]));
  const coveredUseCases = new Set(snapshot.tests.flatMap((test) => {
    const contract = ownerContracts.get(test.owner);
    return contract === undefined ? [] : [contract];
  }));
  return {
    format: "niceeval.e2e-case-audit/v1",
    inventory,
    uncoveredUseCases: snapshot.nodes
      .filter((node) => node.kind === "use-case" && !coveredUseCases.has(node.path))
      .map((node) => ({ path: node.path, title: node.title })),
    unassignedCases: inventory.unassignedCases,
    missingRelations: inventory.cases
      .filter((item) => !related.has(`${item.path}#${item.caseId}`))
      .map((item) => ({ selector: `${item.path}#${item.caseId}`, repo: item.repo, titlePath: item.titlePath })),
    orphanedRelations: current
      .filter((item) => !collected.has(item.selector))
      .map((item) => ({ selector: item.selector, owner: "relation" in item ? item.relation.owner : null })),
  };
});

export const createOwner = Effect.fn("createOwner")(function*(input: CreateOwnerInput) { return yield* ownerMutation(input); });
export const setOwnerContract = Effect.fn("setOwnerContract")(function*(input: SetOwnerContractInput) { return yield* ownerMutation(input); });
export const retireOwner = Effect.fn("retireOwner")(function*(input: RetireOwnerInput) { return yield* ownerMutation(input); });

export const attachCase = Effect.fn("attachCase")(function*(input: AttachCaseInput) {
  const parsed = selector(input.selector);
  const receipt = parseInventory(input.inventory);
  if (!receipt.cases.some((item) => item.path === parsed.path && item.caseId === parsed.caseId)) fail("CaseNotCollected", input.selector);
  return yield* validateOwner(input.owner).pipe(Effect.andThen(planOne({ _tag: "AttachCase", selector: parsed, owner: input.owner }, undefined, "test-case-attach", input.dryRun)));
});
export const moveCase = Effect.fn("moveCase")(function*(input: MoveCaseInput) { return yield* moveCaseMutation(input); });
export const retireCase = Effect.fn("retireCase")(function*(input: RetireCaseInput) {
  const parsed = selector(input.selector);
  return yield* planOne({ _tag: "RetireCase", selector: parsed, reason: input.reason }, undefined, "test-case-retire", input.dryRun);
});
export const addCaseRegression = Effect.fn("addCaseRegression")(function*(input: AddRegressionInput) { return yield* addRegression(input, selector(input.selector)); });
export const retireCaseRegression = Effect.fn("retireCaseRegression")(function*(input: RetireRegressionInput) { return yield* retireRegression(input, selector(input.selector)); });
export const addCaseIssue = Effect.fn("addCaseIssue")(function*(input: AddIssueInput) {
  const parsed = selector(input.selector);
  return yield* planOne({ _tag: "AddIssue", selector: parsed, issue: verifyIssue(input.url, input.selector, input.verificationReceipt) }, undefined, "test-issue-add", input.dryRun);
});
export const retireCaseIssue = Effect.fn("retireCaseIssue")(function*(input: RetireIssueInput) {
  const parsed = selector(input.selector);
  return yield* planOne({ _tag: "RetireIssue", selector: parsed, url: input.url, reason: input.reason }, undefined, "test-issue-retire", input.dryRun);
});
export function renderCaseCommandError(error: unknown): string { return `${error instanceof CaseCliError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error)}\n`; }
export function renderCaseReceipt(value: unknown): string { if (typeof value === "object" && value !== null && "cases" in value && Array.isArray(value.cases)) return `${value.cases.map((item) => typeof item === "object" && item !== null && "selector" in item ? String(item.selector) : JSON.stringify(item)).join("\n")}\n`; return `${JSON.stringify(value, null, 2)}\n`; }
