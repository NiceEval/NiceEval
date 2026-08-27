import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import { Effect, Option } from "effect";

import {
  defineDocsCommandContribution,
  deliverDomainResult,
  jsonDocument,
  type TerminalDeliverySink,
} from "./contribution.js";
import { DocsWorkError, renderDocsDomainFailure } from "./errors.js";
import type {
  DocsFinalizeReceipt,
  DocsWorkReceipt,
  DocsWorkRun,
  DocsWorkShowReceipt,
} from "./model.js";
import {
  checkDocsWork,
  finalizeDocsWork,
  prepareDocsWork,
  showDocsWork,
} from "./work.js";

type WorkReceipt = DocsWorkRun | DocsWorkShowReceipt | DocsWorkReceipt | DocsFinalizeReceipt;

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit this documentation-work receipt as JSON."),
);

function renderWorkReceipt(receipt: WorkReceipt, json: boolean): string {
  if (json) return jsonDocument(receipt);
  switch (receipt.format) {
    case "niceeval.docs-work-run/v1":
      return `Prepared docs work run ${receipt.runId} with ${receipt.items.length} item(s).\n`;
    case "niceeval.docs-work-show/v1":
      return `Docs work run ${receipt.run.runId}:\n${receipt.items.map((item) => `  ${item.id}: ${item.goal}`).join("\n")}\n`;
    case "niceeval.docs-work-receipt/v1":
      return `${receipt.status} ${receipt.runId}/${receipt.itemId}; ${receipt.changedPaths.length} changed path(s); ${receipt.checks.length} check(s) passed.\n`;
    case "niceeval.docs-work-finalize/v1":
      return `Finalized docs work run ${receipt.runId} with ${receipt.receipts.length} verified receipt(s).\n`;
  }
}

function makeWorkCommand(deliver: TerminalDeliverySink) {
  const present = { success: renderWorkReceipt, failure: renderDocsDomainFailure };

  const prepare = Command.make("prepare", {
    scope: Options.string("scope").pipe(
      Options.withDescription("Bounded docs or docs-site owner path; repeat for disjoint items."),
      Options.atLeast(0),
    ),
    base: Options.string("base").pipe(Options.optional),
    json: jsonOption,
  }, ({ base, json, scope }) => deliverDomainResult(
    prepareDocsWork(scope, Option.getOrUndefined(base)),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription("Validate all scopes, then atomically prepare one local run."));

  const show = Command.make("show", {
    runId: Args.string("run-id"),
    json: jsonOption,
  }, ({ json, runId }) => deliverDomainResult(
    showDocsWork(runId),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription("Decode and show a prepared local run."));

  const check = Command.make("check", {
    runId: Args.string("run-id"),
    itemId: Args.string("item-id"),
    report: Options.boolean("report").pipe(Options.withDefault(false)),
    verify: Options.string("verify").pipe(
      Options.withDescription("Reported receipt path to reproduce and promote."),
      Options.optional,
    ),
    json: jsonOption,
  }, ({ itemId, json, report, runId, verify }) => {
    const receipt = Option.getOrUndefined(verify);
    const invalidSelection = () => Effect.fail(new DocsWorkError({
      operation: "check",
      runId,
      itemId,
      reasons: ["choose exactly one of --report or --verify <receipt>"],
    }));
    const program = report
      ? receipt === undefined
        ? checkDocsWork(runId, itemId, { _tag: "report" })
        : invalidSelection()
      : receipt === undefined
      ? invalidSelection()
      : checkDocsWork(runId, itemId, { _tag: "verify", receipt });
    return deliverDomainResult(program, json, present, deliver);
  }).pipe(Command.withDescription("Re-run scoped lint and write a reported or verified receipt."));

  const finalize = Command.make("finalize", {
    runId: Args.string("run-id"),
    json: jsonOption,
  }, ({ json, runId }) => deliverDomainResult(
    finalizeDocsWork(runId),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription("Require fresh verified receipts, then run the complete lint gate."));

  return Command.make("work").pipe(
    Command.withDescription("Prepare, inspect, check, verify, and finalize disjoint documentation work."),
    Command.withSubcommands([prepare, show, check, finalize]),
  );
}

export const workCommandContribution = defineDocsCommandContribution({
  name: "work",
  summary: "Prepare, inspect, check, verify, and finalize disjoint documentation work.",
  makeCommand: makeWorkCommand,
});
