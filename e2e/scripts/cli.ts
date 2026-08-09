#!/usr/bin/env -S npx tsx
// Thin dispatcher for the root E2E commands. The plan path is kept free of
// pack/install/secret imports; run is loaded only when it is requested.
//
// Default local order (docs/engineering/testing/e2e/execution.md): plan →
// pack the NiceEval candidate → run. The run command builds one
// invocation-local Testkit snapshot when a selected repo declares it. Nothing is built
// or packed when the plan selects zero repos or fails.

import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repoRootDir } from "./discovery.ts";
import { main as planMain, printResolvedPlan, resolvePlan, type PlanEntry } from "./plan.ts";
import { OwnedProcessSupervisor, type E2EExecutionControl } from "./owned-process.ts";

function loadRootEnv(): void {
  const envPath = join(repoRootDir(), ".env");
  if (existsSync(envPath)) loadEnvFile(envPath);
}

export function splitNativeArgs(argv: readonly string[]): { selectionArgs: readonly string[]; nativeArgs: readonly string[] } {
  const separator = argv.indexOf("--");
  if (separator < 0) return { selectionArgs: argv, nativeArgs: [] };
  return { selectionArgs: argv.slice(0, separator), nativeArgs: argv.slice(separator + 1) };
}

function rootArgs(argv: readonly string[]): readonly string[] {
  const separator = argv.indexOf("--");
  return separator < 0 ? argv : argv.slice(0, separator);
}

function hasRootFlag(argv: readonly string[], flag: string): boolean {
  return rootArgs(argv).includes(flag);
}

function removeRootFlag(argv: readonly string[], flag: string): string[] {
  const separator = argv.indexOf("--");
  const before = (separator < 0 ? argv : argv.slice(0, separator)).filter((arg) => arg !== flag);
  return separator < 0 ? [...before] : [...before, "--", ...argv.slice(separator + 1)];
}

function printHelp(): void {
  console.log(`Usage: pnpm e2e [command] [options] [-- native-test-args]

Commands:
  plan             Resolve and print selected scenario repositories
  pack             Pack one NiceEval candidate tarball
  run              Run an existing candidate tarball
  takeover         Run the deterministic owner reliability matrix
  verify-release   Verify a release candidate

Root run options:
  --repo <id>          Select a repository (repeatable)
  --lane <lane>        Select a manifest lane
  --keep-workdir       Retain the isolated scratch tree for local diagnosis
  --help, -h           Print this help without planning, packing, or running

Arguments after -- are passed unchanged to the repository's native test command.`);
}

export function buildDefaultRunArgs(
  candidatePath: string,
  plannedRepoIds: readonly string[],
  nativeArgs: readonly string[],
  keepWorkdir = false,
): string[] {
  return [
    "--candidate",
    candidatePath,
    ...(keepWorkdir ? ["--keep-workdir"] : []),
    ...plannedRepoIds.flatMap((id) => ["--repo", id]),
    ...(nativeArgs.length === 0 ? [] : ["--", ...nativeArgs]),
  ];
}

export interface DefaultFlowDependencies {
  candidatePath: string;
  /** The one resolved plan whose exact repo-id set must be replayed by run. */
  plan: (selectionArgs: readonly string[]) => Promise<readonly PlanEntry[]>;
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
  const keepWorkdir = hasRootFlag(argv, "--keep-workdir");
  const { selectionArgs, nativeArgs } = splitNativeArgs(removeRootFlag(argv, "--keep-workdir"));
  const selected = await dependencies.plan(selectionArgs);
  if (selected.length === 0) return false;
  const candidate = await dependencies.pack(dependencies.candidatePath);
  await dependencies.run(buildDefaultRunArgs(candidate.path, selected.map((entry) => entry.id), nativeArgs, keepWorkdir));
  return true;
}

