import type { AnalysisRun, AnalysisSample, AnalysisSlot } from "../../analysis/index.ts";
import type { EvaluationKind } from "../../eval/record/evaluation.ts";
import type { Score } from "../../eval/record/score.ts";
import type {
  AttemptTimingView,
  UsageView,
} from "../../o11y/record/family-projectors.ts";
import type { ProjectedRecordAttachmentResult } from "../../projection/attachment-result.ts";
import type { ProjectedSample, ProjectionAccess } from "../../projection/model.ts";
import type { Verdict } from "../../shared/types.ts";
import type { ClassicIdentityMap } from "./identity.ts";
import type { ClassicLocale } from "./localize.ts";
import type { ClassicExperimentProfile, ClassicSelectionOrigin } from "./origin.ts";
import {
  classicAttemptTarget,
  slotKey,
  unitKey,
  type ClassicAttemptRow,
  type ClassicEvalUnit,
  type ClassicExperimentView,
  type ClassicRunView,
  type ClassicSample,
  type ClassicVerdict,
} from "./sample.ts";

export interface ClassicProjectedInputs {
  readonly verdict?: ProjectedSample<ProjectionAccess, unknown>;
  readonly score?: ProjectedSample<ProjectionAccess, unknown>;
  readonly timing?: ProjectedSample<ProjectionAccess, unknown>;
  readonly usage?: ProjectedSample<ProjectionAccess, unknown>;
}

export function buildClassicSample(input: {
  readonly sample: AnalysisSample;
  readonly identities: ClassicIdentityMap;
  readonly projections: ClassicProjectedInputs;
  readonly selectionOrigin: ClassicSelectionOrigin;
  readonly locale: ClassicLocale;
}): ClassicSample {
  const profiles = profileIndex(input.selectionOrigin);
  const runs = Object.freeze(input.sample.runs.map(classicRunView));
  const runsById = new Map(runs.map((run) => [run.runId, run]));
  const verdicts = attemptSlotIndex(input.projections.verdict);
  const scores = attemptSlotIndex(input.projections.score);
  const timings = attemptSlotIndex(input.projections.timing);
  const usages = attemptSlotIndex(input.projections.usage);
  const units = new Map<string, {
    readonly experimentId: string;
    readonly evalId: string;
    readonly evaluationKind: EvaluationKind;
    readonly attempts: ClassicAttemptRow[];
  }>();

  for (const slot of input.sample.slots) {
    if (slot.state === "excluded") {
      continue;
    }
    const run = runsById.get(slot.runId);
    if (run === undefined) {
      throw new TypeError("a classic Sample slot must belong to a selected run");
    }
    const identity = input.identities.get(slotKey(slot.runId, slot.slotId));
    if (identity === undefined) {
      throw new TypeError("classic Sample construction requires the prevalidated identity map");
    }
    const key = unitKey(identity.experimentId, identity.evalId);
    const existing = units.get(key);
    const group = existing ?? {
      experimentId: identity.experimentId,
      evalId: identity.evalId,
      evaluationKind: identity.kind,
      attempts: [],
    };
    if (existing === undefined) {
      units.set(key, group);
    }
    group.attempts.push(projectAttempt({
      slot,
      run,
      experimentId: identity.experimentId,
      evalId: identity.evalId,
      attempt: identity.attempt,
      evaluationKind: identity.kind,
      verdict: asVerdict(verdicts.get(slotKey(slot.runId, slot.slotId))),
      score: asScore(scores.get(slotKey(slot.runId, slot.slotId))),
      timing: asTiming(timings.get(slotKey(slot.runId, slot.slotId))),
      usage: asUsage(usages.get(slotKey(slot.runId, slot.slotId))),
    }));
  }

  const evalUnits: ClassicEvalUnit[] = [...units.values()]
    .map((unit) => {
      const profile = profiles.get(unit.experimentId);
      const attempts = Object.freeze(
        [...unit.attempts].sort((left, right) => left.attempt - right.attempt),
      );
      const subjectRun = latestRun(attempts);
      return Object.freeze({
        experimentId: unit.experimentId,
        evalId: unit.evalId,
        evaluationKind: unit.evaluationKind,
        subject: Object.freeze({
          experimentId: unit.experimentId,
          evalId: unit.evalId,
          run: Object.freeze({
            runId: subjectRun.runId,
            startedAt: subjectRun.startedAt,
            completedAt: subjectRun.completedAt,
            ...(profile?.agent === undefined ? {} : { agent: profile.agent }),
            ...(profile === undefined ? {} : { experiment: experimentView(profile) }),
          }),
        }),
        attempts,
      });
    })
    .sort((left, right) =>
      compareText(left.experimentId, right.experimentId)
      || compareText(left.evalId, right.evalId)
    );

  return deepFreeze({
    metadataOrigin: input.selectionOrigin.metadataOrigin,
    locale: input.locale,
    runCount: runs.length,
    earliestRunAt: earliestRunAt(runs),
    latestRunAt: latestRunAt(runs),
    runs,
    profiles: Object.freeze(Object.fromEntries(profiles)),
    units: Object.freeze(evalUnits),
    attempts: Object.freeze(evalUnits.flatMap((unit) => unit.attempts)),
  });
}

