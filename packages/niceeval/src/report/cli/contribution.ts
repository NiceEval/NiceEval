import { Effect, Either, Schema } from "effect";
import type * as Scope from "effect/Scope";

import { parseAttemptLocator, type AttemptLocator } from "../../attempt-locator.ts";
import type { AnalysisSelectionRequest, ExperimentId, RunId } from "../../analysis/index.ts";
import { ExperimentIdSchema } from "../../record/codec/identifiers.ts";
import { makeRecordRoot, RunIdSchema, type RecordRoot } from "../../record/index.ts";
import type { RecordCoordination } from "../../coordination/record-leases.ts";
import type { RecordFileSystem } from "../../record/platform/services.ts";
import { experimentHost, type ExperimentHostRequirements } from "../../experiment/host/index.ts";
import {
  CliArguments,
  CliInvocationFacts,
  CliOutput,
  CliPath,
  type CliOptionDefinition,
  type CliPathService,
} from "../../cli/application.ts";
import { ProjectConfiguration } from "../../cli/project-configuration.ts";
import { CliFeatureError, type CliCommandContribution } from "../../cli/contribution.ts";
import { defaultAttemptOverviewReport } from "../built-in/attempt-overview.ts";
import { executionEvidenceReport, timingEvidenceReport } from "../built-in/execution.ts";
import { defaultRunMembershipOverviewReport } from "../built-in/run-membership-overview.ts";
import { sourceEvidenceReport } from "../built-in/source.ts";
import { standard } from "../built-in/standard.tsx";
import type { ReportDefinition } from "../definition/report.ts";
import { buildReportSiteFromRecord } from "../host/from-record.ts";
import { reportHost } from "../host/index.ts";
import { panelCapabilityOf } from "../model/panel.ts";
import { basalt, chalk, type ThemeDefinition } from "../theme.ts";
import { ReportFileSystem } from "../host/static.ts";
import {
  ReportBrowser,
  ReportModulePlatform,
  type ReportModulePlatformService,
} from "../host/operations.ts";

const help = (summary: string, visibility: "public" | "hidden" = "public") =>
  Object.freeze({ summary, visibility });
const option = (value: CliOptionDefinition): CliOptionDefinition => Object.freeze(value);

