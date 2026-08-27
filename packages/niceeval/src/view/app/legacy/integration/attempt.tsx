import type { ReactElement } from "react";

import type {
  InspectionDocument,
  InspectionOperation,
} from "../../../../inspection/codec.ts";
import { isUtcMillis } from "../../../../record/model/identifiers.ts";
import {
  AttemptDetails,
  type AssertionDecisionState,
  type AttemptAssertionDiagnosticNode,
  type AttemptInspectionAssertionSourceSite,
  type AttemptAssertionSourceSite,
  type AttemptAssertionView,
  type AttemptAssertionsData,
  type AttemptClosedAssertionEntry,
  type AttemptDetailsData,
  type AttemptDiagnosticView,
  type AttemptDiagnosticsData,
  type AttemptMatcherDetail,
  type AttemptMatcherTarget,
  type AttemptUsageObservation,
  type ClosedEvidenceSlice,
  type EvidenceLimitation,
  type UsageTableData,
} from "../report/components/attempt-detail/index.tsx";
import type {
  CommandEvidenceContent,
  CommandEvidenceItem,
  ConversationContent,
  ConversationEntry,
  ConversationTurn,
} from "../report/definition/primitives/conversation.tsx";
import type { DiffContent } from "../report/definition/primitives/diff-lines.ts";
import type {
  MatcherFilterDebuggerContent,
  MatcherFilterFieldContent,
  MatcherFilterNotice,
  MatcherFilterRowContent,
} from "../report/definition/primitives/matcher-filter-debugger.tsx";
import type {
  SourceBlockContent,
  SourceContent,
  SourceLine,
} from "../report/definition/primitives/source-view.tsx";
import type {
  ClosedAssertionFactValue,
  ClosedJsonValue,
} from "../report/definition/primitives/shared.ts";
import type { WaterfallContent, WaterfallNode } from "../report/definition/primitives/waterfall.tsx";
import type { Locale } from "../client/types.ts";

type JsonRecord = Readonly<Record<string, unknown>>;

export interface AttemptInspectionBundle {
  readonly attempt: InspectionDocument;
  readonly assertions: readonly InspectionDocument[];
  readonly trace: InspectionDocument;
  readonly traceDetails: readonly InspectionDocument[];
  readonly sources: InspectionDocument;
  readonly diff: InspectionDocument;
}

export function assertionDetailOperations(
  document: InspectionDocument,
  locator: string,
): readonly InspectionOperation[] {
  const attempt = recordField(document, "attempt");
  const assertions = optionalRecord(attempt.assertions);
  const entries = Array.isArray(assertions?.entries) ? assertions.entries : [];
  return Object.freeze(entries.flatMap((value) => {
    const entry = optionalRecord(value);
    return typeof entry?.entryId === "string"
      ? [{ kind: "attempt.assertion.detail" as const, locator, entryId: entry.entryId as never }]
      : [];
  }));
}

export function traceDetailOperations(
  document: InspectionDocument,
  locator: string,
): readonly InspectionOperation[] {
  const trace = recordField(document, "trace");
  const index = optionalRecord(trace.identityIndex);
  const itemIds = stringArray(index?.itemIds);
  const occurrenceIndex = optionalRecord(index?.toolOccurrenceIds);
  const occurrenceIds = occurrenceIndex?.state === "available"
    ? stringArray(occurrenceIndex.ids)
    : [];
  const commandIds = stringArray(index?.commandIds);
  return Object.freeze([
    ...itemIds.map((itemId) => ({
      kind: "attempt.trace.detail" as const,
      locator,
      selector: { kind: "item" as const, itemId: itemId as never },
    })),
    ...occurrenceIds.map((toolOccurrenceId) => ({
      kind: "attempt.trace.detail" as const,
      locator,
      selector: { kind: "tool-occurrence" as const, toolOccurrenceId: toolOccurrenceId as never },
    })),
    ...commandIds.map((commandId) => ({
      kind: "attempt.trace.detail" as const,
      locator,
      selector: { kind: "command" as const, commandId: commandId as never },
    })),
  ] satisfies InspectionOperation[]);
}

export function AttemptPage({
  bundle,
  locale,
}: {
  readonly bundle: AttemptInspectionBundle;
  readonly locale: Locale;
}): ReactElement {
  return <AttemptDetails data={attemptDetails(bundle)} locale={locale} />;
}

function attemptDetails(bundle: AttemptInspectionBundle): AttemptDetailsData {
  const attempt = recordField(bundle.attempt, "attempt");
  const core = recordField(attempt, "core");
  const originRun = recordField(attempt, "originRun");
  const locator = stringField(attempt, "locator");
  const trace = recordField(bundle.trace, "trace");
  const assertionDetails = bundle.assertions.map((document) =>
    recordField(document, "assertion"));
  const assertions = closeAssertions(assertionDetails);
  const conversation = closeConversation(trace, bundle.traceDetails, locator);
  const timing = closeTiming(trace, locator);
  const usage = closeUsage(trace);
  const commands = closeCommands(trace, bundle.traceDetails, locator);
  const diagnostics = closeDiagnostics(trace);
  const sources = closeSources(
    recordField(bundle.sources, "sources"),
    assertions.data,
    trace,
    locator,
  );
  const diff = closeDiff(recordField(bundle.diff, "diff"));
  const slotId = stringField(core, "slotId");
  const slots = arrayField(originRun, "expectedSlots");
  const slot = slots.map((value, index) => record(value, `originRun.expectedSlots[${index}]`))
    .find((value) => value.slotId === slotId);
  const durationMs = timing.data?.[0]?.durationMs ?? null;
  const score = optionalRecord(attempt.score);
  const totalScore = score?.state === "complete" && typeof score.earned === "number"
    ? score.earned
    : undefined;
  return Object.freeze({
    locator,
    summary: Object.freeze({
      experimentId: stringField(originRun, "experimentId"),
      identity: Object.freeze({
        runId: stringField(originRun, "runId"),
        evalId: stringField(core, "evalId"),
        attempt: slot === undefined ? 0 : integerField(slot, "attemptOrdinal"),
      }),
      verdict: verdict(attempt.verdict, core.outcome),
      startedAt: instantField(originRun, "startedAt"),
      durationMs,
      capabilities: Object.freeze({
        source: sources.slice.state === "available" || sources.slice.state === "partial",
        execution: conversation.state === "available" || conversation.state === "partial",
        timing: timing.slice.state === "available" || timing.slice.state === "partial",
        diff: diff.state === "available" || diff.state === "partial",
      }),
      ...(totalScore === undefined ? {} : { totalScore }),
    }),
    notices: Object.freeze([]),
    assertions: assertions.slice,
    source: sources.slice,
    fixPrompt: null,
    timeline: timing.slice,
    usage,
    conversation,
    commands,
    diagnostics,
    diff,
  });
}

