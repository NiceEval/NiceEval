// One Scope-owned isolated repository run. Operational filesystem and process
// faults are typed failures; failed user commands remain receipt data.
import { createHash, randomUUID } from "node:crypto";
import { basename, join, relative, resolve } from "node:path";
import * as FileSystem from "effect/FileSystem";
import { Data, Effect, Result, Scope } from "effect";
import { repoRootDir, type DiscoveredRepo } from "./discovery.ts";
import { formatCause } from "./format-cause.ts";
import { materializeHarnessAssets } from "./harness-assets.ts";
import type { CandidateTarball } from "./injection.ts";
import { verifyInjection } from "./injection.ts";
import {
  collectArtifacts,
  repoArtifactDir,
  repoReceiptPath,
} from "./artifacts.ts";
import {
  assertContainedRegularFile,
  copyIntoContainedFile,
  ensureContainedRealDirectory,
  ensureRealDirectory,
  lstatOptional,
  lstatPath,
  prepareContainedRegularFile,
  writeContainedUtf8File,
} from "./durable-path.ts";
import { preflightBrowsers, preflightHostCapabilities } from "./preflight.ts";
import {
  hasSuccessfulOwnedProcessResult,
  runOwnedProcess,
  type OwnedProcess,
  type OwnedProcessResult,
} from "./owned-process.ts";
import {
  buildChildEnv,
  redactSecretCapture,
  redactSecretStrings,
  sensitiveEnvValues,
} from "./secrets.ts";
import {
  checkTestkitSourceClean,
  injectTestkitDirectory,
  scanForTestkitImports,
  verifyInstalledTestkit,
  verifyTestkitDirectoryResolution,
  verifyTestkitSnapshot,
  type TestkitPackage,
} from "./testkit-snapshot.ts";
import {
  classifyFromReceipt,
  hasUnconfirmedOwnedGroup,
  retainCapture,
  type Category,
  type CommandCapture,
  type RepoReceipt,
  type SelectionReceipt,
  type StageReceipt,
  type TestkitReceipt,
} from "./receipt.ts";

export interface RepoRunResult {
  readonly id: string;
  readonly exitCode: number | null;
  readonly category: Category;
  readonly detail: string;
  readonly attempts: number;
  readonly receipt: RepoReceipt;
  readonly artifactDir: string;
  readonly receiptPath: string;
}
export class RepoRunError extends Data.TaggedError("RepoRunError")<{
  readonly repoId: string;
  readonly operation: "candidate" | "command" | "run";
  readonly detail: string;
}> {}
const problem = (
  repoId: string,
  operation: RepoRunError["operation"],
  cause: unknown,
) =>
  new RepoRunError({
    repoId,
    operation,
    detail:
      typeof cause === "object" &&
      cause !== null &&
      "detail" in cause &&
      typeof cause.detail === "string"
        ? cause.detail
        : cause instanceof Error
          ? cause.message
          : String(cause),
  });
const fs = <A>(
  repoId: string,
  operation: RepoRunError["operation"],
  use: (service: FileSystem.FileSystem) => Effect.Effect<A, unknown>,
) =>
  Effect.flatMap(FileSystem.FileSystem, use).pipe(
    Effect.mapError((cause) => problem(repoId, operation, cause)),
  );
const durable = <A>(
  repoId: string,
  effect: Effect.Effect<A, { readonly detail: string }, FileSystem.FileSystem>,
) => effect.pipe(Effect.mapError((cause) => problem(repoId, "run", cause)));
export const appendNativeArgs = (
  command: readonly string[],
  nativeArgs: readonly string[],
): readonly string[] => [...command, ...nativeArgs];
export const E2E_COPY_EXCLUDED_BASENAMES = new Set([
  "node_modules",
  ".niceeval",
  ".git",
  ".env",
  ".e2e-artifacts",
  ".e2e-diagnostics",
]);

