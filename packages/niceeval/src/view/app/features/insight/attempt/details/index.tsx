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
import { ExecutionTrace } from "./execution-trace.tsx";

export type { ReportLocale } from "../../components/primitives/shared.ts";
export type * from "./compute.ts";

function Kpi({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return <div className="niceeval-kpi"><span className="niceeval-kpi-label">{label}</span><span className="niceeval-kpi-value">{value}</span></div>;
}

export function AttemptSummary({ locator, data, locale }: { readonly locator: string; readonly data: AttemptSummaryData; readonly locale: ReportLocale }): ReactElement {
  const { t } = useTranslation();
  // totalScore is projected only from a complete score. Zero is a completed
  // assessment too; the canonical Verdict remains unchanged in the model.
  const scored = data.verdict === "passed" && data.totalScore !== undefined;
  const adapter = `${data.adapter.name} · ${data.adapter.contract} · ${data.adapter.behaviorRevision === null
    ? t("attempt.adapterRevisionNotDeclared")
    : data.adapter.behaviorRevision}`;
  return <div className="niceeval-attempt-summary">
    <div className="niceeval-attempt-summary-head"><span className={`niceeval-verdict-pill niceeval-verdict-${data.verdict}`}>{scored ? t("attempt.scoreCompleted") : t(`attempt.verdict.${data.verdict}`)}</span><span className="niceeval-attempt-summary-locator">{locator}</span></div>
    <div className="niceeval-grid niceeval-attempt-summary-kpis"><Kpi label={t("attempt.experiment")} value={data.experimentId} /><Kpi label={t("attempt.adapter")} value={adapter} /><Kpi label={t("attempt.eval")} value={data.identity.evalId} /><Kpi label={t("attempt.title")} value={data.identity.attempt.state === "available" ? String(data.identity.attempt.value + 1) : "—"} />{data.totalScore === undefined ? null : <Kpi label={t("attempt.score")} value={formatPoints(data.totalScore, locale)} />}{data.startedAt === undefined ? null : <Kpi label={t("attempt.started")} value={formatInstant(data.startedAt, locale)} />}<Kpi label={t("attempt.duration")} value={data.durationMs.state === "available" ? formatDurationMs(data.durationMs.value) : "—"} />{data.observedCostUSD === undefined ? null : <Kpi label={t("attempt.cost")} value={formatUSD(data.observedCostUSD)} />}</div>
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

function ExternalUsage({ usage }: { readonly usage: InspectionSuccessDocumentFor<"attempt.usage">["usage"] }): ReactElement {
  const { t } = useTranslation();
  const configured = usage.configuredModels;
  const defaultBinding = configured.state === "available" && configured.bindings.length === 1 && configured.bindings[0].modelSlot === "default" ? configured.bindings[0] : null;
  const groups = usage.modelGroups;
  const costs = usage.totals.costs;
  const judgeTotals = "totals" in usage.judgeUsage ? usage.judgeUsage.totals : undefined;
  const jsonStyle = { maxHeight: "24rem", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;
  const tokenValue = (metric: { readonly value: number | null; readonly state: string }): string => `${metric.value ?? "—"} (${metric.state})`;
  const costSource = (source: "reported" | "estimated" | "mixed"): string => t(source === "reported" ? "cell.costReported" : source === "estimated" ? "cell.costEstimated" : "cell.costMixed");
  const recordedCalls = (count: number | null): string => count === null ? "—" : count === 0 ? `0 (${t("usage.noRecordedCalls")})` : String(count);
  return <section aria-label={t("usage.external")}>
    <h3>{t(usage.totalCosts.state === "complete" ? "usage.totalCosts" : "usage.totalKnownSubtotal")}</h3>
    <p>{t(usage.totalCosts.state === "complete" ? "usage.costComplete" : "usage.costIncomplete")}</p>
    {usage.totalCosts.missingSources.length === 0 ? null : <p>{t("usage.missingSources")}: {usage.totalCosts.missingSources.map((source) => t(source === "judge" ? "usage.judgeUsage" : "usage.applicationCost")).join(", ")}</p>}
    {usage.totalCosts.values.length === 0 ? <p>{t(usage.totalCosts.state === "complete" ? "usage.noRecordedCharges" : "cell.metricUnavailable")}</p> : usage.totalCosts.values.map((cost) => <p key={cost.currency}>{cost.value} {cost.currency} · {costSource(cost.source)}</p>)}
    <details><summary>{t("usage.external")}</summary>
    <p>{usage.state}{usage.coverage === undefined ? "" : ` · ${usage.coverage}`}</p>
    <h4>{t("usage.configuredModels")}</h4>
    {configured.state !== "available" ? <p>{t("usage.notRecorded")}</p> : defaultBinding !== null ? <Grid>
      <Kpi label={`${t("usage.configuredModel")} (default)`} value={defaultBinding.model ?? "—"} />
      {defaultBinding.reasoningEffort === null ? null : <Kpi label={t("usage.effort")} value={defaultBinding.reasoningEffort} />}
      <Kpi label={t("usage.recordedCalls")} value={recordedCalls(defaultBinding.recordedCalls)} />
    </Grid> : configured.bindings.length === 0 ? <p>{t("usage.configuredSlotCount", { count: 0 })}</p> : <div className="niceeval-table-wrap" style={{ overflowX: "auto" }}>
      <table aria-label={t("usage.configuredModels")}><thead><tr>
        {(["usage.slot", "usage.configuredModel", "usage.effort", "usage.recordedCalls"] as const).map((key) => <th key={key} scope="col">{t(key)}</th>)}
      </tr></thead><tbody>{configured.bindings.map((binding) => <tr key={binding.modelSlot}>
        <th scope="row">{binding.modelSlot}</th><td>{binding.model ?? "—"}</td><td>{binding.reasoningEffort ?? "—"}</td>
        <td>{recordedCalls(binding.recordedCalls)}</td>
      </tr>)}</tbody></table>
    </div>}
    <h4>{t("usage.actualModels")}</h4>
    <p>{groups.state} · {groups.basis} · {t("usage.groupPreview", { shown: groups.groups.length, total: groups.totalGroupCount ?? "—", omitted: groups.omittedGroupCount })}{groups.groupsTruncated ? ` · ${t("attempt.truncated")}` : ""}</p>
    {"reason" in groups && groups.reason !== undefined ? <p>{groups.reason}</p> : null}
    {groups.state !== "available" ? <p>{t("cell.metricUnavailable")}</p> : <div className="niceeval-table-wrap" style={{ overflowX: "auto" }}>
      <table aria-label={t("usage.actualModels")}><thead><tr>
        {(["usage.slot", "usage.servingProvider", "usage.actualModel", "usage.recordedCalls", "usage.tokens", "usage.applicationCost"] as const).map((key) => <th key={key} scope="col">{t(key)}</th>)}
      </tr></thead><tbody>{groups.groups.map((group) => <tr key={JSON.stringify([group.modelSlot, group.provider, group.model])}>
        <th scope="row">{group.modelSlot ?? t("usage.notRecorded")}</th><td>{group.provider ?? t("usage.notRecorded")}</td><td>{group.model ?? t("usage.notRecorded")}</td><td>{group.recordedCalls}</td>
        <td>{t("usage.inputTotal")}: {tokenValue(group.tokens.inputTotalTokens)}<br />{t("usage.output")}: {tokenValue(group.tokens.outputTokens)}<br />{t("usage.totalTokens")}: {tokenValue(group.tokens.totalTokens)}</td>
        <td>{group.costs.values.length === 0 ? t("cell.metricUnavailable") : group.costs.values.map((cost) => <div key={cost.currency}>
          {cost.value} {cost.currency} · {costSource(cost.source)} · {group.costs.state}{group.costs.state === "partial" ? ` · ${t("usage.knownSubtotal")}` : ""}<br />
          {t("usage.coverage", { covered: cost.coveredCalls, total: group.costs.totalCalls })} · {t("usage.costOrigins", { reported: cost.reportedCalls, estimated: cost.estimatedCalls })}
        </div>)}</td>
      </tr>)}</tbody></table>
    </div>}
    <h4>{t("usage.judgeUsage")}</h4>
    {judgeTotals !== undefined ? <>
      <p>{judgeTotals.requests.value === 0 && judgeTotals.requests.state === "available" ? t("usage.noJudgeCalls") : `${t("usage.physicalCalls")}: ${tokenValue(judgeTotals.requests)}`}</p>
      <p>{t("usage.inputTotal")}: {tokenValue(judgeTotals.inputTotalTokens)} · {t("usage.output")}: {tokenValue(judgeTotals.outputTokens)} · {t("usage.totalTokens")}: {tokenValue(judgeTotals.totalTokens)}</p>
      <p>{judgeTotals.costs.state}</p>
      {judgeTotals.costs.values.map((cost) => <p key={cost.currency}>{cost.value} {cost.currency} · {costSource(cost.source)} · {t("usage.coverage", { covered: cost.coveredCalls, total: judgeTotals.costs.totalCalls })}</p>)}
    </> : <p>{t("cell.metricUnavailable")} · {"reason" in usage.judgeUsage ? usage.judgeUsage.reason : ""}</p>}
    {usage.source === "adapter" ? <>
      <h4>{t("usage.applicationCost")}</h4>
      <Grid>{([
        ["usage.input", usage.totals.inputTokens],
        ["usage.output", usage.totals.outputTokens],
        ["usage.requests", usage.totals.requests],
      ] as const).map(([label, metric]) => <Kpi key={label} label={t(label)} value={tokenValue(metric)} />)}</Grid>
      {costs === undefined || costs.values.length === 0 ? <p>{t("usage.applicationCost")}: {t("cell.metricUnavailable")}</p> : null}
      {costs?.values.map((cost) => <p key={cost.currency}>
        {cost.value} {cost.currency} · {costSource(cost.source)} · {costs.state}{costs.state === "partial" ? ` · ${t("usage.knownSubtotal")}` : ""} · {t("usage.coverage", { covered: cost.coveredCalls, total: costs.totalCalls })}
      </p>)}
      <details><summary>{t("usage.calls")} ({usage.calls?.length ?? 0}; {usage.omittedCallCount ?? 0} {t("attempt.truncated")})</summary>
        <pre style={jsonStyle}>{JSON.stringify(usage.calls ?? [], null, 2)}</pre>
      </details>
      <details><summary>{t("usage.prices")}</summary><pre style={jsonStyle}>{JSON.stringify(usage.priceReceipts ?? null, null, 2)}</pre></details>
    </> : null}
    {usage.limitations.length === 0 ? null : <pre style={jsonStyle}>{JSON.stringify(usage.limitations, null, 2)}</pre>}
    </details>
  </section>;
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
    <ExternalUsage usage={usageQuery.data!.usage} />
    <Callouts items={notices} locale={locale} />
    {embedded.source !== null
      ? <SourceView data={embedded.source} locale={locale} />
      : <TableContentView data={attemptAssertionsContent(sliceData(assertions))} locale={locale} />}
    <Waterfall nodes={sliceData(timingQuery.data!)} title={{ en: "Execution timeline", "zh-CN": "执行时间轴" }} locale={locale} />
    <AttemptUsage data={sliceData(projectUsage(usageQuery.data!, trace))} />
    <ExecutionTrace key={model.locator} locator={model.locator} initial={trace.trace.execution} />
    {embedded.conversation !== null
      ? <TurnTrace data={embedded.conversation} locale={locale} />
      : sliceData(conversation) === null && trace.trace.execution.state === "not-recorded"
        ? <Callouts items={executionEvidenceUnavailableCallouts} locale={locale} />
        : null}
    <CommandEvidence data={sliceData(commands)} locale={locale} />
    <DiffView files={sliceData(diffQuery.data!)} locale={locale} />
  </Col>;
}
