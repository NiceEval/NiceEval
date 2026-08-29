import { createHash } from "node:crypto";
import { join } from "node:path";

import { Data, Effect, Predicate } from "effect";
import * as FileSystem from "effect/FileSystem";

import { discoverAllRepos, e2eRootDir, repoRootDir, type DiscoveredRepo } from "./discovery.js";
import { collectCaseInventory, InventoryError, type CaseInventoryReceiptV1, type CollectedCaseV1, type InventoryExecutor } from "./inventory.js";
import { hasSuccessfulOwnedProcessResult, runOwnedProcess } from "./owned-process.js";
import { packCandidate } from "./pack.js";
import { copyRepoIsolated, pointAtCandidateTarball } from "./run-repo.js";
import { buildTestkitPackage, injectTestkitDirectory, type TestkitPackage } from "./testkit-snapshot.js";

/** A re-collectable logical request. It deliberately contains no scratch location. */
export interface WorkspaceCollectionSpecV1 {
  readonly format: "niceeval.e2e-case-workspace-collection-spec/v1";
  readonly checkout: string;
}

interface CollectedSubject {
  readonly executor: InventoryExecutor;
  readonly repo: string;
  readonly path: string;
  readonly project?: string;
  readonly titlePath: readonly string[];
  readonly subjectDigest: `sha256:${string}`;
  readonly caseId: `necase_${string}`;
}

export interface WorkspaceInventoryReceiptV1 {
  readonly format: "niceeval.e2e-case-workspace-inventory/v1";
  readonly checkout: string;
  readonly repos: readonly { readonly id: string; readonly receipts: readonly CaseInventoryReceiptV1[] }[];
  readonly files: readonly string[];
  readonly cases: readonly CollectedCaseV1[];
  readonly unassignedCases: readonly { readonly executor: InventoryExecutor; readonly repo: string; readonly path: string; readonly project?: string; readonly titlePath: readonly string[] }[];
  readonly findings: readonly string[];
  readonly digest: `sha256:${string}`;
}

export class WorkspaceInventoryError extends Data.TaggedError("WorkspaceInventoryError")<{
  readonly detail: string;
  readonly receipt?: WorkspaceInventoryReceiptV1;
}> {}

/** A runner returned the same stable subject more than once; positional selection is unsafe. */
export class DuplicateCollectedSubject extends Data.TaggedError("DuplicateCollectedSubject")<{
  readonly subjectDigest: `sha256:${string}`;
  readonly subjects: readonly CollectedSubject[];
}> {}

export class DuplicateCollectedCaseId extends Data.TaggedError("DuplicateCollectedCaseId")<{
  readonly caseId: `necase_${string}`;
  readonly subjects: readonly CollectedSubject[];
}> {}

interface PreparedWorkspaceRepo {
  readonly id: string;
  readonly executors: readonly { readonly name: InventoryExecutor; readonly version: string }[];
  readonly receipts: readonly CaseInventoryReceiptV1[];
  readonly files: readonly string[];
  readonly subjects: readonly CollectedSubject[];
  readonly unassignedCases: readonly { readonly executor: InventoryExecutor; readonly repo: string; readonly path: string; readonly project?: string; readonly titlePath: readonly string[] }[];
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (Predicate.isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const digest = (value: unknown): `sha256:${string}` => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const detail = (cause: unknown): string => Predicate.isObject(cause) && typeof cause.detail === "string" ? cause.detail : cause instanceof Error ? cause.message : String(cause);

const fsText = (path: string) => Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)).pipe(
  Effect.mapError((cause) => new WorkspaceInventoryError({ detail: `could not read ${path}: ${cause.message}` })),
);

const installedExecutors = Effect.fn("installedExecutors")(function*(copy: string) {
  const raw = yield* fsText(join(copy, "package.json"));
  const value = yield* Effect.try({
    try: () => JSON.parse(raw) as Record<string, unknown>,
    catch: (cause) => new WorkspaceInventoryError({ detail: `could not parse ${copy}/package.json: ${detail(cause)}` }),
  });
  const names = new Set(["dependencies", "devDependencies"].flatMap((field) => {
    const dependencies = value[field];
    return Predicate.isObject(dependencies) ? Object.keys(dependencies) : [];
  }));
  const executors: InventoryExecutor[] = [];
  if (names.has("vitest")) executors.push("vitest");
  if (names.has("@playwright/test") || names.has("playwright")) executors.push("playwright");
  if (executors.length === 0) return yield* new WorkspaceInventoryError({ detail: `${copy}/package.json declares no supported native inventory executor` });
  return executors;
});

