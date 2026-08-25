import { Args, Command, Options } from "@effect/cli";

import {
  defineDocsCommandContribution,
  deliverDomainResult,
  jsonDocument,
  type TerminalDeliverySink,
} from "./contribution.js";
import { renderDocsDomainFailure } from "./errors.js";
import { MINT_VERSION, runDocsSite } from "./generators.js";
import type { CommandReceipt } from "./model.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit this Mintlify command receipt as JSON."),
);

function renderSiteReceipt(receipt: CommandReceipt, json: boolean): string {
  return json ? jsonDocument(receipt) : `${receipt.summary}\n`;
}

function makeSiteCommand(deliver: TerminalDeliverySink) {
  const present = { success: renderSiteReceipt, failure: renderDocsDomainFailure };

  const prepare = Command.make("prepare", { json: jsonOption }, ({ json }) => deliverDomainResult(
    runDocsSite("prepare"),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription(`Prepare the repository-owned Mintlify ${MINT_VERSION} runtime.`));

  const dev = Command.make("dev", {
    args: Args.text({ name: "mint-arg" }).pipe(Args.repeated),
    json: jsonOption,
  }, ({ args, json }) => deliverDomainResult(
    runDocsSite("dev", args),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription("Run the scoped Mintlify development process."));

  const validate = Command.make("validate", { json: jsonOption }, ({ json }) => deliverDomainResult(
    runDocsSite("validate"),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription("Validate the public documentation site with the pinned Mintlify runtime."));

  const links = Command.make("links", { json: jsonOption }, ({ json }) => deliverDomainResult(
    runDocsSite("links"),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription("Check public documentation links, anchors, and redirects."));

  return Command.make("site").pipe(
    Command.withDescription("Develop and validate the public Mintlify documentation site."),
    Command.withSubcommands([prepare, dev, validate, links]),
  );
}

export const siteCommandContribution = defineDocsCommandContribution({
  name: "site",
  summary: "Develop and validate the public Mintlify documentation site.",
  makeCommand: makeSiteCommand,
});
