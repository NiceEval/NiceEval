import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import * as FileSystem from "effect/FileSystem";
import { Data, Effect, Result, Schema, SchemaIssue, Ref, Scope } from "effect";

import {
  decodeRepoReceipt,
  decodeRunSummary,
  type CandidateIdentity,
  type CommandCapture,
  type RepoReceipt,
  type RunSummary,
} from "./contracts.ts";
import { discoverAllRepos, e2eRootDir, type DiscoveredRepo } from "./discovery.ts";
import {
  assertContainedRealDirectory,
  assertContainedRegularFile,
  assertRealDirectory,
  ensureContainedRealDirectory,
  lstatOptional,
  lstatPath,
  writeContainedUtf8File,
} from "./durable-path.ts";
import { inspectMaterializedHarnessAssets } from "./harness-assets.ts";
import { readCandidateTarball, verifyInjection } from "./injection.ts";
import type { OwnedProcess } from "./owned-process.ts";
import {
  appendNativeArgs,
  commandCaptureOk,
  copyRepoIsolated,
  runCommand,
  withInvocation,
} from "./run-repo.ts";
import {
  buildChildEnv,
  redactSecretCapture,
  redactSecretStrings,
  sensitiveEnvValues,
} from "./secrets.ts";
import {
  verifyInstalledTestkit,
  verifyTestkitDirectoryResolution,
  verifyTestkitSnapshot,
  type TestkitPackage,
} from "./testkit-snapshot.ts";

export type DiagnosticMode = "test" | "exec";

export interface DiagnoseOptions {
  readonly mode: DiagnosticMode;
  readonly summaryPath: string;
  readonly repoId: string;
  readonly timeoutSeconds: number;
  readonly argv: readonly string[];
}

export interface FreshCopyCleanup {
  readonly kind: "not-created" | "removed" | "remove-failed";
  readonly ok: boolean;
  readonly path?: string;
  readonly detail: string;
}

export interface DiagnosticSummary {
  readonly diagnostic: true;
  readonly mode: DiagnosticMode;
  readonly ok: boolean;
  readonly detail: string;
  readonly repoId: string;
  readonly invocationId: string;
  readonly sourceSummaryPath: string;
  readonly sourceReceiptPath: string;
  readonly retainedScratchPath: string;
  readonly retainedCopyPath: string;
  readonly cwd: string;
  readonly artifactNamespace: string;
  readonly diagnosticPath: string;
  readonly argv: readonly string[];
  readonly command: readonly string[];
  readonly timeoutSeconds: number;
  readonly candidate: CandidateIdentity;
  readonly capture: CommandCapture;
  readonly identityVerification: {
    readonly before: "verified";
    readonly after: "verified" | "failed";
    readonly detail: string;
  };
  readonly freshCopyCleanup: FreshCopyCleanup;
}

export class E2EDiagnosticError extends Data.TaggedError("E2EDiagnosticError")<{
  readonly detail: string;
}> {}

const detail = (cause: unknown): string =>
  typeof cause === "object" && cause !== null && "detail" in cause && typeof cause.detail === "string"
    ? cause.detail
    : cause instanceof Error
      ? cause.message
      : String(cause);
const failure = (message: string): E2EDiagnosticError => new E2EDiagnosticError({ detail: message });
const fs = <A>(use: (service: FileSystem.FileSystem) => Effect.Effect<A, unknown>) =>
  Effect.flatMap(FileSystem.FileSystem, use).pipe(
    Effect.mapError((cause) => failure(detail(cause))),
  );
const secure = <A>(effect: Effect.Effect<A, { readonly detail: string }, FileSystem.FileSystem>) =>
  effect.pipe(Effect.mapError((cause) => failure(cause.detail)));
const decodeError = (label: string, error: import("./contracts.ts").ContractDecodeError): E2EDiagnosticError =>
  failure(`${label} failed schema decoding: ${SchemaIssue.makeFormatterDefault()(error.issue.issue)}`);

