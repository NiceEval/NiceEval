import type {
  ExperimentComparisonScope,
  ExperimentGroupIdentity,
  ExperimentId,
  Sample,
} from "./contracts.ts";
import { narrowSample } from "../sample/capability.ts";
import { experimentGroupOf } from "../shared/aggregate.ts";

const scopeBrand: unique symbol = Symbol("niceeval.analysis.ExperimentComparisonScope.runtime");
const scopeSamples = new WeakMap<ExperimentComparisonScope, Sample>();

export interface ExperimentGroupSummary {
  readonly group: ExperimentGroupIdentity;
  readonly members: readonly ExperimentId[];
}

export function experimentGroups(sample: Sample): readonly ExperimentGroupSummary[] {
  const experiments = new Map<string, ExperimentId>();
  const selectedRuns = new Set(sample.snapshot.selection.selectedRunIds.map(String));
  for (const run of sample.snapshot.runs) {
    if (!selectedRuns.has(String(run.runId))) continue;
    experiments.set(String(run.experimentId), run.experimentId);
  }
  const byGroup = new Map<string, { group: ExperimentGroupIdentity; members: Map<string, ExperimentId> }>();
  for (const experimentId of experiments.values()) {
    const derived = experimentGroupOf(String(experimentId));
    const group = derived.kind === "named"
      ? Object.freeze({ kind: "named" as const, groupId: derived.groupId, key: derived.key })
      : Object.freeze({ kind: "singleton" as const, experimentId, key: derived.key });
    const entry = byGroup.get(group.key) ?? { group, members: new Map<string, ExperimentId>() };
    entry.members.set(String(experimentId), experimentId);
    byGroup.set(group.key, entry);
  }
  return Object.freeze([...byGroup.values()]
    .sort((left, right) => compareUtf8(left.group.key, right.group.key))
    .map((entry) => Object.freeze({
      group: entry.group,
      members: Object.freeze([...entry.members.values()].sort((left, right) => compareUtf8(String(left), String(right)))),
    })));
}

export function experimentComparisonScope(
  sample: Sample,
  group: ExperimentGroupIdentity,
): ExperimentComparisonScope {
  const summary = experimentGroups(sample).find((candidate) => candidate.group.key === group.key);
  if (summary === undefined || !sameGroup(summary.group, group)) {
    throw Object.freeze({ code: "analysis-comparison-group-not-found" as const, group });
  }
  const memberSet = new Set(summary.members.map(String));
  const runIds = sample.snapshot.runs
    .filter((run) => memberSet.has(String(run.experimentId)))
    .map((run) => run.runId);
  const narrowed = narrowSample(sample, { runIds });
  const comparison = comparisonDescription(narrowed, summary.members);
  const scope = Object.freeze({
    group: summary.group,
    comparison,
    [scopeBrand]: true as const,
  }) as unknown as ExperimentComparisonScope;
  scopeSamples.set(scope, narrowed);
  return scope;
}

/** @internal Used only by named comparison components. */
export function sampleForExperimentComparisonScope(scope: ExperimentComparisonScope): Sample {
  const sample = scopeSamples.get(scope);
  if (sample === undefined) {
    throw Object.freeze({
      code: "analysis-comparison-group-mismatch" as const,
      groups: Object.freeze([scope?.group].filter((value): value is ExperimentGroupIdentity => value !== undefined)),
    });
  }
  return sample;
}

function comparisonDescription(sample: Sample, members: readonly ExperimentId[]) {
  const populations = members.map((member) => {
    const values = [...new Set(sample.snapshot.slots
      .filter((slot) => slot.state !== "excluded" && String(slot.experimentId) === String(member))
      .map((slot) => String(slot.evalId)))]
      .sort(compareUtf8);
    return Object.freeze({ member, population: Object.freeze(values) });
  });
  const groupEvalCount = new Set(populations.flatMap((entry) => entry.population)).size;
  return Object.freeze({
    members,
    coverage: Object.freeze(populations.map((entry) => Object.freeze({
      member: entry.member,
      coveredEvalCount: entry.population.length,
      groupEvalCount,
    }))),
  });
}

function sameGroup(left: ExperimentGroupIdentity, right: ExperimentGroupIdentity): boolean {
  return left.kind === right.kind && left.key === right.key;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
