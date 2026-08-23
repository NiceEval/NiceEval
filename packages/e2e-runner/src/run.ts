// Root Effect composition for the E2E runtime lane. CLI parsing and runtime
// launch belong to the future command host; this module accepts typed input.
import { join, resolve } from "node:path";
import { FileSystem } from "@effect/platform";
import { Data, Effect, Either, Exit, Option, Scope } from "effect";
import * as Cause from "effect/Cause";
import { discoverAllRepos, e2eRootDir, repoRootDir } from "./discovery.ts";
import { readCandidateTarball } from "./injection.ts";
import { selectRepos } from "./plan.ts";
import {
  buildTestkitPackage,
  verifyTestkitSnapshot,
  type TestkitPackage,
} from "./testkit-snapshot.ts";
import {
  materializeCandidateArtifact,
  runRepoEffect,
  type RepoRunResult,
} from "./run-repo.ts";
import {
  ensureContainedRealDirectory,
  writeContainedUtf8File,
} from "./durable-path.ts";
import type { Category, RepoReceipt, SelectionReceipt } from "./receipt.ts";
import type { OwnedProcess } from "./owned-process.ts";

export { appendNativeArgs } from "./run-repo.ts";
export type { RepoRunResult } from "./run-repo.ts";
export class E2ERunError extends Data.TaggedError("E2ERunError")<{
  readonly detail: string;
}> {}
export interface RunOptions {
  readonly repoIds: readonly string[];
  readonly lane?: import("./contracts.ts").Lane;
  readonly capability?: string;
  readonly candidatePath: string;
  readonly artifactRoot?: string;
  readonly nativeArgs: readonly string[];
  readonly keepWorkdir: boolean;
  readonly repoConcurrency: number;
  readonly selection?: SelectionReceipt;
}
export type ScratchDisposition =
  | {
      readonly kind: "not-created";
      readonly ok: true;
      readonly detail: string;
    }
  | {
      readonly kind: "removed" | "retained";
      readonly ok: true;
      readonly path: string;
      readonly detail: string;
    }
  | {
      readonly kind: "remove-failed";
      readonly ok: false;
      readonly path: string;
      readonly detail: string;
    };
export interface RunnerTerminalSummary {
  readonly category: "pass" | "infra";
  readonly detail: string;
  readonly scratchDisposition: ScratchDisposition;
}
export interface RunSummary {
  readonly artifactRoot: string;
  readonly summaryPath: string;
  readonly results: readonly {
    readonly id: string;
    readonly exitCode: number | null;
    readonly category: Category;
    readonly detail: string;
    readonly artifactDir: string;
    readonly receiptPath: string;
  }[];
  readonly passed: number;
  readonly regression: number;
  readonly infra: number;
  readonly configuration: number;
  readonly cancelled: number;
  readonly total: number;
  readonly category: Category;
  readonly detail: string;
  readonly runner: RunnerTerminalSummary;
  readonly selection?: SelectionReceipt;
}
const errorDetail = (cause: unknown): string =>
  typeof cause === "object" && cause !== null && "detail" in cause && typeof cause.detail === "string"
    ? cause.detail
    : cause instanceof Error
      ? cause.message
      : String(cause);
const rootError = (cause: unknown): E2ERunError =>
  new E2ERunError({
    detail: errorDetail(cause),
  });
const fs = <A>(
  use: (service: FileSystem.FileSystem) => Effect.Effect<A, unknown>,
) =>
  Effect.flatMap(FileSystem.FileSystem, use).pipe(Effect.mapError(rootError));
const category = (
  results: readonly RepoRunResult[],
  runner: RunnerTerminalSummary,
): Category =>
  results.some((result) => result.category === "cancelled")
    ? "cancelled"
    : results.some((result) => result.category === "regression")
      ? "regression"
      : results.some((result) => result.category === "infra")
        ? "infra"
        : results.some((result) => result.category === "configuration")
          ? "configuration"
          : runner.category === "infra"
            ? "infra"
            : "pass";
