import { Effect, Either, Schema } from "effect";
import type * as Scope from "effect/Scope";

import { parseAttemptLocator, type AttemptLocator } from "../../attempt-locator.ts";
import {
  CliArguments,
  CliInterruption,
  CliInvocationFacts,
  CliOutput,
  type CliOptionDefinition,
} from "../../cli/application.ts";
import { CliFeatureError, type CliCommandContribution } from "../../cli/contribution.ts";
import {
  canonicalJsonValue,
  openInspectionSource,
  operationalInspectionSource,
  snapshotInspectionSource,
  type InspectionSource,
} from "../../inspection/index.ts";
import { RunIdSchema } from "../../record/codec/identifiers.ts";
import type { RunId } from "../../record/model/identifiers.ts";
import { ViewBrowser } from "../browser.ts";
import { buildViewRevision, type ViewTarget } from "../render.ts";
import { viewRevisionData, type ViewRevision } from "../revision.ts";
import { openFixedView, type FixedViewServer } from "../server.ts";

const help = (summary: string) => Object.freeze({ summary, visibility: "public" as const });
const option = (value: CliOptionDefinition): CliOptionDefinition => Object.freeze(value);

export const VIEW_CLI_OPTIONS = Object.freeze({
  record: option({ type: "string", help: help("Read one Host-exported RecordSnapshot file.") }),
  run: option({ type: "string", multiple: true, help: help("Select one sealed Run; repeat to select more.") }),
  "no-open": option({ type: "boolean", help: help("Do not request the OS browser.") }),
  port: option({ type: "string", help: help("Listen on this loopback port; 0 chooses one.") }),
  json: option({ type: "boolean", help: help("Write lifecycle-only NDJSON.") }),
  help: option({ type: "boolean", short: "h", help: help("Print view help.") }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const VIEW_HELP = `niceeval view — open the first-party human View

Usage:
  niceeval view [@<attempt-locator> | --run <run-id>...] [--record <RecordSnapshot>] [--no-open] [--port <port>] [--json]
`;

type Requirements = CliArguments | CliInterruption | CliInvocationFacts | CliOutput | ViewBrowser | Scope.Scope;
type Error = CliFeatureError;
const VIEW_RUN_SELECTION_LIMIT = 64;

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
    if (parsed.values.help === true) {
      yield* write("stdout", VIEW_HELP);
      return 0;
    }
    if (parsed.positionals.length > 1) return yield* usage("niceeval view accepts at most one Attempt locator.");
    const locator = parsed.positionals[0] === undefined ? undefined : parseAttemptLocator(parsed.positionals[0]);
    if (locator !== undefined && !locator.valid) return yield* usage("niceeval view positional must be one exact Attempt locator.");
    const runIds = parseRunIds(parsed.values.run);
    if (typeof runIds === "string") return yield* usage(runIds);
    if (locator?.valid === true && runIds.length > 0) return yield* usage("An Attempt locator cannot combine with --run.");
    const port = parsePort(parsed.values.port);
    if (typeof port === "string") return yield* usage(port);
    const json = parsed.values.json === true;
    const facts = yield* invocationFacts();
    const source = sourceFromValues(facts.cwd, parsed.values.record);
    const target: ViewTarget = locator?.valid === true
      ? Object.freeze({ kind: "attempt" as const, locator: locator.locator })
      : runIds.length > 0
        ? Object.freeze({ kind: "runs" as const, runIds })
        : Object.freeze({ kind: "overview" as const });

    const execute = Effect.gen(function* () {
      const initial = yield* buildPinnedViewRevision(source, target);
      const refreshEnabled = source.kind === "operational" && target.kind === "overview";
      const server = yield* openFixedView({ initial, port, refreshEnabled }).pipe(
        Effect.mapError((cause) => failure("open loopback View", cause)),
      );
      if (source.kind === "operational" && target.kind === "overview") {
        yield* startOperationalRefresh(source, target, server, initial);
      }
      if (json) yield* writeLifecycle("ready", { url: server.readyUrl });
      else yield* write("stdout", `niceeval view — open in a browser:\n${server.readyUrl}\n`);
      if (parsed.values["no-open"] !== true) {
        const browser = yield* ViewBrowser;
        yield* browser.open(server.readyUrl).pipe(Effect.catchAll(() => Effect.succeed(false)));
      }
      const interruption = yield* CliInterruption;
      if (!interruption.enterGracefulDispatch()) return yield* Effect.interrupt;
      yield* awaitAbort(interruption.invocationSignal);
      yield* server.close;
      if (json) yield* writeLifecycle("closed", {});
      return 0;
    });

    return yield* execute.pipe(Effect.catchAll((cause) => Effect.gen(function* () {
      if (json) yield* writeLifecycle("failed", { code: "inspection-view-failed" }).pipe(Effect.ignore);
      return yield* Effect.fail(cause instanceof CliFeatureError ? cause : failure("run View", cause));
    })));
  });
}

