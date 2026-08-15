import {
  attemptEvidenceView,
  attemptObservabilityView,
  query,
  sourcesView,
  type AttemptEvidenceDomainView,
  type AttemptObservabilityDomainView,
  type Sample,
  type SampleSnapshot,
  type SourcesDomainView,
} from "../../analysis/index.ts";
import type { BuiltInShowResult } from "../execution/results.ts";

type IncludedSlot = Extract<SampleSnapshot["slots"][number], { readonly state: "included" }>;
type AttemptEvidenceEntry = AttemptEvidenceDomainView["entries"][number];
type AttemptObservabilityEntry = AttemptObservabilityDomainView["entries"][number];
type SourcesEntry = SourcesDomainView["entries"][number];

export type PublicEvidence<Value> =
  | { readonly state: "available"; readonly value: Value }
  | { readonly state: "unavailable" }
  | { readonly state: "unsupported" }
  | { readonly state: "invalid" }
  | { readonly state: "not-applicable" };

export interface PublicAttemptIdentity {
  readonly locator: string;
  readonly selectedRunId: string;
  readonly originRunId: string;
  readonly slotId: string;
  readonly memberRelation: "origin" | "reference";
}

type ShowProblem = {
  readonly id: number;
  readonly code: string;
  readonly summary: string;
};

type ClosedView = { readonly issues: readonly { readonly code: string; readonly message: string }[] };

type DomainEntry<Value> =
  | { readonly state: "available"; readonly detail: Value }
  | { readonly state: "not-recorded" | "unsupported" | "invalid" }
  | { readonly state: "failed"; readonly detail: string };

/** Captures the default and historical built-in overview result during site closure. */
export async function captureLeaderboardShowResult(
  sample: Sample,
): Promise<Extract<BuiltInShowResult, { readonly kind: "leaderboard" }>> {
  const evidence = await query(sample, { kind: "domain-view", view: attemptEvidenceView });
  return Object.freeze({
    kind: "leaderboard" as const,
    snapshot: sample.snapshot,
    evidence,
  });
}

/** Captures the exact Attempt result used by the standard attempt overview. */
export async function captureAttemptShowResult(
  sample: Sample,
): Promise<Extract<BuiltInShowResult, { readonly kind: "attempt" }>> {
  const [evidence, observability] = await Promise.all([
    query(sample, { kind: "domain-view", view: attemptEvidenceView }),
    query(sample, { kind: "domain-view", view: attemptObservabilityView }),
  ]);
  return Object.freeze({
    kind: "attempt" as const,
    snapshot: sample.snapshot,
    evidence,
    observability,
  });
}

/** Captures the closed source and assertion views for the source Report. */
export async function captureSourceShowResult(
  sample: Sample,
  file: string | undefined,
): Promise<Extract<BuiltInShowResult, { readonly kind: "source" }>> {
  const [evidence, sources] = await Promise.all([
    query(sample, { kind: "domain-view", view: attemptEvidenceView }),
    query(sample, { kind: "domain-view", view: sourcesView }),
  ]);
  return Object.freeze({
    kind: "source" as const,
    snapshot: sample.snapshot,
    evidence,
    sources,
    ...(file === undefined ? {} : { file }),
  });
}

/** Captures the full observability DomainView for execution evidence JSON. */
export async function captureExecutionShowResult(
  sample: Sample,
): Promise<Extract<BuiltInShowResult, { readonly kind: "execution" }>> {
  const observability = await query(sample, { kind: "domain-view", view: attemptObservabilityView });
  return Object.freeze({
    kind: "execution" as const,
    snapshot: sample.snapshot,
    observability,
  });
}

/** Captures the same closed observability value for the timing projection. */
export async function captureTimingShowResult(
  sample: Sample,
): Promise<Extract<BuiltInShowResult, { readonly kind: "timing" }>> {
  const observability = await query(sample, { kind: "domain-view", view: attemptObservabilityView });
  return Object.freeze({
    kind: "timing" as const,
    snapshot: sample.snapshot,
    observability,
  });
}

