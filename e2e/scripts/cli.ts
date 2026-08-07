#!/usr/bin/env -S npx tsx
// Thin dispatcher for the root E2E commands. The plan path is kept free of
// pack/install/secret imports; run is loaded only when it is requested.
//
// Default local order (docs/engineering/testing/e2e/execution.md): plan →
// pack NiceEval candidate → clean build + pack the current workspace Testkit
// exactly once → run with both. Nothing is packed when the plan selects zero
// repos or fails. Explicit `run --testkit` never repacks.

import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverAllRepos, e2eRootDir, repoRootDir } from "./discovery.ts";
import { main as planMain, parsePlanCli, selectRepos, tryReadDiffPaths } from "./plan.ts";

export function splitNativeArgs(argv: readonly string[]): { selectionArgs: readonly string[]; nativeArgs: readonly string[] } {
  const separator = argv.indexOf("--");
  if (separator < 0) return { selectionArgs: argv, nativeArgs: [] };
  return { selectionArgs: argv.slice(0, separator), nativeArgs: argv.slice(separator + 1) };
}

export function buildDefaultRunArgs(
  candidatePath: string,
  testkitPath: string | undefined,
  selectionArgs: readonly string[],
  nativeArgs: readonly string[],
): string[] {
  return [
    "--candidate",
    candidatePath,
    ...(testkitPath === undefined ? [] : ["--testkit", testkitPath]),
    ...selectionArgs,
    ...(nativeArgs.length === 0 ? [] : ["--", ...nativeArgs]),
  ];
}

export interface DefaultFlowDependencies {
  candidatePath: string;
  /** Plan returns the number of selected repos; 0 or negative skips pack/run. */
  plan: (selectionArgs: readonly string[]) => Promise<number>;
  /** Uses the same selected manifests to decide whether Testkit is needed. */
  hasTestkitConsumer: (selectionArgs: readonly string[]) => Promise<boolean>;
  pack: (out: string) => Promise<{ path: string }>;
  /** Clean-build + pack the workspace Testkit once; returns the exact tgz. */
  buildTestkit: () => Promise<{ path: string; sha256: string }>;
  run: (runArgs: readonly string[]) => Promise<void>;
}

/**
 * Default mode's observable order: plan, one candidate pack, one Testkit
 * build/pack, then run with that exact candidate and testkit tgz. Zero
 * selected repos or a failed plan packs nothing and runs nothing.
 */
export async function executeDefault(
  argv: readonly string[],
  dependencies: DefaultFlowDependencies,
): Promise<boolean> {
  const { selectionArgs, nativeArgs } = splitNativeArgs(argv);
  const selected = await dependencies.plan(selectionArgs);
  if (selected <= 0) return false;
  const hasTestkitConsumer = await dependencies.hasTestkitConsumer(selectionArgs);
  const candidate = await dependencies.pack(dependencies.candidatePath);
  const testkit = hasTestkitConsumer ? await dependencies.buildTestkit() : undefined;
  await dependencies.run(
    buildDefaultRunArgs(candidate.path, testkit?.path, selectionArgs, nativeArgs),
  );
  return true;
}

async function hasSelectedTestkitConsumer(selectionArgs: readonly string[]): Promise<boolean> {
  const cli = parsePlanCli(selectionArgs);
  const e2eRoot = e2eRootDir();
  const { repos, errors } = discoverAllRepos(e2eRoot);
  if (errors.length > 0) throw new Error(errors.join("; "));
  const diffPaths = cli.diffPaths ?? tryReadDiffPaths(resolve(e2eRoot, ".."));
  return selectRepos(repos, {
    lane: cli.lane,
    repoIds: cli.repoIds,
    diffPaths,
    capability: cli.capability,
  }).some((repo) => repo.manifest.harness?.testkit === true);
}

async function runDefault(argv: readonly string[]): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "niceeval-e2e-default-"));
  const candidatePath = join(temporaryDirectory, "candidate.tgz");
  const testkitDir = join(temporaryDirectory, "testkit");
  try {
    const { packCandidate } = await import("./pack.ts");
    const { buildTestkitTarball } = await import("./testkit.ts");
    const { main: runMain } = await import("./run.ts");
    await executeDefault(argv, {
      candidatePath,
      plan: planMain,
      hasTestkitConsumer: (selectionArgs) => hasSelectedTestkitConsumer(selectionArgs),
      pack: async (out) => {
        const candidate = await packCandidate(repoRootDir(), out);
        console.log(`[e2e] packed candidate: ${candidate.path}`);
        console.log(`[e2e] candidate fingerprint: ${candidate.integrity} (sha256:${candidate.sha256})`);
        return candidate;
      },
      buildTestkit: async () => {
        const testkit = await buildTestkitTarball(repoRootDir(), testkitDir);
        console.log(`[e2e] built testkit: ${testkit.path}`);
        console.log(`[e2e] testkit fingerprint: ${testkit.integrity} (sha256:${testkit.sha256})`);
        return testkit;
      },
      run: runMain,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;

  if (command === "plan") {
    await planMain(rest);
    return;
  }

  if (command === "pack") {
    const { main: packMain } = await import("./pack.ts");
    await packMain(rest);
    return;
  }

  const runArgs = command === "run" ? rest : argv;
  if (command !== undefined && command !== "run" && !command.startsWith("-")) {
    console.error(`[e2e] unknown command ${JSON.stringify(command)}; expected pack, plan or run`);
    process.exitCode = 1;
    return;
  }

  if (command === undefined || command.startsWith("-")) {
    await runDefault(argv);
    return;
  }

  const { main: runMain } = await import("./run.ts");
  await runMain(runArgs);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(`[e2e] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
