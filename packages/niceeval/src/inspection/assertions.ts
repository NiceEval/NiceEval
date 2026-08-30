import { Result, Schema } from "effect";
import { isRecordContentHandle } from "../record/attachment/content.ts";
import type {
  AssertionFactValue as RecordedAssertionFactValue,
  MatcherQueryArtifact as RecordedMatcherQueryArtifact,
  MatcherSourceSnapshot as RecordedMatcherSourceSnapshot,
} from "../assertions/record/model.ts";
import {
  projectObservedSourceEvents,
  type ObservedEventLedgerRow,
  type ObservedToolOccurrenceLedgerRow,
} from "../o11y/derive.ts";
import type { AssertionsAttachment } from "../record/family/assertions/schema.ts";
import type { SourceReceiptLimitation } from "../record/family/source-receipt/index.ts";
import type { PersistedContentMetadata } from "../record/sqlite/index.ts";
import { closeInspectionJson, type InspectionJson } from "./codec.ts";
import { InspectionSha256, utf8ByteLength } from "./bytes.ts";
import type { InspectionAssertionsRead } from "./facts.ts";
import { INSPECTION_RESULT_BYTE_LIMIT } from "./limits.ts";
import { AssertionDetailResultSchema, type AssertionDetailResult } from "./assertion-projection.ts";
import type { InspectionFactSource } from "./source.ts";
import type { InspectionAgentTurnsRead } from "./trace.ts";

const CONTENT_PAGE_SIZE = 64;

type AssertionsRead =
  | { readonly state: "not-recorded" }
  | { readonly state: "invalid"; readonly issues: readonly InspectionJson[] }
  | {
      readonly state: "available";
      readonly value: {
        readonly entries: readonly AssertionEntry[];
        readonly sourceSites: readonly AssertionSourceSite[];
      };
      readonly contents: WeakMap<object, PersistedContentMetadata>;
    };

type AssertionEntry = AssertionsAttachment["entries"][number];
type AssertionEvaluation = AssertionEntry["evaluation"];
type AssertionSourceSite = AssertionsAttachment["sourceSites"][number];
type MatcherAssertionEvaluation = Exclude<AssertionEvaluation, { readonly kind: "ordinary" }>;
type MatcherAssertionEntry = Omit<AssertionEntry, "evaluation"> & {
  readonly evaluation: MatcherAssertionEvaluation;
};

/** Compact, stable entry IDs and source positions for `attempt.get`. */
export function projectAttemptAssertionIndex(
  input: InspectionAssertionsRead,
): InspectionJson {
  const assertions = readCurrentAssertions(input);
  if (assertions.state !== "available") {
    return closeJson(Object.freeze({ state: assertions.state, entries: Object.freeze([]),
      ...(assertions.state === "invalid" ? { issues: assertions.issues } : {}),
    }));
  }
  return closeJson(Object.freeze({
    state: "available" as const,
    entries: Object.freeze(assertions.value.entries.map((entry) => Object.freeze({
      entryId: entry.entryId,
      display: entry.display,
      sourceSites: projectSourceSites(assertions.value.sourceSites, entry.entryId),
    }))),
  }));
}

/**
 * Projects one exact current Assertion revision. Undefined means the entry ID
 * does not exist in this sealed attachment; callers must surface selection
 * missing rather than selecting by ordinal, label, or source position.
 */
export function projectAttemptAssertionDetail(
  source: InspectionFactSource,
  input: InspectionAssertionsRead,
  agentTurns: InspectionAgentTurnsRead,
  entryId: string,
): AssertionDetailResult | undefined {
  const assertions = readCurrentAssertions(input);
  if (assertions.state !== "available") {
    return decodeAssertionDetail(closeJson(Object.freeze({
      entryId,
      state: assertions.state,
      ...(assertions.state === "invalid" ? { issues: assertions.issues } : {}),
      sourceSites: Object.freeze([]),
      check: missingCheck(entryId, assertions.state),
      matcher: missingMatcher(assertions.state),
    })));
  }
  const entry = assertions.value.entries.find((candidate) => candidate.entryId === entryId);
  if (entry === undefined) return undefined;
  const result = closeJson(Object.freeze({
    entryId: entry.entryId,
    display: entry.display,
    entry: projectEntry(source, entry, assertions.contents),
    sourceSites: projectSourceSites(assertions.value.sourceSites, entry.entryId),
    check: projectCheck(entry),
    matcher: projectMatcher(entry, agentTurns),
  }));
  if (jsonByteLength(result) > INSPECTION_RESULT_BYTE_LIMIT) {
    throw new Error("Assertion detail exceeds its fixed result byte limit");
  }
  return decodeAssertionDetail(result);
}

function decodeAssertionDetail(input: unknown): AssertionDetailResult {
  const decoded = Schema.decodeUnknownResult(AssertionDetailResultSchema, {
    errors: "all", onExcessProperty: "error",
  })(input);
  if (Result.isFailure(decoded)) throw new Error(`Assertion detail projection is invalid: ${String(decoded.failure)}`);
  return decoded.success;
}

