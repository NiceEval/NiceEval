import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import { Clock, Data, Effect, FileSystem, Layer, Option } from "effect";

import { linkDownstreamCandidate } from "./downstream/index.js";
import {
  designCommandContribution,
  diffCodeCommandContribution,
  featureCommandContribution,
  generateBundledIndex,
  makeDocsCommand,
  referenceCommandContribution,
  researchCommandContribution,
  siteCommandContribution,
  termsCommandContribution,
  testCommandContribution,
  traceCommandContribution,
  type TerminalDelivery,
  workCommandContribution,
} from "./docs/index.js";
import { checkExamples, syncExamples } from "./examples/index.js";
import { NodeFeedbackStoreLive, runFeedbackCommand } from "./feedback/index.js";
import { NodeMemoryStoreLive, runMemoryCommand } from "./memory/index.js";
import {
  makeNodePrLive,
  prBodyCommandContribution,
} from "./pr/index.js";
import {
  acceptPreview,
  buildPreview,
  canonicalJson,
  type PreviewError,
  renderPreviewError,
} from "./preview/index.js";
import { checkRepository, setupRepositoryEnvironment } from "./repository/index.js";

const ROOT = process.cwd();

class CliInputError extends Data.TaggedError("CliInputError")<{
  readonly path: string;
  readonly message: string;
}> {}

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit the complete structured outcome as JSON."),
);
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDefault(false),
  Options.withDescription("Validate and return the planned outcome without writing."),
);
const inputOption = Options.string("input").pipe(
  Options.withDescription("Path to a JSON input document."),
);

function readText(path: string) {
  return Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)).pipe(
    Effect.mapError((error) => new CliInputError({ path, message: String(error) })),
  );
}

function readJson(path: string) {
  return readText(path).pipe(Effect.flatMap((source) => Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: (error) => new CliInputError({
      path,
      message: error instanceof Error ? error.message : String(error),
    }),
  })));
}

function deliverTerminal(delivery: TerminalDelivery) {
  return Effect.sync(() => {
    if (delivery.stdout !== "") process.stdout.write(delivery.stdout);
    if (delivery.stderr !== "") process.stderr.write(delivery.stderr);
    if (delivery.exitCode !== 0) process.exitCode = delivery.exitCode;
  });
}

function resultOk(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  const record = value as Record<string, unknown>;
  if (typeof record.ok === "boolean") return record.ok;
  return record.receipt === undefined ? true : resultOk(record.receipt);
}

function emit(
  value: unknown,
  json: boolean,
  rendered?: string,
  exitCode = resultOk(value) ? 0 : 1,
) {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
  const human = typeof record?.summary === "string"
    ? `${record.summary}\n`
    : `${JSON.stringify(value, null, 2)}\n`;
  const output = json ? `${JSON.stringify(value, null, 2)}\n` : rendered ?? human;
  return deliverTerminal({ stdout: output, stderr: "", exitCode });
}

function renderUnhandledError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const tagged = error as {
      readonly _tag?: unknown;
      readonly detail?: unknown;
      readonly message?: unknown;
      readonly receipt?: { readonly problems?: unknown };
    };
    const name = typeof tagged._tag === "string"
      ? tagged._tag
      : error instanceof Error
        ? error.name
        : "RepositoryToolError";
    const message = typeof tagged.detail === "string" && tagged.detail.length > 0
      ? tagged.detail
      : typeof tagged.message === "string" && tagged.message.length > 0
        ? tagged.message
        : undefined;
    if (message !== undefined) return `${name}: ${message}`;
    if (Array.isArray(tagged.receipt?.problems) && tagged.receipt.problems.length > 0) {
      return `${name}: ${tagged.receipt.problems.map(String).join("; ")}`;
    }
    try {
      return `${name}: ${JSON.stringify(error, null, 2)}`;
    } catch {
      return String(error);
    }
  }
  return String(error);
}

