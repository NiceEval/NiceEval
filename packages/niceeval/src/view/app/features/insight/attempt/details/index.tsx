import type { ReactElement } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { InspectionOperationFor, InspectionOperationId, InspectionSuccessDocumentFor } from "@niceeval/inspection/public.ts";
import { inspectionQueryOptions, useCurrentGeneration, useInspectionQuery } from "../../data/index.ts";
import { attemptOperations, detailOperation } from "../../data/operations.ts";
import { Callouts, Col, CommandEvidence, DiffView, Grid, SourceView, TableContentView, TurnTrace, Waterfall } from "../../components/primitives/index.tsx";
import { cx, formatDurationMs, formatInstant, formatPoints, formatUSD, type ReportLocale } from "../../components/primitives/shared.ts";
import type { AttemptPageModel } from "../model/page.ts";
import { projectAssertions, projectCommands, projectConversation, projectDiagnostics, projectDiff, projectSources, projectTiming, projectUsage } from "../model/assemble.ts";
import { attachAssertionsToSource, attemptAssertionsContent, attemptDiagnosticsContent, embedConversationInSource, evidenceSliceCallouts, executionEvidenceUnavailableCallouts, sliceData } from "./content.tsx";
import type { AttemptSummaryData, UsageTableData } from "./compute.ts";

export type { ReportLocale } from "../../components/primitives/shared.ts";
export type * from "./compute.ts";

