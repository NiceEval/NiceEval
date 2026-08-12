// Package-private compatibility adapter for the retiring pre-Attachment
// standard Attempt page. It is deliberately reachable only from the legacy
// built-in definition: do not export it through report/built-in or report.
//
// TODO: remove this once the legacy loader can supply declared assessment and
// source projections. Until then, this adapter reads only facts already
// present in the loaded AttemptEvidence; it neither changes Record storage nor
// invents Attachment data.

import type { EvaluationFactResult } from "../../assertions/types.ts";
import type { AttemptEvidence } from "../../record/attempt-evidence.ts";
import {
  projectSourceView,
  type ProjectedSourceCall,
  type ProjectedSourceLine,
  type SourceCallSummary,
  type SourceContent as LegacySourceContent,
  type SourceContentNode as LegacySourceNode,
} from "../../record/annotated-source.ts";
import type { FactUseResult } from "../../record/fact-record.ts";
import { summaryText } from "../../assertions/display.ts";
import {
  Callouts,
  Col,
  CommandEvidence,
  Conversation,
  DiffView,
  SourceView,
  TableContentView,
  Waterfall,
} from "../definition/primitives.tsx";
import type {
  SourceBlockContent,
  SourceCallContent,
  SourceContent,
  SourceLine,
} from "../definition/primitives/source-view.tsx";
import type { TableContent, TableContentRow } from "../definition/cell.ts";
import { defineComponent } from "../definition/tree.ts";
import { formatPointsSuffix } from "../model/format.ts";
import type { UsageTableData } from "../model/types.ts";
import { AttemptSummary } from "../components/attempt-detail/index.tsx";
import {
  attemptCommandEvidenceData,
  attemptConversationData,
  attemptDiagnosticsData,
  attemptDiffData,
  attemptErrorData,
  attemptSummaryData,
  attemptTimelineData,
  usageTableData,
} from "../components/attempt-detail/compute.ts";
import {
  attemptCommandEvidenceContent,
  attemptConversationContent,
  attemptDiffContent,
  attemptNoticesContent,
  attemptTimelineContent,
  executionEvidenceUnavailableCallouts,
} from "../components/attempt-detail/content.tsx";

function sourceLocation(location: { readonly file: string; readonly line: number } | undefined): string {
  return location === undefined ? "unmapped" : `${location.file}:${location.line}`;
}

function factDetail(fact: EvaluationFactResult): string {
  const parts = [`producer: ${sourceLocation(fact.producerLoc)}`];
  if (fact.dependencyFactIds.length > 0) parts.push(`depends on: ${fact.dependencyFactIds.join(", ")}`);
  if (fact.outcome === "scored") parts.push(`score: ${fact.normalizedScore}`);
  if ("reason" in fact) parts.push(`reason: ${summaryText(fact.reason)}`);
  if (fact.outcome === "errored") parts.push(`error: ${fact.error.code}: ${summaryText(fact.error.message)}`);
  if (fact.expected !== undefined) parts.push(`expected: ${summaryText(fact.expected)}`);
  if (fact.received !== undefined) parts.push(`received: ${summaryText(fact.received)}`);
  if (fact.explanation !== undefined) parts.push(`explanation: ${summaryText(fact.explanation)}`);
  if (fact.evidence !== undefined) parts.push(`evidence: ${summaryText(fact.evidence)}`);
  return parts.join(" · ");
}

function factUseKey(use: FactUseResult): string {
  if (use.key !== undefined) return use.key;
  return use.useKind === "score" ? use.label : (use.label ?? use.method);
}

function factUseDetail(use: FactUseResult): string {
  const parts = [`consumer: ${sourceLocation(use.consumerLoc)}`];
  if (use.useKind === "verdict") {
    parts.push(`Fact: ${use.target.factId}`);
    if (use.target.kind === "score") parts.push(`at least: ${use.target.atLeast}`);
  } else if (use.input.kind === "direct") {
    parts.push(`direct: ${formatPointsSuffix(use.input.earned)}`);
  } else {
    parts.push(`Fact: ${use.input.factId} / max ${use.input.max}`);
  }
  if (use.useKind === "score" && use.outcome === "scored") {
    parts.push(`earned: ${formatPointsSuffix(use.earned)}`);
  }
  if ("reason" in use) parts.push(`reason: ${summaryText(use.reason)}`);
  if (use.outcome === "errored") parts.push(`error: ${use.error.code}: ${summaryText(use.error.message)}`);
  return parts.join(" · ");
}

function assessmentRow(
  kind: string,
  key: string,
  location: string,
  outcome: string,
  detail: string,
): TableContentRow {
  return {
    key: `${kind}:${key}:${location}`,
    cells: {
      kind: { kind: "text", text: kind },
      key: { kind: "text", text: key },
      location: { kind: "text", text: location },
      outcome: { kind: "text", text: outcome },
      detail: { kind: "text", text: detail },
    },
  };
}

