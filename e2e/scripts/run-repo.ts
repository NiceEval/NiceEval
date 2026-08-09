// One isolated repo run: ephemeral working copy under scratchRoot/runs/,
// durable artifacts+receipt under independent artifactRoot, unconditional
// copy cleanup. Never writes the e2e source tree. Never parses .niceeval
// for verdict.
//
// Harness pre-flight (prepare stage): scenario source package.json/lockfile
// must not contain @niceeval/testkit, `workspace:` or `file:` references; a
// repo declaring harness.testkit: true receives the clean-built checkout
// directory, while an undeclared repo must not import it. Injection adds an
// absolute `file:` directory devDependency only inside the isolated copy.
// After install the lockfile must hold exactly one directory resolution and
// the installed package must live in that copy's pnpm virtual store, never as
// a link back to the checkout.

import { createHash, randomUUID } from "node:crypto";
import { basename, join, relative, resolve, sep } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import type { DiscoveredRepo } from "./discovery.ts";
import type { CandidateTarball } from "./injection.ts";
import { verifyInjection } from "./injection.ts";
import {
  checkTestkitSourceClean,
  injectTestkitDirectory,
  scanForTestkitImports,
  verifyInstalledTestkit,
  verifyTestkitDirectoryResolution,
  type TestkitPackage,
} from "./testkit.ts";
import { buildChildEnv } from "./secrets.ts";
import { collectArtifacts, repoArtifactDir, repoReceiptPath } from "./artifacts.ts";
import { preflightBrowsers, preflightHostCapabilities } from "./preflight.ts";
import {
  createUnmanagedExecutionControl,
  isExecutionCancelled,
  type E2EExecutionControl,
  type OwnedProcessResult,
} from "./owned-process.ts";
import {
  classifyFromReceipt,
  hasUnconfirmedOwnedGroup,
  retainCapture,
  type Category,
  type CommandCapture,
  type RepoReceipt,
  type StageName,
  type StageReceipt,
  type TestkitReceipt,
} from "./receipt.ts";

function candidateTarballFileName(sha256: string): string {
  return `niceeval-candidate-${sha256}.tgz`;
}

async function materializeCandidateArtifact(
  artifactRoot: string,
  candidate: CandidateTarball,
): Promise<string> {
  const targetDir = join(artifactRoot, "candidate");
  const target = join(targetDir, candidateTarballFileName(candidate.sha256));
  await mkdir(targetDir, { recursive: true });
  const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  if (!existsSync(target) || sha256(target) !== candidate.sha256) {
    await copyFile(candidate.path, target);
  }
  if (sha256(target) !== candidate.sha256) {
    throw new Error(`durable candidate artifact at ${target} does not match sha256:${candidate.sha256}`);
  }
  return target;
}

function isRetainedArtifact(artifactRoot: string, tarballPath: string): boolean {
  const root = resolve(artifactRoot);
  const target = resolve(tarballPath);
  return target.startsWith(`${root}${sep}`) && existsSync(target);
}

export interface RepoRunResult {
  id: string;
  exitCode: number | null;
  category: Category;
  detail: string;
  attempts: number;
  receipt: RepoReceipt;
  /** Absolute durable artifact directory (under independent artifactRoot). */
  artifactDir: string;
  /** Absolute path of written receipt.json for workflow upload. */
  receiptPath: string;
}

export function appendNativeArgs(command: readonly string[], nativeArgs: readonly string[]): string[] {
  return [...command, ...nativeArgs];
}

/** Basenames deliberately omitted from every isolated scenario/source snapshot. */
export const E2E_COPY_EXCLUDED_BASENAMES = new Set(["node_modules", ".niceeval", ".git", ".env"]);

export async function copyRepoIsolated(sourceDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await cp(sourceDir, destDir, {
    recursive: true,
    filter: (src) => !E2E_COPY_EXCLUDED_BASENAMES.has(basename(src)),
  });
}

