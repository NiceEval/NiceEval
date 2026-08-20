import { Either, Schema } from "effect";
import type { ProcessReceipt } from "./process.js";

const Exact = { errors: "all" as const, onExcessProperty: "error" as const };
const nonEmpty = (identifier: string) => Schema.String.pipe(Schema.filter((value) => value.length > 0, { identifier }));
const safeInteger = (identifier: string) => Schema.Number.pipe(Schema.filter((value) => Number.isSafeInteger(value) && value >= 0, { identifier }));
const positiveInteger = (identifier: string) => Schema.Number.pipe(Schema.filter((value) => Number.isSafeInteger(value) && value > 0, { identifier }));
const safeIdentifier = Schema.String.pipe(Schema.filter((value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value), { identifier: "SafeIdentifier" }));
const locator = Schema.String.pipe(Schema.filter((value) => /^@1[0-9A-HJKMNP-TV-Z]{12}$/.test(value), { identifier: "CanonicalAttemptLocator" }));
const portableSegment = Schema.String.pipe(Schema.filter((value) => /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,253}[A-Za-z0-9])?$/.test(value) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(value), { identifier: "PortableSegment" }));

const AttemptSchema = Schema.Struct({ kind: Schema.Literal("attempt"), locator, originRunId: portableSegment });
const IntervalSchema = Schema.Struct({ intervalId: safeIdentifier, phase: Schema.Literal("attempt.setup", "sandbox.prepare", "agent.ensure", "eval.run", "agent.send", "sandbox.command", "assertion.evaluate", "verdict.fold", "attempt.teardown"), label: safeIdentifier, startOffsetMs: safeInteger("NonNegativeSafeInteger"), durationMs: safeInteger("NonNegativeSafeInteger"), parentIntervalId: Schema.Union(safeIdentifier, Schema.Null), outcome: Schema.Literal("completed", "failed", "cancelled", "interrupted", "unknown") });
const target = Schema.Literal("conversation", "command", "usage", "timing", "diagnostic");
const limitation = Schema.Union(
  Schema.Struct({ code: Schema.Literal("capture-failed", "capture-interrupted"), stage: Schema.Literal("adapter", "command-capture", "usage-capture", "timing-capture", "diagnostic-capture", "attempt-finalizer", "run-teardown"), target }),
  Schema.Struct({ code: Schema.Literal("collection-cap-reached", "unsupported-input"), omittedAtLeast: positiveInteger("PositiveSafeInteger"), target }),
  Schema.Struct({ code: Schema.Literal("text-truncated", "redacted"), replacementOrOmittedCount: positiveInteger("PositiveSafeInteger"), target }),
  Schema.Struct({ code: Schema.Literal("stream-truncated"), commandId: safeIdentifier, stream: Schema.Literal("stdout", "stderr"), retainedBytes: safeInteger("NonNegativeSafeInteger"), omittedBytes: positiveInteger("PositiveSafeInteger") }),
  Schema.Struct({ code: Schema.Literal("invalid-utf8-replaced", "unsafe-control-stripped"), commandId: safeIdentifier, stream: Schema.Literal("stdout", "stderr"), count: positiveInteger("PositiveSafeInteger") }),
);
const TimingDetailSchema = Schema.Struct({ collection: Schema.Union(
  Schema.Struct({ state: Schema.Literal("complete"), limitations: Schema.Array(limitation).pipe(Schema.filter((values) => values.length === 0, { identifier: "CompleteTimingLimitations" })) }),
  Schema.Struct({ state: Schema.Literal("partial"), limitations: Schema.Array(limitation).pipe(Schema.filter((values) => values.length > 0, { identifier: "PartialTimingLimitations" })) }),
), intervals: Schema.Array(IntervalSchema) });
const TimingEntrySchema = Schema.Union(
  Schema.Struct({ attempt: AttemptSchema, state: Schema.Literal("available"), timing: TimingDetailSchema }),
  Schema.Struct({ attempt: AttemptSchema, state: Schema.Literal("not-recorded", "unsupported", "invalid"), view: Schema.Literal("attempt-observability") }),
  Schema.Struct({ attempt: AttemptSchema, state: Schema.Literal("failed"), view: Schema.Literal("attempt-observability"), detail: Schema.String }),
);
const LocalizedTextSchema = Schema.Union(Schema.String, Schema.Record({ key: nonEmpty("Locale"), value: Schema.String }).pipe(Schema.filter((value) => Object.keys(value).length > 0, { identifier: "LocalizedText" })));
export const ShowTimingDocumentSchema = Schema.Struct({
  schema: Schema.Literal("niceeval.show/v1"), locale: Schema.Literal("en"), selection: Schema.Struct({ kind: Schema.Literal("attempt-locator"), sampleIdentity: nonEmpty("SampleIdentity"), locator }), report: Schema.Struct({ token: nonEmpty("ReportToken"), identity: nonEmpty("ReportIdentity") }), page: Schema.Struct({ route: nonEmpty("PageRoute"), pageId: nonEmpty("PageId"), title: LocalizedTextSchema }), data: Schema.Struct({ kind: Schema.Literal("timing"), timing: Schema.Array(TimingEntrySchema) }), projections: Schema.Struct({ schema: Schema.Literal("niceeval.report-projections/v1"), pricingProfile: Schema.Unknown, costs: Schema.Array(Schema.Unknown) }), problems: Schema.Array(Schema.Struct({ code: nonEmpty("ProblemCode"), path: Schema.Array(nonEmpty("ProblemPath")), refs: Schema.Array(nonEmpty("ProblemRef")), summary: Schema.optional(nonEmpty("ProblemSummary")) })),
});
export type ShowTimingDocument = Schema.Schema.Type<typeof ShowTimingDocumentSchema>;
export type ShowTimingEntry = Schema.Schema.Type<typeof TimingEntrySchema>;
export type ShowTimingDetail = Schema.Schema.Type<typeof TimingDetailSchema>;
export type ShowTimingInterval = Schema.Schema.Type<typeof IntervalSchema>;
export type ShowTimingAttempt = Schema.Schema.Type<typeof AttemptSchema>;

