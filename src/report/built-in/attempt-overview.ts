import type { AttemptLocator } from "../../attempt-locator.ts";
import {
  attemptEvidenceView,
  attemptObservabilityView,
  query,
  type AttemptEvidenceDomainView,
  type AttemptObservabilityDomainView,
  type JsonValue,
  type Sample,
  type SampleSnapshot,
} from "../../analysis/index.ts";
import {
  Callout,
  defineReport,
  Stack,
  Stat,
  Table,
  Text,
  type PlainPageDefinition,
  type Report,
} from "../author/index.ts";
import {
  loadBuiltInSummaryRows,
  type BuiltInSummaryRows,
} from "./analysis-values.ts";
import { AttemptTrace } from "./attempt-trace.ts";
import type { ReportNode, ReportTone } from "../semantic/closed.ts";

const ATTEMPT_ROWS_MAX = 200;
const ASSERTION_ROWS_MAX = 200;

interface AttemptOverviewPageInput {
  readonly snapshot: SampleSnapshot;
  readonly metrics: BuiltInSummaryRows;
  readonly evidence: AttemptEvidenceDomainView;
  readonly observability: AttemptObservabilityDomainView;
}

const attemptOverviewPage = {
  id: "attempt-overview",
  path: "/",
  title: "Attempt overview",
  load: async (sample: Sample): Promise<AttemptOverviewPageInput> => {
    const [metrics, evidence, observability] = await Promise.all([
      loadBuiltInSummaryRows(sample),
      query(sample, { kind: "domain-view", view: attemptEvidenceView }),
      query(sample, { kind: "domain-view", view: attemptObservabilityView }),
    ]);
    return Object.freeze({ snapshot: sample.snapshot, metrics, evidence, observability });
  },
  render: attemptOverviewNode,
} satisfies PlainPageDefinition<AttemptOverviewPageInput>;

/**
 * The exact-locator default. The host has already selected the immutable
 * Attempt through `selectSampleForLocator`; this Report only consumes
 * the resulting Sample and closed Metrics.
 */
export function attemptOverviewReport(): Report {
  return defineReport({
    title: "Attempt overview",
    pages: [attemptOverviewPage],
  });
}

/** The built-in default for an exact Attempt locator. */
export const defaultAttemptOverviewReport = attemptOverviewReport();

export default defaultAttemptOverviewReport;

type IncludedAttemptSlot = Extract<SampleSnapshot["slots"][number], { readonly state: "included" }>;
type AttemptEvidenceEntry = AttemptEvidenceDomainView["entries"][number];
type AttemptObservabilityEntry = AttemptObservabilityDomainView["entries"][number];

interface LocatorIndex<Entry extends { readonly attempt: { readonly locator: AttemptLocator } }> {
  readonly entries: ReadonlyMap<AttemptLocator, Entry>;
  readonly duplicates: ReadonlySet<AttemptLocator>;
}

type LocatorLookup<Entry> =
  | { readonly state: "entry"; readonly entry: Entry }
  | { readonly state: "missing" }
  | { readonly state: "duplicate" };

