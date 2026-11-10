import { makeDocsCommand } from "./docs/internal/command.js";
import type { TerminalDelivery } from "./docs/internal/command.js";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import { Data, Effect, FileSystem, Layer, Option } from "effect";

import { linkDownstreamCandidate } from "./downstream/index.js";
import {
  diffCodeCommandContribution,
  generateBundledIndex,
  referenceCommandContribution,
  siteCommandContribution,
  workCommandContribution,
} from "./docs/index.js";
import { checkExamples, syncExamples } from "./examples/index.js";
import {
  makeNodePrLive,
  PR_BODY_CASE_DIRECTIONS,
  PR_BODY_CASE_SECTIONS,
  PR_BODY_TERMINOLOGY_DIRECTIONS,
  prBodyCommandContribution,
} from "./pr/index.js";
import {
  acceptPreview,
  buildPreview,
  canonicalJson,
  exportConcordChanges,
  type PreviewError,
  renderPreviewError,
} from "./preview/index.js";
import { checkRepository, setupRepositoryEnvironment } from "./repository/index.js";

const ROOT = process.cwd();

class CliInputError extends Data.TaggedError("CliInputError")<{
  readonly path: string;
  readonly message: string;
}> {}

const jsonOption = Options.Boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit the complete structured outcome as JSON."),
);
const dryRunOption = Options.Boolean("dry-run").pipe(
  Options.withDefault(false),
  Options.withDescription("Validate and return the planned outcome without writing."),
);
const inputOption = Options.String("input").pipe(
  Options.withDescription("Path to a JSON input document."),
);

function readText(path: string) {
  if (path === "-") {
    return Effect.callback<string, CliInputError>((resume) => {
      let source = "";
      const onData = (chunk: string | Buffer) => { source += chunk.toString(); };
      const onEnd = () => resume(Effect.succeed(source));
      const onError = (error: Error) => resume(Effect.fail(new CliInputError({ path, message: String(error) })));
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", onData);
      process.stdin.once("end", onEnd);
      process.stdin.once("error", onError);
      return Effect.sync(() => {
        process.stdin.off("data", onData);
        process.stdin.off("end", onEnd);
        process.stdin.off("error", onError);
      });
    });
  }
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

const prNumberOption = Options.Int("pr").pipe(Options.withDescription("GitHub pull request number."));
const sourceOption = Options.String("source").pipe(Options.withDescription(
  "Managed draft path; when omitted, the command selects its matching Git-private draft.",
));
const baseOption = Options.String("base").pipe(Options.withDescription("Locked base ref or target branch."));
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

const prStatus = Command.make("status", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  json: jsonOption,
}, ({ json, pr, source }) => runPr({
  command: "status",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
}, json)).pipe(Command.withDescription("Inspect the local managed PR body draft without changing it."));

const prDiscard = Command.make("discard", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  json: jsonOption,
}, ({ json, pr, source }) => runPr({
  command: "discard",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
}, json)).pipe(Command.withDescription("Delete one local managed PR body draft without changing a remote PR."));

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
  userGoal: Options.String("user-goal"),
  currentLimitation: Options.String("current-limitation"),
  requiredCapability: Options.String("required-capability"),
  userOutcome: Options.String("user-outcome"),
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

const prClosingIssueOption = Options.Int("issue").pipe(Options.withDescription("GitHub issue number."));
const prEditClosingIssueAdd = Command.make("add", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional), issue: prClosingIssueOption, json: jsonOption,
}, ({ pr, source, issue, json }) => runPr({ command: "edit", operation: "closing-issue-add", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), issue }, json)).pipe(Command.withDescription("Add a GitHub closing keyword for one issue."));
const prEditClosingIssueRemove = Command.make("remove", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional), issue: prClosingIssueOption, json: jsonOption,
}, ({ pr, source, issue, json }) => runPr({ command: "edit", operation: "closing-issue-remove", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), issue }, json)).pipe(Command.withDescription("Remove one GitHub closing issue reference."));
const prEditClosingIssue = Command.make("closing-issue").pipe(Command.withDescription("Maintain issue references that close when the PR merges."), Command.withSubcommands([prEditClosingIssueAdd, prEditClosingIssueRemove]));