const failedRepo = (
  repo: import("./discovery.ts").DiscoveredRepo,
  candidate: import("./injection.ts").CandidateTarball,
  artifactRoot: string,
  cause: unknown,
  selection: SelectionReceipt | undefined,
): Effect.Effect<RepoRunResult, E2ERunError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const id = repo.manifest.id;
    const artifactDir = join(artifactRoot, id);
    const receiptPath = join(artifactDir, "receipt.json");
    const detail = Cause.isCause(cause)
      ? Option.match(Cause.failureOption(cause), {
          onNone: () => Cause.pretty(cause),
          onSome: errorDetail,
        })
      : errorDetail(cause);
    yield* ensureContainedRealDirectory(
      artifactRoot,
      artifactDir,
      "failed repo durable artifact directory",
    ).pipe(Effect.mapError(rootError));
    const receipt: RepoReceipt = {
      repoId: id,
      ...(selection === undefined ? {} : { selection }),
      invocationIds: ["runner-operation-failure"],
      testInvocations: 0,
      artifactDir,
      receiptPath,
      stages: [
        {
          stage: "preflight",
          ok: false,
          failureCategory: "infra",
          detail: `runner operational failure: ${detail}`,
        },
        {
          stage: "cleanup",
          ok: false,
          path: join("<unavailable>", id),
          detail:
            "repo workdir disposition unavailable after operational failure",
        },
      ],
      exitCode: null,
      category: "infra",
      detail: `runner operational failure: ${detail}`,
      candidate: {
        sha256: candidate.sha256,
        integrity: candidate.integrity,
        reproduce: [
          "pnpm",
          "e2e",
          "run",
          "--candidate",
          candidate.path,
          "--repo",
          id,
        ].join(" "),
        exactReplay: false,
      },
    };
    yield* writeContainedUtf8File(
      artifactRoot,
      receiptPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
      "failed repo receipt",
    ).pipe(Effect.mapError(rootError));
    return {
      id,
      exitCode: null,
      category: "infra",
      detail: receipt.detail,
      attempts: 0,
      receipt,
      artifactDir,
      receiptPath,
    };
  });
export const buildSummary = (
  artifactRoot: string,
  results: readonly RepoRunResult[],
  runner: RunnerTerminalSummary,
  selection?: SelectionReceipt,
): RunSummary => {
  const overall = category(results, runner);
  const primary = results.find((result) => result.category === overall);
  return {
    artifactRoot,
    summaryPath: join(artifactRoot, "summary.json"),
    results: results.map((result) => ({
      id: result.id,
      exitCode: result.exitCode,
      category: result.category,
      detail: result.detail,
      artifactDir: result.artifactDir,
      receiptPath: result.receiptPath,
    })),
    passed: results.filter((result) => result.category === "pass").length,
    regression: results.filter((result) => result.category === "regression")
      .length,
    infra: results.filter((result) => result.category === "infra").length,
    configuration: results.filter(
      (result) => result.category === "configuration",
    ).length,
    cancelled: results.filter((result) => result.category === "cancelled")
      .length,
    total: results.length,
    category: overall,
    detail:
      primary?.detail ?? (overall === "infra" ? runner.detail : "clean pass"),
    runner,
    ...(selection === undefined ? {} : { selection }),
  };
};

export const runEffect = (
  options: RunOptions,
): Effect.Effect<
  RunSummary,
  E2ERunError,
  FileSystem.FileSystem | OwnedProcess | Scope.Scope
