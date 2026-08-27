import { Command, Flag as Options } from "effect/unstable/cli";

import {
  defineDocsCommandContribution,
  deliverDomainResult,
  jsonDocument,
  type TerminalDeliverySink,
} from "./contribution.js";
import { renderDocsDomainFailure } from "./errors.js";
import { generateDiffCode } from "./generators.js";
import type { CommandReceipt } from "./model.js";

const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDefault(false),
  Options.withDescription("Return changed paths without replacing generated diff-code assets."),
);
const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit this diff-code generation receipt as JSON."),
);

function renderDiffCodeReceipt(receipt: CommandReceipt, json: boolean): string {
  return json ? jsonDocument(receipt) : `${receipt.summary}\n`;
}

function makeDiffCodeCommand(deliver: TerminalDeliverySink) {
  return Command.make("diff-code", {
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, json }) => deliverDomainResult(
    generateDiffCode(dryRun),
    json,
    { success: renderDiffCodeReceipt, failure: renderDocsDomainFailure },
    deliver,
  )).pipe(Command.withDescription(
    "Generate code-diff assets in a scoped staging directory, then replace atomically.",
  ));
}

export const diffCodeCommandContribution = defineDocsCommandContribution({
  name: "diff-code",
  summary: "Generate code-diff assets in a scoped staging directory, then replace atomically.",
  makeCommand: makeDiffCodeCommand,
});
