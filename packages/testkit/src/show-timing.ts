import type { ProcessReceipt } from "./process.js";

export interface ShowTimingInterval {
  readonly intervalId: string;
  readonly phase: string;
  readonly label: string;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly parentIntervalId: string | null;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted" | "unknown";
}

export interface ShowTimingDetail {
  readonly collection: {
    readonly state: "complete" | "partial";
    readonly limitations: readonly unknown[];
  };
  readonly intervals: readonly ShowTimingInterval[];
}

export interface ShowTimingAttempt {
  readonly kind: "attempt";
  readonly locator: string;
  readonly originRunId: string;
}

export type ShowTimingEntry =
  | {
      readonly attempt: ShowTimingAttempt;
      readonly state: "available";
      readonly timing: ShowTimingDetail;
    }
  | {
      readonly attempt: ShowTimingAttempt;
      readonly state: "not-recorded" | "unsupported" | "invalid";
      readonly view: "attempt-observability";
    }
  | {
      readonly attempt: ShowTimingAttempt;
      readonly state: "failed";
      readonly view: "attempt-observability";
      readonly detail: string;
    };

export interface ShowTimingDocument {
  readonly schema: "niceeval.show/v1";
  readonly data: {
    readonly kind: "timing";
    readonly timing: readonly ShowTimingEntry[];
  };
}

/** Strictly decode the stable public facts from `niceeval show --timing --json`. */
export function decodeShowTiming(receipt: ProcessReceipt): ShowTimingDocument {
  const value = receipt.json<unknown>();
  if (!isRecord(value) || value.schema !== "niceeval.show/v1") {
    return invalid(receipt, "schema must be niceeval.show/v1");
  }
  if (!isRecord(value.data) || !hasExactKeys(value.data, ["kind", "timing"]) ||
    value.data.kind !== "timing" || !Array.isArray(value.data.timing)) {
    return invalid(receipt, "data must be a timing document");
  }
  for (let index = 0; index < value.data.timing.length; index++) {
    if (!isTimingEntry(value.data.timing[index])) {
      return invalid(receipt, `data.timing[${index}] is invalid`);
    }
  }
  return value as unknown as ShowTimingDocument;
}

function isTimingEntry(value: unknown): value is ShowTimingEntry {
  if (!isRecord(value) || !isAttempt(value.attempt)) return false;
  if (value.state === "available") {
    return hasExactKeys(value, ["attempt", "state", "timing"]) && isTimingDetail(value.timing);
  }
  if (value.state === "failed") {
    return hasExactKeys(value, ["attempt", "detail", "state", "view"]) &&
      value.view === "attempt-observability" && typeof value.detail === "string";
  }
  return hasExactKeys(value, ["attempt", "state", "view"]) &&
    value.view === "attempt-observability" &&
    (value.state === "not-recorded" || value.state === "unsupported" || value.state === "invalid");
}

function isAttempt(value: unknown): value is ShowTimingAttempt {
  return isRecord(value) &&
    hasExactKeys(value, ["kind", "locator", "originRunId"]) &&
    value.kind === "attempt" &&
    typeof value.locator === "string" && /^@1[0-9A-HJKMNP-TV-Z]{12}$/.test(value.locator) &&
    typeof value.originRunId === "string" && isPortableSegment(value.originRunId);
}

const PORTABLE_SEGMENT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,253}[A-Za-z0-9])?$/;
const WINDOWS_RESERVED_SEGMENT_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function isPortableSegment(value: string): boolean {
  return PORTABLE_SEGMENT_PATTERN.test(value) && !WINDOWS_RESERVED_SEGMENT_PATTERN.test(value);
}

function isTimingDetail(value: unknown): value is ShowTimingDetail {
  if (!isRecord(value) || !hasExactKeys(value, ["collection", "intervals"])) return false;
  if (!isTimingCollectionState(value.collection) || !Array.isArray(value.intervals)) return false;
  if (!value.intervals.every(isTimingInterval)) return false;
  return hasCanonicalTimingIntervals(value.collection.state, value.intervals);
}

function isTimingInterval(value: unknown): value is ShowTimingInterval {
  if (!isRecord(value) || !hasExactKeys(value, [
    "durationMs",
    "intervalId",
    "label",
    "outcome",
    "parentIntervalId",
    "phase",
    "startOffsetMs",
  ])) return false;
  if (
    !isSafeIdentifier(value.intervalId) ||
    !isAttemptTimingPhase(value.phase) ||
    !isSafeIdentifier(value.label) ||
    !isNonNegativeSafeInteger(value.startOffsetMs) ||
    !isNonNegativeSafeInteger(value.durationMs) ||
    (value.parentIntervalId !== null && !isSafeIdentifier(value.parentIntervalId))
  ) return false;
  return value.outcome === "completed" ||
    value.outcome === "failed" ||
    value.outcome === "cancelled" ||
    value.outcome === "interrupted" ||
    value.outcome === "unknown";
}

