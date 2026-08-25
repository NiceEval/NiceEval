import { Args, Command, Options } from "@effect/cli";
import { Option } from "effect";

import {
  defineDocsCommandContribution,
  deliverDomainResult,
  jsonDocument,
  type TerminalDeliverySink,
} from "./contribution.js";
import { renderDocsDomainFailure } from "./errors.js";
import type { TermScope, TermsReceipt } from "./model.js";
import {
  addDocumentationTerm,
  checkDocumentationTerms,
  listDocumentationTerms,
  removeDocumentationTerm,
} from "./terms.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit this terminology receipt as JSON."),
);
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription("Return the exact planned document without writing it."),
);
const scopeOption = Options.choice("scope", ["docs", "all", "site"] as const).pipe(
  Options.withDescription("Select design docs, both documentation surfaces, or the public site."),
);

function renderTermsReceipt(receipt: TermsReceipt, json: boolean): string {
  if (json) return jsonDocument(receipt);
  switch (receipt.command) {
    case "list":
      return receipt.terms.length === 0
        ? "No matching documentation wording decisions.\n"
        : `${receipt.terms.map((term) => `${term.term} [${term.scope}]\n  use: ${term.use}\n  why: ${term.why}`).join("\n")}\n`;
    case "add":
    case "remove":
      return `${receipt.dryRun ? "Would " : ""}${receipt.command} documentation wording ${JSON.stringify(receipt.term)}.\n`;
    case "check":
      return `${receipt.lint.summary}\n`;
  }
}

function makeTermsCommand(deliver: TerminalDeliverySink) {
  const present = { success: renderTermsReceipt, failure: renderDocsDomainFailure };

  const list = Command.make("list", {
    pattern: Args.text({ name: "pattern" }).pipe(Args.optional),
    scope: scopeOption.pipe(Options.optional),
    json: jsonOption,
  }, ({ json, pattern, scope }) => deliverDomainResult(
    listDocumentationTerms(Option.getOrUndefined(pattern), Option.getOrUndefined(scope)),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription("List canonical banned-wording decisions."));

  const add = Command.make("add", {
    term: Args.text({ name: "term" }),
    use: Options.text("use").pipe(Options.withDescription("Concrete replacement wording or action.")),
    why: Options.text("why").pipe(Options.withDescription("Why the original wording is harmful.")),
    scope: scopeOption.pipe(Options.withDefault("docs" as TermScope)),
    allowIn: Options.text("allow-in").pipe(Options.repeated),
    exempt: Options.text("exempt").pipe(Options.repeated),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ allowIn, dryRun, exempt, json, scope, term, use, why }) => deliverDomainResult(
    addDocumentationTerm({ term, use, why, scope, allowIn, exempt }, dryRun),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription("Add one justified banned-wording decision atomically."));

  const remove = Command.make("remove", {
    term: Args.text({ name: "term" }),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, json, term }) => deliverDomainResult(
    removeDocumentationTerm(term, dryRun),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription("Remove one uniquely registered wording decision atomically."));

  const check = Command.make("check", { json: jsonOption }, ({ json }) => deliverDomainResult(
    checkDocumentationTerms(),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription("Run the canonical documentation lint owner."));

  return Command.make("terms").pipe(
    Command.withDescription("Maintain docs/writing-rules.json through one Schema boundary."),
    Command.withSubcommands([list, add, remove, check]),
  );
}

export const termsCommandContribution = defineDocsCommandContribution({
  name: "terms",
  summary: "Maintain docs/writing-rules.json through one Schema boundary.",
  makeCommand: makeTermsCommand,
});
