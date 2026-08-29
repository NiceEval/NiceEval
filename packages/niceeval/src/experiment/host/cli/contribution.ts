import { Effect, Result } from "effect";

import {
  CliArguments,
  CliInterruption,
  CliInvocationFacts,
  CliOutput,
  type CliOptionDefinition,
} from "../../../cli/application.ts";
import { CliFeatureError, type CliCommandContribution } from "../../../cli/contribution.ts";
import { ProjectConfiguration } from "../../../cli/project-configuration.ts";
import {
  createFeedbackCoordinator,
  createHumanRenderer,
  createInputGuard,
  createJsonRenderer,
  renderHumanCommandPlan,
  resolveOutputForm,
} from "../../../runner/feedback/index.ts";
import { renderSessionListText, renderSessionShowText } from "../../../runner/session.ts";
import type { CurrentReuseReadbackSnapshot } from "../../../runner/reuse-readback.ts";
import { browsableExperimentPaths } from "../../../shared/aggregate.ts";
import {
  experimentHost,
  type ExperimentHostDebugPlan,
  type ExperimentHostRenamePlan,
  type ExperimentHostRenameReason,
  type ExperimentHostRenameResult,
  type ExperimentHostRequirements,
  type ExperimentHostSharedStateEvidence,
  type ExperimentHostTeardownEvent,
  type ExperimentHostTeardownResult,
} from "../index.ts";
import { ExperimentCliTerminal } from "./terminal.ts";

type ExperimentCliRequirements = CliArguments | CliInterruption | CliInvocationFacts | CliOutput | ExperimentCliTerminal | ProjectConfiguration | ExperimentHostRequirements;
type ExperimentCliError = CliFeatureError;

const option = (type: "string" | "boolean", summary: string, multiple?: true) => Object.freeze({
  type,
  ...(multiple === undefined ? {} : { multiple }),
  help: Object.freeze({ summary, visibility: "public" as const }),
});

const optionalTier = (
  summary: string,
  defaultValue: string,
  values: readonly string[],
  separated = false,
) => Object.freeze({
  type: "boolean" as const,
  optionalValue: Object.freeze({
    default: defaultValue,
    ...(separated ? { separated: true as const } : {}),
    values: Object.freeze([...values]),
  }),
  help: Object.freeze({ summary, visibility: "public" as const }),
});

const HELP_OPTION = Object.freeze({
  type: "boolean" as const,
  short: "h",
  help: Object.freeze({ summary: "Show command help.", visibility: "public" as const }),
});