/** Mutates only the isolated copy's package.json — never the checked-in repo. */
export async function pointAtCandidateTarball(copyDir: string, tarballPath: string): Promise<void> {
  const pkgPath = join(copyDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
  const spec = `file:${tarballPath}`;

  let found = false;
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = pkg[field];
    if (deps && typeof deps === "object" && Object.prototype.hasOwnProperty.call(deps, "niceeval")) {
      (deps as Record<string, string>).niceeval = spec;
      found = true;
    }
  }
  if (!found) {
    throw new Error(
      `${copyDir}/package.json declares no "niceeval" dependency (checked dependencies and devDependencies) — nothing to inject the candidate tarball into`,
    );
  }

  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

/**
 * Verify the candidate tarball and the optional Testkit directory resolution
 * from the isolated copy's own lockfile and node_modules.
 */
function verifyAllInjections(
  lockfileText: string,
  candidate: CandidateTarball,
  testkit: TestkitPackage | undefined,
  copyDir: string,
): { ok: true; testkitDetail?: string; testkitResolvedPath?: string } | { ok: false; reason: string } {
  const candidateVerdict = verifyInjection(lockfileText, candidate.integrity);
  if (!candidateVerdict.ok) return { ok: false, reason: candidateVerdict.reason };
  if (testkit === undefined) return { ok: true };

  const lockVerdict = verifyTestkitDirectoryResolution(lockfileText, testkit.path, copyDir);
  if (!lockVerdict.ok) return { ok: false, reason: lockVerdict.reason };
  const installedVerdict = verifyInstalledTestkit(copyDir, testkit);
  if (!installedVerdict.ok) return { ok: false, reason: installedVerdict.reason };

  return {
    ok: true,
    testkitDetail: `workspace testkit (@niceeval/testkit@${testkit.version}) has one directory resolution; isolated realpath verified at ${installedVerdict.realPath}`,
    testkitResolvedPath: relative(copyDir, installedVerdict.installedPath),
  };
}

/**
 * Spawn a command, stream output to the parent, and retain full stdout/stderr
 * for receipts (especially on failure / timeout).
 */
function commandCapture(result: OwnedProcessResult): CommandCapture {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    cancelled: result.cancelled,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.error === undefined ? {} : { error: result.error }),
    processGroupOwned: result.processGroupOwned,
    groupCleanup: result.groupCleanup,
  };
}

export async function runCommand(
  command: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  execution: E2EExecutionControl,
): Promise<CommandCapture> {
  const result = await execution.supervisor.run(command, {
    cwd,
    env,
    output: "capture",
    stream: true,
    timeoutMs,
    abortSignal: execution.abortSignal,
  });
  return commandCapture(result);
}

export interface RunRepoOptions {
  /** Shared top-level cancellation and process ownership state. */
  execution?: E2EExecutionControl;
  /** A fixed source snapshot for takeover, otherwise the discovered repo directory. */
  sourceDir?: string;
  /** Durable subdirectory under artifactRoot, used to keep takeover receipts distinct. */
  runLabel?: string;
  /** Scratch subdirectory under runs/, used to name an intentionally shared copy. */
  workdirKey?: string;
  /** Deliberate repeated tests in one installed copy; this is not a retry mechanism. */
  testRuns?: number;
  /** Human-readable identity recorded when a takeover deliberately reuses one copy. */
  copyId?: string;
  /** Digest of the fixed takeover source snapshot that produced this copy. */
  sourceSnapshotDigest?: string;
}

function withInvocationId(env: NodeJS.ProcessEnv, invocationId: string): NodeJS.ProcessEnv {
  return { ...env, NICEEVAL_E2E_INVOCATION_ID: invocationId };
}

function cancelledStage(stage: StageName, detail: string): StageReceipt {
  return { stage, ok: false, cancelled: true, detail };
}