function closeAssertions(details: readonly JsonRecord[]): {
  readonly data: AttemptAssertionsData;
  readonly slice: ClosedEvidenceSlice<AttemptAssertionsData>;
} {
  const entries = details.flatMap((detail) => {
    try {
      return [closeAssertion(detail)];
    } catch {
      return [];
    }
  });
  const attention = entries.filter((entry) =>
    entry.display.outcome !== "passed" || entry.score !== undefined);
  const passed = entries.filter((entry) =>
    entry.display.outcome === "passed" && entry.score === undefined);
  const byGroup = new Map<string, AttemptAssertionView[]>();
  for (const entry of passed) {
    const group = entry.display.groupPath.join(" > ") || "Passed checks";
    const values = byGroup.get(group) ?? [];
    values.push(entry);
    byGroup.set(group, values);
  }
  const scoreEntries = entries.flatMap(({ score }) => score === undefined ? [] : [score]);
  const data: AttemptAssertionsData = Object.freeze({
    attention: Object.freeze(attention),
    passedGroups: Object.freeze([...byGroup].map(([group, items]) => Object.freeze({
      group,
      items: Object.freeze(items),
    }))),
    evaluationKind: scoreEntries.length === 0 ? "pass" : "points",
  });
  return Object.freeze({
    data,
    slice: Object.freeze({ state: "available" as const, data }),
  });
}

function closeAssertion(detail: JsonRecord): AttemptAssertionView {
  const entry = recordField(detail, "entry");
  const display = recordField(detail, "display");
  const decision = recordField(entry, "decision");
  const evaluation = recordField(entry, "evaluation");
  const contribution = optionalRecord(entry.contribution) ?? optionalRecord(decision.contribution);
  const criterion = recordField(entry, "criterion");
  const materials = recordField(entry, "materials");
  const policy = optionalRecord(entry.policy);
  const condition = optionalRecord(policy?.condition);
  const result = assertionDecision(decision.result);
  const retainedSourceSites = arrayField(detail, "sourceSites").flatMap((value) => {
    const site = optionalRecord(value);
    const source = optionalRecord(site?.source);
    const start = optionalRecord(site?.start);
    const end = optionalRecord(site?.end);
    if (
      site === undefined || source === undefined || start === undefined || end === undefined ||
      typeof site.entryId !== "string" || typeof site.sourceOrder !== "number" ||
      typeof site.role !== "string" || typeof source.sourceItemId !== "string" ||
      typeof source.sha256 !== "string" || typeof start.line !== "number" ||
      typeof start.column !== "number" || typeof end.line !== "number" ||
      typeof end.column !== "number"
    ) return [];
    return [Object.freeze({
      entryId: site.entryId,
      sourceOrder: site.sourceOrder,
      role: site.role,
      source: source as ClosedJsonValue,
      start: Object.freeze({ line: start.line, column: start.column }),
      end: Object.freeze({ line: end.line, column: end.column }),
    } satisfies AttemptInspectionAssertionSourceSite)];
  });
  const sourceSites: readonly AttemptAssertionSourceSite[] = retainedSourceSites.map((site) => {
    const source = record(site.source, "assertion.sourceSites[].source");
    return Object.freeze({
      ...site,
      target: Object.freeze({
        state: "exact" as const,
        sourceItemId: stringField(source, "sourceItemId"),
        sha256: stringField(source, "sha256"),
      }),
    });
  });
  const check = closeDiagnostic(recordField(detail, "check"));
  const matcherDetail = recordField(detail, "matcher");
  const matcher = closeMatcher(matcherDetail);
  const matcherDebugger = closeMatcherDebugger(matcherDetail.debugger);
  const checkFact = assertionCriterionFact(criterion);
  const observedFact = assertionObservedFact(evaluation, matcher);
  const expectedFact = assertionExpectedFact(condition);
  const explanationFact = assertionExplanationFact(entry, check);
  const sourceFact = assertionSourceFact(materials);
  const closed: AttemptClosedAssertionEntry = Object.freeze({
    format: "niceeval.inspection.assertion-detail/v1",
    entryId: stringField(detail, "entryId"),
    display: Object.freeze({
      ...(typeof display.key === "string" ? { key: display.key } : {}),
      ...(typeof display.label === "string" ? { label: display.label } : {}),
      groupPath: Object.freeze(stringArray(display.groupPath)),
    }),
    entry: entry as ClosedJsonValue,
    sourceSites: Object.freeze(retainedSourceSites),
    check,
    matcher,
  });
  const name = typeof display.label === "string"
    ? display.label
    : typeof display.key === "string"
      ? display.key
      : closed.entryId;
  const score = closeScore(contribution);
  const gate = decision.gate;
  const outcome = result === "matched"
    ? "passed" as const
    : result === "mismatched" || result === "errored"
      ? "failed" as const
      : "unavailable" as const;
  return Object.freeze({
    entryId: closed.entryId,
    closed,
    display: Object.freeze({
      name,
      severity: gate === "failed" || gate === "unavailable"
        ? "gate"
        : score === undefined ? "recorded" : "scored",
      outcome,
      groupPath: closed.display.groupPath,
      detail: typeof decision.reason === "string" ? decision.reason : "",
    }),
    sourceSites: Object.freeze(sourceSites),
    check: checkFact,
    decision: Object.freeze({
      result,
      observed: observedFact,
      expected: expectedFact,
      diagnosticTree: explanationFact,
      ...(typeof decision.reason === "string" ? { reason: decision.reason } : {}),
    }),
    evidence: Object.freeze({
      source: sourceFact,
      check: checkFact,
      observed: observedFact,
      expected: expectedFact,
      explanation: explanationFact,
      ...(matcherDebugger === undefined ? {} : { matcherDebugger }),
    }),
    ...(score === undefined ? {} : { score }),
    retained: Object.freeze({ matcher: matcher as unknown as ClosedJsonValue }),
  });
}

function closeDiagnostic(value: JsonRecord): AttemptAssertionDiagnosticNode {
  return Object.freeze({
    label: stringField(value, "label"),
    state: stringField(value, "state"),
    expected: closedJson(value.expected),
    observed: closedJson(value.observed),
    reason: nullableString(value.reason),
    anchor: closedJson(value.anchor),
    children: Object.freeze(arrayField(value, "children").map((child, index) =>
      closeDiagnostic(record(child, `check.children[${index}]`)))),
  });
}

function assertionCriterionFact(criterion: JsonRecord): ClosedAssertionFactValue {
  return criterion.state === "available"
    ? assertionFact(criterion.value)
    : Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" });
}

function assertionExpectedFact(condition: JsonRecord | undefined): ClosedAssertionFactValue {
  return condition?.state === "available"
    ? assertionFact(condition.value)
    : Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" });
}

function assertionObservedFact(
  evaluation: JsonRecord,
  matcher: AttemptMatcherDetail,
): ClosedAssertionFactValue {
  const observed = closeRecordedAssertionFact(evaluation.observed);
  const receipt = evaluation.kind === "ordinary"
    ? evaluation.receipt
    : evaluation.kind === "matcher-current" && !Array.isArray(matcher.comparator)
      ? matcher.receipt
      : undefined;
  return factFields([
    ...(observed.kind === "fields"
      ? observed.fields
      : [{ label: "value", value: observed }]),
    ...(receipt === undefined || receipt === null
      ? []
      : [{ label: "receipt", value: assertionFact(receipt) }]),
  ]);
}