function legacyAssessmentContent(attempt: AttemptEvidence): TableContent {
  const { result } = attempt;
  const rows: TableContentRow[] = [
    assessmentRow("Verdict", "attempt", "attempt", result.verdict, "four-state verdict recorded by the legacy result"),
  ];
  const facts = Array.isArray(result.factResults) ? result.factResults : [];
  const uses = Array.isArray(result.factUses) ? result.factUses : [];
  const hasFactGraph = Array.isArray(result.factResults) || Array.isArray(result.factUses);

  if (!hasFactGraph) {
    rows.push(assessmentRow(
      "Assertions",
      "legacy-record",
      "attempt",
      "unavailable",
      "This legacy Record did not persist a Fact graph.",
    ));
  } else if (facts.length === 0 && uses.length === 0) {
    rows.push(assessmentRow("Assertions", "attempt", "attempt", "recorded", "no Fact entries"));
  } else {
    for (const fact of facts) {
      rows.push(assessmentRow(
        "Fact",
        `${fact.name} [${fact.factId}]`,
        sourceLocation(fact.producerLoc),
        fact.outcome,
        factDetail(fact),
      ));
    }
    for (const use of uses) {
      rows.push(assessmentRow(
        use.useKind === "score" ? "Score" : "Fact use",
        factUseKey(use),
        sourceLocation(use.consumerLoc),
        use.outcome,
        factUseDetail(use),
      ));
    }
  }

  if (result.evaluationKind === "score") {
    const score = result.scoreResult;
    if (score === undefined) {
      rows.push(assessmentRow(
        "Score",
        "attempt",
        "attempt",
        "unavailable",
        "This legacy Record did not persist a score outcome.",
      ));
    } else {
      const detail = [
        `earned: ${formatPointsSuffix(score.earnedScore)}`,
        `credited: ${score.creditedScore === null ? "unavailable" : formatPointsSuffix(score.creditedScore)}`,
        ...(score.status === "skipped" ? [`reason: ${summaryText(score.reason)}`] : []),
        ...(score.status === "invalid" || score.status === "unavailable" ? [`issues: ${score.issues.length}`] : []),
        ...(score.status === "errored" ? [`errors: ${score.errors.length}`, `issues: ${score.issues.length}`] : []),
      ].join(" · ");
      rows.push(assessmentRow("Score", "attempt", "attempt", score.status, detail));
    }
  }

  for (const [key, value] of Object.entries(result.facts ?? {})) {
    rows.push(assessmentRow("Runtime fact", key, "attempt", "recorded", String(value)));
  }

  return {
    columns: [
      { key: "kind", header: "Kind" },
      { key: "key", header: "Key" },
      { key: "location", header: "Producer / consumer" },
      { key: "outcome", header: "State" },
      { key: "detail", header: "Detail" },
    ],
    rows,
  };
}

function legacyLineTone(line: ProjectedSourceLine): SourceLine["tone"] {
  const annotations = line.annotations;
  if (annotations.some((annotation) =>
    annotation.kind === "factUse" && annotation.use.useKind === "verdict" && annotation.use.outcome === "failed"
  )) return "gate-fail";
  const outcomes = annotations.flatMap((annotation) =>
    annotation.kind === "send" ? [] : [annotation.kind === "fact" ? annotation.fact.outcome : annotation.use.outcome]
  );
  if (outcomes.some((outcome) => outcome === "failed" || outcome === "errored")) return "soft-fail";
  if (outcomes.some((outcome) => outcome === "unavailable" || outcome.startsWith("notReached"))) return "unavailable";
  if (outcomes.some((outcome) => outcome === "passed" || outcome === "scored")) return "passed";
  return annotations.some((annotation) => annotation.kind === "send") ? "send" : undefined;
}

function legacyCallTone(summary: SourceCallSummary): SourceCallContent["tone"] {
  if (summary.aborted) return "gate-fail";
  if (summary.failed > 0 || (summary.points !== undefined && summary.points.earned < summary.points.available)) {
    return "soft-fail";
  }
  if (summary.unavailable > 0) return "unavailable";
  return "passed";
}

function legacyCallSummary(summary: SourceCallSummary): string {
  return [
    `${summary.checks} checks`,
    `${summary.passed} ✓`,
    `${summary.failed} ✗`,
    ...(summary.unavailable > 0 ? [`${summary.unavailable} unavailable`] : []),
    ...(summary.points === undefined ? [] : [`${summary.points.earned}/${summary.points.available} pts`]),
    ...(summary.aborted ? ["aborted"] : []),
  ].join(" · ");
}

