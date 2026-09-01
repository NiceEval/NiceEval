import { foldRecordedAttemptVerdict } from "../eval/record/verdict.ts";
import type { VerdictState } from "../eval/record/verdict.ts";
import type { MemberDocument, RecordSlotIdentity } from "../record/model/core.ts";
import {
  closeInspectionJson,
  type InspectionJson,
} from "./codec.ts";
import {
  loadInspectionRuns,
  readInspectionAssertions,
  resolveInspectionMemberAttempt,
  type InspectionAssertionsRead,
  type LoadedInspectionRun,
  type ResolvedInspectionAttempt,
} from "./facts.ts";
import { INSPECTION_RESULT_BYTE_LIMIT } from "./limits.ts";
import type { InspectionFactSource } from "./source.ts";

export type InspectionMetricState =
  | "available"
  | "partial"
  | "unavailable"
  | "empty"
  | "unsupported"
  | "failed";

export interface InspectionAttemptRef {
  readonly identity: {
    readonly kind: "attempt";
    readonly locator: string;
  };
}

export interface InspectionMetricValue {
  readonly value: number | null;
  readonly state: InspectionMetricState;
  readonly samples: number;
  readonly total: number;
  readonly basis: "slot" | "eval";
  readonly issues: readonly InspectionJson[];
  readonly refs: readonly InspectionAttemptRef[];
  readonly unit?: "points";
  readonly bounds?: {
    readonly min: number;
    readonly max: number;
  };
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
  readonly coverage: readonly InspectionJson[];
  readonly issues: readonly InspectionJson[];
}

export interface InspectionOverviewMember {
  readonly runId: string;
  readonly slotId: string;
  readonly action: MemberDocument["action"] | "pending";
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly locator: string | null;
  readonly relation: "origin" | "reference" | null;
  readonly originRunId: string | null;
  readonly score: InspectionMetricValue;
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
  readonly experimentId: string;
  readonly groups: readonly InspectionOverviewGroup[];
}

export interface InspectionOverview {
  readonly format: "niceeval.inspection.overview/v1";
  readonly totals: InspectionOverviewAggregate;
  readonly experiments: readonly InspectionOverviewExperiment[];
  readonly cells: readonly InspectionOverviewCell[];
}

interface SelectedSlot {
  readonly target: LoadedInspectionRun;
  readonly slot: RecordSlotIdentity;
  readonly member?: MemberDocument;
  readonly resolved: ResolvedInspectionAttempt | undefined;
  readonly analysis: AttemptAnalysis;
}

export interface InspectionCurrentTargetSlot {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly executionIdentityDigest: string;
}

interface AttemptAnalysis {
  readonly assertionsState: InspectionAssertionsRead["state"] | "attempt-missing";
  readonly evaluationKind: "pass" | "points" | null;
  readonly verdict: VerdictState | null;
  readonly score: {
    readonly hasPoints: boolean;
    readonly earned: number;
    readonly possible: number;
    readonly hasValue: boolean;
    readonly complete: boolean;
  };
  readonly coverage: readonly InspectionJson[];
  readonly issues: readonly InspectionJson[];
  readonly ref: InspectionAttemptRef | null;
}

/**
 * Selects the latest sealed occurrence of every Experiment/Eval/ordinal Slot
 * and closes the shared machine/Insight Overview without platform APIs.
 */
export function selectInspectionOverview(
  facts: InspectionFactSource | readonly LoadedInspectionRun[],
  currentTargets?: readonly InspectionCurrentTargetSlot[],
): InspectionOverview {
  const runs = isLoadedInspectionRuns(facts) ? facts : loadInspectionRuns(facts);
  const selected = selectLatestSlots(runs, currentTargets);
  const cells = groupSelectedSlots(selected, ({ target, slot }) =>
    `${target.run.experimentId}\u0000${slot.evalId}`)
    .map((slots) => makeCell(slots));
  const experiments = groupSelectedSlots(selected, ({ target }) =>
    target.run.experimentId)
    .map((slots) => makeExperiment(
      slots,
      cells.filter(({ experimentId }) =>
        experimentId === slots[0]?.target.run.experimentId),
    ));

  return closeOverview({
    format: "niceeval.inspection.overview/v1",
    totals: aggregate(selected, scoreFromCells(cells)),
    experiments,
    cells,
  });
}

function isLoadedInspectionRuns(
  facts: InspectionFactSource | readonly LoadedInspectionRun[],
): facts is readonly LoadedInspectionRun[] {
  return Array.isArray(facts);
}

