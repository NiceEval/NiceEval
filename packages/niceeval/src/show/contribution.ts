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
import { ProjectConfiguration } from "../cli/project-configuration.ts";
import { experimentHost, type ExperimentHostRequirements } from "../experiment/host/index.ts";
import {
  openInspectionSource,
  operationalInspectionSource,
  selectInspectionOperation,
} from "../inspection/index.ts";
import {
  ExperimentIdSchema,
  RunIdSchema,
} from "../record/codec/identifiers.ts";
import { parseAttemptLocator } from "../attempt-locator.ts";
import {
  renderAttempt,
  renderDiff,
  renderExperiment,
  renderOverview,
  renderRun,
  renderSources,
  renderTiming,
  renderTrace,
  renderTraceDetail,
  renderUsage,
  traceSelector,
} from "./render.ts";
import {
  projectAttempt,
  projectDiff,
  projectExperiment,
  projectOverview,
  projectRun,
  projectSources,
  projectTiming,
  projectTrace,
  projectTraceDetail,
  projectUsage,
} from "./model.ts";

const help = (summary: string) =>
  Object.freeze({ summary, visibility: "public" as const });
const option = (value: CliOptionDefinition): CliOptionDefinition =>
  Object.freeze(value);
export const SHOW_CLI_OPTIONS = Object.freeze({
  run: option({
    type: "string",
    multiple: true,
    help: help("Show one sealed Run; repeat to show more."),
  }),
  experiment: option({
    type: "string",
    multiple: true,
    help: help("Show one Experiment; repeat to show more."),
  }),
  source: option({
    type: "boolean",
    help: help("Show captured source facts for one Attempt locator."),
  }),
  execution: option({
    type: "boolean",
    help: help("Show the execution outline for one Attempt locator."),
  }),
  timing: option({
    type: "boolean",
    help: help("Show captured timing for one Attempt locator."),
  }),
  usage: option({
    type: "boolean",
    help: help("Show captured usage for one Attempt locator."),
  }),
  diff: option({
    type: "boolean",
    help: help("Show captured file changes for one Attempt locator."),
  }),
  expand: option({
    type: "string",
    help: help("Expand one stable execution identity."),
  }),
  help: option({ type: "boolean", short: "h", help: help("Print show help.") }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const SHOW_HELP = `niceeval show — inspect results in the terminal

Usage:
  niceeval show
  niceeval show --run <run-id>...
  niceeval show --experiment <experiment-id>...
  niceeval show @<locator>
  niceeval show @<locator> --source
  niceeval show @<locator> --execution [--expand <stable-id>]
  niceeval show @<locator> --timing
  niceeval show @<locator> --usage
  niceeval show @<locator> --diff

Selectors:
  --run <run-id>                Show one exact sealed Run; repeatable.
  --experiment <experiment-id>  Show one exact Experiment; repeatable.

Attempt details:
  --source                      Show captured sources and Assertion sites.
  --execution                   Show the bounded execution outline.
  --expand <stable-id>          Expand an itemId, toolOccurrenceId, or commandId.
  --timing                      Show captured timing activities.
  --usage                       Show captured usage totals and observations.
  --diff                        Show captured file-change windows.

  --help, -h                    Print show help.
`;
type Requirements = CliArguments | CliInvocationFacts | CliOutput | ProjectConfiguration | ExperimentHostRequirements;
type Error = CliFeatureError;
const failure = (operation: string, cause: unknown) => {
  const detail =
    typeof cause === "object" &&
    cause !== null &&
    typeof Reflect.get(cause, "reason") === "string"
      ? Reflect.get(cause, "reason") as string
      : undefined;
  return new CliFeatureError({
    feature: "show",
    operation,
    cause,
    exitCode: 1,
    ...(detail === undefined
      ? {}
      : { display: `show ${operation} failed: ${detail}\n` }),
  });
};
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
    const decodedLocator = locator === undefined
      ? undefined
      : parseAttemptLocator(locator);
    if (decodedLocator !== undefined && !decodedLocator.valid)
      return yield* usage(
        `Invalid Attempt locator ${JSON.stringify(locator)}; expected canonical @<locator>.`,
      );
    const runIds = parseRunIds(parsed.values.run);
    if (typeof runIds === "string") return yield* usage(runIds);
    const experimentIds = parseExperimentIds(parsed.values.experiment);
    if (typeof experimentIds === "string") return yield* usage(experimentIds);
    const source = parsed.values.source === true;
    const execution = parsed.values.execution === true;
    const timing = parsed.values.timing === true;
    const showUsage = parsed.values.usage === true;
    const diff = parsed.values.diff === true;
    const detailModes = [source, execution, timing, showUsage, diff].filter(
      Boolean,
    ).length;
    const expand =
      typeof parsed.values.expand === "string"
        ? parsed.values.expand
        : undefined;
    if (detailModes > 1)
      return yield* usage(
        "--source, --execution, --timing, --usage, and --diff are mutually exclusive.",
      );
    if (detailModes > 0 && locator === undefined)
      return yield* usage(
        "--source, --execution, --timing, --usage, and --diff require one Attempt locator.",
      );
    if (expand !== undefined && !execution)
      return yield* usage("--expand requires --execution.");
    if (expand !== undefined && /^(?:t\d+\.c\d+|cmd\d+)$/u.test(expand))
      return yield* usage(
        "Legacy positional execution handles are not accepted; use a stable itemId, toolOccurrenceId, or commandId from the outline.",
      );
    if (locator !== undefined && (runIds.length > 0 || experimentIds.length > 0))
      return yield* usage(
        "An Attempt locator, --run, and --experiment are mutually exclusive.",
      );
    if (runIds.length > 0 && experimentIds.length > 0)
      return yield* usage("--run and --experiment are mutually exclusive.");
    const facts = yield* Effect.flatMap(
      CliInvocationFacts,
      ({ facts }) => facts,
    ).pipe(Effect.mapError((cause) => failure("read invocation facts", cause)));
    const inspectionSource = operationalInspectionSource(facts.cwd);
    const currentTargets = runIds.length > 0 || decodedLocator !== undefined
      ? undefined
      : yield* Effect.gen(function* () {
        const project = yield* ProjectConfiguration;
        const config = yield* project.load(facts.cwd).pipe(
          Effect.mapError((cause) => failure("load config", cause)),
        );
        const plan = yield* experimentHost.invocation.plan({
          cwd: facts.cwd,
          config,
          preview: true,
        }).pipe(Effect.mapError((cause) => failure("plan current targets", cause)));
        if (plan.status !== "ready" || plan.dry === undefined) {
          return yield* Effect.fail(failure(
            "plan current targets",
            new Error("Current project does not contain a runnable Experiment selection."),
          ));
        }
        return Object.freeze(plan.dry.slots.map(({ target }) => Object.freeze({
          experimentId: target.experimentId,
          evalId: target.evalId,
          attemptOrdinal: target.attempt,
          executionIdentityDigest: target.executionIdentityDigest,
        })));
      });
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* openInspectionSource(inspectionSource).pipe(
          Effect.mapError((cause) => failure("open Record source", cause)),
        );
        const select = <A>(
          operation: string,
          evaluate: () => A,
        ): Effect.Effect<A, Error> =>
          Effect.try({
            try: evaluate,
            catch: (cause) => failure(`execute ${operation}`, cause),
          });
        const project = <A>(
          operation: string,
          evaluate: () => A,
        ): Effect.Effect<A, Error> =>
          Effect.try({
            try: evaluate,
            catch: (cause) => failure(`project ${operation} result`, cause),
          });
        if (
          decodedLocator === undefined &&
          runIds.length === 0 &&
          experimentIds.length === 0
        ) {
          const document = yield* select("overview.get", () =>
            selectInspectionOperation(
              opened,
              { kind: "overview.get" },
              currentTargets,
            ),
          );
          yield* write(
            "stdout",
            renderOverview(
              yield* project("overview.get", () => projectOverview(document)),
            ),
          );
          return 0;
        }
        if (runIds.length > 0) {
          const rendered: string[] = [];
          for (const runId of runIds) {
            const document = yield* select("run.overview", () =>
              selectInspectionOperation(opened, {
                kind: "run.overview",
                runId,
              }),
            );
            rendered.push(
              renderRun(
                yield* project("run.overview", () => projectRun(document)),
              ),
            );
          }
          yield* write("stdout", rendered.join(""));
          return 0;
        }
        if (experimentIds.length > 0) {
          const rendered: string[] = [];
          for (const experimentId of experimentIds) {
            const document = yield* select("experiment.get", () =>
              selectInspectionOperation(opened, {
                kind: "experiment.get",
                experimentId,
              }, currentTargets),
            );
            rendered.push(
              renderExperiment(
                yield* project("experiment.get", () =>
                  projectExperiment(document),
                ),
              ),
            );
          }
          yield* write("stdout", rendered.join(""));
          return 0;
        }
        const selectedLocator = decodedLocator!.locator;
        if (source) {
          const document = yield* select("attempt.sources", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.sources",
              locator: selectedLocator,
            }),
          );
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
          const outline = yield* select("attempt.trace", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.trace",
              locator: selectedLocator,
            }),
          );
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
          const detail = yield* select("attempt.trace.detail", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.trace.detail",
              locator: selectedLocator,
              selector,
            }),
          );
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
        if (timing) {
          const document = yield* select("attempt.timing", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.timing",
              locator: selectedLocator,
            }),
          );
          yield* write(
            "stdout",
            renderTiming(
              yield* project("attempt.timing", () =>
                projectTiming(document, selectedLocator),
              ),
            ),
          );
          return 0;
        }
        if (showUsage) {
          const document = yield* select("attempt.usage", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.usage",
              locator: selectedLocator,
            }),
          );
          yield* write(
            "stdout",
            renderUsage(
              yield* project("attempt.usage", () =>
                projectUsage(document, selectedLocator),
              ),
            ),
          );
          return 0;
        }
        if (diff) {
          const document = yield* select("attempt.diff", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.diff",
              locator: selectedLocator,
            }),
          );
          yield* write(
            "stdout",
            renderDiff(
              yield* project("attempt.diff", () =>
                projectDiff(document, selectedLocator),
              ),
            ),
          );
          return 0;
        }
        const document = yield* select("attempt.get", () =>
          selectInspectionOperation(opened, {
            kind: "attempt.get",
            locator: selectedLocator,
          }),
        );
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
  return Object.freeze(output.sort(compareIdentity));
}
function parseExperimentIds(
  value: string | boolean | string[] | undefined,
): readonly Schema.Schema.Type<typeof ExperimentIdSchema>[] | string {
  const values =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const output: Schema.Schema.Type<typeof ExperimentIdSchema>[] = [];
  for (const candidate of values) {
    const decoded = Schema.decodeUnknownResult(ExperimentIdSchema)(candidate);
    if (Result.isFailure(decoded))
      return `Invalid --experiment value ${JSON.stringify(candidate)}.`;
    if (!output.includes(decoded.success)) output.push(decoded.success);
  }
  return Object.freeze(output.sort(compareIdentity));
}
function compareIdentity(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