function readCurrentAssertions(input: InspectionAssertionsRead): AssertionsRead {
  if (input.state === "not-recorded") {
    return Object.freeze({ state: "not-recorded" as const });
  }
  if (input.state !== "available") {
    return Object.freeze({ state: "invalid" as const, issues: input.issues });
  }
  return Object.freeze({
    state: "available" as const,
    value: input.value as unknown as {
      readonly entries: readonly AssertionEntry[];
      readonly sourceSites: readonly AssertionSourceSite[];
    },
    contents: input.contents,
  });
}

function projectSourceSites(sites: readonly AssertionSourceSite[], entryId: string): InspectionJson {
  return closeJson(Object.freeze(sites.filter((site) => site.entryId === entryId)
    .slice().sort((left, right) => left.sourceOrder - right.sourceOrder)
    .map((site) => Object.freeze({
      entryId: site.entryId,
      sourceOrder: site.sourceOrder,
      role: site.role,
      source: projectReferenceValue(site.source),
      start: Object.freeze({ line: site.start.line, column: site.start.column }),
      end: Object.freeze({ line: site.end.line, column: site.end.column }),
    }))));
}

function projectReferenceValue(reference: { readonly value: unknown }): InspectionJson {
  return closeJson(reference.value);
}

function projectEntry(
  source: InspectionFactSource,
  entry: AssertionEntry,
  contentMetadata: WeakMap<object, PersistedContentMetadata>,
): InspectionJson {
  return projectSealedValue(source, entry, contentMetadata);
}

function projectSealedValue(
  source: InspectionFactSource,
  value: unknown,
  contentMetadata: WeakMap<object, PersistedContentMetadata>,
): InspectionJson {
  if (isRecordContentHandle(value)) {
    const metadata = contentMetadata.get(value);
    if (metadata === undefined) throw new Error("Assertion content metadata is invalid");
    return closeJson(Object.freeze({
      state: "available" as const,
      byteLength: metadata.byteLength,
      sha256: metadata.digest,
      base64: base64(readSealedBytes(source, metadata)),
    }));
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return closeJson(value);
  }
  if (Array.isArray(value)) return closeJson(Object.freeze(value.map((item) => projectSealedValue(source, item, contentMetadata))));
  if (typeof value !== "object") throw new Error("Assertion entry contains an unsupported value");
  const output: Record<string, InspectionJson> = {};
  for (const key of Object.keys(value).sort()) {
    output[key] = projectSealedValue(source, Reflect.get(value, key), contentMetadata);
  }
  return closeJson(Object.freeze(output));
}

function projectCheck(entry: AssertionEntry): InspectionJson {
  const expected = policyExpected(entry.policy);
  const observed = entry.evaluation.observed;
  return diagnosticNode(
    entry.display.label ?? entry.display.key ?? entry.entryId,
    entry.decision.result,
    expected,
    observed,
    entry.decision.reason,
    null,
    diagnosticChildren(entry),
  );
}

function diagnosticChildren(entry: AssertionEntry): readonly InspectionJson[] {
  const retained = entry.explanationRetention as { readonly state?: string; readonly value?: unknown };
  const legacy = entry.evaluation.kind === "matcher-legacy" ? entry.evaluation.legacyDiagnostic : undefined;
  const value = retained?.state === "retained" ? retained.value : legacy;
  return value === undefined ? Object.freeze([]) : Object.freeze([diagnosticValueNode(value, "diagnostic")]);
}

function diagnosticValueNode(value: unknown, label: string): InspectionJson {
  if (isRecord(value) && Array.isArray(value.children)) {
    return diagnosticNode(
      typeof value.label === "string" ? value.label : label,
      typeof value.state === "string" ? value.state : "available",
      value.expected ?? null,
      value.observed ?? value,
      typeof value.reason === "string" ? value.reason : null,
      value.anchor ?? null,
      Object.freeze(value.children.map((child) => diagnosticValueNode(child, "diagnostic"))),
    );
  }
  if (isRecord(value) && Array.isArray(value.fields)) {
    return diagnosticNode(label, "available", null, value, null, null, Object.freeze(value.fields.map((field) =>
      isRecord(field) ? diagnosticValueNode(field.value, typeof field.label === "string" ? field.label : "diagnostic") : diagnosticValueNode(field, "diagnostic"),
    )));
  }
  return diagnosticNode(label, "available", null, value, null, null, Object.freeze([]));
}

function diagnosticNode(
  label: string,
  state: string,
  expected: unknown,
  observed: unknown,
  reason: string | null,
  anchor: unknown,
  children: readonly InspectionJson[],
): InspectionJson {
  return closeJson(Object.freeze({
    label,
    state,
    expected: expected === undefined ? null : expected,
    observed: observed === undefined ? null : observed,
    reason,
    anchor: anchor === undefined ? null : anchor,
    children: Object.freeze([...children]),
  }));
}

function policyExpected(policy: unknown): unknown | null {
  if (!isRecord(policy) || !isRecord(policy.condition) || policy.condition.state !== "available") return null;
  return policy.condition.value ?? null;
}