export function decodeShowTiming(receipt: ProcessReceipt): ShowTimingDocument {
  const decoded = Schema.decodeUnknownEither(ShowTimingDocumentSchema, Exact)(receipt.json<unknown>());
  if (Either.isLeft(decoded)) return invalid(receipt, "document must be the exact niceeval.show/v1 timing envelope");
  const document = decoded.right;
  if (document.data.timing.length === 0 || document.data.timing.some((entry) => entry.attempt.locator !== document.selection.locator)) return invalid(receipt, "timing entries must belong to the selected Attempt locator");
  for (const entry of document.data.timing) if (entry.state === "available" && !hasCanonicalTimingIntervals(entry.timing.collection.state, entry.timing.intervals)) return invalid(receipt, "timing intervals are not canonical");
  return document;
}
function hasCanonicalTimingIntervals(collectionState: "complete" | "partial", intervals: readonly ShowTimingInterval[]): boolean {
  let previousId: string | undefined; const byId = new Map<string, ShowTimingInterval>();
  for (const interval of intervals) { if ((previousId !== undefined && previousId >= interval.intervalId) || byId.has(interval.intervalId) || !Number.isSafeInteger(interval.startOffsetMs + interval.durationMs)) return false; previousId = interval.intervalId; byId.set(interval.intervalId, interval); }
  for (const interval of intervals) { if (interval.parentIntervalId === null) continue; const parent = byId.get(interval.parentIntervalId); if (parent === undefined || interval.startOffsetMs < parent.startOffsetMs || interval.startOffsetMs + interval.durationMs > parent.startOffsetMs + parent.durationMs) return false; const visited = new Set<string>([interval.intervalId]); let cursor: ShowTimingInterval | undefined = parent; while (cursor !== undefined) { if (visited.has(cursor.intervalId)) return false; visited.add(cursor.intervalId); cursor = cursor.parentIntervalId === null ? undefined : byId.get(cursor.parentIntervalId); } }
  return collectionState !== "complete" || intervals.every((interval) => interval.outcome !== "unknown");
}
function invalid(receipt: ProcessReceipt, reason: string): never { throw new Error(`decodeShowTiming(): ${reason}\n\n${receipt.diagnostic()}`); }