function projectAttempt(input: {
  readonly slot: Exclude<AnalysisSlot, { readonly state: "excluded" }>;
  readonly run: ClassicRunView;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly evaluationKind: EvaluationKind;
  readonly verdict?: Verdict;
  readonly score?: Score;
  readonly timing?: AttemptTimingView;
  readonly usage?: UsageView;
}): ClassicAttemptRow {
  const attemptId = input.slot.state === "included" ? input.slot.attempt.attemptId : undefined;
  const verdict = input.slot.state === "included" ? asClassicVerdict(input.verdict) : undefined;
  return Object.freeze({
    experimentId: input.experimentId,
    evalId: input.evalId,
    attempt: input.attempt,
    runId: input.run.runId,
    startedAt: input.run.startedAt,
    completedAt: input.run.completedAt,
    ...(attemptId === undefined ? {} : { attemptId, target: classicAttemptTarget(attemptId) }),
    evaluationKind: input.evaluationKind,
    ...(verdict === undefined ? {} : { verdict }),
    ...(input.score === undefined ? {} : { score: input.score }),
    durationMs: input.timing === undefined ? null : durationMsFromTiming(input.timing),
    costUSD: input.usage === undefined ? null : costUSDFromUsage(input.usage),
    tokens: input.usage === undefined ? null : tokensFromUsage(input.usage),
  });
}

function asClassicVerdict(value: Verdict | undefined): ClassicVerdict | undefined {
  if (value === "passed" || value === "failed" || value === "errored" || value === "skipped") {
    return value;
  }
  return undefined;
}

function classicRunView(run: AnalysisRun): ClassicRunView {
  return Object.freeze({
    runId: run.runId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  });
}

function latestRun(attempts: readonly ClassicAttemptRow[]): ClassicRunView {
  const first = attempts[0];
  if (first === undefined) {
    throw new TypeError("a classic Eval unit must retain at least one Attempt row");
  }
  return attempts.reduce(
    (latest, attempt) => attempt.completedAt > latest.completedAt ? attempt : latest,
    first,
  );
}

function experimentView(profile: ClassicExperimentProfile): ClassicExperimentView {
  return Object.freeze({
    agent: profile.agent,
    ...(profile.model === undefined ? {} : { model: profile.model }),
    ...(profile.reasoningEffort === undefined ? {} : { reasoningEffort: profile.reasoningEffort }),
    flags: profile.flags,
    ...(profile.labels === undefined ? {} : { labels: profile.labels }),
    ...(profile.description === undefined ? {} : { description: profile.description }),
  });
}

function profileIndex(
  origin: ClassicSelectionOrigin,
): ReadonlyMap<string, ClassicExperimentProfile> {
  if (origin.metadataOrigin !== "current-declaration") {
    return new Map();
  }
  return new Map(origin.profiles.map((profile) => [profile.experimentId, profile]));
}

function attemptSlotIndex(
  projected: ProjectedSample<ProjectionAccess, unknown> | undefined,
): ReadonlyMap<string, ProjectedRecordAttachmentResult<unknown>> {
  const index = new Map<string, ProjectedRecordAttachmentResult<unknown>>();
  if (projected === undefined || !isAttemptSlotSample(projected)) {
    return index;
  }
  for (const entry of projected.entries) {
    if (entry.state === "attachment-result") {
      index.set(slotKey(entry.slot.runId, entry.slot.slotId), entry.attachment);
    }
  }
  return index;
}