function projectMatcher(
  entry: AssertionEntry,
  agentTurns: InspectionAgentTurnsRead,
): InspectionJson {
  const evaluation = entry.evaluation;
  if (evaluation.kind === "ordinary") return closeJson(Object.freeze({
    state: "ordinary" as const, sourceState: null, comparator: null, sourceLedger: evaluation.receipt ?? null,
    receipt: evaluation.receipt ?? null, result: null, targets: Object.freeze([]), debugger: null,
    sandboxCommandJoin: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
  }));
  if (evaluation.kind === "matcher-legacy") return closeJson(Object.freeze({
    state: "legacy" as const, sourceState: "unavailable", comparator: null, sourceLedger: null,
    receipt: null, result: null, targets: Object.freeze([]), reason: evaluation.reason,
    debugger: projectMatcherDebugger(entry as MatcherAssertionEntry, agentTurns),
    sandboxCommandJoin: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
  }));
  const artifact = evaluation.artifact;
  const comparator = artifact.kind === "collection-filter" ? artifact.query ?? null : artifact.querySteps ?? null;
  return closeJson(Object.freeze({
    state: "available" as const,
    sourceState: artifact.sourceSnapshot.collectionAtCut,
    comparator,
    sourceLedger: Object.freeze({ sourceSnapshot: artifact.sourceSnapshot, receipt: artifact.receipt }),
    receipt: artifact.receipt,
    result: artifact.kind === "ordered-sequence" ? artifact.result : null,
    debugger: projectMatcherDebugger(entry as MatcherAssertionEntry, agentTurns),
    targets: Object.freeze(artifact.retainedRows.map((row) => Object.freeze({
      state: row.result,
      anchor: row.locator.kind === "tool-occurrence"
        ? Object.freeze({ kind: "tool-occurrence" as const, toolOccurrenceId: row.locator.toolOccurrenceId })
        : Object.freeze({ kind: "event" as const, eventId: row.locator.eventId }),
      difference: row.difference ?? null,
    }))),
    sandboxCommandJoin: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
  }));
}

type MatcherConversationTarget =
  | Readonly<{
      readonly state: "exact";
      readonly turnId: string;
      readonly eventId: string;
      readonly anchor: string;
    }>
  | Readonly<{
      readonly state: "unavailable";
      readonly reason: "historical-not-recorded" | "source-unavailable" | "ambiguous";
    }>;

type MatcherSourceLocator =
  | Readonly<{ readonly kind: "tool-occurrence"; readonly toolOccurrenceId: string }>
  | Readonly<{ readonly kind: "event"; readonly eventId: string }>;

interface MatcherFilterRow {
  readonly kind: "tool" | "event" | "legacy-source-row";
  readonly rowId: string;
  readonly number: string;
  readonly phase: "at-evaluation" | "outside-evaluation-snapshot" | "historical";
  readonly summary: string;
  readonly detail: InspectionJson;
  readonly locator?: MatcherSourceLocator;
  readonly evaluation: Readonly<{
    readonly result:
      | "matched"
      | "mismatched"
      | "unavailable"
      | "not-evaluated"
      | "not-retained"
      | "outside-snapshot"
      | "legacy";
    readonly difference?: InspectionJson;
  }>;
  readonly conversationTarget: MatcherConversationTarget;
}

function factValue(value: null | boolean | number | string): InspectionJson {
  return closeJson(Object.freeze({ kind: "value" as const, value }));
}

function factFields(
  fields: readonly { readonly label: string; readonly value: InspectionJson }[],
): InspectionJson {
  return closeJson(Object.freeze({
    kind: "fields" as const,
    fields: Object.freeze(fields.map((field) => Object.freeze(field))),
  }));
}

function closeRecordedAssertionFact(value: RecordedAssertionFactValue): InspectionJson {
  switch (value.kind) {
    case "unavailable":
      return closeJson(Object.freeze({ kind: value.kind, reason: value.reason }));
    case "value":
      return closeJson(Object.freeze({ kind: value.kind, value: value.value }));
    case "text":
      return closeJson(Object.freeze({ kind: value.kind, text: value.text }));
    case "list":
      return closeJson(Object.freeze({
        kind: value.kind,
        items: Object.freeze(value.items.map(closeRecordedAssertionFact)),
      }));
    case "fields":
      return closeJson(Object.freeze({
        kind: value.kind,
        fields: Object.freeze(value.fields.map((field) => Object.freeze({
          label: field.label,
          value: closeRecordedAssertionFact(field.value),
        }))),
      }));
  }
}

function sourceLimitationFact(limitation: SourceReceiptLimitation): InspectionJson {
  return factFields([
    { label: "code", value: factValue(limitation.code) },
    { label: "target", value: factValue(limitation.target) },
    ...("stage" in limitation
      ? [{ label: "stage", value: factValue(limitation.stage) }]
      : "omittedAtLeast" in limitation
      ? [{ label: "omittedAtLeast", value: factValue(limitation.omittedAtLeast) }]
      : [{
          label: "replacementOrOmittedCount",
          value: factValue(limitation.replacementOrOmittedCount),
        }]),
  ]);
}