export const materializeCandidateArtifact = (
  artifactRoot: string,
  candidate: CandidateTarball,
): Effect.Effect<string, RepoRunError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const targetDir = yield* durable(
      "<candidate>",
      ensureContainedRealDirectory(
        artifactRoot,
        join(artifactRoot, "candidate"),
        "durable candidate directory",
      ),
    );
    const target = join(
      targetDir,
      `niceeval-candidate-${candidate.sha256}.tgz`,
    );
    const prepared = yield* durable(
      "<candidate>",
      prepareContainedRegularFile(
        artifactRoot,
        target,
        "durable candidate artifact",
      ),
    );
    const present = yield* durable("<candidate>", lstatOptional(prepared));
    const digest = (bytes: Uint8Array): string =>
      createHash("sha256").update(bytes).digest("hex");
    if (
      present === undefined ||
      digest(
        yield* fs("<candidate>", "candidate", (service) =>
          service.readFile(prepared),
        ),
      ) !== candidate.sha256
    )
      yield* durable(
        "<candidate>",
        copyIntoContainedFile(
          artifactRoot,
          candidate.path,
          prepared,
          "durable candidate artifact",
        ),
      );
    yield* durable(
      "<candidate>",
      assertContainedRegularFile(
        artifactRoot,
        prepared,
        "durable candidate artifact",
      ),
    );
    if (
      digest(
        yield* fs("<candidate>", "candidate", (service) =>
          service.readFile(prepared),
        ),
      ) !== candidate.sha256
    )
      return yield* Effect.fail(
        problem(
          "<candidate>",
          "candidate",
          `durable candidate artifact at ${prepared} does not match sha256:${candidate.sha256}`,
        ),
      );
    return prepared;
  });

const copyIsolatedEntry = (
  source: string,
  destination: string,
): Effect.Effect<void, RepoRunError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const stat = yield* lstatPath(source).pipe(
      Effect.mapError((cause) => problem("<copy>", "run", cause)),
    );

    if (stat.isSymbolicLink()) {
      return yield* Effect.fail(
        problem(
          "<copy>",
          "run",
          `isolated source symlink is not allowed: ${source}`,
        ),
      );
    }
    if (stat.isFile()) {
      yield* fs("<copy>", "run", (service) =>
        service.copyFile(source, destination),
      );
      return;
    }
    if (!stat.isDirectory()) {
      return yield* Effect.fail(
        problem(
          "<copy>",
          "run",
          `isolated source special file is not allowed: ${source}`,
        ),
      );
    }

    yield* fs("<copy>", "run", (service) =>
      service.makeDirectory(destination, { recursive: true }),
    );
    const entries = yield* fs("<copy>", "run", (service) =>
      service.readDirectory(source),
    );
    for (const entry of entries.sort((left, right) =>
      left.localeCompare(right),
    )) {
      if (E2E_COPY_EXCLUDED_BASENAMES.has(basename(entry))) continue;
      yield* copyIsolatedEntry(join(source, entry), join(destination, entry));
    }
  });

/** Copy only permitted source entries; excluded names are never read or copied. */
export const copyRepoIsolated = (
  source: string,
  destination: string,
): Effect.Effect<void, RepoRunError, FileSystem.FileSystem> =>
  copyIsolatedEntry(source, destination);
export const pointAtCandidateTarball = (
  copyDir: string,
  tarball: string,
): Effect.Effect<void, RepoRunError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const path = join(copyDir, "package.json");
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(
        yield* fs("<copy>", "run", (service) => service.readFileString(path)),
      ) as Record<string, unknown>;
    } catch (cause) {
      return yield* Effect.fail(problem("<copy>", "run", cause));
    }
    let found = false;
    for (const field of ["dependencies", "devDependencies"]) {
      const deps = value[field];
      if (
        deps !== null &&
        typeof deps === "object" &&
        Object.hasOwn(deps as object, "niceeval")
      ) {
        (deps as Record<string, string>).niceeval = `file:${tarball}`;
        found = true;
      }
    }
    if (!found)
      return yield* Effect.fail(
        problem(
          "<copy>",
          "run",
          `${copyDir}/package.json declares no niceeval dependency`,
        ),
      );
    yield* fs("<copy>", "run", (service) =>
      service.writeFileString(path, `${JSON.stringify(value, null, 2)}\n`),
    );
  });