/**
 * Translates Host-owned closed results into the stable public `niceeval.show`
 * data value.  It never accepts a Sample and cannot reopen any Record input.
 */
export function builtInShowData(input: {
  readonly result: BuiltInShowResult;
  readonly problemTable: readonly ShowProblem[];
}): Readonly<Record<string, unknown>> {
  switch (input.result.kind) {
    case "leaderboard":
      return availableData(
        [input.result.evidence],
        input.problemTable,
        leaderboardValue(input.result.snapshot, input.result.evidence),
      );
    case "attempt":
      return attemptData(input.result, input.problemTable);
    case "source":
      return sourceData(input.result, input.problemTable);
    case "execution":
      return executionData(input.result, input.problemTable);
    case "timing":
      return timingData(input.result, input.problemTable);
  }
}

/**
 * Domain JSON only carries problems raised by the closed views it actually
 * contains.  Other fully rendered page facts (for example FileChanges on the
 * Attempt terminal page) remain visible there without leaking into an
 * unrelated JSON evidence document.
 */
export function builtInShowProblemTable(input: {
  readonly result: BuiltInShowResult;
  readonly problemTable: readonly ShowProblem[];
}): readonly ShowProblem[] {
  const keys = viewIssueKeys(viewsFor(input.result));
  return Object.freeze(input.problemTable.filter((problem) =>
    keys.has(`${problem.code.replace(/^analysis-/, "")}\u0000${problem.summary}`)
  ));
}

function leaderboardValue(
  snapshot: SampleSnapshot,
  evidence: AttemptEvidenceDomainView,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    kind: "leaderboard",
    attempts: Object.freeze(includedSlots(snapshot).map((slot) => {
      const entry = entryFor(evidence.entries, slot.attempt.locator);
      return Object.freeze({
        identity: publicIdentity(slot),
        evaluation: publicEvaluation(slot, entry),
        verdict: entry !== undefined && entry.state === "available"
          ? available(entry.detail.verdict)
          : publicEvidence(entry),
      });
    })),
  });
}

function attemptData(
  result: Extract<BuiltInShowResult, { readonly kind: "attempt" }>,
  problemTable: readonly ShowProblem[],
): Readonly<Record<string, unknown>> {
  const slot = selectedSlot(result.snapshot);
  if (slot === undefined) return unavailableData([result.evidence, result.observability], problemTable);
  const evidence = entryFor(result.evidence.entries, slot.attempt.locator);
  const observability = entryFor(result.observability.entries, slot.attempt.locator);
  const observations = publicObservability(observability);
  return availableData(
    [result.evidence, result.observability],
    problemTable,
    Object.freeze({
      kind: "attempt",
      identity: publicIdentity(slot),
      evaluation: publicEvaluation(slot, evidence),
      assertions: publicAssertions(evidence),
      verdict: evidence !== undefined && evidence.state === "available"
        ? available(evidence.detail.verdict)
        : publicEvidence(evidence),
      score: scoreEvidence(evidence),
      ...observations,
    }),
  );
}

function executionData(
  result: Extract<BuiltInShowResult, { readonly kind: "execution" }>,
  problemTable: readonly ShowProblem[],
): Readonly<Record<string, unknown>> {
  const slot = selectedSlot(result.snapshot);
  if (slot === undefined) return unavailableData([result.observability], problemTable);
  const observability = entryFor(result.observability.entries, slot.attempt.locator);
  return availableData(
    [result.observability],
    problemTable,
    Object.freeze({
      kind: "attempt-execution",
      identity: publicIdentity(slot),
      evaluation: publicEvaluation(slot),
      ...publicObservability(observability),
    }),
  );
}

