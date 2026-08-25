import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";

import {
  jsonDocument,
  stderrDelivery,
  stdoutDelivery,
  type TerminalDeliverySink,
} from "../contribution.js";
import { runResearchAt, renderResearchError, renderResearchOutcome } from "./domain.js";
import type { ResearchContent, ResearchOutcome } from "./model.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Emit the Research-owned receipt as JSON."),
);
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription("Validate and return the exact publication receipt without writing."),
);
const rootOption = Options.text("root").pipe(
  Options.withDefault(process.cwd()),
  Options.withDescription("Repository root containing docs/research and docs/_template/research."),
);

function contentOptions() {
  return {
    title: Options.text("title").pipe(Options.withDescription("Research page title.")),
    observedOn: Options.text("observed-on").pipe(
      Options.withDescription("Observation date as YYYY-MM-DD."),
    ),
    version: Options.text("observed-version").pipe(
      Options.optional,
      Options.withDescription("Optional fixed version associated with the observation."),
    ),
    sources: Options.text("source").pipe(
      Options.repeated,
      Options.withDescription("One HTTP(S) link to first-party material; repeat for more."),
    ),
    boundary: Options.text("boundary").pipe(Options.withDescription("The external product's real boundary.")),
    mapping: Options.text("mapping").pipe(Options.withDescription("NiceEval concept mapping and non-equivalences.")),
    absorb: Options.text("absorb").pipe(Options.withDescription("What to absorb and what not to copy.")),
    nextEvidence: Options.text("next-evidence").pipe(Options.withDescription("Evidence still needed before product adoption.")),
  };
}

function contentFrom(options: {
  readonly title: string;
  readonly observedOn: string;
  readonly version: Option.Option<string>;
  readonly sources: readonly string[];
  readonly boundary: string;
  readonly mapping: string;
  readonly absorb: string;
  readonly nextEvidence: string;
}): ResearchContent {
  return {
    title: options.title,
    observedOn: options.observedOn,
    ...(Option.isSome(options.version) ? { version: options.version.value } : {}),
    sources: options.sources,
    boundary: options.boundary,
    mapping: options.mapping,
    absorb: options.absorb,
    nextEvidence: options.nextEvidence,
  };
}

function deliverResearchOutcome(
  program: Effect.Effect<ResearchOutcome, import("./errors.js").ResearchError>,
  json: boolean,
  deliver: TerminalDeliverySink,
) {
  return Effect.matchEffect(program, {
    onFailure: (error) => deliver(stderrDelivery(
      json ? jsonDocument({ ok: false, error }) : `${renderResearchError(error)}\n`,
    )),
    onSuccess: (outcome) => deliver((outcome.command === "check" && !outcome.ok)
      ? { stdout: json ? jsonDocument(outcome) : `${renderResearchOutcome(outcome)}\n`, stderr: "", exitCode: 1 }
      : stdoutDelivery(json ? jsonDocument(outcome) : `${renderResearchOutcome(outcome)}\n`)),
  });
}

/** Builds the independent Research command contribution for the Docs command tree. */
export function makeResearchCommand(deliver: TerminalDeliverySink) {

  const pageOptions = contentOptions();
  const createPage = Command.make("page", {
    path: Args.text({ name: "path" }).pipe(
      Args.withDescription("Relative slug path under docs/research, without the .md suffix."),
    ),
    ...pageOptions,
    dryRun: dryRunOption,
    json: jsonOption,
    root: rootOption,
  }, ({ dryRun, json, path, root, ...content }) => deliverResearchOutcome(runResearchAt(root, {
    command: "create-page",
    path,
    content: contentFrom(content),
    dryRun,
  }), json, deliver)).pipe(
    Command.withDescription("Create one standalone Research v1 page."),
  );

  const packageOptions = contentOptions();
  const createPackage = Command.make("package", {
    path: Args.text({ name: "path" }).pipe(
      Args.withDescription("Relative package path under docs/research."),
    ),
    ...packageOptions,
    dryRun: dryRunOption,
    json: jsonOption,
    root: rootOption,
  }, ({ dryRun, json, path, root, ...content }) => deliverResearchOutcome(runResearchAt(root, {
    command: "create-package",
    path,
    content: contentFrom(content),
    dryRun,
  }), json, deliver)).pipe(
    Command.withDescription("Create a Research v1 package root."),
  );

  const addPageOptions = contentOptions();
  const addPage = Command.make("add-page", {
    parent: Args.text({ name: "package-ref" }).pipe(
      Args.withDescription("Exact research: ref of the package README."),
    ),
    page: Args.text({ name: "page" }).pipe(
      Args.withDescription("Single page slug without the .md suffix."),
    ),
    ...addPageOptions,
    dryRun: dryRunOption,
    json: jsonOption,
    root: rootOption,
  }, ({ dryRun, json, page, parent, root, ...content }) => deliverResearchOutcome(runResearchAt(root, {
    command: "add-page",
    parent,
    page,
    content: contentFrom(content),
    dryRun,
  }), json, deliver)).pipe(
    Command.withDescription("Add one explicitly package-owned Research v1 page."),
  );

  const check = Command.make("check", {
    ref: Args.text({ name: "exact-research-ref" }),
    json: jsonOption,
    root: rootOption,
  }, ({ json, ref, root }) => deliverResearchOutcome(
    runResearchAt(root, { command: "check", ref }),
    json,
    deliver,
  )).pipe(
    Command.withDescription("Check exactly one Research v1 page or package root and its explicitly owned pages; --all is intentionally unsupported."),
  );

  return Command.make("research").pipe(
    Command.withDescription("Create and precisely check Research-owned v1 decision inputs."),
    Command.withSubcommands([createPage, createPackage, addPage, check]),
  );
}

export type ResearchCommandError = import("./errors.js").ResearchError;
