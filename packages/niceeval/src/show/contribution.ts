// @concord-file
// @concord-implements docs/feature/inspection/cli.md
import { decodeAgentJudgeTrace, type AgentJudgeTrace } from "../assertions/agent-judge-audit.ts";
import { decodeBase64Bytes, InspectionSha256 } from "../inspection/bytes.ts";
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
  InspectionIntegrityError,
  InspectionOperationError,
  externalInspectionSource,
  openInspectionSource,
  operationalInspectionSource,
  selectInspectionOperation,
  type InspectionFactSource,
  type InspectionOperationFor,
  type InspectionSuccessDocumentFor,
} from "../inspection/index.ts";
import {
  ExperimentIdSchema,
  RunIdSchema,
} from "../record/codec/identifiers.ts";
import { parseAttemptLocator } from "../attempt-locator.ts";
import { ProjectConfiguration } from "../cli/project-configuration.ts";
import { CurrentTargetUnavailable } from "../experiment/host/current.ts";
import { openCurrentProjectSource } from "../inspection/project-source.ts";
import {
  renderComparison,
  comparisonRegressions,
  renderAttempt,
  renderAssertions,
  renderAssertionMatrix,
  renderReferences,
  renderDiff,
  renderExperiment,
  renderOverview,
  renderRun,
  renderSources,
  renderTiming,
  renderTrace,
  renderTraceDetail,
  renderUsage,
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

import { AssertionEntryIdSchema } from "../assertions/record/codec.ts";
import { canonicalInspectionJson } from "../inspection/canonical.ts";
import { QUERY_FAILURE_EXIT_CODE, queryFailureDocument } from "../inspection/cli/contribution.ts";
import type { InspectionDocument, InspectionOperation, InspectionOperationId } from "../inspection/protocol.ts";

const help = (summary: string) =>
  Object.freeze({ summary, visibility: "public" as const });
const option = (value: CliOptionDefinition): CliOptionDefinition =>
  Object.freeze(value);
export const SHOW_CLI_OPTIONS = Object.freeze({
  compare: option({ type: "boolean", help: help("Compare baseline and candidate Runs.") }),
  left: option({ type: "string", multiple: true, help: help("Baseline Run ID; repeatable.") }),
  right: option({ type: "string", multiple: true, help: help("Candidate Run ID; repeatable.") }),
  mode: option({ type: "string", help: help("Comparison mode: paired (default), side-by-side, or exact.") }),
  "max-regressions": option({ type: "string", help: help("Maximum allowed regressions (non-negative integer; paired or exact).") }),
  json: option({ type: "boolean", help: help("Print Inspection documents as JSON Lines.") }),
  output: option({ type: "string", short: "o", help: help("Output format: text (default) or json.") }),
  eval: option({ type: "string", help: help("Filter Eval ID path prefix; requires --experiment with --assertions.") }),
  assertions: option({ type: "boolean", help: help("Show Assertion roles, Verdict, Score, and reasons.") }),
  entry: option({ type: "string", help: help("Select one exact Assertion entry ID; requires --assertions.") }),
  compact: option({ type: "boolean", help: help("Omit raw Assertion materials and context rows (default).") }),
  full: option({ type: "boolean", help: help("Include complete Assertion materials and context rows.") }),
  reference: option({ type: "boolean", help: help("Show previous gap results with Verdicts, pass rate, and Score.") }),
  exp: option({ type: "string", multiple: true, help: help("Show one Experiment; repeat to show more.") }),
  record: option({
    type: "string",
    help: help("Read an external canonical SQLite Record."),
  }),
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
  all: option({
    type: "boolean",
    help: help("Show Attempts hidden by the compact Results view."),
  }),
  source: option({
    type: "boolean",
    help: help("Show captured source facts for one Attempt locator."),
  }),
  execution: option({
    type: "boolean",
    help: help("Show the execution outline for one Attempt locator."),
  }),
  actor: option({ type: "string", help: help("Filter execution events by exact actor ID.") }),
  type: option({ type: "string", help: help("Filter execution events by exact event type.") }),
  continuation: option({ type: "string", help: help("Read the next execution page with the same filters.") }),
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
  niceeval show [--all] [--record <file>]
  niceeval show --run <run-id>... [--record <file>]
  niceeval show --experiment <experiment-id>... [--record <file>]
  niceeval show @<locator> [--json] [--record <file>]
  niceeval show @<locator> --source
  niceeval show @<locator> --execution [--expand <stable-id>]
  niceeval show @<locator> --execution [--actor <id>] [--type <event-type>] [--continuation <token>]
  niceeval show @<locator> --timing
  niceeval show @<locator> --usage
  niceeval show @<locator> --diff

Comparison:
  --compare --left <run-id> --right <run-id>
  --mode paired|side-by-side|exact  Default: paired.
  --max-regressions <n>             Fail when regressions exceed n.

Selectors:
  --record <file>               Read an external canonical SQLite Record.
  --run <run-id>                Show one exact sealed Run; repeatable.
  --experiment <experiment-id>  Show one exact Experiment; repeatable.
  --all                         Show Attempts hidden by compact Results.

Attempt details:
  --assertions                  Show Assertion roles, Verdict, Score, and reasons.
  --entry <id>                  Select one Assertion; requires --assertions.
  --compact                     Omit raw materials and context rows (default).
  --full                        Include complete materials and context rows.
  --reference                   Show previous gap results with Verdicts, pass rate, and Score.
  --json, -o json               Print Inspection documents as JSON Lines.
  -o text                       Print the terminal view (default).
  --source                      Show captured sources and Assertion sites.
  --execution                   Show the bounded execution outline.
  --actor <id>                  Filter execution events by exact actor ID.
  --type <event-type>           Filter execution events by exact type.
  --continuation <token>        Read the next page using the same filters.
  --expand <stable-id>          Expand an execution event/evidence ID, itemId,
                              toolOccurrenceId, or commandId.
  --timing                      Show captured timing activities.
  --usage                       Show captured usage totals and observations.
  --diff                        Show captured file-change windows.

  --help, -h                    Print show help.
`;
type Requirements = CliArguments | CliInvocationFacts | CliOutput | ProjectConfiguration;
type Error = CliFeatureError;
const failure = (operation: string, cause: unknown, exitCode = 1) => {
  const detail = cause instanceof CurrentTargetUnavailable || cause instanceof InspectionOperationError && cause.code === "current-target-unavailable"
    ? `current-target-unavailable: ${cause.reason}\nRead fixed history: niceeval show --run <run-id>`
    : cause instanceof InspectionIntegrityError
    ? `Record integrity failure for sealed Run ${cause.runId}.`
    : cause instanceof InspectionOperationError &&
        cause.code === "inspection-record-integrity-failure"
      ? `Record integrity failure${cause.identity === undefined ? "" : ` for sealed Run ${cause.identity.runId}`}.`
      : cause instanceof InspectionOperationError
        ? cause.code === "inspection-selection-missing" ||
            cause.code === "inspection-result-invalid"
          ? cause.reason
          : "The Inspection operation could not be completed."
        : undefined;
  return new CliFeatureError({
    feature: "show",
    operation,
    cause,
    exitCode,
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
    const primaryExperimentIds = parseExperimentIds(parsed.values.experiment);
    if (typeof primaryExperimentIds === "string") return yield* usage(primaryExperimentIds);
    const shortExperimentIds = parseExperimentIds(parsed.values.exp);
    if (typeof shortExperimentIds === "string") return yield* usage(shortExperimentIds);
    const experimentIds = [...primaryExperimentIds, ...shortExperimentIds];
    if (typeof experimentIds === "string") return yield* usage(experimentIds);
    const output = parsed.values.output;
    if (output !== undefined && output !== "text" && output !== "json")
      return yield* usage("--output (-o) must be text or json.");
    if (parsed.values.json === true && output === "text")
      return yield* usage("--json cannot be combined with -o text.");
    const json = parsed.values.json === true || output === "json";
    const assertions = parsed.values.assertions === true;
    const entryResult = typeof parsed.values.entry === "string" ? Schema.decodeUnknownResult(AssertionEntryIdSchema)(parsed.values.entry) : undefined;
    if (entryResult !== undefined && Result.isFailure(entryResult)) return yield* usage("Invalid --entry value.");
    const entryId = entryResult?.success;
    const compact = parsed.values.compact === true;
    const full = parsed.values.full === true;
    const reference = parsed.values.reference === true;
    if (compact && full) return yield* usage("--compact and --full are mutually exclusive.");
    if ((entryId !== undefined || compact || full) && !assertions)
      return yield* usage("--entry, --compact, and --full require --assertions.");
    if (entryId !== undefined && entryId.length === 0) return yield* usage("--entry must not be empty.");
    const source = parsed.values.source === true;
    const execution = parsed.values.execution === true;
    const timing = parsed.values.timing === true;
    const showUsage = parsed.values.usage === true;
    const diff = parsed.values.diff === true;
    const all = parsed.values.all === true;
    const detailModes = [assertions, source, execution, timing, showUsage, diff].filter(
      Boolean,
    ).length;
    const expand =
      typeof parsed.values.expand === "string"
        ? parsed.values.expand
        : undefined;
    const actorId = typeof parsed.values.actor === "string" ? parsed.values.actor : undefined;
    const eventType = typeof parsed.values.type === "string" ? parsed.values.type : undefined;
    const continuation = typeof parsed.values.continuation === "string" ? parsed.values.continuation : undefined;
    const listOptions = [actorId === undefined ? undefined : "--actor", eventType === undefined ? undefined : "--type", continuation === undefined ? undefined : "--continuation"]
      .filter((value) => value !== undefined);
    if (listOptions.length > 0 && !execution)
      return yield* usage(`${listOptions.join(", ")} require --execution.`);
    if (listOptions.length > 0 && expand !== undefined)
      return yield* usage(`--expand cannot be combined with ${listOptions.join(", ")}.`);
    if (json && all) return yield* usage("--all cannot be combined with --json or -o json.");
    if (detailModes > 1)
      return yield* usage(
        "--assertions, --source, --execution, --timing, --usage, and --diff are mutually exclusive.",
      );
    const matrix = assertions && experimentIds.length > 0;
    const evalIdPrefix = typeof parsed.values.eval === "string" ? parsed.values.eval : undefined;
    if (evalIdPrefix !== undefined && !matrix) return yield* usage("--eval requires --experiment with --assertions.");
    if (matrix && (entryId !== undefined || compact || full)) return yield* usage("--entry, --compact, and --full require an Attempt locator.");
    if (detailModes > 0 && locator === undefined && !matrix)
      return yield* usage(
        "--assertions, --source, --execution, --timing, --usage, and --diff require one Attempt locator.",
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
    if (
      all &&
      (locator !== undefined || runIds.length > 0 || experimentIds.length > 0)
    )
      return yield* usage(
        "--all applies only to Results, not --experiment, --run, or an Attempt locator.",
      );
    const compare = parsed.values.compare === true;
    const compareOptions = ["left", "right", "mode", "max-regressions"] as const;
    if (!compare && compareOptions.some((key) => parsed.values[key] !== undefined))
      return yield* usage("--left, --right, --mode, and --max-regressions require --compare.");
    const leftRunIds = parseRunIds(parsed.values.left, "left");
    const rightRunIds = parseRunIds(parsed.values.right, "right");
    if (typeof leftRunIds === "string") return yield* usage(leftRunIds);
    if (typeof rightRunIds === "string") return yield* usage(rightRunIds);
    const mode = parsed.values.mode ?? "paired";
    if (mode !== "paired" && mode !== "side-by-side" && mode !== "exact")
      return yield* usage("--mode must be paired, side-by-side, or exact.");
    const threshold = parsed.values["max-regressions"];
    const maxRegressions = threshold === undefined ? undefined : Number(threshold);
    if (threshold !== undefined && (typeof threshold !== "string" || !/^[0-9]+$/u.test(threshold) || !Number.isSafeInteger(maxRegressions)))
      return yield* usage("--max-regressions must be a non-negative safe integer.");
    if (compare && (leftRunIds.length === 0 || rightRunIds.length === 0))
      return yield* usage("--compare requires at least one --left and --right Run ID.");
    if (compare && (locator !== undefined || runIds.length > 0 || experimentIds.length > 0 || all || reference || detailModes > 0))
      return yield* usage("--compare cannot be combined with other show selectors.");
    if (compare && mode === "side-by-side" && maxRegressions !== undefined)
      return yield* usage("--max-regressions requires paired or exact mode.");
    if (reference && (locator !== undefined || runIds.length > 0 || experimentIds.length > 0 || typeof parsed.values.record === "string"))
      return yield* usage("--reference requires the current project without other selectors.");
    const facts = yield* Effect.flatMap(
      CliInvocationFacts,
      ({ facts }) => facts,
    ).pipe(Effect.mapError((cause) => failure("read invocation facts", cause)));
    const inspectionSource = typeof parsed.values.record === "string"
      ? externalInspectionSource(facts.cwd, parsed.values.record)
      : operationalInspectionSource(facts.cwd);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const current = !compare && decodedLocator === undefined && runIds.length === 0 && experimentIds.length === 0 && typeof parsed.values.record !== "string";
        const prepare = current ? Effect.gen(function* () {
          const project = yield* ProjectConfiguration;
          const config = yield* project.load(facts.cwd).pipe(Effect.mapError((cause) => new CurrentTargetUnavailable({ code: "current-target-unavailable", reason: String(cause), cause })));
          return yield* openCurrentProjectSource({ cwd: facts.cwd, config });
        }) : openInspectionSource(inspectionSource);
        const opened = yield* prepare.pipe(
          Effect.mapError((cause) => failure("open Record source", cause)),
        );
        const select = <A>(
          operation: InspectionOperationId,
          evaluate: () => A,
        ): Effect.Effect<A, Error, CliOutput> =>
          Effect.try({
            try: evaluate,
            catch: (cause) => failure(`execute ${operation}`, cause,
              json && !(cause instanceof InspectionOperationError && cause.code === "inspection-selection-missing") ? QUERY_FAILURE_EXIT_CODE : 1),
          }).pipe(Effect.tapError((error) =>
            !json || error.cause instanceof InspectionOperationError && error.cause.code === "inspection-selection-missing"
              ? Effect.void
              : writeJson(queryFailureDocument(error, operation)),
          ));
        const project = <A>(
          operation: string,
          evaluate: () => A,
        ): Effect.Effect<A, Error> =>
          Effect.try({
            try: evaluate,
            catch: (cause) => failure(`project ${operation} result`, cause),
          });
        const writeJson = (document: InspectionDocument) => {
          const encoded = canonicalInspectionJson(document);
          return Result.isFailure(encoded)
            ? Effect.fail(failure("encode result", encoded.failure))
            : write("stdout", encoded.success);
        };
        if (matrix) {
          const document = yield* select("experiments.assertions", () => selectInspectionOperation(opened, { kind: "experiments.assertions", experimentIds, ...(evalIdPrefix === undefined ? {} : { evalIdPrefix }) }));
          if (json) yield* writeJson(document);
          else yield* write("stdout", renderAssertionMatrix(document.matrix));
          return 0;
        }
        if (json && !compare) {
          const selectedLocator = decodedLocator?.locator;
          const entries = assertions && entryId === undefined
            ? (yield* select("attempt.get", () => selectInspectionOperation(opened, { kind: "attempt.get", locator: selectedLocator! }))).attempt.assertions.entries.map((entry) => entry.entryId)
            : entryId === undefined ? [] : [entryId];
          const operations = showOperations({
            current, runIds, experimentIds, locator: selectedLocator,
            slice: assertions ? "assertions" : source ? "source" : execution ? "execution" : timing ? "timing" : showUsage ? "usage" : diff ? "diff" : undefined,
            entryIds: entries, projection: full ? "full" : "compact", actorId, eventType, continuation,
          });
          for (const operation of operations) {
            const document = yield* select(execution && expand !== undefined ? "attempt.trace.detail" : operation.kind, () => execution && expand !== undefined
              ? selectTraceDetailByStableId(opened, selectedLocator!, expand)
              : selectInspectionOperation(opened, operation));
            yield* writeJson(document);
          }
          return 0;
        }
        if (assertions) {
          const selectedLocator = decodedLocator!.locator;
          const attempt = (yield* select("attempt.get", () => selectInspectionOperation(opened, { kind: "attempt.get", locator: selectedLocator }))).attempt;
          const entryIds = entryId === undefined ? attempt.assertions.entries.map((entry) => entry.entryId) : [entryId];
          const details: InspectionSuccessDocumentFor<"attempt.assertion.detail">["assertion"][] = [];
          for (const id of entryIds) {
            const document = yield* select("attempt.assertion.detail", () => selectInspectionOperation(opened, {
              kind: "attempt.assertion.detail", locator: selectedLocator, entryId: Schema.decodeUnknownSync(AssertionEntryIdSchema)(id), projection: full ? "full" : "compact",
            }));
            details.push(document.assertion);
          }
          const agentJudgeTraces = new Map<string, AgentJudgeTrace>();
          if (full) for (const detail of details) {
            const audit = "entry" in detail ? detail.entry.agentJudgeAudit : undefined;
            if (audit?.state !== "available" || agentJudgeTraces.has(audit.audit.trace.id)) continue;
            const reference = audit.audit.trace;
            const bytes = new Uint8Array(reference.byteLength);
            let offset = 0;
            while (true) {
              const document = yield* select("attempt.trace.detail", () => selectInspectionOperation(opened, {
                kind: "attempt.trace.detail", locator: selectedLocator,
                selector: { kind: "execution-evidence", evidenceId: reference.id, offset, limit: 256 * 1024 },
              }));
              const page = document.detail;
              if (page.kind !== "execution-evidence" || page.offset !== offset || page.targetByteLength !== reference.byteLength || page.targetSha256 !== reference.sha256) throw new Error("Invalid Assertion Content page");
              const chunk = decodeBase64Bytes(page.base64);
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
              if (page.nextOffset === null) break;
              if (page.nextOffset !== offset || chunk.byteLength === 0) throw new Error("Invalid Assertion Content continuation");
            }
            if (offset !== bytes.byteLength || new InspectionSha256().update(bytes).digestHex() !== reference.sha256) throw new Error("Invalid Assertion Content digest");
            agentJudgeTraces.set(reference.id, decodeAgentJudgeTrace(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))));
          }
          yield* write("stdout", renderAssertions(selectedLocator, details, { full, agentJudgeTraces, entryId, verdict: attempt.verdict ?? "unavailable", score: attempt.score }));
          return 0;
        }
        if (compare) {
          const document = yield* select("runs.compare", () => selectInspectionOperation(opened, {
            kind: "runs.compare", mode, leftRunIds, rightRunIds,
          }));
          if (json) yield* writeJson(document);
          if (json && maxRegressions === undefined) return 0;
          if (document.issues.length > 0)
            return yield* usage(`Comparison incomplete: ${document.issues.map((issue) => issue.code).join(", ")}.`);
          const attempts = new Map<string, ReturnType<typeof projectAttempt>>();
          for (const member of [...document.comparison.left.members, ...document.comparison.right.members]) {
            if (attempts.has(member.locator)) continue;
            const attempt = yield* select("attempt.get", () => selectInspectionOperation(opened, { kind: "attempt.get", locator: member.locator }));
            const usageDocument = yield* select("attempt.usage", () => selectInspectionOperation(opened, { kind: "attempt.usage", locator: member.locator }));
            attempts.set(member.locator, yield* project("attempt.get", () => projectAttempt(attempt, usageDocument)));
          }
          if (!json) yield* write("stdout", renderComparison(document.comparison, attempts));
          const regressed = comparisonRegressions(document.comparison, attempts);
          if (comparisonGateExitCode(regressed, maxRegressions) === 1) {
            yield* write("stderr", `Regression gate failed: ${regressed} regressed; maximum ${maxRegressions}.\n`);
            return 1;
          }
          return 0;
        }
        if (
          decodedLocator === undefined &&
          runIds.length === 0 &&
          experimentIds.length === 0
        ) {
          if (current) {
            const document = yield* select("project.get", () => selectInspectionOperation(opened, { kind: "project.get" }));
            const references = new Map<string, InspectionSuccessDocumentFor<"attempt.get">["attempt"]>();
            for (const slot of document.project.plannedAttempts) {
              if (slot.state !== "gap" || slot.previous === null || references.has(slot.previous.locator)) continue;
              const previous = slot.previous;
              const attempt = yield* select("attempt.get", () => selectInspectionOperation(opened, { kind: "attempt.get", locator: previous.locator }));
              references.set(previous.locator, attempt.attempt);
            }
            if (reference) {
              yield* write("stdout", renderReferences(document.project, references));
              return 0;
            }
            // The presentation model only extracts already-closed aggregate fields.
            const view = yield* project("project.get", () => projectOverview({ ...document, operation: "overview.get", overview: document.project }));
            yield* write("stdout", renderOverview(view, { all, current: document.project, references }));
            return 0;
          }
          const document = yield* select("overview.get", () =>
            selectInspectionOperation(opened, { kind: "overview.get" }),
          );
          yield* write(
            "stdout",
            renderOverview(
              yield* project("overview.get", () => projectOverview(document)),
              { all, recorded: true },
            ),
          );
          return 0;
        }
        if (runIds.length > 0) {
          const rendered: string[] = [];
          for (const runId of runIds) {
            const document = yield* select("run.get", () =>
              selectInspectionOperation(opened, {
                kind: "run.get",
                runId,
              }),
            );
            rendered.push(
              renderRun(
                yield* project("run.get", () => projectRun(document)),
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
              }),
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
          if (expand !== undefined) {
            const detail = yield* select("attempt.trace.detail", () =>
              selectTraceDetailByStableId(opened, selectedLocator, expand),
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
          const outline = yield* select("attempt.trace", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.trace",
              locator: selectedLocator,
              ...(actorId === undefined ? {} : { actorId }),
              ...(eventType === undefined ? {} : { eventType }),
              ...(continuation === undefined ? {} : { continuation }),
            }),
          );
          const trace = yield* project("attempt.trace", () =>
            projectTrace(outline, selectedLocator),
          );
          yield* write("stdout", renderTrace(trace));
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
        const attemptUsage = yield* select("attempt.usage", () =>
          selectInspectionOperation(opened, { kind: "attempt.usage", locator: selectedLocator }),
        );
        const attemptTrace = document.attempt.core.outcome === "errored"
          ? yield* select("attempt.trace", () =>
            selectInspectionOperation(opened, { kind: "attempt.trace", locator: selectedLocator }),
          )
          : undefined;
        yield* write(
          "stdout",
          renderAttempt(
            yield* project("attempt.get", () => projectAttempt(document, attemptUsage, attemptTrace)),
          ),
        );
        return 0;
      }),
    );
  });
}

function selectTraceDetailByStableId(
  source: InspectionFactSource,
  locator: string,
  stableId: string,
): InspectionSuccessDocumentFor<"attempt.trace.detail"> {
  type DetailSelector = InspectionOperationFor<"attempt.trace.detail">["selector"];
  const selectors = Object.freeze([
    { kind: "execution-event", eventId: stableId },
    { kind: "execution-evidence", evidenceId: stableId },
    { kind: "item", itemId: stableId },
    { kind: "tool-occurrence", toolOccurrenceId: stableId },
    { kind: "command", commandId: stableId },
  ]) as unknown as readonly DetailSelector[];
  for (const selector of selectors) {
    try {
      return selectInspectionOperation(source, {
        kind: "attempt.trace.detail",
        locator,
        selector,
      });
    } catch (cause) {
      if (cause instanceof InspectionOperationError && cause.code === "inspection-selection-missing") continue;
      throw cause;
    }
  }
  throw new InspectionOperationError({
    code: "inspection-selection-missing",
    operation: "attempt.trace.detail",
    reason: `Stable execution identity ${JSON.stringify(stableId)} was not found.`,
  });
}

function parseRunIds(
  value: string | boolean | string[] | undefined,
  flag = "run",
): readonly Schema.Schema.Type<typeof RunIdSchema>[] | string {
  const values =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const output: Schema.Schema.Type<typeof RunIdSchema>[] = [];
  for (const candidate of values) {
    const decoded = Schema.decodeUnknownResult(RunIdSchema)(candidate);
    if (Result.isFailure(decoded))
      return `Invalid --${flag} value ${JSON.stringify(candidate)}.`;
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

export function comparisonGateExitCode(regressed: number, maximum: number | undefined): 0 | 1 {
  return maximum !== undefined && regressed > maximum ? 1 : 0;
}

/** Fixed document order for the resource-oriented JSON Lines view. */
export function showOperations(input: {
  readonly current: boolean;
  readonly runIds: readonly InspectionOperationFor<"run.get">["runId"][];
  readonly experimentIds: readonly InspectionOperationFor<"experiment.get">["experimentId"][];
  readonly locator?: string;
  readonly evalIdPrefix?: string;
  readonly slice?: "assertions" | "source" | "execution" | "timing" | "usage" | "diff";
  readonly entryIds?: readonly string[];
  readonly projection?: "compact" | "full";
  readonly actorId?: string;
  readonly eventType?: string;
  readonly continuation?: string;
}): readonly InspectionOperation[] {
  if (input.runIds.length > 0) return input.runIds.map((runId) => ({ kind: "run.get", runId }));
  if (input.experimentIds.length > 0 && input.slice === "assertions") return [{ kind: "experiments.assertions", experimentIds: [...new Set(input.experimentIds)].sort(), ...(input.evalIdPrefix === undefined ? {} : { evalIdPrefix: input.evalIdPrefix }) }];
  if (input.experimentIds.length > 0) return input.experimentIds.map((experimentId) => ({ kind: "experiment.get", experimentId }));
  const locator = input.locator;
  if (locator === undefined) return [{ kind: input.current ? "project.get" : "overview.get" }];
  switch (input.slice) {
    case "assertions": return (input.entryIds ?? []).map((entryId) => ({ kind: "attempt.assertion.detail", locator, entryId: Schema.decodeUnknownSync(AssertionEntryIdSchema)(entryId), projection: input.projection ?? "compact" }));
    case "source": return [{ kind: "attempt.sources", locator }];
    case "execution": return [{ kind: "attempt.trace", locator,
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(input.eventType === undefined ? {} : { eventType: input.eventType }),
      ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
    }];
    case "timing": return [{ kind: "attempt.timing", locator }];
    case "usage": return [{ kind: "attempt.usage", locator }];
    case "diff": return [{ kind: "attempt.diff", locator }];
    default: return [{ kind: "attempt.get", locator }, { kind: "attempt.usage", locator }];
  }
}