function matcherSubject(entry: MatcherAssertionEntry): "tool" | "event" | "source-row" {
  if (entry.criterion.state === "available") {
    const criterion = entry.criterion.value;
    if (
      criterion.kind === "builtin" &&
      (criterion.id === "occurrence/v1" || criterion.id === "occurrence/v2") &&
      isRecord(criterion.data)
    ) {
      const occurrence = criterion.data.occurrence;
      if (occurrence === "tool" || occurrence === "event") return occurrence;
    }
  }
  if (entry.evaluation.kind === "matcher-current") {
    const artifact = entry.evaluation.artifact;
    const locator = artifact.kind === "collection-filter"
      ? artifact.retainedRows[0]?.locator
      : artifact.result.state === "matched"
      ? artifact.result.witnessPath[0]?.locator
      : artifact.result.state === "mismatched"
      ? artifact.result.failureFrontier.longestPossiblePrefix[0]?.locator
      : artifact.retainedRows[0]?.locator;
    if (locator?.kind === "tool-occurrence") return "tool";
    if (locator?.kind === "event") return "event";
  }
  return "source-row";
}

function unavailableMatcherTarget(
  reason: "historical-not-recorded" | "source-unavailable" | "ambiguous",
): MatcherConversationTarget {
  return Object.freeze({ state: "unavailable" as const, reason });
}

function exactMatcherTarget(
  row: ObservedEventLedgerRow,
  anchor: string,
): MatcherConversationTarget {
  return Object.freeze({
    state: "exact" as const,
    turnId: row.turnId,
    eventId: row.eventId,
    anchor,
  });
}

function sourceUnavailableCollection(
  reason: "historical-not-recorded" | "source-unavailable" | "ambiguous",
): InspectionJson {
  return closeJson(Object.freeze({
    state: "unavailable" as const,
    reason,
    rows: Object.freeze([]),
    limitations: Object.freeze([]),
  }));
}

function currentSourceCollection(
  state: "complete" | "partial",
  rows: readonly MatcherFilterRow[],
  limitations: readonly SourceReceiptLimitation[],
): InspectionJson {
  return closeJson(Object.freeze({
    state,
    rows: Object.freeze([...rows]),
    limitations: Object.freeze(limitations.map(sourceLimitationFact)),
  }));
}

function matcherLocatorKey(locator: MatcherSourceLocator): string {
  return locator.kind === "tool-occurrence"
    ? `tool:${locator.toolOccurrenceId}`
    : `event:${locator.eventId}`;
}

function closeMatcherLocator(
  locator: RecordedMatcherQueryArtifact["retainedRows"][number]["locator"],
): MatcherSourceLocator {
  return locator.kind === "tool-occurrence"
    ? Object.freeze({ kind: locator.kind, toolOccurrenceId: locator.toolOccurrenceId })
    : Object.freeze({ kind: locator.kind, eventId: locator.eventId });
}

function eventSummary(row: ObservedEventLedgerRow): string {
  const event = row.event;
  switch (event.kind) {
    case "message": return `${event.role}: ${event.text}`;
    case "tool-start": return `${event.tool} started`;
    case "tool-finish": return `tool ${event.outcome}`;
    case "thinking-summary":
    case "compaction":
    case "context-injection": return event.summary;
    case "subagent": return `${event.label} ${event.state}`;
    case "input-request": return `${event.state}: ${event.promptSummary}`;
    case "skill-load":
    case "conversation-error": return `${event.code}: ${event.summary}`;
  }
}

function eventDetail(row: ObservedEventLedgerRow): InspectionJson {
  const event = row.event;
  const common = [
    { label: "type", value: factValue(event.kind) },
    { label: "turn", value: factValue(row.turnId) },
    { label: "sessionSequence", value: factValue(row.sessionSequence) },
  ];
  switch (event.kind) {
    case "message":
      return factFields([...common,
        { label: "role", value: factValue(event.role) },
        { label: "text", value: factValue(event.text) },
      ]);
    case "tool-start":
      return factFields([...common,
        { label: "name", value: factValue(event.tool) },
        { label: "input", value: factValue(event.inputSummary) },
        { label: "toolOccurrenceId", value: factValue(event.toolOccurrenceId) },
      ]);
    case "tool-finish":
      return factFields([...common,
        { label: "status", value: factValue(event.outcome) },
        { label: "output", value: factValue(event.outputSummary) },
        { label: "relation", value: factValue(event.occurrence.state === "exact"
          ? event.occurrence.toolOccurrenceId
          : event.occurrence.reason) },
      ]);
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      return factFields([...common, { label: "summary", value: factValue(event.summary) }]);
    case "subagent":
      return factFields([...common,
        { label: "name", value: factValue(event.label) },
        { label: "state", value: factValue(event.state) },
        { label: "summary", value: factValue(event.summary) },
      ]);
    case "input-request":
      return factFields([...common,
        { label: "state", value: factValue(event.state) },
        { label: "prompt", value: factValue(event.promptSummary) },
        { label: "response", value: factValue(event.responseSummary) },
      ]);
    case "skill-load":
    case "conversation-error":
      return factFields([...common,
        { label: "code", value: factValue(event.code) },
        { label: "summary", value: factValue(event.summary) },
      ]);
  }
}