function nextFailureStage(stages: readonly StageReceipt[]): StageName {
  if (!stages.some((stage) => stage.stage === "preflight")) return "preflight";
  if (!stages.some((stage) => stage.stage === "prepare")) return "prepare";
  if (!stages.some((stage) => stage.stage === "install")) return "install";
  if (!stages.some((stage) => stage.stage === "injection")) return "injection";
  if (!stages.some((stage) => stage.stage === "browser")) return "browser";
  return "test";
}

/**
 * Run one discovered repo in an external temp copy under scratchRoot/runs/.
 * Artifacts + receipt land under independent artifactRoot (or runLabel) and
 * the working copy is always removed. A `testRuns` value above one is an
 * explicit takeover observation in the same installed copy, never retry.
 */
export async function runRepo(
  repo: DiscoveredRepo,
  candidate: CandidateTarball,
  scratchRoot: string,
  artifactRoot: string,
  allSecretNames: ReadonlySet<string>,
  nativeArgs: readonly string[],
  testkit?: TestkitPackage,
  options: RunRepoOptions = {},
): Promise<RepoRunResult> {
  const execution = options.execution ?? createUnmanagedExecutionControl();
  const repoId = repo.manifest.id;
  const copyDir = join(scratchRoot, "runs", options.workdirKey ?? repoId);
  const scopedArtifactRoot = options.runLabel === undefined ? artifactRoot : join(artifactRoot, options.runLabel);
  const artifactDir = repoArtifactDir(scopedArtifactRoot, repoId);
  const receiptPath = repoReceiptPath(scopedArtifactRoot, repoId);
  const sourceDir = options.sourceDir ?? repo.dir;
  const testRuns = options.testRuns ?? 1;
  if (!Number.isInteger(testRuns) || testRuns < 1) {
    throw new Error(`testRuns must be a positive integer, got ${testRuns}`);
  }

  const stages: StageReceipt[] = [];
  const invocationIds: string[] = [];
  let testExitCode: number | null = null;
  let copyCreated = false;
  let testkitInjected = false;
  let testkitResolvedPath: string | undefined;
  let durableCandidatePath = candidate.path;

  try {
    durableCandidatePath = await materializeCandidateArtifact(artifactRoot, candidate);
    const setupInvocationId = randomUUID();
    invocationIds.push(setupInvocationId);
    const preflightEnv = withInvocationId(
      buildChildEnv(process.env, allSecretNames, repo.manifest.secrets),
      setupInvocationId,
    );

    if (isExecutionCancelled(execution)) {
      stages.push(cancelledStage("preflight", "cancelled before capability preflight"));
    } else {
      const preflight = await preflightHostCapabilities(repo.manifest, preflightEnv, execution);
      stages.push({
        stage: "preflight",
        ok: preflight.ok,
        invocationId: setupInvocationId,
        ...(preflight.cancelled ? { cancelled: true } : {}),
        ...(preflight.failureCategory === undefined ? {} : { failureCategory: preflight.failureCategory }),
        checks: preflight.checks,
        detail: preflight.cancelled
          ? "cancelled during capability preflight"
          : preflight.ok
            ? "declared host capabilities available"
            : `configuration preflight failed: ${preflight.checks.filter((check) => !check.ok).map((check) => check.detail).join("; ")}`,
      });

      if (preflight.ok && !preflight.cancelled) {
        await copyRepoIsolated(sourceDir, copyDir);
        copyCreated = true;

        if (isExecutionCancelled(execution)) {
          stages.push(cancelledStage("prepare", "cancelled before source prepare"));
        } else {
          // --- prepare: harness pre-flight guards (fail before any install/test) ---
          const consumesTestkit = repo.manifest.harness?.testkit === true;
          const prepareViolations = checkTestkitSourceClean(copyDir);
          if (consumesTestkit && testkit === undefined) {
            prepareViolations.push(
              "harness.testkit: true declared but the workspace Testkit was not built — declared-but-not-injected must fail before test",
            );
          }
          if (!consumesTestkit) {
            const imports = scanForTestkitImports(copyDir);
            if (imports.length > 0) {
              prepareViolations.push(
                `repo imports @niceeval/testkit without declaring harness.testkit: true (${imports.join(", ")}) — undeclared imports must fail before test`,
              );
            }
          }
          const prepareOk = prepareViolations.length === 0;
          stages.push({
            stage: "prepare",
            ok: prepareOk,
            detail: prepareOk
              ? consumesTestkit
                ? "source clean; harness.testkit declared"
                : "source clean; no testkit declared"
              : `prepare failed: ${prepareViolations.join("; ")}`,
          });

          if (prepareOk) {
            if (isExecutionCancelled(execution)) {
              stages.push(cancelledStage("install", "cancelled before candidate injection and install"));
            } else {
              await pointAtCandidateTarball(copyDir, durableCandidatePath);
              if (consumesTestkit) {
                await injectTestkitDirectory(copyDir, testkit as TestkitPackage);
                testkitInjected = true;
              }

              // --- install ---
              const installCmd = ["pnpm", "install", "--no-frozen-lockfile"] as const;
              const installEnv = withInvocationId(buildChildEnv(process.env, allSecretNames, []), setupInvocationId);
              const installCapture = await runCommand(installCmd, copyDir, installEnv, 30 * 60_000, execution);
              const installOk =
                installCapture.exitCode === 0 &&
                !installCapture.timedOut &&
                !installCapture.cancelled &&
                installCapture.error === undefined &&
                !hasUnconfirmedOwnedGroup(installCapture);
              stages.push({
                stage: "install",
                ok: installOk,
                invocationId: setupInvocationId,
                ...(installCapture.cancelled ? { cancelled: true } : {}),
                command: [...installCmd],
                capture: retainCapture(installCapture, installOk),
                detail: installCapture.cancelled
                  ? `cancelled during pnpm install (${installCapture.signal ?? "root signal"})`
                  : installOk
                    ? "pnpm install ok"
                    : hasUnconfirmedOwnedGroup(installCapture)
                      ? `pnpm install leader exited but owned process-group cleanup was not confirmed: ${installCapture.groupCleanup.detail}`
                    : installCapture.timedOut
                      ? "pnpm install timed out after TERM → grace → KILL"
                      : `pnpm install failed (${installCapture.error ?? installCapture.signal ?? `exit ${installCapture.exitCode}`}) in the isolated copy`,
              });

              if (installOk) {
                if (isExecutionCancelled(execution)) {
                  stages.push(cancelledStage("injection", "cancelled before injection verification"));
                } else {
                  // --- injection: candidate bytes plus optional Testkit directory ---
                  let injectionOk = false;
                  let injectionDetail: string;
                  try {
                    if (!existsSync(join(copyDir, "pnpm-lock.yaml"))) {
                      injectionOk = false;
                      injectionDetail = "could not read isolated copy's pnpm-lock.yaml: file missing";
                    } else {
                      const lockText = readFileSync(join(copyDir, "pnpm-lock.yaml"), "utf8");
                      const verdict = verifyAllInjections(
                        lockText,
                        candidate,
                        testkitInjected ? testkit : undefined,
                        copyDir,
                      );
                      injectionOk = verdict.ok;
                      if (verdict.ok) testkitResolvedPath = verdict.testkitResolvedPath;
                      injectionDetail = verdict.ok
                        ? testkitInjected
                          ? `candidate integrity matches lockfile; ${verdict.testkitDetail}`
                          : "candidate integrity matches lockfile"
                        : `injection verification failed: ${verdict.reason}`;
                    }
                  } catch (error) {
                    injectionOk = false;
                    injectionDetail = `could not read isolated copy's pnpm-lock.yaml: ${(error as Error).message}`;
                  }
                  stages.push({
                    stage: "injection",
                    ok: injectionOk,
                    invocationId: setupInvocationId,
                    detail: injectionDetail,
                  });

                  // Never run an unproven candidate: skip test and collection on failure.
                  if (injectionOk) {
                    const browser = await preflightBrowsers(
                      repo.manifest.requires?.browsers,
                      copyDir,
                      preflightEnv,
                      execution,
                    );
                    if (repo.manifest.requires?.browsers !== undefined) {
                      stages.push({
                        stage: "browser",
                        ok: browser.ok,
                        invocationId: setupInvocationId,
                        ...(browser.cancelled ? { cancelled: true } : {}),
                        ...(browser.failureCategory === undefined ? {} : { failureCategory: browser.failureCategory }),
                        checks: browser.checks,
                        detail: browser.cancelled
                          ? "cancelled during browser preflight"
                          : browser.ok
                            ? "declared browser capabilities available"
                            : `browser preflight failed: ${browser.checks.filter((check) => !check.ok).map((check) => check.detail).join("; ")}`,
                      });
                    }

                    if (browser.ok && !browser.cancelled) {
                      const timeoutMs = repo.manifest.timeoutMinutes * 60_000;
                      const testCmd = appendNativeArgs(repo.manifest.command, nativeArgs);
                      for (let attempt = 1; attempt <= testRuns; attempt += 1) {
                        if (isExecutionCancelled(execution)) {
                          stages.push(cancelledStage("test", `cancelled before test invocation ${attempt}`));
                          break;
                        }
                        const invocationId = randomUUID();
                        invocationIds.push(invocationId);
                        const childEnv = withInvocationId(
                          buildChildEnv(process.env, allSecretNames, repo.manifest.secrets),
                          invocationId,
                        );
                        const testCapture = await runCommand(testCmd, copyDir, childEnv, timeoutMs, execution);
                        testExitCode = testCapture.exitCode;
                        const testOk =
                          testCapture.exitCode === 0 &&
                          !testCapture.timedOut &&
                          !testCapture.cancelled &&
                          testCapture.error === undefined &&
                          !hasUnconfirmedOwnedGroup(testCapture);
                        stages.push({
                          stage: "test",
                          attempt,
                          invocationId,
                          ok: testOk,
                          ...(testCapture.cancelled ? { cancelled: true } : {}),
                          command: testCmd,
                          capture: retainCapture(testCapture, testOk),
                          detail: testCapture.cancelled
                            ? `cancelled during test invocation ${attempt} (${testCapture.signal ?? "root signal"})`
                            : testCapture.timedOut
                              ? `test invocation ${attempt} exceeded e2e.json timeoutMinutes; owned group received TERM → grace → KILL`
                              : hasUnconfirmedOwnedGroup(testCapture)
                                ? `test invocation ${attempt} leader exited but owned process-group cleanup was not confirmed: ${testCapture.groupCleanup.detail}`
                              : testOk
                                ? `test invocation ${attempt} exited 0`
                                : `test invocation ${attempt} failed (${testCapture.error ?? testCapture.signal ?? `exit ${testCapture.exitCode}`})`,
                        });
                        if (testCapture.cancelled) break;
                      }

                      // --- collect into durable artifactRoot only (never source or scratch) ---
                      try {
                        const { collected, warnings } = await collectArtifacts(
                          copyDir,
                          artifactDir,
                          repo.manifest.artifacts,
                        );
                        for (const warning of warnings) console.warn(`[e2e] ${warning}`);
                        stages.push({
                          stage: "collect",
                          ok: true,
                          collected,
                          detail:
                            collected.length > 0
                              ? `wrote ${collected.length} artifact path(s) under ${artifactDir}`
                              : `no artifacts matched under ${artifactDir}`,
                        });
                      } catch (error) {
                        stages.push({
                          stage: "collect",
                          ok: false,
                          detail: `collect failed: ${(error as Error).message}`,
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    stages.push({
      stage: nextFailureStage(stages),
      ok: false,
      ...(isExecutionCancelled(execution) ? { cancelled: true } : {}),
      detail: isExecutionCancelled(execution)
        ? `cancelled while preparing runner state: ${(error as Error).message}`
        : (error as Error).message,
    });
  } finally {
    // A root signal stops new child stages, but a copy that already exists
    // still gets its declared diagnostics collected before cleanup. This is
    // intentionally filesystem-only work after the supervisor has drained
    // the owned process group.
    if (
      isExecutionCancelled(execution) &&
      (copyCreated || existsSync(copyDir)) &&
      !stages.some((stage) => stage.stage === "collect")
    ) {
      try {
        const { collected, warnings } = await collectArtifacts(copyDir, artifactDir, repo.manifest.artifacts);
        for (const warning of warnings) console.warn(`[e2e] ${warning}`);
        stages.push({
          stage: "collect",
          ok: true,
          collected,
          detail: `collected diagnostics after cancellation under ${artifactDir}`,
        });
      } catch (error) {
        stages.push({ stage: "collect", ok: false, detail: `collect after cancellation failed: ${(error as Error).message}` });
      }
    }

    // Unconditional working-copy cleanup; failure must not mask earlier outcomes.
    if (copyCreated || existsSync(copyDir)) {
      let cleanupOk = true;
      let cleanupDetail = `removed ${copyDir}`;
      try {
        await rm(copyDir, { recursive: true, force: true });
      } catch (error) {
        cleanupOk = false;
        cleanupDetail = `cleanup failed for ${copyDir}: ${(error as Error).message}`;
        console.error(`[e2e] ${cleanupDetail}`);
      }
      stages.push({
        stage: "cleanup",
        ok: cleanupOk,
        path: copyDir,
        detail: cleanupDetail,
      });
    }
  }

  // Classify and persist only after cleanup is on the stages list so receipt.json
  // always includes the final cleanup stage under durable artifactDir.
  const classified = classifyFromReceipt({ stages, detail: "" });
  const candidateRetained = isRetainedArtifact(artifactRoot, durableCandidatePath);
  const testkitReceipt: TestkitReceipt | undefined =
    testkitInjected && testkit !== undefined && testkitResolvedPath !== undefined
      ? {
          version: testkit.version,
          sourcePath: testkit.sourcePath,
          resolvedPath: testkitResolvedPath,
        }
      : undefined;
  const receipt: RepoReceipt = {
    repoId,
    invocationIds,
    testInvocations: stages.filter((stage) => stage.stage === "test" && stage.capture !== undefined).length,
    ...(options.copyId === undefined ? {} : { copyId: options.copyId }),
    ...(options.runLabel === undefined ? {} : { runLabel: options.runLabel }),
    ...(options.sourceSnapshotDigest === undefined ? {} : { sourceSnapshotDigest: options.sourceSnapshotDigest }),
    artifactDir,
    receiptPath,
    stages,
    exitCode: testExitCode,
    category: classified.category,
    detail: classified.detail,
    candidate: {
      sha256: candidate.sha256,
      integrity: candidate.integrity,
      ...(candidateRetained ? { artifactPath: relative(artifactRoot, durableCandidatePath) } : {}),
      reproduce: `pnpm e2e run --candidate ${durableCandidatePath} --repo ${repoId}`,
      exactReplay: candidateRetained,
    },
    ...(testkitReceipt === undefined ? {} : { testkit: testkitReceipt }),
  };

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  } catch (error) {
    const detail = `failed to write receipt ${receiptPath}: ${(error as Error).message}`;
    console.error(`[e2e] ${detail}`);
    stages.push({ stage: "collect", ok: false, detail });
    const persistenceFailure = classifyFromReceipt({ stages, detail: receipt.detail });
    receipt.category = persistenceFailure.category;
    receipt.detail = persistenceFailure.detail;
  }

  return {
    id: repoId,
    exitCode: testExitCode,
    category: receipt.category,
    detail: receipt.detail,
    attempts: receipt.testInvocations,
    receipt,
    artifactDir,
    receiptPath,
  };
}

export type { Category };