function attemptOverviewNode(input: AttemptOverviewPageInput): ReportNode {
  const attempts = input.snapshot.slots
    .filter((slot): slot is IncludedAttemptSlot => slot.state === "included")
    .slice(0, ATTEMPT_ROWS_MAX);
  const metrics = input.metrics[0];
  const omitted = input.snapshot.slots.filter((slot) => slot.state === "included").length - attempts.length;
  const evidence = indexEntries(input.evidence.entries);
  const observability = indexEntries(input.observability.entries);
  const locators = uniqueLocators(attempts);

  return Stack({
    children: [
      ...(metrics === undefined
        ? []
        : [
          Stat({ label: "Pass rate", value: metrics.passRate }),
          Stat({ label: "Mean latency", value: metrics.meanLatencyMs }),
          Stat({ label: "Tool failure rate", value: metrics.toolFailureRate }),
        ]),
      Table({
        caption: "Attempt identity",
        columns: [
          { key: "locator", label: "Attempt" },
          { key: "originRunId", label: "Origin Run" },
          { key: "runId", label: "Selected Run" },
          { key: "slotId", label: "Slot" },
          { key: "relation", label: "Member relation" },
        ],
        rows: attempts.map((slot) => ({
          locator: slot.attempt.locator,
          originRunId: slot.attempt.originRunId,
          runId: slot.runId,
          slotId: slot.slotId,
          relation: slot.relation,
        })),
      }),
      ...attempts.map((slot) => attemptDetailNode(
        slot,
        entryAt(evidence, slot.attempt.locator),
        entryAt(observability, slot.attempt.locator),
      )),
      ...(attempts.length === 0
        ? [Callout({
          tone: "warning",
          title: "No readable Attempt",
          children: [Text({ value: "The selected Sample has no included Attempt." })],
        })]
        : []),
      ...(omitted === 0
        ? []
        : [Callout({
          tone: "warning",
          title: "Bounded summary",
          children: [Text({ value: `${omitted} additional included Attempt(s) omitted.` })],
        })]),
      ...locators.map((locator) => AttemptTrace({ locator, mode: "execution" })),
    ],
  });
}

function indexEntries<Entry extends { readonly attempt: { readonly locator: AttemptLocator } }>(
  entries: readonly Entry[],
): LocatorIndex<Entry> {
  const byLocator = new Map<AttemptLocator, Entry>();
  const duplicates = new Set<AttemptLocator>();
  for (const entry of entries) {
    const locator = entry.attempt.locator;
    if (byLocator.has(locator)) {
      duplicates.add(locator);
      byLocator.delete(locator);
      continue;
    }
    if (!duplicates.has(locator)) byLocator.set(locator, entry);
  }
  return Object.freeze({ entries: byLocator, duplicates });
}

function entryAt<Entry>(
  index: LocatorIndex<Entry & { readonly attempt: { readonly locator: AttemptLocator } }>,
  locator: AttemptLocator,
): LocatorLookup<Entry> {
  if (index.duplicates.has(locator)) return Object.freeze({ state: "duplicate" as const });
  const entry = index.entries.get(locator);
  return entry === undefined
    ? Object.freeze({ state: "missing" as const })
    : Object.freeze({ state: "entry" as const, entry });
}

function uniqueLocators(attempts: readonly IncludedAttemptSlot[]): readonly AttemptLocator[] {
  return Object.freeze([...new Set(attempts.map((slot) => slot.attempt.locator))]);
}

function attemptDetailNode(
  slot: IncludedAttemptSlot,
  evidence: LocatorLookup<AttemptEvidenceEntry>,
  observability: LocatorLookup<AttemptObservabilityEntry>,
): ReportNode {
  return Callout({
    tone: attemptTone(evidence),
    title: `Attempt ${slot.attempt.locator}`,
    children: [
      Table({
        caption: "Attempt detail identity",
        columns: [
          { key: "originRunId", label: "Origin Run" },
          { key: "runId", label: "Selected Run" },
          { key: "slotId", label: "Slot" },
          { key: "relation", label: "Member relation" },
        ],
        rows: [{
          originRunId: slot.attempt.originRunId,
          runId: slot.runId,
          slotId: slot.slotId,
          relation: slot.relation,
        }],
      }),
      evidenceNode(evidence),
      Table({
        caption: "Closed view alignment",
        columns: [
          { key: "attempt", label: "Attempt" },
          { key: "evidence", label: "Assertion evidence" },
          { key: "observability", label: "Observability" },
        ],
        rows: [{
          attempt: slot.attempt.locator,
          evidence: lookupState(evidence),
          observability: lookupState(observability),
        }],
      }),
    ],
  });
}

function attemptTone(evidence: LocatorLookup<AttemptEvidenceEntry>): ReportTone {
  if (evidence.state !== "entry" || evidence.entry.state !== "available") return "warning";
  switch (evidence.entry.detail.verdict) {
    case "passed":
      return "positive";
    case "skipped":
      return "neutral";
    case "failed":
    case "errored":
      return "negative";
  }
}