const prCaseSectionOption = Options.Literals("section", PR_BODY_CASE_SECTIONS).pipe(Options.withDescription("PR template section owned by this case."));
const prCaseDirectionOption = Options.Literals("direction", PR_BODY_CASE_DIRECTIONS);
const prCaseNameOption = Options.String("name").pipe(Options.withDescription("Stable Case heading."));

const prEditCaseSet = Command.make("set", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  section: prCaseSectionOption,
  direction: prCaseDirectionOption,
  name: prCaseNameOption,
  beforeInput: Options.String("before-input"),
  beforeOutput: Options.String("before-output"),
  afterInput: Options.String("after-input").pipe(Options.optional),
  afterOutput: Options.String("after-output"),
  userImpact: Options.String("user-impact"),
  language: Options.String("language").pipe(Options.optional),
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

const prEditUseCaseSet = Command.make("set", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional),
  direction: prCaseDirectionOption, name: prCaseNameOption,
  contract: Options.String("contract"), startingState: Options.String("starting-state"),
  action: Options.String("action"), result: Options.String("result"),
  explanation: Options.String("explanation"), language: Options.String("language").pipe(Options.optional), json: jsonOption,
}, ({ pr, source, direction, name, contract, startingState, action, result, explanation, language, json }) => runPr({
  command: "edit", operation: "use-case-set", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), direction, name, contract, startingState, action, result, explanation, language: Option.getOrUndefined(language),
}, json)).pipe(Command.withDescription("Add or replace one Added, Changed, or Removed canonical NiceEval Use Case."));

const prEditUseCaseRemove = Command.make("remove", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional), direction: prCaseDirectionOption, name: prCaseNameOption, json: jsonOption,
}, ({ pr, source, direction, name, json }) => runPr({ command: "edit", operation: "use-case-remove", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), direction, name }, json)).pipe(Command.withDescription("Remove one exact Use Case entry from the draft."));

const prEditUseCase = Command.make("use-case").pipe(Command.withDescription("Maintain canonical Added/Changed/Removed NiceEval Use Cases."), Command.withSubcommands([prEditUseCaseSet, prEditUseCaseRemove]));

const prEditRecordNewWriteSet = Command.make("set", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional),
  action: Options.String("action"), result: Options.String("result"), json: jsonOption,
}, ({ pr, source, action, result, json }) => runPr({
  command: "edit", operation: "record-new-write-set", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), action, result,
}, json)).pipe(Command.withDescription("Set the public new-Record writer action and observed result."));
const prEditRecordNewWriteRemove = Command.make("remove", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional), json: jsonOption,
}, ({ pr, source, json }) => runPr({ command: "edit", operation: "record-new-write-remove", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source) }, json)).pipe(Command.withDescription("Remove the new-Record writer case."));
const prEditRecordNewWrite = Command.make("new-write").pipe(
  Command.withDescription("Maintain the public action and result for writing a new Record."),
  Command.withSubcommands([prEditRecordNewWriteSet, prEditRecordNewWriteRemove]),
);

const prEditRecordExistingReadSet = Command.make("set", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional),
  action: Options.String("action"), result: Options.String("result"), json: jsonOption,
}, ({ pr, source, action, result, json }) => runPr({
  command: "edit", operation: "record-existing-read-set", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), action, result,
}, json)).pipe(Command.withDescription("Set the public existing-Record reader action and observed result."));
const prEditRecordExistingReadRemove = Command.make("remove", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional), json: jsonOption,
}, ({ pr, source, json }) => runPr({ command: "edit", operation: "record-existing-read-remove", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source) }, json)).pipe(Command.withDescription("Remove the existing-Record reader case."));
const prEditRecordExistingRead = Command.make("existing-read").pipe(
  Command.withDescription("Maintain the public action and result for reading an existing Record."),
  Command.withSubcommands([prEditRecordExistingReadSet, prEditRecordExistingReadRemove]),
);

