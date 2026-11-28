import type { InspectionSuccessDocumentFor } from "@niceeval/inspection/public.ts";
import {
  type AssertionDecisionState,
  type AttemptAssertionDiagnosticNode,
  type AttemptInspectionAssertionSourceSite,
  type AttemptAssertionSourceSite,
  type AttemptAssertionView,
  type AttemptAssertionsData,
  type AttemptClosedAssertionEntry,
  type AttemptDiagnosticView,
  type AttemptDiagnosticsData,
  type AttemptMatcherDetail,
  type AttemptMatcherTarget,
  type AttemptUsageObservation,
  type ClosedEvidenceSlice,
  type UsageTableData,
} from "../details/index.tsx";
import type {
  CommandEvidenceContent,
  CommandEvidenceItem,
  ConversationContent,
  ConversationEntry,
  ConversationTurn,
} from "../../components/primitives/conversation.tsx";
import type {
  MatcherFilterDebuggerContent,
  MatcherFilterFieldContent,
  MatcherFilterNotice,
  MatcherFilterRowContent,
} from "../../components/primitives/matcher-filter-debugger.tsx";
import type { SourceBlockContent, SourceContent, SourceLine } from "../../components/primitives/source-view.tsx";
import type { ClosedAssertionFactValue, ClosedJsonValue } from "../../components/primitives/shared.ts";
import type { WaterfallContent, WaterfallNode } from "../../components/primitives/waterfall.tsx";

type JsonRecord = Readonly<Record<string, unknown>>;

type AssertionDocument = InspectionSuccessDocumentFor<"attempt.assertion.detail">;
type TraceDetailDocument = InspectionSuccessDocumentFor<"attempt.trace.detail">;

export function projectAssertion(document: AssertionDocument): AttemptAssertionView {
  return closeAssertion(recordField(document, "assertion"));
}

export function projectAssertions(documents: readonly AssertionDocument[]): ClosedEvidenceSlice<AttemptAssertionsData> {
  return closeAssertions(documents.map((document) => recordField(document, "assertion"))).slice;
}

export interface TraceDetailViewModel {
  readonly kind: string;
  readonly identity: string;
  readonly content: ClosedJsonValue;
}

export function projectTraceDetail(document: TraceDetailDocument): TraceDetailViewModel {
  const detail = recordField(document, "detail");
  function traceIdentity(): string {
    if (typeof detail.itemId === "string") return detail.itemId;
    if (typeof detail.toolOccurrenceId === "string") return detail.toolOccurrenceId;
    if (typeof detail.commandId === "string") return detail.commandId;
    return "trace-detail";
  }
  return {
    kind: stringField(detail, "kind"),
    identity: traceIdentity(),
    content: closedJson(detail),
  };
}

export function projectConversation(
  trace: InspectionSuccessDocumentFor<"attempt.trace">,
  details: readonly TraceDetailDocument[],
  locator: string,
): ClosedEvidenceSlice<ConversationContent> {
  return closeConversation(recordField(trace, "trace"), details, locator);
}

export function projectCommands(
  trace: InspectionSuccessDocumentFor<"attempt.trace">,
  details: readonly TraceDetailDocument[],
  locator: string,
): ClosedEvidenceSlice<CommandEvidenceContent> {
  return closeCommands(recordField(trace, "trace"), details, locator);
}

export function projectDiagnostics(
  trace: InspectionSuccessDocumentFor<"attempt.trace">,
): ClosedEvidenceSlice<AttemptDiagnosticsData> {
  return closeDiagnostics(recordField(trace, "trace"));
}

export function projectTiming(
  document: InspectionSuccessDocumentFor<"attempt.timing">,
  locator: string,
): ClosedEvidenceSlice<WaterfallContent> {
  return closeTiming(recordField(document, "timing"), locator).slice;
}

export function projectUsage(
  document: InspectionSuccessDocumentFor<"attempt.usage">,
  trace: InspectionSuccessDocumentFor<"attempt.trace">,
): ClosedEvidenceSlice<UsageTableData> {
  return closeUsage(recordField(trace, "trace"), recordField(document, "usage"));
}

export function projectSources(
  document: InspectionSuccessDocumentFor<"attempt.sources">,
  trace: InspectionSuccessDocumentFor<"attempt.trace">,
  locator: string,
): ClosedEvidenceSlice<SourceContent | undefined> {
  return closeSources(recordField(document, "sources"), recordField(trace, "trace"), locator).slice;
}

export type AttemptArtifactsViewModel =
  | { readonly state: "not-recorded" }
  | {
      readonly state: "available";
      readonly contentCount: number;
      readonly contentsTruncated: boolean;
      readonly value: ClosedJsonValue;
    };

