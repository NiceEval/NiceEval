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

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
import {
  classifyFromReceipt,
  retainCapture,
  type Category,
  type CommandCapture,
  type RepoReceipt,
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

const EXCLUDED_FROM_COPY = new Set(["node_modules", ".niceeval", ".git"]);

export async function copyRepoIsolated(sourceDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await cp(sourceDir, destDir, {
    recursive: true,
    filter: (src) => !EXCLUDED_FROM_COPY.has(basename(src)),
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
export function runCommand(
  command: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<CommandCapture> {
  return new Promise((resolvePromise, reject) => {
    const [cmd, ...args] = command;
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        signal,
        timedOut,
        stdout,
        stderr,
      });
    });
  });
}

function unsupportedExecutorDetail(repo: DiscoveredRepo): string {
  const ex = repo.manifest.executor;
  if (ex.kind === "docker") {
    return `executor kind "docker" (image ${ex.image}) is unsupported by this host runner`;
  }
  return `executor kind ${JSON.stringify((ex as { kind: string }).kind)} is unsupported by this host runner`;
}

/**
 * Run one discovered repo in an external temp copy under scratchRoot/runs/<id>/.
 * Artifacts + receipt land under independent artifactRoot/<id>/ (durable; never
 * under scratchRoot or the e2e source tree). The working copy is always removed
 * in finally; cleanup failure never masks an earlier stage error.
 */
export async function runRepo(
  repo: DiscoveredRepo,
  candidate: CandidateTarball,
  scratchRoot: string,
  artifactRoot: string,
  allSecretNames: ReadonlySet<string>,
  nativeArgs: readonly string[],
  testkit?: TestkitPackage,
): Promise<RepoRunResult> {
  const repoId = repo.manifest.id;
  const copyDir = join(scratchRoot, "runs", repoId);
  const artifactDir = repoArtifactDir(artifactRoot, repoId);
  const receiptPath = repoReceiptPath(artifactRoot, repoId);
  const stages: StageReceipt[] = [];
  let testExitCode: number | null = null;
  let copyCreated = false;
  let testkitInjected = false;
  let testkitResolvedPath: string | undefined;
  let durableCandidatePath = candidate.path;

  try {
    durableCandidatePath = await materializeCandidateArtifact(artifactRoot, candidate);
    if (repo.manifest.executor.kind !== "host") {
      const detail = unsupportedExecutorDetail(repo);
      stages.push({ stage: "install", ok: false, detail });
    } else {
      await copyRepoIsolated(repo.dir, copyDir);
      copyCreated = true;

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
        await pointAtCandidateTarball(copyDir, durableCandidatePath);
        if (consumesTestkit) {
          await injectTestkitDirectory(copyDir, testkit as TestkitPackage);
          testkitInjected = true;
        }

        // --- install ---
        const installCmd = ["pnpm", "install", "--no-frozen-lockfile"] as const;
        let installCapture: CommandCapture;
        try {
          installCapture = await runCommand(installCmd, copyDir, process.env, 30 * 60_000);
        } catch (err) {
          installCapture = {
            exitCode: null,
            signal: null,
            timedOut: false,
            stdout: "",
            stderr: (err as Error).message,
          };
        }
        const installOk = installCapture.exitCode === 0 && !installCapture.timedOut;
        stages.push({
          stage: "install",
          ok: installOk,
          command: [...installCmd],
          capture: retainCapture(installCapture, installOk),
          detail: installOk
            ? "pnpm install ok"
            : installCapture.timedOut
              ? "pnpm install timed out"
              : `pnpm install failed (exit ${installCapture.exitCode}) in the isolated copy`,
        });

        if (installOk) {
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
          } catch (err) {
            injectionOk = false;
            injectionDetail = `could not read isolated copy's pnpm-lock.yaml: ${(err as Error).message}`;
          }
          stages.push({ stage: "injection", ok: injectionOk, detail: injectionDetail });

          // Never run an unproven candidate: skip test and collection on failure.
          if (injectionOk) {
            // --- test ---
            const childEnv = buildChildEnv(process.env, allSecretNames, repo.manifest.secrets);
            const timeoutMs = repo.manifest.timeoutMinutes * 60_000;
            const testCmd = appendNativeArgs(repo.manifest.command, nativeArgs);
            let testCapture: CommandCapture;
            try {
              testCapture = await runCommand(testCmd, copyDir, childEnv, timeoutMs);
            } catch (err) {
              testCapture = {
                exitCode: null,
                signal: null,
                timedOut: false,
                stdout: "",
                stderr: (err as Error).message,
              };
            }
            testExitCode = testCapture.exitCode;
            const testOk = testCapture.exitCode === 0 && !testCapture.timedOut;
            stages.push({
              stage: "test",
              ok: testOk,
              command: testCmd,
              capture: retainCapture(testCapture, testOk),
              detail: testCapture.timedOut
                ? "exceeded e2e.json timeoutMinutes; process killed"
                : testOk
                  ? "command exited 0"
                  : `exit ${testCapture.exitCode}`,
            });

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
            } catch (err) {
              stages.push({
                stage: "collect",
                ok: false,
                detail: `collect failed: ${(err as Error).message}`,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    stages.push({
      stage: stages.some((s) => s.stage === "injection")
        ? "injection"
        : stages.some((s) => s.stage === "install")
          ? "install"
          : "prepare",
      ok: false,
      detail: (err as Error).message,
    });
  } finally {
    // Unconditional working-copy cleanup; failure must not mask earlier outcomes.
    if (copyCreated || existsSync(copyDir)) {
      let cleanupOk = true;
      let cleanupDetail = `removed ${copyDir}`;
      try {
        await rm(copyDir, { recursive: true, force: true });
      } catch (err) {
        cleanupOk = false;
        cleanupDetail = `cleanup failed for ${copyDir}: ${(err as Error).message}`;
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
  } catch (err) {
    const detail = `failed to write receipt ${receiptPath}: ${(err as Error).message}`;
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
    attempts: 1,
    receipt,
    artifactDir,
    receiptPath,
  };
}

export type { Category };
