import { planLocatorAccept } from "../operations.ts";
import { rawExperimentHost as experimentHost } from "../runtime.ts";
import type { ExperimentHostRequirements } from "../requirements.ts";
import { Effect, Result } from "effect";

import {
  CliArguments,
  CliInterruption,
  CliInvocationFacts,
  CliOutput,
  type CliOptionDefinition,
} from "../../../cli/application.ts";
import type { CliFeatureError, CliCommandContribution } from "../../../cli/contribution.ts";
import { externalCliFailure } from "../../../cli/feature-failure.ts";
import type { ExternalCause } from "../../../shared/external-cause.ts";
import { ProjectConfiguration } from "../../../cli/project-configuration.ts";
import {
  createFeedbackCoordinator,
  createHumanRenderer,
  createInputGuard,
  createJsonRenderer,
  renderHumanCommandPlan,
  resolveOutputForm,
} from "../../../runner/feedback/index.ts";
import type { WarningEvent } from "../../../runner/feedback/json.ts";
import { renderSessionListText, renderSessionShowText } from "../../../runner/session.ts";
import { sessionListDocumentToJson, sessionShowDocumentToJson } from "./session-protocol.ts";
import type { CurrentReuseReadbackSnapshot } from "../../../runner/reuse-readback.ts";
import { formatIdentityExplanation } from "../../../runner/feedback/identity-explanation.ts";
import type {
  ExperimentHostDryComparison,
  ExperimentHostDryPlan,
  ExperimentHostError,
  ExperimentHostJsonValue,
  ExperimentHostSelectionProblem,
} from "../types.ts";
import { browsableExperimentPaths } from "../../../shared/aggregate.ts";
import {
  type ExperimentHostRenamePlan,
  type ExperimentHostRenameResult,
  type ExperimentHostSharedStateEvidence,
  type ExperimentHostAfterEvent,
  type ExperimentHostAfterResult,
} from "../index.ts";
import { ExperimentCliTerminal } from "./terminal.ts";
export { decodeExpPlanDocument, ExpPlanDocumentSchema, type ExpPlanDocument } from "./plan-protocol.ts";

type ExperimentCliRequirements =
  | CliArguments
  | CliInterruption
  | CliInvocationFacts
  | CliOutput
  | ExperimentCliTerminal
  | ProjectConfiguration
  | ExperimentHostRequirements;
type ExperimentCliError = CliFeatureError<ExternalCause>;

const option = (type: "string" | "boolean", summary: string, multiple?: true) =>
  Object.freeze({
    type,
    multiple,
    help: Object.freeze({ summary, visibility: "public" as const }),
  });

