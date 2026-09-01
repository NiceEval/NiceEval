#!/usr/bin/env -S npx tsx
// The E2E command tree is the only runtime boundary for this package. Planning
// stays graph-only; packing, environment loading and owned processes are only
// introduced by the commands that actually need them.

import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import * as FileSystem from "effect/FileSystem";
import { NodeServices } from "@effect/platform-node";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { Cause, Console, Data, Effect, Result, Exit, Fiber, Layer, Option, Queue, Schema } from "effect";

const decodeNativeArgs = Schema.decodeUnknownSync(Schema.Array(Schema.String));

import { decodePlanDocument, LANES, type SelectionReceipt } from "./contracts.ts";
import { runDiagnostic, type DiagnosticMode } from "./diagnose.ts";
import { repoRootDir } from "./discovery.ts";
import { forceKillOwnedProcesses, OwnedProcessLive, stopOwnedProcesses } from "./owned-process.ts";
import { packCandidate } from "./pack.ts";
import { formatResolvedPlan, invalidPlanOutput, resolvePlan, type PlanCli, type ResolvedPlan } from "./plan.ts";
import { runEffect, type RunSummary } from "./run.ts";
import { runTakeover } from "./takeover.ts";
import { verifyRelease } from "./verify-release.ts";
import { formatCause } from "./format-cause.ts";
import { runRedEvidence } from "./red-evidence.ts";

class E2ECliError extends Data.TaggedError("E2ECliError")<{ readonly detail: string }> {}

const errorDetail = (cause: unknown): string =>
  typeof cause === "object" && cause !== null && "detail" in cause && typeof cause.detail === "string"
    ? cause.detail
    : cause instanceof Error ? cause.message : String(cause);
const optionalText = (name: string) => Options.string(name).pipe(Options.optional, Options.map(Option.getOrUndefined));
const lane = Options.choice("lane", LANES).pipe(Options.withDefault("pr"), Options.withDescription("Manifest lane to plan (default: pr)."));
const repos = Options.string("repo").pipe(Options.atLeast(0), Options.withDescription("Scenario repository id; may be repeated."));
const diffPaths = Options.string("diff-path").pipe(Options.atLeast(0), Options.withDescription("Changed path for affected planning; may be repeated."));
const noDiff = Options.boolean("no-diff").pipe(Options.withDefault(false), Options.withDescription("Plan the full lane instead of affected repositories."));
const base = optionalText("base").pipe(Options.withDescription("Base revision; requires --head."));
const head = optionalText("head").pipe(Options.withDescription("Head revision; requires --base."));
const capability = optionalText("capability").pipe(Options.withDescription("Select repositories declaring this capability."));
const excludeExternalNetwork = Options.boolean("exclude-external-network").pipe(Options.withDefault(false), Options.withDescription("Exclude repositories that require external network access."));
const batch = Options.boolean("batch").pipe(Options.withDefault(false), Options.withDescription("Group compatible selected repositories into plan cells."));
const json = Options.boolean("json").pipe(Options.withDefault(false), Options.withDescription("Render the plan as JSON."));
const keepWorkdir = Options.boolean("keep-workdir").pipe(Options.withDefault(false), Options.withDescription("Retain isolated workdirs for local diagnosis."));
const artifactRoot = optionalText("artifact-root").pipe(Options.withDescription("Durable directory for receipts and retained candidate bytes."));
const nativeArgs = Args.string("native-test-arg").pipe(Args.variadic);

