import { Args, Command, Options } from "@effect/cli";
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
  listTests,
  renderTestListReceipt,
  renderTraceReceipt,
  showTest,
  type TestListReceipt,
  type TestShowReceipt,
} from "./trace/index.js";

type TestReceipt = TestListReceipt | TestShowReceipt;

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit this test-owner receipt as JSON."),
);

function makeTestCommand(deliver: TerminalDeliverySink) {
  const present = {
    success: (receipt: TestReceipt, json: boolean) => json
      ? jsonDocument(receipt)
      : `${renderTraceReceipt(receipt)}\n`,
    failure: renderTraceFailure,
  };

  const list = Command.make("list", {
    pattern: Args.text({ name: "pattern" }).pipe(Args.optional),
    json: jsonOption,
  }, ({ json, pattern }) => {
    const selected = Option.getOrUndefined(pattern);
    const program = compileTrace(REPOSITORY_ROOT).pipe(
      Effect.flatMap((snapshot) => {
        const receipt = listTests(snapshot, selected === undefined ? {} : { pattern: selected });
        if (json) return Effect.succeed({ receipt, rendered: "" });
        return Effect.forEach(receipt.tests, (item) => showTest(snapshot, item.path)).pipe(
          Effect.map((details) => ({ receipt, rendered: renderTestListReceipt(receipt, details) })),
        );
      }),
    );
    return deliverDomainResult(program, json, {
      success: ({ receipt, rendered }, structured) => structured
        ? jsonDocument(receipt)
        : `${rendered}\n`,
      failure: renderTraceFailure,
    }, deliver);
  }).pipe(Command.withDescription(
    "List E2E tests with their Feature/Use Case, regression Memory, and Issue relations.",
  ));

  const show = Command.make("show", {
    test: Args.text({ name: "test-path" }),
    json: jsonOption,
  }, ({ json, test }) => deliverDomainResult(
    compileTrace(REPOSITORY_ROOT).pipe(Effect.flatMap((snapshot) => showTest(snapshot, test))),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription(
    "Show the Features, Use Case, owner, and regressions for one E2E test.",
  ));

  return Command.make("test").pipe(
    Command.withDescription("Discover E2E tests and the product contracts they protect."),
    Command.withSubcommands([list, show]),
  );
}

export const testCommandContribution = defineDocsCommandContribution({
  name: "test",
  summary: "Discover E2E tests and the product contracts they protect.",
  makeCommand: makeTestCommand,
});