const prEditRecordUpgradeSet = Command.make("set", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional),
  version: Options.String("version").pipe(Options.withDescription("Dotted numeric version transition, for example 0.15 -> 0.16.")),
  beforeInput: Options.String("before-input"), beforeOutput: Options.String("before-output"),
  afterInput: Options.String("after-input"), afterOutput: Options.String("after-output"),
  safety: Options.String("safety"), userImpact: Options.String("user-impact"), evidence: Options.String("evidence"),
  json: jsonOption,
}, ({ pr, source, json, ...upgrade }) => runPr({
  command: "edit", operation: "record-upgrade-set", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), ...upgrade,
}, json)).pipe(Command.withDescription("Set the Record version, before/after recovery behavior, safety, impact, and evidence."));
const prEditRecordUpgradeRemove = Command.make("remove", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional), json: jsonOption,
}, ({ pr, source, json }) => runPr({ command: "edit", operation: "record-upgrade-remove", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source) }, json)).pipe(Command.withDescription("Remove the Record upgrade or recovery case."));
const prEditRecordUpgrade = Command.make("upgrade").pipe(
  Command.withDescription("Maintain the public stored-data upgrade or recovery case."),
  Command.withSubcommands([prEditRecordUpgradeSet, prEditRecordUpgradeRemove]),
);

const prEditRecordPrivateSet = Command.make("set", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional),
  name: prCaseNameOption, before: Options.String("before"), after: Options.String("after"),
  userImpact: Options.String("user-impact"), json: jsonOption,
}, ({ pr, source, name, before, after, userImpact, json }) => runPr({
  command: "edit", operation: "record-private-set", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), name, before, after, userImpact,
}, json)).pipe(Command.withDescription("Add or replace one explicitly private persisted-data case."));
const prEditRecordPrivateRemove = Command.make("remove", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional), name: prCaseNameOption, json: jsonOption,
}, ({ pr, source, name, json }) => runPr({ command: "edit", operation: "record-private-remove", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), name }, json)).pipe(Command.withDescription("Remove one exact private persisted-data case."));
const prEditRecordPrivate = Command.make("private-persistence").pipe(
  Command.withDescription("Maintain private persisted data without presenting it as public Record schema."),
  Command.withSubcommands([prEditRecordPrivateSet, prEditRecordPrivateRemove]),
);

const prEditRecord = Command.make("record").pipe(
  Command.withDescription("Maintain Record write, read, upgrade, and separately identified private persistence cases."),
  Command.withSubcommands([prEditRecordNewWrite, prEditRecordExistingRead, prEditRecordUpgrade, prEditRecordPrivate]),
);

const prEditEnvironmentSet = Command.make("set", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional),
  direction: prCaseDirectionOption, name: prCaseNameOption,
  beforeInput: Options.String("before-input"), beforeOutput: Options.String("before-output"),
  afterInput: Options.String("after-input").pipe(Options.optional), afterOutput: Options.String("after-output").pipe(Options.optional),
  boundary: Options.String("boundary"), necessity: Options.String("necessity").pipe(Options.optional),
  securityImpact: Options.String("security-impact"), json: jsonOption,
}, ({ pr, source, direction, name, beforeInput, beforeOutput, afterInput, afterOutput, boundary, necessity, securityImpact, json }) => runPr({
  command: "edit", operation: "environment-set", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source),
  direction, name, beforeInput, beforeOutput, afterInput: Option.getOrUndefined(afterInput), afterOutput: Option.getOrUndefined(afterOutput),
  boundary, necessity: Option.getOrUndefined(necessity), securityImpact,
}, json)).pipe(Command.withDescription("Add or replace one environment-variable change with boundary, necessity, and security impact."));
const prEditEnvironmentRemove = Command.make("remove", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional),
  direction: prCaseDirectionOption, name: prCaseNameOption, json: jsonOption,
}, ({ pr, source, direction, name, json }) => runPr({ command: "edit", operation: "environment-remove", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), direction, name }, json)).pipe(Command.withDescription("Remove one exact environment-variable change."));
const prEditEnvironment = Command.make("environment").pipe(
  Command.withDescription("Maintain Added, Changed, and Removed environment variables."),
  Command.withSubcommands([prEditEnvironmentSet, prEditEnvironmentRemove]),
);

