import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Data, Effect, Layer, Option } from "effect";

import { checkConsumer, linkConsumerCandidate } from "./consumer/index.js";
import { generateBundledIndex, makeDocsCommand } from "./docs/index.js";
import { checkExamples, syncExamples } from "./examples/index.js";
import { NodeFeedbackStoreLive, runFeedbackCommand } from "./feedback/index.js";
import { NodeMemoryStoreLive, runMemoryCommand } from "./memory/index.js";
import {
  compileTrace,
  isTraceError,
  listFeatures,
  listTests,
  renderTraceError,
  renderTraceReceipt,
  showFeature,
  showTest,
  type TraceError,
  type TraceReceipt,
  type TraceSnapshot,
} from "./docs/trace/index.js";
import {
  DEFAULT_PR_BODY_BUDGET,
  makeNodePrLive,
  prBodyCommandContribution,
} from "./pr/index.js";
import { checkRepository, setupRepositoryEnvironment } from "./repository/index.js";

const ROOT = process.cwd();

class CliInputError extends Data.TaggedError("CliInputError")<{
  readonly path: string;
  readonly message: string;
}> {}

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit the complete structured outcome as JSON."),
);
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription("Validate and return the planned outcome without writing."),
);
const inputOption = Options.text("input").pipe(
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

function resultOk(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  const record = value as Record<string, unknown>;
  if (typeof record.ok === "boolean") return record.ok;
  return record.receipt === undefined ? true : resultOk(record.receipt);
}

function emit(value: unknown, json: boolean, rendered?: string) {
  return Effect.sync(() => {
    const record = typeof value === "object" && value !== null
      ? value as Record<string, unknown>
      : undefined;
    const human = typeof record?.summary === "string"
      ? `${record.summary}\n`
      : `${JSON.stringify(value, null, 2)}\n`;
    process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : rendered ?? human);
    if (!resultOk(value)) process.exitCode = 1;
  });
}

