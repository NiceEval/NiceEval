import { Args, Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, Option } from "effect";

import {
  addDocumentationTerm,
  checkTerms,
  listTerms,
  removeDocumentationTerm,
  type TermScope,
} from "./docs-terms.js";
import { renderRepoToolError } from "./errors.js";
import { DEFAULT_PR_BODY_BUDGET, runPrBody } from "./pr-body.js";
import { checkCapabilities, listCapabilities } from "./repository-capabilities.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit machine-readable JSON."),
);
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription("Print the complete resulting JSON without writing it."),
);
const scopeOption = Options.choice("scope", ["docs", "all", "site"] as const).pipe(
  Options.withDescription("Choose docs only, docs plus the Chinese site, or the Chinese site only."),
);
const optionalScope = scopeOption.pipe(Options.optional);

const capabilityList = Command.make("list", {
  pattern: Args.text({ name: "pattern" }).pipe(Args.optional),
  json: jsonOption,
}, ({ json, pattern }) => listCapabilities(Option.getOrUndefined(pattern), json)).pipe(
  Command.withDescription("List root package commands with their design owner and Skill."),
);

const capabilityCheck = Command.make("check", { json: jsonOption }, ({ json }) =>
  checkCapabilities(json)).pipe(
  Command.withDescription("Verify package commands, designs, Skills, implementations, and guards."),
);

const capabilities = Command.make("capabilities").pipe(
  Command.withDescription("Discover and validate repository capabilities."),
  Command.withSubcommands([capabilityList, capabilityCheck]),
);

const termList = Command.make("list", {
  pattern: Args.text({ name: "pattern" }).pipe(Args.optional),
  scope: optionalScope,
  json: jsonOption,
}, ({ json, pattern, scope }) => listTerms(
  Option.getOrUndefined(pattern),
  Option.getOrUndefined(scope),
  json,
)).pipe(
  Command.withDescription("List canonical banned-wording decisions."),
);

const termAdd = Command.make("add", {
  term: Args.text({ name: "term" }),
  use: Options.text("use").pipe(
    Options.withDescription("Concrete replacement wording or action."),
  ),
  why: Options.text("why").pipe(
    Options.withDescription("Reason the original wording is ambiguous or harmful."),
  ),
  scope: scopeOption.pipe(Options.withDefault("docs" as TermScope)),
  allowIn: Options.text("allow-in").pipe(
    Options.withDescription("Longer legitimate wording containing the banned term; repeatable."),
    Options.repeated,
  ),
  exempt: Options.text("exempt").pipe(
    Options.withDescription("Path prefix that must quote the retired wording; repeatable."),
    Options.repeated,
  ),
  dryRun: dryRunOption,
}, ({ allowIn, dryRun, exempt, scope, term, use, why }) => addDocumentationTerm({
  term,
  use,
  why,
  scope,
  allowIn,
  exempt,
}, dryRun)).pipe(
  Command.withDescription("Add one justified banned-wording decision."),
);

const termRemove = Command.make("remove", {
  term: Args.text({ name: "term" }),
  dryRun: dryRunOption,
}, ({ dryRun, term }) => removeDocumentationTerm(term, dryRun)).pipe(
  Command.withDescription("Remove one uniquely registered wording decision and its site marker."),
);

const termCheck = Command.make("check", { json: jsonOption }, ({ json }) => checkTerms(json)).pipe(
  Command.withDescription("Run rule-shape validation and the documentation terminology scans."),
);

const terms = Command.make("terms").pipe(
  Command.withDescription("Maintain docs/writing-rules.json through one decoded boundary."),
  Command.withSubcommands([termList, termAdd, termRemove, termCheck]),
);

const docs = Command.make("docs").pipe(
  Command.withDescription("Maintain repository design and public documentation."),
  Command.withSubcommands([terms]),
);