function assertionSourceFact(materials: JsonRecord): ClosedAssertionFactValue {
  const source = assertionMaterialFact(recordField(materials, "source"));
  const evidence = arrayField(materials, "evidence").map((value, index) =>
    assertionMaterialFact(record(value, `materials.evidence[${index}]`)));
  const limitations = arrayField(materials, "limitations").map(assertionFact);
  return factFields([
    { label: "input", value: source },
    ...(evidence.length === 0
      ? []
      : [{ label: "evidence", value: Object.freeze({ kind: "list" as const, items: Object.freeze(evidence) }) }]),
    { label: "coverage", value: assertionFact(materials.coverage) },
    ...(limitations.length === 0
      ? []
      : [{ label: "limitations", value: Object.freeze({ kind: "list" as const, items: Object.freeze(limitations) }) }]),
  ]);
}

function assertionExplanationFact(
  entry: JsonRecord,
  check: AttemptAssertionDiagnosticNode,
): ClosedAssertionFactValue {
  const retention = recordField(entry, "explanationRetention");
  if (retention.state === "retained") {
    const retained = renameLegacyDiagnosticFields(closeRecordedAssertionFact(retention.value));
    if (retained.kind !== "fields") return diagnosticFact(check);
    const labels = new Set(retained.fields.map((field) => field.label));
    return factFields([
      ...retained.fields,
      ...(!labels.has("expected") && check.expected !== null
        ? [{ label: "expected", value: assertionDiagnosticValue(check.expected) }]
        : []),
      ...(!labels.has("received") && check.observed !== null
        ? [{ label: "received", value: assertionDiagnosticValue(check.observed) }]
        : []),
      ...(!labels.has("reason") && check.reason !== null
        ? [{ label: "reason", value: factValue(check.reason) }]
        : []),
    ]);
  }
  return diagnosticFact(check);
}

function assertionDiagnosticValue(value: unknown): ClosedAssertionFactValue {
  const diagnostic = optionalRecord(value);
  return diagnostic !== undefined &&
      (diagnostic.kind === "unavailable" || diagnostic.kind === "value" || diagnostic.kind === "text" ||
        diagnostic.kind === "list" || diagnostic.kind === "fields")
    ? closeRecordedAssertionFact(value)
    : assertionFact(value);
}

/** Current diagnostic field names -> the old AssertionEvidence field names. */
function renameLegacyDiagnosticFields(value: ClosedAssertionFactValue): ClosedAssertionFactValue {
  if (value.kind === "list") {
    return Object.freeze({
      kind: "list" as const,
      items: Object.freeze(value.items.map(renameLegacyDiagnosticFields)),
    });
  }
  if (value.kind !== "fields") return value;
  const labels = new Set(value.fields.map((field) => field.label));
  return factFields(value.fields.map((field) => ({
    label: field.label === "observed" && !labels.has("received")
      ? "received"
      : field.label === "message" && !labels.has("reason")
        ? "reason"
        : field.label,
    value: renameLegacyDiagnosticFields(field.value),
  })));
}

/** Current Inspection diagnostic node -> the old MatchDiagnostic fact algebra. */
function diagnosticFact(node: AttemptAssertionDiagnosticNode): ClosedAssertionFactValue {
  const anchor = optionalRecord(node.anchor);
  const locatorId = typeof anchor?.id === "string"
    ? anchor.id
    : typeof anchor?.toolOccurrenceId === "string"
      ? anchor.toolOccurrenceId
      : typeof anchor?.eventId === "string"
        ? anchor.eventId
        : undefined;
  return factFields([
    { label: "code", value: factValue(node.label) },
    ...(node.expected === null
      ? []
      : [{ label: "expected", value: assertionDiagnosticValue(node.expected) }]),
    ...(node.observed === null
      ? []
      : [{ label: "received", value: assertionDiagnosticValue(node.observed) }]),
    ...(node.reason === null ? [] : [{ label: "reason", value: factValue(node.reason) }]),
    ...(locatorId === undefined
      ? []
      : [{ label: "locator", value: factFields([{ label: "id", value: factValue(locatorId) }]) }]),
    {
      label: "children",
      value: Object.freeze({
        kind: "list" as const,
        items: Object.freeze(node.children.map((child, index) => factFields([
          { label: "index", value: factValue(index) },
          { label: "label", value: factValue(child.label) },
          { label: "state", value: factValue(diagnosticMatchState(child.state)) },
          { label: "diagnostic", value: diagnosticFact(child) },
        ]))),
      }),
    },
  ]);
}

function diagnosticMatchState(value: string): "matched" | "mismatched" | "unavailable" {
  return value === "matched" || value === "mismatched" ? value : "unavailable";
}

function assertionMaterialFact(value: JsonRecord): ClosedAssertionFactValue {
  if (value.kind === "snapshot") return assertionFact(value.value);
  if (value.kind === "unavailable") {
    return Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" });
  }
  if (value.kind !== "content") throw new Error("Assertion material kind is invalid");
  const content = recordField(value, "content");
  if (content.state !== "available" || typeof content.base64 !== "string") {
    throw new Error("Assertion material content is unavailable");
  }
  const text = decodeUtf8Base64(content.base64);
  if (value.encoding === "json") return assertionFact(JSON.parse(text));
  if (value.encoding === "utf-8") return Object.freeze({ kind: "text" as const, text });
  return assertionFact({
    encoding: value.encoding,
    byteLength: value.byteLength,
    preview: value.preview,
  });
}

