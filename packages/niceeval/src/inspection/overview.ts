// @concord-file
// @concord-implements docs/feature/inspection/README.md
// @concord-implements docs/feature/inspection/use-case/inspection-compare-quality-cost.md
// @concord-implements docs/feature/insight/README.md
import { stoppedAssertion } from "./stop.ts";
import { PlannedAttemptMetricsSchema, type PlannedAttemptMember } from "./results.ts";
import { attemptVerdict } from "./verdict.ts";
import type { VerdictState } from "../eval/record/verdict.ts";
import { Predicate, Result, Schema } from "effect";
import type { MemberDocument, RecordSlotIdentity } from "../record/model/core.ts";
import type { RunPluginIdentity, AdapterIdentity } from "../record/model/run-context.ts";
import { NiceEvalCurrentRecordAttachments, NiceEvalRecordAttachments } from "../record/family/current.ts";
import { closeInspectionJson, isInspectionCodecError, type InspectionJson } from "./codec.ts";
import {
  attemptAttachment,
  loadInspectionRuns,
  readInspectionAssertions,
  resolveInspectionMemberAttempt,
  type InspectionAssertionsRead,
  type LoadedInspectionRun,
  type ResolvedInspectionAttempt,
} from "./facts.ts";
import type { InspectionFactSource } from "./source.ts";
import {
  projectAdapterUsageTokens,
  projectAttemptTiming,
  projectAttemptUsage,
  projectApplicationUsage,
} from "./trace.ts";

export type InspectionMetricState = "available" | "partial" | "unavailable" | "empty" | "unsupported" | "failed";

export interface InspectionAttemptRef {
  readonly identity: {
    readonly kind: "attempt";
    readonly locator: string;
  };
}

// Key-enumeration boundary: metric values are embedded directly in Inspection JSON.
export interface InspectionMetricValue {
  readonly value: number | null;
  readonly state: InspectionMetricState;
  readonly samples: number;
  readonly total: number;
  readonly basis: "planned-attempt" | "eval";
  readonly issues: readonly InspectionJson[];
  readonly refs: readonly InspectionAttemptRef[];
  readonly unit?: "points" | "USD" | "ms" | "tokens";
  readonly bounds?: {
    readonly min: number;
    readonly max: number;
  };
}

export interface InspectionCostMetricValue extends InspectionMetricValue {
  readonly source: "reported" | "estimated" | "mixed" | null;
}

export interface InspectionOverviewDenominator {
  readonly expected: number;
  readonly observed: number;
  readonly classified: number;
  readonly missing: number;
}

export interface InspectionVerdictTally {
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: number;
}

export type InspectionEvaluationKind = "pass" | "points" | "mixed";

export interface InspectionOverviewAggregate {
  readonly evaluationKind: InspectionEvaluationKind;
  readonly denominator: InspectionOverviewDenominator;
  readonly verdict: {
    readonly tally: InspectionVerdictTally;
    readonly passRate: InspectionMetricValue;
  };
  readonly score: InspectionMetricValue;
  readonly costUSD: InspectionCostMetricValue;
  readonly durationMs: InspectionMetricValue;
  readonly tokens: InspectionMetricValue;
  readonly coverage: readonly InspectionJson[];
  readonly issues: readonly InspectionJson[];
}

export interface InspectionOverviewMember extends PlannedAttemptMember {
  readonly runId: string;
  readonly labels: InspectionLabels;
}

export interface InspectionOverviewCell extends InspectionOverviewAggregate {
  readonly experimentId: string;
  readonly evalId: string;
  readonly groupPath: readonly string[];
  readonly members: readonly InspectionOverviewMember[];
}

export interface InspectionOverviewGroup extends InspectionOverviewAggregate {
  readonly groupPath: readonly string[];
}

export interface InspectionOverviewExperiment extends InspectionOverviewAggregate {
  readonly plugins: readonly RunPluginIdentity[];
  readonly experimentId: string;
  readonly adapter: InspectionAdapterValue;
  readonly model: InspectionExecutionValue;
  readonly labels: InspectionLabels;
  readonly groups: readonly InspectionOverviewGroup[];
}

export type InspectionExecutionValue =
  | { readonly state: "available"; readonly value: string }
  | { readonly state: "mixed" }
  | { readonly state: "unavailable" };

export type InspectionAdapterValue =
  | { readonly state: "available"; readonly value: AdapterIdentity }
  | { readonly state: "mixed" };

export type InspectionLabels = Readonly<Record<string, InspectionExecutionValue>>;

export interface InspectionOverview {
  readonly totals: InspectionOverviewAggregate;
  readonly experiments: readonly InspectionOverviewExperiment[];
  readonly cells: readonly InspectionOverviewCell[];
}

interface SelectedSlot {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly adapter: AdapterIdentity;
  readonly model: string | null;
  readonly labels: Readonly<Record<string, string>>;
  readonly recorded:
    | {
        readonly target: LoadedInspectionRun;
        readonly slot: RecordSlotIdentity;
        readonly membership:
          | { readonly state: "missing" }
          | {
              readonly state: "member";
              readonly member: MemberDocument;
              readonly resolved: ResolvedInspectionAttempt | undefined;
            };
      }
    | undefined;
  readonly analysis: AttemptAnalysis;
}

