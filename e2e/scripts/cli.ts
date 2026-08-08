#!/usr/bin/env -S npx tsx
// Thin dispatcher for the root E2E commands. The plan path is kept free of
// pack/install/secret imports; run is loaded only when it is requested.
//
// Default local order (docs/engineering/testing/e2e/execution.md): plan →
// pack the NiceEval candidate → run. The run command clean-builds the
// workspace Testkit once when a selected repo declares it. Nothing is built
// or packed when the plan selects zero repos or fails.

import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repoRootDir } from "./discovery.ts";
import { main as planMain } from "./plan.ts";

export function splitNativeArgs(argv: readonly string[]): { selectionArgs: readonly string[]; nativeArgs: readonly string[] } {
  const separator = argv.indexOf("--");
  if (separator < 0) return { selectionArgs: argv, nativeArgs: [] };
  return { selectionArgs: argv.slice(0, separator), nativeArgs: argv.slice(separator + 1) };
}

export function buildDefaultRunArgs(
  candidatePath: string,
  selectionArgs: readonly string[],
  nativeArgs: readonly string[],
): string[] {
  return [
    "--candidate",
    candidatePath,
    ...selectionArgs,
    ...(nativeArgs.length === 0 ? [] : ["--", ...nativeArgs]),
  ];
}

export interface DefaultFlowDependencies {
  candidatePath: string;
  /** Plan returns the number of selected repos; 0 or negative skips pack/run. */
  plan: (selectionArgs: readonly string[]) => Promise<number>;
  pack: (out: string) => Promise<{ path: string }>;
  run: (runArgs: readonly string[]) => Promise<void>;
}

/**
 * Default mode's observable order: plan, one candidate pack, then run with
 * that exact candidate. The run command owns the one conditional Testkit
 * build because explicit and default runs must share the same behavior.
 */
export async function executeDefault(
  argv: readonly string[],
  dependencies: DefaultFlowDependencies,
): Promise<boolean> {
  const { selectionArgs, nativeArgs } = splitNativeArgs(argv);
  const selected = await dependencies.plan(selectionArgs);
  if (selected <= 0) return false;
  const candidate = await dependencies.pack(dependencies.candidatePath);
  await dependencies.run(buildDefaultRunArgs(candidate.path, selectionArgs, nativeArgs));
  return true;
}

async function runDefault(argv: readonly string[]): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "niceeval-e2e-default-"));
  const candidatePath = join(temporaryDirectory, "candidate.tgz");
  try {
    const { packCandidate } = await import("./pack.ts");
    const { main: runMain } = await import("./run.ts");
    await executeDefault(argv, {
      candidatePath,
      plan: planMain,
      pack: async (out) => {
        const candidate = await packCandidate(repoRootDir(), out);
        console.log(`[e2e] packed candidate: ${candidate.path}`);
        console.log(`[e2e] candidate fingerprint: ${candidate.integrity} (sha256:${candidate.sha256})`);
        return candidate;
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
