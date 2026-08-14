import { Effect } from "effect";
import type { AttemptLocator } from "../../attempt-locator.ts";
import { resolveAttemptLocator } from "../../attempt-locator-resolution.ts";
import {
  analysisHost,
} from "../../analysis/host.ts";
import type {
  AnalysisSelectionRequest,
} from "../../analysis/index.ts";
import { narrowSample, narrowSampleByCurrentIdentity } from "../../sample/capability.ts";
import { recordHost } from "../../record/host/runtime.ts";
import type { RecordRoot } from "../../record/platform/root.ts";
import type {
  RecordReaderOpenError,
  RecordReaderReadError,
} from "../../record/reader/errors.ts";
import type {
  RecordCoordination,
} from "../../coordination/record-leases.ts";
import type { RecordFileSystem } from "../../record/platform/services.ts";
import { builtInDefaultReportTarget } from "../built-in/index.tsx";
import type { Report } from "../definition.ts";
import type { ReportExecution, ReportTargetSelection } from "../execution/model.ts";
import { executeReport, type ReportExecutionError } from "./execute.ts";

export type ExecuteReportFromRecordError =
  | RecordReaderOpenError
  | RecordReaderReadError
  | ReportExecutionError
  | {
      readonly code: "sample-attempt-locator-not-found";
      readonly locator: AttemptLocator;
    }
  | {
      readonly code: "sample-attempt-locator-ambiguous";
      readonly locator: AttemptLocator;
    };

export type ExecuteReportForAttemptFromRecordError = ExecuteReportFromRecordError;

export type ExecuteReportFromRecordRequirements =
  | RecordFileSystem
  | RecordCoordination;

/**
 * Opens one current Record through the Host SDK, issues a Sample, and
 * completes the Report before the Scope closes. The returned execution
 * contains no reader, Scope, path, callback, or deferred Record I/O.
 */
export function executeReportFromRecord(input: {
  readonly root: RecordRoot;
  readonly selection: AnalysisSelectionRequest;
  readonly report?: Report;
  readonly target?: ReportTargetSelection;
}): Effect.Effect<
  ReportExecution,
  ExecuteReportFromRecordError,
  ExecuteReportFromRecordRequirements
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const reader = yield* recordHost.current.openRead({ root: input.root });
      const selected = yield* reader.selectRuns(
        input.selection.policy === "explicit-runs"
          ? { runIds: input.selection.runIds }
          : undefined,
      );
      const filtered = input.selection.policy === "project-current"
        && input.selection.experimentIds !== undefined
        ? yield* filterSelectionByExperiment(selected, input.selection.experimentIds)
        : selected;
      const opened = yield* analysisHost.openSample({
        reader,
        selection: filtered,
        selectionRequest: input.selection,
      });
      const sample = input.selection.policy === "project-current"
        ? narrowSampleByCurrentIdentity(
            opened,
            matchingOccurrencesForCurrentIdentity(filtered, input.selection.currentSlots),
          )
        : opened;
      return yield* executeReport({
        sample,
        report: input.report ?? defaultReportForSelection(input.selection),
        target: input.target ?? { kind: "show" },
      });
    }),
  );
}

/**
 * Resolves one public locator through the live Record Host session, then
 * narrows the issued Sample to that Slot before Report execution.
 */
export function executeReportForAttemptFromRecord(input: {
  readonly root: RecordRoot;
  readonly locator: AttemptLocator;
  readonly report?: Report;
  readonly target?: ReportTargetSelection;
}): Effect.Effect<
  ReportExecution,
  ExecuteReportForAttemptFromRecordError,
  ExecuteReportFromRecordRequirements
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const reader = yield* recordHost.current.openRead({ root: input.root });
      const selected = yield* reader.selectRuns();
      const resolved = yield* resolveAttemptLocator({
        reader,
        selection: selected,
        locator: input.locator,
      });
      if (resolved.kind === "not-found") {
        return yield* Effect.fail({
          code: "sample-attempt-locator-not-found" as const,
          locator: input.locator,
        });
      }
      if (resolved.kind === "ambiguous") {
        return yield* Effect.fail({
          code: "sample-attempt-locator-ambiguous" as const,
          locator: input.locator,
        });
      }
      const selectionRequest: AnalysisSelectionRequest = Object.freeze({
        policy: "explicit-runs" as const,
        runIds: Object.freeze([resolved.run.runId]),
      });
      const selectedRun = yield* reader.selectRuns({ runIds: selectionRequest.runIds });
      const sample = yield* analysisHost.openSample({
        reader,
        selection: selectedRun,
        selectionRequest,
      });
      const narrowed = narrowSample(sample, {
        runIds: [resolved.run.runId],
        slotIds: [resolved.slotId],
      });
      return yield* executeReport({
        sample: narrowed,
        report: input.report ?? builtInDefaultReportTarget("attempt-locator").report,
        target: input.target ?? { kind: "show" },
      });
    }),
  );
}

function defaultReportForSelection(selection: AnalysisSelectionRequest): Report {
  return builtInDefaultReportTarget(
    selection.policy === "explicit-runs" ? "explicit-runs" : "project-current",
  ).report;
}

function matchingOccurrencesForCurrentIdentity(
  selection: import("../../record/host/types.ts").RecordSelection,
  currentSlots: readonly import("../../analysis/contracts.ts").AnalysisCurrentSlotIdentity[],
): readonly import("../../analysis/contracts.ts").AnalysisSlotOccurrenceIdentity[] {
  const digestsByLogicalAlignment = new Map<string, Set<string>>();
  for (const current of currentSlots) {
    const key = logicalAlignmentKey(current.experimentId, current.evalId, current.attemptOrdinal);
    const existing = digestsByLogicalAlignment.get(key) ?? new Set<string>();
    digestsByLogicalAlignment.set(key, existing.add(current.executionIdentityDigest));
  }
  const matching: import("../../analysis/contracts.ts").AnalysisSlotOccurrenceIdentity[] = [];
  for (const entry of selection.expectedSlots) {
    const digests = digestsByLogicalAlignment.get(
      logicalAlignmentKey(entry.experimentId, entry.slot.evalId, entry.slot.attemptOrdinal),
    );
    if (digests === undefined || !digests.has(entry.slot.executionIdentityDigest)) continue;
    matching.push(Object.freeze({ runId: entry.run.runId, slotId: entry.slot.slotId }));
  }
  return Object.freeze(matching);
}

function filterSelectionByExperiment(
  selection: import("../../record/host/types.ts").RecordSelection,
  experimentIds: readonly import("../../analysis/contracts.ts").ExperimentId[],
): Effect.Effect<import("../../record/host/types.ts").RecordSelection> {
  const wanted = new Set(experimentIds);
  const runFacts = selection.runFacts.filter((facts) => wanted.has(facts.experimentId));
  const allowed = new Set(runFacts.map((facts) => facts.run));
  return Effect.succeed(Object.freeze({
    runRefs: Object.freeze(runFacts.map((facts) => facts.run)),
    runFacts: Object.freeze(runFacts),
    expectedSlots: Object.freeze(
      selection.expectedSlots.filter((entry) => allowed.has(entry.run)),
    ),
    problems: selection.problems,
    warnings: selection.warnings,
  }));
}

function logicalAlignmentKey(
  experimentId: import("../../analysis/contracts.ts").ExperimentId,
  evalId: import("../../analysis/contracts.ts").EvalId,
  attemptOrdinal: number,
): string {
  return `${experimentId}\0${evalId}\0${attemptOrdinal}`;
}