export const captureOwnedProcess = (result: OwnedProcessResult): CommandCapture => ({
  exitCode: result.exitCode,
  signal: result.signal,
  timedOut: result.timedOut,
  cancelled: result.cancelled,
  stdout: result.stdout,
  stderr: result.stderr,
  ...(result.error === undefined ? {} : { error: result.error }),
  processGroupOwned: result.processGroupOwned,
  groupCleanup: result.groupCleanup,
});
export const runCommand = (
  command: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  prefix?: string,
): Effect.Effect<CommandCapture, RepoRunError, OwnedProcess | Scope.Scope> =>
  runOwnedProcess(command, {
    cwd,
    env,
    output: "capture",
    stream: true,
    timeoutMs,
    ...(prefix === undefined ? {} : { streamPrefix: prefix }),
  }).pipe(
    Effect.map(captureOwnedProcess),
    Effect.mapError((cause) => problem("<command>", "command", cause)),
  );

export interface RunRepoOptions {
  readonly sourceDir?: string;
  readonly runLabel?: string;
  readonly workdirKey?: string;
  readonly testRuns?: number;
  readonly copyId?: string;
  readonly sourceSnapshotDigest?: string;
  readonly keepWorkdir?: boolean;
  readonly logPrefix?: string;
  readonly selection?: SelectionReceipt;
}
const stage = (stages: StageReceipt[], value: StageReceipt): void => {
  stages.push(value);
};
export const commandCaptureOk = (value: CommandCapture): boolean =>
  value.exitCode === 0 &&
  !value.timedOut &&
  !value.cancelled &&
  value.error === undefined &&
  !hasUnconfirmedOwnedGroup(value);
export const withInvocation = (
  env: NodeJS.ProcessEnv,
  id: string,
  copy: string,
  harnessEnvironment: Readonly<Record<string, string>> = {},
  artifactStagingRoot: string = join(copy, ".e2e-artifacts"),
): NodeJS.ProcessEnv => ({
  ...env,
  NICEEVAL_E2E_INVOCATION_ID: id,
  NICEEVAL_E2E_ARTIFACT_STAGING_ROOT: artifactStagingRoot,
  ...harnessEnvironment,
});

