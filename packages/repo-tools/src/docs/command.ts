import { Args, Command, Options } from "@effect/cli";
import type * as CommandExecutor from "@effect/platform/CommandExecutor";
import { Effect, Option } from "effect";

import { DocsWorkError, type DocsDomainError } from "./errors.js";
import { generateDiffCode, generateReference, runDocsDev } from "./generators.js";
import type { DocsReceipt, TermScope } from "./model.js";
import {
  addDocumentationTerm,
  checkDocumentationTerms,
  listDocumentationTerms,
  removeDocumentationTerm,
} from "./terms.js";
import {
  checkDocsWork,
  finalizeDocsWork,
  prepareDocsWork,
  showDocsWork,
} from "./work.js";

export interface DocsReceiptEnvelope {
  readonly json: boolean;
  readonly receipt: DocsReceipt;
}

export type DocsReceiptSink<R = never, E = never> = (
  envelope: DocsReceiptEnvelope,
) => Effect.Effect<void, E, R>;

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit the structured receipt as JSON."),
);
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription("Return the exact planned document without writing it."),
);
const scopeOption = Options.choice("scope", ["docs", "all", "site"] as const).pipe(
  Options.withDescription("Select design docs, both documentation surfaces, or the public site."),
);

/**
 * Builds the Docs domain's contribution to the repository's single Effect CLI tree.
 * Rendering stays at the root composition boundary through the supplied receipt sink.
 */
export function makeDocsCommand<R = never, E = never>(emit: DocsReceiptSink<R, E>) {
  const deliver = (receipt: DocsReceipt, json: boolean) => emit({ receipt, json });

  const termList = Command.make("list", {
    pattern: Args.text({ name: "pattern" }).pipe(Args.optional),
    scope: scopeOption.pipe(Options.optional),
    json: jsonOption,
  }, ({ json, pattern, scope }) => listDocumentationTerms(
    Option.getOrUndefined(pattern),
    Option.getOrUndefined(scope),
  ).pipe(Effect.flatMap((receipt) => deliver(receipt, json)))).pipe(
    Command.withDescription("List canonical banned-wording decisions."),
  );

  const termAdd = Command.make("add", {
    term: Args.text({ name: "term" }),
    use: Options.text("use").pipe(Options.withDescription("Concrete replacement wording or action.")),
    why: Options.text("why").pipe(Options.withDescription("Why the original wording is harmful.")),
    scope: scopeOption.pipe(Options.withDefault("docs" as TermScope)),
    allowIn: Options.text("allow-in").pipe(Options.repeated),
    exempt: Options.text("exempt").pipe(Options.repeated),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ allowIn, dryRun, exempt, json, scope, term, use, why }) => addDocumentationTerm({
    term,
    use,
    why,
    scope,
    allowIn,
    exempt,
  }, dryRun).pipe(Effect.flatMap((receipt) => deliver(receipt, json)))).pipe(
    Command.withDescription("Add one justified banned-wording decision atomically."),
  );

  const termRemove = Command.make("remove", {
    term: Args.text({ name: "term" }),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, json, term }) => removeDocumentationTerm(term, dryRun).pipe(
    Effect.flatMap((receipt) => deliver(receipt, json)),
  )).pipe(Command.withDescription("Remove one uniquely registered wording decision atomically."));

  const termCheck = Command.make("check", { json: jsonOption }, ({ json }) =>
    checkDocumentationTerms().pipe(Effect.flatMap((receipt) => deliver(receipt, json)))).pipe(
    Command.withDescription("Run the canonical documentation lint owner."),
  );

  const terms = Command.make("terms").pipe(
    Command.withDescription("Maintain docs/writing-rules.json through one Schema boundary."),
    Command.withSubcommands([termList, termAdd, termRemove, termCheck]),
  );

  const dev = Command.make("dev", {
    args: Args.text({ name: "mint-arg" }).pipe(Args.repeated),
    json: jsonOption,
  }, ({ args, json }) => runDocsDev(args).pipe(
    Effect.flatMap((receipt) => deliver(receipt, json)),
  )).pipe(Command.withDescription("Run the scoped Mintlify development process."));

  const diffCode = Command.make("diff-code", {
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, json }) =>
    generateDiffCode(dryRun).pipe(Effect.flatMap((receipt) => deliver(receipt, json)))).pipe(
    Command.withDescription("Generate code-diff assets in a scoped staging directory, then replace atomically."),
  );

  const reference = Command.make("reference", {
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, json }) =>
    generateReference(dryRun).pipe(Effect.flatMap((receipt) => deliver(receipt, json)))).pipe(
    Command.withDescription("Generate public reference regions with per-output atomic replacement."),
  );

  const workPrepare = Command.make("prepare", {
    scope: Options.text("scope").pipe(
      Options.withDescription("Bounded docs or docs-site owner path; repeat for disjoint items."),
      Options.repeated,
    ),
    base: Options.text("base").pipe(Options.optional),
    json: jsonOption,
  }, ({ base, json, scope }) => prepareDocsWork(scope, Option.getOrUndefined(base)).pipe(
    Effect.flatMap((receipt) => deliver(receipt, json)),
  )).pipe(Command.withDescription("Validate all scopes, then atomically prepare one local run."));

  const workShow = Command.make("show", {
    runId: Args.text({ name: "run-id" }),
    json: jsonOption,
  }, ({ json, runId }) => showDocsWork(runId).pipe(
    Effect.flatMap((receipt) => deliver(receipt, json)),
  )).pipe(Command.withDescription("Decode and show a prepared local run."));

  const workCheck = Command.make("check", {
    runId: Args.text({ name: "run-id" }),
    itemId: Args.text({ name: "item-id" }),
    report: Options.boolean("report"),
    verify: Options.text("verify").pipe(
      Options.withDescription("Reported receipt path to reproduce and promote."),
      Options.optional,
    ),
    json: jsonOption,
  }, ({ itemId, json, report, runId, verify }) => {
    const receipt = Option.getOrUndefined(verify);
    if (report === (receipt !== undefined)) {
      return Effect.fail(new DocsWorkError({
        operation: "check",
        runId,
        itemId,
        reasons: ["choose exactly one of --report or --verify <receipt>"],
      }));
    }
    return checkDocsWork(runId, itemId, report ? { _tag: "report" } : {
      _tag: "verify",
      receipt: receipt!,
    }).pipe(Effect.flatMap((result) => deliver(result, json)));
  }).pipe(Command.withDescription("Re-run scoped lint and write a reported or verified receipt."));

  const workFinalize = Command.make("finalize", {
    runId: Args.text({ name: "run-id" }),
    json: jsonOption,
  }, ({ json, runId }) => finalizeDocsWork(runId).pipe(
    Effect.flatMap((receipt) => deliver(receipt, json)),
  )).pipe(Command.withDescription("Require fresh verified receipts, then run the complete lint gate."));

  const work = Command.make("work").pipe(
    Command.withDescription("Prepare, inspect, check, verify, and finalize disjoint documentation work."),
    Command.withSubcommands([workPrepare, workShow, workCheck, workFinalize]),
  );

  return Command.make("docs").pipe(
    Command.withDescription("Maintain repository design and public documentation."),
    Command.withSubcommands([terms, dev, diffCode, reference, work]),
  );
}

export type DocsCommandError = DocsDomainError;
export type DocsCommandServices = CommandExecutor.CommandExecutor;