function selectLatestSlots(
  runs: readonly LoadedInspectionRun[],
  currentTargets?: readonly InspectionCurrentTargetSlot[],
): readonly SelectedSlot[] {
  const currentByKey: ReadonlyMap<string, string> | undefined = currentTargets === undefined
    ? undefined
    : new Map(currentTargets.map((target) => [
      `${target.experimentId}\u0000${target.evalId}\u0000${target.attemptOrdinal}`,
      target.executionIdentityDigest,
    ] as const));
  const latest = new Map<string, { readonly target: LoadedInspectionRun; readonly slot: RecordSlotIdentity }>();
  for (const target of runs) {
    for (const slot of target.run.expectedSlots) {
      const key = `${target.run.experimentId}\u0000${slot.evalId}\u0000${slot.attemptOrdinal}`;
      if (currentByKey !== undefined && currentByKey.get(key) !== slot.executionIdentityDigest) continue;
      const current = latest.get(key);
      if (current === undefined || compareOccurrence(target, current.target) > 0) {
        latest.set(key, Object.freeze({ target, slot }));
      }
    }
  }

  return Object.freeze([...latest.values()]
    .sort((left, right) =>
      compareText(left.target.run.experimentId, right.target.run.experimentId) ||
      compareText(left.slot.evalId, right.slot.evalId) ||
      left.slot.attemptOrdinal - right.slot.attemptOrdinal ||
      compareText(left.target.run.runId, right.target.run.runId))
    .map(({ target, slot }): SelectedSlot => {
      const member = target.members.find((candidate) => candidate.slotId === slot.slotId);
      const resolved = member === undefined ? undefined : resolveInspectionMemberAttempt(runs, target, member);
      return Object.freeze({
        target,
        slot,
        member,
        resolved,
        analysis: analyzeAttempt(resolved, target, member, slot),
      });
    }));
}

function compareOccurrence(
  left: LoadedInspectionRun,
  right: LoadedInspectionRun,
): number {
  return left.run.completedAt - right.run.completedAt ||
    left.run.startedAt - right.run.startedAt ||
    compareText(left.run.runId, right.run.runId);
}

function analyzeAttempt(
  resolved: ResolvedInspectionAttempt | undefined,
  target: LoadedInspectionRun,
  member: MemberDocument | undefined,
  slot: RecordSlotIdentity,
): AttemptAnalysis {
  if (resolved === undefined) {
    const hasReference = member?.attempt !== undefined && member.attempt !== null;
    return Object.freeze({
      assertionsState: "attempt-missing" as const,
      evaluationKind: null,
      verdict: null,
      score: emptyAttemptScore(),
      coverage: Object.freeze([]),
      issues: Object.freeze([overviewIssue(
        hasReference ? "attempt-origin-missing" : "attempt-not-observed",
        target.run.runId,
        slot,
      )]),
      ref: null,
    });
  }

  const ref = attemptRef(resolved.locator);
  const assertions = readInspectionAssertions(resolved);
  if (assertions.state !== "available") {
    return Object.freeze({
      assertionsState: assertions.state,
      evaluationKind: null,
      verdict: null,
      score: emptyAttemptScore(),
      coverage: Object.freeze([Object.freeze({
        identity: ref.identity,
        state: assertions.state,
      })]),
      issues: assertions.issues,
      ref,
    });
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
      issues.push(Object.freeze({
        code: "score-contribution-unavailable",
        locator: resolved.locator,
        entryId: entry.entryId,
        reason: contribution.reason,
      }));
    }
    coverage.push(Object.freeze({
      identity: ref.identity,
      entryId: entry.entryId,
      groupPath: Object.freeze([...entry.display.groupPath]),
      state: entry.materials.coverage.state,
      ...(entry.materials.coverage.state === "complete"
        ? {}
        : { reason: entry.materials.coverage.reason }),
      limitations: Object.freeze([...entry.materials.limitations]),
    }));
  }

  return Object.freeze({
    assertionsState: "available" as const,
    evaluationKind: hasPoints ? "points" as const : "pass" as const,
    verdict: foldRecordedAttemptVerdict({
      outcome: resolved.attempt.outcome,
      assertions: assertions.value,
    }),
    score: Object.freeze({
      hasPoints,
      earned,
      possible,
      hasValue: earnedContributions > 0,
      complete: hasPoints && unavailableContributions === 0,
    }),
    coverage: Object.freeze(coverage),
    issues: Object.freeze(issues),
    ref,
  });
}

