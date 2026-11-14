// @concord-file
// @concord-implements docs/feature/insight/README.md
// @concord-implements docs/feature/inspection/architecture.md#run-inspection-insight
import { parseInspectionAddress } from "../../inspection/addressing.ts";
import { showOperations, selectTraceDetailByStableId } from "../../show/contribution.ts";
import { openHostOwnedInspectionSource } from "../../inspection/source.ts";
import { selectInspectionOperation } from "../../inspection/select.ts";
import { ExperimentIdSchema, ArtifactIdSchema } from "../../record/codec/identifiers.ts";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Effect, Result, Schema, Scope } from "effect";

import {
  CliArguments,
  CliInterruption,
  CliInvocationFacts,
  CliOutput,
  type CliOptionDefinition,
} from "../../cli/application.ts";
import { CliFeatureError, type CliCommandContribution } from "../../cli/contribution.ts";
import { RunIdSchema } from "../../record/codec/identifiers.ts";
import type { RunId } from "../../record/model/identifiers.ts";
import {
  openHostOwnedRecordReadSession,
  acquireProjectRecordReadSession,
} from "../../record/sqlite/index.ts";
import { publicationCutoffIdentity } from "../../run/storage/cutoff.ts";
import { startExternalRecordImport } from "../../record/sqlite/external-record-import.ts";
import { ProjectConfiguration, type ProjectConfigurationService } from "../../cli/project-configuration.ts";
import { openCurrentProjectSource } from "../../inspection/project-source.ts";
import { projectInput } from "../../inspection/project-input.ts";
import { ViewBrowser } from "../browser.ts";
import { renderViewLifecycleEvent, VIEW_LIFECYCLE_PROTOCOL } from "../protocol.ts";
import { buildViewGeneration } from "../render.ts";
import type { ViewGeneration, ViewTarget } from "../revision.ts";
import { openViewServer } from "../server.ts";
import { ViewApplicationRuntime } from "../application-runtime.ts";

const help = (summary: string) => Object.freeze({ summary, visibility: "public" as const });
const option = (value: CliOptionDefinition): CliOptionDefinition => Object.freeze(value);