type PlanConfig = {
  readonly lane: PlanCli["lane"];
  readonly repoIds: readonly string[];
  readonly diffPaths: readonly string[];
  readonly noDiff: boolean;
  readonly base: string | undefined;
  readonly head: string | undefined;
  readonly capability: string | undefined;
  readonly excludeExternalNetwork: boolean;
  readonly batch: boolean;
  readonly json: boolean;
};
const toPlanCli = (config: PlanConfig): Result.Result<PlanCli, E2ECliError> => {
  if ((config.base === undefined) !== (config.head === undefined)) return Result.fail(new E2ECliError({ detail: "--base and --head must be supplied together" }));
  return Result.succeed({ lane: config.lane, repoIds: config.repoIds, ...(config.diffPaths.length === 0 ? {} : { diffPaths: config.diffPaths }), noDiff: config.noDiff, ...(config.base === undefined ? {} : { base: config.base }), ...(config.head === undefined ? {} : { head: config.head }), ...(config.capability === undefined ? {} : { capability: config.capability }), excludeExternalNetwork: config.excludeExternalNetwork, batch: config.batch, json: config.json });
};
const planFailure = (error: unknown, asJson: boolean): Effect.Effect<never, unknown> => asJson ? Effect.andThen(Console.log(JSON.stringify(invalidPlanOutput(errorDetail(error)))), Effect.fail(error)) : Effect.fail(error);
const resolveConfiguredPlan = (config: PlanConfig): Effect.Effect<ResolvedPlan, unknown, FileSystem.FileSystem | import("./owned-process.ts").OwnedProcess> => Result.match(toPlanCli(config), { onFailure: Effect.fail, onSuccess: resolvePlan });
const printPlan = (plan: ResolvedPlan): Effect.Effect<void> => Effect.forEach(formatResolvedPlan(plan), (line) => Console.log(line), { discard: true });
const loadRootEnv: Effect.Effect<void, E2ECliError, FileSystem.FileSystem> = Effect.gen(function* () {
  const path = join(repoRootDir(), ".env");
  const fileSystem = yield* FileSystem.FileSystem;
  const exists = yield* fileSystem.exists(path).pipe(Effect.mapError((cause) => new E2ECliError({ detail: `could not inspect ${path}: ${errorDetail(cause)}` })));
  if (exists) yield* Effect.try({ try: () => loadEnvFile(path), catch: (cause) => new E2ECliError({ detail: `could not load ${path}: ${errorDetail(cause)}` }) });
});
const rejectKeepWorkdirInCi = (requested: boolean): Effect.Effect<void, E2ECliError> => requested && process.env.CI !== undefined ? Effect.fail(new E2ECliError({ detail: "--keep-workdir is local-only and rejected in CI" })) : Effect.void;
const printSummary = (summary: RunSummary): Effect.Effect<void, E2ECliError> => Console.log(JSON.stringify(summary, null, 2)).pipe(Effect.andThen(summary.category === "pass" ? Effect.void : Effect.fail(new E2ECliError({ detail: summary.detail }))));
const rejectDiagnosticInCi = process.env.CI !== undefined
  ? Effect.fail(new E2ECliError({ detail: "diagnose is local-only and rejected in CI" }))
  : Effect.void;

const planned = (config: PlanConfig) => resolveConfiguredPlan(config).pipe(Effect.catch((error) => planFailure(error, config.json)));
const planCommand = Command.make("plan", { lane, repoIds: repos, diffPaths, noDiff, base, head, capability, excludeExternalNetwork, batch, json }, (config) => planned(config).pipe(Effect.tap(printPlan))).pipe(Command.withDescription("Resolve selected scenario repositories without packing or running them."));
const packCommand = Command.make("pack", { out: Options.string("out").pipe(Options.withDescription("Required .tgz destination for the packed NiceEval candidate.")) }, ({ out }) => Effect.scoped(packCandidate(repoRootDir(), out).pipe(Effect.flatMap((candidate) => Console.log(JSON.stringify(candidate, null, 2)))))).pipe(Command.withDescription("Pack exactly one NiceEval candidate tarball."));
const testCommand = Command.make("test", { lane, repoIds: repos, diffPaths, noDiff, base, head, capability, excludeExternalNetwork, keepWorkdir, artifactRoot, nativeArgs }, (config) => rejectKeepWorkdirInCi(config.keepWorkdir).pipe(
  Effect.andThen(planned({ ...config, batch: false, json: false })),
  Effect.tap(printPlan),
  Effect.flatMap((plan) => plan.entries.length === 0 ? Effect.void : Effect.scoped(Effect.gen(function* () {
    const staging = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: "niceeval-e2e-test-" });
    const candidate = yield* packCandidate(repoRootDir(), join(staging, "candidate.tgz"));
    yield* loadRootEnv;
    const repoIds = plan.entries.flatMap((entry) => entry.repoIds);
    const summary = yield* runEffect({ repoIds, lane: plan.cli.lane, ...(plan.cli.capability === undefined ? {} : { capability: plan.cli.capability }), candidatePath: candidate.path, ...(config.artifactRoot === undefined ? {} : { artifactRoot: config.artifactRoot }), nativeArgs: decodeNativeArgs(config.nativeArgs), keepWorkdir: config.keepWorkdir, repoConcurrency: Math.max(repoIds.length, 1) });
    yield* printSummary(summary);
  }))),
)).pipe(Command.withDescription("Plan, pack once, and run exactly the selected scenario repositories."));