function decodeUtf8Base64(value: string): string {
  const binary = globalThis.atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

interface ClosedMatcherSourceCollection {
  readonly state: MatcherFilterDebuggerContent["atEvaluation"]["state"];
  readonly rows: readonly ClosedMatcherFilterRow[];
}

interface ClosedMatcherFilterRow {
  readonly content: MatcherFilterRowContent;
  readonly phase: "at-evaluation" | "outside-evaluation-snapshot" | "historical";
}

function closeMatcherDebugger(value: unknown): MatcherFilterDebuggerContent | undefined {
  if (value === null || value === undefined) return undefined;
  const debuggerView = record(value, "matcher.debugger");
  const state = matcherDebuggerState(debuggerView.state);
  const subject = matcherDebuggerSubject(debuggerView.subject);
  const source = recordField(debuggerView, "source");
  const final = closeMatcherSourceCollection(recordField(source, "final"));
  if (state === "legacy") {
    return Object.freeze({
      state,
      queryKind: "unavailable" as const,
      subject,
      querySummary: "Matcher query was not retained",
      facts: Object.freeze([]),
      atEvaluation: Object.freeze({
        state: final.state,
        rows: Object.freeze(final.rows.map((row) => row.content)),
      }),
      afterEvaluation: Object.freeze([]),
      relationNotice: "historical-not-recorded" as const,
    });
  }

  const query = recordField(debuggerView, "query");
  const queryKind = matcherQueryKind(query.kind);
  const querySummaries = queryKind === "collection-filter"
    ? Object.freeze([closeRecordedAssertionFact(query.summary)])
    : Object.freeze(arrayField(query, "summaries").map(closeRecordedAssertionFact));
  const querySummary = queryKind === "collection-filter"
    ? matcherCollectionQuerySummary(querySummaries[0]!)
    : querySummaries.map(matcherOrderQuerySummary).join(" → ");
  const receipt = recordField(debuggerView, "receipt");
  const atEvaluation = closeMatcherSourceCollection(recordField(source, "atEvaluation"));
  const relationNotice = matcherRelationNotice(recordField(debuggerView, "identityRelation"));
  const notices: MatcherFilterNotice[] = [
    ...(atEvaluation.state === "partial" ? ["source-partial" as const] : []),
    ...(debuggerView.overlayRetention === "partial" ? ["overlay-partial" as const] : []),
    ...(atEvaluation.state === "unavailable" ? ["source-unavailable" as const] : []),
  ].filter((notice) => notice !== relationNotice);
  return Object.freeze({
    state,
    queryKind,
    subject,
    querySummary,
    receipt: closedJson(receipt),
    sourceLedger: closedJson(source),
    facts: Object.freeze([
      Object.freeze({
        kind: "observed" as const,
        value: matcherObservedFact(queryKind, querySummaries.length, receipt),
      }),
      Object.freeze({
        kind: "examined" as const,
        value: matcherExaminedFact(queryKind, receipt),
      }),
    ]),
    steps: Object.freeze(arrayField(debuggerView, "steps").map(closeMatcherStep)),
    atEvaluation: Object.freeze({
      state: atEvaluation.state,
      rows: Object.freeze(atEvaluation.rows.map((row) => row.content)),
      ...(notices.length === 0 ? {} : { notices: Object.freeze(notices) }),
    }),
    afterEvaluation: Object.freeze(final.rows
      .filter((row) => row.phase === "outside-evaluation-snapshot")
      .map((row) => row.content)),
    ...(relationNotice === undefined ? {} : { relationNotice }),
  });
}

function closeMatcherSourceCollection(value: JsonRecord): ClosedMatcherSourceCollection {
  return Object.freeze({
    state: matcherSourceState(value.state),
    rows: Object.freeze(arrayField(value, "rows").map((row, index) =>
      closeMatcherFilterRow(record(row, `matcher.debugger.source.rows[${index}]`)))),
  });
}

function closeMatcherFilterRow(row: JsonRecord): ClosedMatcherFilterRow {
  const evaluation = recordField(row, "evaluation");
  const result = matcherRowState(evaluation.result);
  const difference = evaluation.difference === undefined
    ? undefined
    : matcherFilterFields(closeRecordedAssertionFact(evaluation.difference));
  const conversationTarget = optionalRecord(row.conversationTarget);
  return Object.freeze({
    phase: matcherRowPhase(row.phase),
    content: Object.freeze({
      key: stringField(row, "rowId"),
      number: stringField(row, "number"),
      kind: matcherRowKind(row.kind),
      summary: stringField(row, "summary"),
      state: result,
      fields: matcherFilterFields(closeRecordedAssertionFact(row.detail)),
      ...(difference === undefined ? {} : { difference }),
      ...(conversationTarget?.state === "exact" && typeof conversationTarget.anchor === "string"
        ? { conversationTarget: Object.freeze({ anchor: conversationTarget.anchor }) }
        : {}),
    }),
  });
}

function closeMatcherStep(value: unknown, index: number): NonNullable<
  MatcherFilterDebuggerContent["steps"]
>[number] {
  const step = record(value, `matcher.debugger.steps[${index}]`);
  const conversationTarget = optionalRecord(step.conversationTarget);
  return Object.freeze({
    step: integerField(step, "step"),
    summary: closedFactText(closeRecordedAssertionFact(step.summary)),
    state: matcherStepState(step.state),
    ...(typeof step.sourceRow === "string" ? { sourceRow: step.sourceRow } : {}),
    ...(conversationTarget?.state === "exact" && typeof conversationTarget.anchor === "string"
      ? { conversationTarget: Object.freeze({ anchor: conversationTarget.anchor }) }
      : {}),
  });
}

function matcherFilterFields(
  value: ClosedAssertionFactValue,
): readonly MatcherFilterFieldContent[] {
  if (value.kind === "fields") {
    return Object.freeze(value.fields.map((field) => Object.freeze({
      label: field.label,
      value: closedFactText(field.value),
    })));
  }
  if (value.kind === "list") {
    return Object.freeze(value.items.map((item, index) => Object.freeze({
      label: String(index + 1),
      value: closedFactText(item),
    })));
  }
  return Object.freeze([Object.freeze({ label: "value", value: closedFactText(value) })]);
}

function matcherCollectionQuerySummary(value: ClosedAssertionFactValue): string {
  const matcher = closedFactField(value, "matcher");
  const quantifier = closedFactField(value, "quantifier");
  const kind = quantifier === undefined ? undefined : closedFactField(quantifier, "kind");
  const count = quantifier === undefined ? undefined : closedFactField(quantifier, "count");
  const matcherSummary = matcher === undefined ? undefined : closedFactText(matcher);
  if (
    matcherSummary === undefined || matcherSummary.length === 0 ||
    kind?.kind !== "value" || typeof kind.value !== "string"
  ) return closedFactText(value);
  if (kind.value === "absent") return `none × ${matcherSummary}`;
  if (count?.kind !== "value" || typeof count.value !== "number") return closedFactText(value);
  if (kind.value === "exact") return `exactly ${count.value} × ${matcherSummary}`;
  if (kind.value === "at-least") return `at least ${count.value} × ${matcherSummary}`;
  if (kind.value === "less-than") return `less than ${count.value} × ${matcherSummary}`;
  if (kind.value === "at-most") return `at most ${count.value} × ${matcherSummary}`;
  if (kind.value === "greater-than") return `greater than ${count.value} × ${matcherSummary}`;
  return closedFactText(value);
}

function matcherOrderQuerySummary(value: ClosedAssertionFactValue): string {
  const matcher = closedFactField(value, "matcher");
  if (matcher === undefined) return closedFactText(value);
  const summary = closedFactText(matcher);
  return summary.length === 0 ? closedFactText(value) : summary;
}

function closedFactField(
  value: ClosedAssertionFactValue,
  label: string,
): ClosedAssertionFactValue | undefined {
  return value.kind === "fields"
    ? value.fields.find((field) => field.label === label)?.value
    : undefined;
}

function matcherObservedFact(
  queryKind: "collection-filter" | "ordered-sequence",
  stepCount: number,
  receipt: JsonRecord,
): { readonly en: string; readonly "zh-CN": string } {
  if (
    queryKind === "collection-filter" &&
    typeof receipt.matched === "number" &&
    typeof receipt.mismatched === "number" &&
    typeof receipt.unavailable === "number"
  ) {
    return Object.freeze({
      en: `${receipt.matched} matched · ${receipt.mismatched} not matched · ${receipt.unavailable} unknown`,
      "zh-CN": `${receipt.matched} 条命中 · ${receipt.mismatched} 条未命中 · ${receipt.unavailable} 条无法判断`,
    });
  }
  if (
    queryKind === "ordered-sequence" &&
    typeof receipt.definitePrefixLength === "number" &&
    typeof receipt.possiblePrefixLength === "number"
  ) {
    return Object.freeze({
      en: `${receipt.definitePrefixLength}/${stepCount} definite · ${receipt.possiblePrefixLength}/${stepCount} possible`,
      "zh-CN": `${receipt.definitePrefixLength}/${stepCount} 步确定 · ${receipt.possiblePrefixLength}/${stepCount} 步可能`,
    });
  }
  return Object.freeze({ en: "unavailable", "zh-CN": "不可用" });
}

function matcherExaminedFact(
  queryKind: "collection-filter" | "ordered-sequence",
  receipt: JsonRecord,
): { readonly en: string; readonly "zh-CN": string } {
  if (queryKind === "collection-filter" && typeof receipt.examined === "number") {
    const knownTotal = typeof receipt.knownTotal === "number" ? receipt.knownTotal : "?";
    return Object.freeze({
      en: `${receipt.examined}/${knownTotal} rows`,
      "zh-CN": `${receipt.examined}/${knownTotal} 条记录`,
    });
  }
  if (
    queryKind === "ordered-sequence" &&
    typeof receipt.sourceRows === "number" &&
    typeof receipt.comparisons === "number"
  ) {
    return Object.freeze({
      en: `${receipt.sourceRows} rows · ${receipt.comparisons} comparisons`,
      "zh-CN": `${receipt.sourceRows} 条记录 · ${receipt.comparisons} 次比较`,
    });
  }
  return Object.freeze({ en: "unavailable", "zh-CN": "不可用" });
}

function matcherRelationNotice(value: JsonRecord): MatcherFilterNotice | undefined {
  if (value.state === "exact") return undefined;
  return value.reason === "ambiguous" ? "ambiguous-relation" : "source-unavailable";
}

function matcherDebuggerState(value: unknown): "current" | "legacy" {
  if (value === "current" || value === "legacy") return value;
  throw new Error("matcher.debugger.state is invalid");
}

function matcherDebuggerSubject(value: unknown): MatcherFilterDebuggerContent["subject"] {
  if (value === "tool" || value === "event" || value === "source-row") return value;
  throw new Error("matcher.debugger.subject is invalid");
}

function matcherQueryKind(value: unknown): "collection-filter" | "ordered-sequence" {
  if (value === "collection-filter" || value === "ordered-sequence") return value;
  throw new Error("matcher.debugger.query.kind is invalid");
}

function matcherSourceState(
  value: unknown,
): MatcherFilterDebuggerContent["atEvaluation"]["state"] {
  if (value === "complete" || value === "partial" || value === "unavailable") return value;
  throw new Error("matcher.debugger source state is invalid");
}

function matcherRowKind(value: unknown): MatcherFilterRowContent["kind"] {
  if (value === "tool" || value === "event" || value === "legacy-source-row") return value;
  throw new Error("matcher.debugger row kind is invalid");
}

function matcherRowState(value: unknown): MatcherFilterRowContent["state"] {
  if (
    value === "matched" || value === "mismatched" || value === "unavailable" ||
    value === "not-evaluated" || value === "not-retained" ||
    value === "outside-snapshot" || value === "legacy"
  ) return value;
  throw new Error("matcher.debugger row state is invalid");
}

function matcherRowPhase(value: unknown): ClosedMatcherFilterRow["phase"] {
  if (
    value === "at-evaluation" || value === "outside-evaluation-snapshot" ||
    value === "historical"
  ) return value;
  throw new Error("matcher.debugger row phase is invalid");
}

function matcherStepState(
  value: unknown,
): NonNullable<MatcherFilterDebuggerContent["steps"]>[number]["state"] {
  if (
    value === "matched" || value === "possible" || value === "blocked" ||
    value === "not-reached"
  ) return value;
  throw new Error("matcher.debugger step state is invalid");
}

function closeMatcher(value: JsonRecord): AttemptMatcherDetail {
  const targets = arrayField(value, "targets").flatMap((item) => {
    const target = optionalRecord(item);
    const anchor = optionalRecord(target?.anchor);
    if (target === undefined || anchor === undefined || typeof target.state !== "string") return [];
    let closedAnchor: AttemptMatcherTarget["anchor"] | undefined;
    if (anchor.kind === "tool-occurrence" && typeof anchor.toolOccurrenceId === "string") {
      closedAnchor = { kind: "tool-occurrence", toolOccurrenceId: anchor.toolOccurrenceId };
    } else if (anchor.kind === "event" && typeof anchor.eventId === "string") {
      closedAnchor = { kind: "event", eventId: anchor.eventId };
    }
    if (closedAnchor === undefined) return [];
    return [Object.freeze({
      state: target.state,
      anchor: Object.freeze(closedAnchor),
      difference: closedJson(target.difference),
      conversationAnchor: matcherAnchor(closedAnchor),
    })];
  });
  const join = optionalRecord(value.sandboxCommandJoin);
  const commandMatch = join?.state === "matched" && typeof join.commandId === "string"
    ? { state: "matched" as const, commandId: join.commandId }
    : {
        state: "unavailable" as const,
        reason: typeof join?.reason === "string" ? join.reason : "not-recorded",
      };
  const state = value.state === "ordinary" || value.state === "legacy" ||
      value.state === "available" || value.state === "missing"
    ? value.state
    : "missing";
  return Object.freeze({
    state,
    sourceState: typeof value.sourceState === "string" ? value.sourceState : null,
    comparator: closedJson(value.comparator),
    sourceLedger: closedJson(value.sourceLedger),
    receipt: closedJson(value.receipt),
    result: closedJson(value.result),
    targets: Object.freeze(targets),
    sandboxCommandJoin: commandMatch,
    commandMatch,
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  });
}

function closeConversation(
  trace: JsonRecord,
  details: readonly InspectionDocument[],
  locator: string,
): ClosedEvidenceSlice<ConversationContent> {
  const conversation = recordField(trace, "conversation");
  const outlineItems = arrayField(conversation, "items").map((item, index) =>
    record(item, `trace.conversation.items[${index}]`));
  const itemDetails = new Map<string, JsonRecord>();
  for (const document of details) {
    if (document.operation !== "attempt.trace.detail") continue;
    const detail = recordField(document, "detail");
    if (detail.kind === "item") {
      const item = optionalRecord(detail.item);
      if (item !== undefined && typeof detail.itemId === "string") {
        itemDetails.set(detail.itemId, item);
      }
    }
  }
  const turns = arrayField(conversation, "turns").map((value, turnIndex): ConversationTurn => {
    const turn = record(value, `trace.conversation.turns[${turnIndex}]`);
    const turnId = stringField(turn, "turnId");
    const entries = outlineItems.filter((item) => item.turnId === turnId)
      .map((item) => closeConversationEntry(itemDetails.get(stringField(item, "itemId")) ?? item));
    return Object.freeze({
      key: turnId,
      label: `Turn ${integerField(turn, "sequence")}`,
      verdict: turnVerdict(turn.outcome),
      entries: Object.freeze(entries),
    });
  });
  const data: ConversationContent = Object.freeze({ turns: Object.freeze(turns), locator });
  return sliceFromState(conversation.state, data, "Closed observability");
}

function closeConversationEntry(item: JsonRecord): ConversationEntry {
  const itemId = stringField(item, "itemId");
  const kind = stringField(item, "kind");
  const occurrence = optionalRecord(item.occurrence);
  const occurrenceId = typeof item.toolOccurrenceId === "string"
    ? item.toolOccurrenceId
    : occurrence?.state === "exact" && typeof occurrence.toolOccurrenceId === "string"
      ? occurrence.toolOccurrenceId
      : undefined;
  const eventId = typeof item.eventId === "string" ? item.eventId : undefined;
  const preview = conversationPreview(item, kind);
  const role = typeof item.role === "string" ? item.role : undefined;
  const displayKind = kind === "message"
    ? role === "user" ? "user" : role === "assistant" ? "assistant" : "message"
    : kind === "tool-call" || kind === "tool-result" ? "tool" : kind;
  const tool = typeof item.tool === "string" ? item.tool : "tool";
  const input = typeof item.input === "string" ? item.input : "";
  const output = typeof item.output === "string" ? item.output : undefined;
  const phase = kind === "tool-call" ? "started" as const
    : kind === "tool-result" ? "finished" as const
    : undefined;
  const outcome = toolOutcome(item.outcome);
  const anchor = occurrenceId !== undefined
    ? matcherAnchor({ kind: "tool-occurrence", toolOccurrenceId: occurrenceId })
    : eventId === undefined ? undefined : matcherAnchor({ kind: "event", eventId });
  const detail: ConversationEntry["detail"] = phase === undefined
    ? { kind: "text", text: preview }
    : {
        kind: "tool-evidence",
        content: {
          phase,
          tool,
          ...(occurrenceId === undefined ? {} : { callId: occurrenceId }),
          ...(occurrence === undefined
            ? {}
            : occurrenceId === undefined
              ? { toolOccurrence: { state: "unavailable" as const, reason: String(occurrence.reason ?? "not-recorded") } }
              : { toolOccurrence: { state: "exact" as const, toolOccurrenceId: occurrenceId } }),
          inputSummary: input,
          ...(output === undefined ? {} : { outputSummary: output }),
          ...(outcome === undefined ? {} : { outcome }),
        },
      };
  return Object.freeze({
    id: itemId,
    ...(eventId === undefined ? {} : { eventId }),
    ...(typeof item.sequence === "number" ? { sequence: item.sequence } : {}),
    kind: displayKind,
    preview,
    ...(anchor === undefined ? {} : { anchor }),
    detail,
    raw: JSON.stringify(item),
    ...(outcome === "failed" || outcome === "rejected" ? { failed: true } : {}),
    ...(phase === undefined ? {} : { callPhase: phase }),
    ...(occurrenceId === undefined ? {} : { callId: occurrenceId }),
    ...(occurrence === undefined
      ? {}
      : occurrenceId === undefined
        ? { toolOccurrence: { state: "unavailable" as const, reason: String(occurrence.reason ?? "not-recorded") } }
        : { toolOccurrence: { state: "exact" as const, toolOccurrenceId: occurrenceId } }),
    ...(outcome === undefined ? {} : { callOutcome: outcome }),
    commandMatch: { state: "unavailable" as const, reason: "not-recorded" },
  } satisfies ConversationEntry);
}

function closeTiming(trace: JsonRecord, locator: string): {
  readonly data: WaterfallContent | null;
  readonly slice: ClosedEvidenceSlice<WaterfallContent>;
} {
  const timing = recordField(trace, "timing");
  const activities = arrayField(timing, "activities").map((value, index) =>
    record(value, `trace.timing.activities[${index}]`));
  const byParent = new Map<string | null, JsonRecord[]>();
  for (const activity of activities) {
    const parent = typeof activity.parentActivityId === "string" ? activity.parentActivityId : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(activity);
    byParent.set(parent, siblings);
  }
  const node = (activity: JsonRecord): WaterfallNode => {
    const key = stringField(activity, "activityId");
    const children = (byParent.get(key) ?? []).map(node);
    return Object.freeze({
      key,
      label: stringField(activity, "label"),
      kind: stringField(activity, "phase"),
      startOffsetMs: numberField(activity, "startOffsetMs"),
      durationMs: nullableNumber(activity.durationMs),
      ...(activity.outcome === "failed" ? { failed: true } : {}),
      ...(children.length === 0 ? {} : { children: Object.freeze(children) }),
    });
  };
  const nodes = (byParent.get(null) ?? []).map(node);
  const durationMs = activities.reduce<number | null>((maximum, activity) => {
    const start = numberField(activity, "startOffsetMs");
    const duration = nullableNumber(activity.durationMs);
    return duration === null ? maximum : Math.max(maximum ?? 0, start + duration);
  }, null);
  const data: WaterfallContent = activities.length === 0 ? Object.freeze([]) : Object.freeze([{
    key: locator,
    label: locator,
    durationMs,
    nodes: Object.freeze(nodes),
    locator,
  }]);
  return Object.freeze({ data, slice: sliceFromState(timing.state, data, "Execution timeline") });
}

function closeUsage(trace: JsonRecord): ClosedEvidenceSlice<UsageTableData> {
  const usage = recordField(trace, "usage");
  const observations: AttemptUsageObservation[] = [];
  for (const value of arrayField(usage, "observations")) {
    const item = optionalRecord(value);
    if (item === undefined || typeof item.kind !== "string" || typeof item.turnId !== "string") continue;
    if (item.kind === "token-bucket" && typeof item.usageObservationId === "string" &&
      typeof item.provider === "string" && typeof item.bucket === "string" &&
      typeof item.tokens === "number") {
      observations.push({
        kind: "token-bucket" as const,
        usageObservationId: item.usageObservationId,
        turnId: item.turnId,
        provider: item.provider,
        bucket: item.bucket,
        tokens: item.tokens,
      });
      continue;
    }
    if (item.kind === "request" && typeof item.usageObservationId === "string" &&
      typeof item.provider === "string" && typeof item.requestKind === "string") {
      observations.push({
        kind: "request" as const,
        usageObservationId: item.usageObservationId,
        turnId: item.turnId,
        provider: item.provider,
        requestKind: item.requestKind,
      });
      continue;
    }
    if (item.kind === "provider-cost" && typeof item.usageObservationId === "string" &&
      typeof item.provider === "string" && typeof item.amount === "string" &&
      typeof item.currency === "string") {
      observations.push({
        kind: "provider-cost" as const,
        usageObservationId: item.usageObservationId,
        turnId: item.turnId,
        provider: item.provider,
        amount: item.amount,
        currency: item.currency,
      });
    }
  }
  const conversation = recordField(trace, "conversation");
  const items = arrayField(conversation, "items");
  const data: UsageTableData = Object.freeze({
    turns: arrayField(conversation, "turns").length,
    toolCalls: items.filter((value) => optionalRecord(value)?.kind === "tool-call").length,
    observations: Object.freeze(observations),
  });
  return sliceFromState(usage.state, data, "Usage");
}

function closeCommands(
  trace: JsonRecord,
  details: readonly InspectionDocument[],
  locator: string,
): ClosedEvidenceSlice<CommandEvidenceContent> {
  const commands = recordField(trace, "commands");
  const full = new Map<string, JsonRecord>();
  for (const document of details) {
    if (document.operation !== "attempt.trace.detail") continue;
    const detail = recordField(document, "detail");
    if (detail.kind === "command" && typeof detail.commandId === "string") {
      full.set(detail.commandId, detail);
    }
  }
  const items = arrayField(commands, "items").map((value, index): CommandEvidenceItem => {
    const outline = record(value, `trace.commands.items[${index}]`);
    const commandId = stringField(outline, "commandId");
    const command = full.get(commandId) ?? outline;
    const invocation = recordField(command, "invocation");
    const outcome = recordField(command, "outcome");
    const stdout = optionalRecord(command.stdout);
    const stderr = optionalRecord(command.stderr);
    const stdoutTruncation = optionalRecord(stdout?.truncation);
    const stderrTruncation = optionalRecord(stderr?.truncation);
    const exitCode = outcome.kind === "exited" && typeof outcome.exitCode === "number"
      ? outcome.exitCode
      : undefined;
    return Object.freeze({
      commandId,
      timingNodeId: commandId,
      phase: stringField(command, "phase"),
      display: invocationText(invocation),
      ...(exitCode === undefined ? {} : { exitCode }),
      invocation: invocation as ClosedJsonValue,
      ...(typeof command.workingDirectory === "string"
        ? { workingDirectory: command.workingDirectory }
        : {}),
      outcome: outcome as ClosedJsonValue,
      classification: exitCode === 0 ? "succeeded" : exitCode === undefined ? "observed" : "failed",
      ...(typeof stdout?.text === "string" && stdout.text.length > 0 ? { stdout: stdout.text } : {}),
      ...(typeof stderr?.text === "string" && stderr.text.length > 0 ? { stderr: stderr.text } : {}),
      collectionState: commands.state === "partial" ? "partial" : "complete",
      ...(stdout === undefined
        ? {}
        : {
            stdoutState: stdout.textTruncated === true || stdoutTruncation?.state === "truncated"
              ? "truncated"
              : "complete",
            ...(typeof stdout.retainedBytes === "number" ? { stdoutRetainedBytes: stdout.retainedBytes } : {}),
            ...(typeof stdout.totalSafeUtf8Bytes === "number" ? { stdoutTotalBytes: stdout.totalSafeUtf8Bytes } : {}),
          }),
      ...(stderr === undefined
        ? {}
        : {
            stderrState: stderr.textTruncated === true || stderrTruncation?.state === "truncated"
              ? "truncated"
              : "complete",
            ...(typeof stderr.retainedBytes === "number" ? { stderrRetainedBytes: stderr.retainedBytes } : {}),
            ...(typeof stderr.totalSafeUtf8Bytes === "number" ? { stderrTotalBytes: stderr.totalSafeUtf8Bytes } : {}),
          }),
    });
  });
  return sliceFromState(commands.state, Object.freeze({ commands: Object.freeze(items), locator }), "Commands");
}

function closeDiagnostics(trace: JsonRecord): ClosedEvidenceSlice<AttemptDiagnosticsData> {
  const diagnostics = recordField(trace, "diagnostics");
  const items = arrayField(diagnostics, "items").map((value, index): AttemptDiagnosticView => {
    const item = record(value, `trace.diagnostics.items[${index}]`);
    const redaction = optionalRecord(item.redaction);
    const kind = stringField(item, "kind");
    const closedRedaction: AttemptDiagnosticView["redaction"] =
      redaction?.state === "applied" && typeof redaction.replacements === "number"
        ? { state: "applied", replacements: redaction.replacements }
        : { state: "none" };
    return Object.freeze({
      diagnosticId: stringField(item, "diagnosticId"),
      code: stringField(item, "code"),
      kind,
      phase: stringField(item, "phase"),
      summary: stringField(item, "summary"),
      level: kind === "execution-error" ? "error" : "warning",
      causes: Object.freeze(arrayField(item, "causes").flatMap((cause) => {
        const row = optionalRecord(cause);
        return typeof row?.code === "string" && typeof row.summary === "string"
          ? [{ code: row.code, summary: row.summary }]
          : [];
      })),
      redaction: closedRedaction,
      ...(item.sourceFrame === null || item.sourceFrame === undefined
        ? {}
        : { sourceFrame: closedJson(item.sourceFrame) }),
    });
  });
  const byPhase = new Map<string, AttemptDiagnosticView[]>();
  for (const item of items) {
    const group = byPhase.get(item.phase) ?? [];
    group.push(item);
    byPhase.set(item.phase, group);
  }
  const data: AttemptDiagnosticsData = Object.freeze({
    groups: Object.freeze([...byPhase].map(([phase, group]) => Object.freeze({
      phase,
      items: Object.freeze(group),
    }))),
  });
  return sliceFromState(diagnostics.state, data, "Diagnostics");
}

function closeSources(
  sources: JsonRecord,
  assertions: AttemptAssertionsData,
  trace: JsonRecord,
  locator: string,
): {
  readonly data: SourceContent | null;
  readonly slice: ClosedEvidenceSlice<SourceContent>;
} {
  const contexts = arrayField(recordField(trace, "conversation"), "turns");
  const items = arrayField(sources, "items").flatMap((value, index) => {
    const item = optionalRecord(value);
    const content = optionalRecord(item?.content);
    if (
      item === undefined || content?.state !== "available" ||
      typeof item.sourceItemId !== "string" || typeof item.path !== "string" ||
      typeof item.sha256 !== "string" || typeof content.text !== "string"
    ) return [];
    const sourceContexts = contexts.flatMap((contextValue) => {
      const context = optionalRecord(contextValue);
      const source = optionalRecord(context?.context);
      return source?.state === "mapped" && source.sourceItemId === item.sourceItemId &&
          source.sha256 === item.sha256 && typeof context?.turnId === "string"
        ? [{ turnId: context.turnId, start: optionalRecord(source.start), end: optionalRecord(source.end) }]
        : [];
    });
    const lines: SourceLine[] = content.text.split("\n").map((text, lineIndex) => {
      const number = lineIndex + 1;
      const turnIds = sourceContexts.flatMap((context) =>
        typeof context.start?.line === "number" && typeof context.end?.line === "number" &&
          number >= context.start.line && number <= context.end.line
          ? [context.turnId]
          : []);
      return Object.freeze({
        number,
        text,
        ...(turnIds.length === 0 ? {} : { interaction: "send" as const, turnIds: Object.freeze(turnIds) }),
      });
    });
    return [Object.freeze({
      sourceItemId: item.sourceItemId,
      sha256: item.sha256,
      path: item.path,
      lines: Object.freeze(lines),
    } satisfies SourceBlockContent)];
  });
  if (items.length === 0) {
    return Object.freeze({
      data: null,
      slice: sliceFromState(sources.state, null as never, "Source navigation") as ClosedEvidenceSlice<SourceContent>,
    });
  }
  const data: SourceContent = Object.freeze({
    spine: items[0]!,
    detached: Object.freeze(items.slice(1)),
    locator,
  });
  const slice = sliceFromState(sources.state, data, "Source navigation");
  // Keep the already-closed Assertions relation explicit. SourceView performs
  // the exact sourceItemId + sha256 + line join later; no path/ordinal fallback.
  void assertions;
  return Object.freeze({ data, slice });
}

function closeDiff(diff: JsonRecord): ClosedEvidenceSlice<DiffContent> {
  if (diff.state === "not-recorded" || Object.keys(diff).length === 0) {
    return Object.freeze({
      state: "not-recorded",
      limitations: Object.freeze([{
        code: "file-changes-not-recorded",
        summary: "File changes collection was not recorded for this Attempt.",
      }]),
    });
  }
  // attempt.diff remains a fixed Inspection operation. The current compact
  // result does not expose verified patch text, so the UI keeps an explicit
  // unavailable slice instead of interpreting content handles or inventing a diff.
  return Object.freeze({
    state: "unavailable",
    limitations: Object.freeze([{
      code: "file-changes-content-unavailable",
      summary: "File changes collection has no display-safe patch projection.",
    }]),
  });
}

function sliceFromState<Data>(
  state: unknown,
  data: Data,
  label: string,
): ClosedEvidenceSlice<Data> {
  if (state === "available" || state === "complete") {
    return Object.freeze({ state: "available", data });
  }
  const limitations = Object.freeze([{ code: String(state ?? "unavailable"), summary: `${label}: ${String(state ?? "unavailable")}.` }]);
  if (state === "partial") return Object.freeze({ state: "partial", data, limitations });
  if (state === "not-recorded") return Object.freeze({ state: "not-recorded", limitations });
  return Object.freeze({ state: "unavailable", limitations });
}

function closeScore(value: JsonRecord | undefined): AttemptAssertionView["score"] {
  if (value === undefined || value.state === "not-scored" || typeof value.points !== "number") return undefined;
  if (value.state === "earned" && typeof value.earned === "number") {
    return Object.freeze({ state: "earned", points: value.points, earned: value.earned });
  }
  return Object.freeze({ state: "unavailable", points: value.points });
}

function assertionDecision(value: unknown): AssertionDecisionState {
  return value === "matched" || value === "mismatched" || value === "unavailable" ||
      value === "errored" || value === "not-applicable"
    ? value
    : "unavailable";
}

function matcherAnchor(
  value: { readonly kind: "tool-occurrence"; readonly toolOccurrenceId: string } |
    { readonly kind: "event"; readonly eventId: string },
): string {
  return value.kind === "tool-occurrence"
    ? `tool:${value.toolOccurrenceId}`
    : `event:${value.eventId}`;
}

function factValue(value: null | boolean | number | string): ClosedAssertionFactValue {
  return Object.freeze({ kind: "value" as const, value });
}

function factFields(
  fields: readonly { readonly label: string; readonly value: ClosedAssertionFactValue }[],
): ClosedAssertionFactValue {
  return Object.freeze({
    kind: "fields" as const,
    fields: Object.freeze(fields.map((field) => Object.freeze(field))),
  });
}

/** Exact recursive close for the persisted AssertionFactValue algebra. */
function closeRecordedAssertionFact(value: unknown): ClosedAssertionFactValue {
  const fact = record(value, "assertion fact");
  if (fact.kind === "unavailable" && typeof fact.reason === "string") {
    return Object.freeze({ kind: "unavailable" as const, reason: fact.reason });
  }
  if (fact.kind === "value" && (fact.value === null || typeof fact.value === "string" ||
      typeof fact.value === "boolean" || typeof fact.value === "number" && Number.isFinite(fact.value))) {
    return factValue(fact.value);
  }
  if (fact.kind === "text" && typeof fact.text === "string") {
    return Object.freeze({ kind: "text" as const, text: fact.text });
  }
  if (fact.kind === "list") {
    return Object.freeze({
      kind: "list" as const,
      items: Object.freeze(arrayField(fact, "items").map(closeRecordedAssertionFact)),
    });
  }
  if (fact.kind === "fields") {
    return factFields(arrayField(fact, "fields").map((value, index) => {
      const field = record(value, `assertion fact.fields[${index}]`);
      return Object.freeze({
        label: stringField(field, "label"),
        value: closeRecordedAssertionFact(field.value),
      });
    }));
  }
  throw new Error("Assertion fact has an invalid closed shape");
}

/** Generic JSON close; deliberately separate from the persisted fact algebra. */
function assertionFact(value: unknown): ClosedAssertionFactValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return factValue(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? factValue(value)
      : Object.freeze({ kind: "unavailable" as const, reason: "source-unavailable" });
  }
  if (Array.isArray(value)) {
    return Object.freeze({ kind: "list" as const, items: Object.freeze(value.map(assertionFact)) });
  }
  const object = optionalRecord(value);
  if (object === undefined) return Object.freeze({ kind: "unavailable" as const, reason: "source-unavailable" });
  return factFields(Object.entries(object).map(([label, entry]) => ({
      label,
      value: assertionFact(entry),
    })));
}