const readUnknownJson = (
  path: string,
  label: string,
): Effect.Effect<unknown, E2EDiagnosticError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const stat = yield* secure(lstatPath(path));
    if (!stat.isFile() || stat.isSymbolicLink())
      return yield* Effect.fail(failure(`${label} must be a regular non-symlink file: ${path}`));
    const text = yield* fs((service) => service.readFileString(path));
    return yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause) => failure(`${label} is not valid JSON: ${detail(cause)}`),
    });
  });

const readSummary = (path: string): Effect.Effect<RunSummary, E2EDiagnosticError, FileSystem.FileSystem> =>
  Effect.flatMap(readUnknownJson(path, "run summary"), (raw) =>
    Result.match(decodeRunSummary(raw), {
      onFailure: (error) => Effect.fail(decodeError("run summary", error)),
      onSuccess: Effect.succeed,
    }),
  );

const readReceipt = (path: string): Effect.Effect<RepoReceipt, E2EDiagnosticError, FileSystem.FileSystem> =>
  Effect.flatMap(readUnknownJson(path, "repo receipt"), (raw) =>
    Result.match(decodeRepoReceipt(raw), {
      onFailure: (error) => Effect.fail(decodeError("repo receipt", error)),
      onSuccess: Effect.succeed,
    }),
  );

const contained = (root: string, path: string): boolean => {
  const tail = relative(resolve(root), resolve(path));
  return tail !== "" && tail !== ".." && !tail.startsWith(`..${sep}`);
};

interface TrustedRun {
  readonly summary: RunSummary;
  readonly receipt: RepoReceipt;
  readonly repo: DiscoveredRepo;
  readonly scratch: string;
  readonly copy: string;
  readonly artifactRoot: string;
  readonly allSecretNames: ReadonlySet<string>;
}

const verifyIdentity = (
  trusted: Pick<TrustedRun, "receipt" | "scratch">,
  copy: string,
): Effect.Effect<void, E2EDiagnosticError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const lockPath = yield* secure(
      assertContainedRegularFile(copy, join(copy, "pnpm-lock.yaml"), "retained candidate lockfile"),
    );
    const lockText = yield* fs((service) => service.readFileString(lockPath));
    const candidate = verifyInjection(lockText, trusted.receipt.candidate.integrity);
    if (!candidate.ok) return yield* Effect.fail(failure(candidate.reason));

    const testkitReceipt = trusted.receipt.testkit;
    if (testkitReceipt === undefined) return;
    const snapshotPath = yield* secure(
      assertContainedRealDirectory(
        trusted.scratch,
        join(trusted.scratch, "testkit", "package"),
        "retained Testkit snapshot",
      ),
    );
    const testkit: TestkitPackage = {
      path: snapshotPath,
      sourcePath: testkitReceipt.sourcePath,
      name: "@niceeval/testkit",
      version: testkitReceipt.version,
      digest: testkitReceipt.digest,
    };
    yield* verifyTestkitSnapshot(testkit).pipe(Effect.mapError((cause) => failure(cause.detail)));
    const resolution = verifyTestkitDirectoryResolution(lockText, snapshotPath, copy);
    if (!resolution.ok) return yield* Effect.fail(failure(resolution.reason));
    const installed = yield* verifyInstalledTestkit(copy, testkit).pipe(
      Effect.mapError((cause) => failure(cause.detail)),
    );
    if (!installed.ok) return yield* Effect.fail(failure(installed.reason));
    if (relative(copy, installed.installedPath) !== testkitReceipt.resolvedPath)
      return yield* Effect.fail(failure("installed Testkit path does not match the retained receipt"));
  });