const readPlanCell = (path: string, cellId: string): Effect.Effect<{ readonly repoIds: readonly string[]; readonly selection: SelectionReceipt }, E2ECliError, FileSystem.FileSystem> => Effect.gen(function* () {
  const text = yield* (yield* FileSystem.FileSystem).readFileString(path).pipe(Effect.mapError((cause) => new E2ECliError({ detail: `could not read plan ${path}: ${errorDetail(cause)}` })));
  const raw = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: (cause) => new E2ECliError({ detail: `could not parse plan ${path}: ${errorDetail(cause)}` }) });
  const plan = yield* Result.match(decodePlanDocument(raw), { onFailure: (error) => Effect.fail(new E2ECliError({ detail: `invalid PlanDocument at ${path}: ${errorDetail(error)}` })), onSuccess: Effect.succeed });
  const cell = plan.cells.find((entry) => entry.id === cellId);
  if (cell === undefined) return yield* Effect.fail(new E2ECliError({ detail: `plan ${path} has no cell ${JSON.stringify(cellId)}` }));
  return { repoIds: cell.repoIds, selection: { mode: plan.mode, reason: plan.reason, lane: plan.lane, cellId: cell.id, ...(plan.range === undefined ? {} : { range: plan.range }) } };
});

const runCommand = Command.make("run", { candidate: Options.string("candidate").pipe(Options.withDescription("Required candidate .tgz path.")), repoIds: repos, plan: optionalText("plan").pipe(Options.withDescription("Plan JSON path; requires --cell.")), cell: optionalText("cell").pipe(Options.withDescription("Plan cell id; requires --plan.")), artifactRoot, keepWorkdir, nativeArgs }, (config) => rejectKeepWorkdirInCi(config.keepWorkdir).pipe(Effect.andThen(Effect.gen(function* () {
  const usesPlan = config.plan !== undefined || config.cell !== undefined;
  if (usesPlan && (config.plan === undefined || config.cell === undefined)) return yield* Effect.fail(new E2ECliError({ detail: "--plan and --cell must be supplied together" }));
  if (usesPlan && config.repoIds.length > 0) return yield* Effect.fail(new E2ECliError({ detail: "--repo cannot be combined with --plan and --cell" }));
  if (!usesPlan && config.repoIds.length === 0) return yield* Effect.fail(new E2ECliError({ detail: "run requires one or more --repo values, or a paired --plan and --cell" }));
  const selection = usesPlan ? yield* readPlanCell(config.plan!, config.cell!) : undefined;
  yield* loadRootEnv;
  const summary = yield* runEffect({ repoIds: selection?.repoIds ?? config.repoIds, candidatePath: config.candidate, ...(config.artifactRoot === undefined ? {} : { artifactRoot: config.artifactRoot }), nativeArgs: decodeNativeArgs(config.nativeArgs), keepWorkdir: config.keepWorkdir, repoConcurrency: Math.max(selection?.repoIds.length ?? config.repoIds.length, 1), ...(selection === undefined ? {} : { selection: selection.selection }) });
  yield* printSummary(summary);
})))).pipe(Command.withDescription("Run an existing candidate for explicit repositories or one plan cell."));
const runTakeoverCommand = (config: { readonly candidate: string; readonly repo: string; readonly selector: string; readonly inventory: string; readonly artifactRoot: string | undefined; readonly nativeArgs: readonly unknown[] }) => {
  const nativeArgs = decodeNativeArgs(config.nativeArgs);
  return loadRootEnv.pipe(
    Effect.andThen(runTakeover({ candidatePath: config.candidate, repoId: config.repo, selector: config.selector, inventoryId: config.inventory, ...(config.artifactRoot === undefined ? {} : { artifactRoot: config.artifactRoot }), nativeArgs })),
    Effect.flatMap((summary) => Console.log(JSON.stringify(summary, null, 2)).pipe(Effect.andThen(summary.category === "pass" ? Effect.void : Effect.fail(new E2ECliError({ detail: summary.detail }))))),
    Effect.mapError((cause) => new E2ECliError({ detail: errorDetail(cause) })),
  );
};
const takeoverCommand = Command.make("takeover", { candidate: Options.string("candidate").pipe(Options.withDescription("Required candidate .tgz path.")), repo: Options.string("repo").pipe(Options.withDescription("Required scenario repository id.")), selector: Options.string("selector").pipe(Options.withDescription("Exact <path>#<caseId> selector.")), inventory: Options.string("inventory").pipe(Options.withDescription("Managed inventory ID returned by docs test inventory.")), artifactRoot, nativeArgs }, runTakeoverCommand).pipe(Command.withDescription("Run the deterministic reliability takeover matrix and return a managed netake_... evidence ID."));
const redEvidenceCommand = Command.make("red", { candidate: Options.string("candidate").pipe(Options.withDescription("Required old or minimally reversed candidate .tgz path.")), candidateGitSha: Options.string("candidate-git-sha").pipe(Options.withDescription("Full Git object id identifying the candidate source or minimal reverse patch base.")), repo: Options.string("repo").pipe(Options.withDescription("Required scenario repository id.")), selector: Options.string("selector").pipe(Options.withDescription("Exact <path>#<caseId> selector.")), inventory: Options.string("inventory").pipe(Options.withDescription("Managed inventory ID returned by docs test inventory.")), artifactRoot, nativeArgs }, (config) => loadRootEnv.pipe(
  Effect.andThen(Effect.scoped(runRedEvidence({ candidatePath: config.candidate, candidateGitSha: config.candidateGitSha, repoId: config.repo, selector: config.selector, inventoryId: config.inventory, ...(config.artifactRoot === undefined ? {} : { artifactRoot: config.artifactRoot }), nativeArgs: decodeNativeArgs(config.nativeArgs) }))),
  Effect.flatMap((summary) => Console.log(JSON.stringify(summary, null, 2))),
  Effect.mapError((cause) => new E2ECliError({ detail: errorDetail(cause) })),
)).pipe(Command.withDescription("Run one exact collected case against an old candidate and return a managed nered_... evidence ID for an ordinary public regression."));
const evidenceCommand = Command.make("evidence").pipe(Command.withDescription("Generate formal case evidence from root-runner public observations."), Command.withSubcommands([redEvidenceCommand]));
const diagnoseFrom = Options.string("from").pipe(Options.withDescription("Formal retained run summary.json path."));
const diagnoseRepo = Options.string("repo").pipe(Options.withDescription("Single retained scenario repository id."));
const diagnoseTimeout = Options.integer("timeout-seconds").pipe(Options.withDefault(15), Options.withDescription("Positive diagnostic command timeout in seconds (default: 15)."));
const runDiagnoseCommand = (mode: DiagnosticMode, config: { readonly from: string; readonly repo: string; readonly timeoutSeconds: number; readonly nativeArgs: readonly unknown[] }) =>
  rejectDiagnosticInCi.pipe(
    Effect.andThen(loadRootEnv),
    Effect.andThen(Effect.scoped(runDiagnostic({ mode, summaryPath: config.from, repoId: config.repo, timeoutSeconds: config.timeoutSeconds, argv: decodeNativeArgs(config.nativeArgs) }))),
    Effect.flatMap((summary) => Console.log(JSON.stringify(summary, null, 2)).pipe(
      Effect.andThen(summary.ok ? Effect.void : Effect.fail(new E2ECliError({ detail: summary.detail }))),
    )),
    Effect.mapError((cause) => new E2ECliError({ detail: errorDetail(cause) })),
  );