const collectStage = (
  copy: string,
  artifactDir: string,
  patterns: readonly string[],
  stages: StageReceipt[],
  detailPrefix = "",
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.exit(collectArtifacts(copy, artifactDir, patterns)).pipe(
    Effect.tap((outcome) =>
      Effect.sync(() => {
        if (outcome._tag === "Success") {
          stage(stages, {
            stage: "collect",
            ok: true,
            collected: outcome.value.collected,
            detail: `${detailPrefix}artifact collection completed`,
          });
        } else {
          stage(stages, {
            stage: "collect",
            ok: false,
            detail: `${detailPrefix}artifact collection failed: ${formatCause(outcome.cause)}`,
          });
        }
      }),
    ),
    Effect.asVoid,
  );

export const runRepoEffect = (
  repo: DiscoveredRepo,
  candidate: CandidateTarball,
  scratchRoot: string,
  artifactRoot: string,
  allSecretNames: ReadonlySet<string>,
  nativeArgs: readonly string[],
  testkit?: TestkitPackage,
  options: RunRepoOptions = {},
): Effect.Effect<
  RepoRunResult,
  RepoRunError,
  FileSystem.FileSystem | OwnedProcess | Scope.Scope
> =>
  Effect.gen(function* () {
    const id = repo.manifest.id;
    const copy = join(scratchRoot, "runs", options.workdirKey ?? id);
    const stages: StageReceipt[] = [];
    const invocationIds: [string, ...string[]] = [randomUUID()];
    const secretValues = sensitiveEnvValues(process.env);
    const runs = options.testRuns ?? 1;
    const consumesTestkit = repo.manifest.harness?.testkit === true;
    if (!Number.isSafeInteger(runs) || runs < 1)
      return yield* Effect.fail(
        problem(id, "run", "testRuns must be a positive integer"),
      );
    const durableRoot = yield* durable(
      id,
      ensureRealDirectory(artifactRoot, "repo durable artifact root"),
    );
    const scopedRoot =
      options.runLabel === undefined
        ? durableRoot
        : yield* durable(
            id,
            ensureContainedRealDirectory(
              durableRoot,
              join(durableRoot, options.runLabel),
              "takeover durable artifact scope",
            ),
          );
    const artifactDir = repoArtifactDir(scopedRoot, id);
    const receiptPath = repoReceiptPath(scopedRoot, id);
    yield* durable(
      id,
      ensureContainedRealDirectory(
        scopedRoot,
        artifactDir,
        "repo durable artifact directory",
      ),
    );
    const tarball = yield* durable(
      id,
      assertContainedRegularFile(
        durableRoot,
        candidate.path,
        "durable candidate artifact",
      ),
    );
    const baseEnv = buildChildEnv(
      process.env,
      allSecretNames,
      repo.manifest.secrets,
      id,
    );
    const setup = invocationIds[0]!;
    const preflight = yield* preflightHostCapabilities(
      repo.manifest,
      withInvocation(baseEnv, setup, copy),
    ).pipe(Effect.mapError((cause) => problem(id, "run", cause)));
    stage(stages, {
      stage: "preflight",
      ok: preflight.ok,
      invocationId: setup,
      ...(preflight.cancelled ? { cancelled: true } : {}),
      checks: preflight.checks.map((check) => ({
        ...check,
        ...(check.command === undefined
          ? {}
          : { command: redactSecretStrings(check.command, secretValues) }),
        ...(check.capture === undefined
          ? {}
          : { capture: redactSecretCapture(check.capture, secretValues) }),
      })),
      ...(preflight.failureCategory === undefined
        ? {}
        : { failureCategory: preflight.failureCategory }),
      detail: preflight.cancelled
        ? "cancelled during capability preflight"
        : preflight.ok
          ? "declared host capabilities available"
          : "capability preflight failed",
    });
    let exitCode: number | null = null;
    let testkitResolvedPath: string | undefined;
    if (preflight.ok) {
      yield* copyRepoIsolated(options.sourceDir ?? repo.dir, copy);
      const declaredAssets = repo.manifest.harness?.assets ?? [];
      const harnessResult = yield* Effect.result(
        materializeHarnessAssets(repoRootDir(), copy, declaredAssets),
      );
      const harness = Result.isSuccess(harnessResult)
        ? harnessResult.success
        : { assets: [] as const, environment: {} };
      const harnessViolation = Result.isFailure(harnessResult)
        ? `harness asset ${harnessResult.failure.asset} ${harnessResult.failure.operation} failed: ${harnessResult.failure.detail}`
        : undefined;
      const clean = yield* checkTestkitSourceClean(copy).pipe(
        Effect.mapError((cause) => problem(id, "run", cause)),
      );
      const imports = consumesTestkit
        ? []
        : yield* scanForTestkitImports(copy).pipe(
            Effect.mapError((cause) => problem(id, "run", cause)),
          );
      const violations = [
        ...(harnessViolation === undefined ? [] : [harnessViolation]),
        ...clean,
        ...(consumesTestkit && testkit === undefined
          ? ["harness.testkit declared but no snapshot was supplied"]
          : []),
        ...imports,
      ];
      stage(stages, {
        stage: "prepare",
        ok: violations.length === 0,
        assets: harness.assets,
        detail:
          violations.length === 0
            ? harness.assets.length === 0
              ? "source clean; no harness assets declared"
              : `source clean; materialized harness assets: ${harness.assets.join(", ")}`
            : `prepare failed: ${violations.join("; ")}`,
      });
      if (violations.length === 0) {
        yield* pointAtCandidateTarball(copy, tarball);
        if (testkit !== undefined && consumesTestkit) {
          yield* verifyTestkitSnapshot(testkit).pipe(
            Effect.mapError((cause) => problem(id, "run", cause)),
          );
          yield* injectTestkitDirectory(copy, testkit).pipe(
            Effect.mapError((cause) => problem(id, "run", cause)),
          );
        }
        const installCommand = ["pnpm", "install", "--no-frozen-lockfile", "--prefer-offline"] as [
          string,
          ...string[],
        ];
        const install = yield* runCommand(
          installCommand,
          copy,
          withInvocation(
            buildChildEnv(process.env, allSecretNames, []),
            setup,
            copy,
            harness.environment,
          ),
          30 * 60_000,
          options.logPrefix,
        );
        const installOk = commandCaptureOk(install);
        stage(stages, {
          stage: "install",
          ok: installOk,
          invocationId: setup,
          ...(install.cancelled ? { cancelled: true } : {}),
          command: installCommand,
          capture: retainCapture(
            redactSecretCapture(install, secretValues),
            installOk,
          ),
          detail: install.cancelled
            ? "cancelled during pnpm install"
            : installOk
              ? "pnpm install ok"
              : "pnpm install failed",
        });
        if (installOk) {
          const injection = yield* Effect.exit(
            Effect.gen(function* () {
              const lockText = yield* fs(id, "run", (service) =>
                service.readFileString(join(copy, "pnpm-lock.yaml")),
              );
              const candidateVerdict = verifyInjection(
                lockText,
                candidate.integrity,
              );
              if (!candidateVerdict.ok)
                return { ok: false as const, detail: candidateVerdict.reason };

              const effectPackagePath = join(copy, "node_modules", "effect", "package.json");
              const [effectPackage, effectRealPath] = yield* Effect.all([
                fs(id, "run", (service) => service.readFileString(effectPackagePath)),
                fs(id, "run", (service) => service.realPath(effectPackagePath)),
              ]);
              const virtualStore = resolve(copy, "node_modules", ".pnpm");
              if (!effectRealPath.startsWith(`${virtualStore}/`))
                return { ok: false as const, detail: `Effect resolution escapes the isolated pnpm virtual store: ${effectRealPath}` };
              if (!/"version"\s*:\s*"4\.0\.0-rc\.112"/.test(effectPackage))
                return { ok: false as const, detail: `Effect resolution is not effect@4.0.0-rc.112: ${effectRealPath}` };
              if (/(?:^|\n)\s*(?:effect|@effect\/[^:]+)@(?:3\.|4\.0\.0-(?!rc\.112))/m.test(lockText))
                return { ok: false as const, detail: "installed dependency graph contains an Effect v3 or mismatched Effect v4 resolution" };

              if (!consumesTestkit || testkit === undefined) {
                return { ok: true as const };
              }
              const lockVerdict = verifyTestkitDirectoryResolution(
                lockText,
                testkit.path,
                copy,
              );
              if (!lockVerdict.ok)
                return { ok: false as const, detail: lockVerdict.reason };
              const installed = yield* verifyInstalledTestkit(
                copy,
                testkit,
              ).pipe(Effect.mapError((cause) => problem(id, "run", cause)));
              if (!installed.ok)
                return { ok: false as const, detail: installed.reason };
              testkitResolvedPath = relative(copy, installed.installedPath);
              return { ok: true as const };
            }),
          );
          const injectionOk =
            injection._tag === "Success" && injection.value.ok;
          const injectionDetail =
            injection._tag === "Success"
              ? injection.value.ok
                ? "candidate integrity matches lockfile"
                : `injection verification failed: ${injection.value.detail}`
              : `injection verification failed: ${formatCause(injection.cause)}`;
          stage(stages, {
            stage: "injection",
            ok: injectionOk,
            invocationId: setup,
            detail: injectionDetail,
          });
          if (injectionOk) {
            const browser = yield* preflightBrowsers(
              repo.manifest.requires?.browsers,
              copy,
              withInvocation(baseEnv, setup, copy),
            ).pipe(Effect.mapError((cause) => problem(id, "run", cause)));
            if (repo.manifest.requires?.browsers !== undefined) {
              stage(stages, {
                stage: "browser",
                ok: browser.ok,
                invocationId: setup,
                ...(browser.cancelled ? { cancelled: true } : {}),
                ...(browser.failureCategory === undefined
                  ? {}
                  : { failureCategory: browser.failureCategory }),
                checks: browser.checks,
                detail: browser.cancelled
                  ? "cancelled during browser preflight"
                  : browser.ok
                    ? "declared browser capabilities available"
                    : "browser preflight failed",
              });
            }
            const runTests = (
              attempt: number,
            ): Effect.Effect<void, RepoRunError, OwnedProcess | Scope.Scope> =>
              attempt > runs || !browser.ok
                ? Effect.void
                : Effect.gen(function* () {
                    const invocation = randomUUID();
                    invocationIds.push(invocation);
                    const command = [
                      ...repo.manifest.command,
                      ...nativeArgs,
                    ] as [string, ...string[]];
                    const result = yield* runCommand(
                      command,
                      copy,
                      withInvocation(
                        baseEnv,
                        invocation,
                        copy,
                        harness.environment,
                      ),
                      repo.manifest.timeoutMinutes * 60_000,
                      options.logPrefix,
                    );
                    exitCode = result.exitCode;
                    const ok = commandCaptureOk(result);
                    stage(stages, {
                      stage: "test",
                      attempt,
                      invocationId: invocation,
                      ok,
                      ...(result.cancelled ? { cancelled: true } : {}),
                      command: redactSecretStrings(command, secretValues),
                      capture: retainCapture(
                        redactSecretCapture(result, secretValues),
                        ok,
                      ),
                      detail: result.cancelled
                        ? `cancelled during test invocation ${attempt}`
                        : ok
                          ? `test invocation ${attempt} exited 0`
                          : `test invocation ${attempt} failed`,
                    });
                    if (!result.cancelled) yield* runTests(attempt + 1);
                  });
            yield* runTests(1);
          }
          yield* collectStage(
            copy,
            artifactDir,
            repo.manifest.artifacts,
            stages,
          );
        }
      }
    }
    const cancelled = stages.some(
      (entry) => entry.cancelled === true || entry.capture?.cancelled === true,
    );
    const copied = yield* fs(id, "run", (service) => service.exists(copy));
    if (
      cancelled &&
      copied &&
      !stages.some((entry) => entry.stage === "collect")
    ) {
      yield* collectStage(
        copy,
        artifactDir,
        repo.manifest.artifacts,
        stages,
        "after cancellation: ",
      );
    }

    let cleanupDetail = !copied
      ? "no isolated working copy was created"
      : options.keepWorkdir === true
        ? `retained ${copy} because keep-workdir was requested`
        : `removed ${copy}`;
    let cleanupOk = true;
    if (options.keepWorkdir !== true && copied) {
      const outcome = yield* Effect.exit(
        fs(id, "run", (service) =>
          service.remove(copy, { recursive: true, force: true }),
        ),
      );
      if (outcome._tag === "Failure") {
        cleanupOk = false;
        cleanupDetail = `cleanup failed for ${copy}: ${formatCause(outcome.cause)}`;
      }
    }
    if (consumesTestkit && testkit !== undefined) {
      const snapshot = yield* Effect.exit(verifyTestkitSnapshot(testkit));
      if (snapshot._tag === "Failure") {
        cleanupOk = false;
        cleanupDetail += `; Testkit snapshot changed: ${formatCause(snapshot.cause)}`;
      }
    }
    stage(stages, {
      stage: "cleanup",
      ok: cleanupOk,
      path: copy,
      detail: cleanupDetail,
    });
    const classified = classifyFromReceipt({ stages, detail: "" });
    const retained = (yield* durable(id, lstatOptional(tarball))) !== undefined;
    const testkitReceipt: TestkitReceipt | undefined =
      consumesTestkit &&
      testkit !== undefined &&
      testkitResolvedPath !== undefined
        ? {
            version: testkit.version,
            sourcePath: testkit.sourcePath,
            resolvedPath: testkitResolvedPath,
            digest: testkit.digest,
          }
        : undefined;
    const receipt: RepoReceipt = {
      repoId: id,
      ...(options.selection === undefined
        ? {}
        : { selection: options.selection }),
      invocationIds,
      testInvocations: stages.filter((value) => value.stage === "test").length,
      ...(options.copyId === undefined ? {} : { copyId: options.copyId }),
      ...(options.runLabel === undefined ? {} : { runLabel: options.runLabel }),
      ...(options.sourceSnapshotDigest === undefined
        ? {}
        : { sourceSnapshotDigest: options.sourceSnapshotDigest }),
      artifactDir,
      receiptPath,
      stages,
      exitCode,
      category: classified.category,
      detail: classified.detail,
      candidate: {
        sha256: candidate.sha256,
        integrity: candidate.integrity,
        ...(retained ? { artifactPath: relative(durableRoot, tarball) } : {}),
        reproduce: [
          "pnpm",
          "e2e",
          "run",
          "--candidate",
          tarball,
          "--repo",
          id,
        ].join(" "),
        exactReplay: retained,
      },
      ...(testkitReceipt === undefined ? {} : { testkit: testkitReceipt }),
    };
    yield* durable(
      id,
      writeContainedUtf8File(
        scopedRoot,
        receiptPath,
        `${JSON.stringify(receipt, null, 2)}\n`,
        "repo receipt",
      ),
    );
    return {
      id,
      exitCode,
      category: receipt.category,
      detail: receipt.detail,
      attempts: receipt.testInvocations,
      receipt,
      artifactDir,
      receiptPath,
    };
  });