function makeCell(slots: readonly SelectedSlot[]): InspectionOverviewCell {
  const first = slots[0];
  if (first === undefined) throw new Error("Overview cell cannot be empty");
  return Object.freeze({
    experimentId: first.target.run.experimentId,
    evalId: first.slot.evalId,
    groupPath: groupPath(first.slot.evalId),
    ...aggregate(slots, scoreForCell(slots)),
    members: Object.freeze(slots.map((selected): InspectionOverviewMember => {
      const resolved = selected.resolved;
      return Object.freeze({
        runId: selected.target.run.runId,
        slotId: selected.slot.slotId,
        action: selected.member?.action ?? "pending",
        evalId: selected.slot.evalId,
        attemptOrdinal: selected.slot.attemptOrdinal,
        locator: resolved?.locator ?? null,
        relation: resolved === undefined
          ? null
          : resolved.attempt.originRunId === selected.target.run.runId
            ? "origin" as const
            : "reference" as const,
        originRunId: resolved?.attempt.originRunId ?? null,
        score: scoreForMember(selected),
      });
    })),
  });
}

function makeExperiment(
  slots: readonly SelectedSlot[],
  cells: readonly InspectionOverviewCell[],
): InspectionOverviewExperiment {
  const first = slots[0];
  if (first === undefined) throw new Error("Overview Experiment cannot be empty");
  const prefixes = new Map<string, SelectedSlot[]>();
  for (const selected of slots) {
    const path = groupPath(selected.slot.evalId);
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
    .map(([key, values]): InspectionOverviewGroup => Object.freeze({
      groupPath: Object.freeze(key.split("\u0000")),
      ...aggregate(
        values,
        scoreFromCells(cells.filter((cell) =>
          hasGroupPrefix(cell.groupPath, key.split("\u0000")))),
      ),
    }));
  return Object.freeze({
    experimentId: first.target.run.experimentId,
    ...aggregate(slots, scoreFromCells(cells)),
    groups: Object.freeze(groups),
  });
}

function aggregate(
  slots: readonly SelectedSlot[],
  score: InspectionMetricValue,
): InspectionOverviewAggregate {
  const denominator = denominatorOf(slots);
  const tally = tallyOf(slots);
  const issues = uniqueJson(slots.flatMap(({ analysis }) => analysis.issues));
  return Object.freeze({
    evaluationKind: evaluationKindOf(slots),
    denominator,
    verdict: Object.freeze({
      tally,
      passRate: passRateOf(slots, denominator, tally),
    }),
    score,
    coverage: uniqueJson(slots.flatMap(({ analysis }) => analysis.coverage)),
    issues,
  });
}

function denominatorOf(
  slots: readonly SelectedSlot[],
): InspectionOverviewDenominator {
  const observed = slots.filter(({ resolved }) => resolved !== undefined).length;
  const classified = slots.filter(({ analysis }) => analysis.verdict !== null).length;
  return Object.freeze({
    expected: slots.length,
    observed,
    classified,
    missing: slots.length - observed,
  });
}

function tallyOf(slots: readonly SelectedSlot[]): InspectionVerdictTally {
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let skipped = 0;
  for (const { analysis } of slots) {
    switch (analysis.verdict) {
      case "passed": passed += 1; break;
      case "failed": failed += 1; break;
      case "errored": errored += 1; break;
      case "skipped": skipped += 1; break;
      case null: break;
    }
  }
  return Object.freeze({ passed, failed, errored, skipped });
}

function passRateOf(
  slots: readonly SelectedSlot[],
  denominator: InspectionOverviewDenominator,
  tally: InspectionVerdictTally,
): InspectionMetricValue {
  const classified = slots.filter(({ analysis }) => analysis.verdict !== null);
  const issues = uniqueJson(slots.flatMap(({ analysis }) =>
    analysis.verdict === null ? analysis.issues : []));
  return Object.freeze({
    value: denominator.classified === 0 ? null : tally.passed / denominator.classified,
    state: metricState({
      expected: denominator.expected,
      samples: denominator.classified,
      complete: denominator.classified === denominator.expected,
      analyses: slots.map(({ analysis }) => analysis),
    }),
    samples: denominator.classified,
    total: denominator.expected,
    basis: "slot" as const,
    issues,
    refs: refsOf(classified),
  });
}

function scoreForMember(selected: SelectedSlot): InspectionMetricValue {
  const { analysis } = selected;
  if (analysis.evaluationKind === "pass") {
    return Object.freeze({
      value: null,
      state: "unsupported" as const,
      samples: 0,
      total: 0,
      basis: "slot" as const,
      issues: Object.freeze([]),
      refs: analysis.ref === null ? Object.freeze([]) : Object.freeze([analysis.ref]),
      unit: "points" as const,
      bounds: Object.freeze({ min: 0, max: 0 }),
    });
  }

  const hasValue = analysis.score.hasPoints && analysis.score.hasValue;
  const complete = hasValue && analysis.score.complete;
  return Object.freeze({
    value: hasValue ? analysis.score.earned : null,
    state: complete
      ? "available" as const
      : hasValue
        ? "partial" as const
        : metricState({
            expected: 1,
            samples: 0,
            complete: false,
            analyses: [analysis],
          }),
    samples: complete ? 1 : 0,
    total: 1,
    basis: "slot" as const,
    issues: uniqueJson([
      ...analysis.issues,
      ...(analysis.score.hasPoints && !analysis.score.complete
        ? [scorePartialIssue(analysis)]
        : []),
    ]),
    refs: analysis.ref === null ? Object.freeze([]) : Object.freeze([analysis.ref]),
    unit: "points" as const,
    bounds: Object.freeze({ min: 0, max: analysis.score.possible }),
  });
}

/** One Experiment × Eval cell: complete point Attempts are averaged. */
function scoreForCell(slots: readonly SelectedSlot[]): InspectionMetricValue {
  const knownPoints = slots.filter(({ analysis }) =>
    analysis.evaluationKind === "points");
  const hasKnownPass = slots.some(({ analysis }) =>
    analysis.evaluationKind === "pass");
  const unknown = slots.filter(({ analysis }) =>
    analysis.evaluationKind === null);

  if (knownPoints.length === 0 && (hasKnownPass || unknown.length === 0)) {
    return Object.freeze({
      value: null,
      state: slots.length === 0 ? "empty" as const : "unsupported" as const,
      samples: 0,
      total: 0,
      basis: "slot" as const,
      issues: Object.freeze([]),
      refs: Object.freeze([]),
      unit: "points" as const,
      bounds: Object.freeze({ min: 0, max: 0 }),
    });
  }

  // In mixed historical data, explicit pass Attempts are not point-eligible.
  // Unknown facts remain in the denominator once the cell is known to score.
  const eligible = knownPoints.length === 0
    ? unknown
    : slots.filter(({ analysis }) => analysis.evaluationKind !== "pass");
  const complete = eligible.filter(({ analysis }) =>
    analysis.score.hasPoints &&
    analysis.score.hasValue &&
    analysis.score.complete);
  const earned = complete.reduce((sum, { analysis }) =>
    sum + analysis.score.earned, 0);
  const possible = complete.length === 0
    ? 0
    : complete.reduce((sum, { analysis }) =>
        sum + analysis.score.possible, 0) / complete.length;
  const issues = uniqueJson([
    ...eligible.flatMap(({ analysis }) => analysis.issues),
    ...eligible.flatMap(({ analysis }) =>
      analysis.score.hasPoints && !analysis.score.complete
        ? [scorePartialIssue(analysis)]
        : []),
  ]);
  return Object.freeze({
    value: complete.length === 0 ? null : earned / complete.length,
    state: metricState({
      expected: eligible.length,
      samples: complete.length,
      complete: complete.length === eligible.length,
      analyses: eligible.map(({ analysis }) => analysis),
    }),
    samples: complete.length,
    total: eligible.length,
    basis: "slot" as const,
    issues,
    refs: refsOf(eligible),
    unit: "points" as const,
    bounds: Object.freeze({ min: 0, max: possible }),
  });
}

/** Experiment, path group, and total scores sum their visible cell means. */
function scoreFromCells(
  cells: readonly InspectionOverviewCell[],
): InspectionMetricValue {
  if (cells.length === 0) {
    return Object.freeze({
      value: null,
      state: "empty" as const,
      samples: 0,
      total: 0,
      basis: "eval" as const,
      issues: Object.freeze([]),
      refs: Object.freeze([]),
      unit: "points" as const,
      bounds: Object.freeze({ min: 0, max: 0 }),
    });
  }
  const eligible = cells.filter(({ evaluationKind }) =>
    evaluationKind !== "pass");
  if (eligible.length === 0) {
    return Object.freeze({
      value: null,
      state: "unsupported" as const,
      samples: 0,
      total: 0,
      basis: "eval" as const,
      issues: Object.freeze([]),
      refs: Object.freeze([]),
      unit: "points" as const,
      bounds: Object.freeze({ min: 0, max: 0 }),
    });
  }
  const valued = eligible.filter(({ score }) => score.value !== null);
  const value = valued.length === 0
    ? null
    : valued.reduce((sum, { score }) => sum + (score.value ?? 0), 0);
  const state = valued.length > 0
    ? eligible.every(({ score }) => score.state === "available")
      ? "available" as const
      : "partial" as const
    : aggregateMetricState(eligible.map(({ score }) => score.state));
  return Object.freeze({
    value,
    state,
    samples: valued.length,
    total: eligible.length,
    basis: "eval" as const,
    issues: uniqueJson(eligible.flatMap(({ score }) => score.issues)),
    refs: uniqueRefs(eligible.flatMap(({ score }) => score.refs)),
    unit: "points" as const,
    bounds: Object.freeze({
      min: 0,
      max: eligible.reduce((sum, { score }) =>
        sum + (score.bounds?.max ?? 0), 0),
    }),
  });
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
    input.analyses.some(({ assertionsState }) =>
      assertionsState === "not-recorded" || assertionsState === "unsupported") &&
    input.analyses.every(({ assertionsState }) =>
      assertionsState !== "available" && assertionsState !== "attempt-missing")
  ) {
    return "unsupported";
  }
  return "unavailable";
}