const ATTEMPT_TIMING_PHASES = new Set([
  "attempt.setup",
  "sandbox.prepare",
  "agent.ensure",
  "eval.run",
  "agent.send",
  "sandbox.command",
  "assertion.evaluate",
  "verdict.fold",
  "attempt.teardown",
]);

const OBSERVABILITY_TARGETS = new Set([
  "conversation",
  "command",
  "usage",
  "timing",
  "diagnostic",
]);

const OBSERVABILITY_STAGES = new Set([
  "adapter",
  "command-capture",
  "usage-capture",
  "timing-capture",
  "diagnostic-capture",
  "attempt-finalizer",
  "run-teardown",
]);

function isTimingCollectionState(value: unknown): value is ShowTimingDetail["collection"] {
  if (!isRecord(value) || !hasExactKeys(value, ["limitations", "state"]) ||
    !Array.isArray(value.limitations)) return false;
  if (value.state === "complete") return value.limitations.length === 0;
  return value.state === "partial" && value.limitations.length > 0 &&
    value.limitations.every(isObservabilityLimitation);
}

function isObservabilityLimitation(value: unknown): boolean {
  if (!isRecord(value) || typeof value.code !== "string") return false;
  if (value.code === "capture-failed" || value.code === "capture-interrupted") {
    return hasExactKeys(value, ["code", "stage", "target"]) &&
      typeof value.stage === "string" && OBSERVABILITY_STAGES.has(value.stage) &&
      typeof value.target === "string" && OBSERVABILITY_TARGETS.has(value.target);
  }
  if (value.code === "collection-cap-reached" || value.code === "unsupported-input") {
    return hasExactKeys(value, ["code", "omittedAtLeast", "target"]) &&
      isPositiveSafeInteger(value.omittedAtLeast) &&
      typeof value.target === "string" && OBSERVABILITY_TARGETS.has(value.target);
  }
  if (value.code === "text-truncated" || value.code === "redacted") {
    return hasExactKeys(value, ["code", "replacementOrOmittedCount", "target"]) &&
      isPositiveSafeInteger(value.replacementOrOmittedCount) &&
      typeof value.target === "string" && OBSERVABILITY_TARGETS.has(value.target);
  }
  if (value.code === "stream-truncated") {
    return hasExactKeys(value, ["code", "commandId", "omittedBytes", "retainedBytes", "stream"]) &&
      isSafeIdentifier(value.commandId) &&
      (value.stream === "stdout" || value.stream === "stderr") &&
      isNonNegativeSafeInteger(value.retainedBytes) && isPositiveSafeInteger(value.omittedBytes);
  }
  if (value.code === "invalid-utf8-replaced" || value.code === "unsafe-control-stripped") {
    return hasExactKeys(value, ["code", "commandId", "count", "stream"]) &&
      isSafeIdentifier(value.commandId) &&
      (value.stream === "stdout" || value.stream === "stderr") &&
      isPositiveSafeInteger(value.count);
  }
  return false;
}

function hasCanonicalTimingIntervals(
  collectionState: "complete" | "partial",
  intervals: readonly ShowTimingInterval[],
): boolean {
  let previousId: string | undefined;
  const byId = new Map<string, ShowTimingInterval>();
  for (const interval of intervals) {
    if (previousId !== undefined && previousId >= interval.intervalId) return false;
    if (byId.has(interval.intervalId)) return false;
    if (!Number.isSafeInteger(interval.startOffsetMs + interval.durationMs)) return false;
    previousId = interval.intervalId;
    byId.set(interval.intervalId, interval);
  }
  for (const interval of intervals) {
    if (interval.parentIntervalId === null) continue;
    const parent = byId.get(interval.parentIntervalId);
    if (parent === undefined) return false;
    const intervalEnd = interval.startOffsetMs + interval.durationMs;
    const parentEnd = parent.startOffsetMs + parent.durationMs;
    if (!Number.isSafeInteger(parentEnd) || interval.startOffsetMs < parent.startOffsetMs ||
      intervalEnd > parentEnd) return false;
    const visited = new Set<string>([interval.intervalId]);
    let cursor: ShowTimingInterval | undefined = parent;
    while (cursor !== undefined) {
      if (visited.has(cursor.intervalId)) return false;
      visited.add(cursor.intervalId);
      if (cursor.parentIntervalId === null) break;
      cursor = byId.get(cursor.parentIntervalId);
      if (cursor === undefined) return false;
    }
  }
  return collectionState !== "complete" || intervals.every((interval) => interval.outcome !== "unknown");
}

function isAttemptTimingPhase(value: unknown): value is ShowTimingInterval["phase"] {
  return typeof value === "string" && ATTEMPT_TIMING_PHASES.has(value);
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function invalid(receipt: ProcessReceipt, reason: string): never {
  throw new Error(`decodeShowTiming(): ${reason}\n\n${receipt.diagnostic()}`);
}
