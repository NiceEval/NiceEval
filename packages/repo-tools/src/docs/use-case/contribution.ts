import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import { Effect, Option } from "effect";
import * as FileSystem from "effect/FileSystem";

import {
  defineDocsCommandContribution,
  stderrDelivery,
  stdoutDelivery,
  type MountedDocsCommand,
  type TerminalDeliverySink,
} from "../contribution.js";
import { REPOSITORY_ROOT } from "../runtime.js";
import { createUseCaseAt } from "./domain.js";
import { UseCaseInputInvalid, UseCaseIoError } from "./errors.js";
import { renderUseCaseError, renderUseCaseReceipt } from "./presentation.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit the complete Use Case receipt as JSON."),
);
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDefault(false),
  Options.withDescription("Validate the complete two-file publication without writing."),
);

function readStdin(): Effect.Effect<string, UseCaseIoError> {
  return Effect.callback<string, UseCaseIoError>((resume) => {
    let source = "";
    const onData = (chunk: string | Buffer) => { source += chunk.toString(); };
    const onEnd = () => resume(Effect.succeed(source));
    const onError = (cause: Error) => resume(Effect.fail(new UseCaseIoError({
      operation: "read",
      path: "stdin",
      message: cause.message,
    })));
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
    return Effect.sync(() => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
    });
  });
}

function readBody(path: string): Effect.Effect<string, UseCaseIoError, FileSystem.FileSystem> {
  return FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(path)),
    Effect.mapError((cause) => new UseCaseIoError({ operation: "read", path, message: String(cause) })),
  );
}

function makeUseCaseCommand(deliver: TerminalDeliverySink) {
  const create = Command.make("create", {
    slug: Args.string("slug").pipe(Args.withDescription("Single-segment Use Case slug; Unicode letters and numbers are allowed.")),
    parent: Options.string("parent").pipe(Options.withDescription("Existing exact Feature ID or canonical README path.")),
    title: Options.string("title").pipe(Options.withDescription("Title that must match the body's level-one heading.")),
    file: Options.string("file").pipe(Options.optional, Options.withDescription("Path to the complete Markdown body.")),
    stdin: Options.boolean("stdin").pipe(Options.withDefault(false), Options.withDescription("Read the complete Markdown body from stdin.")),
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, file, json, parent, slug, stdin, title }) => {
    const path = Option.getOrUndefined(file);
    if ((stdin && path !== undefined) || (!stdin && path === undefined)) {
      const error = new UseCaseInputInvalid({
        source: "body",
        message: "create requires exactly one of --file or --stdin",
      });
      return deliver(stderrDelivery(renderUseCaseError(error, json)));
    }
    const body = stdin ? readStdin() : readBody(path!);
    return Effect.matchEffect(
      body.pipe(Effect.flatMap((source) => createUseCaseAt(REPOSITORY_ROOT, {
        slug,
        parent,
        title,
        body: source,
        dryRun,
      }))),
      {
        onFailure: (error) => deliver(stderrDelivery(renderUseCaseError(error, json))),
        onSuccess: (receipt) => deliver(stdoutDelivery(renderUseCaseReceipt(receipt, json))),
      },
    );
  }).pipe(Command.withDescription("Create one leaf Use Case and update its existing parent index in one Trace transaction."));

  return Command.make("use-case").pipe(
    Command.withDescription("Create leaf Use Cases under existing Feature packages."),
    Command.withSubcommands([create]),
  ) as unknown as MountedDocsCommand;
}

export const useCaseCommandContribution = defineDocsCommandContribution({
  name: "use-case",
  summary: "Create leaf Use Cases under existing Feature packages.",
  makeCommand: makeUseCaseCommand,
});