function evidenceNode(evidence: LocatorLookup<AttemptEvidenceEntry>): ReportNode {
  if (evidence.state === "missing") {
    return Callout({
      tone: "warning",
      title: "Attempt evidence missing",
      children: [Text({ value: "No closed Assertion evidence entry matched this Attempt locator." })],
    });
  }
  if (evidence.state === "duplicate") {
    return Callout({
      tone: "negative",
      title: "Attempt evidence ambiguous",
      children: [Text({ value: "More than one closed Assertion evidence entry matched this Attempt locator." })],
    });
  }
  if (evidence.entry.state !== "available") {
    return Callout({
      tone: evidence.entry.state === "failed" ? "negative" : "warning",
      title: `Attempt evidence: ${evidence.entry.state}`,
      children: [
        ...(evidence.entry.state === "failed"
          ? [Text({ value: evidence.entry.detail })]
          : [Text({ value: "Assertions could not be closed for this Attempt." })]),
      ],
    });
  }
  const detail = evidence.entry.detail;
  const visible = detail.entries.slice(0, ASSERTION_ROWS_MAX);
  const omitted = detail.entries.length - visible.length;
  return Callout({
    tone: "neutral",
    title: "Closed evidence",
    children: [
      Callout({
        tone: verdictTone(detail.verdict),
        title: `Verdict: ${detail.verdict}`,
        children: [
          Text({ value: `Outcome: ${detail.outcome}` }),
          Text({ value: "Verdict is derived from this Attempt's Core outcome and verified Assertions." }),
        ],
      }),
      Callout({
        tone: "neutral",
        title: "Assertions",
        children: [
          Text({ value: `Recorded Assertions: ${detail.entries.length}` }),
          ...(visible.length === 0
            ? [Text({ value: "No recorded Assertions." })]
            : [Table({
              caption: "Assertions",
              columns: [
                { key: "entryId", label: "Entry" },
                { key: "display", label: "Display" },
                { key: "result", label: "Result" },
                { key: "criterion", label: "Criterion" },
                { key: "coverage", label: "Coverage" },
                { key: "limitations", label: "Limitations" },
                { key: "subject", label: "Subject" },
                { key: "evidence", label: "Evidence" },
              ],
              rows: visible.map((entry) => ({
                entryId: entry.entryId,
                display: closedJsonText(entry.display),
                result: closedJsonText(entry.result),
                criterion: closedJsonText(entry.criterion),
                coverage: closedJsonText(entry.coverage),
                limitations: closedJsonText(entry.limitations),
                subject: closedJsonText(entry.subject),
                evidence: closedJsonText(entry.evidence),
              })),
            })]),
          ...(omitted === 0
            ? []
            : [Text({ value: `${omitted} additional Assertion(s) omitted from this bounded table.` })]),
          Text({ value: `Assertion source sites: ${detail.sourceSites.length}` }),
        ],
      }),
    ],
  });
}

/**
 * Assertion payload fields are closed JSON, but their property names are not
 * Report-semantic fields. Encode them as deterministic public text before
 * placing them in a semantic table, so a user payload cannot smuggle a
 * renderer field such as `path` into the Report tree.
 */
function closedJsonText(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(closedJsonText).join(",")}]`;
  const record = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${closedJsonText(record[key]!)}`)
    .join(",")}}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lookupState(
  lookup: LocatorLookup<AttemptEvidenceEntry | AttemptObservabilityEntry>,
): string {
  return lookup.state === "entry" ? lookup.entry.state : `${lookup.state} entry`;
}

function verdictTone(
  verdict: Extract<AttemptEvidenceEntry, { readonly state: "available" }> ["detail"]["verdict"],
): ReportTone {
  switch (verdict) {
    case "passed":
      return "positive";
    case "skipped":
      return "neutral";
    case "failed":
    case "errored":
      return "negative";
  }
}