const loadTrustedRun = (
  options: DiagnoseOptions,
): Effect.Effect<TrustedRun, E2EDiagnosticError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const from = resolve(options.summaryPath);
    const summary = yield* readSummary(from);
    if (resolve(summary.summaryPath) !== from)
      return yield* Effect.fail(failure(`--from does not match summaryPath: ${summary.summaryPath}`));
    const artifactRoot = resolve(summary.artifactRoot);
    yield* secure(assertRealDirectory(artifactRoot, "run artifact root"));
    if (from !== join(artifactRoot, "summary.json"))
      return yield* Effect.fail(failure("--from must be the retained run artifact root's existing summary.json"));
    const disposition = summary.runner.scratchDisposition;
    if (disposition.kind !== "retained")
      return yield* Effect.fail(failure("diagnose requires a summary whose scratch disposition is retained"));
    const declaredScratch = resolve(disposition.path);
    const scratch = yield* secure(assertRealDirectory(declaredScratch, "retained scratch root"));
    const matches = summary.results.filter((result) => result.id === options.repoId);
    if (matches.length !== 1)
      return yield* Effect.fail(failure(`summary must contain exactly one result for repo ${JSON.stringify(options.repoId)}`));
    const result = matches[0]!;
    yield* secure(assertContainedRealDirectory(artifactRoot, result.artifactDir, "repo artifact directory"));
    if (!contained(artifactRoot, result.artifactDir))
      return yield* Effect.fail(failure("repo artifact directory must be below the run artifact root"));
    const declaredReceiptPath = resolve(result.receiptPath);
    const receiptPath = yield* secure(
      assertContainedRegularFile(artifactRoot, result.receiptPath, "repo receipt"),
    );
    if (dirname(declaredReceiptPath) !== resolve(result.artifactDir))
      return yield* Effect.fail(failure("summary receiptPath is not inside its matching artifactDir"));
    const receipt = yield* readReceipt(receiptPath);
    if (
      receipt.repoId !== result.id ||
      resolve(receipt.receiptPath) !== resolve(result.receiptPath) ||
      resolve(receipt.artifactDir) !== resolve(result.artifactDir) ||
      receipt.category !== result.category ||
      receipt.exitCode !== result.exitCode ||
      receipt.detail !== result.detail ||
      JSON.stringify(receipt.selection) !== JSON.stringify(summary.selection)
    ) return yield* Effect.fail(failure("repo result and receipt do not describe the same formal run"));

    const cleanup = receipt.stages.filter((stage) => stage.stage === "cleanup");
    if (cleanup.length !== 1 || cleanup[0]!.ok !== true || cleanup[0]!.path === undefined)
      return yield* Effect.fail(failure("repo receipt has no single successful retained cleanup stage"));
    const copy = yield* secure(
      assertContainedRealDirectory(declaredScratch, cleanup[0]!.path, "retained scenario copy"),
    );
    if (!contained(declaredScratch, cleanup[0]!.path))
      return yield* Effect.fail(failure("retained scenario copy must be below the retained scratch root"));

    if (!receipt.candidate.exactReplay || receipt.candidate.artifactPath === undefined)
      return yield* Effect.fail(failure("repo receipt does not retain exact candidate bytes"));
    const candidatePath = yield* secure(
      assertContainedRegularFile(
        artifactRoot,
        join(artifactRoot, receipt.candidate.artifactPath),
        "retained candidate artifact",
      ),
    );
    const candidate = yield* readCandidateTarball(candidatePath).pipe(
      Effect.mapError((cause) => failure(cause.detail)),
    );
    if (candidate.sha256 !== receipt.candidate.sha256 || candidate.integrity !== receipt.candidate.integrity)
      return yield* Effect.fail(failure("retained candidate bytes do not match the repo receipt"));

    const discovery = yield* discoverAllRepos(e2eRootDir()).pipe(
      Effect.mapError((cause) => failure(detail(cause))),
    );
    if (discovery.errors.length > 0)
      return yield* Effect.fail(failure(discovery.errors.join("; ")));
    const repos = discovery.repos.filter((repo) => repo.manifest.id === options.repoId);
    if (repos.length !== 1)
      return yield* Effect.fail(failure(`current checkout has no unique repo ${JSON.stringify(options.repoId)}`));
    const repo = repos[0]!;
    const testStages = receipt.stages.filter((stage) => stage.stage === "test");
    if (
      testStages.length === 0 ||
      testStages.some((stage) =>
        stage.command === undefined ||
        stage.command.length < repo.manifest.command.length ||
        repo.manifest.command.some((part, index) => stage.command![index] !== part)
      )
    ) return yield* Effect.fail(failure("current repo manifest command does not match the formal receipt test command prefix"));
    const prepareStages = receipt.stages.filter((stage) => stage.stage === "prepare");
    const declaredAssets = repo.manifest.harness?.assets ?? [];
    if (
      prepareStages.length !== 1 ||
      JSON.stringify(prepareStages[0]!.assets ?? []) !== JSON.stringify(declaredAssets)
    ) return yield* Effect.fail(failure("current repo harness assets do not match the formal receipt prepare stage"));
    const allSecretNames = new Set<string>();
    for (const repo of discovery.repos)
      for (const name of repo.manifest.secrets) allSecretNames.add(name);
    const trusted = { summary, receipt, repo, scratch, copy, artifactRoot, allSecretNames };
    yield* verifyIdentity(trusted, trusted.copy);
    return trusted;
  });

