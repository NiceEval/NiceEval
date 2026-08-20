import { Effect } from "effect";

import {
  attemptEvidenceView,
  attemptObservabilityView,
  fileChangesView,
  query,
  sourcesView,
  type Sample,
} from "../../analysis/index.ts";
import { builtInMachineProducerIds } from "../built-in/machine.ts";
import { loadBuiltInExperimentRows } from "../built-in/analysis-values.ts";
import {
  closeMachineJson,
  type BuiltInMachineProducer,
  type BuiltInMachineRegistry,
  type BuiltInShowData,
} from "../execution/machine.ts";

export interface BuiltInMachineProductionFailed {
  readonly code: "report-built-in-machine-production-failed";
  readonly producerId: string;
  readonly reason: string;
}

const leaderboard = producer(async (sample) => {
  const rows = [...await loadBuiltInExperimentRows(sample)].sort((left, right) => compareUtf8(left.key, right.key));
  return Object.freeze({ kind: "leaderboard" as const, rows: closeMachineJson(rows) });
});

const attempt = producer(async (sample, locator) => {
  const [evidence, observability, fileChanges] = await Promise.all([
    query(sample, { kind: "domain-view", view: attemptEvidenceView, ...(locator === undefined ? {} : { locator }) }),
    query(sample, { kind: "domain-view", view: attemptObservabilityView, ...(locator === undefined ? {} : { locator }) }),
    query(sample, { kind: "domain-view", view: fileChangesView, ...(locator === undefined ? {} : { locator }) }),
  ]);
  return Object.freeze({
    kind: "attempt" as const,
    evidence: closeMachineJson(evidence),
    observability: closeMachineJson(observability),
    fileChanges: closeMachineJson(fileChanges),
  });
});

const source = producer(async (sample, locator) => Object.freeze({
  kind: "source" as const,
  sources: closeMachineJson(await query(sample, {
    kind: "domain-view",
    view: sourcesView,
    ...(locator === undefined ? {} : { locator }),
  })),
}));

const execution = producer(async (sample, locator) => Object.freeze({
  kind: "execution" as const,
  execution: closeMachineJson(await query(sample, {
    kind: "domain-view",
    view: attemptObservabilityView,
    ...(locator === undefined ? {} : { locator }),
  })),
}));

const timing = producer(async (sample, locator) => {
  const view = await query(sample, {
    kind: "domain-view",
    view: attemptObservabilityView,
    ...(locator === undefined ? {} : { locator }),
  });
  return Object.freeze({
    kind: "timing" as const,
    timing: closeMachineJson(view.entries.map((entry) => entry.state === "available"
      ? Object.freeze({ attempt: entry.attempt, state: entry.state, timing: entry.detail.timing })
      : entry)),
  });
});

const standard: BuiltInMachineProducer<BuiltInMachineProductionFailed, never> = (input) => {
  switch (input.pageId) {
    case "attempt":
    case "attempt-overview":
      return attempt(input);
    default:
      return leaderboard(input);
  }
};

const producers = new Map<string, BuiltInMachineProducer<BuiltInMachineProductionFailed, never>>([
  [builtInMachineProducerIds.runMembershipOverview, leaderboard],
  [builtInMachineProducerIds.attemptOverview, attempt],
  [builtInMachineProducerIds.executionEvidence, execution],
  [builtInMachineProducerIds.timingEvidence, timing],
  [builtInMachineProducerIds.sourceEvidence, source],
  [builtInMachineProducerIds.sandboxHistory, execution],
  [builtInMachineProducerIds.standard, standard],
]);

export const builtInMachineRegistry: BuiltInMachineRegistry<BuiltInMachineProductionFailed, never> = Object.freeze({
  producers,
});

function producer(
  build: (
    sample: Sample,
    locator: import("../../attempt-locator.ts").AttemptLocator | undefined,
  ) => Promise<BuiltInShowData>,
): BuiltInMachineProducer<BuiltInMachineProductionFailed, never> {
  return (input) => Effect.tryPromise({
    try: () => build(
      input.sample,
      input.selection.kind === "attempt-locator"
        ? input.selection.locator as import("../../attempt-locator.ts").AttemptLocator
        : undefined,
    ),
    catch: (cause): BuiltInMachineProductionFailed => Object.freeze({
      code: "report-built-in-machine-production-failed" as const,
      producerId: producerIdForInput(input.pageId),
      reason: boundedReason(cause),
    }),
  });
}

function producerIdForInput(pageId: string): string {
  return `page:${pageId}`;
}

function boundedReason(cause: unknown): string {
  const value = cause instanceof Error ? cause.message : String(cause);
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 512).trim() || "machine producer failed";
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