export function projectArtifacts(
  document: InspectionSuccessDocumentFor<"attempt.artifacts">,
): AttemptArtifactsViewModel {
  const artifacts = recordField(document, "artifacts");
  if (artifacts.state !== "available") {
    return { state: "not-recorded" };
  }
  return {
    state: "available",
    contentCount: Array.isArray(artifacts.contents) ? artifacts.contents.length : 0,
    contentsTruncated: artifacts.contentsTruncated === true,
    value: closedJson(artifacts.value),
  };
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
  const attention = entries.filter((entry) => entry.display.outcome !== "passed" || entry.score !== undefined);
  const passed = entries.filter((entry) => entry.display.outcome === "passed" && entry.score === undefined);
  const byGroup = new Map<string, AttemptAssertionView[]>();
  for (const entry of passed) {
    const group = entry.display.groupPath.join(" > ") || "Passed checks";
    const values = byGroup.get(group) ?? [];
    values.push(entry);
    byGroup.set(group, values);
  }
  const scoreEntries = entries.flatMap(({ score }) => (score === undefined ? [] : [score]));
  const data: AttemptAssertionsData = {
    attention,
    passedGroups: [...byGroup].map(([group, items]) => ({
      group,
      items,
    })),
    evaluationKind: scoreEntries.length === 0 ? "pass" : "points",
  };
  return {
    data,
    slice: { state: "available" as const, data },
  };
}

function closeAssertion(detail: JsonRecord): AttemptAssertionView {
  const entry = recordField(detail, "entry");
  const display = recordField(detail, "display");
  const decision = recordField(entry, "decision");
  const evaluation = recordField(entry, "evaluation");
  const contribution = optionalRecord(entry.contribution) ?? optionalRecord(decision.contribution);
  const criterion = recordField(entry, "criterion");
  const materials = recordField(entry, "materials");
  const judgeMaterial = optionalRecord(entry.judgeMaterial);
  const scoreMatchAudit = optionalRecord(entry.scoreMatchAudit);
  const policy = optionalRecord(entry.policy);
  const condition = optionalRecord(policy?.condition);
  const result = assertionDecision(decision.result);
  const retainedSourceSites = arrayField(detail, "sourceSites").flatMap((value) => {
    const site = optionalRecord(value);
    const source = optionalRecord(site?.source);
    const start = optionalRecord(site?.start);
    const end = optionalRecord(site?.end);
    if (
      site === undefined ||
      source === undefined ||
      start === undefined ||
      end === undefined ||
      typeof site.entryId !== "string" ||
      typeof site.sourceOrder !== "number" ||
      typeof site.role !== "string" ||
      typeof source.sourceItemId !== "string" ||
      typeof source.sha256 !== "string" ||
      typeof start.line !== "number" ||
      typeof start.column !== "number" ||
      typeof end.line !== "number" ||
      typeof end.column !== "number"
    )
      return [];
    return [
      {
        entryId: site.entryId,
        sourceOrder: site.sourceOrder,
        role: site.role,
        source: source as ClosedJsonValue,
        start: { line: start.line, column: start.column },
        end: { line: end.line, column: end.column },
      } satisfies AttemptInspectionAssertionSourceSite,
    ];
  });
  const sourceSites: readonly AttemptAssertionSourceSite[] = retainedSourceSites.map((site) => {
    const source = record(site.source, "assertion.sourceSites[].source");
    return {
      ...site,
      target: {
        state: "exact" as const,
        sourceItemId: stringField(source, "sourceItemId"),
        sha256: stringField(source, "sha256"),
      },
    };
  });
  const check = closeDiagnostic(recordField(detail, "check"));
  const matcherDetail = recordField(detail, "matcher");
  const matcher = closeMatcher(matcherDetail);
  const matcherDebugger = closeMatcherDebugger(matcherDetail.debugger);
  const checkFact = assertionCriterionFact(criterion);
  const observedFact = assertionObservedFact(evaluation, matcher);
  const expectedFact = assertionExpectedFact(condition);
  const explanationFact = assertionExplanationFact(entry, check);
  const sourceFact = assertionSourceFact(
    materials,
    judgeMaterial,
    optionalRecord(entry.agentJudgeAudit) ?? scoreMatchAudit,
  );
  const closed: AttemptClosedAssertionEntry = {
    entryId: stringField(detail, "entryId"),
    display: {
      label: typeof display.label === "string" ? display.label : undefined,
      groupPath: stringArray(display.groupPath),
    },
    entry: entry as ClosedJsonValue,
    sourceSites: retainedSourceSites,
    check,
    matcher,
  };
  const name = typeof display.label === "string" ? display.label : closed.entryId;
  const score = closeScore(contribution);
  const gate = decision.gate;
  function assertionOutcome() {
    if (result === "matched") return "passed" as const;
    if (result === "mismatched" || result === "errored") return "failed" as const;
    return "unavailable" as const;
  }
  function assertionSeverity() {
    if (gate === "failed" || gate === "unavailable") return "gate" as const;
    return score === undefined ? ("recorded" as const) : ("scored" as const);
  }
  return {
    entryId: closed.entryId,
    closed,
    display: {
      name,
      severity: assertionSeverity(),
      outcome: assertionOutcome(),
      groupPath: closed.display.groupPath,
      detail: typeof decision.reason === "string" ? decision.reason : "",
    },
    sourceSites,
    check: checkFact,
    decision: {
      result,
      observed: observedFact,
      expected: expectedFact,
      diagnosticTree: explanationFact,
      reason: typeof decision.reason === "string" ? decision.reason : undefined,
    },
    evidence: {
      source: sourceFact,
      check: checkFact,
      observed: observedFact,
      expected: expectedFact,
      explanation: explanationFact,
      matcherDebugger,
    },
    score,
  };
}