const prTerminologyDirectionOption = Options.Literals("direction", PR_BODY_TERMINOLOGY_DIRECTIONS);
const prEditTerminologySet = Command.make("set", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional),
  direction: prTerminologyDirectionOption, name: prCaseNameOption,
  before: Options.String("before"), after: Options.String("after"), explanation: Options.String("explanation"),
  canonical: Options.String("canonical").pipe(Options.withDescription("Canonical docs/concepts.md#<Unicode-anchor> link.")), json: jsonOption,
}, ({ pr, source, direction, name, before, after, explanation, canonical, json }) => runPr({
  command: "edit", operation: "terminology-set", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), direction, name, before, after, explanation, canonical,
}, json)).pipe(Command.withDescription("Add or replace one preferred-term addition or removal."));
const prEditTerminologyRemove = Command.make("remove", {
  pr: prNumberOption.pipe(Options.optional), source: sourceOption.pipe(Options.optional),
  direction: prTerminologyDirectionOption, name: prCaseNameOption, json: jsonOption,
}, ({ pr, source, direction, name, json }) => runPr({ command: "edit", operation: "terminology-remove", pr: Option.getOrUndefined(pr), source: Option.getOrUndefined(source), direction, name }, json)).pipe(Command.withDescription("Remove one exact preferred-term change."));
const prEditTerminology = Command.make("terminology").pipe(
  Command.withDescription("Maintain Added and Removed preferred terminology with canonical concepts links."),
  Command.withSubcommands([prEditTerminologySet, prEditTerminologyRemove]),
);

const prEditTestSet = Command.make("set", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  selector: Args.String("path#caseId"),
  behavior: Options.String("behavior"),
  entry: Options.String("entry"),
  assertion: Options.String("assertion"),
  escape: Options.String("escape"),
  issue: Options.String("issue").pipe(Options.optional),
  fragmentFrom: Options.String("fragment-from").pipe(Options.withDescription("Unique complete source line, or <BOF> for the file start."), Options.atLeast(0)),
  fragmentThrough: Options.String("fragment-through").pipe(Options.withDescription("Unique complete source line, or <EOF> for the file end."), Options.atLeast(0)),
  fragmentReason: Options.String("fragment-reason").pipe(Options.optional),
  sourceMode: Options.Literals("source-mode", ["full", "link"] as const).pipe(
    Options.optional,
    Options.withDescription("How the PR presents test source; link emits immutable GitHub source and diff links."),
  ),
  json: jsonOption,
}, ({
  assertion,
  behavior,
  entry,
  escape,
  fragmentFrom,
  fragmentReason,
  fragmentThrough,
  json,
  issue,
  selector,
  pr,
  source,
  sourceMode,
}) => runPr({
  command: "edit",
  operation: "test-set",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  selector,
  behavior,
  entry,
  assertion,
  escape,
  issue: Option.getOrUndefined(issue),
  fragmentFrom,
  fragmentThrough,
  fragmentReason: Option.getOrUndefined(fragmentReason),
  sourceMode: Option.getOrUndefined(sourceMode),
}, json)).pipe(Command.withDescription("Add or replace one canonical test case narrative and its file source directive."));

const prEditTestRemove = Command.make("remove", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  selector: Args.String("path#caseId"),
  json: jsonOption,
}, ({ json, selector, pr, source }) => runPr({
  command: "edit",
  operation: "test-remove",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  selector,
}, json)).pipe(Command.withDescription("Remove one exact canonical test case narrative."));

const prEditTest = Command.make("test").pipe(
  Command.withDescription("Maintain test source directives."),
  Command.withSubcommands([prEditTestSet, prEditTestRemove]),
);

const prEditVerification = Command.make("verification", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  candidate: Options.String("candidate"),
  red: Options.String("red").pipe(Options.optional),
  green: Options.String("green"),
  repeatability: Options.String("repeatability"),
  fixedConditions: Options.String("fixed-conditions"),
  unitCount: Options.String("unit-count"),
  json: jsonOption,
}, ({ pr, source, json, red, ...receipt }) => runPr({
  command: "edit",
  operation: "verification",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  red: Option.getOrUndefined(red),
  ...receipt,
}, json)).pipe(Command.withDescription("Set the shared candidate and validation receipt required by the PR template."));