function isAttemptSlotSample(
  value: ProjectedSample<ProjectionAccess, unknown>,
): value is ProjectedSample<"attempt-slot", unknown> {
  return value.access === "attempt-slot";
}

function asVerdict(attachment: ProjectedRecordAttachmentResult<unknown> | undefined): Verdict | undefined {
  if (attachment?.state !== "available") {
    return undefined;
  }
  const value = attachment.value;
  if (value === "passed" || value === "failed" || value === "errored" || value === "skipped") {
    return value;
  }
  return undefined;
}

function asScore(attachment: ProjectedRecordAttachmentResult<unknown> | undefined): Score | undefined {
  if (attachment?.state !== "available" || !isScore(attachment.value)) {
    return undefined;
  }
  return attachment.value;
}

function isScore(value: unknown): value is Score {
  if (typeof value !== "object" || value === null) return false;
  const state = Reflect.get(value, "state");
  if (state === "complete") {
    return typeof Reflect.get(value, "earned") === "number" && Reflect.get(value, "comparable") === true;
  }
  if (state === "partial") {
    return typeof Reflect.get(value, "earned") === "number"
      && Array.isArray(Reflect.get(value, "reasons"))
      && Reflect.get(value, "comparable") === false;
  }
  return state === "unavailable"
    && Array.isArray(Reflect.get(value, "reasons"))
    && Reflect.get(value, "comparable") === false;
}

function asTiming(
  attachment: ProjectedRecordAttachmentResult<unknown> | undefined,
): AttemptTimingView | undefined {
  if (attachment?.state !== "available" || !isTimingView(attachment.value)) {
    return undefined;
  }
  return attachment.value;
}

function asUsage(
  attachment: ProjectedRecordAttachmentResult<unknown> | undefined,
): UsageView | undefined {
  if (attachment?.state !== "available" || !isUsageView(attachment.value)) {
    return undefined;
  }
  return attachment.value;
}

function isTimingView(value: unknown): value is AttemptTimingView {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "intervals"));
}

function isUsageView(value: unknown): value is UsageView {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "observations"));
}

function durationMsFromTiming(timing: AttemptTimingView): number | null {
  if (timing.intervals.length === 0) {
    return null;
  }
  const roots = timing.intervals.filter((interval) => interval.parentIntervalId === null);
  if (roots.length === 0) {
    return Math.max(
      ...timing.intervals.map((interval) => interval.startOffsetMs + interval.durationMs),
    );
  }
  return roots.reduce((sum, interval) => sum + interval.durationMs, 0);
}

function costUSDFromUsage(usage: UsageView): number | null {
  let total = 0;
  let seen = false;
  for (const observation of usage.observations) {
    if (observation.kind !== "provider-cost" || observation.currency !== "USD") {
      continue;
    }
    const amount = Number(observation.amount);
    if (!Number.isFinite(amount)) {
      continue;
    }
    total += amount;
    seen = true;
  }
  return seen ? total : null;
}

function tokensFromUsage(usage: UsageView): number | null {
  let total = 0;
  let seen = false;
  for (const observation of usage.observations) {
    if (observation.kind !== "token-bucket") {
      continue;
    }
    total += observation.tokens;
    seen = true;
  }
  return seen ? total : null;
}

function earliestRunAt(runs: readonly ClassicRunView[]): ClassicRunView["startedAt"] | null {
  if (runs.length === 0) {
    return null;
  }
  return runs.reduce(
    (earliest, run) => (run.startedAt < earliest ? run.startedAt : earliest),
    runs[0]!.startedAt,
  );
}

function latestRunAt(runs: readonly ClassicRunView[]): ClassicRunView["completedAt"] | null {
  if (runs.length === 0) {
    return null;
  }
  return runs.reduce(
    (latest, run) => (run.completedAt > latest ? run.completedAt : latest),
    runs[0]!.completedAt,
  );
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (!Object.isFrozen(value)) {
    Object.freeze(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return value;
  }
  for (const key of Object.keys(value)) {
    const child = Object.getOwnPropertyDescriptor(value, key)?.value;
    deepFreeze(child);
  }
  return value;
}