async function runDefault(argv: readonly string[], execution: E2EExecutionControl): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "niceeval-e2e-default-"));
  const candidatePath = join(temporaryDirectory, "candidate.tgz");
  try {
    const { packCandidate } = await import("./pack.ts");
    const { main: runMain } = await import("./run.ts");
    await executeDefault(argv, {
      candidatePath,
      plan: async (selectionArgs) => {
        const plan = resolvePlan(selectionArgs);
        printResolvedPlan(plan);
        return plan.entries;
      },
      pack: async (out) => {
        const candidate = await packCandidate(repoRootDir(), out, {}, execution);
        console.log(`[e2e] packed candidate: ${candidate.path}`);
        console.log(`[e2e] candidate fingerprint: ${candidate.integrity} (sha256:${candidate.sha256})`);
        return candidate;
      },
      run: async (runArgs) => {
        loadRootEnv();
        await runMain(runArgs, execution);
      },
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

class RootSignalLifecycle {
  readonly supervisor = new OwnedProcessSupervisor();
  readonly abortController = new AbortController();

  private received = 0;
  private cancellationSignal: "SIGINT" | "SIGTERM" | undefined;
  private shutdown: Promise<void> | undefined;

  readonly onSignal = (signal: NodeJS.Signals): void => {
    if (signal !== "SIGINT" && signal !== "SIGTERM") return;
    this.received += 1;
    if (this.received === 1) {
      this.cancellationSignal = signal;
      // Abort first: no new runner stage may begin after the first signal.
      this.abortController.abort(signal);
      // The supervisor forwards the same signal to every active owned group,
      // waits its grace period, then KILLs if needed. We deliberately do not
      // call process.exit: close handlers must drain output and cleanup.
      this.shutdown = this.supervisor.stop(signal).catch((error: unknown) => {
        console.error(`[e2e] signal shutdown failed: ${(error as Error).message}`);
      });
      return;
    }

    // A second SIGINT/SIGTERM is an explicit escalation, but we still await
    // child `close` so receipt capture and runner cleanup can finish.
    void this.supervisor.forceKill().catch((error: unknown) => {
      console.error(`[e2e] forced signal shutdown failed: ${(error as Error).message}`);
    });
  };

  install(): void {
    process.on("SIGINT", this.onSignal);
    process.on("SIGTERM", this.onSignal);
  }

  remove(): void {
    process.removeListener("SIGINT", this.onSignal);
    process.removeListener("SIGTERM", this.onSignal);
  }

  get control(): E2EExecutionControl {
    return { supervisor: this.supervisor, abortSignal: this.abortController.signal };
  }

  get cancelled(): boolean {
    return this.cancellationSignal !== undefined;
  }

  async settle(): Promise<void> {
    await this.shutdown;
    await this.supervisor.waitForIdle();
  }

  applyExitCode(): void {
    if (this.cancellationSignal === "SIGINT") process.exitCode = 130;
    if (this.cancellationSignal === "SIGTERM") process.exitCode = 143;
  }
}

async function dispatch(argv: readonly string[], execution: E2EExecutionControl): Promise<void> {
  if (hasRootFlag(argv, "--help") || hasRootFlag(argv, "-h")) {
    printHelp();
    return;
  }
  if (hasRootFlag(argv, "--keep-workdir") && process.env.CI !== undefined) {
    throw new Error("--keep-workdir is local-only and is rejected whenever CI is set");
  }
  const [command, ...rest] = argv;

  if (command === "plan") {
    await planMain(rest);
    return;
  }

  if (command === "pack") {
    const { main: packMain } = await import("./pack.ts");
    await packMain(rest, execution);
    return;
  }

  if (command === "takeover") {
    loadRootEnv();
    const { main: takeoverMain } = await import("./takeover.ts");
    await takeoverMain(rest, execution);
    return;
  }

  if (command === "verify-release") {
    const { main: verifyReleaseMain } = await import("./verify-release.ts");
    await verifyReleaseMain(rest);
    return;
  }

  const runArgs = command === "run" ? rest : argv;
  if (command !== undefined && command !== "run" && !command.startsWith("-")) {
    console.error(`[e2e] unknown command ${JSON.stringify(command)}; expected pack, plan, run, takeover or verify-release`);
    process.exitCode = 1;
    return;
  }

  if (command === undefined || command.startsWith("-")) {
    await runDefault(argv, execution);
    return;
  }

  loadRootEnv();
  const { main: runMain } = await import("./run.ts");
  await runMain(runArgs, execution);
}

/** The one process-wide signal state machine for all root CLI commands. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const lifecycle = new RootSignalLifecycle();
  lifecycle.install();
  try {
    await dispatch(argv, lifecycle.control);
  } catch (error) {
    if (lifecycle.cancelled) {
      console.error(`[e2e] cancelled while draining owned processes: ${(error as Error).message}`);
    } else {
      throw error;
    }
  } finally {
    await lifecycle.settle();
    lifecycle.remove();
    lifecycle.applyExitCode();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(`[e2e] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