function evaluationKindOf(
  slots: readonly SelectedSlot[],
): InspectionEvaluationKind {
  const hasPoints = slots.some(({ analysis }) => analysis.evaluationKind === "points");
  if (!hasPoints) return "pass";
  return slots.some(({ analysis }) => analysis.evaluationKind === "pass")
    ? "mixed"
    : "points";
}

function refsOf(slots: readonly SelectedSlot[]): readonly InspectionAttemptRef[] {
  const refs = new Map<string, InspectionAttemptRef>();
  for (const { analysis } of slots) {
    if (analysis.ref !== null) refs.set(analysis.ref.identity.locator, analysis.ref);
  }
  return Object.freeze([...refs.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, ref]) => ref));
}

function uniqueRefs(
  values: readonly InspectionAttemptRef[],
): readonly InspectionAttemptRef[] {
  const refs = new Map<string, InspectionAttemptRef>();
  for (const ref of values) refs.set(ref.identity.locator, ref);
  return Object.freeze([...refs.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, ref]) => ref));
}

function aggregateMetricState(
  states: readonly InspectionMetricState[],
): InspectionMetricState {
  if (states.length === 0) return "empty";
  if (states.some((state) => state === "failed")) return "failed";
  if (states.every((state) => state === "unsupported")) return "unsupported";
  if (states.some((state) => state === "partial")) return "partial";
  return "unavailable";
}

