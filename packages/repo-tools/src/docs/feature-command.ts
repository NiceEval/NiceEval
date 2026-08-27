import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import { Effect, Option } from "effect";

import {
  defineDocsCommandContribution,
  deliverDomainResult,
  jsonDocument,
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

type FeatureReceipt = FeatureListReceipt | FeatureShowReceipt;

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit this Feature receipt as JSON."),
);

function makeFeatureCommand(deliver: TerminalDeliverySink) {
  const present = {
    success: (receipt: FeatureReceipt, json: boolean) => json
      ? jsonDocument(receipt)
      : `${renderTraceReceipt(receipt)}\n`,
    failure: renderTraceFailure,
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

  return Command.make("feature").pipe(
    Command.withDescription("Discover Feature contracts and their related repository evidence."),
    Command.withSubcommands([list, show]),
  );
}

export const featureCommandContribution = defineDocsCommandContribution({
  name: "feature",
  summary: "Discover Feature contracts and their related repository evidence.",
  makeCommand: makeFeatureCommand,
});
