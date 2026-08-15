import {
  attemptEvidenceView,
  query,
  sourcesView,
  type AttemptEvidenceDomainView,
  type Sample,
  type SampleSnapshot,
  type SourcesDomainDetail,
  type SourcesDomainView,
} from "../../analysis/index.ts";
import {
  Callout,
  defineReport,
  Stack,
  Table,
  Text,
  type Report,
} from "../author/index.ts";
import { captureSourceShowResult } from "./attempt-evidence-json.ts";
import { registerBuiltInShowResult } from "../execution/results.ts";

const ORIGIN_ROWS_MAX = 500;

type SourcesDomainEntry = SourcesDomainView["entries"][number];
type AttemptEvidenceEntry = AttemptEvidenceDomainView["entries"][number];

export interface SourceEvidenceReportOptions {
  /** Restrict the closed source view to one captured, project-relative path. */
  readonly file?: string;
}

/**
 * Recorded source is a closed, origin-owned DomainView. This page shows
 * identity navigation and the published source view state.
 */
export function sourceEvidenceReport(input: SourceEvidenceReportOptions = {}): Report {
  const options = Object.freeze({
    ...(input.file === undefined ? {} : { file: input.file }),
  });
  const page = sourceEvidencePage(options);
  return registerBuiltInShowResult(defineReport({
    title: "Recorded source",
    pages: [page],
  }), Object.freeze({
    produce: (sample: Sample) => captureSourceShowResult(sample, options.file),
  }));
}

/** A reusable no-filter declaration for closed recorded source. */
export const defaultSourceEvidenceReport = sourceEvidenceReport();

export default defaultSourceEvidenceReport;

function sourceEvidencePage(options: SourceEvidenceReportOptions) {
  return Object.freeze({
    id: "source-evidence",
    path: "/",
    title: "Recorded source",
    load: async (sample: Sample) => {
      const [evidence, sources] = await Promise.all([
        query(sample, { kind: "domain-view", view: attemptEvidenceView }),
        query(sample, { kind: "domain-view", view: sourcesView }),
      ]);
      return Object.freeze({ snapshot: sample.snapshot, evidence, sources });
    },
    render: (input: {
      readonly snapshot: SampleSnapshot;
      readonly evidence: AttemptEvidenceDomainView;
      readonly sources: SourcesDomainView;
    }) => sourceEvidenceNode(input, options),
  });
}

function sourceEvidenceNode(input: {
  readonly snapshot: SampleSnapshot;
  readonly evidence: AttemptEvidenceDomainView;
  readonly sources: SourcesDomainView;
}, options: SourceEvidenceReportOptions) {
  const entries = [...input.sources.entries].sort(compareSourceEntries);
  const sourcesByLocator = new Map(
    entries.map((entry) => [entry.attempt.locator, entry] as const),
  );
  const evidenceByLocator = new Map(
    input.evidence.entries.map((entry) => [entry.attempt.locator, entry] as const),
  );
  const included = input.snapshot.slots
    .filter((slot) => slot.state === "included")
    .sort((left, right) =>
      compareUtf8(left.attempt.locator, right.attempt.locator)
      || compareUtf8(left.runId, right.runId)
      || compareUtf8(left.slotId, right.slotId)
    );
  const origins = included.slice(0, ORIGIN_ROWS_MAX);
  const omitted = included.length - origins.length;
  return Stack({
    children: [
      Text({ value: `Assertions: ${assertionState(origins, evidenceByLocator)}` }),
      Table({
        caption: "Origin Attempts",
        columns: [
          { key: "locator", label: "Attempt" },
          { key: "originRunId", label: "Origin Run" },
          { key: "selectedRunId", label: "Selected Run" },
          { key: "slotId", label: "Slot" },
          { key: "sourceState", label: "Sources" },
        ],
        rows: origins.map((slot) => ({
          locator: slot.attempt.locator,
          originRunId: slot.attempt.originRunId,
          selectedRunId: slot.runId,
          slotId: slot.slotId,
          sourceState: sourcesByLocator.get(slot.attempt.locator)?.state ?? "not-recorded",
        })),
      }),
      ...sourceViewMetadata(input.sources),
      ...entries.flatMap((entry) => sourceEntryNodes(entry, options.file)),
      ...(omitted === 0
        ? []
        : [Callout({
          tone: "warning",
          title: "Bounded summary",
          children: [Text({ value: `Omitted origin Attempts: ${omitted}` })],
        })]),
    ],
  });
}

/**
 * Turns the closed Sources DomainView into ordinary semantic nodes.  The
 * renderer therefore has no reason to reopen a Record, inspect a worktree, or
 * make a second query for any presentation face.
 */
