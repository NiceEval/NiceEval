import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import { Effect, Option } from "effect";
import * as FileSystem from "effect/FileSystem";

import {
  defineDocsCommandContribution,
  deliverDomainResult,
  jsonDocument,
  stderrDelivery,
  type MountedDocsCommand,
  type TerminalDeliverySink,
} from "./contribution.js";
import { REPOSITORY_ROOT } from "./runtime.js";
import { renderTraceFailure } from "./trace-command-presentation.js";
import {
  compileTrace,
  listFeatures,
  renderTraceReceipt,
  showFeature,
  type FeatureListReceipt,
  type FeatureShowReceipt,
} from "./trace/index.js";
import { addFeaturePageAt, createFeatureAt, FeatureStructureError, setFeaturePageAt, type FeatureStructureReceipt } from "./feature-structure.js";

type FeatureReceipt = FeatureListReceipt | FeatureShowReceipt | FeatureStructureReceipt;

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit this Feature receipt as JSON."),
);

function makeFeatureCommand(deliver: TerminalDeliverySink) {
  const isStructureReceipt = (receipt: FeatureReceipt): receipt is FeatureStructureReceipt => "dryRun" in receipt && "nextGeneration" in receipt;
  const present = {
    success: (receipt: FeatureReceipt, json: boolean) => json
      ? jsonDocument(receipt)
      : isStructureReceipt(receipt)
        ? `${receipt.dryRun ? "Would publish" : "Published"} ${receipt.operation} (${receipt.generation} → ${receipt.nextGeneration})\n`
        : `${renderTraceReceipt(receipt)}\n`,
    failure: (error: unknown, _json: boolean) => error instanceof FeatureStructureError
      ? `${error._tag}: ${error.operation} ${error.path}: ${error.message}\n`
      : renderTraceFailure(error as never, _json),
  };

  const list = Command.make("list", {
    pattern: Args.string("pattern").pipe(Args.optional),
    json: jsonOption,
  }, ({ json, pattern }) => {
    const selected = Option.getOrUndefined(pattern);
    const program = compileTrace(REPOSITORY_ROOT).pipe(
      Effect.map((snapshot) => listFeatures(snapshot, selected === undefined ? {} : { pattern: selected })),
    );
    return deliverDomainResult(program, json, present, deliver);
  }).pipe(Command.withDescription("List Feature IDs that can be passed to feature show."));

  const show = Command.make("show", {
    feature: Args.string("feature-id-or-path"),
    json: jsonOption,
  }, ({ feature, json }) => deliverDomainResult(
    compileTrace(REPOSITORY_ROOT).pipe(Effect.flatMap((snapshot) => showFeature(snapshot, feature))),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription("Show one Feature, its Use Cases, tests, docs, and Memory."));

  const dryRun = Options.boolean("dry-run").pipe(Options.withDefault(false));
  const create = Command.make("create", { slug: Args.string("slug"), title: Options.string("title"), pages: Options.string("pages").pipe(Options.optional), dryRun, json: jsonOption }, ({ dryRun, json, pages, slug, title }) =>
    deliverDomainResult(createFeatureAt(REPOSITORY_ROOT, { slug, title, pages: Option.getOrUndefined(pages)?.split(",").map((item) => item.trim()).filter(Boolean) ?? [], dryRun }), json, present, deliver),
  ).pipe(Command.withDescription("Atomically create one new Feature package."));
  const add = Command.make("add", { feature: Args.string("feature-ref"), page: Args.string("page"), dryRun, json: jsonOption }, ({ dryRun, feature, json, page }) =>
    deliverDomainResult(addFeaturePageAt(REPOSITORY_ROOT, { feature, page, dryRun }), json, present, deliver),
  ).pipe(Command.withDescription("Add one allowed page to an existing Feature."));
  const set = Command.make("set", { feature: Args.string("feature-ref"), page: Args.string("page"), stdin: Options.boolean("stdin").pipe(Options.withDefault(false)), file: Options.string("file").pipe(Options.optional), expectedPreimageDigest: Options.string("expected-preimage-digest"), dryRun, json: jsonOption }, ({ dryRun, expectedPreimageDigest, feature, file, json, page, stdin }) => {
    const path = Option.getOrUndefined(file);
    if ((stdin && path !== undefined) || (!stdin && path === undefined)) return deliver(stderrDelivery("FeatureStructureError: page set requires exactly one of --stdin or --file\n"));
    const body = stdin ? Effect.callback<string, FeatureStructureError>((resume) => {
      let source = "";
      const onData = (chunk: string | Buffer) => { source += chunk.toString(); };
      const onEnd = () => resume(Effect.succeed(source));
      const onError = (cause: Error) => resume(Effect.fail(new FeatureStructureError({ operation: "page-set", path: "stdin", message: String(cause) })));
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", onData);
      process.stdin.once("end", onEnd);
      process.stdin.once("error", onError);
      return Effect.sync(() => {
        process.stdin.off("data", onData);
        process.stdin.off("end", onEnd);
        process.stdin.off("error", onError);
      });
    }) : FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.readFileString(path!)), Effect.mapError((cause) => new FeatureStructureError({ operation: "page-set", path: path!, message: String(cause) })));
    return deliverDomainResult(body.pipe(Effect.flatMap((source) => setFeaturePageAt(REPOSITORY_ROOT, { feature, page, body: source, expectedPreimageDigest, dryRun }))), json, present, deliver);
  }).pipe(Command.withDescription("Replace one existing page author region after a preimage digest check."));
  const page = Command.make("page").pipe(Command.withDescription("Manage allowed pages on an existing Feature."), Command.withSubcommands([add, set]));

  return Command.make("feature").pipe(
    Command.withDescription("Discover and structurally maintain Feature contracts."),
    Command.withSubcommands([list, show, create, page]),
  ) as unknown as MountedDocsCommand;
}

export const featureCommandContribution = defineDocsCommandContribution({
  name: "feature",
  summary: "Discover Feature contracts and their related repository evidence.",
  makeCommand: makeFeatureCommand,
});