const diagnoseTestCommand = Command.make("test", { from: diagnoseFrom, repo: diagnoseRepo, timeoutSeconds: diagnoseTimeout, nativeArgs }, (config) => runDiagnoseCommand("test", config)).pipe(Command.withDescription("Run native test targets in one retained formal scenario copy."));
const diagnoseExecCommand = Command.make("exec", { from: diagnoseFrom, repo: diagnoseRepo, timeoutSeconds: diagnoseTimeout, nativeArgs }, (config) => runDiagnoseCommand("exec", config)).pipe(Command.withDescription("Run an argv command in a short-lived copy of one retained scenario."));
const diagnoseCommand = Command.make("diagnose").pipe(Command.withDescription("Run local-only fast diagnostics from a retained formal run."), Command.withSubcommands([diagnoseTestCommand, diagnoseExecCommand]));
const verifyReleaseCommand = Command.make("verify-release", { plan: Options.string("plan").pipe(Options.withDescription("Required release plan JSON path.")), candidate: Options.string("candidate").pipe(Options.withDescription("Required candidate .tgz path.")), receiptRoot: Options.string("receipt-root").pipe(Options.withDescription("Required durable receipt root.")), tag: Options.string("tag").pipe(Options.withDescription("Required vX.Y.Z release tag.")) }, (config) => verifyRelease({ planPath: config.plan, candidatePath: config.candidate, receiptRoot: config.receiptRoot, tag: config.tag }).pipe(Effect.flatMap((verification) => Console.log(JSON.stringify(verification, null, 2))))).pipe(Command.withDescription("Verify a release candidate against a full plan and durable receipts."));