function sourceEntryNodes(
  entry: SourcesDomainEntry,
  file: string | undefined,
): readonly ReturnType<typeof Callout>[] {
  if (entry.state !== "available") {
    return Object.freeze([Callout({
      tone: entry.state === "failed" || entry.state === "invalid" ? "negative" : "warning",
      title: `Sources ${entry.state}: ${entry.attempt.locator}`,
      children: [Text({ value: unavailableEntryDetail(entry) })],
    })]);
  }
  const items = [...entry.detail.items]
    .filter((item) => file === undefined || item.path === file)
    .sort((left, right) =>
      compareUtf8(left.path, right.path) || compareUtf8(left.sourceItemId, right.sourceItemId)
    );
  if (file !== undefined && items.length === 0) {
    return Object.freeze([Callout({
      tone: "warning",
      title: "Recorded source unavailable",
      children: [
        Text({ value: `Captured source file not found in annotated source tree: ${file}` }),
        Text({ value: entry.attempt.locator }),
      ],
    })]);
  }
  if (items.length === 0) {
    return Object.freeze([Callout({
      tone: "warning",
      title: `Sources available: ${entry.attempt.locator}`,
      children: [Text({ value: "The recorded Sources manifest is empty." })],
    })]);
  }
  return Object.freeze(items.map((item) => sourceItemNode(entry, item)));
}

function assertionState(
  slots: readonly Extract<SampleSnapshot["slots"][number], { readonly state: "included" }>[],
  evidenceByLocator: ReadonlyMap<string, AttemptEvidenceEntry>,
): string {
  const states = new Set(slots.map((slot) => evidenceByLocator.get(slot.attempt.locator)?.state ?? "not-recorded"));
  if (states.size === 1) return states.values().next().value ?? "not-recorded";
  return "mixed";
}

function sourceItemNode(
  entry: SourcesDomainEntry,
  item: SourcesDomainDetail["items"][number],
): ReturnType<typeof Callout> {
  const available = item.content.state === "available";
  return Callout({
    tone: available ? "neutral" : "warning",
    title: `Recorded source: ${item.path}`,
    children: [
      Table({
        caption: "Source attachment",
        columns: [
          { key: "attempt", label: "Attempt" },
          { key: "originRunId", label: "Origin Run" },
          { key: "sourceItemId", label: "Source item" },
          { key: "sha256", label: "SHA-256" },
          { key: "contentState", label: "Content" },
        ],
        rows: [{
          attempt: entry.attempt.locator,
          originRunId: entry.attempt.originRunId,
          sourceItemId: item.sourceItemId,
          sha256: item.sha256,
          contentState: item.content.state,
        }],
      }),
      Text({
        value: available
          ? item.content.text
          : `Captured source text is ${item.content.state}; no replacement content was synthesized.`,
      }),
    ],
  });
}

function sourceViewMetadata(view: SourcesDomainView): readonly ReturnType<typeof Table>[] {
  const issueRows = [...view.issues]
    .sort((left, right) =>
      compareUtf8(left.code, right.code)
      || compareUtf8(left.message, right.message)
      || compareUtf8(evidenceReferences(left.refs), evidenceReferences(right.refs))
    )
    .map((issue) => ({
      code: issue.code,
      message: issue.message,
      refs: evidenceReferences(issue.refs),
    }));
  const referenceRows = [...view.refs]
    .sort((left, right) => compareUtf8(left.identity.locator, right.identity.locator))
    .map((reference) => ({ attempt: reference.identity.locator }));
  return Object.freeze([
    ...(issueRows.length === 0
      ? []
      : [Table({
        caption: "Source view issues",
        columns: [
          { key: "code", label: "Code" },
          { key: "message", label: "Message" },
          { key: "refs", label: "Evidence" },
        ],
        rows: issueRows,
      })]),
    ...(referenceRows.length === 0
      ? []
      : [Table({
        caption: "Source view evidence",
        columns: [{ key: "attempt", label: "Attempt" }],
        rows: referenceRows,
      })]),
  ]);
}

function unavailableEntryDetail(entry: SourcesDomainEntry): string {
  return entry.state === "failed"
    ? entry.detail
    : "No captured source text is available for this Attempt; the recorded Sources state is preserved above.";
}

function evidenceReferences(
  refs: readonly { readonly identity: { readonly locator: string } }[],
): string {
  return [...refs]
    .map((reference) => reference.identity.locator)
    .sort(compareUtf8)
    .join(", ");
}

function compareSourceEntries(left: SourcesDomainEntry, right: SourcesDomainEntry): number {
  return compareUtf8(left.attempt.locator, right.attempt.locator)
    || compareUtf8(left.attempt.originRunId, right.attempt.originRunId)
    || compareUtf8(left.state, right.state);
}

function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
