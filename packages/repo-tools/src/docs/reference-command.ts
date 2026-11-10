import { Command, Flag as Options } from "effect/cli";

import {
  defineDocsCommandContribution,
  deliverDomainResult,
  jsonDocument,
  type TerminalDeliverySink,
} from "./internal/command.js";
import { renderDocsDomainFailure } from "./internal/errors.js";
import { generateReference } from "./generators.js";
import type { CommandReceipt } from "./model.js";

const dryRunOption = Options.Boolean("dry-run").pipe(
  Options.withDefault(false),
  Options.withDescription("Return changed paths without writing generated reference regions."),
);
const jsonOption = Options.Boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit this reference-generation receipt as JSON."),
);

function renderReferenceReceipt(receipt: CommandReceipt, json: boolean): string {
  return json ? jsonDocument(receipt) : `${receipt.summary}\n`;
}

function makeReferenceCommand(deliver: TerminalDeliverySink) {
  return Command.make("reference", {
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, json }) => deliverDomainResult(
    generateReference(dryRun),
    json,
    { success: renderReferenceReceipt, failure: renderDocsDomainFailure },
    deliver,
  )).pipe(Command.withDescription(
    "Generate public reference regions with per-output atomic replacement.",
  ));
}

export const referenceCommandContribution = defineDocsCommandContribution({
  name: "reference",
  summary: "Generate public reference regions with per-output atomic replacement.",
  makeCommand: makeReferenceCommand,
});