function toolDetail(
  occurrence: ObservedToolOccurrenceLedgerRow,
  eventsById: ReadonlyMap<string, ObservedEventLedgerRow>,
): Readonly<{
  readonly summary: string;
  readonly detail: InspectionJson;
  readonly target: MatcherConversationTarget;
}> | undefined {
  const start = eventsById.get(occurrence.startEventId);
  if (start?.event.kind !== "tool-start") return undefined;
  const finish = occurrence.finish === null ? undefined : eventsById.get(occurrence.finish.eventId);
  return Object.freeze({
    summary: start.event.tool,
    detail: factFields([
      { label: "name", value: factValue(start.event.tool) },
      { label: "input", value: factValue(start.event.inputSummary) },
      { label: "status", value: factValue(
        finish?.event.kind === "tool-finish" ? finish.event.outcome : "pending",
      ) },
      { label: "output", value: factValue(
        finish?.event.kind === "tool-finish" ? finish.event.outputSummary : null,
      ) },
      { label: "homeTurn", value: factValue(occurrence.homeTurnId) },
      { label: "finishTurn", value: factValue(occurrence.finish?.turnId ?? null) },
    ]),
    target: exactMatcherTarget(start, `tool:${occurrence.toolOccurrenceId}`),
  });
}

function snapshotOwnsEvent(
  snapshot: RecordedMatcherSourceSnapshot,
  row: ObservedEventLedgerRow,
): boolean {
  if (snapshot.scope === "turn") {
    return row.sessionId === snapshot.sessionId && row.turnId === snapshot.turnId;
  }
  if (snapshot.scope === "session") return row.sessionId === snapshot.sessionId;
  return true;
}

function snapshotOwnsOccurrence(
  snapshot: RecordedMatcherSourceSnapshot,
  row: ObservedToolOccurrenceLedgerRow,
): boolean {
  if (snapshot.scope === "turn") {
    return row.sessionId === snapshot.sessionId && row.homeTurnId === snapshot.turnId;
  }
  if (snapshot.scope === "session") return row.sessionId === snapshot.sessionId;
  return true;
}

function snapshotContainsEvent(
  snapshot: RecordedMatcherSourceSnapshot,
  row: ObservedEventLedgerRow,
): boolean {
  if (snapshot.scope === "turn" || snapshot.scope === "session") {
    return snapshotOwnsEvent(snapshot, row) &&
      row.sessionSequence <= snapshot.throughSessionSequence;
  }
  const cut = snapshot.sessions.find((session) => session.sessionId === row.sessionId);
  return cut !== undefined && row.sessionSequence <= cut.throughSessionSequence;
}

function snapshotContainsOccurrence(
  snapshot: RecordedMatcherSourceSnapshot,
  row: ObservedToolOccurrenceLedgerRow,
): boolean {
  if (snapshot.scope === "turn" || snapshot.scope === "session") {
    return snapshotOwnsOccurrence(snapshot, row) &&
      row.startSessionSequence <= snapshot.throughSessionSequence;
  }
  const cut = snapshot.sessions.find((session) => session.sessionId === row.sessionId);
  return cut !== undefined && row.startSessionSequence <= cut.throughSessionSequence;
}