const optionalTier = (summary: string, defaultValue: string, values: readonly string[], separated = false) =>
  Object.freeze({
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
  experiment: option(
    "string",
    "Select an exact Experiment ID or a directory ending in /; repeat to select a set.",
    true,
  ),
  attempts: option("string", "Run each selected Eval this many times."),
  "max-concurrency": option("string", "Limit concurrent Attempt execution."),
  "max-build-concurrency": option("string", "Limit concurrent Sandbox build preparation."),
  "max-before-cache-concurrency": option("string", "Limit concurrent Sandbox before-cache preparation."),
  "sandbox-before-cache": option("string", "Use or bypass the Sandbox before cache."),
  // Let the root parser route retired options to this owner's migration error.
  "sandbox-setup-cache": Object.freeze({
    type: "string",
    help: Object.freeze({ summary: "Use --sandbox-before-cache.", visibility: "hidden" }),
  }),
  timeout: option("string", "Set the per-Attempt timeout in milliseconds."),
  budget: option("string", "Set the Invocation budget in USD."),
  tag: option("string", "Select only Evals with this tag."),
  junit: option("string", "Write a required JUnit report."),
  json: option("boolean", "Write the command's machine document or event stream."),
  dry: option("boolean", "Plan without creating an Invocation."),
  rerun: optionalTier("Require failed or all targets to run again.", "failed", ["failed", "all"], true),
  "keep-sandbox": optionalTier("Keep failed or all finished Sandboxes.", "failed", ["failed", "all"]),
  "pause-on-failure": option("boolean", "Pause failed Attempts before cleanup for native debugging."),
  "no-pause": option("boolean", "Disable failure pauses configured by the project."),
  "early-exit": option("boolean", "Stop remaining attempts after a passing result."),
  "no-early-exit": option("boolean", "Force all configured attempts to run."),
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export const EXP_LIST_CLI_OPTIONS = Object.freeze({
  tag: option("string", "Select only Evals with this tag."),
  json: option("boolean", "Write the catalog machine document."),
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export const EXP_RENAME_CLI_OPTIONS = Object.freeze({
  run: option("string", "Select the exact source Run to adopt into the target Experiment.", true),
  dry: option("boolean", "Preview the explicit Experiment rename."),
  json: option("boolean", "Write the rename machine document."),
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export const EXP_TEARDOWN_CLI_OPTIONS = Object.freeze({
  after: option("boolean", "Run explicit Experiment after recovery."),
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
  help: HELP_OPTION,
} satisfies Readonly<Record<string, CliOptionDefinition>>);

export const INVOCATION_CLI_OPTIONS = Object.freeze({
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

const SHARED_STATE_RECOVERY_USAGE = `  niceeval exp <selector> --after --recover-shared-state <key>
    --owner-token <token> --confirm-owner-terminated --confirm-remote-quiesced`;

const CHECK_HELP = `Check Experiment selection:
  niceeval check [<experiment-prefix> [<eval-prefix>...]] [--tag <tag>]

Options:
  --tag <tag>  select only Evals with this tag
  -h, --help   show this help
`;

const EXP_HELP = `Run and maintain Experiments:
  niceeval exp [<experiment-prefix> [<eval-prefix>...]] [options]
  niceeval exp --experiment <id-or-dir/> [--experiment <id-or-dir/>...] [<eval-prefix>...] [options]
  niceeval exp list [<experiment-prefix>] [--tag <tag>] [--json]
  niceeval exp rename <new-id> --run <source-run-id> [--dry] [--json]
${SHARED_STATE_RECOVERY_USAGE}

Run options:
  --experiment <id-or-dir/>      select an exact ID or physical directory prefix (repeatable)
  --attempts <n>                 run each selected Eval this many times
  --max-concurrency <n>          limit concurrent Attempt execution
  --max-build-concurrency <n>    limit concurrent Sandbox build preparation
  --max-before-cache-concurrency <n>
                                  limit concurrent Sandbox before-cache preparation
  --sandbox-before-cache <use|bypass>
                                  select the Sandbox before cache path
  --timeout <ms>                 set the per-Attempt timeout
  --budget <usd>                 set the Invocation budget
  --tag <tag>                    select only Evals with this tag
  --rerun[=failed|all]           require selected targets to run again
  --keep-sandbox[=failed|all]    retain selected finished Sandboxes
  --pause-on-failure            wait for Enter before cleaning up failed Attempts
  --no-pause                    disable configured failure pauses
  --early-exit / --no-early-exit
  --dry                          plan without creating an Invocation
  --json                         write machine output or the Invocation event stream
  --junit <path>                 write a required JUnit report

Recovery options:
  --after                     run only explicit Experiment after recovery
  --recover-shared-state <key>   inspect or recover this immutable shared-state owner
  --owner-token <token>          provide the exact owner token shown by inspection
  --confirm-owner-terminated     confirm the recorded owner has terminated
  --confirm-remote-quiesced      confirm remote shared state is quiesced
  -h, --help                     show this help
`;

const DEBUG_HELP = `Inspect an Experiment lifecycle plan:
  niceeval debug <experiment-selector> [eval-selector] [--json]

Options:
  --json       write the command-plan machine document
  -h, --help  show this help
`;

const ACCEPT_HELP = `Accept exact historical Attempt locators:
  niceeval accept @<locator>...
  niceeval accept --run <exact-run-id> [--dry]

Options:
  --run <run-id>   accept one exact source Run
  --dry            preview a whole-Run acceptance without writing
  -h, --help       show this help
`;

const INVOCATION_HELP = `Inspect project-local ephemeral Invocation status:
  niceeval invocation list [--all] [<experiment-prefix>]
  niceeval invocation show <invocation-id>

Options:
  --all        include completed Invocation status entries
  --json       write the status machine document
  -h, --help  show this help
`;

const EXP_COMMAND_SUMMARY = `list, plan, run, rename, or recover Experiments
      explicit sharedState recovery:
${SHARED_STATE_RECOVERY_USAGE}`;

function failure(operation: string, cause: unknown, exitCode = 1, display?: string): ExperimentCliError {
  return externalCliFailure(cause, {
    feature: "experiments",
    operation,
    exitCode,
    display,
  });
}

function write(channel: "stdout" | "stderr", text: string): Effect.Effect<void, ExperimentCliError, CliOutput> {
  return Effect.flatMap(CliOutput, (output) =>
    channel === "stdout" ? output.writeStdout(text) : output.writeStderr(text),
  ).pipe(Effect.mapError((cause) => failure(`write ${channel}`, cause)));
}

function numberFlag(
  value: string | boolean | string[] | undefined,
  name: string,
  positive = false,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9]+(?:\.[0-9]+)?$/u.test(value)) throw new Error(`${name} requires a number.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (positive && (!Number.isInteger(parsed) || parsed === 0))) {
    throw new Error(
      positive ? `${name} requires a positive integer.` : `${name} requires a non-negative finite number.`,
    );
  }
  return parsed;
}

function enumFlag<const Value extends string>(
  value: string | boolean | string[] | undefined,
  name: string,
  values: readonly Value[],
): Value | undefined {
  if (value === undefined) return undefined;
  const matched = values.find((candidate) => candidate === value);
  if (matched === undefined) throw new Error(`${name} accepts ${values.join(" or ")}.`);
  return matched;
}

function jsonDocument(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function userDatabaseStartupError(error: ExperimentHostError, json: boolean) {
  const output = json
    ? write(
        "stdout",
        jsonDocument({
          event: "warning",
          level: "error",
          code: error.code,
          message: error.message,
        } satisfies WarningEvent),
      )
    : write("stderr", `error (${error.code}): ${error.message}\n`);
  return output.pipe(Effect.as(1));
}

function catalogText(catalog: {
  readonly experiments: readonly {
    readonly id: string;
    readonly description: string | undefined;
    readonly adapter: string | null;
    readonly model: string | undefined;
    readonly attempts: number;
    readonly evalIds: readonly string[];
    readonly labels: Readonly<Record<string, string | number>>;
  }[];
}): string {
  return (
    catalog.experiments
      .map((experiment) =>
        [
          experiment.id,
          experiment.description ?? "—",
          experiment.adapter,
          experiment.model ?? "—",
          `attempts=${experiment.attempts}`,
          `evals=${experiment.evalIds.length}`,
          `labels: ${
            Object.entries(experiment.labels)
              .map(([key, value]) => `${key}=${value}`)
              .join(", ") || "none"
          }`,
        ].join("\t"),
      )
      .join("\n") + (catalog.experiments.length === 0 ? "" : "\n")
  );
}

function catalogJson(catalog: {
  readonly experiments: readonly {
    readonly id: string;
    readonly description: string | undefined;
    readonly adapter: string | null;
    readonly model: string | undefined;
    readonly attempts: number;
    readonly evalIds: readonly string[];
    readonly labels: Readonly<Record<string, string | number>>;
  }[];
}): string {
  return jsonDocument({
    experiments: catalog.experiments.map((experiment) => ({
      experimentId: experiment.id,
      ...(experiment.description === undefined ? {} : { description: experiment.description }),
      adapter: experiment.adapter,
      ...(experiment.model === undefined ? {} : { model: experiment.model }),
      attempts: experiment.attempts,
      evalCount: experiment.evalIds.length,
      labels: experiment.labels,
      selectedEvalIds: experiment.evalIds,
    })),
  });
}

function checkText(result: { readonly status: string; readonly pairCount: number | undefined }): string {
  return result.status === "linked"
    ? `Sandbox layers linked: ${result.pairCount} pairs.\n`
    : `Experiment selection: ${result.status}.\n`;
}

function selectionProblemText(result: ExperimentHostSelectionProblem): string {
  if (result.status === "experiment-no-match") {
    return `No experiment matched: ${result.selector ?? "(all)"}. Available paths: ${[...(result.candidates ?? [])].sort().join(", ") || "(none)"}.
Run \`niceeval exp --experiment <path> --dry\` to preview a plan.
`;
  }
  if (result.status === "eval-no-match") {
    return `No eval matched prefix: ${result.selector ?? ""} in experiments selected by ${(result.experimentIds ?? []).join(", ") || "(all)"}.
Positional args after the first select eval id prefixes. To select separate experiments in one Invocation,
use: niceeval exp --experiment <first-id> --experiment <second-id>
`;
  }
  return `No evals selected: ${(result.experimentIds ?? []).join(", ") || "(all)"} matched 0 evals. Available eval prefixes: ${browsableExperimentPaths(result.candidates ?? result.experimentIds ?? []).join(", ") || "(none)"}.
Run \`niceeval exp ${(result.experimentIds ?? []).join(", ") || "(all)"} --dry\` to see what it covers, or drop the eval filter to run every eval selected by those experiments.
`;
}

function acceptText(
  results: readonly {
    readonly runId: string;
    readonly sourceLocator: string;
    readonly locator: string;
    readonly fingerprint: string;
  }[],
): string {
  const accepted = results
    .map(
      (result) =>
        `Accepted source Attempt ${result.sourceLocator} into new Run ${result.runId}. Result locator remains ${result.locator}. Current fingerprint: ${result.fingerprint}
`,
    )
    .join("");
  const commands = [...new Set(results.map((result) => result.runId))]
    .map((runId) => `show: niceeval show run:${runId}\n`)
    .join("");
  return `${accepted}${commands}`;
}

function identityExplanationLines(comparisons: readonly ExperimentHostDryComparison[]): string[] {
  return comparisons.flatMap(function comparisonExplanation(comparison) {
    if (comparison.recordedClaim !== "execution-identity" || comparison.explanation === undefined) return [];
    if (comparison.explanation.kind === "unexplained") return [comparison.explanation.diagnostic.summary];
    return formatIdentityExplanation(comparison.explanation);
  });
}

function acceptMembersText(
  members: readonly {
    readonly locator: string;
    readonly evalId: string;
    readonly attempt: number;
    readonly comparisons: readonly ExperimentHostDryComparison[];
  }[],
): string {
  return (
    members
      .map((member) =>
        [
          `  ${member.evalId} #${String(member.attempt)} ${member.locator} eligible`,
          ...identityExplanationLines(member.comparisons).map((line) => `    ${line}`),
        ].join("\n"),
      )
      .join("\n") + "\n"
  );
}

function acceptRunPlanText(plan: {
  readonly sourceRunId: string;
  readonly members: Parameters<typeof acceptMembersText>[0];
}): string {
  return `Accept source Run ${plan.sourceRunId}\n${acceptMembersText(plan.members)}${String(plan.members.length)} members eligible\nApply: niceeval accept --run ${plan.sourceRunId}\n`;
}

function acceptedRunText(
  sourceRunId: string,
  results: readonly {
    readonly runId: string;
    readonly sourceLocator: string;
    readonly locator: string;
    readonly fingerprint: string;
  }[],
): string {
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
  inspection: ExperimentHostAfterResult,
): ExperimentHostSharedStateEvidence | undefined {
  return "evidence" in inspection ? inspection.evidence : undefined;
}

function teardownInspectionProblemText(inspection: ExperimentHostAfterResult): string | undefined {
  switch (inspection.status) {
    case "no-evidence":
      return `No recoverable sharedState ownership evidence exists for ${JSON.stringify(inspection.key)}.\n`;
    case "selection-not-unique":
      return "sharedState recovery requires an experiment selector that resolves to exactly one Experiment.\n";
    case "experiment-mismatch":
      return `sharedState key ${JSON.stringify(inspection.evidence.key)} belongs to experiment ${inspection.evidence.experimentId}, not ${inspection.selectedExperimentId}; refusing recovery.\n`;
    case "after-required":
      return `error: sharedState recovery requires the selected Experiment ${inspection.experimentId} to declare after as a function. The active generation was left unchanged.
`;
    case "recovery-confirmation-required":
      return `sharedState recovery requires \`--after --recover-shared-state <key> --owner-token <token> --confirm-owner-terminated --confirm-remote-quiesced\`.
`;
    default:
      return undefined;
  }
}

function teardownFailure(operation: string, cause: ExperimentHostError, recoveryKey?: string): ExperimentCliError {
  const code = cause.code;
  const message = cause.message;
  const display =
    code === "shared-state-recovery-registration-failed" && recoveryKey !== undefined
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

function dryRows(plan: Pick<ExperimentHostDryPlan, "slots" | "readbacks" | "lockedPairs">) {
  type ProjectedSlot = {
    readonly runId: string;
    readonly slotId: string;
    readonly experimentId: string;
    readonly evalId: string;
    readonly executionIdentityDigest: string;
    readonly evalGroupId: string | undefined;
    readonly evalGroupIndex: number | undefined;
    readonly attempt: number;
    readonly state: "reused" | "gap";
    readonly comparisons: readonly ExperimentHostDryComparison[];
    readonly reason: string | undefined;
    readonly scope: string | undefined;
    readonly issues: readonly ExperimentHostJsonValue[] | undefined;
  };
  const rows = new Map<
    string,
    {
      experimentId: string;
      evalId: string;
      evalGroupId: string | undefined;
      evalGroupIndex: number | undefined;
      slots: ProjectedSlot[];
      readbacks: CurrentReuseReadbackSnapshot[];
      locked: true | undefined;
    }
  >();
  for (const slot of plan.slots) {
    const { evalGroup, ...target } = slot.target;
    const evalGroupId = evalGroup?.id;
    const evalGroupIndex = evalGroup?.index;
    const key = JSON.stringify([target.experimentId, target.evalId]);
    const row = rows.get(key) ?? {
      experimentId: target.experimentId,
      evalId: target.evalId,
      evalGroupId,
      evalGroupIndex,
      slots: [],
      readbacks: [],
      locked: undefined,
    };
    row.slots.push({
      ...target,
      evalGroupId,
      evalGroupIndex,
      state: slot.state === "reuse" ? "reused" : "gap",
      comparisons: slot.comparisons,
      reason: slot.state === "gap" ? slot.reason : undefined,
      scope: slot.state === "gap" ? slot.scope : undefined,
      issues: slot.state === "gap" && slot.reason === "dynamic-module-unresolved" ? slot.issues : undefined,
    });
    if (plan.lockedPairs.includes(key)) row.locked = true;
    rows.set(key, row);
  }
  for (const readback of plan.readbacks) {
    const key = JSON.stringify([readback.target.experimentId, readback.target.evalId]);
    const row = rows.get(key) ?? {
      experimentId: readback.target.experimentId,
      evalId: readback.target.evalId,
      evalGroupId: undefined,
      evalGroupIndex: undefined,
      slots: [],
      readbacks: [],
      locked: undefined,
    };
    row.readbacks.push(readback);
    if (plan.lockedPairs.includes(key)) row.locked = true;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      slots: [...row.slots].sort((left, right) => left.attempt - right.attempt),
      readbacks: [...row.readbacks].sort((left, right) => left.target.attempt - right.target.attempt),
    }))
    .sort(
      (left, right) => left.experimentId.localeCompare(right.experimentId) || left.evalId.localeCompare(right.evalId),
    );
}

function dryText(
  plan: Parameters<typeof dryRows>[0] & Pick<ExperimentHostDryPlan, "recoverablePairs" | "groups">,
  shape: {
    readonly totalAttempts: number;
    readonly evals: number;
    readonly configurations: number;
    readonly attempts: number;
  },
  pluginCount: number,
): string {
  const rows = dryRows(plan);
  const reused = plan.slots.filter((slot) => slot.state === "reuse").length;
  const lines = [
    `plan: ${shape.totalAttempts} attempts · ${shape.evals} evals × ${shape.configurations} experiments · attempts ${shape.attempts}`,
    ...(reused === 0 ? [] : [`using earlier results: ${reused}/${shape.totalAttempts}`]),
    `plugins: ${pluginCount} lifecycle hooks`,
  ];
  for (const group of plan.groups) {
    for (const { lineage, origin } of group.state) {
      const start = origin.kind === "fresh" ? "no checkpoint" : `from ${origin.checkpoint.digest}`;
      lines.push(
        `State ${lineage.name} · ${group.experimentId} / ${group.evalGroupId} cohort ${lineage.cohort} · ${start}`,
      );
    }
  }
  for (const row of rows) {
    const slots = row.slots;
    const reusedAttempts = slots.filter((slot) => slot.state === "reused").map((slot) => slot.attempt);
    const gaps = slots.filter((slot) => slot.state === "gap");
    const explanations = new Map(slots.map((slot) => [slot.attempt, identityExplanationLines(slot.comparisons)]));
    const reasons = new Map<string, number>();
    for (const slot of gaps) {
      const readback = row.readbacks.find((item) => item.target.attempt === slot.attempt);
      function previousVerdict() {
        if (readback?.state === "reused") return readback.verdict;
        if (readback?.verdict.state === "available") return readback.verdict.value;
        return undefined;
      }
      const reason = dryReasonText(slot.reason, explanations.get(slot.attempt)?.[0], previousVerdict());
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    const parts = [
      ...(row.locked ? ["running in another invocation"] : []),
      ...(plan.recoverablePairs.includes(JSON.stringify([row.experimentId, row.evalId]))
        ? ["previous run did not release this Eval; this run will take over"]
        : []),
      ...(reusedAttempts.length === 0 ? [] : [`using earlier results ×${reusedAttempts.length}`]),
      ...[...reasons].map(([reason, count]) => (count === 1 ? reason : `${reason} ×${count}`)),
    ];
    lines.push(`${row.experimentId}  ${row.evalId}  ${parts.join(" · ") || "no attempts selected"}`);
    const shownDetails = new Set<string>();
    for (const slot of gaps) {
      if (slot.reason !== "identity-mismatch" && slot.reason !== "adoption-unproven") continue;
      const details = explanations.get(slot.attempt)?.slice(1) ?? [];
      if (details.length > 0) {
        for (const detail of details) {
          if (shownDetails.has(detail)) continue;
          shownDetails.add(detail);
          lines.push(`  ${detail}`);
        }
      }
    }
    for (const readback of row.readbacks) {
      function readbackVerdict() {
        if (readback.state === "reused") return readback.verdict;
        if (readback.verdict.state === "available") return readback.verdict.value;
        return readback.verdict.state;
      }
      lines.push(`  earlier result ${readback.source.locator} · ${readbackVerdict()}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function dryReasonText(reason: string | undefined, summary: string | undefined, verdict: string | undefined): string {
  switch (reason) {
    case "no-source-run":
    case "no-result":
      return "Not run yet";
    case "pending":
      return "Running";
    case "not-published":
      return "Run did not finish";
    case "identity-mismatch":
      return `Needs rerun: ${summary ?? "configuration changed"}`;
    case "outcome-ineligible":
      return `Needs rerun: last attempt ${verdict ?? "did not complete successfully"}`;
    case "score-incomplete":
      return "Needs rerun: score incomplete";
    case "evidence-unavailable":
      return "Needs rerun: evidence missing";
    case "timeout-exceeded":
      return "Needs rerun: timed out";
    case "adoption-unproven":
      return "Needs review: earlier result not proven equivalent";
    case "stateful-input":
      return "Reruns every time: uses state";
    case "dynamic-module-unresolved":
      return "Cannot plan: an imported module could not be resolved";
    default:
      return "Needs rerun: earlier result is not usable";
  }
}

function dryJson(
  plan: Parameters<typeof dryRows>[0] & Pick<ExperimentHostDryPlan, "groups">,
  shape: {
    readonly totalAttempts: number;
    readonly evals: number;
    readonly configurations: number;
    readonly attempts: number;
  },
  plugins: readonly unknown[],
): string {
  return jsonDocument({
    total: shape.totalAttempts,
    evals: shape.evals,
    configs: shape.configurations,
    attempts: shape.attempts,
    reused: plan.slots.filter((slot) => slot.state === "reuse").length,
    matrix: dryRows(plan),
    groups: plan.groups,
    plugins,
  });
}

function renameText(result: ExperimentHostRenamePlan | ExperimentHostRenameResult): string {
  const heading = `Source Run ${result.sourceRunId}\n${result.oldId ?? "Unknown source Experiment"} -> ${result.newId}\n`;
  if (result.status === "rejected") return `${heading}error: ${result.detail}\n`;
  if (result.status === "done")
    return `${heading}Accepted ${result.migrated.length} attempts into new Run ${result.runId}. Earlier Runs remain readable.${result.migrated[0] === undefined ? "" : `\n  source example: ${result.migrated[0].sourceLocator}`}\nNEXT\n  show: niceeval show run:${result.runId}\n  view: niceeval view run:${result.runId}\n`;
  if (result.blocked !== undefined) return `${heading}error: ${result.blocked.detail}\n`;
  return `${heading}${result.migrations.map((entry) => `  ${entry.evalId}  Attempt #${entry.attempt + 1}  ${entry.sourceLocator}`).join("\n")}\n${result.migrations.length} attempts can be used. Applying publishes a new Run; earlier Runs remain readable.\nNEXT\n  niceeval exp rename ${result.newId} --run ${result.sourceRunId}\n`;
}

function renameJson(result: ExperimentHostRenamePlan | ExperimentHostRenameResult): string {
  return jsonDocument({ ...result });
}

function parsed(argv: readonly string[], options: Readonly<Record<string, CliOptionDefinition>>) {
  return Effect.flatMap(CliArguments, (argumentsService) =>
    Effect.try({
      try: () => {
        for (const [oldName, newName] of [["--sandbox-setup-cache", "--sandbox-before-cache"]]) {
          if (argv.some((token) => token === oldName || token.startsWith(`${oldName}=`))) {
            throw new TypeError(`${oldName} is no longer supported. Use ${newName}.`);
          }
        }
        return argumentsService.parse(argv, options);
      },
      catch: (cause) => failure("parse command", cause),
    }),
  );
}

function factsAndConfig() {
  return Effect.gen(function* () {
    const facts = yield* CliInvocationFacts;
    const invocation = yield* facts.facts.pipe(Effect.mapError((cause) => failure("read invocation facts", cause)));
    const project = yield* ProjectConfiguration;
    const config = yield* project.load(invocation.cwd).pipe(Effect.mapError((cause) => failure("load config", cause)));
    return { invocation, config };
  });
}

function selection(positionals: readonly string[], experimentIds?: readonly string[]) {
  if (experimentIds !== undefined) {
    return {
      experimentIds: [...new Set(experimentIds)],
      evalSelectors: positionals.length === 0 ? undefined : positionals,
    };
  }
  const [experimentSelector, ...evalSelectors] = positionals;
  return {
    experimentSelector,
    evalSelectors: evalSelectors.length === 0 ? undefined : evalSelectors,
  };
}

function overrides(values: Record<string, string | boolean | string[] | undefined>) {
  const attempts = numberFlag(values.attempts, "--attempts", true);
  const timeoutMs = numberFlag(values.timeout, "--timeout");
  const budget = numberFlag(values.budget, "--budget");
  const maxConcurrency = numberFlag(values["max-concurrency"], "--max-concurrency", true);
  const maxBuildConcurrency = numberFlag(values["max-build-concurrency"], "--max-build-concurrency", true);
  const maxBeforeCacheConcurrency = numberFlag(
    values["max-before-cache-concurrency"],
    "--max-before-cache-concurrency",
    true,
  );
  const rerun = enumFlag(values.rerun, "--rerun", ["failed", "all"]);
  const keepSandbox = enumFlag(values["keep-sandbox"], "--keep-sandbox", ["failed", "all"]);
  const sandboxBeforeCache = enumFlag(values["sandbox-before-cache"], "--sandbox-before-cache", ["use", "bypass"]);
  return {
    attempts,
    timeoutMs,
    budget,
    maxConcurrency,
    maxBuildConcurrency,
    maxBeforeCacheConcurrency,
    rerun,
    keepSandbox,
    ...pauseOverride(),
    sandboxBeforeCache,
    ...earlyExitOverride(),
  };

  function pauseOverride() {
    if (values["no-pause"] === true) return { pauseOnFailure: false };
    if (values["pause-on-failure"] === true) return { pauseOnFailure: true };
    return {};
  }
  function earlyExitOverride() {
    if (values["no-early-exit"] === true) return { earlyExit: false };
    if (values["early-exit"] === true) return { earlyExit: true };
    return {};
  }
}

const checkCommand: CliCommandContribution<ExperimentCliRequirements, ExperimentCliError> = Object.freeze({
  name: "check",
  summary: "check Experiment and Sandbox selection",
  options: CHECK_CLI_OPTIONS,
  run: (argv: readonly string[]) =>
    Effect.gen(function* () {
      const input = yield* parsed(argv, CHECK_CLI_OPTIONS);
      if (input.values.help === true) return yield* write("stdout", CHECK_HELP).pipe(Effect.as(0));
      const { invocation, config } = yield* factsAndConfig();
      const result = yield* experimentHost
        .check({ cwd: invocation.cwd, config, ...selection(input.positionals) })
        .pipe(Effect.mapError((cause) => failure("check", cause)));
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
  run: (argv: readonly string[]) =>
    Effect.gen(function* () {
      // First parse only determines the family branch. The second, branch-owned
      // schema rejects irrelevant flags before facts, config, or .env are read.
      if (argv.some((arg) => arg === "--teardown" || arg.startsWith("--teardown="))) {
        return yield* write("stderr", "--teardown is no longer supported; use --after.\n").pipe(Effect.as(1));
      }
      const preliminary = yield* parsed(argv, EXP_CLI_OPTIONS);
      const teardownMode = preliminary.values.after === true;
      const preliminaryVerb = preliminary.values.experiment === undefined ? preliminary.positionals[0] : undefined;
      if (preliminaryVerb === "help" && preliminary.positionals.length === 1) {
        return yield* write("stdout", EXP_HELP).pipe(Effect.as(0));
      }
      function commandOptions() {
        if (teardownMode) return EXP_TEARDOWN_CLI_OPTIONS;
        if (preliminaryVerb === "list") return EXP_LIST_CLI_OPTIONS;
        if (preliminaryVerb === "rename") return EXP_RENAME_CLI_OPTIONS;
        return EXP_NORMAL_CLI_OPTIONS;
      }
      const input = yield* parsed(argv, commandOptions());
      if (input.values.help === true) return yield* write("stdout", EXP_HELP).pipe(Effect.as(0));
      const [positionalVerb, ...rest] = input.positionals;
      const verb = input.values.experiment === undefined ? positionalVerb : undefined;
      const facts = yield* CliInvocationFacts;
      const invocation = yield* facts.facts.pipe(Effect.mapError((cause) => failure("read invocation facts", cause)));
      if (teardownMode) {
        const project = yield* ProjectConfiguration;
        yield* project.load(invocation.cwd).pipe(Effect.mapError((cause) => failure("load config", cause)));
        if (typeof input.values["recover-shared-state"] === "string" && input.values.json === true) {
          yield* write(
            "stderr",
            `error: explicit sharedState recovery does not support --json. Retry without --json; this recovery flow has a human-only interface.
`,
          );
          return 1;
        }
        if (input.positionals.length > 1) {
          return yield* write("stderr", "niceeval exp --after accepts at most one Experiment selector.\n").pipe(
            Effect.as(1),
          );
        }
        const selector = input.positionals[0];
        const recoveryKey =
          typeof input.values["recover-shared-state"] === "string" ? input.values["recover-shared-state"] : undefined;
        const inspection = yield* experimentHost.after
          .inspect({
            cwd: invocation.cwd,
            currentHost: invocation.hostname,
            experimentSelector: selector,
            recoveryKey,
          })
          .pipe(Effect.mapError((cause) => failure("inspect teardown", cause)));
        if (
          inspection.status === "experiment-no-match" ||
          inspection.status === "eval-no-match" ||
          inspection.status === "empty-selection"
        ) {
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
        if (
          recoveryKey !== undefined &&
          (typeof input.values["owner-token"] !== "string" ||
            input.values["confirm-owner-terminated"] !== true ||
            input.values["confirm-remote-quiesced"] !== true)
        ) {
          yield* write(
            "stderr",
            `sharedState recovery requires \`--after --recover-shared-state <key> --owner-token <token> --confirm-owner-terminated --confirm-remote-quiesced\`.
`,
          );
          return 1;
        }
        if (inspection.status === "after-required") {
          yield* write("stderr", teardownInspectionProblemText(inspection)!);
          return 1;
        }
        const interruption = yield* CliInterruption;
        const output = yield* CliOutput;
        const result = yield* experimentHost.after
          .run({
            cwd: invocation.cwd,
            currentHost: invocation.hostname,
            experimentSelector: selector,
            recoveryKey,
            ...(typeof input.values["owner-token"] === "string" ? { ownerToken: input.values["owner-token"] } : {}),
            ...(input.values["confirm-owner-terminated"] === true ? { confirmOwnerTerminated: true } : {}),
            ...(input.values["confirm-remote-quiesced"] === true ? { confirmRemoteQuiesced: true } : {}),
            signal: interruption.invocationSignal,
            observer: {
              observe(event: ExperimentHostAfterEvent) {
                if (event.type === "diagnostic") output.writeStderrSync(`${event.message}\n`);
              },
            },
          })
          .pipe(Effect.mapError((cause) => teardownFailure("run teardown", cause, recoveryKey)));
        if (result.status === "completed") {
          for (const experiment of result.experiments) {
            if (experiment.outcome === "succeeded") {
              yield* write(
                "stderr",
                `teardown done: ${experiment.experimentId}
`,
              );
            } else if (experiment.outcome === "failed") {
              yield* write(
                "stderr",
                `teardown failed: ${experiment.experimentId}: ${experiment.error ?? "unknown"}
`,
              );
            }
          }
        } else if (result.status === "recovered" || result.status === "already-released") {
          if (result.status === "recovered") {
            yield* write(
              "stderr",
              `teardown done: ${result.experimentId}
`,
            );
          }
          if (result.status === "already-released")
            yield* write(
              "stderr",
              `sharedState key ${result.key} was already released after its cleanup; its immutable recovery generation is already complete.
`,
            );
          yield* write(
            "stderr",
            `explicitly recovered sharedState key ${result.key} for experiment ${result.experimentId}.
`,
          );
        } else if (result.status === "recovery-teardown-failed") {
          yield* write(
            "stderr",
            `teardown failed: ${result.evidence.experimentId}: ${result.error}
`,
          );
        } else {
          const changedEvidence = teardownInspectionEvidence(result);
          if (changedEvidence !== undefined) yield* write("stderr", sharedStateEvidenceText(changedEvidence));
          const problem = teardownInspectionProblemText(result);
          if (problem !== undefined) yield* write("stderr", problem);
        }
        return result.status === "completed" || result.status === "recovered" || result.status === "already-released"
          ? 0
          : 1;
      }
      if (verb === "list") {
        if (rest.length > 1)
          return yield* write("stderr", "niceeval exp list accepts at most one experiment prefix.\n").pipe(
            Effect.as(1),
          );
        const project = yield* ProjectConfiguration;
        yield* project.load(invocation.cwd).pipe(Effect.mapError((cause) => failure("load config", cause)));
        const result = yield* experimentHost
          .catalog({
            cwd: invocation.cwd,
            ...selection(rest),
            ...(typeof input.values.tag === "string" ? { tag: input.values.tag } : {}),
          })
          .pipe(Effect.mapError((cause) => failure("list", cause)));
        if (result.experiments.length === 0 && rest[0] !== undefined) {
          yield* write(
            "stderr",
            `No experiment matched: ${rest[0]}. Available IDs: ${[...result.experimentIds].sort().join(", ") || "(none)"}.
Run \`niceeval exp --experiment <path> --dry\` to preview a plan.
`,
          );
          return 1;
        }
        yield* write("stdout", input.values.json === true ? catalogJson(result) : catalogText(result));
        return 0;
      }
      if (verb === "rename") {
        const [newId] = rest;
        const sourceRuns = input.values.run;
        function renameSourceRun() {
          if (Array.isArray(sourceRuns) && sourceRuns.length === 1) return sourceRuns[0];
          if (typeof sourceRuns === "string") return sourceRuns;
          return undefined;
        }
        const sourceRunId = renameSourceRun();
        if (newId === undefined || rest.length !== 1 || typeof sourceRunId !== "string" || sourceRunId.length === 0) {
          return yield* write(
            "stderr",
            "usage: niceeval exp rename <new-id> --run <source-run-id> [--dry] [--json]\n",
          ).pipe(Effect.as(1));
        }
        const project = yield* ProjectConfiguration;
        const config = yield* project
          .load(invocation.cwd)
          .pipe(Effect.mapError((cause) => failure("load config", cause)));
        const renameInput = { cwd: invocation.cwd, sourceRunId, newId, config };
        const result =
          input.values.dry === true
            ? yield* experimentHost.rename
                .plan(renameInput)
                .pipe(Effect.mapError((cause) => failure("plan rename", cause)))
            : yield* experimentHost.rename
                .apply(renameInput)
                .pipe(Effect.mapError((cause) => failure("rename", cause)));
        yield* write("stdout", input.values.json === true ? renameJson(result) : renameText(result));
        return result.status === "rejected" || (result.status === "plan" && result.blocked !== undefined) ? 1 : 0;
      }
      const project = yield* ProjectConfiguration;
      const config = yield* project
        .load(invocation.cwd)
        .pipe(Effect.mapError((cause) => failure("load config", cause)));
      const experimentIds = Array.isArray(input.values.experiment) ? input.values.experiment : undefined;
      const planned = yield* Effect.result(
        experimentHost.invocation.plan({
          cwd: invocation.cwd,
          config,
          ...selection(input.positionals, experimentIds),
          ...(typeof input.values.tag === "string" ? { tag: input.values.tag } : {}),
          overrides: overrides(input.values),
          preview: input.values.dry === true,
        }),
      );
      if (Result.isFailure(planned)) {
        if (planned.failure.code === "user-database-unsupported")
          return yield* userDatabaseStartupError(planned.failure, input.values.json === true);
        return yield* Effect.fail(failure("plan invocation", planned.failure));
      }
      const plan = planned.success;
      if (plan.status !== "ready") {
        yield* write("stderr", selectionProblemText(plan));
        return 1;
      }
      if (input.values.dry === true) {
        if (plan.dry === undefined)
          return yield* Effect.fail(
            failure("preview invocation", new Error("Experiment Host did not return the requested dry plan.")),
          );
        yield* write(
          "stdout",
          input.values.json === true
            ? dryJson(plan.dry, plan.shape, plan.pluginAudit.occurrences)
            : dryText(plan.dry, plan.shape, plan.pluginAudit.occurrences.length),
        );
        return 0;
      }
      const interruption = yield* CliInterruption;
      if (!(yield* Effect.sync(interruption.enterGracefulDispatch))) return yield* Effect.interrupt;
      const terminal = yield* ExperimentCliTerminal;
      const profile = resolveOutputForm({
        json: input.values.json === true,
        isTTY: invocation.stderr.isTTY,
      });
      const renderer =
        profile === "human"
          ? createHumanRenderer({
              io: terminal.feedback,
              command: [
                "niceeval",
                "exp",
                ...(Array.isArray(input.values.experiment)
                  ? input.values.experiment.flatMap((id) => ["--experiment", id])
                  : []),
                ...input.positionals,
              ]
                .join(" ")
                .trim(),
            })
          : createJsonRenderer({ io: terminal.feedback });
      const coordinator = createFeedbackCoordinator({
        profile,
        renderer,
        io: terminal.feedback,
        // Experiment Host installs one lossless multiplexing sink for feedback
        // and the project-local Session observer.
        activateSink: false,

        tickIntervalMs: undefined,
        onEvent: undefined,
      });
      const outcome = yield* Effect.result(
        Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(
              Effect.sync(() =>
                createInputGuard({
                  stdin: terminal.stdin,
                  stderrIsTTY: terminal.feedback.stderr.isTTY,
                  coordinator,
                  onInterrupt: interruption.requestInterrupt,

                  process: undefined,
                }),
              ),
              (guard) => Effect.sync(guard.stop),
            );
            return yield* experimentHost.invocation.run({
              plan: plan.plan,
              signal: interruption.invocationSignal,
              feedback: {
                coordinator,
                observeState:
                  profile === "human"
                    ? undefined
                    : (event) => terminal.feedback.stdout.write(`${JSON.stringify(event)}\n`),
              },
              ...(typeof input.values.junit === "string" ? { junitPath: input.values.junit } : {}),
            });
          }),
        ),
      );
      if (Result.isFailure(outcome)) {
        if (outcome.failure.code === "user-database-unsupported")
          return yield* userDatabaseStartupError(outcome.failure, input.values.json === true);
        if (outcome.failure.code === "runner-record-assertions-invalid") {
          yield* write("stderr", `error: ${outcome.failure.message}\n`);
          return 1;
        }
        return yield* Effect.fail(failure("run invocation", outcome.failure));
      }
      const result = outcome.success;
      if (result.feedback.kind === "not-requested") {
        return yield* Effect.fail(
          failure(
            "finish invocation feedback",
            new Error("Experiment Host returned without the requested presentation exit fold."),
          ),
        );
      }
      return result.feedback.exitCode;
    }),
});