function Kpi({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return <div className="niceeval-kpi"><span className="niceeval-kpi-label">{label}</span><span className="niceeval-kpi-value">{value}</span></div>;
}

export function AttemptSummary({ locator, data, locale }: { readonly locator: string; readonly data: AttemptSummaryData; readonly locale: ReportLocale }): ReactElement {
  const { t } = useTranslation();
  return <div className="niceeval-attempt-summary">
    <div className="niceeval-attempt-summary-head"><span className={`niceeval-verdict-pill niceeval-verdict-${data.verdict}`}>{t(`attempt.verdict.${data.verdict}`)}</span><span className="niceeval-attempt-summary-locator">{locator}</span></div>
    <div className="niceeval-grid niceeval-attempt-summary-kpis"><Kpi label={t("attempt.experiment")} value={data.experimentId} /><Kpi label={t("attempt.eval")} value={data.identity.evalId} /><Kpi label={t("attempt.title")} value={data.identity.attempt.state === "available" ? String(data.identity.attempt.value + 1) : "—"} />{data.totalScore === undefined ? null : <Kpi label={t("attempt.score")} value={formatPoints(data.totalScore, locale)} />}{data.startedAt === undefined ? null : <Kpi label={t("attempt.started")} value={formatInstant(data.startedAt, locale)} />}<Kpi label={t("attempt.duration")} value={data.durationMs.state === "available" ? formatDurationMs(data.durationMs.value) : "—"} />{data.observedCostUSD === undefined ? null : <Kpi label={t("attempt.cost")} value={formatUSD(data.observedCostUSD)} />}</div>
  </div>;
}

function operation<Kind extends InspectionOperationId>(kind: Kind, input: unknown): InspectionOperationFor<Kind> {
  const decoded = detailOperation(input);
  if (decoded.kind !== kind) throw new Error(`Expected ${kind} operation.`);
  return decoded as InspectionOperationFor<Kind>;
}

function AttemptUsage({ data }: { readonly data: UsageTableData | null }): ReactElement | null {
  if (data === null) return null;
  const rows: Array<readonly [string, string]> = [];
  if (data.turns !== undefined) rows.push(["turns", String(data.turns)]);
  if (data.toolCalls !== undefined) rows.push(["tool calls", String(data.toolCalls)]);
  for (const item of data.observations) {
    if (item.kind === "token-bucket") rows.push([`${item.provider} ${item.bucket}`, item.tokens.toLocaleString()]);
    else if (item.kind === "request") rows.push([`${item.provider} ${item.requestKind}`, "1"]);
    else rows.push([`${item.provider} cost`, `${item.amount} ${item.currency}`]);
  }
  if (data.observedCostUSD !== undefined) rows.push(["observed cost", `$${data.observedCostUSD.toFixed(4)}`]);
  if (rows.length === 0) return null;
  return <Grid className="niceeval-usage-table">{rows.map(([label, value], index) => <Kpi key={`${label}:${index}`} label={label} value={value} />)}</Grid>;
}

export function AttemptDetails({ model, locale, className }: { readonly model: AttemptPageModel; readonly locale: ReportLocale; readonly className?: string }): ReactElement {
  const { t } = useTranslation();
  const generation = useCurrentGeneration();
  const assertionOperations = model.assertionEntryIds.map((entryId) => operation("attempt.assertion.detail", { kind: "attempt.assertion.detail", locator: model.locator, entryId }));
  const traceOperations: readonly InspectionOperationFor<"attempt.trace.detail">[] = [
    ...model.traceItemIds.map((itemId) => operation("attempt.trace.detail", { kind: "attempt.trace.detail", locator: model.locator, selector: { kind: "item", itemId } })),
    ...model.toolOccurrenceIds.map((toolOccurrenceId) => operation("attempt.trace.detail", { kind: "attempt.trace.detail", locator: model.locator, selector: { kind: "tool-occurrence", toolOccurrenceId } })),
    ...model.commandIds.map((commandId) => operation("attempt.trace.detail", { kind: "attempt.trace.detail", locator: model.locator, selector: { kind: "command", commandId } })),
  ];
  const assertionQueries = useQueries({ queries: assertionOperations.map((value) => inspectionQueryOptions(generation, value)) });
  const traceDetailQueries = useQueries({ queries: traceOperations.map((value) => inspectionQueryOptions(generation, value)) });
  const traceQuery = useInspectionQuery(attemptOperations(model.locator)[1]);
  const timingQuery = useInspectionQuery(operation("attempt.timing", { kind: "attempt.timing", locator: model.locator }), { select: (value) => projectTiming(value, model.locator) });
  const usageQuery = useInspectionQuery(operation("attempt.usage", { kind: "attempt.usage", locator: model.locator }));
  const sourcesQuery = useInspectionQuery(operation("attempt.sources", { kind: "attempt.sources", locator: model.locator }));
  const diffQuery = useInspectionQuery(operation("attempt.diff", { kind: "attempt.diff", locator: model.locator }), { select: projectDiff });
  const allQueries = [...assertionQueries, ...traceDetailQueries, traceQuery, timingQuery, usageQuery, sourcesQuery, diffQuery];
  if (allQueries.some((query) => query.isPending)) return <p role="status">{t("report.loadingDetails")}</p>;
  if (allQueries.some((query) => query.isError)) return <div role="alert"><p>{t("report.unableToLoadDetails")}</p><button type="button" onClick={() => { for (const query of allQueries) if (query.isError) void query.refetch(); }}>{t("report.retry")}</button></div>;

  const assertionDocuments = assertionQueries.map((query) => query.data as InspectionSuccessDocumentFor<"attempt.assertion.detail">);
  const traceDetails = traceDetailQueries.map((query) => query.data as InspectionSuccessDocumentFor<"attempt.trace.detail">);
  const trace = traceQuery.data!;
  const assertions = projectAssertions(assertionDocuments);
  const conversation = projectConversation(trace, traceDetails, model.locator);
  const commands = projectCommands(trace, traceDetails, model.locator);
  const diagnostics = projectDiagnostics(trace);
  const embedded = embedConversationInSource(
    attachAssertionsToSource(sliceData(projectSources(sourcesQuery.data!, trace, model.locator)), sliceData(assertions)),
    sliceData(conversation),
  );
  const notices = [
    ...attemptDiagnosticsContent(sliceData(diagnostics)),
    ...evidenceSliceCallouts("Assertions", assertions),
    ...evidenceSliceCallouts("Source", projectSources(sourcesQuery.data!, trace, model.locator)),
    ...evidenceSliceCallouts("Execution timeline", timingQuery.data!),
    ...evidenceSliceCallouts("Usage", projectUsage(usageQuery.data!, trace)),
    ...evidenceSliceCallouts("Conversation", conversation),
    ...evidenceSliceCallouts("Commands", commands),
    ...evidenceSliceCallouts("Diagnostics", diagnostics),
    ...evidenceSliceCallouts("File changes", diffQuery.data!),
  ];
  return <Col className={cx("niceeval-report", className)}>
    <AttemptSummary locator={model.locator} data={model.summary} locale={locale} />
    <Callouts items={notices} locale={locale} />
    {embedded.source !== null
      ? <SourceView data={embedded.source} locale={locale} />
      : <TableContentView data={attemptAssertionsContent(sliceData(assertions))} locale={locale} />}
    <Waterfall nodes={sliceData(timingQuery.data!)} title={{ en: "Execution timeline", "zh-CN": "执行时间轴" }} locale={locale} />
    <AttemptUsage data={sliceData(projectUsage(usageQuery.data!, trace))} />
    {embedded.conversation !== null
      ? <TurnTrace data={embedded.conversation} locale={locale} />
      : sliceData(conversation) === null ? <Callouts items={executionEvidenceUnavailableCallouts} locale={locale} /> : null}
    <CommandEvidence data={sliceData(commands)} locale={locale} />
    <DiffView files={sliceData(diffQuery.data!)} locale={locale} />
  </Col>;
}