export const VIEW_CLI_OPTIONS = Object.freeze({
  "no-open": option({ type: "boolean", help: help("Do not request the OS browser.") }),
  port: option({ type: "string", help: help("Listen on this loopback port; 0 chooses one.") }),
  json: option({ type: "boolean", help: help("Write View lifecycle events as NDJSON.") }),
  help: option({ type: "boolean", short: "h", help: help("Print view help.") }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const VIEW_HELP = `niceeval view — open the first-party human View

Usage:
  niceeval view [@<locator> | exp:<id>... | run:<id>...] [<aspect>] [<ID>] [--no-open] [--port <port>] [--json]
`;

type Requirements = CliArguments | CliInterruption | CliInvocationFacts | CliOutput | ViewBrowser | ViewApplicationRuntime | ProjectConfiguration | Scope.Scope;
type Error = CliFeatureError;
const VIEW_RUN_SELECTION_LIMIT = 64;
const RECORD_IMPORT_DEADLINE_MS = 30_000;

function failure(operation: string, cause: unknown): Error {
  return new CliFeatureError({ feature: "view", operation, cause, exitCode: 1 });
}

function targetFailureReason(cause: unknown): string {
  const underlying = cause instanceof CliFeatureError ? cause.cause : cause;
  const reason = typeof underlying === "object" && underlying !== null && "reason" in underlying &&
      typeof underlying.reason === "string"
    ? underlying.reason
    : underlying instanceof Error ? underlying.message : String(underlying);
  return `${typeof underlying === "object" && underlying !== null && "code" in underlying &&
    typeof underlying.code === "string" ? underlying.code : "prepare-current-target"}: ${reason}`.slice(0, 2000);
}

function write(channel: "stdout" | "stderr", text: string) {
  return Effect.flatMap(CliOutput, (output) => channel === "stdout" ? output.writeStdout(text) : output.writeStderr(text)).pipe(
    Effect.mapError((cause) => failure(`write ${channel}`, cause)),
  );
}

function usage(message: string) {
  return write("stderr", `${message.endsWith("\n") ? message : `${message}\n`}`).pipe(Effect.as(1));
}

function runView(argv: readonly string[]): Effect.Effect<number, Error, Requirements> {
  return Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsed = yield* Effect.try({
      try: () => parser.parse(argv, VIEW_CLI_OPTIONS),
      catch: (cause) => failure("parse arguments", cause),
    });
    if (parsed.values.help === true) { yield* write("stdout", VIEW_HELP); return 0; }
    const address = yield* Effect.try({ try: () => parseInspectionAddress(parsed.positionals), catch: (cause) => failure("parse address", cause) });
    if (address.imageId !== undefined) return yield* usage("View accepts an Attempt, Experiment, Run, or current results address.");
    const runIds = parseRunIds([...address.runIds]);
    if (typeof runIds === "string") return yield* usage(runIds);
    const port = parsePort(parsed.values.port);
    if (typeof port === "string") return yield* usage(port);
    const facts = yield* invocationFacts();
    const execute = Effect.gen(function* () {
      const json = parsed.values.json === true;
      const sourcePath = resolve(facts.cwd, ".niceeval/record.sqlite");
      const currentCapable = parsed.positionals.length === 0 && existsSync(resolve(facts.cwd, "niceeval.config.ts"));
      const project = yield* ProjectConfiguration;
      const built = yield* buildRecordGeneration(sourcePath, facts.cwd, project, currentCapable, false);
      const initial = built.generation;
      yield* Effect.scoped(Effect.gen(function* () {
        const source = yield* openHostOwnedInspectionSource(initial.recordPath);
        const experimentIds = address.experimentIds.map(id => Schema.decodeUnknownSync(ExperimentIdSchema)(id));
        if (address.id !== undefined && address.aspect === "execution") {
          yield* Effect.try({ try: () => selectTraceDetailByStableId(source, address.locator!, address.id!), catch: (cause) => failure("validate address", cause) });
        } else {
          const operations = address.aspect === "artifacts" ? [address.id === undefined
            ? { kind: "attempt.artifacts" as const, locator: address.locator! }
            : { kind: "attempt.artifact" as const, locator: address.locator!, artifactId: Schema.decodeUnknownSync(ArtifactIdSchema)(address.id) }]
            : showOperations({ current: false, runIds, experimentIds, locator: address.locator, slice: address.aspect, entryIds: address.aspect === "assertions" && address.id !== undefined ? [address.id] : [], changeId: address.aspect === "diff" ? address.id : undefined });
          if (parsed.positionals.length > 0) for (const operation of operations) yield* Effect.try({ try: () => selectInspectionOperation(source, operation), catch: (cause) => failure("validate address", cause) });
        }
      })).pipe(Effect.mapError(cause => cause instanceof CliFeatureError ? cause : failure("validate selection", cause)));
      const entryPath = address.locator !== undefined ? `/attempt/${encodeURIComponent(address.locator.slice(1))}`
        : address.experimentIds.length === 1 ? `/experiment/${encodeURIComponent(address.experimentIds[0]!)}` : "/";
      const selection = new URLSearchParams();
      if (address.aspect !== undefined) selection.set("aspect", address.aspect);
      if (address.id !== undefined) selection.set("id", address.id);
      for (const id of address.experimentIds) selection.append("experiment", id);

      const scope = yield* Effect.scope;
      const runtime = yield* ViewApplicationRuntime;
      const server = yield* openViewServer({
        runtime,
        initial, port, refreshEnabled: true, initialRunIds: runIds, initialPath: entryPath + (selection.size === 0 ? "" : `?${selection}`),
        refreshSource: {
          cutoffIdentity: () => operationalCutoffAt(facts.cwd).pipe(Effect.map((cutoff) => cutoff.identity)),
          build: () => buildRecordGeneration(sourcePath, facts.cwd, project, currentCapable, true).pipe(
            Effect.provideService(Scope.Scope, scope),
            Effect.map((next) => next.generation),
          ),
        },
      }).pipe(
        Effect.mapError((cause) => failure("open loopback View", cause)),
      );
      yield* write("stdout", json
        ? renderViewLifecycleEvent({ protocol: VIEW_LIFECYCLE_PROTOCOL, event: "ready", url: server.readyUrl })
        : `niceeval view — open in a browser:\n${server.readyUrl}\n`);
      if (parsed.values["no-open"] !== true) {
        const browser = yield* ViewBrowser;
        yield* browser.open(server.readyUrl).pipe(Effect.catch(() => Effect.succeed(false)));
      }
      const interruption = yield* CliInterruption;
      if (!interruption.enterGracefulDispatch()) return yield* Effect.interrupt;
      yield* awaitAbort(interruption.invocationSignal);
      yield* server.close;
      if (json) yield* write("stdout", renderViewLifecycleEvent({ protocol: VIEW_LIFECYCLE_PROTOCOL, event: "closed" }));
      return 0;
    });

    return yield* execute.pipe(Effect.catch((cause) =>
      Effect.fail(cause instanceof CliFeatureError ? cause : failure("run View", cause))
    ));
  });
}

function buildRecordGeneration(
  sourcePath: string,
  cwd: string,
  project: ProjectConfigurationService,
  currentCapable: boolean,
  refresh: boolean,
): Effect.Effect<{ readonly generation: ViewGeneration; readonly cutoffIdentity: string }, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const importer = yield* Effect.acquireRelease(
      Effect.try({
        try: () => startExternalRecordImport(sourcePath, Date.now() + RECORD_IMPORT_DEADLINE_MS, "project-record"),
        catch: (cause) => failure("start Record import", cause),
      }),
      (handle) => Effect.promise(() => handle.close().catch(() => undefined)),
    );
    return yield* Effect.gen(function* () {
      const imported = yield* Effect.tryPromise({
        try: (_signal) => importer.result,
        catch: (cause) => failure("import Record", cause),
      });
      let retired = false;
      const retire = async (): Promise<void> => {
        if (retired) return;
        retired = true;
        await importer.close();
      };
      const cutoff = yield* importedCutoffAt(imported.path);
      const prepareTarget = Effect.scoped(Effect.gen(function* () {
        const config = yield* (refresh ? project.rebuild(cwd) : project.load(cwd));
        const source = yield* openCurrentProjectSource({ cwd, config, recordPath: imported.path, freshImport: true });
        const frozen = projectInput(source);
        if (frozen === undefined || frozen.cutoffIdentity !== cutoff.identity) {
          return yield* Effect.fail(new Error("Current target and imported Record cutoff differ."));
        }
        return Object.freeze({ kind: "current" as const, identity: frozen.target.identity, input: frozen });
      })).pipe(Effect.mapError((cause) => failure("prepare current target", cause)));
      const target: ViewTarget = !currentCapable
        ? { kind: "history" }
        : yield* (refresh ? prepareTarget : prepareTarget.pipe(Effect.catch((cause) =>
          Effect.succeed({ kind: "unavailable" as const, reason: targetFailureReason(cause) }))));
      const generation = yield* buildViewGeneration({
        recordPath: imported.path,
        sourceCutoffIdentity: cutoff.identity,
        target,
        retire,
      }).pipe(Effect.mapError((cause) => failure("build View revision", cause)));
      return Object.freeze({ generation, cutoffIdentity: cutoff.identity });
    }).pipe(Effect.catchCause((cause) =>
      Effect.promise(() => importer.close().catch(() => undefined)).pipe(Effect.andThen(Effect.failCause(cause)))
    ));
  });
}