const runRequired = (command: readonly string[], cwd: string, label: string) => runOwnedProcess(command, {
  cwd, env: process.env, output: "capture", stream: false, timeoutMs: 30 * 60_000,
}).pipe(
  Effect.mapError((cause) => new WorkspaceInventoryError({ detail: `${label}: ${cause.detail}` })),
  Effect.flatMap((result) => hasSuccessfulOwnedProcessResult(result)
    ? Effect.succeed(result)
    : Effect.fail(new WorkspaceInventoryError({ detail: `${label} failed (${result.signal ?? `exit ${result.exitCode}`}): ${result.stderr.trim() || result.stdout.trim()}` }))),
);

const subjectIdentity = (subject: Omit<CollectedSubject, "subjectDigest" | "caseId">) => ({
  executor: subject.executor, repo: subject.repo, path: subject.path,
  ...(subject.project === undefined ? {} : { project: subject.project }), titlePath: subject.titlePath,
});
const compareSubject = (left: CollectedSubject, right: CollectedSubject): number =>
  left.subjectDigest.localeCompare(right.subjectDigest) || left.caseId.localeCompare(right.caseId);

const sourceSubjectKey = (subject: CollectedSubject): string => canonicalJson({ path: subject.path, titlePath: subject.titlePath });

/**
 * A test can be listed once per executor/project. That is one source subject
 * only when path/title agree and every witness has the same existing token.
 */
const collapseSourceWitnesses = Effect.fn("collapseSourceSubjectWitnesses")(function*(subjects: readonly CollectedSubject[]) {
  const grouped = new Map<string, CollectedSubject[]>();
  for (const subject of subjects) grouped.set(sourceSubjectKey(subject), [...(grouped.get(sourceSubjectKey(subject)) ?? []), subject]);
  const collapsed: CollectedSubject[] = [];
  for (const witnesses of grouped.values()) {
    const sorted = witnesses.sort(compareSubject);
    if (sorted.length === 1) { collapsed.push(sorted[0]!); continue; }
    const caseIds = new Set(sorted.map((subject) => subject.caseId));
    if (caseIds.size !== 1) return yield* new DuplicateCollectedSubject({ subjectDigest: sorted[0]!.subjectDigest, subjects: sorted });
    collapsed.push(sorted[0]!);
  }
  return collapsed.sort(compareSubject);
});

const prepareRepo = Effect.fn("prepareWorkspaceInventoryRepo")(function*(repo: DiscoveredRepo, spec: WorkspaceCollectionSpecV1, scratch: string, candidate: string, testkit: TestkitPackage | undefined) {
  const copy = join(scratch, "repos", repo.manifest.id);
  yield* copyRepoIsolated(repo.dir, copy).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: `${repo.manifest.id}: ${cause.detail}` })));
  yield* pointAtCandidateTarball(copy, candidate).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: `${repo.manifest.id}: ${cause.detail}` })));
  if (repo.manifest.harness?.testkit === true) {
    if (testkit === undefined) return yield* new WorkspaceInventoryError({ detail: `${repo.manifest.id}: Testkit snapshot was not prepared` });
    yield* injectTestkitDirectory(copy, testkit).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: `${repo.manifest.id}: ${cause.detail}` })));
  }
  yield* runRequired(["pnpm", "install", "--no-frozen-lockfile", "--prefer-offline"], copy, `${repo.manifest.id}: install`);
  const executors = yield* installedExecutors(copy);
  const receipts = yield* Effect.forEach(executors, (executor) => collectCaseInventory({ executor, repo: repo.manifest.id, cwd: copy, checkout: spec.checkout, nativeArgs: [] }).pipe(
    Effect.catchTag("InventoryError", (cause: InventoryError) => Effect.fail(new WorkspaceInventoryError({ detail: `${repo.manifest.id}/${executor}: ${cause.detail}` }))),
  ), { concurrency: "unbounded" });
  const prefix = `e2e/${repo.manifest.id}`;
  const subjects = receipts.flatMap((receipt) => receipt.cases.map((item) => ({ executor: item.executor, repo: item.repo, path: `${prefix}/${item.path}`, ...(item.project === undefined ? {} : { project: item.project }), titlePath: item.titlePath, caseId: item.caseId }))
    .map((subject) => ({ ...subject, subjectDigest: digest(subjectIdentity(subject)) })));
  const unassignedCases = receipts.flatMap((receipt) => receipt.unassignedCases.map((item) => ({ executor: receipt.executor.name, repo: receipt.repo, path: `${prefix}/${item.file}`, ...(item.project === undefined ? {} : { project: item.project }), titlePath: item.titlePath })));
  const auditReceipts = receipts.map((receipt) => {
    const { digest: _digest, ...original } = receipt;
    const unsigned = { ...original, files: receipt.files.map((path) => `${prefix}/${path}`), cases: receipt.cases.map((item) => ({ ...item, path: `${prefix}/${item.path}` })), unassignedCases: receipt.unassignedCases.map((item) => ({ ...item, file: `${prefix}/${item.file}` })) };
    return { ...unsigned, digest: digest(unsigned) };
  });
  return { id: repo.manifest.id, executors: receipts.map((receipt) => receipt.executor).sort((left, right) => left.name.localeCompare(right.name)), receipts: auditReceipts, files: [...new Set(receipts.flatMap((receipt) => receipt.files.map((path) => `${prefix}/${path}`)))].sort(), subjects: subjects.sort(compareSubject), unassignedCases } satisfies PreparedWorkspaceRepo;
});