function currentMatcherRows(input: Readonly<{
  readonly subject: "tool" | "event";
  readonly events: readonly ObservedEventLedgerRow[];
  readonly occurrences: readonly ObservedToolOccurrenceLedgerRow[];
  readonly snapshot: RecordedMatcherSourceSnapshot;
  readonly overlays: ReadonlyMap<string, Readonly<{
    readonly result: "matched" | "mismatched" | "unavailable" | "not-evaluated";
    readonly difference?: InspectionJson;
  }>>;
  readonly examined: number;
}>): Readonly<{
  readonly final: readonly MatcherFilterRow[];
  readonly atEvaluation: readonly MatcherFilterRow[];
  readonly exact: boolean;
}> {
  const eventsById = new Map(input.events.map((row) => [row.eventId, row] as const));
  let exact = true;
  const sourceRows = input.subject === "event"
    ? input.events.filter((row) =>
        snapshotOwnsEvent(input.snapshot, row) &&
        (row.event.kind === "message" || row.event.kind === "tool-start" || row.event.kind === "tool-finish")
      ).map((row) => Object.freeze({
        locator: Object.freeze({ kind: "event" as const, eventId: row.eventId }),
        inSnapshot: snapshotContainsEvent(input.snapshot, row),
        summary: eventSummary(row),
        detail: eventDetail(row),
        target: exactMatcherTarget(row, `event:${row.eventId}`),
      }))
    : input.occurrences.flatMap((row) => {
        if (!snapshotOwnsOccurrence(input.snapshot, row)) return [];
        const material = toolDetail(row, eventsById);
        if (material === undefined) {
          exact = false;
          return [];
        }
        return [Object.freeze({
          locator: Object.freeze({
            kind: "tool-occurrence" as const,
            toolOccurrenceId: row.toolOccurrenceId,
          }),
          inSnapshot: snapshotContainsOccurrence(input.snapshot, row),
          summary: material.summary,
          detail: material.detail,
          target: material.target,
        })];
      });
  let evaluatedOrdinal = 0;
  const final = sourceRows.map((row, index): MatcherFilterRow => {
    const overlay = input.overlays.get(matcherLocatorKey(row.locator));
    if (row.inSnapshot) evaluatedOrdinal += 1;
    const evaluation = !row.inSnapshot
      ? Object.freeze({ result: "outside-snapshot" as const })
      : overlay === undefined
      ? Object.freeze({
          result: evaluatedOrdinal <= input.examined
            ? "not-retained" as const
            : "not-evaluated" as const,
        })
      : Object.freeze({
          result: overlay.result,
          ...(overlay.difference === undefined ? {} : { difference: overlay.difference }),
        });
    return Object.freeze({
      kind: input.subject,
      rowId: matcherLocatorKey(row.locator),
      number: String(index + 1),
      phase: row.inSnapshot ? "at-evaluation" as const : "outside-evaluation-snapshot" as const,
      summary: row.summary,
      detail: row.detail,
      locator: row.locator,
      evaluation,
      conversationTarget: row.target,
    });
  });
  return Object.freeze({
    final: Object.freeze(final),
    atEvaluation: Object.freeze(final.filter((row) => row.phase === "at-evaluation")),
    exact,
  });
}

function retainedOverlay(
  artifact: RecordedMatcherQueryArtifact,
): ReadonlyMap<string, Readonly<{
  readonly result: "matched" | "mismatched" | "unavailable" | "not-evaluated";
  readonly difference?: InspectionJson;
}>> {
  return new Map(artifact.retainedRows.map((row) => [
    matcherLocatorKey(closeMatcherLocator(row.locator)),
    Object.freeze({
      result: row.result,
      ...(row.difference === undefined
        ? {}
        : { difference: closeRecordedAssertionFact(row.difference) }),
    }),
  ] as const));
}

function orderSteps(
  artifact: RecordedMatcherQueryArtifact,
  rowsByLocator: ReadonlyMap<string, MatcherFilterRow>,
): readonly InspectionJson[] {
  if (artifact.kind !== "ordered-sequence") return Object.freeze([]);
  const definite = artifact.result.state === "matched"
    ? artifact.result.witnessPath
    : artifact.result.state === "mismatched"
    ? artifact.result.failureFrontier.longestDefinitePrefix
    : Object.freeze([]);
  const possible = artifact.result.state === "mismatched"
    ? artifact.result.failureFrontier.longestPossiblePrefix
    : Object.freeze([]);
  const nodes = new Map([...possible, ...definite].map((node) => [node.step, node] as const));
  const blocked = artifact.result.state === "mismatched"
    ? artifact.result.failureFrontier.firstBlockingStep
    : undefined;
  return Object.freeze(artifact.querySteps.map((query) => {
    const node = nodes.get(query.step);
    const sourceRow = node === undefined
      ? undefined
      : rowsByLocator.get(matcherLocatorKey(closeMatcherLocator(node.locator)));
    const state = query.step <= definite.length
      ? "matched" as const
      : query.step <= possible.length
      ? "possible" as const
      : query.step === blocked
      ? "blocked" as const
      : "not-reached" as const;
    return closeJson(Object.freeze({
      step: query.step,
      summary: closeRecordedAssertionFact(query.summary),
      state,
      ...(sourceRow === undefined ? {} : {
        sourceRow: sourceRow.rowId,
        conversationTarget: sourceRow.conversationTarget,
      }),
    }));
  }));
}

function closeLegacySourceRows(
  subject: "tool" | "event" | "source-row",
  source: InspectionAgentTurnsRead,
): InspectionJson {
  if (source.state !== "available") return sourceUnavailableCollection("source-unavailable");
  const items = source.value.segments.flatMap((segment) =>
    segment.items.map((item) => ({ segment, item }))
  );
  const selected = items.filter(({ item }) =>
    subject !== "tool" || item.kind === "tool-call" || item.kind === "tool-start"
  );
  const rows = selected.map(({ segment, item }, index): MatcherFilterRow => {
    const summary = "tool" in item
      ? item.tool
      : "summary" in item
      ? item.summary
      : "text" in item
      ? item.text
      : item.kind;
    return Object.freeze({
      kind: "legacy-source-row" as const,
      rowId: `legacy:${item.itemId}`,
      number: String(index + 1),
      phase: "historical" as const,
      summary,
      detail: factFields([
        { label: "type", value: factValue(item.kind) },
        { label: "turn", value: factValue(segment.turnId) },
        ...(item.kind === "tool-call"
          ? [
              { label: "name", value: factValue(item.tool) },
              { label: "input", value: factValue(item.inputSummary) },
              { label: "sourceLocalCallId", value: factValue(item.callId) },
            ]
          : item.kind === "tool-result"
          ? [
              { label: "status", value: factValue(item.outcome) },
              { label: "output", value: factValue(item.outputSummary) },
              { label: "sourceLocalCallId", value: factValue(item.callId) },
            ]
          : item.kind === "tool-start"
          ? [
              { label: "name", value: factValue(item.tool) },
              { label: "input", value: factValue(item.inputSummary) },
            ]
          : item.kind === "tool-finish"
          ? [
              { label: "status", value: factValue(item.outcome) },
              { label: "output", value: factValue(item.outputSummary) },
            ]
          : "summary" in item
          ? [{ label: "summary", value: factValue(item.summary) }]
          : "text" in item
          ? [{ label: "text", value: factValue(item.text) }]
          : []),
      ]),
      evaluation: Object.freeze({ result: "legacy" as const }),
      conversationTarget: unavailableMatcherTarget("historical-not-recorded"),
    });
  });
  return currentSourceCollection(
    source.value.collection.state,
    rows,
    source.value.collection.limitations,
  );
}

