import { Argument as Args, Command, Flag as Options } from "effect/cli";
import { Effect, Option } from "effect";

import {
  defineDocsCommandContribution,
  deliverDomainResult,
  jsonDocument,
  type TerminalDeliverySink,
} from "./internal/command.js";
import { type DocsDomainError, DocsWorkError, renderDocsDomainFailure } from "./internal/errors.js";
import type { DocsFinalizeReceipt, DocsWorkReceipt, DocsWorkRun, DocsWorkShowReceipt } from "./model.js";
import { checkDocsWork, finalizeDocsWork, prepareDocsWork, showDocsWork } from "./work.js";

const jsonOption = Options.Boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit this documentation-work receipt as JSON."),
);

function renderPreparedRun(receipt: DocsWorkRun, json: boolean): string {
  if (json) return jsonDocument(receipt);
  return `Prepared docs work run ${receipt.runId} with ${receipt.items.length} item(s).\n`;
}

function renderShownRun(receipt: DocsWorkShowReceipt, json: boolean): string {
  if (json) return jsonDocument(receipt);
  return `Docs work run ${receipt.run.runId}:\n${receipt.items.map((item) => `  ${item.id}: ${item.goal}`).join("\n")}\n`;
}

function renderCheckedItem(receipt: DocsWorkReceipt, json: boolean): string {
  if (json) return jsonDocument(receipt);
  return `${receipt.status} ${receipt.runId}/${receipt.itemId}; ${receipt.changedPaths.length} changed path(s); ${receipt.checks.length} check(s) passed.\n`;
}

function renderFinalizedRun(receipt: DocsFinalizeReceipt, json: boolean): string {
  if (json) return jsonDocument(receipt);
  return `Finalized docs work run ${receipt.runId} with ${receipt.receipts.length} verified receipt(s).\n`;
}

function renderWorkFailure(error: DocsDomainError, json: boolean): string {
  if (error._tag !== "DocsWorkError") return renderDocsDomainFailure(error, json);
  const message = error.reasons.join("; ");
  return json
    ? jsonDocument({ ok: false, error: error._tag, message })
    : `DocsWorkError: ${message.replace(/\s*\n\s*/gu, " ")}\n`;
}

function makeWorkCommand(deliver: TerminalDeliverySink) {
  const prepare = Command.make(
    "prepare",
    {
      scope: Options.String("scope").pipe(
        Options.withDescription("Bounded docs or docs-site owner path; repeat for disjoint items."),
        Options.atLeast(0),
      ),
      base: Options.String("base").pipe(Options.optional),
      json: jsonOption,
    },
    ({ base, json, scope }) =>
      deliverDomainResult(
        prepareDocsWork(scope, Option.getOrUndefined(base)),
        json,
        { success: renderPreparedRun, failure: renderWorkFailure },
        deliver,
      ),
  ).pipe(Command.withDescription("Validate all scopes, then atomically prepare one local run."));

  const show = Command.make(
    "show",
    {
      runId: Args.String("run-id"),
      json: jsonOption,
    },
    ({ json, runId }) =>
      deliverDomainResult(showDocsWork(runId), json, { success: renderShownRun, failure: renderWorkFailure }, deliver),
  ).pipe(Command.withDescription("Decode and show a prepared local run."));

  const check = Command.make(
    "check",
    {
      runId: Args.String("run-id"),
      itemId: Args.String("item-id"),
      report: Options.Boolean("report").pipe(Options.withDefault(false)),
      verify: Options.String("verify").pipe(
        Options.withDescription("Reported receipt path to reproduce and promote."),
        Options.optional,
      ),
      json: jsonOption,
    },
    ({ itemId, json, report, runId, verify }) => {
      const receipt = Option.getOrUndefined(verify);
      const invalidSelection = () =>
        Effect.fail(
          new DocsWorkError({
            operation: "check",
            runId,
            itemId,
            reasons: ["choose exactly one of --report or --verify <receipt>"],
          }),
        );
      const program = report
        ? receipt === undefined
          ? checkDocsWork(runId, itemId, { _tag: "report" })
          : invalidSelection()
        : receipt === undefined
          ? invalidSelection()
          : checkDocsWork(runId, itemId, { _tag: "verify", receipt });
      return deliverDomainResult(program, json, { success: renderCheckedItem, failure: renderWorkFailure }, deliver);
    },
  ).pipe(Command.withDescription("Re-run scoped lint and write a reported or verified receipt."));

  const finalize = Command.make(
    "finalize",
    {
      runId: Args.String("run-id"),
      json: jsonOption,
    },
    ({ json, runId }) =>
      deliverDomainResult(
        finalizeDocsWork(runId),
        json,
        { success: renderFinalizedRun, failure: renderWorkFailure },
        deliver,
      ),
  ).pipe(Command.withDescription("Require fresh verified receipts, then run the complete lint gate."));

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