export const e2eCommand = Command.make("e2e").pipe(Command.withDescription("NiceEval E2E planning, packing, execution, diagnosis, evidence, takeover, and release verification."), Command.withSubcommands([testCommand, diagnoseCommand, evidenceCommand, planCommand, packCommand, runCommand, takeoverCommand, verifyReleaseCommand]));

type ShutdownSignal = "SIGINT" | "SIGTERM";
const signalState: { first: ShutdownSignal | undefined; offerEscalation: (() => void) | undefined } = { first: undefined, offerEscalation: undefined };
const withSignalLifecycle = <A, E, R>(program: Effect.Effect<A, E, R>) => Effect.scoped(Effect.gen(function* () {
  const escalations = yield* Queue.unbounded<void>();
  signalState.offerEscalation = () => { Queue.offerUnsafe(escalations, undefined); };
  const listener = (signal: NodeJS.Signals): void => {
    if (signal !== "SIGINT" && signal !== "SIGTERM") return;
    if (signalState.first === undefined) {
      signalState.first = signal;
      return;
    }
    signalState.offerEscalation?.();
  };
  yield* Effect.acquireRelease(Effect.sync(() => { process.on("SIGINT", listener); process.on("SIGTERM", listener); }), () => Effect.sync(() => { signalState.offerEscalation = undefined; process.removeListener("SIGINT", listener); process.removeListener("SIGTERM", listener); }));
  return yield* program.pipe(Effect.ensuring(Effect.gen(function* () {
    const first = signalState.first;
    if (first === undefined) return;
    const escalationWatcher = yield* Effect.forkChild(
      Queue.take(escalations).pipe(
        Effect.andThen(forceKillOwnedProcesses),
        Effect.interruptible,
      ),
    );
    yield* stopOwnedProcesses(first).pipe(Effect.ensuring(Fiber.interrupt(escalationWatcher)));
  })));
}));

export const program = Command.run(e2eCommand, { version: "0.1.0" }).pipe(
  Effect.tapCause((cause) => Cause.hasInterruptsOnly(cause) ? Effect.void : Console.error(formatCause(cause))),
  withSignalLifecycle,
  Effect.provide(Layer.mergeAll(NodeServices.layer, OwnedProcessLive)),
);

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void Effect.runPromiseExit(program).then((exit) => {
    process.exitCode = signalState.first === "SIGINT" ? 130 : signalState.first === "SIGTERM" ? 143 : Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? 1 : 0;
  });
}