export const CHECK_CLI_OPTIONS = Object.freeze({
  tag: option("string", "Select only Evals with this tag."),
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export const EXP_NORMAL_CLI_OPTIONS = Object.freeze({
  attempts: option("string", "Run each selected Eval this many times."),
  "max-concurrency": option("string", "Limit concurrent Attempt execution."),
  "max-build-concurrency": option("string", "Limit concurrent Sandbox build preparation."),
  "sandbox-setup-cache": option("string", "使用或绕过 Sandbox 准备缓存。"),
  timeout: option("string", "Set the per-Attempt timeout in milliseconds."),
  budget: option("string", "Set the Invocation budget in USD."),
  tag: option("string", "Select only Evals with this tag."),
  junit: option("string", "Write a required JUnit report."),
  json: option("boolean", "Write the command's machine document or event stream."),
  dry: option("boolean", "Plan without creating an Invocation."),
  rerun: optionalTier("Require failed or all targets to run again.", "failed", ["failed", "all"], true),
  "keep-sandbox": optionalTier("Keep failed or all finished Sandboxes.", "failed", ["failed", "all"]),
  "early-exit": option("boolean", "Stop remaining attempts after a passing result."),
  "no-early-exit": option("boolean", "Force all configured attempts to run."),
  record: option("string", "Use this Record root."),
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export const EXP_LIST_CLI_OPTIONS = Object.freeze({
  tag: option("string", "Select only Evals with this tag."),
  json: option("boolean", "Write the catalog machine document."),
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export const EXP_RENAME_CLI_OPTIONS = Object.freeze({
  dry: option("boolean", "Preview the explicit Experiment rename."),
  json: option("boolean", "Write the rename machine document."),
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export const EXP_TEARDOWN_CLI_OPTIONS = Object.freeze({
  teardown: option("boolean", "Run explicit Experiment teardown recovery."),
  json: option("boolean", "Write machine output where the operation supports it."),
  "recover-shared-state": option("string", "Name a shared-state key for explicit recovery."),
  "owner-token": option("string", "Provide the exact shared-state owner token."),
  "confirm-owner-terminated": option("boolean", "Confirm the recorded owner has terminated."),
  "confirm-remote-quiesced": option("boolean", "Confirm remote shared state is quiesced."),
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export const DEBUG_CLI_OPTIONS = Object.freeze({
  json: option("boolean", "Write the command-plan machine document."),
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export const ACCEPT_CLI_OPTIONS = Object.freeze({
  run: option("string", "Accept every member of one exact source Run.", true),
  dry: option("boolean", "Preview acceptance without publishing a Run."),
  record: option("string", "Use this Record root."),
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export const SESSION_CLI_OPTIONS = Object.freeze({
  all: option("boolean", "Include completed invocation status entries."),
  json: option("boolean", "Write the status machine document."),
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

/** `exp` is a command family; its composition schema is its own frozen union. */
const EXP_CLI_OPTIONS = Object.freeze({
  ...EXP_NORMAL_CLI_OPTIONS,
  ...EXP_LIST_CLI_OPTIONS,
  ...EXP_RENAME_CLI_OPTIONS,
  ...EXP_TEARDOWN_CLI_OPTIONS,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const SHARED_STATE_RECOVERY_USAGE = `  niceeval exp <selector> --teardown --recover-shared-state <key>
    --owner-token <token> --confirm-owner-terminated --confirm-remote-quiesced`;

const CHECK_HELP = `Check Experiment selection:
  niceeval check [<experiment-prefix> [<eval-prefix>...]] [--tag <tag>]

Options:
  --tag <tag>  select only Evals with this tag
  -h, --help   show this help
`;

const EXP_HELP = `Run and maintain Experiments:
  niceeval exp [<experiment-prefix> [<eval-prefix>...]] [options]
  niceeval exp list [<experiment-prefix>] [--tag <tag>] [--json]
  niceeval exp rename <old-id> <new-id> [--dry] [--json]
${SHARED_STATE_RECOVERY_USAGE}

Run options:
  --attempts <n>                 run each selected Eval this many times
  --max-concurrency <n>          limit concurrent Attempt execution
  --max-build-concurrency <n>    limit concurrent Sandbox build preparation
  --sandbox-setup-cache <use|bypass>
                                  select the Sandbox setup cache path
  --timeout <ms>                 set the per-Attempt timeout
  --budget <usd>                 set the Invocation budget
  --tag <tag>                    select only Evals with this tag
  --rerun[=failed|all]           require selected targets to run again
  --keep-sandbox[=failed|all]    retain selected finished Sandboxes
  --early-exit / --no-early-exit
  --dry                          plan without creating an Invocation
  --json                         write machine output or the Invocation event stream
  --junit <path>                 write a required JUnit report
  --record <root>                use this Record root

Recovery options:
  --teardown                     run only explicit Experiment teardown recovery
  --recover-shared-state <key>   inspect or recover this immutable shared-state owner
  --owner-token <token>          provide the exact owner token shown by inspection
  --confirm-owner-terminated     confirm the recorded owner has terminated
  --confirm-remote-quiesced      confirm remote shared state is quiesced
  -h, --help                     show this help
`;

const DEBUG_HELP = `Inspect one Experiment lifecycle plan:
  niceeval debug <experiment-selector> <eval-selector> [--json]

Options:
  --json       write the command-plan machine document
  -h, --help  show this help
`;

const ACCEPT_HELP = `Accept exact historical Attempt locators:
  niceeval accept @<locator>... [--record <root>]
  niceeval accept --run <exact-run-id> [--dry] [--record <root>]

Options:
  --run <run-id>   accept one exact source Run
  --dry            preview a whole-Run acceptance without writing
  --record <root>  use this Record root
  -h, --help       show this help
`;

const SESSION_HELP = `Inspect project-local ephemeral Invocation status:
  niceeval session list [--all] [<experiment-prefix>]
  niceeval session show <invocation-id>

Options:
  --all        include completed Invocation status entries
  --json       write the status machine document
  -h, --help  show this help
`;

const EXP_COMMAND_SUMMARY = `list, plan, run, rename, or recover Experiments
      explicit sharedState recovery:
${SHARED_STATE_RECOVERY_USAGE}`;

function failure(
  operation: string,
  cause: unknown,
  exitCode = 1,
  display?: string,
): ExperimentCliError {
  return new CliFeatureError({
    feature: "experiments",
    operation,
    cause,
    exitCode,
    ...(display === undefined ? {} : { display }),
  });
}

function write(channel: "stdout" | "stderr", text: string): Effect.Effect<void, ExperimentCliError, CliOutput> {
  return Effect.flatMap(CliOutput, (output) => channel === "stdout" ? output.writeStdout(text) : output.writeStderr(text)).pipe(
    Effect.mapError((cause) => failure(`write ${channel}`, cause)),
  );
}

function numberFlag(value: string | boolean | string[] | undefined, name: string, positive = false): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9]+(?:\.[0-9]+)?$/u.test(value)) throw new Error(`${name} requires a number.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (positive && (!Number.isInteger(parsed) || parsed === 0))) {
    throw new Error(positive ? `${name} requires a positive integer.` : `${name} requires a non-negative finite number.`);
  }
  return parsed;
}

function enumFlag(value: string | boolean | string[] | undefined, name: string, values: readonly string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${name} accepts ${values.join(" or ")}.`);
  return value;
}

function jsonDocument(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function catalogText(catalog: { readonly experiments: readonly { readonly id: string; readonly description?: string; readonly agent: string; readonly model?: string; readonly attempts: number; readonly evalIds: readonly string[]; readonly labels: Readonly<Record<string, string | number>> }[] }): string {
  return catalog.experiments.map((experiment) => [
    experiment.id,
    experiment.description ?? "—",
    experiment.agent,
    experiment.model ?? "—",
    `attempts=${experiment.attempts}`,
    `evals=${experiment.evalIds.length}`,
    `labels=${JSON.stringify(experiment.labels)}`,
  ].join("\t")).join("\n") + (catalog.experiments.length === 0 ? "" : "\n");
}

function catalogJson(catalog: { readonly experiments: readonly { readonly id: string; readonly description?: string; readonly agent: string; readonly model?: string; readonly attempts: number; readonly evalIds: readonly string[]; readonly labels: Readonly<Record<string, string | number>> }[] }): string {
  return jsonDocument({
    format: "niceeval.experiments",
    schemaVersion: 1,
    experiments: catalog.experiments.map((experiment) => ({
      experimentId: experiment.id,
      ...(experiment.description === undefined ? {} : { description: experiment.description }),
      agent: experiment.agent,
      ...(experiment.model === undefined ? {} : { model: experiment.model }),
      attempts: experiment.attempts,
      evalCount: experiment.evalIds.length,
      labels: experiment.labels,
      selectedEvalIds: experiment.evalIds,
    })),
  });
}

function checkText(result: { readonly status: string; readonly pairCount?: number }): string {
  return result.status === "linked"
    ? `Sandbox layers linked: ${result.pairCount} pairs.\n`
    : `Experiment selection: ${result.status}.\n`;
}

function selectionProblemText(result: { readonly status: string; readonly selector?: string; readonly candidates?: readonly string[]; readonly experimentIds?: readonly string[] }): string {
  if (result.status === "experiment-no-match") {
    return `No experiment matched: ${result.selector ?? "(all)"}. Available paths: ${browsableExperimentPaths(result.candidates ?? []).join(", ") || "(none)"}.
Run \`niceeval exp <path> --dry\` to preview a plan.
`;
  }
  if (result.status === "eval-no-match") {
    return `No eval matched prefix: ${result.selector ?? ""} in experiments selected by ${(result.experimentIds ?? []).join(", ") || "(all)"}.
Positional args after the first select eval id prefixes. To run another experiment,
run it as its own command: niceeval exp ${result.selector ?? ""}
`;
  }
  return `No evals selected: ${(result.experimentIds ?? []).join(", ") || "(all)"} matched 0 evals. Available eval prefixes: ${browsableExperimentPaths(result.candidates ?? result.experimentIds ?? []).join(", ") || "(none)"}.
Run \`niceeval exp ${(result.experimentIds ?? []).join(", ") || "(all)"} --dry\` to see what it covers, or drop the eval filter to run every eval selected by those experiments.
`;
}

function acceptText(results: readonly { readonly runId: string; readonly sourceLocator: string; readonly locator: string; readonly fingerprint: string }[]): string {
  return results.map((result) =>
    `Accepted source Attempt ${result.sourceLocator} into new Run ${result.runId}. Result locator remains ${result.locator}. Current fingerprint: ${result.fingerprint}
`
  ).join("");
}

function acceptRunPlanText(plan: { readonly sourceRunId: string; readonly members: readonly { readonly locator: string; readonly evalId: string; readonly attempt: number }[] }): string {
  const members = plan.members.map((member) => `  ${member.evalId} #${String(member.attempt)} ${member.locator} eligible\n`).join("");
  return `Accept source Run ${plan.sourceRunId}\n${members}\n${String(plan.members.length)} members eligible\nApply: niceeval accept --run ${plan.sourceRunId}\n`;
}

function acceptedRunText(sourceRunId: string, results: readonly { readonly runId: string; readonly sourceLocator: string; readonly locator: string; readonly fingerprint: string }[]): string {
  const targetRunId = results[0]?.runId ?? "unknown";
  return `Accepted source Run ${sourceRunId} into new Run ${targetRunId}. ${String(results.length)} reference members published.\n${acceptText(results)}`;
}

function sharedStateEvidenceText(evidence: ExperimentHostSharedStateEvidence): string {
  return `sharedState recovery target:
  key: ${evidence.key}
  experiment: ${evidence.experimentId}
  owner token: ${evidence.ownerToken}
  host: ${evidence.host}
  PID: ${evidence.pid}
  process identity: ${evidence.processIdentity}
  heartbeat: ${evidence.heartbeatAt}
`;
}

function teardownInspectionEvidence(
  inspection: ExperimentHostTeardownResult,
): ExperimentHostSharedStateEvidence | undefined {
  return "evidence" in inspection ? inspection.evidence : undefined;
}

function teardownInspectionProblemText(inspection: ExperimentHostTeardownResult): string | undefined {
  switch (inspection.status) {
    case "no-evidence":
      return `No recoverable sharedState ownership evidence exists for ${JSON.stringify(inspection.key)}.\n`;
    case "selection-not-unique":
      return "sharedState recovery requires an experiment selector that resolves to exactly one Experiment.\n";
    case "experiment-mismatch":
      return `sharedState key ${JSON.stringify(inspection.evidence.key)} belongs to experiment ${inspection.evidence.experimentId}, not ${inspection.selectedExperimentId}; refusing recovery.\n`;
    case "teardown-required":
      return `error: sharedState recovery requires the selected Experiment ${inspection.experimentId} to declare teardown as a function. The active generation was left unchanged.
`;
    case "recovery-confirmation-required":
      return `sharedState recovery requires \`--teardown --recover-shared-state <key> --owner-token <token> --confirm-owner-terminated --confirm-remote-quiesced\`.
`;
    default:
      return undefined;
  }
}

function teardownFailure(operation: string, cause: unknown, recoveryKey?: string): ExperimentCliError {
  const code = typeof cause === "object" && cause !== null && typeof Reflect.get(cause, "code") === "string"
    ? String(Reflect.get(cause, "code"))
    : undefined;
  const message = cause instanceof Error ? cause.message : String(cause);
  const display = code === "shared-state-recovery-registration-failed" && recoveryKey !== undefined
    ? `error: sharedState recovery for ${recoveryKey} could not clear the exact interrupted teardown registration: ${message}. The recovery generation remains closed.
`
    : code === "shared-state-recovery-already-released-registration-failed" && recoveryKey !== undefined
      ? `error: sharedState key ${recoveryKey} was already released, but NiceEval could not clear the exact stale teardown registration: ${message}. It did not rerun teardown.
`
      : code === "shared-state-recovery-completion-failed"
        ? `sharedState recovery could not release its exact owner token: ${message}\n`
        : recoveryKey === undefined
          ? undefined
          : `sharedState recovery refused: ${message}\n`;
  return failure(operation, cause, 1, display);
}

function invocationText(result: { readonly receipt: { readonly invocationId: string; readonly createdRunIds: readonly string[]; readonly completion: string }; readonly summary: { readonly passed: number; readonly failed: number; readonly skipped: number; readonly errored: number } }): string {
  return `Invocation ${result.receipt.invocationId} · ${result.receipt.completion}\nRuns: ${result.receipt.createdRunIds.join(", ") || "none"}\nResults: ${result.summary.passed} passed · ${result.summary.failed} failed · ${result.summary.errored} errored · ${result.summary.skipped} skipped\n`;
}

function dryRows(plan: { readonly slots: readonly { readonly state: "reuse" | "gap"; readonly target: { readonly runId: string; readonly slotId: string; readonly experimentId: string; readonly evalId: string; readonly evalGroupId?: string; readonly evalGroupIndex?: number; readonly attempt: number }; readonly comparisons: readonly unknown[]; readonly reason?: string; readonly scope?: string }[]; readonly readbacks: readonly CurrentReuseReadbackSnapshot[]; readonly lockedPairs: readonly string[] }) {
  type ProjectedSlot = {
    readonly runId: string;
    readonly slotId: string;
    readonly experimentId: string;
    readonly evalId: string;
    readonly attempt: number;
    readonly state: "reused" | "gap";
    readonly comparisons: readonly unknown[];
    readonly reason?: string;
    readonly scope?: string;
  };
  const rows = new Map<string, { experimentId: string; evalId: string; evalGroupId?: string; evalGroupIndex?: number; slots: ProjectedSlot[]; readbacks: CurrentReuseReadbackSnapshot[]; locked?: true }>();
  for (const slot of plan.slots) {
    const key = JSON.stringify([slot.target.experimentId, slot.target.evalId]);
    const row = rows.get(key) ?? {
      experimentId: slot.target.experimentId,
      evalId: slot.target.evalId,
      ...(slot.target.evalGroupId === undefined ? {} : { evalGroupId: slot.target.evalGroupId, evalGroupIndex: slot.target.evalGroupIndex }),
      slots: [],
      readbacks: [],
    };
    row.slots.push({
      ...slot.target,
      state: slot.state === "reuse" ? "reused" : "gap",
      comparisons: slot.comparisons,
      ...(slot.state === "gap" ? { reason: slot.reason, scope: slot.scope } : {}),
    });
    if (plan.lockedPairs.includes(key)) row.locked = true;
    rows.set(key, row);
  }
  for (const readback of plan.readbacks) {
    const key = JSON.stringify([readback.target.experimentId, readback.target.evalId]);
    const row = rows.get(key) ?? { experimentId: readback.target.experimentId, evalId: readback.target.evalId, slots: [], readbacks: [] };
    row.readbacks.push(readback);
    if (plan.lockedPairs.includes(key)) row.locked = true;
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => ({
    ...row,
    slots: [...row.slots].sort((left, right) => left.attempt - right.attempt),
    readbacks: [...row.readbacks].sort((left, right) => left.target.attempt - right.target.attempt),
  })).sort((left, right) =>
    left.experimentId.localeCompare(right.experimentId) || left.evalId.localeCompare(right.evalId));
}

function dryText(plan: Parameters<typeof dryRows>[0], shape: { readonly totalAttempts: number; readonly evals: number; readonly configurations: number; readonly attempts: number }, pluginCount: number): string {
  const rows = dryRows(plan);
  const reused = plan.slots.filter((slot) => slot.state === "reuse").length;
  const lines = [
    `plan: ${shape.totalAttempts} attempts · ${shape.evals} evals × ${shape.configurations} configs · runs ${shape.attempts}`,
    ...(reused === 0 ? [] : [`reuse: ${reused}/${shape.totalAttempts} exact current Record attempts`]),
    `plugins: ${pluginCount} lifecycle occurrences`,
  ];
  for (const row of rows) {
    const slots = row.slots;
    const reusedAttempts = slots.filter((slot) => slot.state === "reused").map((slot) => slot.attempt);
    const gaps = slots.filter((slot) => slot.state === "gap");
    const parts = [
      ...(row.locked ? ["locked"] : []),
      ...(reusedAttempts.length === 0 ? [] : [`reused ${reusedAttempts.join(",")}`]),
      ...gaps.map((slot) => `gap ${slot.attempt}:${slot.reason ?? "unknown"}`),
    ];
    lines.push(`${row.experimentId}  ${row.evalId}  ${parts.join(" · ") || "no slots"}`);
    const hasIdentityGap = gaps.some((slot) => slot.reason === "identity-mismatch");
    for (const readback of row.readbacks) {
      const verdict = readback.state === "reused"
        ? readback.verdict
        : readback.verdict.state === "available"
          ? readback.verdict.value
          : readback.verdict.state;
      lines.push(`  source ${readback.source.locator} · ${readback.state} · verdict ${verdict}`);
      if (hasIdentityGap && readback.state === "prior") lines.push(`  accept: niceeval accept ${readback.source.locator}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function dryJson(plan: Parameters<typeof dryRows>[0], shape: { readonly totalAttempts: number; readonly evals: number; readonly configurations: number; readonly attempts: number }, plugins: readonly unknown[]): string {
  return jsonDocument({
    format: "niceeval.current-reuse-plan/v1",
    schemaVersion: 1,
    total: shape.totalAttempts,
    evals: shape.evals,
    configs: shape.configurations,
    attempts: shape.attempts,
    reused: plan.slots.filter((slot) => slot.state === "reuse").length,
    matrix: dryRows(plan),
    plugins,
  });
}

function renameText(result: ExperimentHostRenamePlan | ExperimentHostRenameResult): string {
  if (result.status === "done") {
    const lines = [
      `exp rename done: rebound ${result.migrated.length} terminal results from ${result.oldId} to ${result.newId}.
`,
      `  new snapshot: ${result.snapshotPath}
`,
      ...result.migrated.map((entry) => `    ${entry.evalId}  ${entry.sourceLocator} -> ${entry.locator}
`),
    ];
    return `${lines.join("\n")}\n`;
  }
  if (result.status === "rejected") {
    const reason = (() => {
      switch (result.reason) {
        case "source-empty":
          return `error: ${result.oldId} has no readable terminal history to migrate to ${result.newId}.\n  fix: restore and verify ${result.oldId}'s real results before retrying; with no old results, run \`niceeval exp ${result.newId}\` and do not rename.\n       exp rename does not move experiment source, nor delete or rewrite the old result tree.\n`;
        case "target-not-found":
          return `error: new id "${result.newId}" is not discovered under this project's experiments/.\n  fix: create or rename the experiment in experiments/ first (e.g. \`git mv experiments/${result.oldId}.ts experiments/${result.newId}.ts\`), then rerun.\n`;
        case "target-has-results":
          return `error: ${result.newId} already has terminal results for these evals; rename never overwrites existing results.\n  fix: keep the target results, or explicitly clean the target history and re-preview; the command deletes nothing itself.\n`;
        case "source-unreadable":
          return `error: the Record for ${result.oldId} is unreadable; cannot migrate to ${result.newId}.\n  fix: view this record with a niceeval version that reads its schemaVersion.\n`;
        case "artifact-unavailable":
          return `error: source evidence cannot be preserved (${result.evalId ?? ""}); nothing will be written.\n  fix: make the artifact reference and source locator readable, or rerun this eval.\n`;
        case "nothing-to-migrate":
          return `error: nothing to migrate under ${result.oldId}: no terminal passed/failed still selected by ${result.newId}, or all excluded.\n  fix: check that ${result.newId}'s evals selector covers the old experiment's results.\n`;
      }
    })();
    const lines = [reason];
    if ((result.conflictingEvals?.length ?? 0) > 0) {
      lines.push(`  conflicting evals: ${result.conflictingEvals!.join(", ")}
`);
    }
    return `${lines.join("\n")}\n`;
  }
  const lines = [`exp rename preview: ${result.oldId} -> ${result.newId}
`];
  if (result.blocked !== undefined) {
    lines.push(`  blocked (nothing will be written): ${result.blocked.reason}
`);
    lines.push(...(result.blocked.conflictingEvals ?? []).map((evalId) => `  ${evalId}`));
    if (result.blocked.detail !== undefined) lines.push(`  ${result.blocked.detail}`);
  }
  if (result.migrations.length > 0) {
    lines.push(`  ${result.migrations.length} terminal results will migrate:
`);
    lines.push(...result.migrations.map((entry) => `    ${entry.evalId}  ${entry.sourceLocator} -> ${result.newId}
`));
  }
  if (result.excluded.length > 0) {
    lines.push(`  ${result.excluded.length} excluded (not migrated, does not block):
`);
    lines.push(...result.excluded.map((entry) => `    ${entry.evalId}  ${entry.reason}
`));
  }
  return `${lines.join("\n")}\n`;
}

function renameJson(result: ExperimentHostRenamePlan | ExperimentHostRenameResult): string {
  return jsonDocument({ format: "niceeval.experimentRename", schemaVersion: 1, ...result });
}

function parsed(argv: readonly string[], options: Readonly<Record<string, CliOptionDefinition>>) {
  return Effect.flatMap(CliArguments, (argumentsService) => Effect.try({
    try: () => argumentsService.parse(argv, options),
    catch: (cause) => failure("parse command", cause),
  }));
}

function factsAndConfig() {
  return Effect.gen(function* () {
    const facts = yield* CliInvocationFacts;
    const invocation = yield* facts.facts.pipe(Effect.mapError((cause) => failure("read invocation facts", cause)));
    const project = yield* ProjectConfiguration;
    const config = yield* project.load(invocation.cwd).pipe(Effect.mapError((cause) => failure("load config", cause)));
    return Object.freeze({ invocation, config });
  });
}

function selection(positionals: readonly string[]) {
  const [experimentSelector, ...evalSelectors] = positionals;
  return Object.freeze({
    ...(experimentSelector === undefined ? {} : { experimentSelector }),
    ...(evalSelectors.length === 0 ? {} : { evalSelectors: Object.freeze(evalSelectors) }),
  });
}

function overrides(values: Record<string, string | boolean | string[] | undefined>) {
  const attempts = numberFlag(values.attempts, "--attempts", true);
  const timeoutMs = numberFlag(values.timeout, "--timeout");
  const budget = numberFlag(values.budget, "--budget");
  const maxConcurrency = numberFlag(values["max-concurrency"], "--max-concurrency", true);
  const maxBuildConcurrency = numberFlag(values["max-build-concurrency"], "--max-build-concurrency", true);
  const rerun = enumFlag(values.rerun, "--rerun", ["failed", "all"]);
  const keepSandbox = enumFlag(values["keep-sandbox"], "--keep-sandbox", ["failed", "all"]);
  const sandboxSetupCache = enumFlag(
    values["sandbox-setup-cache"],
    "--sandbox-setup-cache",
    ["use", "bypass"],
  );
  return Object.freeze({
    ...(attempts === undefined ? {} : { attempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(budget === undefined ? {} : { budget }),
    ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
    ...(maxBuildConcurrency === undefined ? {} : { maxBuildConcurrency }),
    ...(rerun === undefined ? {} : { rerun: rerun as "failed" | "all" }),
    ...(keepSandbox === undefined ? {} : { keepSandbox: keepSandbox as "failed" | "all" }),
    ...(sandboxSetupCache === undefined
      ? {}
      : { sandboxSetupCache: sandboxSetupCache as "use" | "bypass" }),
    ...(values["no-early-exit"] === true ? { earlyExit: false } : values["early-exit"] === true ? { earlyExit: true } : {}),
  });
}

const checkCommand: CliCommandContribution<ExperimentCliRequirements, ExperimentCliError> = Object.freeze({
  name: "check",
  summary: "check Experiment and Sandbox selection",
  options: CHECK_CLI_OPTIONS,
  run: (argv: readonly string[]) => Effect.gen(function* () {
    const input = yield* parsed(argv, CHECK_CLI_OPTIONS);
    if (input.values.help === true) return yield* write("stdout", CHECK_HELP).pipe(Effect.as(0));
    const { invocation, config } = yield* factsAndConfig();
    const result = yield* experimentHost.check({ cwd: invocation.cwd, config, ...selection(input.positionals) }).pipe(
      Effect.mapError((cause) => failure("check", cause)),
    );
    if (result.status !== "linked") {
      yield* write("stderr", selectionProblemText(result));
      return 1;
    }
    yield* write("stdout", checkText(result));
    return 0;
  }),
});

const expCommand: CliCommandContribution<ExperimentCliRequirements, ExperimentCliError> = Object.freeze({
  name: "exp",
  summary: EXP_COMMAND_SUMMARY,
  options: EXP_CLI_OPTIONS,
  run: (argv: readonly string[]) => Effect.gen(function* () {
    // First parse only determines the family branch. The second, branch-owned
    // schema rejects irrelevant flags before facts, config, or .env are read.
    const preliminary = yield* parsed(argv, EXP_CLI_OPTIONS);
    const teardownMode = preliminary.values.teardown === true;
    const preliminaryVerb = preliminary.positionals[0];
    if (preliminaryVerb === "help" && preliminary.positionals.length === 1) {
      return yield* write("stdout", EXP_HELP).pipe(Effect.as(0));
    }
    const input = yield* parsed(
      argv,
      teardownMode
        ? EXP_TEARDOWN_CLI_OPTIONS
        : preliminaryVerb === "list"
          ? EXP_LIST_CLI_OPTIONS
          : preliminaryVerb === "rename"
            ? EXP_RENAME_CLI_OPTIONS
            : EXP_NORMAL_CLI_OPTIONS,
    );
    if (input.values.help === true) return yield* write("stdout", EXP_HELP).pipe(Effect.as(0));
    const [verb, ...rest] = input.positionals;
    const facts = yield* CliInvocationFacts;
    const invocation = yield* facts.facts.pipe(Effect.mapError((cause) => failure("read invocation facts", cause)));
    if (teardownMode) {
      const project = yield* ProjectConfiguration;
      yield* project.load(invocation.cwd).pipe(Effect.mapError((cause) => failure("load config", cause)));
      if (typeof input.values["recover-shared-state"] === "string" && input.values.json === true) {
        yield* write("stderr", `error: explicit sharedState recovery does not support --json. Retry without --json; this recovery flow has a human-only interface.
`);
        return 1;
      }
      if (input.positionals.length > 1) {
        return yield* write("stderr", "niceeval exp --teardown accepts at most one Experiment selector.\n").pipe(Effect.as(1));
      }
      const selector = input.positionals[0];
      const recoveryKey = typeof input.values["recover-shared-state"] === "string"
        ? input.values["recover-shared-state"]
        : undefined;
      const inspection = yield* experimentHost.teardown.inspect({
        cwd: invocation.cwd,
        currentHost: invocation.hostname,
        ...(selector === undefined ? {} : { experimentSelector: selector }),
        ...(recoveryKey === undefined ? {} : { recoveryKey }),
      }).pipe(Effect.mapError((cause) => failure("inspect teardown", cause)));
      if (inspection.status === "experiment-no-match" || inspection.status === "eval-no-match" || inspection.status === "empty-selection") {
        yield* write("stderr", selectionProblemText(inspection));
        return 1;
      }
      const evidence = teardownInspectionEvidence(inspection);
      if (evidence !== undefined) yield* write("stderr", sharedStateEvidenceText(evidence));
      if (
        inspection.status === "no-evidence" ||
        inspection.status === "selection-not-unique" ||
        inspection.status === "experiment-mismatch"
      ) {
        yield* write("stderr", teardownInspectionProblemText(inspection)!);
        return 1;
      }
      // Recovery evidence is deliberately available before confirmations.  This
      // preserves the after-kill operator flow while keeping the normal
      // teardown path free of Record migration and Invocation construction.
      if (recoveryKey !== undefined && (
        typeof input.values["owner-token"] !== "string" ||
        input.values["confirm-owner-terminated"] !== true ||
        input.values["confirm-remote-quiesced"] !== true
      )) {
        yield* write("stderr", `sharedState recovery requires \`--teardown --recover-shared-state <key> --owner-token <token> --confirm-owner-terminated --confirm-remote-quiesced\`.
`);
        return 1;
      }
      if (inspection.status === "teardown-required") {
        yield* write("stderr", teardownInspectionProblemText(inspection)!);
        return 1;
      }
      const interruption = yield* CliInterruption;
      const output = yield* CliOutput;
      const result = yield* experimentHost.teardown.run({
        cwd: invocation.cwd,
        currentHost: invocation.hostname,
        ...(selector === undefined ? {} : { experimentSelector: selector }),
        ...(recoveryKey === undefined ? {} : { recoveryKey }),
        ...(typeof input.values["owner-token"] === "string" ? { ownerToken: input.values["owner-token"] } : {}),
        ...(input.values["confirm-owner-terminated"] === true ? { confirmOwnerTerminated: true } : {}),
        ...(input.values["confirm-remote-quiesced"] === true ? { confirmRemoteQuiesced: true } : {}),
        signal: interruption.invocationSignal,
        observer: Object.freeze({
          observe(event: ExperimentHostTeardownEvent) {
            if (event.type === "diagnostic") output.writeStderrSync(`${event.message}\n`);
          },
        }),
      }).pipe(Effect.mapError((cause) => teardownFailure("run teardown", cause, recoveryKey)));
      if (result.status === "completed") {
        for (const experiment of result.experiments) {
          if (experiment.outcome === "succeeded") {
            yield* write("stderr", `teardown done: ${experiment.experimentId}
`);
          } else if (experiment.outcome === "failed") {
            yield* write("stderr", `teardown failed: ${experiment.experimentId}: ${experiment.error ?? "unknown"}
`);
          }
        }
      } else if (result.status === "recovered" || result.status === "already-released") {
        if (result.status === "recovered") {
          yield* write("stderr", `teardown done: ${result.experimentId}
`);
        }
        if (result.status === "already-released") yield* write("stderr", `sharedState key ${result.key} was already released after its cleanup; its immutable recovery generation is already complete.
`);
        yield* write("stderr", `explicitly recovered sharedState key ${result.key} for experiment ${result.experimentId}.
`);
      } else if (result.status === "recovery-teardown-failed") {
        yield* write("stderr", `teardown failed: ${result.evidence.experimentId}: ${result.error}
`);
      } else {
        const changedEvidence = teardownInspectionEvidence(result);
        if (changedEvidence !== undefined) yield* write("stderr", sharedStateEvidenceText(changedEvidence));
        const problem = teardownInspectionProblemText(result);
        if (problem !== undefined) yield* write("stderr", problem);
      }
      return result.status === "completed" || result.status === "recovered" || result.status === "already-released" ? 0 : 1;
    }
    if (verb === "list") {
      if (rest.length > 1) return yield* write("stderr", "niceeval exp list accepts at most one experiment prefix.\n").pipe(Effect.as(1));
      const project = yield* ProjectConfiguration;
      yield* project.load(invocation.cwd).pipe(Effect.mapError((cause) => failure("load config", cause)));
      const result = yield* experimentHost.catalog({ cwd: invocation.cwd, ...selection(rest), ...(typeof input.values.tag === "string" ? { tag: input.values.tag } : {}) }).pipe(
        Effect.mapError((cause) => failure("list", cause)),
      );
      if (result.experiments.length === 0 && rest[0] !== undefined) {
        yield* write("stderr", `No experiment matched: ${rest[0]}. Available paths: ${browsableExperimentPaths(result.experimentIds).join(", ") || "(none)"}.
Run \`niceeval exp <path> --dry\` to preview a plan.
`);
        return 1;
      }
      yield* write("stdout", input.values.json === true ? catalogJson(result) : catalogText(result));
      return 0;
    }
    if (verb === "rename") {
      const [oldId, newId] = rest;
      if (oldId === undefined || newId === undefined || rest.length !== 2) return yield* write("stderr", "usage: niceeval exp rename <old-id> <new-id>\n").pipe(Effect.as(1));
      const renameInput = { cwd: invocation.cwd, oldId, newId };
      const result = input.values.dry === true
        ? yield* experimentHost.rename.plan(renameInput).pipe(Effect.mapError((cause) => failure("plan rename", cause)))
        : yield* experimentHost.rename.apply(renameInput).pipe(Effect.mapError((cause) => failure("rename", cause)));
      yield* write("stdout", input.values.json === true ? renameJson(result) : renameText(result));
      return result.status === "rejected" || (result.status === "plan" && result.blocked !== undefined) ? 1 : 0;
    }
    const project = yield* ProjectConfiguration;
    const config = yield* project.load(invocation.cwd).pipe(Effect.mapError((cause) => failure("load config", cause)));
    const plan = yield* experimentHost.invocation.plan({
      cwd: invocation.cwd,
      config,
      ...selection(input.positionals),
      ...(typeof input.values.tag === "string" ? { tag: input.values.tag } : {}),
      ...(typeof input.values.record === "string" ? { recordRoot: input.values.record } : {}),
      overrides: overrides(input.values),
      preview: input.values.dry === true,
    }).pipe(Effect.mapError((cause) => failure("plan invocation", cause)));
    if (plan.status !== "ready") {
      yield* write("stderr", selectionProblemText(plan));
      return 1;
    }
    if (input.values.dry === true) {
      if (plan.dry === undefined) return yield* Effect.fail(failure("preview invocation", new Error("Experiment Host did not return the requested dry plan.")));
      yield* write("stdout", input.values.json === true
        ? dryJson(plan.dry, plan.shape, plan.pluginAudit.occurrences)
        : dryText(plan.dry, plan.shape, plan.pluginAudit.occurrences.length));
      return 0;
    }
    const interruption = yield* CliInterruption;
    if (!(yield* Effect.sync(interruption.enterGracefulDispatch))) return yield* Effect.interrupt;
    const terminal = yield* ExperimentCliTerminal;
    const profile = resolveOutputForm({
      json: input.values.json === true,
      isTTY: invocation.stderr.isTTY,
    });
    const renderer = profile === "human"
      ? createHumanRenderer({
          io: terminal.feedback,
          command: ["niceeval", "exp", ...input.positionals].join(" ").trim(),
        })
      : createJsonRenderer({ io: terminal.feedback });
    const coordinator = createFeedbackCoordinator({
      profile,
      renderer,
      io: terminal.feedback,
      // Experiment Host installs one lossless multiplexing sink for feedback
      // and the project-local Session observer.
      activateSink: false,
    });
    const outcome = yield* Effect.result(Effect.scoped(Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => createInputGuard({
          stdin: terminal.stdin,
          stderrIsTTY: terminal.feedback.stderr.isTTY,
          coordinator,
          onInterrupt: interruption.requestInterrupt,
        })),
        (guard) => Effect.sync(guard.stop),
      );
      return yield* experimentHost.invocation.run({
        plan: plan.plan,
        signal: interruption.invocationSignal,
        feedback: Object.freeze({ coordinator }),
        ...(typeof input.values.junit === "string" ? { junitPath: input.values.junit } : {}),
      });
    })));
    if (Result.isFailure(outcome)) {
      if (outcome.failure.code === "runner-record-assertions-invalid") {
        yield* write("stderr", `error: ${outcome.failure.message}\n`);
        return 1;
      }
      return yield* Effect.fail(failure("run invocation", outcome.failure));
    }
    const result = outcome.success;
    if (result.exitCode === undefined) {
      return yield* Effect.fail(failure(
        "finish invocation feedback",
        new Error("Experiment Host returned without the requested presentation exit fold."),
      ));
    }
    return result.exitCode;
  }),
});

const debugCommand: CliCommandContribution<ExperimentCliRequirements, ExperimentCliError> = Object.freeze({
  name: "debug",
  summary: "show one Experiment lifecycle plan",
  options: DEBUG_CLI_OPTIONS,
  run: (argv: readonly string[]) => Effect.gen(function* () {
    const input = yield* parsed(argv, DEBUG_CLI_OPTIONS);
    if (input.values.help === true) return yield* write("stdout", DEBUG_HELP).pipe(Effect.as(0));
    const [experimentSelector, evalSelector] = input.positionals;
    if (experimentSelector === undefined || evalSelector === undefined || input.positionals.length !== 2) {
      return yield* write("stderr", `error: niceeval debug expects exactly one Experiment selector and one Eval selector
  fix: niceeval debug <experiment> <eval> [--json]
`).pipe(Effect.as(1));
    }
    const { invocation, config } = yield* factsAndConfig();
    const result = yield* experimentHost.debug({ cwd: invocation.cwd, config, experimentSelector, evalSelector }).pipe(
      Effect.mapError((cause) => failure("debug", cause)),
    );
    switch (result.status) {
      case "experiment-no-match":
        yield* write("stderr", `error: Experiment selector "${result.selector}" matched nothing
  exact candidates: ${result.candidates.join(", ") || "(none)"}
`);
        return 1;
      case "experiment-ambiguous":
        yield* write("stderr", `error: Experiment selector "${result.selector}" is ambiguous
  exact candidates: ${result.candidates.join(", ")}
`);
        return 1;
      case "eval-no-match":
        yield* write("stderr", `error: Eval selector "${result.selector}" matched nothing in Experiment "${result.experimentId}"
  exact candidates: ${result.candidates.join(", ") || "(none)"}
`);
        return 1;
      case "eval-ambiguous":
        yield* write("stderr", `error: Eval selector "${result.selector}" is ambiguous in Experiment "${result.experimentId}"
  exact candidates: ${result.candidates.join(", ")}
`);
        return 1;
      case "planned":
        yield* write("stdout", input.values.json === true
          ? jsonDocument({
              format: "niceeval.debug-plan/v1",
              schemaVersion: 1,
              experimentId: result.experimentId,
              evalId: result.evalId,
              commandPlan: result.commandPlan,
            })
          : renderHumanCommandPlan(result.commandPlan, {
              isTTY: invocation.stdout.isTTY,
              noColor: invocation.noColor,
              width: invocation.stdout.columns,
            }));
        return 0;
    }
  }),
});

const acceptCommand: CliCommandContribution<ExperimentCliRequirements, ExperimentCliError> = Object.freeze({
  name: "accept",
  summary: "accept exact historical Attempt locators",
  options: ACCEPT_CLI_OPTIONS,
  run: (argv: readonly string[]) => Effect.gen(function* () {
    const input = yield* parsed(argv, ACCEPT_CLI_OPTIONS);
    if (input.values.help === true) return yield* write("stdout", ACCEPT_HELP).pipe(Effect.as(0));
    const sourceRunIds = Array.isArray(input.values.run) ? input.values.run : [];
    const sourceRunId = sourceRunIds.length === 1 ? sourceRunIds[0] : undefined;
    if (sourceRunIds.length > 1) return yield* write("stderr", "niceeval accept --run requires one exact Run ID.\n").pipe(Effect.as(1));
    if ((sourceRunId === undefined && input.positionals.length === 0) || (sourceRunId !== undefined && input.positionals.length > 0) || (input.values.dry === true && sourceRunId === undefined)) {
      return yield* write("stderr", "usage: niceeval accept @<locator>... | niceeval accept --run <exact-run-id> [--dry]\n").pipe(Effect.as(1));
    }
    const { invocation, config } = yield* factsAndConfig();
    if (sourceRunId !== undefined) {
      if (input.values.dry === true) {
        const plan = yield* experimentHost.acceptRun.plan({ cwd: invocation.cwd, config, runId: sourceRunId, ...(typeof input.values.record === "string" ? { recordRoot: input.values.record } : {}) }).pipe(
          Effect.mapError((cause) => failure("accept", cause, 1, `error: could not accept result: ${cause.message}
`)),
        );
        yield* write("stdout", acceptRunPlanText(plan));
        return 0;
      }
      const accepted = yield* experimentHost.acceptRun.apply({ cwd: invocation.cwd, config, runId: sourceRunId, ...(typeof input.values.record === "string" ? { recordRoot: input.values.record } : {}) }).pipe(
        Effect.mapError((cause) => failure("accept", cause, 1, `error: could not accept result: ${cause.message}
`)),
      );
      yield* write("stdout", acceptedRunText(sourceRunId, accepted));
      return 0;
    }
    const result = yield* experimentHost.accept({ cwd: invocation.cwd, config, locators: Object.freeze(input.positionals), ...(typeof input.values.record === "string" ? { recordRoot: input.values.record } : {}) }).pipe(
      Effect.mapError((cause) => failure("accept", cause, 1, `error: could not accept result: ${cause.message}
`)),
    );
    yield* write("stdout", acceptText(result));
    return 0;
  }),
});

const sessionCommand: CliCommandContribution<ExperimentCliRequirements, ExperimentCliError> = Object.freeze({
  name: "session",
  summary: "inspect project-local ephemeral Invocation status",
  options: SESSION_CLI_OPTIONS,
  run: (argv: readonly string[]) => Effect.gen(function* () {
    const input = yield* parsed(argv, SESSION_CLI_OPTIONS);
    if (input.values.help === true) return yield* write("stdout", SESSION_HELP).pipe(Effect.as(0));
    const [verb = "list", value] = input.positionals;
    const facts = yield* CliInvocationFacts;
    const invocation = yield* facts.facts.pipe(Effect.mapError((cause) => failure("read invocation facts", cause)));
    if (verb === "list") {
      const result = yield* experimentHost.invocationStatus.list({ cwd: invocation.cwd, ...(input.values.all === true ? { all: true } : {}), ...(value === undefined ? {} : { experimentSelector: value }) }).pipe(
        Effect.mapError((cause) => failure("list invocation status", cause)),
      );
      yield* write("stdout", input.values.json === true ? jsonDocument(result) : renderSessionListText(result, Date.now(), input.values.all === true));
      return 0;
    }
    if (verb === "show" && value !== undefined && input.positionals.length === 2) {
      const result = yield* experimentHost.invocationStatus.show({ cwd: invocation.cwd, invocationSelector: value }).pipe(
        Effect.mapError((cause) => failure("show invocation status", cause)),
      );
      yield* write("stdout", input.values.json === true ? jsonDocument(result) : renderSessionShowText(result));
      return 0;
    }
    return yield* write("stderr", "usage: niceeval session [list [<experiment-prefix>] | show <invocation-id>]\n").pipe(Effect.as(1));
  }),
});

/** The composition root receives frozen feature values; it never registers services. */
export const experimentCliContributions = Object.freeze([
  checkCommand,
  expCommand,
  debugCommand,
  acceptCommand,
  sessionCommand,
] as const);
