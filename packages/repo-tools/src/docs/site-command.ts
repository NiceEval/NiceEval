import { Args, Command } from "@effect/cli";

import {
  defineDocsCommandContribution,
  deliverDomainResult,
  type TerminalDeliverySink,
} from "./contribution.js";
import { renderDocsDomainFailure } from "./errors.js";
import { MINT_VERSION, runDocsSite } from "./generators.js";
import type { CommandReceipt } from "./model.js";

function renderSiteReceipt(receipt: CommandReceipt): string {
  return `${receipt.summary}\n`;
}

function makeSiteCommand(deliver: TerminalDeliverySink) {
  const present = { success: renderSiteReceipt, failure: renderDocsDomainFailure };

  const prepare = Command.make("prepare", {}, () => deliverDomainResult(
    runDocsSite("prepare"),
    false,
    present,
    deliver,
  )).pipe(Command.withDescription(`Prepare the repository-owned Mintlify ${MINT_VERSION} runtime.`));

  const dev = Command.make("dev", {
    args: Args.text({ name: "mint-arg" }).pipe(Args.repeated),
  }, ({ args }) => deliverDomainResult(
    runDocsSite("dev", args),
    false,
    present,
    deliver,
  )).pipe(Command.withDescription("Run the scoped Mintlify development process."));

  const validate = Command.make("validate", {}, () => deliverDomainResult(
    runDocsSite("validate"),
    false,
    present,
    deliver,
  )).pipe(Command.withDescription("Validate the public documentation site with the pinned Mintlify runtime."));

  const links = Command.make("links", {}, () => deliverDomainResult(
    runDocsSite("links"),
    false,
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