function closeDiagnostic(value: JsonRecord): AttemptAssertionDiagnosticNode {
  return {
    label: stringField(value, "label"),
    state: stringField(value, "state"),
    expected: closedJson(value.expected),
    observed: closedJson(value.observed),
    reason: nullableString(value.reason),
    anchor: closedJson(value.anchor),
    children: arrayField(value, "children").map((child, index) =>
      closeDiagnostic(record(child, `check.children[${index}]`)),
    ),
  };
}

function assertionCriterionFact(criterion: JsonRecord): ClosedAssertionFactValue {
  return criterion.state === "available"
    ? assertionFact(criterion.value)
    : { kind: "unavailable" as const, reason: "not-recorded" };
}

function assertionExpectedFact(condition: JsonRecord | undefined): ClosedAssertionFactValue {
  return condition?.state === "available"
    ? assertionFact(condition.value)
    : { kind: "unavailable" as const, reason: "not-recorded" };
}

function assertionObservedFact(evaluation: JsonRecord, matcher: AttemptMatcherDetail): ClosedAssertionFactValue {
  const observed = closeRecordedAssertionFact(evaluation.observed);
  function receiptFields() {
    if (evaluation.kind === "ordinary") {
      const receipt = evaluation.receipt;
      if (receipt === undefined || receipt === null) return [];
      return [{ label: "receipt", value: assertionFact(receipt) }];
    }
    if (evaluation.kind === "matcher-current" && !Array.isArray(matcher.comparator)) {
      const receipt = matcher.receipt;
      if (receipt !== undefined && receipt !== null) return [{ label: "receipt", value: assertionFact(receipt) }];
    }
    return [];
  }
  return factFields([
    ...(observed.kind === "fields" ? observed.fields : [{ label: "value", value: observed }]),
    ...receiptFields(),
  ]);
}

function assertionSourceFact(
  materials: JsonRecord,
  judgeMaterial: JsonRecord | undefined,
  scoreMatchAudit: JsonRecord | undefined,
): ClosedAssertionFactValue {
  const source = assertionMaterialFact(recordField(materials, "source"));
  const evidence = arrayField(materials, "evidence").map((value, index) =>
    assertionMaterialFact(record(value, `materials.evidence[${index}]`)),
  );
  const limitations = arrayField(materials, "limitations").map(assertionFact);
  return factFields([
    { label: "input", value: source },
    ...(judgeMaterial === undefined ? [] : [{ label: "judge material", value: assertionFact(judgeMaterial) }]),
    ...(scoreMatchAudit === undefined ? [] : [{ label: "model evaluation", value: assertionFact(scoreMatchAudit) }]),
    ...(evidence.length === 0 ? [] : [{ label: "evidence", value: { kind: "list" as const, items: evidence } }]),
    { label: "coverage", value: assertionFact(materials.coverage) },
    ...(limitations.length === 0
      ? []
      : [{ label: "limitations", value: { kind: "list" as const, items: limitations } }]),
  ]);
}

function assertionExplanationFact(entry: JsonRecord, check: AttemptAssertionDiagnosticNode): ClosedAssertionFactValue {
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
      ...(!labels.has("reason") && check.reason !== undefined
        ? [{ label: "reason", value: factValue(check.reason) }]
        : []),
    ]);
  }
  return diagnosticFact(check);
}

function assertionDiagnosticValue(value: unknown): ClosedAssertionFactValue {
  const diagnostic = optionalRecord(value);
  return diagnostic !== undefined &&
    (diagnostic.kind === "unavailable" ||
      diagnostic.kind === "value" ||
      diagnostic.kind === "text" ||
      diagnostic.kind === "list" ||
      diagnostic.kind === "fields")
    ? closeRecordedAssertionFact(value)
    : assertionFact(value);
}

/** Current diagnostic field names -> the old AssertionEvidence field names. */
function renameLegacyDiagnosticFields(value: ClosedAssertionFactValue): ClosedAssertionFactValue {
  if (value.kind === "list") {
    return {
      kind: "list" as const,
      items: value.items.map(renameLegacyDiagnosticFields),
    };
  }
  if (value.kind !== "fields") return value;
  const labels = new Set(value.fields.map((field) => field.label));
  function diagnosticLabel(label: string): string {
    if (label === "observed" && !labels.has("received")) return "received";
    if (label === "message" && !labels.has("reason")) return "reason";
    return label;
  }
  return factFields(
    value.fields.map((field) => ({
      label: diagnosticLabel(field.label),
      value: renameLegacyDiagnosticFields(field.value),
    })),
  );
}