function operationalCutoffAt(cwd: string) {
  return Effect.scoped(Effect.gen(function* () {
    const session = yield* acquireProjectRecordReadSession(resolve(cwd, ".niceeval")).pipe(
      Effect.mapError((cause) => failure("open operational sealed cutoff", cause)),
    );
    return yield* Effect.try({
      try: () => ({ identity: publicationCutoffIdentity(session.publicationCutoff()) }),
      catch: (cause) => failure("read operational sealed cutoff", cause),
    });
  }));
}

function importedCutoffAt(recordPath: string) {
  return withRecordSession(
    Effect.try({
      try: () => openHostOwnedRecordReadSession(recordPath),
      catch: (cause) => failure("open imported Record", cause),
    }),
    "read imported Record cutoff",
  );
}

function withRecordSession(
  acquire: Effect.Effect<ReturnType<typeof openHostOwnedRecordReadSession>, Error>,
  operation: string,
) {
  return Effect.acquireUseRelease(
    acquire,
    (session) => Effect.try({
      try: () => session.sealedCutoff(),
      catch: (cause) => failure(operation, cause),
    }),
    (session) => Effect.sync(() => session.close()),
  );
}

function invocationFacts() {
  return Effect.flatMap(CliInvocationFacts, ({ facts }) => facts).pipe(
    Effect.mapError((cause) => failure("read invocation facts", cause)),
  );
}

function parseRunIds(value: string | boolean | string[] | undefined): readonly RunId[] | string {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  if (values.length > VIEW_RUN_SELECTION_LIMIT) return `niceeval view accepts at most ${VIEW_RUN_SELECTION_LIMIT} run: selections.`;
  const output: RunId[] = [];
  for (const candidate of [...new Set(values)]) {
    const decoded = Schema.decodeUnknownResult(RunIdSchema)(candidate);
    if (Result.isFailure(decoded)) return `Invalid run: ID ${JSON.stringify(candidate)}.`;
    output.push(decoded.success);
  }
  return Object.freeze(output);
}

function parsePort(value: string | boolean | string[] | undefined): number | string {
  const text = typeof value === "string" ? value : "0";
  const port = Number(text);
  return Number.isInteger(port) && port >= 0 && port <= 65_535
    ? port
    : `--port must be an integer from 0 through 65535, got ${JSON.stringify(text)}.`;
}

function awaitAbort(signal: AbortSignal): Effect.Effect<void> {
  return Effect.callback((resume) => {
    if (signal.aborted) {
      resume(Effect.void);
      return Effect.void;
    }
    const aborted = (): void => resume(Effect.void);
    signal.addEventListener("abort", aborted, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", aborted));
  });
}

export const viewCliCommand: CliCommandContribution<Requirements, Error> = Object.freeze({
  name: "view",
  summary: "open the first-party human View",
  options: VIEW_CLI_OPTIONS,
  run: runView,
});