function closedFactText(value: ClosedAssertionFactValue): string {
  switch (value.kind) {
    case "unavailable":
      return value.reason;
    case "value":
      return typeof value.value === "string" ? value.value : String(value.value);
    case "text":
      return value.text;
    case "list":
      return value.items.map(closedFactText).join(", ");
    case "fields":
      return value.fields.map((field) => `${field.label}: ${closedFactText(field.value)}`).join(" · ");
  }
}

function conversationPreview(item: JsonRecord, kind: string): string {
  if (kind === "message" && typeof item.text === "string") return item.text;
  if (kind === "tool-call") {
    return `${typeof item.tool === "string" ? item.tool : "tool"} ${typeof item.input === "string" ? item.input : ""}`.trim();
  }
  if (kind === "tool-result" && typeof item.output === "string") return item.output;
  if (typeof item.summary === "string") return item.summary;
  if (kind === "input-request" && typeof item.prompt === "string") {
    return typeof item.response === "string" ? `${item.prompt}\n${item.response}` : item.prompt;
  }
  return JSON.stringify(item);
}

function invocationText(value: JsonRecord): string {
  if (value.kind === "shell" && typeof value.command === "string") return value.command;
  if (value.kind === "argv" && typeof value.executable === "string") {
    return [value.executable, ...stringArray(value.arguments)].join(" ");
  }
  return JSON.stringify(value);
}

