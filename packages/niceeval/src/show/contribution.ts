import { Effect, Result, Schema } from "effect";

import {
  CliArguments,
  CliInvocationFacts,
  CliOutput,
  type CliOptionDefinition,
} from "../cli/application.ts";
import {
  CliFeatureError,
  type CliCommandContribution,
} from "../cli/contribution.ts";
import {
  openInspectionSource,
  operationalInspectionSource,
  selectInspectionOperation,
  snapshotInspectionSource,
  type InspectionDocument,
  type InspectionOperation,
} from "../inspection/index.ts";
import { RunIdSchema } from "../record/codec/identifiers.ts";
import { ATTEMPT_LOCATOR_PATTERN } from "../attempt-locator.ts";
import {
  renderAttempt,
  renderOverview,
  renderRun,
  renderSources,
  renderTrace,
  renderTraceDetail,
  traceSelector,
} from "./render.ts";
import {
  projectAttempt,
  projectOverview,
  projectRun,
  projectSources,
  projectTrace,
  projectTraceDetail,
} from "./model.ts";

const help = (summary: string) =>
  Object.freeze({ summary, visibility: "public" as const });
const option = (value: CliOptionDefinition): CliOptionDefinition =>
  Object.freeze(value);
export const SHOW_CLI_OPTIONS = Object.freeze({
  record: option({
    type: "string",
    help: help("Read one Host-exported RecordSnapshot file."),
  }),
  run: option({
    type: "string",
    multiple: true,
    help: help("Show one sealed Run; repeat to show more."),
  }),
  source: option({
    type: "boolean",
    help: help("Show captured source facts for one Attempt locator."),
  }),
  execution: option({
    type: "boolean",
    help: help("Show the execution outline for one Attempt locator."),
  }),
  expand: option({
    type: "string",
    help: help("Expand one stable execution identity."),
  }),
  help: option({ type: "boolean", short: "h", help: help("Print show help.") }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const SHOW_HELP = `niceeval show — inspect results in the terminal

Usage:
  niceeval show [--record <RecordSnapshot>]
  niceeval show --run <run-id>... [--record <RecordSnapshot>]
  niceeval show @<locator> [--record <RecordSnapshot>]
  niceeval show @<locator> --source [--record <RecordSnapshot>]
  niceeval show @<locator> --execution [--expand <stable-id>] [--record <RecordSnapshot>]
`;
type Requirements = CliArguments | CliInvocationFacts | CliOutput;
type Error = CliFeatureError;
const failure = (operation: string, cause: unknown) =>
  new CliFeatureError({ feature: "show", operation, cause, exitCode: 1 });
const write = (channel: "stdout" | "stderr", value: string) =>
  Effect.flatMap(CliOutput, (output) =>
    channel === "stdout"
      ? output.writeStdout(value)
      : output.writeStderr(value),
  ).pipe(Effect.mapError((cause) => failure(`write ${channel}`, cause)));
const usage = (message: string) =>
  write("stderr", `${message}\n`).pipe(Effect.as(1));

function runShow(
  argv: readonly string[],
): Effect.Effect<number, Error, Requirements> {
  return Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsedResult = yield* Effect.try({
      try: () => parser.parse(argv, SHOW_CLI_OPTIONS),
      catch: (cause) => failure("parse arguments", cause),
    }).pipe(Effect.result);
    if (Result.isFailure(parsedResult))
      return yield* usage(reason(parsedResult.failure.cause));
    const parsed = parsedResult.success;
    if (parsed.values.help === true) {
      yield* write("stdout", SHOW_HELP);
      return 0;
    }
    const locator = parsed.positionals[0];
    if (parsed.positionals.length > 1)
      return yield* usage("niceeval show accepts at most one Attempt locator.");
    if (locator !== undefined && !ATTEMPT_LOCATOR_PATTERN.test(locator))
      return yield* usage(
        `Invalid Attempt locator ${JSON.stringify(locator)}; expected canonical @<locator>.`,
      );
    const runIds = parseRunIds(parsed.values.run);
    if (typeof runIds === "string") return yield* usage(runIds);
    const source = parsed.values.source === true;
    const execution = parsed.values.execution === true;
    const expand =
      typeof parsed.values.expand === "string"
        ? parsed.values.expand
        : undefined;
    if (source && execution)
      return yield* usage("--source and --execution are mutually exclusive.");
    if ((source || execution) && locator === undefined)
      return yield* usage(
        "--source and --execution require one Attempt locator.",
      );
    if (expand !== undefined && !execution)
      return yield* usage("--expand requires --execution.");
    if (expand !== undefined && /^(?:t\d+\.c\d+|cmd\d+)$/u.test(expand))
      return yield* usage(
        "Legacy positional execution handles are not accepted; use a stable itemId, toolOccurrenceId, or commandId from the outline.",
      );
    if (locator !== undefined && runIds.length > 0)
      return yield* usage(
        "An Attempt locator and --run are mutually exclusive.",
      );
    const facts = yield* Effect.flatMap(
      CliInvocationFacts,
      ({ facts }) => facts,
    ).pipe(Effect.mapError((cause) => failure("read invocation facts", cause)));
    const inspectionSource =
      typeof parsed.values.record === "string"
        ? snapshotInspectionSource(facts.cwd, parsed.values.record)
        : operationalInspectionSource(facts.cwd);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* openInspectionSource(inspectionSource).pipe(
          Effect.mapError((cause) => failure("open Record source", cause)),
        );
        const select = (
          operation: InspectionOperation,
        ): Effect.Effect<InspectionDocument, Error> =>
          Effect.try({
            try: () => selectInspectionOperation(opened, operation),
            catch: (cause) => failure(`execute ${operation.kind}`, cause),
          });
        const project = <A>(
          operation: string,
          evaluate: () => A,
        ): Effect.Effect<A, Error> =>
          Effect.try({
            try: evaluate,
            catch: (cause) => failure(`project ${operation} result`, cause),
          });
        if (locator === undefined && runIds.length === 0) {
          const document = yield* select({ kind: "overview.get" });
          yield* write(
            "stdout",
            renderOverview(
              yield* project("overview.get", () => projectOverview(document)),
            ),
          );
          return 0;
        }
        if (runIds.length > 0) {
          for (const runId of runIds) {
            const details = yield* select({ kind: "run.get", runId });
            const summary = yield* select({ kind: "run.summary", runId });
            yield* write(
              "stdout",
              renderRun(
                yield* project("run.get/run.summary", () =>
                  projectRun(details, summary),
                ),
              ),
            );
          }
          return 0;
        }
        const selectedLocator = locator!;
        if (source) {
          const document = yield* select({
            kind: "attempt.sources",
            locator: selectedLocator,
          });
          yield* write(
            "stdout",
            renderSources(
              yield* project("attempt.sources", () =>
                projectSources(document, selectedLocator),
              ),
            ),
          );
          return 0;
        }
        if (execution) {
          const outline = yield* select({
            kind: "attempt.trace",
            locator: selectedLocator,
          });
          const trace = yield* project("attempt.trace", () =>
            projectTrace(outline, selectedLocator),
          );
          if (expand === undefined) {
            yield* write("stdout", renderTrace(trace));
            return 0;
          }
          const selector = traceSelector(trace, expand);
          if (selector === undefined)
            return yield* usage(
              `Stable execution identity ${JSON.stringify(expand)} is not present in this Attempt outline.`,
            );
          const detail = yield* select({
            kind: "attempt.trace.detail",
            locator: selectedLocator,
            selector,
          } as InspectionOperation);
          yield* write(
            "stdout",
            renderTraceDetail(
              yield* project("attempt.trace.detail", () =>
                projectTraceDetail(detail, selectedLocator),
              ),
            ),
          );
          return 0;
        }
        const document = yield* select({
          kind: "attempt.get",
          locator: selectedLocator,
        });
        yield* write(
          "stdout",
          renderAttempt(
            yield* project("attempt.get", () => projectAttempt(document)),
          ),
        );
        return 0;
      }),
    );
  });
}

function parseRunIds(
  value: string | boolean | string[] | undefined,
): readonly Schema.Schema.Type<typeof RunIdSchema>[] | string {
  const values =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const output: Schema.Schema.Type<typeof RunIdSchema>[] = [];
  for (const candidate of values) {
    const decoded = Schema.decodeUnknownResult(RunIdSchema)(candidate);
    if (Result.isFailure(decoded))
      return `Invalid --run value ${JSON.stringify(candidate)}.`;
    if (!output.includes(decoded.success)) output.push(decoded.success);
  }
  return Object.freeze(output);
}
function reason(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export const showCliCommand: CliCommandContribution<Requirements, Error> =
  Object.freeze({
    name: "show",
    summary: "inspect results in the terminal",
    options: SHOW_CLI_OPTIONS,
    run: runShow,
  });
