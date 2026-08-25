import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";

import {
  defineDocsCommandContribution,
  stderrDelivery,
  stdoutDelivery,
  type TerminalDeliverySink,
} from "../contribution.js";
import { REPOSITORY_ROOT } from "../runtime.js";
import { runDesignCommandAt } from "./domain.js";
import type { DesignReceipt } from "./model.js";
import { renderDesignError, renderDesignReceipt } from "./presentation.js";

export interface DesignOperationContribution {
  readonly name: "create" | "check" | "decide";
  readonly summary: string;
  readonly usage: string;
}

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit the complete Design receipt as JSON."),
);
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription("Validate and return the same-shaped receipt without writing."),
);

function deliverDesign(
  program: ReturnType<typeof runDesignCommandAt>,
  json: boolean,
  deliver: TerminalDeliverySink,
) {
  return Effect.matchEffect(program, {
    onFailure: (error) => deliver(stderrDelivery(renderDesignError(error, json))),
    onSuccess: (receipt: DesignReceipt) => {
      const output = renderDesignReceipt(receipt, json);
      return deliver(receipt.operation === "design-check" && !receipt.ok
        ? { stdout: output, stderr: "", exitCode: 1 }
        : stdoutDelivery(output));
    },
  });
}

/** Builds the independent Design command contribution for the Docs command tree. */
export function makeDesignCommand(
  deliver: TerminalDeliverySink,
  root = REPOSITORY_ROOT,
) {
  const create = Command.make("create", {
    slug: Args.text({ name: "slug" }),
    title: Options.text("title").pipe(Options.withDescription("Human-readable Design title.")),
    plans: Options.integer("plans").pipe(
      Options.withDescription("Number of direct PLAN-N packages; minimum and default are two."),
      Options.withDefault(2),
    ),
    cases: Options.boolean("cases").pipe(
      Options.withDescription("Include the optional shared CASES.md page."),
    ),
    pages: Options.text("pages").pipe(
      Options.withDescription("Comma-separated Plan pages: library,cli,architecture,lifecycle,use-case."),
      Options.optional,
    ),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ cases, dryRun, json, pages, plans, slug, title }) => {
    const selectedPages = Option.getOrUndefined(pages)?.split(",").map((page) => page.trim()).filter(Boolean) ?? [];
    return deliverDesign(runDesignCommandAt(root, {
      command: "create",
      slug,
      title,
      plans,
      cases,
      pages: selectedPages,
      dryRun,
      json,
    }), json, deliver);
  }).pipe(Command.withDescription("Atomically scaffold one undecided Design with at least two direct Plans."));

  const check = Command.make("check", {
    design: Args.text({ name: "design-ref" }),
    json: jsonOption,
  }, ({ design, json }) => deliverDesign(
    runDesignCommandAt(root, { command: "check", design, json }),
    json,
    deliver,
  )).pipe(Command.withDescription("Validate either legal Design state, templates, direct Plans, pages, and projection."));

  const decide = Command.make("decide", {
    design: Args.text({ name: "design-ref" }),
    plan: Options.text("plan").pipe(
      Options.withDescription("Exact direct PLAN-N selector or repo-relative Design Plan ref."),
    ),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ design, dryRun, json, plan }) => deliverDesign(runDesignCommandAt(root, {
    command: "decide",
    design,
    plan,
    dryRun,
    json,
  }), json, deliver)).pipe(
    Command.withDescription("Atomically select the sole Plan after its package and DECISION.md are authored."),
  );

  return Command.make("design").pipe(
    Command.withDescription("Create, validate, and immutably decide Design documentation."),
    Command.withSubcommands([create, check, decide]),
  );
}

const operation = (
  name: DesignOperationContribution["name"],
  summary: string,
  usage: string,
): DesignOperationContribution => Object.freeze({ name, summary, usage });

/** Public help metadata kept beside the command parser, never reflected from the root router. */
export const designCommandOperations: readonly DesignOperationContribution[] = Object.freeze([
  operation("create", "Create an undecided Design and direct Plans atomically.", "pnpm run repo docs design create <slug> --title <title>"),
  operation("check", "Validate either legal Design state and its generated projection.", "pnpm run repo docs design check <design-ref>"),
  operation("decide", "Write the sole immutable selectedPlan after authoring.", "pnpm run repo docs design decide <design-ref> --plan <PLAN-N|ref>"),
]);

/** Immutable Design-owned contribution mounted by the repository CLI. */
export const designCommandContribution = defineDocsCommandContribution({
  name: "design",
  summary: "Create, validate, and immutably decide Design documentation.",
  makeCommand: makeDesignCommand,
});