const debugCommand: CliCommandContribution<ExperimentCliRequirements, ExperimentCliError> = Object.freeze({
  name: "debug",
  summary: "show one Experiment lifecycle plan",
  options: DEBUG_CLI_OPTIONS,
  run: (argv: readonly string[]) =>
    Effect.gen(function* () {
      const input = yield* parsed(argv, DEBUG_CLI_OPTIONS);
      if (input.values.help === true) return yield* write("stdout", DEBUG_HELP).pipe(Effect.as(0));
      const [experimentSelector, evalSelector] = input.positionals;
      if (experimentSelector === undefined || input.positionals.length > 2) {
        return yield* write(
          "stderr",
          `error: niceeval debug expects one Experiment selector and an optional Eval selector
  fix: niceeval debug <experiment> [eval] [--json]
`,
        ).pipe(Effect.as(1));
      }
      const { invocation, config } = yield* factsAndConfig();
      const result = yield* experimentHost
        .debug({
          cwd: invocation.cwd,
          config,
          experimentSelector,
          evalSelector,
        })
        .pipe(Effect.mapError((cause) => failure("debug", cause)));
      switch (result.status) {
        case "experiment-no-match":
          yield* write(
            "stderr",
            `error: Experiment selector "${result.selector}" matched nothing
  exact candidates: ${result.candidates.join(", ") || "(none)"}
`,
          );
          return 1;
        case "experiment-ambiguous":
          yield* write(
            "stderr",
            `error: Experiment selector "${result.selector}" is ambiguous
  exact candidates: ${result.candidates.join(", ")}
`,
          );
          return 1;
        case "eval-no-match":
          yield* write(
            "stderr",
            `error: Eval selector "${result.selector}" matched nothing in Experiment "${result.experimentId}"
  exact candidates: ${result.candidates.join(", ") || "(none)"}
`,
          );
          return 1;
        case "eval-ambiguous":
          yield* write(
            "stderr",
            `error: Eval selector "${result.selector}" is ambiguous in Experiment "${result.experimentId}"
  exact candidates: ${result.candidates.join(", ")}
`,
          );
          return 1;
        case "planned":
          yield* write(
            "stdout",
            input.values.json === true
              ? jsonDocument({
                  experimentId: result.experimentId,
                  ...(result.evalId === undefined ? {} : { evalId: result.evalId }),
                  evalIds: result.evalIds,
                  beforeCachePlan: result.beforeCachePlan,
                  commandPlan: result.commandPlan,
                })
              : `Sandbox preparation: ${result.beforeCachePlan.nodes.length} reusable steps · cache lookup: not checked\n${renderHumanCommandPlan(
                  result.commandPlan,
                  {
                    isTTY: invocation.stdout.isTTY,
                    noColor: invocation.noColor,
                    width: invocation.stdout.columns,
                  },
                )}`,
          );
          return 0;
      }
    }),
});