function startOperationalRefresh(
  source: InspectionSource,
  target: Extract<ViewTarget, { readonly kind: "overview" }>,
  server: FixedViewServer,
  initial: ViewRevision,
): Effect.Effect<void, never, Scope.Scope | CliOutput> {
  return Effect.gen(function* () {
    let selectedCutoffIdentity = viewRevisionData(initial).identity.sourceCutoffIdentity;
    const poll = Effect.gen(function* () {
      const revision = yield* buildPinnedViewCandidate(source, target, selectedCutoffIdentity);
      if (revision === undefined) return;
      const cutoffIdentity = viewRevisionData(revision).identity.sourceCutoffIdentity;
      selectedCutoffIdentity = cutoffIdentity;
      yield* Effect.sync(() => server.publishCandidate(revision));
    }).pipe(
      Effect.catchAll((cause) => write("stderr", `view refresh candidate failed: ${safeReason(cause)}\n`).pipe(Effect.ignore)),
    );
    yield* Effect.forkScoped(Effect.forever(Effect.sleep("500 millis").pipe(Effect.zipRight(poll))));
  }).pipe(
    Effect.catchAll((cause) => write("stderr", `view refresh watcher failed: ${safeReason(cause)}\n`).pipe(Effect.ignore)),
    Effect.asVoid,
  );
}

function buildPinnedViewCandidate(
  source: InspectionSource,
  target: Extract<ViewTarget, { readonly kind: "overview" }>,
  selectedCutoffIdentity: string,
): Effect.Effect<ViewRevision | undefined, Error> {
  return Effect.scoped(Effect.gen(function* () {
    const opened = yield* openInspectionSource(source).pipe(
      Effect.mapError((cause) => failure("open Record source", cause)),
    );
    const cutoff = opened.facts.cutoff();
    if (cutoff.identity === selectedCutoffIdentity) return undefined;
    return yield* buildViewRevision(opened, target).pipe(
      Effect.mapError((cause) => failure("build refresh View revision", cause)),
    );
  }));
}

function buildPinnedViewRevision(
  source: InspectionSource,
  target: ViewTarget,
): Effect.Effect<ViewRevision, Error> {
  return Effect.scoped(Effect.gen(function* () {
    const opened = yield* openInspectionSource(source).pipe(
      Effect.mapError((cause) => failure("open Record source", cause)),
    );
    return yield* buildViewRevision(opened, target).pipe(
      Effect.mapError((cause) => failure("build first-party View", cause)),
    );
  }));
}

function sourceFromValues(cwd: string, record: string | boolean | string[] | undefined): InspectionSource {
  return typeof record === "string" ? snapshotInspectionSource(cwd, record) : operationalInspectionSource(cwd);
}

function invocationFacts() {
  return Effect.flatMap(CliInvocationFacts, ({ facts }) => facts).pipe(
    Effect.mapError((cause) => failure("read invocation facts", cause)),
  );
}

function writeLifecycle(event: "ready" | "closed" | "failed", fields: Readonly<Record<string, string>>) {
  const encoded = canonicalJsonValue(Object.freeze({ protocol: "niceeval.view-lifecycle/v1", event, ...fields }));
  return Either.isLeft(encoded) ? Effect.fail(failure("encode lifecycle", encoded.left)) : write("stdout", encoded.right);
}

function parseRunIds(value: string | boolean | string[] | undefined): readonly RunId[] | string {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  if (values.length > VIEW_RUN_SELECTION_LIMIT) {
    return `niceeval view accepts at most ${VIEW_RUN_SELECTION_LIMIT} --run selections.`;
  }
  const output: RunId[] = [];
  for (const candidate of [...new Set(values)]) {
    const decoded = Schema.decodeUnknownEither(RunIdSchema)(candidate);
    if (Either.isLeft(decoded)) return `Invalid --run value ${JSON.stringify(candidate)}.`;
    output.push(decoded.right);
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
  return Effect.async((resume) => {
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