function projectMatcherDebugger(
  entry: MatcherAssertionEntry,
  agentTurns: InspectionAgentTurnsRead,
): InspectionJson {
  const subject = matcherSubject(entry);
  if (entry.evaluation.kind === "matcher-legacy") {
    return closeJson(Object.freeze({
      state: "legacy" as const,
      subject,
      query: Object.freeze({
        state: "unavailable" as const,
        reason: "historical-not-recorded" as const,
      }),
      source: Object.freeze({
        final: closeLegacySourceRows(subject, agentTurns),
        atEvaluation: sourceUnavailableCollection("historical-not-recorded"),
      }),
      identityRelation: Object.freeze({
        state: "unavailable" as const,
        reason: "historical-not-recorded" as const,
      }),
      overlayRetention: "unavailable" as const,
      steps: Object.freeze([]),
      ...(entry.evaluation.legacyDiagnostic === undefined
        ? {}
        : { legacyDiagnostic: closeRecordedAssertionFact(entry.evaluation.legacyDiagnostic) }),
    }));
  }

  const artifact = entry.evaluation.artifact;
  const query = artifact.kind === "collection-filter"
    ? Object.freeze({
        kind: artifact.kind,
        summary: closeRecordedAssertionFact(artifact.query.summary),
      })
    : Object.freeze({
        kind: artifact.kind,
        summaries: Object.freeze(artifact.querySteps.map((step) =>
          closeRecordedAssertionFact(step.summary)
        )),
      });
  const unavailableCurrent = (
    reason: "source-unavailable" | "ambiguous",
  ): InspectionJson => closeJson(Object.freeze({
    state: "current" as const,
    subject: subject === "source-row" ? "event" as const : subject,
    query,
    receipt: artifact.receipt,
    source: Object.freeze({
      final: sourceUnavailableCollection(reason),
      atEvaluation: sourceUnavailableCollection(reason),
    }),
    identityRelation: Object.freeze({ state: "unavailable" as const, reason }),
    overlayRetention: "unavailable" as const,
    steps: Object.freeze([]),
  }));
  if (
    subject === "source-row" ||
    agentTurns.state !== "available" ||
    agentTurns.value.state !== "current" ||
    artifact.sourceSnapshot.source.schemaVersion !== 2
  ) return unavailableCurrent("source-unavailable");

  const projected = projectObservedSourceEvents(agentTurns.value.segments);
  if (projected.state === "invalid") return unavailableCurrent("ambiguous");
  const overlays = retainedOverlay(artifact);
  const examined = artifact.kind === "collection-filter"
    ? artifact.receipt.examined
    : artifact.receipt.stepReceipts[0]?.comparisons ?? 0;
  const rows = currentMatcherRows({
    subject,
    events: projected.events,
    occurrences: projected.toolOccurrences,
    snapshot: artifact.sourceSnapshot,
    overlays,
    examined,
  });
  const rowsByLocator = new Map(rows.atEvaluation.map((row) => [row.rowId, row] as const));
  const exactRetainedIdentity = artifact.retainedRows.every((row) =>
    row.locator.relation.state === "exact"
  );
  const retainedInsideCut = overlays.size === artifact.retainedRows.length &&
    [...overlays.keys()].every((key) => rowsByLocator.has(key));
  const sourcePositions = new Map<string, Readonly<{
    readonly sessionId: string;
    readonly sessionSequence: number;
  }>>(
    subject === "event"
      ? projected.events.map((row) => [
          matcherLocatorKey({ kind: "event", eventId: row.eventId }),
          Object.freeze({ sessionId: row.sessionId, sessionSequence: row.sessionSequence }),
        ] as const)
      : projected.toolOccurrences.map((row) => [
          matcherLocatorKey({
            kind: "tool-occurrence",
            toolOccurrenceId: row.toolOccurrenceId,
          }),
          Object.freeze({
            sessionId: row.sessionId,
            sessionSequence: row.startSessionSequence,
          }),
        ] as const),
  );
  const orderNodes = artifact.kind !== "ordered-sequence" || artifact.result.state === "unavailable"
    ? Object.freeze([])
    : artifact.result.state === "matched"
    ? artifact.result.witnessPath
    : Object.freeze([
        ...artifact.result.failureFrontier.longestDefinitePrefix,
        ...artifact.result.failureFrontier.longestPossiblePrefix,
      ]);
  const pathsInsideCut = orderNodes.every((node) => {
    if (node.locator.relation.state !== "exact") return false;
    const key = matcherLocatorKey(closeMatcherLocator(node.locator));
    const actual = sourcePositions.get(key);
    return actual !== undefined && actual.sessionId === node.sessionId &&
      actual.sessionSequence === node.sessionSequence && rowsByLocator.has(key);
  });
  const receiptCountMatches = artifact.kind === "collection-filter"
    ? artifact.receipt.knownTotal === rows.atEvaluation.length
    : artifact.receipt.sourceRows === rows.atEvaluation.length;
  if (
    !rows.exact ||
    !exactRetainedIdentity ||
    !retainedInsideCut ||
    !pathsInsideCut ||
    !receiptCountMatches
  ) return unavailableCurrent("ambiguous");

  const sourceState = agentTurns.value.collection.state === "complete" &&
      artifact.sourceSnapshot.collectionAtCut === "complete"
    ? "complete" as const
    : "partial" as const;
  const final = currentSourceCollection(
    agentTurns.value.collection.state,
    rows.final,
    agentTurns.value.collection.limitations,
  );
  const atEvaluation = currentSourceCollection(
    sourceState,
    rows.atEvaluation,
    agentTurns.value.collection.limitations,
  );
  const retainedCount = overlays.size;
  const overlayRetention = retainedCount >= Math.min(examined, rows.atEvaluation.length)
    ? "complete" as const
    : "partial" as const;
  return closeJson(Object.freeze({
    state: "current" as const,
    subject,
    query,
    receipt: artifact.receipt,
    source: Object.freeze({ final, atEvaluation }),
    identityRelation: Object.freeze({ state: "exact" as const }),
    overlayRetention,
    steps: orderSteps(artifact, rowsByLocator),
  }));
}