> =>
  Effect.gen(function* () {
    if (
      !Number.isSafeInteger(options.repoConcurrency) ||
      options.repoConcurrency < 1
    )
      return yield* Effect.fail(
        new E2ERunError({
          detail: "repoConcurrency must be a positive integer",
        }),
      );
    if (options.keepWorkdir && process.env.CI !== undefined)
      return yield* Effect.fail(
        new E2ERunError({
          detail: "keepWorkdir is local-only and rejected in CI",
        }),
      );
    const discovered = yield* discoverAllRepos(e2eRootDir()).pipe(
      Effect.mapError(rootError),
    );
    if (discovered.errors.length > 0)
      return yield* Effect.fail(
        new E2ERunError({ detail: discovered.errors.join("; ") }),
      );
    const selected = yield* Either.match(
      selectRepos(discovered.repos, options),
      {
        onLeft: (error) =>
          Effect.fail(new E2ERunError({ detail: error.detail })),
        onRight: Effect.succeed,
      },
    );
    const candidate = yield* readCandidateTarball(
      resolve(options.candidatePath),
    ).pipe(Effect.mapError(rootError));
    const scratch = yield* fs((service) =>
      service.makeTempDirectory({ prefix: "niceeval-e2e-scratch-" }),
    );
    const artifactRoot =
      options.artifactRoot === undefined
        ? yield* fs((service) =>
            service.makeTempDirectory({ prefix: "niceeval-e2e-artifacts-" }),
          )
        : resolve(options.artifactRoot);
    const durableRoot = yield* fs((service) =>
      service.makeDirectory(artifactRoot, { recursive: true }),
    ).pipe(Effect.as(artifactRoot));
    let scratchSettled = false;
    yield* Effect.addFinalizer(() =>
      scratchSettled || options.keepWorkdir
        ? Effect.void
        : fs((service) =>
            service.remove(scratch, { recursive: true, force: true }),
          ).pipe(
            Effect.asVoid,
            Effect.catchAll(() => Effect.void),
          ),
    );
    const materialized = yield* materializeCandidateArtifact(
      durableRoot,
      candidate,
    );
    const sharedTestkit: TestkitPackage | undefined = selected.some(
      (repo) => repo.manifest.harness?.testkit === true,
    )
      ? yield* buildTestkitPackage(repoRootDir(), scratch)
      : undefined;
    if (sharedTestkit !== undefined)
      yield* verifyTestkitSnapshot(sharedTestkit).pipe(
        Effect.mapError(rootError),
      );
    const secretNames = new Set<string>();
    for (const repo of discovered.repos)
      for (const name of repo.manifest.secrets) secretNames.add(name);
    const exits = yield* Effect.forEach(
      selected,
      (repo) =>
        runRepoEffect(
          repo,
          { ...candidate, path: materialized },
          scratch,
          durableRoot,
          secretNames,
          options.nativeArgs,
          sharedTestkit,
          {
            keepWorkdir: options.keepWorkdir,
            ...(options.selection === undefined
              ? {}
              : { selection: options.selection }),
            logPrefix: `[e2e:${repo.manifest.id}] `,
          },
        ).pipe(Effect.exit),
      { concurrency: options.repoConcurrency },
    );
    const results = yield* Effect.forEach(exits, (exit, index) =>
      Exit.isSuccess(exit)
        ? Effect.succeed(exit.value)
        : failedRepo(
            selected[index]!,
            { ...candidate, path: materialized },
            durableRoot,
            exit.cause,
            options.selection,
          ),
    );
    const disposition: ScratchDisposition = options.keepWorkdir
      ? {
          kind: "retained",
          ok: true,
          path: scratch,
          detail: `retained ${scratch} because keepWorkdir was requested`,
        }
      : yield* fs((service) =>
          service.remove(scratch, { recursive: true, force: true }),
        ).pipe(
          Effect.as({
            kind: "removed" as const,
            ok: true as const,
            path: scratch,
            detail: `removed ${scratch}`,
          }),
          Effect.catchAll((error) =>
            Effect.succeed({
              kind: "remove-failed" as const,
              ok: false as const,
              path: scratch,
              detail: `cleanup failed for ${scratch}: ${error.detail}`,
            }),
          ),
        );
    scratchSettled = disposition.ok || options.keepWorkdir;
    const runner: RunnerTerminalSummary = {
      category: disposition.ok ? "pass" : "infra",
      detail: disposition.detail,
      scratchDisposition: disposition,
    };
    const summary = buildSummary(
      durableRoot,
      results,
      runner,
      options.selection,
    );
    yield* fs((service) =>
      service.writeFileString(
        summary.summaryPath,
        `${JSON.stringify(summary, null, 2)}\n`,
      ),
    );
    return summary;
  }).pipe(Effect.mapError(rootError));