const collectWorkspacePrepared = Effect.fn("collectWorkspacePrepared")(function*(spec: WorkspaceCollectionSpecV1) {
  const root = repoRootDir();
  const fs = yield* FileSystem.FileSystem;
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "niceeval-case-inventory-" }).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: `could not create inventory scratch directory: ${cause.message}` })));
  yield* runRequired(["pnpm", "run", "build:package"], root, "build candidate package");
  const candidate = yield* packCandidate(root, join(scratch, "candidate.tgz")).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: cause.detail })));
  const discovered = yield* discoverAllRepos(e2eRootDir()).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: detail(cause) })));
  if (discovered.errors.length > 0) return yield* new WorkspaceInventoryError({ detail: discovered.errors.join("; ") });
  const testkit = discovered.repos.some((repo) => repo.manifest.harness?.testkit === true) ? yield* buildTestkitPackage(root, scratch).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: cause.detail }))) : undefined;
  const prepared = yield* Effect.forEach(discovered.repos, (repo) => prepareRepo(repo, spec, scratch, candidate.path, testkit), { concurrency: "unbounded" });
  return prepared;
});

export const collectWorkspaceCaseInventory = Effect.fn("collectWorkspaceCaseInventory")(function*(checkout: string) {
  const spec = { format: "niceeval.e2e-case-workspace-collection-spec/v1" as const, checkout };
  const prepared = yield* collectWorkspacePrepared(spec);
  const subjects = yield* collapseSourceWitnesses(prepared.flatMap((repo) => repo.subjects).sort(compareSubject));
  const byCaseId = new Map<string, CollectedSubject[]>();
  for (const subject of subjects) byCaseId.set(subject.caseId, [...(byCaseId.get(subject.caseId) ?? []), subject]);
  for (const [caseId, witnesses] of byCaseId) if (witnesses.length > 1) return yield* new DuplicateCollectedCaseId({ caseId: caseId as `necase_${string}`, subjects: witnesses.sort(compareSubject) });
  const repos = prepared.map(({ id, receipts }) => ({ id, receipts })).sort((left, right) => left.id.localeCompare(right.id));
  const files = [...new Set(prepared.flatMap((repo) => repo.files))].sort();
  const cases: CollectedCaseV1[] = subjects.map(({ subjectDigest: _subjectDigest, ...subject }) => subject).sort((left, right) => left.path.localeCompare(right.path) || left.caseId.localeCompare(right.caseId));
  const unassignedCases = prepared.flatMap((repo) => repo.unassignedCases).sort((left, right) => left.path.localeCompare(right.path) || left.titlePath.join("\0").localeCompare(right.titlePath.join("\0")));
  const unsigned = { format: "niceeval.e2e-case-workspace-inventory/v1" as const, checkout, repos, files, cases, unassignedCases, findings: [] as readonly string[] };
  return { ...unsigned, digest: digest(unsigned) };
});