function legacySourceCall(call: ProjectedSourceCall): SourceCallContent {
  if (call.target.kind === "source") {
    return {
      summary: legacyCallSummary(call.summary),
      tone: legacyCallTone(call.summary),
      open: call.open,
      target: { kind: "source", block: legacySourceBlock(call.target.node) },
    };
  }
  const calls = call.target.calls.map(legacySourceCall);
  return {
    summary: legacyCallSummary(call.summary),
    tone: legacyCallTone(call.summary),
    open: call.open,
    target: {
      kind: "opaque",
      label: call.target.kind === "package"
        ? `package: ${call.target.package}`
        : `source unavailable: ${call.target.file}${call.target.line === undefined ? "" : `:${call.target.line}`}`,
      ...(calls.length === 0 ? {} : { calls }),
    },
  };
}

function legacySourceBlock(node: LegacySourceNode): SourceBlockContent {
  return {
    path: node.file,
    lines: node.lines.map((line): SourceLine => {
      const points = line.annotations.reduce((total, annotation) =>
        annotation.kind === "factUse" && annotation.use.useKind === "score" && annotation.use.outcome === "scored"
          ? total + annotation.use.earned
          : total,
      0);
      const hasPoints = line.annotations.some((annotation) =>
        annotation.kind === "factUse" && annotation.use.useKind === "score" && annotation.use.outcome === "scored"
      );
      const tone = legacyLineTone(line);
      return {
        number: line.line,
        text: line.text,
        ...(tone === undefined ? {} : { tone }),
        ...(hasPoints ? { pill: formatPointsSuffix(points) } : {}),
        ...(line.aborted ? { aborted: true as const } : {}),
        ...(line.calls.length === 0 ? {} : { calls: line.calls.map(legacySourceCall) }),
      };
    }),
  };
}

function legacySourceContent(attempt: AttemptEvidence): SourceContent | null {
  const tree = attempt.evalSource;
  if (tree === null) return null;
  const source: LegacySourceContent = projectSourceView(tree, { mode: "web" });
  return {
    spine: legacySourceBlock(source.spine),
    detached: source.detached.map(legacySourceBlock),
    locator: attempt.locator,
  };
}

function usageContent(data: UsageTableData | null): TableContent | null {
  if (data === null) return null;
  const rows: TableContentRow[] = [];
  const add = (key: string, value: string) => rows.push({
    key,
    cells: { key: { kind: "text", text: key }, value: { kind: "text", text: value } },
  });
  if (data.turns !== undefined) add("turns", String(data.turns));
  if (data.toolCalls !== undefined) add("tool calls", String(data.toolCalls));
  if (data.usage?.inputTokens !== undefined) add(data.usage.cacheReadTokens === undefined ? "in" : "uncached in", data.usage.inputTokens.toLocaleString());
  if (data.usage?.cacheReadTokens !== undefined) add("cache read", data.usage.cacheReadTokens.toLocaleString());
  if (data.usage?.outputTokens !== undefined) add("out", data.usage.outputTokens.toLocaleString());
  if (data.usage?.requests !== undefined) add("requests", String(data.usage.requests));
  if (data.estimatedCostUSD !== undefined) add("cost", `$${data.estimatedCostUSD.toFixed(4)}`);
  return rows.length === 0 ? null : {
    columns: [{ key: "key", header: "Usage" }, { key: "value", header: "Value" }],
    rows,
  };
}

export const LegacyAttemptDetails = defineComponent<{ attempt: AttemptEvidence }>(({ attempt }) => {
  const notices = attemptNoticesContent(
    attemptErrorData(attempt),
    attemptDiagnosticsData(attempt),
  ) ?? [];
  const source = legacySourceContent(attempt);
  const commands = attemptCommandEvidenceContent(attemptCommandEvidenceData(attempt));
  const conversation = attemptConversationContent(attemptConversationData(attempt));
  const timeline = attemptTimelineContent(attemptTimelineData(attempt));
  const usage = usageContent(usageTableData(attempt));
  const diff = attemptDiffContent(attemptDiffData(attempt));

  return (
    <Col>
      <AttemptSummary data={attemptSummaryData(attempt)} />
      <Callouts items={notices} />
      <CommandEvidence data={commands} />
      <SourceView data={source} />
      <TableContentView data={legacyAssessmentContent(attempt)} />
      <Waterfall nodes={timeline ?? []} title={{ en: "Execution timeline", "zh-CN": "执行时间轴" }} />
      <TableContentView data={usage} />
      {conversation === null ? (
        <Callouts items={executionEvidenceUnavailableCallouts} />
      ) : (
        <Conversation data={conversation} />
      )}
      <DiffView files={diff} />
    </Col>
  );
});
LegacyAttemptDetails.displayName = "LegacyAttemptDetails";