function acceptFailure(cause: ExperimentHostError): ExperimentCliError {
  const details = identityExplanationLines(cause.comparisons ?? []).map((line) => `  ${line}`);
  return failure(
    "accept",
    cause,
    1,
    [`error: could not accept result: ${cause.code}: ${cause.message}`, ...details, ""].join("\n"),
  );
}

const acceptCommand: CliCommandContribution<ExperimentCliRequirements, ExperimentCliError> = Object.freeze({
  name: "accept",
  summary: "accept exact historical Attempt locators",
  options: ACCEPT_CLI_OPTIONS,
  run: (argv: readonly string[]) =>
    Effect.gen(function* () {
      const input = yield* parsed(argv, ACCEPT_CLI_OPTIONS);
      if (input.values.help === true) return yield* write("stdout", ACCEPT_HELP).pipe(Effect.as(0));
      const sourceRunIds = Array.isArray(input.values.run) ? input.values.run : [];
      const sourceRunId = sourceRunIds.length === 1 ? sourceRunIds[0] : undefined;
      if (sourceRunIds.length > 1)
        return yield* write("stderr", "niceeval accept --run requires one exact Run ID.\n").pipe(Effect.as(1));
      if (
        (sourceRunId === undefined && input.positionals.length === 0) ||
        (sourceRunId !== undefined && input.positionals.length > 0)
      ) {
        return yield* write(
          "stderr",
          "usage: niceeval accept @<locator>... | niceeval accept --run <exact-run-id> [--dry]\n",
        ).pipe(Effect.as(1));
      }
      const { invocation, config } = yield* factsAndConfig();
      if (sourceRunId !== undefined) {
        if (input.values.dry === true) {
          const plan = yield* experimentHost.acceptRun
            .plan({ cwd: invocation.cwd, config, runId: sourceRunId })
            .pipe(Effect.mapError(acceptFailure));
          yield* write("stdout", acceptRunPlanText(plan));
          return 0;
        }
        const accepted = yield* experimentHost.acceptRun
          .apply({ cwd: invocation.cwd, config, runId: sourceRunId })
          .pipe(Effect.mapError(acceptFailure));
        yield* write("stdout", acceptedRunText(sourceRunId, accepted));
        return 0;
      }
      if (input.values.dry === true) {
        const members = yield* planLocatorAccept({
          cwd: invocation.cwd,
          config,
          locators: input.positionals,
        }).pipe(Effect.mapError(acceptFailure));
        yield* write("stdout", `Accept preview\n${acceptMembersText(members)}`);
        return 0;
      }
      const result = yield* experimentHost
        .accept({ cwd: invocation.cwd, config, locators: input.positionals })
        .pipe(Effect.mapError(acceptFailure));
      yield* write("stdout", acceptText(result));
      return 0;
    }),
});