interface AttemptAnalysis {
  readonly assertionsState: InspectionAssertionsRead["state"] | "attempt-missing";
  readonly evaluationKind: "pass" | "points" | undefined;
  readonly verdict: VerdictState | undefined;
  readonly stoppedAt: ReturnType<typeof stoppedAssertion> | undefined;
  readonly score: {
    readonly hasPoints: boolean;
    readonly earned: number;
    readonly possible: number;
    readonly hasValue: boolean;
    readonly complete: boolean;
  };
  readonly costUSD:
    | { readonly state: "unavailable" }
    | {
        readonly state: "available" | "partial";
        readonly value: number;
        readonly source: "reported" | "estimated" | "mixed";
      };
  readonly durationMs: OperationalMetric;
  readonly tokens: OperationalMetric;
  readonly coverage: readonly InspectionJson[];
  readonly issues: readonly InspectionJson[];
  readonly ref: InspectionAttemptRef | undefined;
}

interface OperationalMetric {
  readonly value: number | undefined;
  readonly state: "available" | "partial" | "unavailable" | "failed";
}

/**
 * Selects the latest sealed occurrence of every Experiment/Eval/ordinal Slot
 * and closes the shared machine/Insight Overview without platform APIs.
 */
// @concord-code
// @concord-implements docs/feature/inspection/use-case/inspection-compare-quality-cost.md
// @concord-implements docs/feature/insight/README.md
export function selectInspectionOverview(
  facts: InspectionFactSource | readonly LoadedInspectionRun[],
  supportingRuns?: readonly LoadedInspectionRun[],
): InspectionOverview {
  const runs = isLoadedInspectionRuns(facts) ? facts : loadInspectionRuns(facts);
  const selected = selectLatestSlots(runs, supportingRuns ?? runs);
  return aggregateSelectedSlots(selected);
}

function aggregateSelectedSlots(selected: readonly SelectedSlot[]): InspectionOverview {
  const cells = groupSelectedSlots(selected, ({ experimentId, evalId }) => `${experimentId}\u0000${evalId}`).map(
    (slots) =>
      makeCell(
        slots,
        inspectionLabelKeys(selected.filter(({ experimentId }) => experimentId === slots[0]?.experimentId)),
      ),
  );
  const experiments = groupSelectedSlots(selected, ({ experimentId }) => experimentId).map((slots) =>
    makeExperiment(
      slots,
      cells.filter(({ experimentId }) => experimentId === slots[0]?.experimentId),
      inspectionLabelKeys(slots),
    ),
  );

  return closeOverview({
    totals: aggregate(selected, scoreFromCells(cells)),
    experiments,
    cells,
  });
}

export interface InspectionCurrentSlotInput {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly evaluationKind: "pass" | "score";
  readonly adapter: AdapterIdentity;
  readonly model: string | null;
  readonly labels: Readonly<Record<string, string>>;
  readonly recorded:
    | {
        readonly target: LoadedInspectionRun;
        readonly slot: RecordSlotIdentity;
        readonly member: MemberDocument;
        readonly resolved: ResolvedInspectionAttempt;
      }
    | undefined;
}

/** Aggregate exactly the Host-assessed current positions; gaps add no value. */
export function aggregateInspectionCurrentSlots(inputs: readonly InspectionCurrentSlotInput[]): InspectionOverview {
  return aggregateSelectedSlots(
    inputs.map((input): SelectedSlot => {
      const recorded = input.recorded;
      return {
        ...input,
        recorded:
          recorded === undefined
            ? undefined
            : {
                target: recorded.target,
                slot: recorded.slot,
                membership: { state: "member", member: recorded.member, resolved: recorded.resolved },
              },
        analysis:
          recorded === undefined
            ? {
                assertionsState: "attempt-missing" as const,
                evaluationKind: input.evaluationKind === "score" ? ("points" as const) : ("pass" as const),
                verdict: undefined,
                score: emptyAttemptScore(),
                costUSD: unavailableAttemptCost(),
                durationMs: unavailableOperationalMetric(),
                tokens: unavailableOperationalMetric(),
                coverage: [],
                issues: [],
                ref: undefined,
                stoppedAt: undefined,
              }
            : analyzeAttempt(recorded.resolved, recorded.target.run.runId, recorded.member, recorded.slot),
      };
    }),
  );
}

function isLoadedInspectionRuns(
  facts: InspectionFactSource | readonly LoadedInspectionRun[],
): facts is readonly LoadedInspectionRun[] {
  return Array.isArray(facts);
}