function missingCheck(entryId: string, state: string): InspectionJson {
  return diagnosticNode(entryId, state, null, null, "not-recorded", null, Object.freeze([]));
}

function missingMatcher(state: string): InspectionJson {
  return closeJson(Object.freeze({
    state: "missing" as const, sourceState: state, comparator: null, sourceLedger: null,
    receipt: null, result: null, targets: Object.freeze([]), debugger: null,
    sandboxCommandJoin: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
  }));
}

/**
 * The Inspection source is already a validated sealed reader. This verifies
 * its pagination and byte accounting without depending on a Node hash API, so
 * the same selector can run in the browser SQLite worker.
 */
function readSealedBytes(source: InspectionFactSource, metadata: PersistedContentMetadata): Uint8Array {
  const bytes = new Uint8Array(metadata.byteLength);
  const digest = new InspectionSha256();
  let offset = 0;
  let afterOrdinal = -1;
  let expectedOrdinal = 0;
  let observedChunks = 0;
  while (true) {
    const page = source.readContentPage(metadata.contentId, afterOrdinal, CONTENT_PAGE_SIZE);
    if (page.contentId !== metadata.contentId || page.afterOrdinal !== afterOrdinal ||
      page.chunks.length === 0 && page.nextOrdinal !== null) throw new Error("Assertion content page is invalid");
    for (const chunk of page.chunks) {
      if (chunk.ordinal !== expectedOrdinal || offset + chunk.bytes.byteLength > bytes.byteLength) {
        throw new Error("Assertion content chunk sequence is invalid");
      }
      bytes.set(chunk.bytes, offset);
      digest.update(chunk.bytes);
      offset += chunk.bytes.byteLength;
      expectedOrdinal += 1;
      observedChunks += 1;
    }
    if (page.nextOrdinal === null) break;
    if (page.nextOrdinal !== expectedOrdinal - 1 || observedChunks > metadata.chunkCount) {
      throw new Error("Assertion content continuation is invalid");
    }
    afterOrdinal = page.nextOrdinal;
  }
  if (offset !== metadata.byteLength || observedChunks !== metadata.chunkCount ||
    digest.digestHex() !== metadata.digest) {
    throw new Error("Assertion content does not match its sealed metadata");
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closeJson(value: unknown): InspectionJson {
  const closed = closeInspectionJson(value);
  if (isRecord(closed) && closed.code === "inspection-result-invalid") throw closed;
  return closed as InspectionJson;
}

function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

function base64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2]!;
    output += alphabet[(first & 0b0000_0011) << 4 | (second === undefined ? 0 : second >> 4)]!;
    output += second === undefined ? "=" : alphabet[(second & 0b0000_1111) << 2 | (third === undefined ? 0 : third >> 6)]!;
    output += third === undefined ? "=" : alphabet[third & 0b0011_1111]!;
  }
  return output;
}