const prNumberOption = Options.integer("pr").pipe(
  Options.withDescription("GitHub pull request number."),
);
const sourceOption = Options.text("source").pipe(
  Options.withDescription("Authored Markdown draft; otherwise use the Git-private draft for --pr."),
);
const baseOption = Options.text("base").pipe(
  Options.withDescription("Locked base ref for init, or target branch for create."),
);
const budgetOption = Options.integer("budget").pipe(
  Options.withDescription("Review byte budget, capped by GitHub's hard limit."),
  Options.withDefault(DEFAULT_PR_BODY_BUDGET),
);

const prBodyInit = Command.make("init", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  base: baseOption.pipe(Options.optional),
}, ({ base, pr, source }) => runPrBody({
  command: "init",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  base: Option.getOrUndefined(base),
  out: undefined,
  title: undefined,
  budget: DEFAULT_PR_BODY_BUDGET,
  remote: false,
})).pipe(
  Command.withDescription("Create a draft, or initialize an existing handwritten --source draft."),
);

const prBodyRender = Command.make("render", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  out: Options.text("out").pipe(
    Options.withDescription("Rendered Markdown path; omit to print to stdout."),
    Options.optional,
  ),
}, ({ out, pr, source }) => runPrBody({
  command: "render",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  out: Option.getOrUndefined(out),
  base: undefined,
  title: undefined,
  budget: DEFAULT_PR_BODY_BUDGET,
  remote: false,
})).pipe(
  Command.withDescription("Expand source directives and render the final Markdown body."),
);

const prBodyCheck = Command.make("check", {
  pr: prNumberOption.pipe(Options.optional),
  source: sourceOption.pipe(Options.optional),
  budget: budgetOption,
  noRemote: Options.boolean("no-remote").pipe(
    Options.withDescription("Skip GitHub body and head comparison."),
  ),
}, ({ budget, noRemote, pr, source }) => runPrBody({
  command: "check",
  pr: Option.getOrUndefined(pr),
  source: Option.getOrUndefined(source),
  out: undefined,
  base: undefined,
  title: undefined,
  budget,
  remote: !noRemote,
})).pipe(
  Command.withDescription("Render and validate a draft; --pr compares the body and head with GitHub."),
);

const prBodyApply = Command.make("apply", {
  pr: prNumberOption,
  source: sourceOption.pipe(Options.optional),
  budget: budgetOption,
}, ({ budget, pr, source }) => runPrBody({
  command: "apply",
  pr,
  source: Option.getOrUndefined(source),
  out: undefined,
  base: undefined,
  title: undefined,
  budget,
  remote: false,
})).pipe(
  Command.withDescription("Validate a pushed draft, verify its head, and update the GitHub PR body."),
);

const prBodyCreate = Command.make("create", {
  source: sourceOption,
  title: Options.text("title").pipe(
    Options.withDescription("Pull request title."),
  ),
  base: baseOption.pipe(Options.optional),
  budget: budgetOption,
}, ({ base, budget, source, title }) => runPrBody({
  command: "create",
  pr: undefined,
  source,
  out: undefined,
  base: Option.getOrUndefined(base),
  title,
  budget,
  remote: false,
})).pipe(
  Command.withDescription("Create a PR from pushed HEAD, apply its rendered body, and verify GitHub."),
);

const prBody = Command.make("body").pipe(
  Command.withDescription("Compile, validate, and publish NiceEval pull request bodies."),
  Command.withSubcommands([prBodyInit, prBodyRender, prBodyCheck, prBodyApply, prBodyCreate]),
);

const pr = Command.make("pr").pipe(
  Command.withDescription("Maintain pull requests."),
  Command.withSubcommands([prBody]),
);

const root = Command.make("niceeval-repo").pipe(
  Command.withDescription("NiceEval repository maintenance commands."),
  Command.withSubcommands([capabilities, docs, pr]),
);

const run = Command.run(root, {
  name: "NiceEval repository tools",
  version: "1",
});

run(process.argv).pipe(
  Effect.catchTag("RepoToolError", (error) => Effect.sync(() => {
    process.stderr.write(renderRepoToolError(error));
    process.exitCode = 1;
  })),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