function selectLatestSlots(
  runs: readonly LoadedInspectionRun[],
  resolutionRuns: readonly LoadedInspectionRun[] = runs,
): readonly SelectedSlot[] {
  const membersByRun = new Map(runs.map((run) => [run, new Map(run.members.map((member) => [member.slotId, member]))]));
  const latest = new Map<string, { readonly target: LoadedInspectionRun; readonly slot: RecordSlotIdentity }>();
  for (const target of runs) {
    for (const slot of target.run.expectedSlots) {
      const key = `${target.run.experimentId}\u0000${slot.evalId}\u0000${slot.attemptOrdinal}`;
      const current = latest.get(key);
      if (current === undefined || compareOccurrence(target, current.target) > 0) {
        latest.set(key, { target, slot });
      }
    }
  }

  return [...latest.values()]
    .sort(
      (left, right) =>
        compareText(left.target.run.experimentId, right.target.run.experimentId) ||
        compareText(left.slot.evalId, right.slot.evalId) ||
        left.slot.attemptOrdinal - right.slot.attemptOrdinal ||
        compareText(left.target.run.runId, right.target.run.runId),
    )
    .map(({ target, slot }): SelectedSlot => {
      const member = membersByRun.get(target)?.get(slot.slotId);
      const resolved =
        member === undefined ? undefined : resolveInspectionMemberAttempt(resolutionRuns, target, member);
      return {
        experimentId: target.run.experimentId,
        evalId: slot.evalId,
        attemptOrdinal: slot.attemptOrdinal,
        adapter: target.run.context.execution.adapter,
        model: target.run.context.execution.model,
        labels: target.run.context.labels,
        recorded: {
          target,
          slot,
          membership: member === undefined ? { state: "missing" } : { state: "member", member, resolved },
        },
        analysis: analyzeAttempt(resolved, target.run.runId, member, slot),
      };
    });
}

function compareOccurrence(left: LoadedInspectionRun, right: LoadedInspectionRun): number {
  return (
    left.run.completedAt - right.run.completedAt ||
    left.run.startedAt - right.run.startedAt ||
    compareText(left.run.runId, right.run.runId)
  );
}

function analyzeAttempt(
  resolved: ResolvedInspectionAttempt | undefined,
  runId: string,
  member: MemberDocument | undefined,
  slot: RecordSlotIdentity,
): AttemptAnalysis {
  if (resolved === undefined) {
    const hasReference = member?.attempt !== undefined && member.attempt !== null;
    return {
      assertionsState: "attempt-missing" as const,
      evaluationKind: undefined,
      verdict: undefined,
      score: emptyAttemptScore(),
      costUSD: unavailableAttemptCost(),
      durationMs: unavailableOperationalMetric(),
      tokens: unavailableOperationalMetric(),
      coverage: [],
      issues: [overviewIssue(hasReference ? "attempt-origin-missing" : "attempt-not-observed", runId, slot)],
      ref: undefined,
      stoppedAt: undefined,
    };
  }

  const ref = attemptRef(resolved.locator);
  const operational = attemptOperationalMetrics(resolved);
  const assertions = readInspectionAssertions(resolved);
  if (assertions.state !== "available") {
    return {
      assertionsState: assertions.state,
      evaluationKind: undefined,
      verdict: attemptVerdict(resolved, assertions),
      score: emptyAttemptScore(),
      costUSD: costUSDOf(resolved),
      ...operational,
      coverage: [
        {
          identity: ref.identity,
          state: assertions.state,
        },
      ],
      issues: assertions.issues,
      ref,
      stoppedAt: undefined,
    };
  }

  let earned = 0;
  let possible = 0;
  let hasPoints = false;
  let earnedContributions = 0;
  let unavailableContributions = 0;
  const coverage: InspectionJson[] = [];
  const issues: InspectionJson[] = [];
  for (const entry of assertions.value.entries) {
    const contribution = entry.contribution;
    if (contribution.state === "earned") {
      hasPoints = true;
      earned += contribution.earned;
      possible += contribution.points;
      earnedContributions += 1;
    } else if (contribution.state === "unavailable") {
      hasPoints = true;
      possible += contribution.points;
      unavailableContributions += 1;
      issues.push({
        code: "score-contribution-unavailable",
        locator: resolved.locator,
        entryId: entry.entryId,
        reason: contribution.reason,
      });
    }
    coverage.push({
      identity: ref.identity,
      entryId: entry.entryId,
      groupPath: entry.display.groupPath,
      state: entry.materials.coverage.state,
      ...(entry.materials.coverage.state === "complete" ? {} : { reason: entry.materials.coverage.reason }),
      limitations: entry.materials.limitations.map((limitation) =>
        limitation.kind === "sampled"
          ? {
              kind: limitation.kind,
              captured: limitation.captured,
              ...(limitation.knownTotal === undefined ? {} : { knownTotal: limitation.knownTotal }),
            }
          : limitation,
      ),
    });
  }

  return {
    assertionsState: "available" as const,
    stoppedAt: stoppedAssertion(assertions),
    evaluationKind: hasPoints ? ("points" as const) : ("pass" as const),
    verdict: attemptVerdict(resolved, assertions),
    score: {
      hasPoints,
      earned,
      possible,
      hasValue: earnedContributions > 0,
      complete: hasPoints && unavailableContributions === 0,
    },
    costUSD: costUSDOf(resolved),
    ...operational,
    coverage: coverage,
    issues: issues,
    ref,
  };
}