/** Current Inspection diagnostic node -> the old MatchDiagnostic fact algebra. */
function diagnosticFact(node: AttemptAssertionDiagnosticNode): ClosedAssertionFactValue {
  const anchor = optionalRecord(node.anchor);
  function locatorFields() {
    function locatorIdentity(): string | undefined {
      if (typeof anchor?.id === "string") return anchor.id;
      if (typeof anchor?.toolOccurrenceId === "string") return anchor.toolOccurrenceId;
      if (typeof anchor?.eventId === "string") return anchor.eventId;
      return undefined;
    }
    const id = locatorIdentity();
    if (id === undefined) return [];
    return [{ label: "locator", value: factFields([{ label: "id", value: factValue(id) }]) }];
  }
  return factFields([
    { label: "code", value: factValue(node.label) },
    ...(node.expected === null ? [] : [{ label: "expected", value: assertionDiagnosticValue(node.expected) }]),
    ...(node.observed === null ? [] : [{ label: "received", value: assertionDiagnosticValue(node.observed) }]),
    ...(node.reason === undefined ? [] : [{ label: "reason", value: factValue(node.reason) }]),
    ...locatorFields(),
    {
      label: "children",
      value: {
        kind: "list" as const,
        items: node.children.map((child, index) =>
          factFields([
            { label: "index", value: factValue(index) },
            { label: "label", value: factValue(child.label) },
            { label: "state", value: factValue(diagnosticMatchState(child.state)) },
            { label: "diagnostic", value: diagnosticFact(child) },
          ]),
        ),
      },
    },
  ]);
}

function diagnosticMatchState(value: string): "matched" | "mismatched" | "unavailable" {
  return value === "matched" || value === "mismatched" ? value : "unavailable";
}

function assertionMaterialFact(value: JsonRecord): ClosedAssertionFactValue {
  if (value.kind === "snapshot") return assertionFact(value.value);
  if (value.kind === "unavailable") {
    return { kind: "unavailable" as const, reason: "not-recorded" };
  }
  if (value.kind !== "content") throw new Error("Assertion material kind is invalid");
  const content = recordField(value, "content");
  if (content.state !== "available" || typeof content.base64 !== "string") {
    throw new Error("Assertion material content is unavailable");
  }
  const text = decodeUtf8Base64(content.base64);
  if (value.encoding === "json") return assertionFact(JSON.parse(text));
  if (value.encoding === "utf-8") return { kind: "text" as const, text };
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
    return {
      state,
      queryKind: "unavailable" as const,
      subject,
      querySummary: "Matcher query was not retained",
      facts: [],
      steps: [],
      atEvaluation: {
        state: final.state,
        rows: final.rows.map((row) => row.content),
        notices: [],
      },
      afterEvaluation: [],
      relationNotice: "historical-not-recorded" as const,
    };
  }

  const query = recordField(debuggerView, "query");
  const queryKind = matcherQueryKind(query.kind);
  const querySummaries =
    queryKind === "collection-filter"
      ? [closeRecordedAssertionFact(query.summary)]
      : arrayField(query, "summaries").map(closeRecordedAssertionFact);
  const querySummary =
    queryKind === "collection-filter"
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
  return {
    state,
    queryKind,
    subject,
    querySummary,
    facts: [
      {
        kind: "observed" as const,
        value: matcherObservedFact(queryKind, querySummaries.length, receipt),
      },
      {
        kind: "examined" as const,
        value: matcherExaminedFact(queryKind, receipt),
      },
    ],
    steps: arrayField(debuggerView, "steps").map(closeMatcherStep),
    atEvaluation: {
      state: atEvaluation.state,
      rows: atEvaluation.rows.map((row) => row.content),
      notices,
    },
    afterEvaluation: final.rows.filter((row) => row.phase === "outside-evaluation-snapshot").map((row) => row.content),
    relationNotice,
  };
}

function closeMatcherSourceCollection(value: JsonRecord): ClosedMatcherSourceCollection {
  return {
    state: matcherSourceState(value.state),
    rows: arrayField(value, "rows").map((row, index) =>
      closeMatcherFilterRow(record(row, `matcher.debugger.source.rows[${index}]`)),
    ),
  };
}

function closeMatcherFilterRow(row: JsonRecord): ClosedMatcherFilterRow {
  const evaluation = recordField(row, "evaluation");
  const result = matcherRowState(evaluation.result);
  const difference =
    evaluation.difference === undefined ? undefined : closeRecordedAssertionFact(evaluation.difference);
  const conversationTarget = optionalRecord(row.conversationTarget);
  return {
    phase: matcherRowPhase(row.phase),
    content: {
      key: stringField(row, "rowId"),
      number: stringField(row, "number"),
      kind: matcherRowKind(row.kind),
      summary: stringField(row, "summary"),
      state: result,
      fields: matcherFilterFields(closeRecordedAssertionFact(row.detail)),
      difference,
      conversationTarget:
        conversationTarget?.state === "exact" && typeof conversationTarget.anchor === "string"
          ? { anchor: conversationTarget.anchor }
          : undefined,
    },
  };
}

function closeMatcherStep(value: unknown, index: number): NonNullable<MatcherFilterDebuggerContent["steps"]>[number] {
  const step = record(value, `matcher.debugger.steps[${index}]`);
  const conversationTarget = optionalRecord(step.conversationTarget);
  return {
    step: integerField(step, "step"),
    summary: closedFactText(closeRecordedAssertionFact(step.summary)),
    state: matcherStepState(step.state),
    sourceRow: typeof step.sourceRow === "string" ? step.sourceRow : undefined,
    conversationTarget:
      conversationTarget?.state === "exact" && typeof conversationTarget.anchor === "string"
        ? { anchor: conversationTarget.anchor }
        : undefined,
  };
}