export const REPORT_CLI_OPTIONS = Object.freeze({
  record: option({ type: "string", help: help("Use a specific NiceEval Record root.") }),
  run: option({ type: "string", multiple: true, help: help("Select an exact published Run; repeat to select more than one.") }),
  experiment: option({ type: "string", multiple: true, help: help("Narrow current-project results by Experiment selector.") }),
  report: option({ type: "string", help: help("Use the standard Report or a trusted Report module path.") }),
  theme: option({ type: "string", help: help("Use basalt, chalk, or a trusted Theme module path.") }),
  page: option({ type: "string", help: help("Select the show target or initial view route.") }),
  json: option({ type: "boolean", help: help("Write the show machine document as canonical JSON.") }),
  source: option({ type: "boolean", optionalValue: Object.freeze({ default: true }), help: help("Show an Attempt source snapshot, optionally for one file.") }),
  execution: option({ type: "boolean", help: help("Show retained execution evidence for one Attempt.") }),
  timing: option({ type: "boolean", optionalValue: Object.freeze({ default: "summary", values: Object.freeze(["summary", "full"]) }), help: help("Show summary or full timing evidence for one Attempt.") }),
  grep: option({ type: "string", help: help("Filter execution evidence with a JavaScript regular expression.") }),
  diff: option({ type: "boolean", optionalValue: Object.freeze({ default: true }), help: help("Show the selected Attempt file changes, optionally for one inline path.") }),
  out: option({ type: "string", help: help("Export a complete static Report site.") }),
  host: option({ type: "boolean", optionalValue: Object.freeze({ default: "0.0.0.0", separated: true }), help: help("Listen on an address; bare --host exposes 0.0.0.0.") }),
  port: option({ type: "string", help: help("Listen on this port; defaults to an available port.") }),
  open: option({ type: "boolean", help: help("Open the live Report in a browser.") }),
  "no-open": option({ type: "boolean", help: help("Do not open the live Report in a browser.") }),
  help: option({ type: "boolean", short: "h", help: help("Print help for this Report command.") }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const SHOW_HELP = `niceeval show — render one Report target\n\nUsage:\n  niceeval show [@<locator>] [--run <id>...] [--experiment <selector>...] [--report <module>] [--page <route>] [--json]\n  niceeval show @<locator> (--source[=<file>] | --execution [--grep <regexp>] | --timing[=summary|full] | --diff)\n`;
const VIEW_HELP = `niceeval view — build a complete Report site\n\nUsage:\n  niceeval view [selection] [--report <module>] [--page <route>] [--host <address>] [--port <port>] [--no-open]\n  niceeval view [selection] [--report <module>] --out <directory>\n`;

type Values = Record<string, string | boolean | string[] | undefined>;
type ReportCliRequirements = CliArguments | CliInvocationFacts | CliOutput | CliPath | ReportModulePlatform |
  ProjectConfiguration | ReportBrowser | RecordFileSystem | RecordCoordination | ReportFileSystem |
  ExperimentHostRequirements | Scope.Scope;
type ReportCliError = CliFeatureError;

type ReportSelection =
  | { readonly kind: "fixed"; readonly report: ReportDefinition }
  | { readonly kind: "config" }
  | { readonly kind: "standard" }
  | { readonly kind: "module"; readonly path: string };
type ThemeSelection = { readonly kind: "config" } | { readonly kind: "built-in"; readonly name: "basalt" | "chalk" } |
  { readonly kind: "module"; readonly path: string };
type Target = { readonly kind: "selection"; readonly selection: AnalysisSelectionRequest } |
  { readonly kind: "project-current"; readonly experimentSelectors?: readonly string[] } |
  { readonly kind: "attempt"; readonly locator: AttemptLocator };
interface Request {
  readonly cwd: string;
  readonly root: RecordRoot;
  readonly rootPath: string;
  readonly target: Target;
  readonly reportSelection: ReportSelection;
  readonly themeSelection: ThemeSelection;
  readonly page?: string;
}
interface LoadedInputs {
  readonly report: ReportDefinition;
  readonly theme?: ThemeDefinition;
  readonly selection?: AnalysisSelectionRequest;
  readonly watchInputs: readonly string[];
}

function failure(
  command: "show" | "view",
  operation: string,
  cause: unknown,
  display?: string,
): ReportCliError {
  return new CliFeatureError({
    feature: `report ${command}`,
    operation,
    cause,
    exitCode: 1,
    ...(display === undefined ? {} : { display }),
  });
}

function write(channel: "stdout" | "stderr", text: string) {
  return Effect.flatMap(CliOutput, (output) => channel === "stdout" ? output.writeStdout(text) : output.writeStderr(text));
}

function usage(command: "show" | "view", message: string) {
  return write("stderr", `${message.endsWith("\n") ? message : `${message}\n`}`).pipe(
    Effect.mapError((cause) => failure(command, "write usage", cause)),
    Effect.as(1),
  );
}

function strings(value: string | string[] | boolean | undefined): readonly string[] {
  return typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
}

function parseRunIds(values: readonly string[]): readonly RunId[] | string {
  const result: RunId[] = [];
  for (const value of [...new Set(values)]) {
    const decoded = Schema.decodeUnknownEither(RunIdSchema)(value);
    if (Either.isLeft(decoded)) return `Invalid --run value ${JSON.stringify(value)}: expected one exact portable RunId.`;
    result.push(decoded.right);
  }
  return Object.freeze(result);
}

function parseExperimentSelectors(values: readonly string[]): readonly ExperimentId[] | string {
  const result: ExperimentId[] = [];
  for (const value of [...new Set(values)]) {
    const decoded = Schema.decodeUnknownEither(ExperimentIdSchema)(value);
    if (Either.isLeft(decoded)) return `Invalid --experiment value ${JSON.stringify(value)}.`;
    result.push(decoded.right);
  }
  return Object.freeze(result);
}

function trusted(path: CliPathService, value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || path.isAbsolute(value);
}

function parseRequest(command: "show" | "view", cwd: string, positionals: readonly string[], values: Values,
  path: CliPathService, platform: ReportModulePlatformService): Request | string {
  const rootText = typeof values.record === "string" ? values.record : ".niceeval/record";
  if (rootText.trim() === "") return "--record requires an actual Record root directory.";
  const rootPath = path.resolve(cwd, rootText);
  const made = makeRecordRoot(rootPath);
  if (Either.isLeft(made)) return `Invalid --record root: ${made.left.code}.`;
  const runs = parseRunIds(strings(values.run));
  if (typeof runs === "string") return runs;
  const experiments = parseExperimentSelectors(strings(values.experiment));
  if (typeof experiments === "string") return experiments;
  if (runs.length > 0 && experiments.length > 0) return "--experiment cannot combine with explicit --run.";
  if (positionals.length > 1) return `niceeval ${command} accepts at most one exact Attempt locator.`;

  const reportValue = typeof values.report === "string" ? values.report : undefined;
  let reportSelection: ReportSelection = reportValue === undefined ? { kind: "config" } : reportValue === "standard"
    ? { kind: "standard" }
    : trusted(path, reportValue) ? { kind: "module", path: platform.resolveModulePath(cwd, reportValue) }
    : { kind: "config" };
  if (reportValue !== undefined && reportValue !== "standard" && !trusted(path, reportValue)) {
    return "--report accepts standard or an explicit trusted module path.";
  }
  const themeValue = typeof values.theme === "string" ? values.theme : undefined;
  const themeSelection: ThemeSelection = themeValue === undefined ? { kind: "config" } : themeValue === "basalt" || themeValue === "chalk"
    ? { kind: "built-in", name: themeValue }
    : trusted(path, themeValue) ? { kind: "module", path: platform.resolveModulePath(cwd, themeValue) }
    : { kind: "config" };
  if (themeValue !== undefined && themeValue !== "basalt" && themeValue !== "chalk" && !trusted(path, themeValue)) {
    return "--theme accepts basalt, chalk, or an explicit trusted module path.";
  }

  const evidence = [values.source !== undefined ? "source" : undefined, values.execution === true ? "execution" : undefined,
    values.timing !== undefined ? "timing" : undefined, values.diff !== undefined ? "diff" : undefined].filter(Boolean);
  if (command === "view" && evidence.length > 0) return "niceeval view does not accept evidence slicing options.";
  if (evidence.length > 1) return "niceeval show chooses one evidence Report at a time.";
  if (values.grep !== undefined && values.execution !== true) return "--grep only combines with --execution.";

  let target: Target;
  if (positionals.length === 1) {
    if (runs.length > 0 || experiments.length > 0) return "An Attempt locator cannot combine with --run or --experiment.";
    const parsed = parseAttemptLocator(positionals[0]!);
    if (!parsed.valid) return `Invalid Attempt locator ${JSON.stringify(positionals[0])}.`;
    target = { kind: "attempt", locator: parsed.locator };
    if (values.execution === true) {
      if (reportValue !== undefined) return "--execution selects its built-in Report; remove --report.";
      if (typeof values.grep === "string") {
        try { new RegExp(values.grep); } catch { return `--grep ${JSON.stringify(values.grep)} is not a valid JavaScript regular expression.`; }
      }
      reportSelection = { kind: "fixed", report: executionEvidenceReport(typeof values.grep === "string" ? { grep: values.grep } : {}) };
    } else if (values.timing !== undefined) {
      if (reportValue !== undefined) return "--timing selects its built-in Report; remove --report.";
      reportSelection = { kind: "fixed", report: timingEvidenceReport({ mode: values.timing === "full" ? "full" : "summary" }) };
    } else if (values.source !== undefined) {
      if (reportValue !== undefined) return "--source selects its built-in Report; remove --report.";
      reportSelection = { kind: "fixed", report: sourceEvidenceReport(typeof values.source === "string" ? { file: values.source } : {}) };
    } else if (reportValue === undefined) reportSelection = { kind: "fixed", report: defaultAttemptOverviewReport };
  } else {
    if (evidence.length > 0) return "Evidence slicing requires exactly one Attempt locator.";
    if (runs.length > 0) {
      const [first, ...rest] = runs;
      target = { kind: "selection", selection: { policy: "explicit-runs", runIds: [first!, ...rest] } };
      if (reportValue === undefined) reportSelection = { kind: "fixed", report: defaultRunMembershipOverviewReport };
    } else target = { kind: "project-current", ...(experiments.length === 0 ? {} : { experimentSelectors: experiments }) };
  }
  return Object.freeze({ cwd, root: made.right, rootPath, target, reportSelection, themeSelection,
    ...(typeof values.page === "string" ? { page: values.page } : {}) });
}

function loadInputs(command: "show" | "view", request: Request, includeTheme: boolean): Effect.Effect<LoadedInputs, ReportCliError,
  ProjectConfiguration | ReportModulePlatform | CliPath | ExperimentHostRequirements> {
  return Effect.gen(function* () {
    const project = yield* ProjectConfiguration;
    const platform = yield* ReportModulePlatform;
    const path = yield* CliPath;
    const config = yield* project.rebuild(request.cwd).pipe(Effect.mapError((cause) => failure(command, "load project config", cause)));
    const current = request.target.kind === "project-current" ? yield* experimentHost.resolveProjectCurrentTarget({
      cwd: request.cwd,
      config,
      freshImport: true,
      ...(request.target.experimentSelectors === undefined ? {} : { experimentSelectors: request.target.experimentSelectors }),
    }).pipe(Effect.mapError((cause) => failure(command, "load current project target", cause))) : undefined;
    const configured = yield* platform.loadConfig(request.cwd, { includeTheme }).pipe(Effect.mapError((cause) => failure(command, "load trusted Report config", cause)));
    const reportLoaded = request.reportSelection.kind === "fixed" ? { report: request.reportSelection.report, watchInputs: [] as readonly string[] }
      : request.reportSelection.kind === "standard" ? { report: standard, watchInputs: [] as readonly string[] }
      : request.reportSelection.kind === "module" ? yield* platform.loadReport(request.reportSelection.path).pipe(Effect.mapError((cause) => failure(command, "load trusted Report module", cause)))
      : { report: configured.report ?? standard, watchInputs: [] as readonly string[] };
    const themeLoaded = !includeTheme ? undefined : request.themeSelection.kind === "built-in"
      ? { theme: request.themeSelection.name === "chalk" ? chalk : basalt, watchInputs: [] as readonly string[] }
      : request.themeSelection.kind === "module" ? yield* platform.loadTheme(request.themeSelection.path).pipe(Effect.mapError((cause) => failure(command, "load trusted Theme module", cause)))
      : { theme: configured.theme ?? basalt, watchInputs: [] as readonly string[] };
    const watchInputs = Object.freeze([...new Set([request.rootPath, ...(current?.watchInputs ?? []), ...configured.watchInputs,
      ...reportLoaded.watchInputs, ...(themeLoaded?.watchInputs ?? [])].map((entry) => path.resolve(entry)))].sort());
    const selection = current?.selection;
    return Object.freeze({ report: reportLoaded.report, ...(themeLoaded === undefined ? {} : { theme: themeLoaded.theme }),
      ...(selection === undefined ? {} : { selection }), watchInputs });
  });
}

function build(request: Request, inputs: LoadedInputs) {
  return request.target.kind === "attempt" ? buildReportSiteFromRecord({ root: request.root, locator: request.target.locator,
    report: inputs.report, theme: inputs.theme }) : buildReportSiteFromRecord({ root: request.root,
    selection: request.target.kind === "selection" ? request.target.selection : inputs.selection!, report: inputs.report, theme: inputs.theme });
}

function showCommand(argv: readonly string[]): Effect.Effect<number, ReportCliError, ReportCliRequirements> {
  return Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsed = yield* Effect.try({ try: () => parser.parse(argv, REPORT_CLI_OPTIONS), catch: (cause) => failure("show", "parse arguments", cause) });
    if (parsed.values.help === true) return yield* write("stdout", SHOW_HELP).pipe(Effect.mapError((cause) => failure("show", "write help", cause)), Effect.as(0));
    const factsService = yield* CliInvocationFacts;
    const facts = yield* factsService.facts.pipe(Effect.mapError((cause) => failure("show", "read invocation facts", cause)));
    const path = yield* CliPath; const platform = yield* ReportModulePlatform;
    const request = parseRequest("show", facts.cwd, parsed.positionals, parsed.values, path, platform);
    if (typeof request === "string") return yield* usage("show", request);
    if (parsed.values.out !== undefined || parsed.values.host !== undefined || parsed.values.port !== undefined || parsed.values.open !== undefined || parsed.values["no-open"] !== undefined) return yield* usage("show", "niceeval show does not accept view server/export options.");
    const inputs = yield* loadInputs("show", request, false);
    const projection = parsed.values.json === true ? undefined : panelCapabilityOf({ isTTY: facts.stdout.isTTY, width: facts.stdout.columns });
    const output = yield* reportHost.show({ root: request.root,
      ...(request.target.kind === "attempt" ? { locator: request.target.locator } : { selection: request.target.kind === "selection" ? request.target.selection : inputs.selection! }),
      report: inputs.report, ...(request.page === undefined ? {} : { route: request.page }), format: parsed.values.json === true ? "json" : "text",
      ...(projection === undefined ? {} : { textProjection: { width: projection.width, panelMode: projection.mode } }),
    }).pipe(Effect.mapError((cause) => failure("show", "execute Report", cause)));
    yield* write("stdout", output).pipe(Effect.mapError((cause) => failure("show", "write output", cause)));
    return 0;
  });
}

function viewCommand(argv: readonly string[]): Effect.Effect<number, ReportCliError, ReportCliRequirements> {
  return Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsed = yield* Effect.try({ try: () => parser.parse(argv, REPORT_CLI_OPTIONS), catch: (cause) => failure("view", "parse arguments", cause) });
    if (parsed.values.help === true) return yield* write("stdout", VIEW_HELP).pipe(Effect.mapError((cause) => failure("view", "write help", cause)), Effect.as(0));
    if (parsed.values.json === true) return yield* usage("view", "niceeval view does not accept --json.");
    const factsService = yield* CliInvocationFacts; const facts = yield* factsService.facts.pipe(Effect.mapError((cause) => failure("view", "read invocation facts", cause)));
    const path = yield* CliPath; const platform = yield* ReportModulePlatform;
    const request = parseRequest("view", facts.cwd, parsed.positionals, parsed.values, path, platform);
    if (typeof request === "string") return yield* usage("view", request);
    const out = typeof parsed.values.out === "string" ? parsed.values.out : undefined;
    const host = typeof parsed.values.host === "string" ? parsed.values.host.trim() : "127.0.0.1";
    if (host === "") return yield* usage("view", "--host requires a non-empty address.");
    const portText = typeof parsed.values.port === "string" ? parsed.values.port : "0";
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) return yield* usage("view", `--port must be an integer from 0 through 65535, got ${portText}.`);
    if (out !== undefined && (parsed.values.host !== undefined || parsed.values.port !== undefined || parsed.values.open === true || request.page !== undefined)) {
      return yield* usage("view", "view --out does not accept --host, --port, --open, or --page.");
    }
    const inputs = yield* loadInputs("view", request, true);
    const initial = yield* build(request, inputs).pipe(Effect.mapError((cause) => failure("view", "build Report site", cause)));
    if (out !== undefined) {
      const target = path.resolve(facts.cwd, out);
      const receipt = yield* reportHost.export({ revision: initial, out: target }).pipe(Effect.mapError((cause) => failure("view", "export static Report", cause)));
      yield* write("stdout", `Exported static report site: ${receipt.out}\n`).pipe(Effect.mapError((cause) => failure("view", "write output", cause)));
      return 0;
    }
    const rebuild = () => Effect.gen(function* () {
      const next = yield* loadInputs("view", request, true);
      const revision = yield* build(request, next).pipe(Effect.mapError((cause) => ({ summary: reportFailureSummary(cause) })));
      return Object.freeze({ kind: "site" as const, site: revision, watchInputs: next.watchInputs });
    }).pipe(
      Effect.mapError((cause) => "summary" in cause ? cause : ({ summary: reportFailureSummary(cause) })),
      Effect.tapError((problem) => write("stderr", `view rebuild failed: ${problem.summary}\n`).pipe(Effect.ignore)),
    );
    const server = yield* reportHost.serve({ url: `http://${host.includes(":") ? `[${host}]` : host}:${port}/`, host, port,
      watchInputs: inputs.watchInputs, initial: Effect.succeed(initial), rebuild }).pipe(Effect.mapError((cause) => failure("view", "open Report view", cause)));
    const urls = server.urls.map((entry) => {
      if (request.page === undefined) return entry;
      const target = new URL(entry);
      target.hash = `#${request.page}`;
      return target.toString();
    });
    if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") yield* write("stderr",
      "Warning: niceeval view is listening beyond loopback without authentication or TLS; " +
      "every reachable client can read report data, execution JSON, and downloads.\n",
    ).pipe(Effect.mapError((cause) => failure("view", "write warning", cause)));
    yield* write("stdout", `niceeval view — open in a browser:\n${urls.join("\n")}\n`).pipe(Effect.mapError((cause) => failure("view", "write output", cause)));
    if (parsed.values["no-open"] !== true) {
      const browser = yield* ReportBrowser;
      yield* browser.open(urls[0]!).pipe(Effect.catchAll(() => Effect.succeed(false)));
    }
    return yield* Effect.never;
  });
}

function reportFailureSummary(cause: unknown): string {
  if (cause instanceof CliFeatureError) {
    const nested = cause.cause;
    if (typeof nested === "object" && nested !== null && "code" in nested && typeof nested.code === "string") {
      return nested.code;
    }
    return cause.operation;
  }
  return cause instanceof Error ? cause.message : String(cause);
}

export const reportShowCliCommand: CliCommandContribution<ReportCliRequirements, ReportCliError> = Object.freeze({
  name: "show", summary: "render one closed Report target", options: REPORT_CLI_OPTIONS, run: showCommand,
});
export const reportViewCliCommand: CliCommandContribution<ReportCliRequirements, ReportCliError> = Object.freeze({
  name: "view", summary: "serve or export a complete Report site", options: REPORT_CLI_OPTIONS, run: viewCommand,
});
export const reportCliContributions = Object.freeze([reportShowCliCommand, reportViewCliCommand]);