const feedbackAdd = Command.make("add", {
  input: inputOption,
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, input, json }) => readJson(input).pipe(
  Effect.flatMap((document) => runFeedbackCommand({ operation: "add", document, dryRun })),
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Add one decoded Feedback document."));

const feedbackImport = Command.make("import", {
  envelope: Options.string("envelope").pipe(Options.withDescription("Feedback envelope JSON path.")),
  artifacts: Options.string("artifacts").pipe(Options.withDescription("Envelope artifact directory.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ artifacts, dryRun, envelope, json }) => readJson(envelope).pipe(
  Effect.flatMap((value) => runFeedbackCommand({
    operation: "import",
    envelope: value,
    artifacts,
    dryRun,
  })),
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Import one verified downstream Feedback envelope."));

const feedbackExport = Command.make("export", {
  id: Args.string("feedback-id"),
  json: jsonOption,
}, ({ id, json }) => runFeedbackCommand({ operation: "export", id }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Export one Feedback document."));

const feedbackList = Command.make("list", {
  pattern: Args.string("pattern").pipe(Args.optional),
  json: jsonOption,
}, ({ json, pattern }) => runFeedbackCommand({
  operation: "list",
  pattern: Option.getOrUndefined(pattern),
}).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
  Command.withDescription("List Feedback, optionally filtered by text."),
);

const feedbackShow = Command.make("show", {
  id: Args.string("feedback-id"),
  json: jsonOption,
}, ({ id, json }) => runFeedbackCommand({ operation: "show", id }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Show one Feedback document."));

const feedbackLink = Command.make("link", {
  id: Args.string("feedback-id"),
  memory: Options.string("memory"),
  kind: Options.choice("kind", ["investigation", "root-cause", "decision", "delivery"] as const),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json, kind, memory }) => runFeedbackCommand({
  operation: "link",
  id,
  relation: { kind, memory },
  dryRun,
}).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
  Command.withDescription("Relate Feedback to an existing Memory."),
);

const feedbackAdopt = Command.make("adopt", {
  id: Args.string("feedback-id"),
  to: Options.string("to").pipe(Options.withDescription("Exact repository ref adopted by this Feedback.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json, to }) => runFeedbackCommand({
  operation: "adopt",
  id,
  to,
  dryRun,
}).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
  Command.withDescription("Adopt Feedback into one Roadmap, Feature, Use Case, or Engineering target."),
);

const feedbackRetire = Command.make("retire", {
  id: Args.string("feedback-id"),
  from: Options.string("from").pipe(Options.withDescription("Exact current repository ref to retire.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, from, id, json }) => runFeedbackCommand({
  operation: "retire",
  id,
  from,
  dryRun,
}).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
  Command.withDescription("Retire one current Feedback adoption while preserving its history."),
);

const feedbackClose = Command.make("close", {
  id: Args.string("feedback-id"),
  kind: Options.choice("kind", ["fixed", "delivered", "duplicate", "declined", "invalid", "external-fixed"] as const),
  memory: Options.string("memory").pipe(Options.withDescription("Related Memory ID."), Options.optional),
  target: Options.string("target").pipe(Options.withDescription("Delivered repository ref."), Options.optional),
  proof: Options.string("proof").pipe(
    Options.atLeast(0),
    Options.withDescription("Closure evidence; repeat for each proof item."),
  ),
  canonical: Options.string("canonical").pipe(Options.withDescription("Canonical Feedback ID."), Options.optional),
  evidence: Options.string("evidence").pipe(
    Options.atLeast(0),
    Options.withDescription("Invalid-observation evidence; repeat for each item."),
  ),
  dependency: Options.string("dependency").pipe(Options.withDescription("Fixed external dependency."), Options.optional),
  version: Options.string("version").pipe(Options.withDescription("External fixed version."), Options.optional),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ canonical, dependency, dryRun, evidence, id, json, kind, memory, proof, target, version }) => {
  const memoryValue = Option.getOrUndefined(memory);
  const targetValue = Option.getOrUndefined(target);
  const canonicalValue = Option.getOrUndefined(canonical);
  const dependencyValue = Option.getOrUndefined(dependency);
  const versionValue = Option.getOrUndefined(version);
  const closure = {
    kind,
    ...(memoryValue === undefined ? {} : { memory: memoryValue }),
    ...(targetValue === undefined ? {} : { target: targetValue }),
    ...(proof.length === 0 ? {} : { proof }),
    ...(canonicalValue === undefined ? {} : { canonical: canonicalValue }),
    ...(evidence.length === 0 ? {} : { evidence }),
    ...(dependencyValue === undefined ? {} : { dependency: dependencyValue }),
    ...(versionValue === undefined ? {} : { version: versionValue }),
  };
  return runFeedbackCommand({ operation: "close", id, closure, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
  );
}).pipe(Command.withDescription("Close Feedback with validated evidence."));

const feedbackReopen = Command.make("reopen", {
  id: Args.string("feedback-id"),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json }) => runFeedbackCommand({ operation: "reopen", id, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Reopen closed Feedback."));

const feedbackCheck = Command.make("check", { json: jsonOption }, ({ json }) =>
  runFeedbackCommand({ operation: "check" }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Validate Feedback, relations, closures, and migration provenance."));

const feedback = Command.make("feedback").pipe(
  Command.withDescription("Record, relate, close, and validate repository feedback."),
  Command.withSubcommands([
    feedbackAdd,
    feedbackImport,
    feedbackExport,
    feedbackList,
    feedbackShow,
    feedbackLink,
    feedbackAdopt,
    feedbackRetire,
    feedbackClose,
    feedbackReopen,
    feedbackCheck,
  ]),
);

const memoryAdd = Command.make("add", {
  id: Args.string("memory-id"),
  title: Options.string("title"),
  kind: Options.choice("kind", ["problem", "decision", "insight"] as const),
  createdAt: Options.string("created-at").pipe(
    Options.withDescription("Creation date (YYYY-MM-DD); defaults to today."),
    Options.optional,
  ),
  body: Options.string("body").pipe(Options.withDescription("Markdown body path.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ body, createdAt, dryRun, id, json, kind, title }) => Effect.all({
  body: readText(body),
  createdAt: Option.match(createdAt, {
    onNone: () => Clock.currentTimeMillis.pipe(Effect.map((millis) => new Date(millis).toISOString().slice(0, 10))),
    onSome: Effect.succeed,
  }),
}).pipe(
  Effect.flatMap(({ body: source, createdAt }) => runMemoryCommand({
    operation: "add",
    metadata: {
      format: "niceeval.memory/v1",
      id,
      title,
      createdAt,
      kind: kind === "problem"
        ? { type: kind, state: "open" }
        : kind === "decision"
          ? { type: kind, state: "adopted" }
          : { type: kind, state: "current" },
      promotions: [],
    },
    body: source,
    dryRun,
  })),
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Add one structured Memory."));

const memoryList = Command.make("list", { json: jsonOption }, ({ json }) =>
  runMemoryCommand({ operation: "list" }).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
  Command.withDescription("List structured and legacy Memory."),
);
const memoryShow = Command.make("show", {
  id: Args.string("memory-id"),
  json: jsonOption,
}, ({ id, json }) => runMemoryCommand({ operation: "show", id }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Show one Memory."));
const memorySearch = Command.make("search", {
  pattern: Args.string("pattern"),
  json: jsonOption,
}, ({ json, pattern }) => runMemoryCommand({ operation: "search", pattern }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Search Memory metadata and body text."));

const memoryResolve = Command.make("resolve", {
  id: Args.string("memory-id"),
  kind: Options.choice("kind", ["fixed", "not-a-bug", "wont-fix", "external-fixed"] as const),
  proof: Options.string("proof").pipe(
    Options.atLeast(1),
    Options.withDescription("Resolution evidence; repeat for each proof item."),
  ),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json, kind, proof }) => runMemoryCommand({
  operation: "resolve",
  id,
  resolution: { kind, proof },
  dryRun,
}).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Resolve one structured Problem Memory."));

const memoryReopen = Command.make("reopen", {
  id: Args.string("memory-id"),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json }) => runMemoryCommand({ operation: "reopen", id, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Reopen one resolved Problem Memory."));

const memorySupersede = Command.make("supersede", {
  id: Args.string("memory-id"),
  by: Options.string("by").pipe(Options.withDescription("Replacement Memory ID.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ by, dryRun, id, json }) => runMemoryCommand({ operation: "supersede", id, by, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Supersede one Decision or Insight Memory."));

const memoryPromote = Command.make("promote", {
  id: Args.string("memory-id"),
  to: Options.string("to").pipe(Options.withDescription("Exact repository ref promoted by this Memory.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json, to }) => runMemoryCommand({ operation: "promote", id, to, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Promote Memory into one Roadmap, Feature, Use Case, or Engineering target."));

const memoryRetire = Command.make("retire", {
  id: Args.string("memory-id"),
  from: Options.string("from").pipe(Options.withDescription("Exact current repository ref to retire.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, from, id, json }) => runMemoryCommand({ operation: "retire", id, from, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Retire one current Memory promotion while preserving its history."));

const memoryCheck = Command.make("check", { json: jsonOption }, ({ json }) =>
  runMemoryCommand({ operation: "check" }).pipe(
    Effect.flatMap((outcome) => emit(outcome, json)),
  )).pipe(Command.withDescription("Validate Memory state, promotions, and E2E regression references."));

const memory = Command.make("memory").pipe(
  Command.withDescription("Record, search, resolve, supersede, promote, and validate repository Memory."),
  Command.withSubcommands([
    memoryAdd,
    memoryList,
    memoryShow,
    memorySearch,
    memoryResolve,
    memoryReopen,
    memorySupersede,
    memoryPromote,
    memoryRetire,
    memoryCheck,
  ]),
);

const prNumberOption = Options.integer("pr").pipe(Options.withDescription("GitHub pull request number."));
const sourceOption = Options.string("source").pipe(Options.withDescription(
  "Managed draft path; when omitted, the command selects its matching Git-private draft.",
));
const baseOption = Options.string("base").pipe(Options.withDescription("Locked base ref or target branch."));
function runPr(input: unknown, json: boolean) {
  return Effect.matchEffect(prBodyCommandContribution.run(input), {
    onFailure: (error) => deliverTerminal({
      stdout: "",
      stderr: json
        ? `${JSON.stringify({ ok: false, error }, null, 2)}\n`
        : `${prBodyCommandContribution.renderError(error)}\n`,
      exitCode: 1,
    }),
    onSuccess: (outcome) => emit(
      outcome,
      json,
      prBodyCommandContribution.renderOutcome(outcome),
    ),
  });
}

const prInit = Command.make("init", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  base: baseOption.pipe(Options.optional),
  json: jsonOption,
}, ({ base, json, pr, source }) => runPr({
  command: "init",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  base: Option.getOrUndefined(base),
}, json)).pipe(Command.withDescription("Create or initialize a managed PR body draft."));

const prEditReset = Command.make("reset", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  json: jsonOption,
}, ({ json, pr, source }) => runPr({
  command: "edit",
  operation: "reset",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
}, json)).pipe(Command.withDescription("Clear authored content and refresh the managed template state."));

const prEditProblem = Command.make("problem", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  userGoal: Options.string("user-goal"),
  currentLimitation: Options.string("current-limitation"),
  requiredCapability: Options.string("required-capability"),
  userOutcome: Options.string("user-outcome"),
  json: jsonOption,
}, ({ currentLimitation, json, pr, requiredCapability, source, userGoal, userOutcome }) => runPr({
  command: "edit",
  operation: "problem",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  userGoal,
  currentLimitation,
  requiredCapability,
  userOutcome,
}, json)).pipe(Command.withDescription("Set the four required Problem fields."));

const prCaseSectionOption = Options.choice("section", [
  "public-api",
  "cli",
  "report-components",
  "observable-behavior",
  "package-scripts",
] as const).pipe(Options.withDescription("PR template section owned by this case."));
const prCaseDirectionOption = Options.choice("direction", ["removed", "added", "changed"] as const);
const prCaseNameOption = Options.string("name").pipe(Options.withDescription("Stable Case heading."));

const prEditCaseSet = Command.make("set", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  section: prCaseSectionOption,
  direction: prCaseDirectionOption,
  name: prCaseNameOption,
  beforeInput: Options.string("before-input"),
  beforeOutput: Options.string("before-output"),
  afterInput: Options.string("after-input").pipe(Options.optional),
  afterOutput: Options.string("after-output"),
  userImpact: Options.string("user-impact"),
  language: Options.string("language").pipe(Options.optional),
  json: jsonOption,
}, ({
  afterInput,
  afterOutput,
  beforeInput,
  beforeOutput,
  direction,
  json,
  language,
  name,
  pr,
  section,
  source,
  userImpact,
}) => runPr({
  command: "edit",
  operation: "case-set",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  section,
  direction,
  name,
  beforeInput,
  beforeOutput,
  afterInput: Option.getOrUndefined(afterInput),
  afterOutput,
  userImpact,
  language: Option.getOrUndefined(language),
}, json)).pipe(Command.withDescription("Add or replace one structured Before/After/User impact case."));

const prEditCaseRemove = Command.make("remove", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  section: prCaseSectionOption,
  direction: prCaseDirectionOption,
  name: prCaseNameOption,
  json: jsonOption,
}, ({ direction, json, name, pr, section, source }) => runPr({
  command: "edit",
  operation: "case-remove",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  section,
  direction,
  name,
}, json)).pipe(Command.withDescription("Remove one exact structured case and any newly empty headings."));

const prEditCase = Command.make("case").pipe(
  Command.withDescription("Maintain structured product-surface cases."),
  Command.withSubcommands([prEditCaseSet, prEditCaseRemove]),
);

const prEditTestSet = Command.make("set", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  path: Options.string("path"),
  purpose: Options.choice("purpose", ["feature", "bug regression", "feature + bug regression"] as const),
  protects: Options.string("protects"),
  runs: Options.string("runs"),
  asserts: Options.string("asserts"),
  fragmentFrom: Options.string("fragment-from").pipe(Options.atLeast(0)),
  fragmentThrough: Options.string("fragment-through").pipe(Options.atLeast(0)),
  fragmentReason: Options.string("fragment-reason").pipe(Options.optional),
  json: jsonOption,
}, ({
  asserts,
  fragmentFrom,
  fragmentReason,
  fragmentThrough,
  json,
  path,
  pr,
  protects,
  purpose,
  runs,
  source,
}) => runPr({
  command: "edit",
  operation: "test-set",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  path,
  purpose,
  protects,
  runs,
  asserts,
  fragmentFrom,
  fragmentThrough,
  fragmentReason: Option.getOrUndefined(fragmentReason),
}, json)).pipe(Command.withDescription("Add or replace a full-source or anchored-fragment niceeval:test directive."));

const prEditTestRemove = Command.make("remove", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  path: Options.string("path"),
  json: jsonOption,
}, ({ json, path, pr, source }) => runPr({
  command: "edit",
  operation: "test-remove",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  path,
}, json)).pipe(Command.withDescription("Remove one exact niceeval:test directive."));

const prEditTest = Command.make("test").pipe(
  Command.withDescription("Maintain test source directives."),
  Command.withSubcommands([prEditTestSet, prEditTestRemove]),
);

const prEdit = Command.make("edit").pipe(
  Command.withDescription("Edit a managed PR draft without writing Markdown directly."),
  Command.withSubcommands([prEditReset, prEditProblem, prEditCase, prEditTest]),
);

const prRender = Command.make("render", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  out: Options.string("out").pipe(Options.optional),
  json: jsonOption,
}, ({ json, out, pr, source }) => runPr({
  command: "render",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  out: Option.getOrUndefined(out),
}, json)).pipe(Command.withDescription("Expand directives and render final Markdown."));

const prCheck = Command.make("check", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  remote: Options.boolean("remote").pipe(
    Options.withDefault(false),
    Options.withDescription("Compare body and head with GitHub; local validation is the default."),
  ),
  json: jsonOption,
}, ({ json, pr, remote, source }) => runPr({
  command: "check",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  remote,
}, json)).pipe(Command.withDescription("Validate a PR body locally, with optional remote comparison."));

const prApply = Command.make("apply", {
  pr: prNumberOption,
  source: sourceOption.pipe(Options.optional),
  json: jsonOption,
}, ({ json, pr, source }) => runPr({
  command: "apply",
  pr,
  source: Option.getOrUndefined(source),
}, json)).pipe(Command.withDescription("Verify pushed HEAD and update an existing PR body."));

const prCreate = Command.make("create", {
  source: sourceOption.pipe(Options.optional),
  title: Options.string("title"),
  base: baseOption.pipe(Options.optional),
  json: jsonOption,
}, ({ base, json, source, title }) => runPr({
  command: "create",
  source: Option.getOrUndefined(source),
  title,
  base: Option.getOrUndefined(base),
}, json)).pipe(Command.withDescription("Create, apply, and verify a PR from pushed HEAD."));

const prBody = Command.make("body").pipe(
  Command.withDescription("Edit, compile, validate, and publish NiceEval pull request bodies."),
  Command.withSubcommands([prInit, prEdit, prRender, prCheck, prApply, prCreate]),
);
const pr = Command.make("pr").pipe(
  Command.withDescription("Maintain pull requests."),
  Command.withSubcommands([prBody]),
);

const docsContributions = Object.freeze([
  featureCommandContribution,
  testCommandContribution,
  traceCommandContribution,
  designCommandContribution,
  researchCommandContribution,
  termsCommandContribution,
  workCommandContribution,
  referenceCommandContribution,
  diffCodeCommandContribution,
  siteCommandContribution,
] as const);
const docs = makeDocsCommand(docsContributions, deliverTerminal);

const examplesCheck = Command.make("check", {
  name: Args.string("tier-name").pipe(Args.optional),
  json: jsonOption,
}, ({ json, name }) => checkExamples(Option.getOrUndefined(name)).pipe(
  Effect.flatMap((receipt) => emit(receipt, json)),
)).pipe(Command.withDescription("Check example tier state without writing Git objects or files."));
const examplesApply = Command.make("apply", {
  name: Args.string("tier-name").pipe(Args.optional),
  json: jsonOption,
}, ({ json, name }) => {
  const selected = Option.getOrUndefined(name);
  return syncExamples(selected).pipe(Effect.flatMap((receipt) => emit(receipt, json)));
}).pipe(
  Command.withDescription("Synchronize all or one named example tier."),
);
const examplesSync = Command.make("sync").pipe(
  Command.withDescription("Check or synchronize example tier chains."),
  Command.withSubcommands([examplesCheck, examplesApply]),
);
const examples = Command.make("examples").pipe(
  Command.withDescription("Maintain runnable examples."),
  Command.withSubcommands([examplesSync]),
);

const link = Command.make("link", {
  project: Args.string("project-directory"),
  json: jsonOption,
}, ({ json, project }) => linkDownstreamCandidate(project).pipe(
  Effect.flatMap((receipt) => emit(receipt, json)),
)).pipe(Command.withDescription("Build and link the current NiceEval candidate into another project."));
const packageDocsIndex = Command.make("docs-index", {
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, json }) => generateBundledIndex(dryRun).pipe(
  Effect.flatMap((receipt) => emit(receipt, json)),
)).pipe(Command.withDescription("Generate the package-owned bundled documentation index."));
const packageSurface = Command.make("package").pipe(
  Command.withDescription("Build package-owned generated surfaces."),
  Command.withSubcommands([packageDocsIndex]),
);

const repositoryCheck = Command.make("check", { json: jsonOption }, ({ json }) =>
  checkRepository().pipe(Effect.flatMap((receipt) => emit(receipt, json)))).pipe(
  Command.withDescription("Check hooks and host prerequisites without writing."),
);
const repositoryApply = Command.make("apply", {
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, json }) => setupRepositoryEnvironment(dryRun).pipe(
  Effect.flatMap((receipt) => emit(receipt, json)),
)).pipe(Command.withDescription("Apply repository-local hooks after prerequisite checks."));
const repositorySetup = Command.make("setup").pipe(
  Command.withDescription("Check or apply repository setup."),
  Command.withSubcommands([repositoryCheck, repositoryApply]),
);
const repository = Command.make("repository").pipe(
  Command.withDescription("Maintain repository-local setup."),
  Command.withSubcommands([repositorySetup]),
);

function emitCanonicalReceipt(receipt: unknown) {
  return deliverTerminal({ stdout: `${canonicalJson(receipt)}\n`, stderr: "", exitCode: 0 });
}

function runPreviewReceipt<A, R>(effect: Effect.Effect<A, PreviewError, R>) {
  return Effect.matchEffect(effect, {
    onFailure: (error) => deliverTerminal({ stdout: "", stderr: `${renderPreviewError(error)}\n`, exitCode: 1 }),
    onSuccess: emitCanonicalReceipt,
  });
}

const previewBuild = Command.make("build", {
  local: Options.boolean("local").pipe(
    Options.withDefault(false),
    Options.withDescription("Run explicitly as a local build without reading or fabricating Netlify identity."),
  ),
}, ({ local }) => runPreviewReceipt(buildPreview({ local }))).pipe(
  Command.withDescription("Build and seal the pinned Preview repository with the exact current NiceEval tarball."),
);

const previewAccept = Command.make("accept", {
  input: inputOption.pipe(Options.withDescription(
    "JSON containing the build receipt, read-only Netlify deploy metadata, GitHub current head, and current-head check.",
  )),
}, ({ input }) => readJson(input).pipe(
  Effect.flatMap((value) => runPreviewReceipt(acceptPreview(value))),
)).pipe(Command.withDescription("Verify an immutable deployed Preview manifest and emit an acceptance receipt."));

const preview = Command.make("preview").pipe(
  Command.withDescription("Build and accept NiceEval pull request and production previews."),
  Command.withSubcommands([previewBuild, previewAccept]),
);

const root = Command.make("niceeval-repo").pipe(
  Command.withDescription("NiceEval repository maintenance commands."),
  Command.withSubcommands([feedback, memory, pr, docs, examples, link, packageSurface, repository, preview]),
);

const live = Layer.mergeAll(
  NodeServices.layer,
  NodeFeedbackStoreLive(ROOT),
  NodeMemoryStoreLive(ROOT),
  makeNodePrLive(ROOT).pipe(Layer.provide(NodeServices.layer)),
);

Command.run(root, { version: "1" }).pipe(
  Effect.catch((error) => deliverTerminal({ stdout: "", stderr: `${renderUnhandledError(error)}\n`, exitCode: 1 })),
  Effect.provide(live),
  NodeRuntime.runMain,
);