function matcherFilterFields(value: ClosedAssertionFactValue): readonly MatcherFilterFieldContent[] {
  if (value.kind === "fields") {
    return value.fields.map((field) => ({
      label: field.label,
      value: closedFactText(field.value),
    }));
  }
  if (value.kind === "list") {
    return value.items.map((item, index) => ({
      label: String(index + 1),
      value: closedFactText(item),
    }));
  }
  return [{ label: "value", value: closedFactText(value) }];
}

function matcherCollectionQuerySummary(value: ClosedAssertionFactValue): string {
  const matcher = closedFactField(value, "matcher");
  const quantifier = closedFactField(value, "quantifier");
  const kind = quantifier === undefined ? undefined : closedFactField(quantifier, "kind");
  const count = quantifier === undefined ? undefined : closedFactField(quantifier, "count");
  const matcherSummary = matcher === undefined ? undefined : closedFactText(matcher);
  if (
    matcherSummary === undefined ||
    matcherSummary.length === 0 ||
    kind?.kind !== "value" ||
    typeof kind.value !== "string"
  )
    return closedFactText(value);
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

function closedFactField(value: ClosedAssertionFactValue, label: string): ClosedAssertionFactValue | undefined {
  return value.kind === "fields" ? value.fields.find((field) => field.label === label)?.value : undefined;
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
    return {
      en: `${receipt.matched} matched · ${receipt.mismatched} not matched · ${receipt.unavailable} unknown`,
      "zh-CN": `${receipt.matched} 条命中 · ${receipt.mismatched} 条未命中 · ${receipt.unavailable} 条无法判断`,
    };
  }
  if (
    queryKind === "ordered-sequence" &&
    typeof receipt.definitePrefixLength === "number" &&
    typeof receipt.possiblePrefixLength === "number"
  ) {
    return {
      en: `${receipt.definitePrefixLength}/${stepCount} definite · ${receipt.possiblePrefixLength}/${stepCount} possible`,
      "zh-CN": `${receipt.definitePrefixLength}/${stepCount} 步确定 · ${receipt.possiblePrefixLength}/${stepCount} 步可能`,
    };
  }
  return { en: "unavailable", "zh-CN": "不可用" };
}

function matcherExaminedFact(
  queryKind: "collection-filter" | "ordered-sequence",
  receipt: JsonRecord,
): { readonly en: string; readonly "zh-CN": string } {
  if (queryKind === "collection-filter" && typeof receipt.examined === "number") {
    const knownTotal = typeof receipt.knownTotal === "number" ? receipt.knownTotal : "?";
    return {
      en: `${receipt.examined}/${knownTotal} rows`,
      "zh-CN": `${receipt.examined}/${knownTotal} 条记录`,
    };
  }
  if (
    queryKind === "ordered-sequence" &&
    typeof receipt.sourceRows === "number" &&
    typeof receipt.comparisons === "number"
  ) {
    return {
      en: `${receipt.sourceRows} rows · ${receipt.comparisons} comparisons`,
      "zh-CN": `${receipt.sourceRows} 条记录 · ${receipt.comparisons} 次比较`,
    };
  }
  return { en: "unavailable", "zh-CN": "不可用" };
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

function matcherSourceState(value: unknown): MatcherFilterDebuggerContent["atEvaluation"]["state"] {
  if (value === "complete" || value === "partial" || value === "unavailable") return value;
  throw new Error("matcher.debugger source state is invalid");
}

function matcherRowKind(value: unknown): MatcherFilterRowContent["kind"] {
  if (value === "tool" || value === "event" || value === "legacy-source-row") return value;
  throw new Error("matcher.debugger row kind is invalid");
}

function matcherRowState(value: unknown): MatcherFilterRowContent["state"] {
  if (
    value === "matched" ||
    value === "mismatched" ||
    value === "unavailable" ||
    value === "not-evaluated" ||
    value === "not-retained" ||
    value === "outside-snapshot" ||
    value === "legacy"
  )
    return value;
  throw new Error("matcher.debugger row state is invalid");
}

function matcherRowPhase(value: unknown): ClosedMatcherFilterRow["phase"] {
  if (value === "at-evaluation" || value === "outside-evaluation-snapshot" || value === "historical") return value;
  throw new Error("matcher.debugger row phase is invalid");
}

function matcherStepState(value: unknown): NonNullable<MatcherFilterDebuggerContent["steps"]>[number]["state"] {
  if (value === "matched" || value === "possible" || value === "blocked" || value === "not-reached") return value;
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
    return [
      {
        state: target.state,
        anchor: closedAnchor,
        difference: closedJson(target.difference),
        conversationAnchor: matcherAnchor(closedAnchor),
      },
    ];
  });
  const join = optionalRecord(value.sandboxCommandJoin);
  const commandMatch =
    join?.state === "matched" && typeof join.commandId === "string"
      ? { state: "matched" as const, commandId: join.commandId }
      : {
          state: "unavailable" as const,
          reason: typeof join?.reason === "string" ? join.reason : "not-recorded",
        };
  const state =
    value.state === "ordinary" || value.state === "legacy" || value.state === "available" || value.state === "missing"
      ? value.state
      : "missing";
  return {
    state,
    sourceState: typeof value.sourceState === "string" ? value.sourceState : undefined,
    comparator: closedJson(value.comparator),
    sourceLedger: closedJson(value.sourceLedger),
    receipt: closedJson(value.receipt),
    result: closedJson(value.result),
    targets,
    sandboxCommandJoin: commandMatch,
    commandMatch,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  };
}