function makeCell(slots: readonly SelectedSlot[], labelKeys: readonly string[]): InspectionOverviewCell {
  const first = slots[0];
  if (first === undefined) throw new Error("Overview cell cannot be empty");
  return {
    experimentId: first.experimentId,
    evalId: first.evalId,
    groupPath: groupPath(first.evalId),
    ...aggregate(slots, scoreForCell(slots)),
    members: slots.flatMap((selected): readonly InspectionOverviewMember[] => {
      const recorded = selected.recorded;
      if (recorded === undefined) return [];
      return [
        {
          runId: recorded.target.run.runId,
          plannedAttemptId: recorded.slot.slotId,
          evalId: recorded.slot.evalId,
          attemptOrdinal: recorded.slot.attemptOrdinal,
          labels: inspectionLabels([selected], labelKeys),
          publication: overviewPublication(selected),
          ...memberMetrics(selected),
        },
      ];
    }),
  };
}

function makeExperiment(
  slots: readonly SelectedSlot[],
  cells: readonly InspectionOverviewCell[],
  labelKeys: readonly string[],
): InspectionOverviewExperiment {
  const first = slots[0];
  if (first === undefined) throw new Error("Overview Experiment cannot be empty");
  const prefixes = new Map<string, SelectedSlot[]>();
  for (const selected of slots) {
    const path = groupPath(selected.evalId);
    for (let length = 1; length <= path.length; length += 1) {
      const prefix = path.slice(0, length);
      const key = prefix.join("\u0000");
      const values = prefixes.get(key);
      if (values === undefined) prefixes.set(key, [selected]);
      else values.push(selected);
    }
  }
  const groups = [...prefixes.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(
      ([key, values]): InspectionOverviewGroup => ({
        groupPath: key.split("\u0000"),
        ...aggregate(
          values,
          scoreFromCells(cells.filter((cell) => hasGroupPrefix(cell.groupPath, key.split("\u0000")))),
        ),
      }),
    );
  return {
    experimentId: first.experimentId,
    plugins: [
      ...new Map(
        slots
          .flatMap(({ recorded }) => recorded?.target.run.context.execution.plugins ?? [])
          .map((plugin) => [JSON.stringify(plugin), plugin]),
      ).values(),
    ],
    adapter: adapterValue(slots.map(({ adapter }) => adapter)),
    model: executionValue(slots.map(({ model }) => model)),
    labels: inspectionLabels(slots, labelKeys),
    ...aggregate(slots, scoreFromCells(cells)),
    groups: groups,
  };
}

function adapterValue(values: readonly AdapterIdentity[]): InspectionAdapterValue {
  const first = values[0];
  if (
    first === undefined ||
    values.some(
      (value) =>
        value?.name !== first?.name ||
        value?.contract !== first?.contract ||
        value?.behaviorRevision !== first?.behaviorRevision ||
        value?.cleanupTimeoutMs !== first?.cleanupTimeoutMs,
    )
  ) {
    return { state: "mixed" as const };
  }
  return { state: "available" as const, value: first };
}

function aggregate(slots: readonly SelectedSlot[], score: InspectionMetricValue): InspectionOverviewAggregate {
  const denominator = denominatorOf(slots);
  const tally = tallyOf(slots);
  const issues = uniqueJson(slots.flatMap(({ analysis }) => analysis.issues));
  return {
    evaluationKind: evaluationKindOf(slots),
    denominator,
    verdict: {
      tally,
      passRate: passRateOf(slots, denominator, tally),
    },
    score,
    costUSD: costForSlots(slots),
    durationMs: metricForSlots(slots, "durationMs", "ms", "average"),
    tokens: metricForSlots(slots, "tokens", "tokens", "sum"),
    coverage: uniqueJson(slots.flatMap(({ analysis }) => analysis.coverage)),
    issues,
  };
}

function attemptOperationalMetrics(
  resolved: ResolvedInspectionAttempt,
): Pick<AttemptAnalysis, "durationMs" | "tokens"> {
  const runnerActivities = attemptAttachment(resolved, NiceEvalRecordAttachments.runnerActivities.attempt.family);
  const timing = projectAttemptTiming({
    runnerActivities,
  });
  const durationMs = timing.activities.reduce<number | undefined>((maximum, activity) => {
    const end = activity.startOffsetMs + activity.durationMs;
    return Math.max(maximum ?? 0, end);
  }, undefined);
  const adapterUsage = attemptAttachment(resolved, NiceEvalRecordAttachments.adapterUsage.family);
  const agentTurns = attemptAttachment(resolved, NiceEvalRecordAttachments.agentTurns.family);
  const usage = projectAttemptUsage({
    models: resolved.origin.run.context.execution.models,
    agentTurns,
    adapterUsage,
    attemptCost: undefined,
    judgeUsage: undefined,
  });
  const input = usage.totals.inputTokens.value;
  const output = usage.totals.outputTokens.value;
  const tokenValues = [input, output].filter((value): value is number => value !== null);
  function tokenState(): OperationalMetric["state"] {
    if (usage.state === "invalid") return "failed";
    if (tokenValues.length === 0) return "unavailable";
    if (
      usage.state === "complete" &&
      usage.totals.inputTokens.state === "available" &&
      usage.totals.outputTokens.state === "available"
    )
      return "available";
    return "partial";
  }
  function durationState(): OperationalMetric["state"] {
    if (timing.state === "invalid") return "failed";
    if (durationMs === undefined) return "unavailable";
    return timing.state === "complete" && !timing.hasMore ? "available" : "partial";
  }
  const tokens =
    adapterUsage === undefined
      ? {
          value: tokenValues.length === 0 ? undefined : tokenValues.reduce((total, value) => total + value, 0),
          state: tokenState(),
        }
      : projectAdapterUsageTokens(adapterUsage, resolved.origin.run.context.execution.models);
  return {
    durationMs: {
      value: durationMs,
      state: durationState(),
    },
    tokens: { ...tokens, value: tokens.value ?? undefined },
  };
}

function unavailableOperationalMetric(): OperationalMetric {
  return { value: undefined, state: "unavailable" as const };
}

function metricForSlots(
  slots: readonly AnalyzedMember[],
  key: "durationMs" | "tokens",
  unit: "ms" | "tokens",
  fold: "average" | "sum",
): InspectionMetricValue {
  const valued = slots.filter(({ analysis }) => analysis[key].value !== undefined);
  const total = valued.reduce((sum, { analysis }) => sum + (analysis[key].value ?? 0), 0);
  function foldedValue(): number | null {
    if (valued.length === 0) return null;
    return fold === "average" ? total / valued.length : total;
  }
  const value = foldedValue();
  const failed = slots.some(({ analysis }) => analysis[key].state === "failed");
  const partial = valued.length < slots.length || slots.some(({ analysis }) => analysis[key].state === "partial");
  function metricState(): InspectionMetricState {
    if (failed) return "failed";
    if (valued.length === 0) return "unavailable";
    return partial ? "partial" : "available";
  }
  return {
    value,
    state: metricState(),
    samples: valued.length,
    total: slots.length,
    basis: "planned-attempt",
    issues: [],
    refs: refsOf(valued),
    unit,
    bounds: { min: 0, max: Math.max(0, value ?? 0) },
  };
}

function overviewPublication(selected: SelectedSlot): InspectionOverviewMember["publication"] {
  const recorded = selected.recorded;
  if (recorded === undefined || recorded.membership.state === "missing") return { state: "pending" as const };
  const { member, resolved } = recorded.membership;
  if (member.attempt === null) {
    return {
      state: "absent" as const,
      reason: member.absenceReason,
    };
  }
  if (resolved === undefined) {
    throw new Error(`Published Slot ${recorded.slot.slotId} has no readable Attempt`);
  }
  return {
    state: "published" as const,
    action: member.action,
    attemptId: member.attempt.attemptId,
    attemptLocator: resolved.locator,
    originRunId: member.attempt.originRunId,
    originPlannedAttemptId: resolved.attempt.slotId,
  };
}

/** Shared metrics for one planned position, including missing and unresolved publications. */
export function projectPlannedAttemptMetrics(
  runId: string,
  slot: RecordSlotIdentity,
  member: MemberDocument | undefined,
  resolved: ResolvedInspectionAttempt | undefined,
) {
  return memberMetrics({ analysis: analyzeAttempt(resolved, runId, member, slot) });
}

type AnalyzedMember = Pick<SelectedSlot, "analysis">;

const decodeMemberMetrics = Schema.decodeUnknownSync(PlannedAttemptMetricsSchema);

function memberMetrics(selected: AnalyzedMember) {
  return decodeMemberMetrics({
    verdict: selected.analysis.verdict ?? null,
    stoppedAt: selected.analysis.stoppedAt ?? { state: "unavailable", reason: "not-recorded" },
    score: scoreForMember(selected),
    costUSD: costForAnalyses([selected]),
    durationMs: metricForSlots([selected], "durationMs", "ms", "average"),
    tokens: metricForSlots([selected], "tokens", "tokens", "sum"),
  });
}

function executionValue(values: readonly (string | null)[]): InspectionExecutionValue {
  const distinct = new Set(values);
  if (distinct.size !== 1) return { state: "mixed" as const };
  const value = values[0];
  return value === null || value === undefined
    ? { state: "unavailable" as const }
    : { state: "available" as const, value };
}

function inspectionLabelKeys(slots: readonly SelectedSlot[]): readonly string[] {
  return [...new Set(slots.flatMap(({ labels }) => Object.keys(labels)))].sort(compareText);
}

function inspectionLabels(slots: readonly SelectedSlot[], keys: readonly string[]): InspectionLabels {
  return Object.fromEntries(keys.map((key) => [key, executionValue(slots.map(({ labels }) => labels[key] ?? null))]));
}

function costUSDOf(resolved: ResolvedInspectionAttempt): AttemptAnalysis["costUSD"] {
  const adapterUsage = attemptAttachment(resolved, NiceEvalRecordAttachments.adapterUsage.family);
  if (adapterUsage !== undefined) {
    const usage = projectApplicationUsage(
      {
        adapterUsage,
        agentTurns: undefined,
      },
      resolved.origin.run.context.execution.models,
    );
    const costs = usage.totals.costs;
    const usd = costs?.values.find((value) => value.currency === "USD");
    if (costs === undefined || usd === undefined) return unavailableAttemptCost();
    const value = Number(usd.value);
    if (!Number.isFinite(value) || value < 0) return unavailableAttemptCost();
    const complete = costs.state === "complete" && costs.values.length === 1 && usd.coveredCalls === costs.totalCalls;
    return {
      value,
      state: complete ? ("available" as const) : ("partial" as const),
      source: usd.source,
    };
  }
  const attachment = attemptAttachment(resolved, NiceEvalRecordAttachments.attemptCost.family);
  if (
    attachment === undefined ||
    attachment.physical.familyRevision !== NiceEvalCurrentRecordAttachments.attemptCost.revision
  )
    return unavailableAttemptCost();
  const raw = attachment.value;
  if (!Predicate.isObject(raw)) return unavailableAttemptCost();
  const decode = Schema.decodeUnknownResult(NiceEvalRecordAttachments.attemptCost.schema, {
    errors: "all",
    onExcessProperty: "error",
  });
  const observed = Reflect.has(raw, "observed") ? decode({ observed: Reflect.get(raw, "observed") }) : undefined;
  if (observed !== undefined && Result.isFailure(observed)) return unavailableAttemptCost();
  const estimated = Reflect.has(raw, "estimated") ? decode({ estimated: Reflect.get(raw, "estimated") }) : undefined;
  if (estimated !== undefined && Result.isFailure(estimated)) return unavailableAttemptCost();
  const reportedValue = observed?.success.observed?.amountUSD;
  if (reportedValue !== undefined) {
    return { value: reportedValue, state: "available", source: "reported" };
  }
  const estimatedValue = estimated?.success.estimated?.amountUSD;
  return estimatedValue === undefined
    ? unavailableAttemptCost()
    : { value: estimatedValue, state: "available", source: "estimated" };
}

function unavailableAttemptCost(): AttemptAnalysis["costUSD"] {
  return { state: "unavailable" };
}

function costForSlots(slots: readonly SelectedSlot[]): InspectionCostMetricValue {
  const unique = new Map<string, SelectedSlot>();
  for (const slot of slots) {
    const recorded = slot.recorded;
    const resolved = recorded?.membership.state === "member" ? recorded.membership.resolved : undefined;
    const key =
      resolved?.locator ??
      (recorded === undefined
        ? `current:${slot.experimentId}:${slot.evalId}:${slot.attemptOrdinal}`
        : `slot:${recorded.target.run.runId}:${recorded.slot.slotId}`);
    if (!unique.has(key)) unique.set(key, slot);
  }
  return costForAnalyses([...unique.values()]);
}

function costForAnalyses(subjects: readonly AnalyzedMember[]): InspectionCostMetricValue {
  const valued = subjects.flatMap((subject) =>
    subject.analysis.costUSD.state === "unavailable" ? [] : [{ ...subject, cost: subject.analysis.costUSD }],
  );
  const sources = new Set(valued.map(({ cost }) => cost.source));
  const hasReported = sources.has("reported") || sources.has("mixed");
  const hasEstimated = sources.has("estimated") || sources.has("mixed");
  function costSource(): InspectionCostMetricValue["source"] {
    if (hasReported && hasEstimated) return "mixed";
    if (hasReported) return "reported";
    if (hasEstimated) return "estimated";
    return null;
  }
  const source = costSource();
  function costState(): InspectionMetricState {
    if (source === null) return "unavailable";
    if (valued.length < subjects.length || valued.some(({ cost }) => cost.state !== "available")) return "partial";
    return "available";
  }
  const value = valued.length === 0 ? null : valued.reduce((sum, { cost }) => sum + cost.value, 0);
  return {
    value,
    source,
    state: costState(),
    samples: valued.length,
    total: subjects.length,
    basis: "planned-attempt" as const,
    issues: [],
    refs: refsOf(valued),
    unit: "USD" as const,
    bounds: { min: 0, max: Math.max(0, value ?? 0) },
  };
}

function denominatorOf(slots: readonly SelectedSlot[]): InspectionOverviewDenominator {
  const observed = slots.filter(
    ({ recorded }) => recorded?.membership.state === "member" && recorded.membership.resolved !== undefined,
  ).length;
  const classified = slots.filter(({ analysis }) => analysis.verdict !== undefined).length;
  return {
    expected: slots.length,
    observed,
    classified,
    missing: slots.length - observed,
  };
}

function tallyOf(slots: readonly SelectedSlot[]): InspectionVerdictTally {
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let skipped = 0;
  for (const { analysis } of slots) {
    switch (analysis.verdict) {
      case "passed":
        passed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "errored":
        errored += 1;
        break;
      case "skipped":
        skipped += 1;
        break;
      case undefined:
        break;
    }
  }
  return { passed, failed, errored, skipped };
}

function passRateOf(
  slots: readonly SelectedSlot[],
  denominator: InspectionOverviewDenominator,
  tally: InspectionVerdictTally,
): InspectionMetricValue {
  const classified = slots.filter(({ analysis }) => analysis.verdict !== undefined);
  const issues = uniqueJson(slots.flatMap(({ analysis }) => (analysis.verdict === undefined ? analysis.issues : [])));
  return {
    value: denominator.classified === 0 ? null : tally.passed / denominator.classified,
    state: metricState({
      expected: denominator.expected,
      samples: denominator.classified,
      complete: denominator.classified === denominator.expected,
      analyses: slots.map(({ analysis }) => analysis),
    }),
    samples: denominator.classified,
    total: denominator.expected,
    basis: "planned-attempt" as const,
    issues,
    refs: refsOf(classified),
  };
}

function scoreForMember(selected: AnalyzedMember): InspectionMetricValue {
  const { analysis } = selected;
  if (analysis.evaluationKind === "pass") {
    return {
      value: null,
      state: "unsupported" as const,
      samples: 0,
      total: 0,
      basis: "planned-attempt" as const,
      issues: [],
      refs: analysis.ref === undefined ? [] : [analysis.ref],
      unit: "points" as const,
      bounds: { min: 0, max: 0 },
    };
  }

  const hasValue = analysis.score.hasPoints && analysis.score.hasValue;
  const complete = hasValue && analysis.score.complete;
  function scoreState(): InspectionMetricState {
    if (complete) return "available";
    if (hasValue) return "partial";
    return metricState({ expected: 1, samples: 0, complete: false, analyses: [analysis] });
  }
  return {
    value: hasValue ? analysis.score.earned : null,
    state: scoreState(),
    samples: complete ? 1 : 0,
    total: 1,
    basis: "planned-attempt" as const,
    issues: uniqueJson([
      ...analysis.issues,
      ...(analysis.score.hasPoints && !analysis.score.complete ? [scorePartialIssue(analysis)] : []),
    ]),
    refs: analysis.ref === undefined ? [] : [analysis.ref],
    unit: "points" as const,
    bounds: { min: 0, max: analysis.score.possible },
  };
}

/** One Experiment × Eval cell: complete point Attempts are averaged. */
function scoreForCell(slots: readonly SelectedSlot[]): InspectionMetricValue {
  const knownPoints = slots.filter(({ analysis }) => analysis.evaluationKind === "points");
  const hasKnownPass = slots.some(({ analysis }) => analysis.evaluationKind === "pass");
  const unknown = slots.filter(({ analysis }) => analysis.evaluationKind === undefined);

  if (knownPoints.length === 0 && (hasKnownPass || unknown.length === 0)) {
    return {
      value: null,
      state: slots.length === 0 ? ("empty" as const) : ("unsupported" as const),
      samples: 0,
      total: 0,
      basis: "planned-attempt" as const,
      issues: [],
      refs: [],
      unit: "points" as const,
      bounds: { min: 0, max: 0 },
    };
  }

  // In mixed historical data, explicit pass Attempts are not point-eligible.
  // Unknown facts remain in the denominator once the cell is known to score.
  const eligible =
    knownPoints.length === 0 ? unknown : slots.filter(({ analysis }) => analysis.evaluationKind !== "pass");
  // Earned-score coverage is independent of gate Verdict and ranking eligibility.
  const complete = eligible.filter(
    ({ analysis }) => analysis.score.hasPoints && analysis.score.hasValue && analysis.score.complete,
  );
  const earned = complete.reduce((sum, { analysis }) => sum + analysis.score.earned, 0);
  const possible =
    complete.length === 0
      ? 0
      : complete.reduce((sum, { analysis }) => sum + analysis.score.possible, 0) / complete.length;
  const issues = uniqueJson([
    ...eligible.flatMap(({ analysis }) => analysis.issues),
    ...eligible.flatMap(({ analysis }) =>
      analysis.score.hasPoints && !analysis.score.complete ? [scorePartialIssue(analysis)] : [],
    ),
  ]);
  return {
    value: complete.length === 0 ? null : earned / complete.length,
    state: metricState({
      expected: eligible.length,
      samples: complete.length,
      complete: complete.length === eligible.length,
      analyses: eligible.map(({ analysis }) => analysis),
    }),
    samples: complete.length,
    total: eligible.length,
    basis: "planned-attempt" as const,
    issues,
    refs: refsOf(eligible),
    unit: "points" as const,
    bounds: { min: 0, max: possible },
  };
}

/** Experiment, path group, and total scores sum their visible cell means. */
function scoreFromCells(cells: readonly InspectionOverviewCell[]): InspectionMetricValue {
  if (cells.length === 0) {
    return {
      value: null,
      state: "empty" as const,
      samples: 0,
      total: 0,
      basis: "eval" as const,
      issues: [],
      refs: [],
      unit: "points" as const,
      bounds: { min: 0, max: 0 },
    };
  }
  const eligible = cells.filter(({ evaluationKind }) => evaluationKind !== "pass");
  if (eligible.length === 0) {
    return {
      value: null,
      state: "unsupported" as const,
      samples: 0,
      total: 0,
      basis: "eval" as const,
      issues: [],
      refs: [],
      unit: "points" as const,
      bounds: { min: 0, max: 0 },
    };
  }
  const valued = eligible.filter(({ score }) => score.value !== null);
  const value = valued.length === 0 ? null : valued.reduce((sum, { score }) => sum + (score.value ?? 0), 0);
  function aggregateScoreState(): InspectionMetricState {
    if (valued.length > 0) return eligible.every(({ score }) => score.state === "available") ? "available" : "partial";
    return aggregateMetricState(eligible.map(({ score }) => score.state));
  }
  return {
    value,
    state: aggregateScoreState(),
    samples: valued.length,
    total: eligible.length,
    basis: "eval" as const,
    issues: uniqueJson(eligible.flatMap(({ score }) => score.issues)),
    refs: uniqueRefs(eligible.flatMap(({ score }) => score.refs)),
    unit: "points" as const,
    bounds: {
      min: 0,
      max: eligible.reduce((sum, { score }) => sum + (score.bounds?.max ?? 0), 0),
    },
  };
}

function metricState(input: {
  readonly expected: number;
  readonly samples: number;
  readonly complete: boolean;
  readonly analyses: readonly AttemptAnalysis[];
}): InspectionMetricState {
  if (input.expected === 0) return "empty";
  if (input.samples > 0) return input.complete ? "available" : "partial";
  if (input.analyses.some(({ assertionsState }) => assertionsState === "failed")) {
    return "failed";
  }
  if (
    input.analyses.some(
      ({ assertionsState }) => assertionsState === "not-recorded" || assertionsState === "unsupported",
    ) &&
    input.analyses.every(
      ({ assertionsState }) => assertionsState !== "available" && assertionsState !== "attempt-missing",
    )
  ) {
    return "unsupported";
  }
  return "unavailable";
}

function evaluationKindOf(slots: readonly SelectedSlot[]): InspectionEvaluationKind {
  const hasPoints = slots.some(({ analysis }) => analysis.evaluationKind === "points");
  if (!hasPoints) return "pass";
  return slots.some(({ analysis }) => analysis.evaluationKind === "pass") ? "mixed" : "points";
}

function refsOf(slots: readonly AnalyzedMember[]): readonly InspectionAttemptRef[] {
  const refs = new Map<string, InspectionAttemptRef>();
  for (const { analysis } of slots) {
    if (analysis.ref !== undefined) refs.set(analysis.ref.identity.locator, analysis.ref);
  }
  return [...refs.entries()].sort(([left], [right]) => compareText(left, right)).map(([, ref]) => ref);
}

function uniqueRefs(values: readonly InspectionAttemptRef[]): readonly InspectionAttemptRef[] {
  const refs = new Map<string, InspectionAttemptRef>();
  for (const ref of values) refs.set(ref.identity.locator, ref);
  return [...refs.entries()].sort(([left], [right]) => compareText(left, right)).map(([, ref]) => ref);
}

function aggregateMetricState(states: readonly InspectionMetricState[]): InspectionMetricState {
  if (states.length === 0) return "empty";
  if (states.some((state) => state === "failed")) return "failed";
  if (states.every((state) => state === "unsupported")) return "unsupported";
  if (states.some((state) => state === "partial")) return "partial";
  return "unavailable";
}

function scorePartialIssue(analysis: AttemptAnalysis): InspectionJson {
  return {
    code: "score-partial",
    locator: analysis.ref?.identity.locator ?? null,
  };
}

function groupSelectedSlots(
  slots: readonly SelectedSlot[],
  keyOf: (slot: SelectedSlot) => string,
): readonly (readonly SelectedSlot[])[] {
  const groups = new Map<string, SelectedSlot[]>();
  for (const slot of slots) {
    const key = keyOf(slot);
    const values = groups.get(key);
    if (values === undefined) groups.set(key, [slot]);
    else values.push(slot);
  }
  return [...groups.entries()].sort(([left], [right]) => compareText(left, right)).map(([, values]) => values);
}

function groupPath(evalId: string): readonly string[] {
  const segments = evalId.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1);
}

function hasGroupPrefix(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);
}

function attemptRef(locator: string): InspectionAttemptRef {
  return {
    identity: { kind: "attempt" as const, locator },
  };
}

function emptyAttemptScore(): AttemptAnalysis["score"] {
  return {
    hasPoints: false,
    earned: 0,
    possible: 0,
    hasValue: false,
    complete: false,
  };
}

function overviewIssue(code: string, runId: string, slot: RecordSlotIdentity): InspectionJson {
  return {
    code,
    runId,
    plannedAttemptId: slot.slotId,
    evalId: slot.evalId,
    attemptOrdinal: slot.attemptOrdinal,
  };
}

function uniqueJson(values: readonly InspectionJson[]): readonly InspectionJson[] {
  const byJson = new Map<string, InspectionJson>();
  for (const value of values) byJson.set(JSON.stringify(value), value);
  return [...byJson.entries()].sort(([left], [right]) => compareText(left, right)).map(([, value]) => value);
}

function closeOverview(value: InspectionOverview): InspectionOverview {
  const closed = closeInspectionJson(value);
  if (isInspectionCodecError(closed)) {
    throw closed;
  }
  return closed as unknown as InspectionOverview;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}
