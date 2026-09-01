import { Effect, Result } from "effect";
import type { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";

import {
  CliArguments,
  CliInvocationFacts,
  CliOutput,
  type CliOptionDefinition,
  type CliParsedTokens,
} from "../../cli/application.ts";
import {
  CliFeatureError,
  type CliCommandContribution,
} from "../../cli/contribution.ts";
import { canonicalJsonValue } from "../../inspection/index.ts";
import { runHost } from "../host/index.ts";
import {
  RUN_PROTOCOL,
  type RunGetDocument,
  type RunListDocument,
} from "../protocol.ts";
import type {
  RunDeleteError,
  RunReadError,
  RunRecoverError,
} from "../host/index.ts";

const help = (summary: string) =>
  Object.freeze({ summary, visibility: "public" as const });
const option = (value: CliOptionDefinition): CliOptionDefinition =>
  Object.freeze(value);

export const RUN_CLI_OPTIONS = Object.freeze({
  invocation: option({
    type: "string",
    help: help("Filter Run discovery by one exact Invocation ID."),
  }),
  json: option({ type: "boolean", help: help("Print machine-readable JSON.") }),
  yes: option({ type: "boolean", help: help("Confirm delete or recover.") }),
  help: option({ type: "boolean", short: "h", help: help("Print Run help.") }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

type Requirements = CliArguments | CliInvocationFacts | CliOutput | ProjectStateDatabase;
type Error = CliFeatureError;
type HostFailure = RunReadError | RunDeleteError | RunRecoverError;

function failure(operation: string, cause: unknown): Error {
  const hostFailure = isHostFailure(cause) ? cause : undefined;
  return new CliFeatureError({
    feature: "run",
    operation,
    cause,
    exitCode: 1,
    ...(hostFailure === undefined
      ? {}
      : { display: `${hostFailure.code}: ${hostFailure.message}\n` }),
  });
}

function isHostFailure(value: unknown): value is HostFailure {
  return typeof value === "object" && value !== null &&
    ["RunReadError", "RunDeleteError", "RunRecoverError"].includes(String(Reflect.get(value, "_tag")));
}

function write(channel: "stdout" | "stderr", text: string) {
  return Effect.flatMap(CliOutput, (output) =>
    channel === "stdout" ? output.writeStdout(text) : output.writeStderr(text)).pipe(
    Effect.mapError((cause) => failure(`write ${channel}`, cause)),
  );
}

function invocationFacts() {
  return Effect.flatMap(CliInvocationFacts, ({ facts }) => facts).pipe(
    Effect.mapError((cause) => failure("read invocation facts", cause)),
  );
}

function writeJson(value: unknown) {
  const encoded = canonicalJsonValue(value);
  return Result.isFailure(encoded)
    ? Effect.fail(failure("encode JSON", encoded.failure))
    : write("stdout", encoded.success);
}

function usage(message: string) {
  return write("stderr", `${message}\n`).pipe(Effect.as(1));
}

function unsupportedOption(
  parsed: CliParsedTokens,
  allowed: readonly string[],
): string | undefined {
  const permitted = new Set([...allowed, "help"]);
  return Object.entries(parsed.values).find(([name, value]) =>
    value !== undefined && !permitted.has(name))?.[0];
}

function runCommand(argv: readonly string[]): Effect.Effect<number, Error, Requirements> {
  return Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsed = yield* Effect.try({
      try: () => parser.parse(argv, RUN_CLI_OPTIONS),
      catch: (cause) => failure("parse arguments", cause),
    });
    if (parsed.values.help === true) {
      yield* write("stdout", `niceeval run — inspect and manage Run lifecycle

Usage:
  niceeval run list [--invocation <invocation-id>] [--json]
  niceeval run show <run-id> [--json]
  niceeval run delete <run-id> [--yes] [--json]
  niceeval run recover <run-id> [--yes] [--json]
`);
      return 0;
    }
    const action = parsed.positionals[0];
    if (action === undefined || !["list", "show", "delete", "recover"].includes(action)) {
      return yield* usage(`niceeval run expects exactly one of list, show, delete, or recover.
`.trimEnd());
    }
    const facts = yield* invocationFacts();
    const json = parsed.values.json === true;

    if (action === "list") {
      if (parsed.positionals.length !== 1) {
        return yield* usage("niceeval run list does not accept positional selectors.");
      }
      const unsupported = unsupportedOption(parsed, ["invocation", "json"]);
      if (unsupported !== undefined) return yield* usage(`--${unsupported} is not valid with niceeval run list.`);
      const listed = yield* runHost.list({
        cwd: facts.cwd,
        ...(typeof parsed.values.invocation === "string"
          ? { invocationId: parsed.values.invocation }
          : {}),
      }).pipe(Effect.mapError((cause) => failure("list", cause)));
      if (json) {
        yield* writeJson(Object.freeze({
          protocol: RUN_PROTOCOL,
          operation: "run.list",
          runs: listed.runs,
          ...(listed.continuation === undefined
            ? {}
            : { continuation: listed.continuation }),
        }) satisfies RunListDocument);
        return 0;
      }
      if (listed.runs.length === 0) {
        yield* write("stdout", `No Runs found.
`);
        return 0;
      }
      yield* write("stdout", `${listed.runs.map((run) =>
        `${run.runId}  ${run.state}  ${run.experimentId}  ${run.coverage.published}/${run.coverage.expected}  ${new Date(run.startedAt).toISOString()}`
      ).join("\n")}\n`);
      return 0;
    }

    if (parsed.positionals.length !== 2) {
      return yield* usage(`niceeval run ${action} requires one exact Run ID.`);
    }
    const runId = parsed.positionals[1]!;
    if (action === "show") {
      const unsupported = unsupportedOption(parsed, ["json"]);
      if (unsupported !== undefined) return yield* usage(`--${unsupported} is not valid with niceeval run show.`);
      const shown = yield* runHost.get({ cwd: facts.cwd, runId }).pipe(
        Effect.mapError((cause) => failure("show", cause)),
      );
      if (json) {
        yield* writeJson(Object.freeze({
          protocol: RUN_PROTOCOL,
          operation: "run.get",
          run: shown.run,
        }) satisfies RunGetDocument);
      } else {
        yield* write("stdout", `${shown.run.runId}  ${shown.run.state}  ${shown.run.experimentId}\n` +
          `started: ${new Date(shown.run.startedAt).toISOString()}\n` +
          (shown.run.completedAt === undefined
            ? ""
            : `completed: ${new Date(shown.run.completedAt).toISOString()}\n`) +
          `coverage: ${shown.run.coverage.published}/${shown.run.coverage.expected}\n`);
      }
      return 0;
    }

    const unsupported = unsupportedOption(parsed, ["json", "yes"]);
    if (unsupported !== undefined) return yield* usage(`--${unsupported} is not valid with niceeval run ${action}.`);
    if (parsed.values.yes !== true) {
      if (json) {
        yield* writeJson(Object.freeze({
          protocol: RUN_PROTOCOL,
          operation: `run.${action}`,
          outcome: "confirmation-required",
          runId,
        }));
      } else {
        yield* write("stderr", `Run ${runId} is selected for ${action}. Review it, then rerun with --yes.
`);
      }
      return 1;
    }
    if (action === "delete") {
      const receipt = yield* runHost.delete({ cwd: facts.cwd, runId }).pipe(
        Effect.mapError((cause) => failure("delete", cause)),
      );
      if (json) yield* writeJson(Object.freeze({ protocol: RUN_PROTOCOL, operation: "run.delete", ...receipt }));
      else yield* write("stdout", `Deleted Run ${receipt.runId}.
`);
      return 0;
    }
    const receipt = yield* runHost.recover({ cwd: facts.cwd, runId }).pipe(
      Effect.mapError((cause) => failure("recover", cause)),
    );
    if (json) yield* writeJson(Object.freeze({ protocol: RUN_PROTOCOL, operation: "run.recover", ...receipt }));
    else yield* write("stdout", `Recovered Run ${receipt.runId} as interrupted.
`);
    return 0;
  });
}

export const runCliCommand: CliCommandContribution<Requirements, Error> = Object.freeze({
  name: "run",
  summary: "inspect and manage Run lifecycle",
  options: RUN_CLI_OPTIONS,
  run: runCommand,
});