function closeConversation(
  trace: JsonRecord,
  details: readonly TraceDetailDocument[],
  locator: string,
): ClosedEvidenceSlice<ConversationContent> {
  const conversation = recordField(trace, "conversation");
  const outlineItems = arrayField(conversation, "items").map((item, index) =>
    record(item, `trace.conversation.items[${index}]`),
  );
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
    const entries = outlineItems
      .filter((item) => item.turnId === turnId)
      .map((item) => closeConversationEntry(itemDetails.get(stringField(item, "itemId")) ?? item));
    const verdict = turnVerdict(turn.outcome);
    return {
      key: turnId,
      label: `Turn ${integerField(turn, "sequence")}`,
      verdict,
      entries,
      durationMs: undefined,
    };
  });
  const data: ConversationContent = { turns, locator };
  return sliceFromState(conversation.state, data, "Closed observability");
}

function closeConversationEntry(item: JsonRecord): ConversationEntry {
  const itemId = stringField(item, "itemId");
  const kind = stringField(item, "kind");
  const occurrence = optionalRecord(item.occurrence);
  const occurrenceId =
    typeof item.toolOccurrenceId === "string"
      ? item.toolOccurrenceId
      : occurrence?.state === "exact" && typeof occurrence.toolOccurrenceId === "string"
        ? occurrence.toolOccurrenceId
        : undefined;
  const eventId = typeof item.eventId === "string" ? item.eventId : undefined;
  const preview = conversationPreview(item, kind);
  const role = typeof item.role === "string" ? item.role : undefined;
  const displayKind =
    kind === "message"
      ? role === "user"
        ? "user"
        : role === "assistant"
          ? "assistant"
          : "message"
      : kind === "tool-call" || kind === "tool-result"
        ? "tool"
        : kind;
  const input = typeof item.input === "string" ? item.input : "";
  const output = typeof item.output === "string" ? item.output : undefined;
  const phase =
    kind === "tool-call" ? ("started" as const) : kind === "tool-result" ? ("finished" as const) : undefined;
  const outcome = toolOutcome(item.outcome);
  const toolOccurrence: ConversationEntry["toolOccurrence"] =
    occurrence === undefined
      ? undefined
      : occurrenceId === undefined
        ? { state: "unavailable", reason: String(occurrence.reason ?? "not-recorded") }
        : { state: "exact", toolOccurrenceId: occurrenceId };
  const anchor =
    occurrenceId !== undefined
      ? matcherAnchor({ kind: "tool-occurrence", toolOccurrenceId: occurrenceId })
      : eventId === undefined
        ? undefined
        : matcherAnchor({ kind: "event", eventId });
  const detail: ConversationEntry["detail"] =
    phase === undefined
      ? { kind: "text", text: preview, className: "" }
      : {
          kind: "tool-evidence",
          content: phase === "started" ? { phase, inputSummary: input } : { phase, outputSummary: output, outcome },
        };
  return {
    id: itemId,
    eventId,
    sequence: typeof item.sequence === "number" ? item.sequence : undefined,
    kind: displayKind,
    preview,
    anchor,
    detail,
    raw: JSON.stringify(item),
    failed: outcome === "failed" || outcome === "rejected",
    callPhase: phase,
    callId: occurrenceId,
    toolOccurrence,
    callOutcome: outcome,
    commandMatch: { state: "unavailable" as const, reason: "not-recorded" },
  } satisfies ConversationEntry;
}

function closeTiming(
  timing: JsonRecord,
  locator: string,
): {
  readonly data: WaterfallContent;
  readonly slice: ClosedEvidenceSlice<WaterfallContent>;
} {
  const activities = arrayField(timing, "activities").map((value, index) =>
    record(value, `timing.activities[${index}]`),
  );
  const byParent = new Map<string | undefined, JsonRecord[]>();
  for (const activity of activities) {
    const parent = typeof activity.parentActivityId === "string" ? activity.parentActivityId : undefined;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(activity);
    byParent.set(parent, siblings);
  }
  const node = (activity: JsonRecord): WaterfallNode => {
    const key = stringField(activity, "activityId");
    const children = (byParent.get(key) ?? []).map(node);
    return {
      key,
      label: stringField(activity, "label"),
      kind: stringField(activity, "phase"),
      startOffsetMs: numberField(activity, "startOffsetMs"),
      durationMs: nullableNumber(activity.durationMs),
      failed: activity.outcome === "failed",
      children,
      open: false,
    };
  };
  const nodes = (byParent.get(undefined) ?? []).map(node);
  const durationMs = activities.reduce<number | undefined>((maximum, activity) => {
    const start = numberField(activity, "startOffsetMs");
    const duration = nullableNumber(activity.durationMs);
    return duration === undefined ? maximum : Math.max(maximum ?? 0, start + duration);
  }, undefined);
  const data: WaterfallContent =
    activities.length === 0
      ? []
      : [
          {
            key: locator,
            label: locator,
            durationMs,
            nodes,
            locator,
            href: undefined,
          },
        ];
  return { data, slice: sliceFromState(timing.state, data, "Execution timeline") };
}