const invocationCommand: CliCommandContribution<ExperimentCliRequirements, ExperimentCliError> = Object.freeze({
  name: "invocation",
  summary: "inspect project-local ephemeral Invocation status",
  options: INVOCATION_CLI_OPTIONS,
  run: (argv: readonly string[]) =>
    Effect.gen(function* () {
      const input = yield* parsed(argv, INVOCATION_CLI_OPTIONS);
      if (input.values.help === true) return yield* write("stdout", INVOCATION_HELP).pipe(Effect.as(0));
      const [verb = "list", value] = input.positionals;
      const facts = yield* CliInvocationFacts;
      const invocation = yield* facts.facts.pipe(Effect.mapError((cause) => failure("read invocation facts", cause)));
      if (verb === "list") {
        const result = yield* experimentHost.invocationStatus
          .list({
            cwd: invocation.cwd,
            ...(input.values.all === true ? { all: true } : {}),
            experimentSelector: value,
          })
          .pipe(Effect.mapError((cause) => failure("list invocation status", cause)));
        yield* write(
          "stdout",
          input.values.json === true
            ? jsonDocument(sessionListDocumentToJson(result))
            : renderSessionListText(result, Date.now(), input.values.all === true),
        );
        return 0;
      }
      if (verb === "show" && value !== undefined && input.positionals.length === 2) {
        const result = yield* experimentHost.invocationStatus
          .show({ cwd: invocation.cwd, invocationSelector: value })
          .pipe(Effect.mapError((cause) => failure("show invocation status", cause)));
        yield* write(
          "stdout",
          input.values.json === true ? jsonDocument(sessionShowDocumentToJson(result)) : renderSessionShowText(result),
        );
        return 0;
      }
      return yield* write(
        "stderr",
        "usage: niceeval invocation [list [<experiment-prefix>] | show <invocation-id>]\n",
      ).pipe(Effect.as(1));
    }),
});

/** The composition root receives frozen feature values; it never registers services. */
export const experimentCliContributions = Object.freeze([
  checkCommand,
  expCommand,
  debugCommand,
  acceptCommand,
  invocationCommand,
] as const);
