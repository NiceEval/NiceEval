import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { Effect, Match, Option, Result } from "effect";
import type * as NodeServicesRequirement from "@effect/platform-node/NodeServices";
import { REPOSITORY_ROOT } from "../runtime.js";
import { compileTrace } from "../trace/index.js";
import { mutateTraceFiles, traceDigest } from "../trace/relation-mutation.js";
import { planCaseMove, planCaseRelation, type CaseRelationAction } from "./planner.js";
import { parseCaseSelector, selectCurrentCase, type CaseSelector } from "./selector.js";
import { decodeCaseRelationsSidecar, encodeCaseRelationsSidecar, type CaseIssue, type CaseRelationsSidecar } from "./sidecar.js";

type Maybe<A> = Option.Option<A> | A | undefined;
interface InventoryCase { readonly executor: "vitest" | "playwright"; readonly repo: string; readonly path: string; readonly project?: string; readonly titlePath: readonly string[]; readonly caseId: `necase_${string}` }
interface InventoryReceipt { readonly format: "niceeval.e2e-case-inventory/v1"; readonly digest: string; readonly findings: readonly string[]; readonly bodyExecutions: 0; readonly forbiddenSetupExecutions: 0; readonly cases: readonly InventoryCase[] }
interface MutationFlags { readonly expectedDigest: Maybe<string>; readonly dryRun: boolean }
export type CaseCliAction =
  | { readonly _tag: "Inventory"; readonly repo: string; readonly executor: "vitest" | "playwright"; readonly cwd: string; readonly checkout: string; readonly receipt: Maybe<string>; readonly nativeArgs: Maybe<string> }
  | { readonly _tag: "List"; readonly pattern: Maybe<string>; readonly history: boolean; readonly receipt: Maybe<string> }
  | { readonly _tag: "Show"; readonly selector: string; readonly history: boolean; readonly receipt: Maybe<string> }
  | ({ readonly _tag: "AttachCase"; readonly selector: string; readonly owner: string; readonly receipt: string } & MutationFlags)
  | ({ readonly _tag: "MoveCase"; readonly selector: string; readonly to: string; readonly receipt: string } & MutationFlags)
  | ({ readonly _tag: "RetireCase"; readonly selector: string; readonly reason: string } & MutationFlags)
  | ({ readonly _tag: "CreateOwner"; readonly owner: string; readonly contract: string; readonly description: string } & MutationFlags)
  | ({ readonly _tag: "SetOwnerContract"; readonly owner: string; readonly contract: string } & MutationFlags)
  | ({ readonly _tag: "RetireOwner"; readonly owner: string; readonly reason: string } & MutationFlags)
  | ({ readonly _tag: "AddRegression"; readonly selector: string; readonly memory: string; readonly red: string; readonly green: string; readonly certificate: string; readonly inventoryReceipt: string } & MutationFlags)
  | ({ readonly _tag: "RetireRegression"; readonly selector: string; readonly memory: string; readonly reason: string } & MutationFlags)
  | ({ readonly _tag: "AddIssue"; readonly selector: string; readonly url: string; readonly provenance: "direct"; readonly verificationReceipt: Maybe<string> } & MutationFlags)
  | ({ readonly _tag: "RetireIssue"; readonly selector: string; readonly url: string; readonly reason: string } & MutationFlags)
  | { readonly _tag: "MigratePlan"; readonly test: Maybe<string>; readonly receipt: string; readonly mapping: string }
  | { readonly _tag: "MigrateApply"; readonly manifest: string; readonly dryRun: boolean };

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