function closeUsage(trace: JsonRecord, usage: JsonRecord): ClosedEvidenceSlice<UsageTableData> {
  const observations: AttemptUsageObservation[] = [];
  for (const value of arrayField(usage, "observations")) {
    const item = optionalRecord(value);
    if (item === undefined || typeof item.kind !== "string" || typeof item.turnId !== "string") continue;
    if (
      item.kind === "token-bucket" &&
      typeof item.usageObservationId === "string" &&
      typeof item.provider === "string" &&
      typeof item.bucket === "string" &&
      typeof item.tokens === "number"
    ) {
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
    if (
      item.kind === "request" &&
      typeof item.usageObservationId === "string" &&
      typeof item.provider === "string" &&
      typeof item.requestKind === "string"
    ) {
      observations.push({
        kind: "request" as const,
        usageObservationId: item.usageObservationId,
        turnId: item.turnId,
        provider: item.provider,
        requestKind: item.requestKind,
      });
      continue;
    }
    if (
      item.kind === "provider-cost" &&
      typeof item.usageObservationId === "string" &&
      typeof item.provider === "string" &&
      typeof item.amount === "string" &&
      typeof item.currency === "string"
    ) {
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
  const data: UsageTableData = {
    turns: arrayField(conversation, "turns").length,
    toolCalls: arrayField(conversation, "items").filter((value) => optionalRecord(value)?.kind === "tool-call").length,
    observations,
  };
  return sliceFromState(usage.state, data, "Usage");
}

function closeCommands(
  trace: JsonRecord,
  details: readonly TraceDetailDocument[],
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
    const exitCode = outcome.kind === "exited" && typeof outcome.exitCode === "number" ? outcome.exitCode : undefined;
    return {
      commandId,
      phase: stringField(command, "phase"),
      display: invocationText(invocation),
      exitCode,
      outcome: outcome as ClosedJsonValue,
      classification:
        exitCode === 0 ? "succeeded" : exitCode !== undefined && command.checked !== false ? "failed" : "observed",
      stdout: typeof stdout?.text === "string" && stdout.text.length > 0 ? stdout.text : undefined,
      stderr: typeof stderr?.text === "string" && stderr.text.length > 0 ? stderr.text : undefined,
    };
  });
  return sliceFromState(commands.state, { commands: items, locator }, "Commands");
}

function closeDiagnostics(trace: JsonRecord): ClosedEvidenceSlice<AttemptDiagnosticsData> {
  const diagnostics = optionalRecord(trace.diagnostics);
  if (diagnostics === undefined) {
    return {
      state: "unavailable",
      limitations: [
        {
          code: "diagnostics-projection-unavailable",
          summary: "Diagnostics are not exposed by the fixed execution projection.",
        },
      ],
    };
  }
  const items = arrayField(diagnostics, "items").map((value, index): AttemptDiagnosticView => {
    const item = record(value, `trace.diagnostics.items[${index}]`);
    const redaction = optionalRecord(item.redaction);
    const kind = stringField(item, "kind");
    const closedRedaction: AttemptDiagnosticView["redaction"] =
      redaction?.state === "applied" && typeof redaction.replacements === "number"
        ? { state: "applied", replacements: redaction.replacements }
        : { state: "none" };
    return {
      diagnosticId: stringField(item, "diagnosticId"),
      code: stringField(item, "code"),
      kind,
      phase: stringField(item, "phase"),
      summary: stringField(item, "summary"),
      level: kind === "execution-error" ? "error" : "warning",
      causes: arrayField(item, "causes").flatMap((cause) => {
        const row = optionalRecord(cause);
        return typeof row?.code === "string" && typeof row.summary === "string"
          ? [{ code: row.code, summary: row.summary }]
          : [];
      }),
      redaction: closedRedaction,
      sourceFrame: closedJson(item.sourceFrame),
    };
  });
  const byPhase = new Map<string, AttemptDiagnosticView[]>();
  for (const item of items) {
    const group = byPhase.get(item.phase) ?? [];
    group.push(item);
    byPhase.set(item.phase, group);
  }
  const data: AttemptDiagnosticsData = {
    groups: [...byPhase].map(([phase, group]) => ({
      phase,
      items: group,
    })),
  };
  return sliceFromState(diagnostics.state, data, "Diagnostics");
}

function closeSources(
  sources: JsonRecord,
  trace: JsonRecord,
  locator: string,
): {
  readonly data: SourceContent | undefined;
  readonly slice: ClosedEvidenceSlice<SourceContent | undefined>;
} {
  const contexts = arrayField(recordField(trace, "conversation"), "turns");
  const items = arrayField(sources, "items").flatMap((value, _index) => {
    const item = optionalRecord(value);
    const content = optionalRecord(item?.content);
    if (
      item === undefined ||
      content?.state !== "available" ||
      typeof item.sourceItemId !== "string" ||
      typeof item.path !== "string" ||
      typeof item.sha256 !== "string" ||
      typeof content.text !== "string"
    )
      return [];
    const sourceContexts = contexts.flatMap((contextValue) => {
      const context = optionalRecord(contextValue);
      const source = optionalRecord(context?.context);
      return source?.state === "mapped" &&
        source.sourceItemId === item.sourceItemId &&
        source.sha256 === item.sha256 &&
        typeof context?.turnId === "string"
        ? [{ turnId: context.turnId, start: optionalRecord(source.start), end: optionalRecord(source.end) }]
        : [];
    });
    const lines: SourceLine[] = content.text.split("\n").map((text, lineIndex) => {
      const number = lineIndex + 1;
      const turnIds = sourceContexts.flatMap((context) =>
        typeof context.start?.line === "number" &&
        typeof context.end?.line === "number" &&
        number >= context.start.line &&
        number <= context.end.line
          ? [context.turnId]
          : [],
      );
      return {
        number,
        text,
        interaction: undefined,
        tone: turnIds.length === 0 ? undefined : "send",
        turnIds,
        pill: undefined,
        aborted: false,
        details: [],
        calls: [],
      };
    });
    return [
      {
        sourceItemId: item.sourceItemId,
        sha256: item.sha256,
        path: item.path,
        lines,
      } satisfies SourceBlockContent,
    ];
  });
  if (items.length === 0) {
    return {
      data: undefined,
      slice: sliceFromState(sources.state, undefined, "Source navigation"),
    };
  }
  const data: SourceContent = {
    spine: items[0]!,
    detached: items.slice(1),
    locator,
    unmapped: undefined,
  };
  const slice = sliceFromState(sources.state, data, "Source navigation");
  return { data, slice };
}

function sliceFromState<Data>(state: unknown, data: Data, label: string): ClosedEvidenceSlice<Data> {
  if (state === "available" || state === "complete") {
    return { state: "available", data };
  }
  const limitations = [
    { code: String(state ?? "unavailable"), summary: `${label}: ${String(state ?? "unavailable")}.` },
  ];
  if (state === "partial") return { state: "partial", data, limitations };
  if (state === "not-recorded") return { state: "not-recorded", limitations };
  return { state: "unavailable", limitations };
}

function closeScore(value: JsonRecord | undefined): AttemptAssertionView["score"] {
  if (value === undefined || value.state === "not-scored" || typeof value.points !== "number") return undefined;
  if (value.state === "earned" && typeof value.earned === "number") {
    return { state: "earned", points: value.points, earned: value.earned };
  }
  return { state: "unavailable", points: value.points };
}

function assertionDecision(value: unknown): AssertionDecisionState {
  return value === "matched" ||
    value === "mismatched" ||
    value === "unavailable" ||
    value === "errored" ||
    value === "not-applicable"
    ? value
    : "unavailable";
}

function matcherAnchor(
  value:
    | { readonly kind: "tool-occurrence"; readonly toolOccurrenceId: string }
    | { readonly kind: "event"; readonly eventId: string },
): string {
  return value.kind === "tool-occurrence" ? `tool:${value.toolOccurrenceId}` : `event:${value.eventId}`;
}

function factValue(value: null | boolean | number | string): ClosedAssertionFactValue {
  return { kind: "value" as const, value };
}

function factFields(
  fields: readonly { readonly label: string; readonly value: ClosedAssertionFactValue }[],
): ClosedAssertionFactValue {
  return {
    kind: "fields" as const,
    fields,
  };
}

/** Exact recursive close for the persisted AssertionFactValue algebra. */
function closeRecordedAssertionFact(value: unknown): ClosedAssertionFactValue {
  const fact = record(value, "assertion fact");
  if (fact.kind === "unavailable" && typeof fact.reason === "string") {
    return { kind: "unavailable" as const, reason: fact.reason };
  }
  if (
    fact.kind === "value" &&
    (fact.value === null ||
      typeof fact.value === "string" ||
      typeof fact.value === "boolean" ||
      (typeof fact.value === "number" && Number.isFinite(fact.value)))
  ) {
    return factValue(fact.value);
  }
  if (fact.kind === "text" && typeof fact.text === "string") {
    return { kind: "text" as const, text: fact.text };
  }
  if (fact.kind === "list") {
    return {
      kind: "list" as const,
      items: arrayField(fact, "items").map(closeRecordedAssertionFact),
    };
  }
  if (fact.kind === "fields") {
    return factFields(
      arrayField(fact, "fields").map((value, index) => {
        const field = record(value, `assertion fact.fields[${index}]`);
        return {
          label: stringField(field, "label"),
          value: closeRecordedAssertionFact(field.value),
        };
      }),
    );
  }
  throw new Error("Assertion fact has an invalid closed shape");
}

/** Generic JSON close; deliberately separate from the persisted fact algebra. */
function assertionFact(value: unknown): ClosedAssertionFactValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return factValue(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? factValue(value) : { kind: "unavailable" as const, reason: "source-unavailable" };
  }
  if (Array.isArray(value)) {
    return { kind: "list" as const, items: value.map(assertionFact) };
  }
  const object = optionalRecord(value);
  if (object === undefined) return { kind: "unavailable" as const, reason: "source-unavailable" };
  return factFields(
    Object.entries(object).map(([label, entry]) => ({
      label,
      value: assertionFact(entry),
    })),
  );
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
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined;
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

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nullableNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function closedJson(value: unknown): ClosedJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  if (Array.isArray(value)) return value.map(closedJson);
  const object = optionalRecord(value);
  if (object === undefined) return null;
  return Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, closedJson(entry)]));
}
