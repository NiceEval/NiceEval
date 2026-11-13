import { importRuns, exportRuns } from "../host/transfer.ts";
import { SqliteRecordError } from "../../record/sqlite/errors.ts";
import { Effect, Result, Schema } from "effect";
import type { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";

import {
  CliArguments,
  CliConfirmation,
  CliInvocationFacts,
  CliOutput,
  type CliOptionDefinition,
  type CliParsedTokens,
} from "../../cli/application.ts";
import {
  CliFeatureError,
  type CliCommandContribution,
} from "../../cli/contribution.ts";
import { canonicalJsonValue } from "../../inspection/canonical.ts";
import { rawRunHost } from "../host/runtime.ts";
import {
  RUN_PROTOCOL,
  RunStateSchema,
  type RunListDocument,
  type RunRecoverOrphanedDocument,
  type RunState,
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
  state: option({ type: "string", multiple: true, help: help("Filter by Run state; repeat to include several states (active, recovering, completed, interrupted, failed).") }),
  experiment: option({ type: "string", multiple: true, help: help("Filter Runs by one Experiment ID path prefix.") }),
  limit: option({ type: "string", help: help("Show only the newest n matching Runs; requires a positive integer.") }),
  record: option({ type: "string", help: help("Read an external canonical SQLite Record without probing local owner processes.") }),
  orphaned: option({ type: "boolean", help: help("Recover the frozen set of Runs whose owner termination can be proved; skip live or unknown owners.") }),
  run: option({ type: "string", multiple: true, help: help("Select an exact Run ID for export; repeat to select multiple Runs.") }),
  out: option({ type: "string", help: help("Write the exported single-file Record to this path.") }),
  invocation: option({
    type: "string",
    help: help("Filter Run discovery by one exact Invocation ID."),
  }),
  json: option({ type: "boolean", help: help("Print machine-readable JSON.") }),
  yes: option({ type: "boolean", help: help("Confirm delete or recover.") }),
  help: option({ type: "boolean", short: "h", help: help("Print Run help.") }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

type Requirements = CliArguments | CliConfirmation | CliInvocationFacts | CliOutput | ProjectStateDatabase;
type Error = CliFeatureError;
type HostFailure = RunReadError | RunDeleteError | RunRecoverError;

function failure(operation: string, cause: unknown): Error {
  const hostFailure = isHostFailure(cause) ? cause : cause instanceof SqliteRecordError
    ? { code: cause.cause instanceof Error && cause.cause.name.startsWith("run-") ? cause.cause.name : cause.code, message: cause.message }
    : undefined;
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
    if (parsed.positionals[0] === "show") return yield* usage("run show is no longer supported. Use niceeval show --run <run-id>.");
    if (parsed.values.help === true) {
      yield* write("stdout", `niceeval run — inspect and manage Run lifecycle

Usage:
  niceeval run list [--state <state>]... [--experiment <id-prefix>] [--limit <n>] [--invocation <invocation-id>] [--record <file>] [--json]
  niceeval run delete <run-id> [--yes] [--json]
  niceeval run recover <run-id> [--yes] [--json]
  niceeval run recover --orphaned [--yes] [--json]
  niceeval run import <record-file> [--json]
  niceeval run export --run <run-id> [--run <run-id>...] --out <file> [--json]
`);
      return 0;
    }
    const action = parsed.positionals[0];
    if (action === undefined || !["list", "delete", "recover", "import", "export"].includes(action)) {
      return yield* usage(`niceeval run expects exactly one of list, delete, recover, import, or export.
`.trimEnd());
    }
    const facts = yield* invocationFacts();
    const json = parsed.values.json === true;

    if (action === "import" || action === "export") {
      const unsupported = unsupportedOption(parsed, action === "import" ? ["json"] : ["json", "run", "out"]);
      if (unsupported !== undefined) return yield* usage(`--${unsupported} is not valid with niceeval run ${action}.`);
      if (action === "import") {
        if (parsed.positionals.length !== 2 || parsed.positionals[1]!.length === 0) {
          return yield* usage("niceeval run import requires one Record file.");
        }
        const receipt = yield* importRuns(facts.cwd, parsed.positionals[1]!).pipe(Effect.mapError((cause) => failure("import", cause)));
        if (json) yield* writeJson({ protocol: RUN_PROTOCOL, operation: "run.import", outcome: receipt.imported.length === 0 ? "already-present" : "imported", ...receipt });
        else yield* write("stdout", `Imported ${receipt.imported.length} Runs; already-present ${receipt.alreadyPresent.length}.\n`);
      } else {
        const runIds = parsed.values.run;
        const out = parsed.values.out;
        if (parsed.positionals.length !== 1 || !Array.isArray(runIds) || runIds.length === 0 ||
          runIds.some((id) => id.length === 0) || typeof out !== "string" || out.length === 0) {
          return yield* usage("niceeval run export requires --run <run-id> and --out <file>.");
        }
        const receipt = yield* exportRuns(facts.cwd, runIds, out).pipe(Effect.mapError((cause) => failure("export", cause)));
        if (json) yield* writeJson({ protocol: RUN_PROTOCOL, operation: "run.export", outcome: "exported", ...receipt });
        else yield* write("stdout", `Exported ${receipt.runIds.length} Runs to ${out}.\n`);
      }
      return 0;
    }

    if (action === "list") {
      if (parsed.positionals.length !== 1) {
        return yield* usage("niceeval run list does not accept positional selectors.");
      }
      const unsupported = unsupportedOption(parsed, ["state", "experiment", "limit", "invocation", "record", "json"]);
      if (unsupported !== undefined) return yield* usage(`--${unsupported} is not valid with niceeval run list.`);
      const states = parsed.values.state;
      const experiments = parsed.values.experiment;
      if (experiments !== undefined && (!Array.isArray(experiments) || experiments.length !== 1)) return yield* usage("--experiment accepts exactly one Experiment ID path prefix.");
      if (states !== undefined && (!Array.isArray(states) || states.length === 0 || states.some((state) => !Schema.is(RunStateSchema)(state)))) {
        return yield* usage("--state must be active, recovering, completed, interrupted, or failed.");
      }
      const limit = parsed.values.limit;
      if (limit !== undefined && (typeof limit !== "string" || !/^\d+$/u.test(limit) || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1)) {
        return yield* usage("--limit requires a positive safe integer.");
      }
      const listed = yield* rawRunHost.list({
        cwd: facts.cwd,
        ...(Array.isArray(states) ? { states: states as [RunState, ...RunState[]] } : {}),
        ...(Array.isArray(experiments) ? { experimentIdPrefix: experiments[0]! } : {}),
        ...(typeof limit === "string" ? { limit: Number(limit) } : {}),
        ...(typeof parsed.values.record === "string" ? { record: parsed.values.record } : {}),
        ...(typeof parsed.values.invocation === "string"
          ? { invocationId: parsed.values.invocation }
          : {}),
      }).pipe(Effect.mapError((cause) => failure("list", cause)));
      if (json) {
        yield* writeJson(Object.freeze({
          protocol: RUN_PROTOCOL,
          operation: "run.list",
          runs: listed.runs,
          omitted: listed.omitted,
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
        `${run.runId}  ${run.state}  ${run.experimentId}  ${run.coverage.published}/${run.coverage.expected}  ${new Date(run.startedAt).toISOString()}${run.completedAt === undefined ? "" : `  ended ${run.completedAt}`}  ${run.invocationId}${run.owner === undefined ? "" : `  owner ${run.owner.state}${run.owner.state === "unknown" ? ` (${run.owner.reason})` : ""}  observed ${run.owner.observedAt}`}`
      ).join("\n")}\n`);
      if (listed.omitted > 0) yield* write("stdout", `${listed.omitted} Runs omitted.\n`);
      if (listed.runs.some((run) => run.owner?.state === "gone")) yield* write("stdout", "Next: niceeval run recover --orphaned\n");
      return 0;
    }

    if (action === "recover" && parsed.values.orphaned === true) {
      if (parsed.positionals.length !== 1) return yield* usage("--orphaned and a positional Run ID are mutually exclusive.");
      const unsupported = unsupportedOption(parsed, ["json", "yes", "orphaned"]);
      if (unsupported !== undefined) return yield* usage(`--${unsupported} is not valid with niceeval run recover --orphaned.`);
      // This one pinned read freezes exact IDs before any confirmation. Each
      // mutation then enters the same actor as single-Run recovery.
      const listed = yield* rawRunHost.list({ cwd: facts.cwd, states: ["active", "recovering"] }).pipe(Effect.mapError((cause) => failure("list orphaned", cause)));
      const selected = listed.runs.filter((run) => run.owner?.state === "gone");
      if (json && parsed.values.yes !== true) return yield* usage("run recover --orphaned --json requires --yes; no Runs were changed.");
      if (!json && selected.length > 0 && parsed.values.yes !== true) {
        yield* write("stdout", `${selected.map((run) => `${run.runId}  ${run.state}  ${run.experimentId}`).join("\n")}\n`);
        const confirmation = yield* CliConfirmation;
        const confirmed = yield* confirmation.confirm(`Recover ${selected.length} Runs as interrupted?`).pipe(Effect.mapError((cause) => failure("confirm recovery", cause)));
        if (!confirmed) return yield* usage("Recovery cancelled. No Runs were changed. Use --yes to confirm noninteractively.");
      }
      const items: Array<RunRecoverOrphanedDocument["items"][number]> = [];
      for (const run of listed.runs) {
        if (run.owner?.state !== "gone") {
          const reason = run.owner?.state === "unknown" ? `unknown:${run.owner.reason}` : run.owner?.state ?? "unknown:identity-not-recorded";
          items.push({ runId: run.runId, outcome: "skipped", reason });
          continue;
        }
        const result = yield* Effect.result(rawRunHost.recover({ cwd: facts.cwd, runId: run.runId }));
        items.push(Result.isFailure(result)
          ? { runId: run.runId, outcome: "failed", reason: result.failure.code }
          : { runId: run.runId, outcome: "recovered" });
      }
      if (json) yield* writeJson({ protocol: RUN_PROTOCOL, operation: "run.recover-orphaned", items } satisfies RunRecoverOrphanedDocument);
      else {
        if (selected.length === 0) yield* write("stdout", "No orphaned runs\n");
        if (items.length > 0) yield* write("stdout", `${items.map((item) => `${item.runId}  ${item.outcome}${item.reason === undefined ? "" : `  ${item.reason}`}`).join("\n")}\n`);
      }
      return items.some((item) => item.outcome === "failed") ? 1 : 0;
    }

    if (parsed.positionals.length !== 2) {
      return yield* usage(`niceeval run ${action} requires one exact Run ID.`);
    }
    const runId = parsed.positionals[1]!;
    const unsupported = unsupportedOption(parsed, ["json", "yes"]);
    if (unsupported !== undefined) return yield* usage(`--${unsupported} is not valid with niceeval run ${action}.`);
    if (parsed.values.yes !== true) {
      if (action === "recover" && !json) {
        const confirmation = yield* CliConfirmation;
        const confirmed = yield* confirmation.confirm(`Recover Run ${runId} as interrupted?`).pipe(Effect.mapError((cause) => failure("confirm recovery", cause)));
        if (confirmed) {
          const receipt = yield* rawRunHost.recover({ cwd: facts.cwd, runId }).pipe(Effect.mapError((cause) => failure("recover", cause)));
          yield* write("stdout", `Recovered Run ${receipt.runId} as interrupted.\n`);
          return 0;
        }
      }
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
      const receipt = yield* rawRunHost.delete({ cwd: facts.cwd, runId }).pipe(
        Effect.mapError((cause) => failure("delete", cause)),
      );
      if (json) yield* writeJson(Object.freeze({ protocol: RUN_PROTOCOL, operation: "run.delete", ...receipt }));
      else yield* write("stdout", `Deleted Run ${receipt.runId}.
`);
      return 0;
    }
    const receipt = yield* rawRunHost.recover({ cwd: facts.cwd, runId }).pipe(
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