function timingData(
  result: Extract<BuiltInShowResult, { readonly kind: "timing" }>,
  problemTable: readonly ShowProblem[],
): Readonly<Record<string, unknown>> {
  const slot = selectedSlot(result.snapshot);
  if (slot === undefined) return unavailableData([result.observability], problemTable);
  const observability = entryFor(result.observability.entries, slot.attempt.locator);
  if (observability === undefined || observability.state !== "available") {
    return unavailableData([result.observability], problemTable);
  }
  const intervals = observability.detail.timing.intervals;
  const start = intervals.length === 0 ? undefined : Math.min(...intervals.map((interval) => interval.startOffsetMs));
  const end = intervals.length === 0
    ? undefined
    : Math.max(...intervals.map((interval) => interval.startOffsetMs + interval.durationMs));
  return availableData(
    [result.observability],
    problemTable,
    Object.freeze({
      kind: "attempt",
      locator: slot.attempt.locator,
      durationMs: start === undefined || end === undefined ? null : Math.max(0, end - start),
      phases: Object.freeze(intervals.map((interval) => Object.freeze({
        name: interval.label,
        durationMs: interval.durationMs,
      }))),
    }),
  );
}

function sourceData(
  result: Extract<BuiltInShowResult, { readonly kind: "source" }>,
  problemTable: readonly ShowProblem[],
): Readonly<Record<string, unknown>> {
  const slot = selectedSlot(result.snapshot);
  if (slot === undefined) return unavailableData([result.evidence, result.sources], problemTable);
  const sourceEntry = entryFor(result.sources.entries, slot.attempt.locator);
  const value = sourceValue(slot, sourceEntry, result.file);
  return availableData([result.evidence, result.sources], problemTable, value);
}

function sourceValue(
  slot: IncludedSlot,
  sourceEntry: SourcesEntry | undefined,
  file: string | undefined,
): Readonly<Record<string, unknown>> {
  const locator = slot.attempt.locator;
  if (sourceEntry === undefined || sourceEntry.state !== "available") {
    return Object.freeze({
      locator,
      source: null,
      unavailable: "Captured source is unavailable for this Attempt.",
    });
  }
  const items = sourceEntry.detail.items.filter((item) => file === undefined || item.path === file);
  if (file !== undefined && items.length === 0) {
    return Object.freeze({
      locator,
      source: null,
      unavailable: `Captured source file not found in annotated source tree: ${file}`,
    });
  }
  return Object.freeze({
    locator,
    source: Object.freeze({ items: Object.freeze(items.map((item) => Object.freeze({
      sourceItemId: item.sourceItemId,
      path: item.path,
      sha256: item.sha256,
      content: item.content,
    }))) }),
  });
}

function publicIdentity(slot: IncludedSlot): PublicAttemptIdentity {
  return Object.freeze({
    locator: slot.attempt.locator,
    selectedRunId: slot.runId,
    originRunId: slot.attempt.originRunId,
    slotId: slot.slotId,
    memberRelation: slot.relation,
  });
}

function publicEvaluation(
  slot: IncludedSlot,
  evidence?: AttemptEvidenceEntry,
): PublicEvidence<Readonly<Record<string, unknown>>> {
  const kind = evidence !== undefined && evidence.state === "available"
    ? evaluationKind(evidence)
    : "pass";
  return available(Object.freeze({
    experimentId: slot.experimentId,
    evalId: slot.evalId,
    attempt: slot.attemptOrdinal,
    kind,
  }));
}

function evaluationKind(entry: Extract<AttemptEvidenceEntry, { readonly state: "available" }>): "pass" | "score" {
  for (const assertion of entry.detail.entries) {
    const result = jsonRecord(assertion.result);
    const score = result === undefined ? undefined : jsonRecord(result.score);
    const state = score?.state;
    if (typeof state === "string" && state !== "not-scored") return "score";
  }
  return "pass";
}

function publicAssertions(
  entry: AttemptEvidenceEntry | undefined,
): PublicEvidence<Readonly<Record<string, unknown>>> {
  if (entry === undefined || entry.state !== "available") return publicEvidence(entry);
  return available(Object.freeze({
    // Keep the v0.12 public nesting while sourcing its content from the new
    // closed DomainView rather than the removed Projection API.
    entries: Object.freeze(entry.detail.entries.map((assertion) => Object.freeze({ entry: assertion }))),
    sourceSites: entry.detail.sourceSites,
  }));
}

