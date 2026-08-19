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
    }
  | {
      readonly attempt: ShowTimingAttempt;
      readonly state: "failed";
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
  if (!isRecord(value.data) || value.data.kind !== "timing" || !Array.isArray(value.data.timing)) {
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
  if (value.state === "available") return isTimingDetail(value.timing);
  if (value.state === "failed") return typeof value.detail === "string";
  return value.state === "not-recorded" || value.state === "unsupported" || value.state === "invalid";
}

function isAttempt(value: unknown): value is ShowTimingAttempt {
  return isRecord(value) &&
    value.kind === "attempt" &&
    typeof value.locator === "string" &&
    typeof value.originRunId === "string";
}

function isTimingDetail(value: unknown): value is ShowTimingDetail {
  if (!isRecord(value) || !isRecord(value.collection)) return false;
  if (value.collection.state !== "complete" && value.collection.state !== "partial") return false;
  if (!Array.isArray(value.collection.limitations) || !Array.isArray(value.intervals)) return false;
  return value.intervals.every(isTimingInterval);
}

function isTimingInterval(value: unknown): value is ShowTimingInterval {
  if (!isRecord(value)) return false;
  if (
    typeof value.intervalId !== "string" ||
    typeof value.phase !== "string" ||
    typeof value.label !== "string" ||
    !isNonNegativeSafeInteger(value.startOffsetMs) ||
    !isNonNegativeSafeInteger(value.durationMs) ||
    (value.parentIntervalId !== null && typeof value.parentIntervalId !== "string")
  ) return false;
  return value.outcome === "completed" ||
    value.outcome === "failed" ||
    value.outcome === "cancelled" ||
    value.outcome === "interrupted" ||
    value.outcome === "unknown";
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
