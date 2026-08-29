import { useState, type ReactElement, type ReactNode } from "react";
import type { QueryObserverResult } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { InspectionOperationFor, InspectionOperationId } from "@niceeval/inspection/public.ts";
import { useInspectionQuery } from "../../data/index.ts";
import { detailOperation } from "../../data/operations.ts";
import { DiffView, SourceView, Waterfall } from "../../components/primitives/index.tsx";
import { cx, formatDurationMs, formatInstant, formatPoints, formatUSD, type ReportLocale } from "../../components/primitives/shared.ts";
import type { AttemptPageModel } from "../model/page.ts";
import { projectArtifacts, projectAssertion, projectDiff, projectSources, projectTiming, projectTraceDetail, projectUsage, type AttemptArtifactsViewModel, type TraceDetailViewModel } from "../model/assemble.ts";
import type { AttemptAssertionView, AttemptSummaryData, AttemptUsageObservation, ClosedEvidenceSlice, UsageTableData } from "./compute.ts";

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

function AsyncContent<Value>({ query, render }: { readonly query: QueryObserverResult<Value, Error>; readonly render: (value: Value) => ReactNode }): ReactElement {
  const { t } = useTranslation();
  if (query.fetchStatus === "idle" && query.data === undefined && !query.isError) return <p>{t("attempt.loadOnDemand")}</p>;
  if (query.isPending) return <p role="status">{t("report.loadingDetails")}</p>;
  if (query.isError) return <div role="alert"><p>{t("report.unableToLoadDetails")}</p><button type="button" onClick={() => void query.refetch()}>{t("report.retry")}</button></div>;
  return <>{render(query.data)}</>;
}

function sliceData<Data>(slice: ClosedEvidenceSlice<Data>): Data | null {
  return slice.state === "available" || slice.state === "partial" ? slice.data : null;
}

function Artifacts({ data }: { readonly data: AttemptArtifactsViewModel }): ReactElement {
  const { t } = useTranslation();
  if (data.state === "not-recorded") return <p>{t("attempt.artifactsNone")}</p>;
  return <div><p>{t("attempt.artifactsRetained", { count: data.contentCount })}{data.contentsTruncated ? ` ${t("attempt.truncated")}` : ""}</p><pre>{JSON.stringify(data.value, null, 2)}</pre></div>;
}

type TraceSelection = { readonly kind: "item"; readonly itemId: string } | { readonly kind: "tool-occurrence"; readonly toolOccurrenceId: string } | { readonly kind: "command"; readonly commandId: string };
type Section = "timing" | "usage" | "sources" | "diff" | "artifacts";