function scoreEvidence(entry: AttemptEvidenceEntry | undefined): PublicEvidence<unknown> {
  if (entry === undefined || entry.state !== "available") return publicEvidence(entry);
  return evaluationKind(entry) === "pass"
    ? Object.freeze({ state: "not-applicable" as const })
    : Object.freeze({ state: "unavailable" as const });
}

function publicObservability(
  entry: AttemptObservabilityEntry | undefined,
): Readonly<Record<string, PublicEvidence<unknown>>> {
  if (entry === undefined || entry.state !== "available") {
    const state = publicEvidence(entry);
    return Object.freeze({
      conversation: state,
      commands: state,
      usage: state,
      timing: state,
      diagnostics: state,
    });
  }
  const detail = entry.detail;
  return Object.freeze({
    conversation: available(detail.conversation),
    commands: available(Object.freeze({
      collection: detail.commands.collection,
      commands: detail.commands.entries,
    })),
    usage: available(detail.usage),
    timing: available(detail.timing),
    diagnostics: available(detail.diagnostics),
  });
}

function publicEvidence<Value>(entry: DomainEntry<Value> | undefined): PublicEvidence<Value> {
  if (entry === undefined) return Object.freeze({ state: "unavailable" as const });
  switch (entry.state) {
    case "available":
      return available(entry.detail);
    case "unsupported":
      return Object.freeze({ state: "unsupported" as const });
    case "invalid":
      return Object.freeze({ state: "invalid" as const });
    case "not-recorded":
    case "failed":
      return Object.freeze({ state: "unavailable" as const });
  }
}

function available<Value>(value: Value): PublicEvidence<Value> {
  return Object.freeze({ state: "available" as const, value });
}

function availableData(
  views: readonly ClosedView[],
  problemTable: readonly ShowProblem[],
  value: unknown,
): Readonly<Record<string, unknown>> {
  const ids = problemIds(views, problemTable);
  return Object.freeze({
    state: "available",
    inputState: views.every((view) => view.issues.length === 0) ? "complete" : "partial",
    problemIds: ids,
    value,
  });
}

function unavailableData(
  views: readonly ClosedView[],
  problemTable: readonly ShowProblem[],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    state: "data-unavailable",
    problemIds: problemIds(views, problemTable),
  });
}

function problemIds(
  views: readonly ClosedView[],
  problemTable: readonly ShowProblem[],
): readonly number[] {
  const issueKeys = viewIssueKeys(views);
  return Object.freeze(problemTable
    .filter((problem) => issueKeys.has(`${problem.code.replace(/^analysis-/, "")}\u0000${problem.summary}`))
    .map((problem) => problem.id)
    .sort((left, right) => left - right));
}

function viewsFor(result: BuiltInShowResult): readonly ClosedView[] {
  switch (result.kind) {
    case "leaderboard":
      return Object.freeze([result.evidence]);
    case "attempt":
      return Object.freeze([result.evidence, result.observability]);
    case "source":
      return Object.freeze([result.evidence, result.sources]);
    case "execution":
    case "timing":
      return Object.freeze([result.observability]);
  }
}

function viewIssueKeys(views: readonly ClosedView[]): ReadonlySet<string> {
  return new Set(views.flatMap((view) => view.issues.map((issue) => `${issue.code}\u0000${issue.message}`)));
}

function selectedSlot(snapshot: SampleSnapshot): IncludedSlot | undefined {
  const slots = includedSlots(snapshot);
  return slots.length === 1 ? slots[0] : undefined;
}

function includedSlots(snapshot: SampleSnapshot): readonly IncludedSlot[] {
  return Object.freeze(snapshot.slots.filter((slot): slot is IncludedSlot => slot.state === "included"));
}

function entryFor<Entry extends { readonly attempt: { readonly locator: string } }>(
  entries: readonly Entry[],
  locator: string,
): Entry | undefined {
  const matches = entries.filter((entry) => entry.attempt.locator === locator);
  return matches.length === 1 ? matches[0] : undefined;
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, unknown>>;
}