function parseInventory(path: string): InventoryReceipt {
  const value = JSON.parse(readFileSync(resolve(path), "utf8")) as Partial<InventoryReceipt> & Record<string, unknown>;
  if (value.format !== "niceeval.e2e-case-inventory/v1" || !Array.isArray(value.cases) || !Array.isArray(value.findings) || value.bodyExecutions !== 0 || value.forbiddenSetupExecutions !== 0 || typeof value.digest !== "string") fail("InventoryInvalid", `${path} is not a safe native inventory receipt`);
  if (value.findings!.length > 0) fail("InventoryInvalid", `inventory has findings: ${value.findings!.join("; ")}`);
  const { digest, ...unsigned } = value;
  const actualDigest = sha(canonicalJson(unsigned));
  if (digest !== actualDigest) fail("InventoryDigestMismatch", `inventory digest is forged or stale: expected ${actualDigest}, received ${String(digest)}`);
  return value as InventoryReceipt;
}
function collectInventory(action: Extract<CaseCliAction, { _tag: "Inventory" }>): InventoryReceipt {
  const injected = optional(action.receipt);
  if (injected !== undefined) return parseInventory(injected);
  const rawNative = optional(action.nativeArgs); const nativeArgs = rawNative === undefined ? [] : JSON.parse(rawNative) as unknown;
  if (!Array.isArray(nativeArgs) || !nativeArgs.every((item) => typeof item === "string")) fail("InventoryInvalid", "--native-args must be a JSON string array");
  const args = ["e2e", "inventory", "--executor", action.executor, "--repo", action.repo, "--cwd", action.cwd, "--checkout", action.checkout, "--", ...(nativeArgs as string[])];
  const output = execFileSync("pnpm", args, { cwd: REPOSITORY_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const value = JSON.parse(output) as InventoryReceipt;
  const temporary = resolve(REPOSITORY_ROOT, ".git", `inventory-${process.pid}.json`);
  writeFileSync(temporary, JSON.stringify(value));
  try { return parseInventory(temporary); } finally { rmSync(temporary, { force: true }); }
}
function sidecarFiles(): readonly string[] {
  let output: string;
  try { output = execFileSync("rg", ["--files", "-g", "*.cases.json"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim(); }
  catch (cause) { const status = typeof cause === "object" && cause !== null && "status" in cause ? cause.status : undefined; if (status === 1) return []; throw cause; }
  return output === "" ? [] : output.split("\n").sort();
}
function inventoryForReceipt(path: Maybe<string>): InventoryReceipt | undefined { const value = optional(path); return value === undefined ? undefined : parseInventory(value); }
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
  const current = records(false, inventory);
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

interface PlannedChange { readonly path: string; readonly bytes: string; readonly expectedDigest: string | null }
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

function validateRegressionEvidence(action: Extract<CaseCliAction, { _tag: "AddRegression" }>) {
  for (const path of [action.red, action.green, action.certificate, action.inventoryReceipt]) containedEvidenceSource(path);
  const inventory = parseInventory(action.inventoryReceipt);
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

function addRegression(action: Extract<CaseCliAction, { _tag: "AddRegression" }>, parsed: CaseSelector) {
  const verified = validateRegressionEvidence(action);
  return validateOpenProblem(action.memory).pipe(Effect.andThen(Effect.suspend(() => {
    const relationPath = sidecarPath(parsed.path);
    const before = decodeSidecar(relationPath);
    const relationDigest = assertExpected(relationPath, action.expectedDigest);
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
    const copied = [
      { source: action.red, path: `${evidenceRoot}/red.json` },
      { source: action.green, path: `${evidenceRoot}/green.json` },
      { source: action.inventoryReceipt, path: `${evidenceRoot}/inventory.json` },
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
      inventory: { path: pathMap.get(action.inventoryReceipt)!, digest: verified.inventory.digest },
    };
    const nextIndex = { ...index, current: { ...index.current, [parsed.caseId]: { ...currentCase, [action.memory]: evidence } } };
    return publish("test-regression-add", action.dryRun, [
      { path: relationPath, bytes: encodeCaseRelationsSidecar(next), expectedDigest: relationDigest },
      { path: indexPath, bytes: `${JSON.stringify(nextIndex, null, 2)}\n`, expectedDigest: indexDigest },
      ...copied.map((item) => ({ path: item.path, bytes: readFileSync(resolve(item.source), "utf8"), expectedDigest: null })),
      { path: certificatePath, bytes: `${JSON.stringify(normalizedCertificate, null, 2)}\n`, expectedDigest: null },
    ], action.selector);
  })));
}

function retireRegression(action: Extract<CaseCliAction, { _tag: "RetireRegression" }>, parsed: CaseSelector) {
  return validateRetirableProblem(action.memory).pipe(Effect.andThen(Effect.suspend(() => {
    const relationPath = sidecarPath(parsed.path);
    const before = decodeSidecar(relationPath);
    const relationDigest = assertExpected(relationPath, action.expectedDigest);
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

type RelationMutationAction = Extract<CaseCliAction, { selector: string }> extends infer A
  ? A extends { _tag: "Show" } ? never : A
  : never;

function mutation(action: RelationMutationAction) {
  const parsed = selector(action.selector);
  return Match.value(action).pipe(Match.tags({
    AttachCase: (a) => {
      const receipt = parseInventory(a.receipt);
      if (!receipt.cases.some((c) => c.path === parsed.path && c.caseId === parsed.caseId)) fail("CaseNotCollected", a.selector);
      return validateOwner(a.owner).pipe(Effect.andThen(planOne({ _tag: "AttachCase", selector: parsed, owner: a.owner }, a.expectedDigest, "test-case-attach", a.dryRun)));
    },
    RetireCase: (a) => planOne({ _tag: "RetireCase", selector: parsed, reason: a.reason }, a.expectedDigest, "test-case-retire", a.dryRun),
    AddRegression: (a) => addRegression(a, parsed),
    RetireRegression: (a) => retireRegression(a, parsed),
    AddIssue: (a) => planOne({ _tag: "AddIssue", selector: parsed, issue: verifyIssue(a.url, a.selector, a.verificationReceipt) }, a.expectedDigest, "test-issue-add", a.dryRun),
    RetireIssue: (a) => planOne({ _tag: "RetireIssue", selector: parsed, url: a.url, reason: a.reason }, a.expectedDigest, "test-issue-retire", a.dryRun),
    MoveCase: (a) => {
      const inventory = parseInventory(a.receipt);
      if (inventory.cases.some((item) => item.caseId === parsed.caseId && item.path === parsed.path)) fail("CaseStillCollected", `${a.selector} remains collected at the old path`);
      if (!inventory.cases.some((item) => item.caseId === parsed.caseId && item.path === a.to)) fail("CaseNotCollected", `${a.to}#${parsed.caseId}`);
      const sourcePath = sidecarPath(parsed.path);
      const targetPath = sidecarPath(a.to);
      const source = decodeSidecar(sourcePath);
      const target = decodeSidecar(targetPath, true);
      const sourceDigest = assertExpected(sourcePath, a.expectedDigest);
      const targetDigest = assertExpected(targetPath, undefined);
      const moved = planCaseMove(source, target, parsed, audit());
      const next = Result.match(moved, { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value });
      return publish("test-case-move", a.dryRun, [
        { path: sourcePath, bytes: encodeCaseRelationsSidecar(next.source), expectedDigest: sourceDigest },
        { path: targetPath, bytes: encodeCaseRelationsSidecar(next.target), expectedDigest: targetDigest },
      ], `${a.to}#${parsed.caseId}`);
    },
  }), Match.exhaustive);
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

function ownerMutation(action: Extract<CaseCliAction, { _tag: "CreateOwner" | "SetOwnerContract" | "RetireOwner" }>) {
  const parts = ownerParts(action.owner);
  const source = existsSync(absolute(parts.path)) ? read(parts.path) : "";
  const digest = assertExpected(parts.path, action.expectedDigest);
  return compileTrace(REPOSITORY_ROOT).pipe(Effect.flatMap((snapshot) => {
    const existing = snapshot.owners.find((item) => item.ref === action.owner);
    const liveCases = snapshot.tests.filter((item) => item.owner === action.owner);
    return Match.value(action).pipe(Match.tags({
      CreateOwner: (value) => {
        if (existing !== undefined || source.includes(`{#${parts.anchor}}`)) fail("OwnerCardinality", `${action.owner} already exists`);
        const target = snapshot.nodes.find((node) => node.path === value.contract);
        if (target === undefined || (target.kind !== "feature" && target.kind !== "use-case")) fail("ContractTargetInvalid", value.contract);
        const block = `\n## ${value.description} {#${parts.anchor}}\n\n<!-- niceeval.e2e-owner-contract/v1 -->\nContract: [${value.contract}](${contractLink(parts.path, value.contract)})\n\n${value.description}\n`;
        return publish("test-owner-create", value.dryRun, [{ path: parts.path, bytes: `${source.trimEnd()}${block}`, expectedDigest: digest }], action.owner);
      },
      SetOwnerContract: (value) => {
        if (existing === undefined) fail("OwnerCardinality", `${action.owner} is not current`);
        const target = snapshot.nodes.find((node) => node.path === value.contract);
        if (target === undefined || (target.kind !== "feature" && target.kind !== "use-case")) fail("ContractTargetInvalid", value.contract);
        const oldLine = `Contract:`;
        const lines = source.split("\n");
        const heading = lines.findIndex((line) => line.includes(`{#${parts.anchor}}`));
        const contractLine = lines.findIndex((line, index) => index > heading && line.startsWith(oldLine));
        if (heading < 0 || contractLine < 0) fail("OwnerCardinality", `${action.owner} managed block is missing`);
        lines[contractLine] = `Contract: [${value.contract}](${contractLink(parts.path, value.contract)})`;
        lines.splice(contractLine + 1, 0, `<!-- niceeval.e2e-owner-history/v1 action=set from=${existing!.contract} at=${audit().atCommit} -->`);
        return publish("test-owner-set", value.dryRun, [{ path: parts.path, bytes: lines.join("\n"), expectedDigest: digest }], action.owner);
      },
      RetireOwner: (value) => {
        if (existing === undefined) fail("OwnerCardinality", `${action.owner} is not current`);
        if (liveCases.length > 0) fail("OwnerInUse", `${action.owner} still owns ${liveCases.map((item) => item.selector).join(", ")}`);
        const lines = source.split("\n");
        const heading = lines.findIndex((line) => line.includes(`{#${parts.anchor}}`));
        const marker = lines.findIndex((line, index) => index > heading && line.trim() === "<!-- niceeval.e2e-owner-contract/v1 -->");
        if (marker < 0) fail("OwnerCardinality", `${action.owner} managed block is missing`);
        lines[marker] = `<!-- niceeval.e2e-owner-history/v1 action=retired reason=${JSON.stringify(value.reason)} at=${audit().atCommit} -->`;
        return publish("test-owner-retire", value.dryRun, [{ path: parts.path, bytes: lines.join("\n"), expectedDigest: digest }], action.owner);
      },
    }), Match.exhaustive);
  }));
}

function migrationPlan(action: Extract<CaseCliAction, { _tag: "MigratePlan" }>) {
  const inventory = parseInventory(action.receipt);
  const selected = optional(action.test);
  const mapping = JSON.parse(readFileSync(resolve(action.mapping), "utf8")) as {
    format: string;
    files: Record<string, { owners: Record<string, string>; regressions: Record<string, string[]>; issues: Record<string, { caseId: string; verificationReceipt: string }[]> }>;
  };
  if (mapping.format !== "niceeval.e2e-case-migration-mapping/v1") fail("MigrationMappingInvalid", "mapping format is invalid");
  const paths = [...new Set(inventory.cases.map((item) => item.path))].filter((path) => selected === undefined || path === selected);
  const files = paths.map((path) => {
    const source = read(path);
    const caseIds = inventory.cases.filter((item) => item.path === path).map((item) => item.caseId);
    const legacy = source.split(/\r?\n/u).flatMap((line) => {
      const match = /^\/\/\s+(owner|regression|issue):\s*(.+?)\s*$/u.exec(line);
      return match === null ? [] : [{ kind: match[1]!, value: match[2]! }];
    });
    const fileMapping = mapping.files[path];
    if (fileMapping === undefined) fail("MigrationMappingInvalid", `mapping is missing ${path}`);
    const exactMapping = fileMapping!;
    if (new Set(Object.keys(exactMapping.owners)).size !== caseIds.length || caseIds.some((id) => exactMapping.owners[id] === undefined)) fail("MigrationMappingInvalid", `${path} must map exactly one owner for every collected case`);
    const sidecar = caseIds.reduce((current, caseId) => {
      const attached = planCaseRelation(current, { _tag: "AttachCase", selector: { path, caseId }, owner: exactMapping.owners[caseId]! }, audit());
      return Result.match(attached, { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value });
    }, emptySidecar(path));
    let planned = sidecar;
    for (const relation of legacy) {
      if (relation.kind === "owner") continue;
      if (relation.kind === "regression") {
        const targets = exactMapping.regressions[relation.value];
        if (targets === undefined || targets.length === 0 || targets.some((id) => !caseIds.includes(id as `necase_${string}`))) fail("MigrationMappingInvalid", `${path} regression ${relation.value} lacks exact case mapping`);
        for (const caseId of targets!) {
          const next = planCaseRelation(planned, { _tag: "AddRegression", selector: { path, caseId: caseId as `necase_${string}` }, memory: relation.value }, audit());
          planned = Result.match(next, { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value });
        }
      } else {
        const targets = exactMapping.issues[relation.value];
        if (targets === undefined || targets.length === 0) fail("MigrationMappingInvalid", `${path} Issue ${relation.value} lacks exact case mapping`);
        for (const target of targets!) {
          if (!caseIds.includes(target.caseId as `necase_${string}`)) fail("MigrationMappingInvalid", `${target.caseId} is not collected from ${path}`);
          const issue = verifyIssue(relation.value, `${path}#${target.caseId}`, target.verificationReceipt);
          const next = planCaseRelation(planned, { _tag: "AddIssue", selector: { path, caseId: target.caseId as `necase_${string}` }, issue }, audit());
          planned = Result.match(next, { onFailure: (error) => fail(error._tag, JSON.stringify(error)), onSuccess: (value) => value });
        }
      }
    }
    const stripped = source.split(/(?<=\n)/u).filter((line) => !/^\/\/\s+(owner|regression|issue):/u.test(line)).join("");
    return {
      path,
      indexEntry: execFileSync("git", ["ls-files", "--stage", "--", path], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim(),
      preimageDigest: traceDigest(source),
      plannedSource: stripped,
      sidecarPath: sidecarPath(path),
      sidecarPreimageDigest: existsSync(absolute(sidecarPath(path))) ? traceDigest(read(sidecarPath(path))) : null,
      plannedSidecar: encodeCaseRelationsSidecar(planned),
    };
  });
  const unsigned = {
    format: "niceeval.e2e-case-migration-plan/v1",
    createdAt: new Date().toISOString(),
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim(),
    inventoryPath: resolve(action.receipt),
    inventoryDigest: inventory.digest,
    mappingDigest: traceDigest(readFileSync(resolve(action.mapping))),
    files,
  };
  const manifest = { ...unsigned, manifestDigest: sha(canonicalJson(unsigned)) };
  const privateRoot = execFileSync("git", ["rev-parse", "--git-path", "niceeval/docs-trace"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim();
  const manifestPath = resolve(REPOSITORY_ROOT, privateRoot, `case-migration-${randomUUID()}.json`);
  mkdirSync(posix.dirname(manifestPath), { recursive: true, mode: 0o700 });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { ...manifest, manifest: manifestPath, findings: [] };
}
function migrationApply(action: Extract<CaseCliAction, { _tag: "MigrateApply" }>) {
  const path = resolve(action.manifest); const manifest = JSON.parse(readFileSync(path, "utf8")) as { format: string; manifestDigest: string; head: string; inventoryPath: string; inventoryDigest: string; files: readonly { path: string; indexEntry: string; preimageDigest: string; plannedSource: string; sidecarPath: string; sidecarPreimageDigest: string | null; plannedSidecar: string }[] };
  const { manifestDigest, ...unsigned } = manifest;
  if (manifest.format !== "niceeval.e2e-case-migration-plan/v1" || manifestDigest !== sha(canonicalJson(unsigned))) fail("MigrationManifestInvalid", "manifest digest is invalid");
  const usedPath = `${path}.used`;
  if (existsSync(usedPath)) fail("MigrationManifestUsed", "manifest already has a used credential");
  if (execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim() !== manifest.head) fail("PreimageChanged", "HEAD changed since migration plan");
  if (parseInventory(manifest.inventoryPath).digest !== manifest.inventoryDigest) fail("PreimageChanged", "inventory changed since migration plan");
  const changes = manifest.files.flatMap((file) => {
    if (traceDigest(read(file.path)) !== file.preimageDigest) fail("PreimageChanged", file.path);
    if (execFileSync("git", ["ls-files", "--stage", "--", file.path], { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim() !== file.indexEntry) fail("PreimageChanged", `${file.path} index entry changed`);
    return [{ path: file.path, bytes: file.plannedSource, expectedDigest: file.preimageDigest }, { path: file.sidecarPath, bytes: file.plannedSidecar, expectedDigest: file.sidecarPreimageDigest }];
  });
  return publish("test-migrate-apply", action.dryRun, changes, action.manifest).pipe(Effect.tap(() => action.dryRun ? Effect.void : Effect.sync(() => writeFileSync(usedPath, `${JSON.stringify({ format: "niceeval.e2e-case-migration-used/v1", manifestDigest, usedAt: new Date().toISOString() })}\n`, { mode: 0o600, flag: "wx" }))));
}

export function executeTestCaseCommand(action: CaseCliAction): Effect.Effect<unknown, unknown, NodeServicesRequirement.NodeServices> {
  return Effect.suspend(() => Match.value(action).pipe(
    Match.tags({
      Inventory: (value) => Effect.try(() => reconcileInventory(collectInventory(value))),
      List: (value) => Effect.try(() => {
        const all = records(value.history, inventoryForReceipt(value.receipt));
        const pattern = optional(value.pattern);
        return {
          format: "niceeval.e2e-case-list/v1",
          cases: pattern === undefined ? all : all.filter((item) => JSON.stringify(item).includes(pattern)),
        };
      }),
      Show: (value) => Effect.try(() => {
        const parsed = selector(value.selector);
        const canonical = `${parsed.path}#${parsed.caseId}`;
        return records(value.history, inventoryForReceipt(value.receipt)).find((entry) => entry.selector === canonical)
          ?? fail("CaseNotCurrent", value.selector);
      }),
      MigratePlan: (value) => Effect.try(() => migrationPlan(value)),
      MigrateApply: migrationApply,
      CreateOwner: ownerMutation,
      SetOwnerContract: ownerMutation,
      RetireOwner: ownerMutation,
      AttachCase: mutation,
      MoveCase: mutation,
      RetireCase: mutation,
      AddRegression: mutation,
      RetireRegression: mutation,
      AddIssue: mutation,
      RetireIssue: mutation,
    }),
    Match.exhaustive,
  ));
}
export function renderCaseCommandError(error: unknown): string { return `${error instanceof CaseCliError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error)}\n`; }
export function renderCaseReceipt(value: unknown): string { if (typeof value === "object" && value !== null && "cases" in value && Array.isArray(value.cases)) return `${value.cases.map((item) => typeof item === "object" && item !== null && "selector" in item ? String(item.selector) : JSON.stringify(item)).join("\n")}\n`; return `${JSON.stringify(value, null, 2)}\n`; }