function scorePartialIssue(analysis: AttemptAnalysis): InspectionJson {
  return Object.freeze({
    code: "score-partial",
    locator: analysis.ref?.identity.locator ?? null,
  });
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
  return Object.freeze([...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, values]) => Object.freeze(values)));
}

function groupPath(evalId: string): readonly string[] {
  const segments = evalId.split("/").filter((segment) => segment.length > 0);
  return Object.freeze(segments.slice(0, -1));
}

function hasGroupPrefix(
  path: readonly string[],
  prefix: readonly string[],
): boolean {
  return prefix.length <= path.length &&
    prefix.every((segment, index) => path[index] === segment);
}

function attemptRef(locator: string): InspectionAttemptRef {
  return Object.freeze({
    identity: Object.freeze({ kind: "attempt" as const, locator }),
  });
}

function emptyAttemptScore(): AttemptAnalysis["score"] {
  return Object.freeze({
    hasPoints: false,
    earned: 0,
    possible: 0,
    hasValue: false,
    complete: false,
  });
}

function overviewIssue(
  code: string,
  runId: string,
  slot: RecordSlotIdentity,
): InspectionJson {
  return Object.freeze({
    code,
    runId,
    slotId: slot.slotId,
    evalId: slot.evalId,
    attemptOrdinal: slot.attemptOrdinal,
  });
}

function uniqueJson(values: readonly InspectionJson[]): readonly InspectionJson[] {
  const byJson = new Map<string, InspectionJson>();
  for (const value of values) byJson.set(JSON.stringify(value), value);
  return Object.freeze([...byJson.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, value]) => value));
}

function closeOverview(value: InspectionOverview): InspectionOverview {
  const closed = closeInspectionJson(value);
  if (isInspectionCodecError(closed)) {
    throw closed;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(closed)).byteLength;
  if (bytes > INSPECTION_RESULT_BYTE_LIMIT) {
    throw new Error(
      `Inspection Overview exceeds its fixed ${INSPECTION_RESULT_BYTE_LIMIT}-byte limit`,
    );
  }
  return closed as unknown as InspectionOverview;
}

function isInspectionCodecError(
  value: InspectionJson | { readonly code: string; readonly reason: string },
): value is { readonly code: string; readonly reason: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Reflect.get(value, "code") === "inspection-result-invalid" &&
    typeof Reflect.get(value, "reason") === "string";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