const prEdit = Command.make("edit").pipe(
  Command.withDescription("Edit a managed PR draft without writing Markdown directly."),
  Command.withSubcommands([
    prEditReset,
    prEditProblem,
    prEditClosingIssue,
    prEditUseCase,
    prEditCase,
    prEditRecord,
    prEditEnvironment,
    prEditTerminology,
    prEditTest,
    prEditVerification,
  ]),
);

const prRender = Command.make("render", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  out: Options.String("out").pipe(Options.optional),
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
  remote: Options.Boolean("remote").pipe(
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
  title: Options.String("title"),
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
  Command.withSubcommands([prInit, prStatus, prDiscard, prEdit, prRender, prCheck, prApply, prCreate]),
);
const pr = Command.make("pr").pipe(
  Command.withDescription("Maintain pull requests."),
  Command.withSubcommands([prBody]),
);

const docsContributions = Object.freeze([
  workCommandContribution,
  referenceCommandContribution,
  diffCodeCommandContribution,
  siteCommandContribution,
] as const);
const docs = makeDocsCommand(docsContributions, deliverTerminal);

const examplesCheck = Command.make("check", {
  name: Args.String("tier-name").pipe(Args.optional),
  json: jsonOption,
}, ({ json, name }) => checkExamples(Option.getOrUndefined(name)).pipe(
  Effect.flatMap((receipt) => emit(receipt, json)),
)).pipe(Command.withDescription("Check example tier state without writing Git objects or files."));
const examplesApply = Command.make("apply", {
  name: Args.String("tier-name").pipe(Args.optional),
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
  project: Args.String("project-directory"),
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
  local: Options.Boolean("local").pipe(
    Options.withDefault(false),
    Options.withDescription("Run explicitly as a local build without reading or fabricating Netlify identity."),
  ),
  base: Options.String("base").pipe(Options.optional),
  head: Options.String("head").pipe(Options.withDefault("HEAD")),
  baseLabel: Options.String("base-label").pipe(Options.optional),
}, ({ local, base, head, baseLabel }) => runPreviewReceipt(buildPreview({ local, ...(Option.isSome(base) ? { comparison: { base: base.value, head, ...(Option.isSome(baseLabel) ? { baseLabel: baseLabel.value } : {}) } } : {}) }))).pipe(
  Command.withDescription("Build and seal the pinned Preview repository with the exact current NiceEval tarball."),
);

const previewAccept = Command.make("accept", {
  input: inputOption.pipe(Options.withDescription(
    "JSON input path, or - for stdin; contains the build receipt, read-only Netlify deploy metadata, GitHub current head, and current-head check.",
  )),
}, ({ input }) => readJson(input).pipe(
  Effect.flatMap((value) => runPreviewReceipt(acceptPreview(value))),
)).pipe(Command.withDescription("Verify an immutable deployed Preview manifest and emit an acceptance receipt."));

const previewChanges = Command.make("changes", {
  root: Options.String("root").pipe(Options.withDefault(ROOT)),
  base: Options.String("base"),
  head: Options.String("head").pipe(Options.withDefault("HEAD")),
  baseLabel: Options.String("base-label").pipe(Options.optional),
  out: Options.String("out"),
}, ({ root, base, head, baseLabel, out }) => runPreviewReceipt(exportConcordChanges({ root, base, head, ...(Option.isSome(baseLabel) ? { baseLabel: baseLabel.value } : {}), out }))).pipe(
  Command.withDescription("Export and verify a static Concord comparison using the installed pinned package; no platform query or deployment."),
);

const preview = Command.make("preview").pipe(
  Command.withDescription("Build and accept NiceEval pull request and production previews."),
  Command.withSubcommands([previewBuild, previewAccept, previewChanges]),
);

const root = Command.make("niceeval-repo").pipe(
  Command.withDescription("NiceEval repository maintenance commands."),
  Command.withSubcommands([pr, docs, examples, link, packageSurface, repository, preview]),
);

const live = Layer.mergeAll(
  NodeServices.layer,
  makeNodePrLive(ROOT).pipe(Layer.provide(NodeServices.layer)),
);

Command.run(root, { version: "1" }).pipe(
  Effect.catch((error) => deliverTerminal({ stdout: "", stderr: `${renderUnhandledError(error)}\n`, exitCode: 1 })),
  Effect.provide(live),
  NodeRuntime.runMain,
);