export function AttemptDetails({ model, locale, className }: { readonly model: AttemptPageModel; readonly locale: ReportLocale; readonly className?: string }): ReactElement {
  const { t } = useTranslation();
  const [assertion, setAssertion] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceSelection | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<Section>>(() => new Set());
  const enable = (section: Section) => setOpened((current) => current.has(section) ? current : new Set([...current, section]));
  const assertionQuery = useInspectionQuery(assertion === null ? null : operation("attempt.assertion.detail", { kind: "attempt.assertion.detail", locator: model.locator, entryId: assertion }), { enabled: assertion !== null, select: projectAssertion });
  const traceQuery = useInspectionQuery(trace === null ? null : operation("attempt.trace.detail", { kind: "attempt.trace.detail", locator: model.locator, selector: trace }), { enabled: trace !== null, select: projectTraceDetail });
  const timingQuery = useInspectionQuery(operation("attempt.timing", { kind: "attempt.timing", locator: model.locator }), { enabled: opened.has("timing"), select: (value) => projectTiming(value, model.locator) });
  const usageQuery = useInspectionQuery(operation("attempt.usage", { kind: "attempt.usage", locator: model.locator }), { enabled: opened.has("usage"), select: projectUsage });
  const sourcesQuery = useInspectionQuery(operation("attempt.sources", { kind: "attempt.sources", locator: model.locator }), { enabled: opened.has("sources"), select: (value) => projectSources(value, model.locator) });
  const diffQuery = useInspectionQuery(operation("attempt.diff", { kind: "attempt.diff", locator: model.locator }), { enabled: opened.has("diff"), select: projectDiff });
  const artifactsQuery = useInspectionQuery(operation("attempt.artifacts", { kind: "attempt.artifacts", locator: model.locator }), { enabled: opened.has("artifacts"), select: projectArtifacts });
  const section = (id: Section, title: string, content: ReactNode) => <details className="niceeval-section" onToggle={(event) => { if (event.currentTarget.open) enable(id); }}><summary className="niceeval-section-title">{title}</summary>{content}</details>;
  const observations = (data: UsageTableData): readonly (readonly [string, string])[] => data.observations.map((item: AttemptUsageObservation) => item.kind === "token-bucket" ? [`${item.provider} ${item.bucket}`, item.tokens.toLocaleString()] : item.kind === "request" ? [`${item.provider} ${item.requestKind}`, "1"] : [`${item.provider} ${t("attempt.cost").toLocaleLowerCase()}`, `${item.amount} ${item.currency}`]);
  return <div className={cx("niceeval-report", className)}>
    <AttemptSummary locator={model.locator} data={model.summary} locale={locale} />
    <section className="niceeval-section"><h3>{t("attempt.assertions")}</h3><div>{model.assertionEntryIds.map((id) => <button type="button" key={id} onClick={() => setAssertion(id)}>{id}</button>)}</div><AsyncContent query={assertionQuery} render={(value: AttemptAssertionView) => <div><h4>{value.display.name}</h4><p>{value.display.outcome} · {value.display.detail}</p></div>} /></section>
    <section className="niceeval-section"><h3>{t("attempt.traceDetails")}</h3><div>{model.traceItemIds.map((id) => <button type="button" key={`i:${id}`} onClick={() => setTrace({ kind: "item", itemId: id })}>{t("attempt.traceItem", { id })}</button>)}{model.toolOccurrenceIds.map((id) => <button type="button" key={`t:${id}`} onClick={() => setTrace({ kind: "tool-occurrence", toolOccurrenceId: id })}>{t("attempt.traceTool", { id })}</button>)}{model.commandIds.map((id) => <button type="button" key={`c:${id}`} onClick={() => setTrace({ kind: "command", commandId: id })}>{t("attempt.traceCommand", { id })}</button>)}</div><AsyncContent query={traceQuery} render={(value: TraceDetailViewModel) => <div><h4>{value.kind} · {value.identity}</h4><pre>{JSON.stringify(value.content, null, 2)}</pre></div>} /></section>
    {section("timing", t("attempt.executionTimeline"), <AsyncContent query={timingQuery} render={(slice) => <Waterfall nodes={sliceData(slice)} title={{ en: t("attempt.executionTimeline", { lng: "en" }), "zh-CN": t("attempt.executionTimeline", { lng: "zh-CN" }) }} locale={locale} />} />)}
    {section("usage", t("attempt.usage"), <AsyncContent query={usageQuery} render={(slice) => <div>{(sliceData(slice) === null ? [] : observations(sliceData(slice)!)).map(([label, value]) => <Kpi key={label} label={label} value={value} />)}</div>} />)}
    {section("sources", t("attempt.sources"), <AsyncContent query={sourcesQuery} render={(slice) => <SourceView data={sliceData(slice)} locale={locale} />} />)}
    {section("diff", t("attempt.fileChanges"), <AsyncContent query={diffQuery} render={(slice) => <DiffView files={sliceData(slice)} locale={locale} />} />)}
    {section("artifacts", t("attempt.artifacts"), <AsyncContent query={artifactsQuery} render={(data) => <Artifacts data={data} />} />)}
  </div>;
}
