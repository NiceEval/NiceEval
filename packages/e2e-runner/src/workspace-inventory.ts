import { createHash } from "node:crypto";
import { join } from "node:path";

import { Data, Effect, Predicate } from "effect";
import * as FileSystem from "effect/FileSystem";

import { discoverAllRepos, e2eRootDir, repoRootDir, type DiscoveredRepo } from "./discovery.js";
import { collectCaseInventory, InventoryError, type CaseMigrationInventoryReceiptV1, type CollectedCaseV1, type InventoryExecutor } from "./inventory.js";
import { hasSuccessfulOwnedProcessResult, runOwnedProcess, type OwnedProcess } from "./owned-process.js";
import { packCandidate } from "./pack.js";
import { copyRepoIsolated, pointAtCandidateTarball } from "./run-repo.js";
import { buildTestkitPackage, injectTestkitDirectory, type TestkitPackage } from "./testkit-snapshot.js";

export interface WorkspaceInventoryReceiptV1 {
  readonly format: "niceeval.e2e-case-workspace-inventory/v1";
  readonly checkout: string;
  readonly repos: readonly { readonly id: string; readonly receipts: readonly CaseMigrationInventoryReceiptV1[] }[];
  readonly files: readonly string[];
  readonly cases: readonly CollectedCaseV1[];
  readonly unassignedCases: readonly {
    readonly executor: InventoryExecutor;
    readonly repo: string;
    readonly path: string;
    readonly project?: string;
    readonly titlePath: readonly string[];
  }[];
  readonly findings: readonly string[];
  readonly digest: `sha256:${string}`;
}

export class WorkspaceInventoryError extends Data.TaggedError("WorkspaceInventoryError")<{
  readonly detail: string;
  readonly receipt?: WorkspaceInventoryReceiptV1;
}> {}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (Predicate.isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const digest = (value: unknown): `sha256:${string}` => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const detail = (cause: unknown): string => cause instanceof Error ? cause.message : Predicate.isObject(cause) && typeof cause.detail === "string" ? cause.detail : String(cause);

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
  cwd,
  env: process.env,
  output: "capture",
  stream: false,
  timeoutMs: 30 * 60_000,
}).pipe(
  Effect.mapError((cause) => new WorkspaceInventoryError({ detail: `${label}: ${cause.detail}` })),
  Effect.flatMap((result) => hasSuccessfulOwnedProcessResult(result)
    ? Effect.succeed(result)
    : Effect.fail(new WorkspaceInventoryError({ detail: `${label} failed (${result.signal ?? `exit ${result.exitCode}`}): ${result.stderr.trim() || result.stdout.trim()}` }))),
);

const prepareRepo = Effect.fn("prepareInventoryRepo")(function*(repo: DiscoveredRepo, checkout: string, scratch: string, candidate: string, testkit: TestkitPackage | undefined) {
  const copy = join(scratch, "repos", repo.manifest.id);
  yield* copyRepoIsolated(repo.dir, copy).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: `${repo.manifest.id}: ${cause.detail}` })));
  yield* pointAtCandidateTarball(copy, candidate).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: `${repo.manifest.id}: ${cause.detail}` })));
  if (repo.manifest.harness?.testkit === true) {
    if (testkit === undefined) return yield* new WorkspaceInventoryError({ detail: `${repo.manifest.id}: Testkit snapshot was not prepared` });
    yield* injectTestkitDirectory(copy, testkit).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: `${repo.manifest.id}: ${cause.detail}` })));
  }
  yield* runRequired(["pnpm", "install", "--no-frozen-lockfile", "--prefer-offline"], copy, `${repo.manifest.id}: install`);
  const executors = yield* installedExecutors(copy);
  const receipts = yield* Effect.forEach(executors, (executor) => collectCaseInventory({ executor, repo: repo.manifest.id, cwd: copy, checkout, nativeArgs: [], forMigration: true }).pipe(
    Effect.catchTag("InventoryError", (cause: InventoryError) => Effect.fail(new WorkspaceInventoryError({ detail: `${repo.manifest.id}/${executor}: ${cause.detail}` }))),
  ), { concurrency: "unbounded" });
  const migrationReceipts = receipts.filter((receipt): receipt is CaseMigrationInventoryReceiptV1 => receipt.format === "niceeval.e2e-case-migration-inventory/v1");
  if (migrationReceipts.length !== receipts.length) return yield* new WorkspaceInventoryError({ detail: `${repo.manifest.id}: collector returned a non-migration receipt` });
  const prefix = `e2e/${repo.manifest.id}`;
  return { id: repo.manifest.id, receipts: migrationReceipts.map((receipt) => {
    const { digest: _digest, ...original } = receipt;
    const unsigned = {
      ...original,
      files: receipt.files.map((path) => `${prefix}/${path}`),
      cases: receipt.cases.map((item) => ({ ...item, path: `${prefix}/${item.path}` })),
      unassigned: receipt.unassigned.map((item) => ({ ...item, file: `${prefix}/${item.file}` })),
    };
    return { ...unsigned, digest: digest(unsigned) };
  }) };
});

export const collectWorkspaceCaseInventory = Effect.fn("collectWorkspaceCaseInventory")(function*(checkout: string) {
  const root = repoRootDir();
  const fs = yield* FileSystem.FileSystem;
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "niceeval-case-inventory-" }).pipe(
    Effect.mapError((cause) => new WorkspaceInventoryError({ detail: `could not create inventory scratch directory: ${cause.message}` })),
  );
  yield* runRequired(["pnpm", "run", "build:package"], root, "build candidate package");
  const candidate = yield* packCandidate(root, join(scratch, "candidate.tgz")).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: cause.detail })));
  const discovered = yield* discoverAllRepos(e2eRootDir()).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: detail(cause) })));
  if (discovered.errors.length > 0) return yield* new WorkspaceInventoryError({ detail: discovered.errors.join("; ") });
  const testkit = discovered.repos.some((repo) => repo.manifest.harness?.testkit === true)
    ? yield* buildTestkitPackage(root, scratch).pipe(Effect.mapError((cause) => new WorkspaceInventoryError({ detail: cause.detail })))
    : undefined;
  const repos = yield* Effect.forEach(discovered.repos, (repo) => prepareRepo(repo, checkout, scratch, candidate.path, testkit), { concurrency: "unbounded" });
  const files = [...new Set(repos.flatMap((repo) => repo.receipts.flatMap((receipt) => receipt.files)))].sort();
  const cases = repos.flatMap((repo) => repo.receipts.flatMap((receipt) => receipt.cases)).sort((left, right) => left.path.localeCompare(right.path) || left.caseId.localeCompare(right.caseId));
  const unassignedCases = repos.flatMap((repo) => repo.receipts.flatMap((receipt) => receipt.unassigned.map((item) => ({
    executor: receipt.executor.name,
    repo: receipt.repo,
    path: item.file,
    ...(item.project === undefined ? {} : { project: item.project }),
    titlePath: item.titlePath,
  })))).sort((left, right) => left.path.localeCompare(right.path) || left.titlePath.join("\0").localeCompare(right.titlePath.join("\0")));
  const unsigned = { format: "niceeval.e2e-case-workspace-inventory/v1" as const, checkout, repos, files, cases, unassignedCases, findings: [] as readonly string[] };
  return { ...unsigned, digest: digest(unsigned) };
});