function renderError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    if (isTraceError(error)) return renderTraceError(error);
    const tagged = error as { readonly _tag?: unknown; readonly message?: unknown };
    if (typeof tagged._tag === "string" && tagged._tag.startsWith("Pr")) {
      return prBodyCommandContribution.renderError(error as never);
    }
    if (typeof tagged.message === "string" && tagged.message.length > 0) {
      return `${tagged._tag ?? "RepositoryToolError"}: ${tagged.message}`;
    }
    try {
      return JSON.stringify(error, null, 2);
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
  envelope: Options.text("envelope").pipe(Options.withDescription("Feedback envelope JSON path.")),
  artifacts: Options.text("artifacts").pipe(Options.withDescription("Envelope artifact directory.")),
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
  id: Args.text({ name: "feedback-id" }),
  json: jsonOption,
}, ({ id, json }) => runFeedbackCommand({ operation: "export", id }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Export one Feedback document."));

const feedbackList = Command.make("list", {
  pattern: Args.text({ name: "pattern" }).pipe(Args.optional),
  json: jsonOption,
}, ({ json, pattern }) => runFeedbackCommand({
  operation: "list",
  pattern: Option.getOrUndefined(pattern),
}).pipe(Effect.flatMap((outcome) => emit(outcome, json)))).pipe(
  Command.withDescription("List Feedback, optionally filtered by text."),
);

const feedbackShow = Command.make("show", {
  id: Args.text({ name: "feedback-id" }),
  json: jsonOption,
}, ({ id, json }) => runFeedbackCommand({ operation: "show", id }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Show one Feedback document."));

const feedbackLink = Command.make("link", {
  id: Args.text({ name: "feedback-id" }),
  memory: Options.text("memory"),
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

const feedbackClose = Command.make("close", {
  id: Args.text({ name: "feedback-id" }),
  closure: Options.text("closure").pipe(Options.withDescription("Closure JSON path.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ closure, dryRun, id, json }) => readJson(closure).pipe(
  Effect.flatMap((value) => runFeedbackCommand({ operation: "close", id, closure: value, dryRun })),
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Close Feedback with validated evidence."));

const feedbackReopen = Command.make("reopen", {
  id: Args.text({ name: "feedback-id" }),
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
    feedbackClose,
    feedbackReopen,
    feedbackCheck,
  ]),
);

const memoryAdd = Command.make("add", {
  input: inputOption,
  body: Options.text("body").pipe(Options.withDescription("Markdown body path.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ body, dryRun, input, json }) => Effect.all({ metadata: readJson(input), body: readText(body) }).pipe(
  Effect.flatMap(({ body: source, metadata }) => runMemoryCommand({
    operation: "add",
    metadata,
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
  id: Args.text({ name: "memory-id" }),
  json: jsonOption,
}, ({ id, json }) => runMemoryCommand({ operation: "show", id }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Show one Memory."));
const memorySearch = Command.make("search", {
  pattern: Args.text({ name: "pattern" }),
  json: jsonOption,
}, ({ json, pattern }) => runMemoryCommand({ operation: "search", pattern }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Search Memory metadata and body text."));

const memoryResolve = Command.make("resolve", {
  id: Args.text({ name: "memory-id" }),
  resolution: Options.text("resolution").pipe(Options.withDescription("Problem resolution JSON path.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json, resolution }) => readJson(resolution).pipe(
  Effect.flatMap((value) => runMemoryCommand({ operation: "resolve", id, resolution: value, dryRun })),
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Resolve one structured Problem Memory."));

const memoryReopen = Command.make("reopen", {
  id: Args.text({ name: "memory-id" }),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, id, json }) => runMemoryCommand({ operation: "reopen", id, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Reopen one resolved Problem Memory."));

const memorySupersede = Command.make("supersede", {
  id: Args.text({ name: "memory-id" }),
  by: Options.text("by").pipe(Options.withDescription("Replacement Memory ID.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ by, dryRun, id, json }) => runMemoryCommand({ operation: "supersede", id, by, dryRun }).pipe(
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Supersede one Decision or Insight Memory."));

const memoryPromote = Command.make("promote", {
  id: Args.text({ name: "memory-id" }),
  promotion: Options.text("promotion").pipe(Options.withDescription("Promotion JSON path.")),
  commit: Options.text("commit").pipe(Options.withDescription("Commit preserving the previous target.")),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ commit, dryRun, id, json, promotion }) => readJson(promotion).pipe(
  Effect.flatMap((value) => runMemoryCommand({ operation: "promote", id, promotion: value, commit, dryRun })),
  Effect.flatMap((outcome) => emit(outcome, json)),
)).pipe(Command.withDescription("Promote Memory into a current Roadmap, Feature, or Engineering target."));

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
    memoryCheck,
  ]),
);

function runTraceQuery(
  query: (snapshot: TraceSnapshot) => Effect.Effect<TraceReceipt, TraceError>,
  json: boolean,
) {
  return compileTrace(ROOT).pipe(
    Effect.flatMap(query),
    Effect.flatMap((receipt) => emit(receipt, json, `${renderTraceReceipt(receipt)}\n`)),
  );
}

const featureList = Command.make("list", {
  pattern: Args.text({ name: "pattern" }).pipe(Args.optional),
  json: jsonOption,
}, ({ json, pattern }) => runTraceQuery(
  (snapshot) => {
    const selected = Option.getOrUndefined(pattern);
    return Effect.succeed(listFeatures(snapshot, selected === undefined ? {} : { pattern: selected }));
  },
  json,
)).pipe(Command.withDescription("List Feature IDs that can be passed to feature show."));

const featureShow = Command.make("show", {
  feature: Args.text({ name: "feature-id-or-path" }),
  json: jsonOption,
}, ({ feature: selector, json }) => runTraceQuery(
  (snapshot) => showFeature(snapshot, selector),
  json,
)).pipe(Command.withDescription("Show one Feature, its Use Cases, tests, docs, and Memory."));

const feature = Command.make("feature").pipe(
  Command.withDescription("Discover Feature contracts and their related repository evidence."),
  Command.withSubcommands([featureList, featureShow]),
);

const testList = Command.make("list", {
  pattern: Args.text({ name: "pattern" }).pipe(Args.optional),
  json: jsonOption,
}, ({ json, pattern }) => runTraceQuery(
  (snapshot) => {
    const selected = Option.getOrUndefined(pattern);
    return Effect.succeed(listTests(snapshot, selected === undefined ? {} : { pattern: selected }));
  },
  json,
)).pipe(Command.withDescription("List E2E test/spec paths that can be passed to test show."));

const testShow = Command.make("show", {
  test: Args.text({ name: "test-path" }),
  json: jsonOption,
}, ({ json, test: selector }) => runTraceQuery(
  (snapshot) => showTest(snapshot, selector),
  json,
)).pipe(Command.withDescription("Show the Features, Use Case, owner, and regressions for one E2E test."));

const test = Command.make("test").pipe(
  Command.withDescription("Discover E2E tests and the product contracts they protect."),
  Command.withSubcommands([testList, testShow]),
);

const prNumberOption = Options.integer("pr").pipe(Options.withDescription("GitHub pull request number."));
const sourceOption = Options.text("source").pipe(Options.withDescription("Authored Markdown draft path."));
const baseOption = Options.text("base").pipe(Options.withDescription("Locked base ref or target branch."));
const budgetOption = Options.integer("budget").pipe(
  Options.withDescription("Review byte budget below GitHub's hard limit."),
  Options.withDefault(DEFAULT_PR_BODY_BUDGET),
);

function runPr(input: unknown, json: boolean) {
  return prBodyCommandContribution.run(input).pipe(
    Effect.flatMap((outcome) => emit(
      outcome,
      json,
      prBodyCommandContribution.renderOutcome(outcome),
    )),
  );
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
}, json)).pipe(Command.withDescription("Create or initialize an authored PR body draft."));

const prRender = Command.make("render", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  out: Options.text("out").pipe(Options.optional),
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
  budget: budgetOption,
  remote: Options.boolean("remote").pipe(
    Options.withDescription("Compare body and head with GitHub; local validation is the default."),
  ),
  json: jsonOption,
}, ({ budget, json, pr, remote, source }) => runPr({
  command: "check",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  budget,
  remote,
}, json)).pipe(Command.withDescription("Validate a PR body locally, with optional remote comparison."));

const prApply = Command.make("apply", {
  pr: prNumberOption,
  source: sourceOption.pipe(Options.optional),
  budget: budgetOption,
  json: jsonOption,
}, ({ budget, json, pr, source }) => runPr({
  command: "apply",
  pr,
  source: Option.getOrUndefined(source),
  budget,
}, json)).pipe(Command.withDescription("Verify pushed HEAD and update an existing PR body."));

const prCreate = Command.make("create", {
  source: sourceOption,
  title: Options.text("title"),
  base: baseOption.pipe(Options.optional),
  budget: budgetOption,
  json: jsonOption,
}, ({ base, budget, json, source, title }) => runPr({
  command: "create",
  source,
  title,
  base: Option.getOrUndefined(base),
  budget,
}, json)).pipe(Command.withDescription("Create, apply, and verify a PR from pushed HEAD."));

const prBody = Command.make("body").pipe(
  Command.withDescription("Compile, validate, and publish NiceEval pull request bodies."),
  Command.withSubcommands([prInit, prRender, prCheck, prApply, prCreate]),
);
const pr = Command.make("pr").pipe(
  Command.withDescription("Maintain pull requests."),
  Command.withSubcommands([prBody]),
);

const docs = makeDocsCommand(({ json, receipt }) => emit(receipt, json));

const examplesCheck = Command.make("check", {
  name: Args.text({ name: "tier-name" }).pipe(Args.optional),
  json: jsonOption,
}, ({ json, name }) => checkExamples(Option.getOrUndefined(name)).pipe(
  Effect.flatMap((receipt) => emit(receipt, json)),
)).pipe(Command.withDescription("Check example tier state without writing Git objects or files."));
const examplesApply = Command.make("apply", {
  name: Args.text({ name: "tier-name" }).pipe(Args.optional),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, json, name }) => {
  const selected = Option.getOrUndefined(name);
  return syncExamples({
    ...(selected === undefined ? {} : { name: selected }),
    dryRun,
  }).pipe(Effect.flatMap((receipt) => emit(receipt, json)));
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

const consumerCheck = Command.make("check", {
  consumer: Args.text({ name: "consumer-directory" }),
  json: jsonOption,
}, ({ consumer, json }) => checkConsumer(consumer).pipe(
  Effect.flatMap((receipt) => emit(receipt, json)),
)).pipe(Command.withDescription("Inspect a real downstream consumer without writing it."));
const consumerApply = Command.make("apply", {
  consumer: Args.text({ name: "consumer-directory" }),
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ consumer, dryRun, json }) => linkConsumerCandidate(consumer, dryRun).pipe(
  Effect.flatMap((receipt) => emit(receipt, json)),
)).pipe(Command.withDescription("Build and link the current candidate into one named downstream."));
const consumerLink = Command.make("link").pipe(
  Command.withDescription("Check or link a candidate into a real downstream."),
  Command.withSubcommands([consumerCheck, consumerApply]),
);
const bundledIndex = Command.make("bundled-index", {
  dryRun: dryRunOption,
  json: jsonOption,
}, ({ dryRun, json }) => generateBundledIndex(dryRun).pipe(
  Effect.flatMap((receipt) => emit(receipt, json)),
)).pipe(Command.withDescription("Generate the package-owned bundled documentation index."));
const consumer = Command.make("consumer").pipe(
  Command.withDescription("Maintain real consumer and package surfaces."),
  Command.withSubcommands([consumerLink, bundledIndex]),
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

const root = Command.make("niceeval-repo").pipe(
  Command.withDescription("NiceEval repository maintenance commands."),
  Command.withSubcommands([feature, test, feedback, memory, pr, docs, examples, consumer, repository]),
);

const run = Command.run(root, { name: "NiceEval repository tools", version: "1" });
const live = Layer.mergeAll(
  NodeContext.layer,
  NodeFeedbackStoreLive(ROOT),
  NodeMemoryStoreLive(ROOT),
  makeNodePrLive(ROOT).pipe(Layer.provide(NodeContext.layer)),
);

run(process.argv).pipe(
  Effect.catchAll((error) => Effect.sync(() => {
    process.stderr.write(`${renderError(error)}\n`);
    process.exitCode = 1;
  })),
  Effect.provide(live),
  NodeRuntime.runMain,
);