function toolOutcome(value: unknown): "completed" | "rejected" | "failed" | "cancelled" | undefined {
  return value === "completed" || value === "rejected" || value === "failed" || value === "cancelled"
    ? value
    : undefined;
}

function turnVerdict(value: unknown): ConversationTurn["verdict"] {
  if (value === "completed") return "passed";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "skipped";
  if (value === "interrupted") return "errored";
  return undefined;
}

function verdict(value: unknown, outcome: unknown): "passed" | "failed" | "errored" | "skipped" | "unknown" {
  if (value === "passed" || value === "failed" || value === "errored" || value === "skipped") return value;
  if (outcome === "errored" || outcome === "interrupted") return "errored";
  if (outcome === "cancelled") return "skipped";
  return "unknown";
}

function recordField(value: object, key: string): JsonRecord {
  return record(Reflect.get(value, key), key);
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as JsonRecord;
}

function optionalRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function arrayField(value: JsonRecord, key: string): readonly unknown[] {
  const field = value[key];
  if (!Array.isArray(field)) throw new Error(`${key} must be an array.`);
  return field;
}

function stringField(value: JsonRecord, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`${key} must be a string.`);
  return field;
}

function instantField(value: JsonRecord, key: string): string {
  const field = value[key];
  if (typeof field !== "number" || !isUtcMillis(field)) {
    throw new Error(`${key} must be UTC epoch milliseconds.`);
  }
  return new Date(field).toISOString();
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function numberField(value: JsonRecord, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) throw new Error(`${key} must be a number.`);
  return field;
}

function integerField(value: JsonRecord, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isSafeInteger(field)) throw new Error(`${key} must be an integer.`);
  return field;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function closedJson(value: unknown): ClosedJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(closedJson));
  const object = optionalRecord(value);
  if (object === undefined) return null;
  return Object.freeze(Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, closedJson(entry)])));
}
