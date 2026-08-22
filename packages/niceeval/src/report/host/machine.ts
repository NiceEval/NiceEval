import {
  attemptEvidenceView,
  attemptObservabilityView,
  experimentComparisonScope,
  experimentGroups,
  fileChangesView,
  query,
  sourcesView,
  type Sample,
} from "../../analysis/index.ts";
import { sampleForExperimentComparisonScope } from "../../analysis/experiment-groups.ts";
import { builtInMachineProducerIds } from "../built-in/machine.ts";
import { loadBuiltInExperimentRows } from "../built-in/analysis-values.ts";
import { loadRunMembershipPageInput } from "../built-in/run-membership-overview.ts";
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

const groups = producer(async (sample) => {
  const entries = experimentGroups(sample).map((entry) => Object.freeze({
    group: entry.group,
    members: entry.members,
    href: `/group/${entry.group.kind}/${entry.group.kind === "named" ? entry.group.groupId : String(entry.group.experimentId)}`,
  }));
  return Object.freeze({ kind: "groups" as const, groups: closeMachineJson(entries) });
});

const experimentGroup = producer(async (sample, _locator, route) => {
  const match = /^\/group\/(named|singleton)\/([^/]+)$/u.exec(route);
  if (match === null) throw new TypeError("Experiment Group route is invalid");
  const kind = match[1]!;
  const key = decodeURIComponent(match[2]!);
  const summary = experimentGroups(sample).find((entry) =>
    entry.group.kind === kind && (kind === "named"
      ? entry.group.kind === "named" && entry.group.groupId === key
      : entry.group.kind === "singleton" && String(entry.group.experimentId) === key));
  if (summary === undefined) {
    throw Object.freeze({ code: "report-group-not-in-sample" as const, group: `${kind}/${key}` });
  }
  const scope = experimentComparisonScope(sample, summary.group);
  const comparison = Object.freeze({
    members: scope.comparison.members,
    coverage: scope.comparison.coverage,
    rows: await loadBuiltInExperimentRows(sampleForExperimentComparisonScope(scope)),
  });
  return Object.freeze({
    kind: "experiment-group" as const,
    group: closeMachineJson(summary.group),
    comparison: closeMachineJson(comparison),
  });
});

const runMembership = producer(async (sample) => {
  const result = await loadRunMembershipPageInput(sample);
  return Object.freeze({
    kind: "run-membership" as const,
    summary: closeMachineJson(result.summary),
    members: closeMachineJson(result.members),
    errors: closeMachineJson(result.errors),
    evidence: closeMachineJson(result.evidence),
  });
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

const standard: BuiltInMachineProducer = async (input) => {
  switch (input.pageId) {
    case "attempt":
    case "attempt-overview":
      return await attempt(input);
    case "group-named":
    case "group-singleton":
      return await experimentGroup(input);
    default:
      return await groups(input);
  }
};

const producers = new Map<string, BuiltInMachineProducer>([
  [builtInMachineProducerIds.runMembershipOverview, runMembership],
  [builtInMachineProducerIds.attemptOverview, attempt],
  [builtInMachineProducerIds.executionEvidence, execution],
  [builtInMachineProducerIds.timingEvidence, timing],
  [builtInMachineProducerIds.sourceEvidence, source],
  [builtInMachineProducerIds.sandboxHistory, execution],
  [builtInMachineProducerIds.standard, standard],
]);

export const builtInMachineRegistry: BuiltInMachineRegistry = Object.freeze({
  producers,
});

function producer(
  build: (
    sample: Sample,
    locator: import("../../attempt-locator.ts").AttemptLocator | undefined,
    route: string,
  ) => Promise<BuiltInShowData>,
): BuiltInMachineProducer {
  return async (input) => {
    try {
      return await build(
      input.sample,
      input.selection.kind === "attempt-locator"
        ? input.selection.locator as import("../../attempt-locator.ts").AttemptLocator
        : undefined,
      input.route,
      );
    } catch (cause) {
      throw Object.freeze({
      code: "report-built-in-machine-production-failed" as const,
      producerId: producerIdForInput(input.pageId),
      reason: boundedReason(cause),
      }) satisfies BuiltInMachineProductionFailed;
    }
  };
}

function producerIdForInput(pageId: string): string {
  return `page:${pageId}`;
}

function boundedReason(cause: unknown): string {
  const value = cause instanceof Error ? cause.message
    : typeof cause === "object" && cause !== null ? JSON.stringify(cause) : String(cause);
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 512).trim() || "machine producer failed";
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