const cleanupFreshCopy = (
  copy: string,
  state: Ref.Ref<FreshCopyCleanup>,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.exit(fs((service) => service.remove(copy, { recursive: true, force: true }))).pipe(
    Effect.flatMap((exit) =>
      Ref.set(
        state,
        exit._tag === "Success"
          ? { kind: "removed", ok: true, path: copy, detail: `removed short-lived diagnostic copy ${copy}` }
          : { kind: "remove-failed", ok: false, path: copy, detail: `could not remove short-lived diagnostic copy ${copy}: ${detail(exit.cause)}` },
      ),
    ),
  );

interface ExecutionResult {
  readonly cwd: string;
  readonly artifactNamespace: string;
  readonly command: readonly string[];
  readonly capture: CommandCapture;
  readonly identityAfter: "verified" | "failed";
  readonly identityDetail: string;
}

const executeAt = (
  options: DiagnoseOptions,
  trusted: TrustedRun,
  copy: string,
  invocationId: string,
): Effect.Effect<ExecutionResult, E2EDiagnosticError, FileSystem.FileSystem | OwnedProcess | Scope.Scope> =>
  Effect.gen(function* () {
    const harness = yield* inspectMaterializedHarnessAssets(
      copy,
      trusted.repo.manifest.harness?.assets ?? [],
    ).pipe(Effect.mapError((cause) => failure(cause.detail)));
    yield* verifyIdentity(trusted, trusted.copy);
    const baseEnv = buildChildEnv(
      process.env,
      trusted.allSecretNames,
      trusted.repo.manifest.secrets,
      trusted.repo.manifest.id,
    );
    const artifactNamespace = join(copy, ".e2e-diagnostics", invocationId);
    const command = options.mode === "test"
      ? appendNativeArgs(trusted.repo.manifest.command, options.argv)
      : options.argv;
    const secretValues = sensitiveEnvValues(process.env);
    const capture = yield* runCommand(
      command,
      copy,
      withInvocation(baseEnv, invocationId, copy, harness.environment, artifactNamespace),
      options.timeoutSeconds * 1_000,
      `[e2e:diagnose:${trusted.repo.manifest.id}] `,
    ).pipe(Effect.mapError((cause) => failure(cause.detail)));
    const after = yield* Effect.result(verifyIdentity(trusted, trusted.copy));
    return {
      cwd: copy,
      artifactNamespace,
      command: redactSecretStrings(command, secretValues),
      capture: redactSecretCapture(capture, secretValues),
      identityAfter: Result.isSuccess(after) ? "verified" : "failed",
      identityDetail: Result.isSuccess(after) ? "candidate and Testkit identity remained verified" : after.failure.detail,
    };
  });

export const runDiagnostic = (
  options: DiagnoseOptions,
): Effect.Effect<DiagnosticSummary, E2EDiagnosticError, FileSystem.FileSystem | OwnedProcess | Scope.Scope> =>
  Effect.gen(function* () {
    if (process.env.CI !== undefined)
      return yield* Effect.fail(failure("diagnose is local-only and rejected in CI"));
    if (!Number.isSafeInteger(options.timeoutSeconds) || options.timeoutSeconds <= 0)
      return yield* Effect.fail(failure("--timeout-seconds must be a positive integer"));
    if (options.argv.length === 0)
      return yield* Effect.fail(failure(`${options.mode} requires non-empty arguments after --`));

    const trusted = yield* loadTrustedRun(options);
    const invocationId = randomUUID();
    let cleanup: FreshCopyCleanup = {
      kind: "not-created",
      ok: true,
      detail: "test mode runs directly in the retained scenario copy",
    };
    let execution: ExecutionResult;
    if (options.mode === "test") {
      execution = yield* executeAt(options, trusted, trusted.copy, invocationId);
    } else {
      const cleanupState = yield* Ref.make<FreshCopyCleanup>({
        kind: "remove-failed",
        ok: false,
        detail: "short-lived diagnostic copy cleanup did not run",
      });
      const fresh = join(dirname(trusted.copy), `.diagnostic-${basename(trusted.copy)}-${invocationId}`);
      execution = yield* Effect.scoped(Effect.gen(function* () {
        if (!contained(trusted.scratch, fresh))
          return yield* Effect.fail(failure("diagnostic copy path escapes retained scratch"));
        if ((yield* secure(lstatOptional(fresh))) !== undefined)
          return yield* Effect.fail(failure(`diagnostic copy already exists: ${fresh}`));
        yield* Effect.acquireRelease(
          Effect.succeed(fresh),
          (path) => cleanupFreshCopy(path, cleanupState),
        );
        yield* copyRepoIsolated(trusted.copy, fresh).pipe(
          Effect.mapError((cause) => failure(cause.detail)),
        );
        yield* secure(assertContainedRealDirectory(trusted.scratch, fresh, "short-lived diagnostic copy"));
        const retainedNodeModules = yield* secure(
          assertContainedRealDirectory(
            trusted.copy,
            join(trusted.copy, "node_modules"),
            "retained installed node_modules",
          ),
        );
        const freshNodeModules = join(fresh, "node_modules");
        yield* fs((service) => service.symlink(retainedNodeModules, freshNodeModules));
        const nodeModulesLink = yield* secure(lstatPath(freshNodeModules));
        if (!nodeModulesLink.isSymbolicLink())
          return yield* Effect.fail(failure("fresh node_modules is not a symlink to the retained installation"));
        const reusedNodeModules = yield* fs((service) => service.realPath(freshNodeModules));
        if (resolve(reusedNodeModules) !== resolve(retainedNodeModules))
          return yield* Effect.fail(failure("fresh node_modules symlink does not resolve to the retained installation"));
        return yield* executeAt(options, trusted, fresh, invocationId);
      }));
      cleanup = yield* Ref.get(cleanupState);
    }

    const ok = commandCaptureOk(execution.capture) && execution.identityAfter === "verified" && cleanup.ok;
    const detailText = !commandCaptureOk(execution.capture)
      ? execution.capture.timedOut
        ? `diagnostic command timed out after ${options.timeoutSeconds} seconds`
        : `diagnostic command failed with exit ${execution.capture.exitCode}`
      : execution.identityAfter === "failed"
        ? execution.identityDetail
        : !cleanup.ok
          ? cleanup.detail
          : "diagnostic command completed successfully";
    const diagnosticPath = join(
      trusted.artifactRoot,
      "diagnostics",
      trusted.repo.manifest.id,
      `${invocationId}.json`,
    );
    yield* secure(
      ensureContainedRealDirectory(
        trusted.artifactRoot,
        dirname(diagnosticPath),
        "diagnostic artifact directory",
      ),
    );
    const summary: DiagnosticSummary = {
      diagnostic: true,
      mode: options.mode,
      ok,
      detail: detailText,
      repoId: trusted.repo.manifest.id,
      invocationId,
      sourceSummaryPath: trusted.summary.summaryPath,
      sourceReceiptPath: trusted.receipt.receiptPath,
      retainedScratchPath: trusted.scratch,
      retainedCopyPath: trusted.copy,
      cwd: execution.cwd,
      artifactNamespace: execution.artifactNamespace,
      diagnosticPath,
      argv: redactSecretStrings(options.argv, sensitiveEnvValues(process.env)),
      command: execution.command,
      timeoutSeconds: options.timeoutSeconds,
      candidate: trusted.receipt.candidate,
      capture: execution.capture,
      identityVerification: {
        before: "verified",
        after: execution.identityAfter,
        detail: execution.identityDetail,
      },
      freshCopyCleanup: cleanup,
    };
    yield* secure(
      writeContainedUtf8File(
        trusted.artifactRoot,
        diagnosticPath,
        `${JSON.stringify(summary, null, 2)}\n`,
        "diagnostic receipt",
      ),
    );
    return summary;
  });
