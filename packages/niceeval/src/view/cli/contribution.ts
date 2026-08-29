import { resolve } from "node:path";
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
  openOperationalRecordReadSession,
} from "../../record/sqlite/index.ts";
import { startExternalRecordImport } from "../../record/sqlite/external-record-import.ts";
import { ViewBrowser } from "../browser.ts";
import { renderViewLifecycleEvent, VIEW_LIFECYCLE_PROTOCOL } from "../protocol.ts";
import { buildViewGeneration } from "../render.ts";
import type { ViewGeneration } from "../revision.ts";
import { openViewServer, type ViewServer } from "../server.ts";

const help = (summary: string) => Object.freeze({ summary, visibility: "public" as const });
const option = (value: CliOptionDefinition): CliOptionDefinition => Object.freeze(value);

export const VIEW_CLI_OPTIONS = Object.freeze({
  run: option({ type: "string", multiple: true, help: help("Select one sealed Run; repeat to select more.") }),
  "no-open": option({ type: "boolean", help: help("Do not request the OS browser.") }),
  port: option({ type: "string", help: help("Listen on this loopback port; 0 chooses one.") }),
  json: option({ type: "boolean", help: help("Write View lifecycle events as NDJSON.") }),
  help: option({ type: "boolean", short: "h", help: help("Print view help.") }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const VIEW_HELP = `niceeval view — open the first-party human View

Usage:
  niceeval view [--run <run-id>...] [--no-open] [--port <port>] [--json]
`;

type Requirements = CliArguments | CliInterruption | CliInvocationFacts | CliOutput | ViewBrowser | Scope.Scope;
type Error = CliFeatureError;
const VIEW_RUN_SELECTION_LIMIT = 64;
const RECORD_IMPORT_DEADLINE_MS = 30_000;

function failure(operation: string, cause: unknown): Error {
  return new CliFeatureError({ feature: "view", operation, cause, exitCode: 1 });
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
    if (parsed.positionals.length !== 0) return yield* usage("niceeval view does not accept positional arguments.");
    const runIds = parseRunIds(parsed.values.run);
    if (typeof runIds === "string") return yield* usage(runIds);
    const port = parsePort(parsed.values.port);
    if (typeof port === "string") return yield* usage(port);
    const facts = yield* invocationFacts();
    const execute = Effect.gen(function* () {
      const json = parsed.values.json === true;
      const sourcePath = resolve(facts.cwd, ".niceeval/record.sqlite");
      const built = yield* buildRecordGeneration(sourcePath);
      const initial = built.generation;
      const operationalCutoff = built.cutoffIdentity;
      const server = yield* openViewServer({ initial, port, refreshEnabled: true, initialRunIds: runIds }).pipe(
        Effect.mapError((cause) => failure("open loopback View", cause)),
      );
      yield* startOperationalRefresh(facts.cwd, server, operationalCutoff);
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
): Effect.Effect<{ readonly generation: ViewGeneration; readonly cutoffIdentity: string }, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const importer = yield* Effect.acquireRelease(
      Effect.try({
        try: () => startExternalRecordImport(sourcePath, Date.now() + RECORD_IMPORT_DEADLINE_MS),
        catch: (cause) => failure("start Record import", cause),
      }),
      (handle) => Effect.promise(() => handle.close().catch(() => undefined)),
    );
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
    const generation = yield* buildViewGeneration({
      recordPath: imported.path,
      sourceCutoffIdentity: cutoff.identity,
      retire,
    }).pipe(Effect.mapError((cause) => failure("build View revision", cause)));
    return Object.freeze({ generation, cutoffIdentity: cutoff.identity });
  });
}

function operationalCutoffAt(cwd: string) {
  return withRecordSession(
    Effect.try({
      try: () => {
        return openOperationalRecordReadSession(resolve(cwd, ".niceeval"));
      },
      catch: (cause) => failure("open operational sealed cutoff", cause),
    }),
    "read operational sealed cutoff",
  );
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
      try: () => session.readSealedRunSummaryPage("", 1).cutoff,
      catch: (cause) => failure(operation, cause),
    }),
    (session) => Effect.sync(() => session.close()),
  );
}

function startOperationalRefresh(
  cwd: string,
  server: ViewServer,
  initialCutoffIdentity: string,
): Effect.Effect<void, never, Scope.Scope | CliOutput> {
  return Effect.gen(function* () {
    let selectedCutoffIdentity = initialCutoffIdentity;
    const poll = Effect.gen(function* () {
      const observed = yield* operationalCutoffAt(cwd);
      if (observed.identity === selectedCutoffIdentity) return;
      const built = yield* buildRecordGeneration(resolve(cwd, ".niceeval/record.sqlite"));
      selectedCutoffIdentity = built.cutoffIdentity;
      yield* Effect.sync(() => server.publishCandidate(built.generation));
    }).pipe(
      Effect.catch((cause) => write("stderr", `view refresh candidate failed: ${safeReason(cause)}\n`).pipe(Effect.ignore)),
    );
    yield* Effect.forkScoped(Effect.forever(Effect.sleep("500 millis").pipe(Effect.andThen(poll))));
  }).pipe(
    Effect.catch((cause) => write("stderr", `view refresh watcher failed: ${safeReason(cause)}\n`).pipe(Effect.ignore)),
    Effect.asVoid,
  );
}

function invocationFacts() {
  return Effect.flatMap(CliInvocationFacts, ({ facts }) => facts).pipe(
    Effect.mapError((cause) => failure("read invocation facts", cause)),
  );
}

function parseRunIds(value: string | boolean | string[] | undefined): readonly RunId[] | string {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  if (values.length > VIEW_RUN_SELECTION_LIMIT) return `niceeval view accepts at most ${VIEW_RUN_SELECTION_LIMIT} --run selections.`;
  const output: RunId[] = [];
  for (const candidate of [...new Set(values)]) {
    const decoded = Schema.decodeUnknownResult(RunIdSchema)(candidate);
    if (Result.isFailure(decoded)) return `Invalid --run value ${JSON.stringify(candidate)}.`;
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

function safeReason(value: unknown): string {
  return value instanceof Error
    ? value.message.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").slice(0, 512)
    : "first-party View refresh failed";
}

export const viewCliCommand: CliCommandContribution<Requirements, Error> = Object.freeze({
  name: "view",
  summary: "open the first-party human View",
  options: VIEW_CLI_OPTIONS,
  run: runView,
});
