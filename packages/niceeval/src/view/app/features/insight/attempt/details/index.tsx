import { formatNumericUnit } from "../../../../../../assertions/quantity.ts";
import { useState, type ReactElement } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type {
  InspectionOperationFor,
  InspectionOperationId,
  InspectionSuccessDocumentFor,
} from "@niceeval/inspection/public.ts";
import { inspectionQueryOptions, useCurrentGeneration, useInspectionQuery } from "../../data/index.ts";
import { attemptOperations, detailOperation } from "../../data/operations.ts";
import {
  Callouts,
  Col,
  CommandEvidence,
  DiffView,
  Grid,
  SourceView,
  TableContentView,
  TurnTrace,
  Waterfall,
} from "../../components/primitives/index.tsx";
import {
  cx,
  formatDurationMs,
  formatInstant,
  formatPoints,
  type ReportLocale,
} from "../../components/primitives/shared.ts";
import type { AttemptPageModel } from "../model/page.ts";
import {
  projectAssertions,
  projectCommands,
  projectConversation,
  projectDiagnostics,
  projectDiff,
  projectSources,
  projectTiming,
  projectUsage,
} from "../model/assemble.ts";
import {
  attachAssertionsToSource,
  attemptAssertionsContent,
  attemptDiagnosticsContent,
  embedConversationInSource,
  evidenceSliceCallouts,
  executionEvidenceUnavailableCallouts,
  sliceData,
} from "./content.tsx";
import type { AttemptSummaryData, UsageTableData } from "./compute.ts";
import { ExecutionTrace } from "./execution-trace.tsx";
import { CostGaps } from "../../components/primitives/cost-gaps.tsx";

export type { ReportLocale } from "../../components/primitives/shared.ts";
export type * from "./compute.ts";

function Kpi({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div className="niceeval-kpi">
      <span className="niceeval-kpi-label">{label}</span>
      <span className="niceeval-kpi-value">{value}</span>
    </div>
  );
}

export function AttemptSummary({
  locator,
  data,
  locale,
}: {
  readonly locator: string;
  readonly data: AttemptSummaryData;
  readonly locale: ReportLocale;
}): ReactElement {
  const { t } = useTranslation();
  // totalScore is projected only from a complete score. Zero is a completed
  // assessment too; the canonical Verdict remains unchanged in the model.
  const scored = data.verdict === "passed" && data.totalScore !== undefined;
  const adapter =
    data.adapter === undefined
      ? "—"
      : `${data.adapter.name} · ${data.adapter.contract} · ${
          data.adapter.behaviorRevision === undefined
            ? t("attempt.adapterRevisionNotDeclared")
            : data.adapter.behaviorRevision
        }`;
  return (
    <div className="niceeval-attempt-summary">
      <div className="niceeval-attempt-summary-head">
        <span className={`niceeval-verdict-pill niceeval-verdict-${data.verdict}`}>
          {scored ? t("attempt.scoreCompleted") : t(`attempt.verdict.${data.verdict}`)}
        </span>
        <span className="niceeval-attempt-summary-locator">{locator}</span>
      </div>
      <div className="niceeval-grid niceeval-attempt-summary-kpis">
        <Kpi label={t("attempt.experiment")} value={data.experimentId} />
        <Kpi label={t("attempt.adapter")} value={adapter} />
        <Kpi label={t("attempt.eval")} value={data.identity.evalId} />
        <Kpi
          label={t("attempt.title")}
          value={data.identity.attempt.state === "available" ? String(data.identity.attempt.value + 1) : "—"}
        />
        {data.totalScore === undefined ? null : (
          <Kpi label={t("attempt.score")} value={formatPoints(data.totalScore, locale)} />
        )}
        {data.startedAt === undefined ? null : (
          <Kpi label={t("attempt.started")} value={formatInstant(data.startedAt, locale)} />
        )}
        <Kpi
          label={t("attempt.duration")}
          value={data.durationMs.state === "available" ? formatDurationMs(data.durationMs.value) : "—"}
        />
      </div>
    </div>
  );
}

function operation<Kind extends InspectionOperationId>(kind: Kind, input: unknown): InspectionOperationFor<Kind> {
  const decoded = detailOperation(input);
  if (decoded.kind !== kind) throw new Error(`Expected ${kind} operation.`);
  return decoded as InspectionOperationFor<Kind>;
}

function AttemptUsage({ data }: { readonly data: UsageTableData | undefined }): ReactElement | null {
  if (data === undefined) return null;
  const rows: Array<readonly [string, string]> = [];
  if (data.turns !== undefined) rows.push(["turns", String(data.turns)]);
  if (data.toolCalls !== undefined) rows.push(["tool calls", String(data.toolCalls)]);
  for (const item of data.observations) {
    if (item.kind === "token-bucket") rows.push([`${item.provider} ${item.bucket}`, item.tokens.toLocaleString()]);
    else if (item.kind === "request") rows.push([`${item.provider} ${item.requestKind}`, "1"]);
    else rows.push([`${item.provider} cost`, `${item.amount} ${item.currency}`]);
  }
  if (rows.length === 0) return null;
  return (
    <Grid className="niceeval-usage-table">
      {rows.map(([label, value], index) => (
        <Kpi key={`${label}:${index}`} label={label} value={value} />
      ))}
    </Grid>
  );
}

function CacheReadUsage({
  report,
}: {
  readonly report: InspectionSuccessDocumentFor<"attempt.usage">["usage"]["cacheRead"];
}): ReactElement {
  const { t } = useTranslation();
  const rows = [
    { label: t("usage.cacheTotal"), summary: report.total },
    ...report.roles.map((summary) => ({
      label: `${t("usage.role")}: ${summary.modelRole ?? t("usage.notRecorded")}`,
      summary,
    })),
  ];
  const table = (values: typeof rows) => (
    <div className="niceeval-table-wrap" style={{ overflowX: "auto" }}>
      <table aria-label={t("usage.cacheReadRate")}>
        <thead>
          <tr>
            {(
              [
                "usage.cacheScope",
                "usage.cacheReadRate",
                "usage.cacheCoverage",
                "usage.cacheCollection",
                "usage.cacheReasons",
              ] as const
            ).map((key) => (
              <th key={key} scope="col">
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {values.map(({ label, summary }, index) => (
            <tr key={index}>
              <th scope="row">{label}</th>
              <td>
                {summary.rate.state === "exact"
                  ? `${(summary.rate.value * 100).toFixed(2)}%`
                  : t("cell.metricUnavailable")}
              </td>
              <td>
                {summary.coveredCalls}/{summary.recordedCalls}
              </td>
              <td>{t(summary.collectionComplete ? "usage.cacheComplete" : "usage.cacheIncomplete")}</td>
              <td>{summary.reasons.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <section aria-label={t("usage.cacheReadRate")}>
      <h4>{t("usage.cacheReadRate")}</h4>
      {table(rows)}
      <details>
        <summary>{t("usage.actualModels")}</summary>
        {table(
          report.models.map((summary) => ({
            label: `${summary.modelRole ?? t("usage.notRecorded")} / ${summary.provider ?? t("usage.notRecorded")} / ${summary.model ?? t("usage.notRecorded")}`,
            summary,
          })),
        )}
      </details>
    </section>
  );
}

function ExternalUsage({
  usage,
}: {
  readonly usage: InspectionSuccessDocumentFor<"attempt.usage">["usage"];
}): ReactElement {
  const { t } = useTranslation();
  const configured = usage.configuredModels;
  const groups = usage.modelGroups;
  const costs = usage.totals.costs;
  const judgeTotals = "totals" in usage.judgeUsage ? usage.judgeUsage.totals : undefined;
  const jsonStyle = { maxHeight: "24rem", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;
  const tokenValue = (metric: { readonly value: number | null; readonly state: string }): string =>
    `${metric.value ?? "—"} (${metric.state})`;
  const costSource = (source: "reported" | "estimated" | "mixed"): string => {
    switch (source) {
      case "reported":
        return t("cell.costReported");
      case "estimated":
        return t("cell.costEstimated");
      default:
        return t("cell.costMixed");
    }
  };
  const recordedCalls = (count: number | null): string => {
    if (count === null) return "—";
    if (count === 0) return `0 (${t("usage.noRecordedCalls")})`;
    return String(count);
  };
  function configuredModels(): ReactElement {
    if (configured.state !== "available") return <p>{t("usage.notRecorded")}</p>;
    if (configured.bindings.length === 1 && configured.bindings[0].modelRole === "default") {
      const defaultBinding = configured.bindings[0];
      return (
        <Grid className="">
          <Kpi label={`${t("usage.configuredModel")} (default)`} value={defaultBinding.model ?? "—"} />
          {defaultBinding.reasoningEffort === null ? null : (
            <Kpi label={t("usage.effort")} value={defaultBinding.reasoningEffort} />
          )}
          <Kpi label={t("usage.recordedCalls")} value={recordedCalls(defaultBinding.recordedCalls)} />
        </Grid>
      );
    }
    if (configured.bindings.length === 0) return <p>{t("usage.configuredRoleCount", { count: 0 })}</p>;
    return (
      <div className="niceeval-table-wrap" style={{ overflowX: "auto" }}>
        <table aria-label={t("usage.configuredModels")}>
          <thead>
            <tr>
              {(["usage.role", "usage.configuredModel", "usage.effort", "usage.recordedCalls"] as const).map((key) => (
                <th key={key} scope="col">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {configured.bindings.map((binding) => (
              <tr key={binding.modelRole}>
                <th scope="row">{binding.modelRole}</th>
                <td>{binding.model ?? "—"}</td>
                <td>{binding.reasoningEffort ?? "—"}</td>
                <td>{recordedCalls(binding.recordedCalls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <section aria-label={t("usage.external")}>
      <h3>{t(usage.totalCosts.state === "complete" ? "usage.totalCosts" : "usage.totalKnownSubtotal")}</h3>
      <p>{t(usage.totalCosts.state === "complete" ? "usage.costComplete" : "usage.costIncomplete")}</p>
      <CostGaps costs={usage.totalCosts} />
      {usage.totalCosts.values.length === 0 ? (
        <p>{t(usage.totalCosts.state === "complete" ? "usage.noRecordedCharges" : "cell.metricUnavailable")}</p>
      ) : (
        usage.totalCosts.values.map((cost) => (
          <p key={cost.currency}>
            {cost.value} {cost.currency} · {costSource(cost.source)}
          </p>
        ))
      )}
      <details>
        <summary>{t("usage.external")}</summary>
        <p>
          {usage.state}
          {usage.coverage === undefined ? "" : ` · ${usage.coverage}`}
        </p>
        <CacheReadUsage report={usage.cacheRead} />
        <h4>{t("usage.configuredModels")}</h4>
        {configuredModels()}
        <h4>{t("usage.actualModels")}</h4>
        <p>
          {groups.state} · {groups.basis} ·{" "}
          {t("usage.groupPreview", {
            shown: groups.groups.length,
            total: groups.totalGroupCount ?? "—",
            omitted: groups.omittedGroupCount,
          })}
          {groups.groupsTruncated ? ` · ${t("attempt.truncated")}` : ""}
        </p>
        {"reason" in groups && groups.reason !== undefined ? <p>{groups.reason}</p> : null}
        {groups.state !== "available" ? (
          <p>{t("cell.metricUnavailable")}</p>
        ) : (
          <div className="niceeval-table-wrap" style={{ overflowX: "auto" }}>
            <table aria-label={t("usage.actualModels")}>
              <thead>
                <tr>
                  {(
                    [
                      "usage.role",
                      "usage.servingProvider",
                      "usage.actualModel",
                      "usage.recordedCalls",
                      "usage.tokens",
                      "usage.applicationCost",
                    ] as const
                  ).map((key) => (
                    <th key={key} scope="col">
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.groups.map((group) => (
                  <tr key={JSON.stringify([group.modelRole, group.provider, group.model])}>
                    <th scope="row">{group.modelRole ?? t("usage.notRecorded")}</th>
                    <td>{group.provider ?? t("usage.notRecorded")}</td>
                    <td>{group.model ?? t("usage.notRecorded")}</td>
                    <td>{group.recordedCalls}</td>
                    <td>
                      {t("usage.inputTotal")}: {tokenValue(group.tokens.inputTotalTokens)}
                      <br />
                      {t("usage.output")}: {tokenValue(group.tokens.outputTokens)}
                      <br />
                      {t("usage.totalTokens")}: {tokenValue(group.tokens.totalTokens)}
                    </td>
                    <td>
                      {group.costs.values.length === 0
                        ? t("cell.metricUnavailable")
                        : group.costs.values.map((cost) => (
                            <div key={cost.currency}>
                              {cost.value} {cost.currency} · {costSource(cost.source)} · {group.costs.state}
                              {group.costs.state === "partial" ? ` · ${t("usage.knownSubtotal")}` : ""}
                              <br />
                              {t("usage.coverage", { covered: cost.coveredCalls, total: group.costs.totalCalls })} ·{" "}
                              {t("usage.costOrigins", { reported: cost.reportedCalls, estimated: cost.estimatedCalls })}
                            </div>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h4>{t("usage.judgeUsage")}</h4>
        {judgeTotals !== undefined ? (
          <>
            <p>
              {judgeTotals.requests.value === 0 && judgeTotals.requests.state === "available"
                ? t("usage.noJudgeCalls")
                : `${t("usage.physicalCalls")}: ${tokenValue(judgeTotals.requests)}`}
            </p>
            <p>
              {t("usage.inputTotal")}: {tokenValue(judgeTotals.inputTotalTokens)} · {t("usage.output")}:{" "}
              {tokenValue(judgeTotals.outputTokens)} · {t("usage.totalTokens")}: {tokenValue(judgeTotals.totalTokens)}
            </p>
            <p>{judgeTotals.costs.state}</p>
            {judgeTotals.costs.values.map((cost) => (
              <p key={cost.currency}>
                {cost.value} {cost.currency} · {costSource(cost.source)} ·{" "}
                {t("usage.coverage", { covered: cost.coveredCalls, total: judgeTotals.costs.totalCalls })}
              </p>
            ))}
          </>
        ) : (
          <p>
            {t("cell.metricUnavailable")} · {"reason" in usage.judgeUsage ? usage.judgeUsage.reason : ""}
          </p>
        )}
        {usage.source === "adapter" ? (
          <>
            <h4>{t("usage.applicationCost")}</h4>
            <Grid className="">
              {(
                [
                  ["usage.input", usage.totals.inputTokens],
                  ["usage.output", usage.totals.outputTokens],
                  ["usage.requests", usage.totals.requests],
                ] as const
              ).map(([label, metric]) => (
                <Kpi key={label} label={t(label)} value={tokenValue(metric)} />
              ))}
            </Grid>
            {costs === undefined || costs.values.length === 0 ? (
              <p>
                {t("usage.applicationCost")}: {t("cell.metricUnavailable")}
              </p>
            ) : null}
            {costs?.values.map((cost) => (
              <p key={cost.currency}>
                {cost.value} {cost.currency} · {costSource(cost.source)} · {costs.state}
                {costs.state === "partial" ? ` · ${t("usage.knownSubtotal")}` : ""} ·{" "}
                {t("usage.coverage", { covered: cost.coveredCalls, total: costs.totalCalls })}
              </p>
            ))}
            <details>
              <summary>
                {t("usage.calls")} ({usage.calls?.length ?? 0}; {usage.omittedCallCount ?? 0} {t("attempt.truncated")})
              </summary>
              <pre style={jsonStyle}>{JSON.stringify(usage.calls ?? [], null, 2)}</pre>
            </details>
            <details>
              <summary>{t("usage.prices")}</summary>
              <pre style={jsonStyle}>{JSON.stringify(usage.priceReceipts ?? null, null, 2)}</pre>
            </details>
          </>
        ) : null}
        {usage.limitations.length === 0 ? null : (
          <pre style={jsonStyle}>{JSON.stringify(usage.limitations, null, 2)}</pre>
        )}
      </details>
    </section>
  );
}

export function AttemptDetails({
  model,
  locale,
  className,
  aspect,
  selectedId,
}: {
  readonly model: AttemptPageModel;
  readonly locale: ReportLocale;
  readonly className: string | undefined;
  readonly aspect: string | undefined;
  readonly selectedId: string | undefined;
}): ReactElement {
  const { t } = useTranslation();
  const generation = useCurrentGeneration();
  const assertionOperations = model.assertionEntryIds
    .filter((id) => aspect !== "assertions" || selectedId === undefined || id === selectedId)
    .map((entryId) =>
      operation("attempt.assertion.detail", { kind: "attempt.assertion.detail", locator: model.locator, entryId }),
    );
  const traceOperations: readonly InspectionOperationFor<"attempt.trace.detail">[] = [
    ...model.traceItemIds.map((itemId) =>
      operation("attempt.trace.detail", {
        kind: "attempt.trace.detail",
        locator: model.locator,
        selector: { kind: "item", itemId },
      }),
    ),
    ...model.toolOccurrenceIds.map((toolOccurrenceId) =>
      operation("attempt.trace.detail", {
        kind: "attempt.trace.detail",
        locator: model.locator,
        selector: { kind: "tool-occurrence", toolOccurrenceId },
      }),
    ),
    ...model.commandIds.map((commandId) =>
      operation("attempt.trace.detail", {
        kind: "attempt.trace.detail",
        locator: model.locator,
        selector: { kind: "command", commandId },
      }),
    ),
  ];
  const assertionQueries = useQueries({
    queries: assertionOperations.map((value) => inspectionQueryOptions(generation, value)),
  });
  const traceDetailQueries = useQueries({
    queries: traceOperations.map((value) => inspectionQueryOptions(generation, value)),
  });
  const traceQuery = useInspectionQuery(attemptOperations(model.locator)[1]);
  const timingQuery = useInspectionQuery(
    operation("attempt.timing", { kind: "attempt.timing", locator: model.locator }),
    { select: (value) => projectTiming(value, model.locator) },
  );
  const usageQuery = useInspectionQuery(operation("attempt.usage", { kind: "attempt.usage", locator: model.locator }));
  const sourcesQuery = useInspectionQuery(
    operation("attempt.sources", { kind: "attempt.sources", locator: model.locator }),
  );
  const diffQuery = useInspectionQuery(
    operation("attempt.diff", {
      kind: "attempt.diff",
      locator: model.locator,
      ...(aspect === "diff" && selectedId !== undefined ? { changeId: selectedId } : {}),
    }),
    { select: projectDiff },
  );
  const notesQuery = useInspectionQuery(attemptOperations(model.locator)[0]);
  const allQueries = [
    notesQuery,
    ...assertionQueries,
    ...traceDetailQueries,
    traceQuery,
    timingQuery,
    usageQuery,
    sourcesQuery,
    diffQuery,
  ];
  if (allQueries.some((query) => query.isPending)) return <p role="status">{t("report.loadingDetails")}</p>;
  if (allQueries.some((query) => query.isError))
    return (
      <div role="alert">
        <p>{t("report.unableToLoadDetails")}</p>
        <button
          type="button"
          onClick={() => {
            for (const query of allQueries) if (query.isError) void query.refetch();
          }}
        >
          {t("report.retry")}
        </button>
      </div>
    );

  const assertionDocuments = assertionQueries.map(
    (query) => query.data as InspectionSuccessDocumentFor<"attempt.assertion.detail">,
  );
  const traceDetails = traceDetailQueries.map(
    (query) => query.data as InspectionSuccessDocumentFor<"attempt.trace.detail">,
  );
  const trace = traceQuery.data!;
  const assertions = projectAssertions(assertionDocuments);
  const conversation = projectConversation(trace, traceDetails, model.locator);
  const commands = projectCommands(trace, traceDetails, model.locator);
  const diagnostics = projectDiagnostics(trace);
  const embedded = embedConversationInSource(
    attachAssertionsToSource(
      sliceData(projectSources(sourcesQuery.data!, trace, model.locator)),
      sliceData(assertions),
    ),
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
  function sourceEvidence(): ReactElement | null {
    if (aspect !== undefined && aspect !== "source" && aspect !== "assertions") return null;
    if (embedded.source !== null) return <SourceView data={embedded.source} locale={locale} className="" />;
    return <TableContentView data={attemptAssertionsContent(sliceData(assertions))} locale={locale} className="" />;
  }
  function conversationEvidence(): ReactElement | null {
    if (aspect !== undefined && aspect !== "execution") return null;
    if (embedded.conversation !== null) return <TurnTrace data={embedded.conversation} locale={locale} className="" />;
    if (sliceData(conversation) === null && trace.trace.execution.state === "not-recorded")
      return <Callouts items={executionEvidenceUnavailableCallouts} locale={locale} className="" />;
    return null;
  }
  return (
    <Col className={cx("niceeval-report", className)}>
      <AttemptSummary locator={model.locator} data={model.summary} locale={locale} />
      {model.verdictCauses === undefined ? null : (
        <section aria-label={t("attempt.verdictCauses")}>
          <h3>{t("attempt.verdictCauses")}</h3>
          {model.verdictCauses.groups.map((group) => (
            <p key={JSON.stringify([group.result, group.reason, group.failureDetail])}>
              {t("attempt.erroredBecause", {
                count: group.count,
                result: group.result,
                detail: group.failureDetail ?? group.reason ?? "—",
              })}
            </p>
          ))}
          {model.verdictCauses.items[0] === undefined ? null : (
            <p>
              <code>{`niceeval show ${model.locator} ${model.verdictCauses.items[0].entryId} --full`}</code>
            </p>
          )}
          {model.verdictCauses.hasMore || model.verdictCauses.omittedGroupCount > 0 ? (
            <p>
              {t("attempt.causesPreview", {
                shown: model.verdictCauses.items.length,
                total: model.verdictCauses.total,
                groups: model.verdictCauses.omittedGroupCount,
              })}
            </p>
          ) : null}
        </section>
      )}
      {(["failure", "advisory"] as const).map((kind) => {
        const items =
          model.diagnostics?.items.filter((item) =>
            kind === "advisory" ? item.kind === "advisory" : item.kind !== "advisory",
          ) ?? [];
        if (items.length === 0) return null;
        const title = t(kind === "advisory" ? "attempt.advisories" : "attempt.failureDiagnostics");
        return (
          <section key={kind} aria-label={title}>
            <h3>{title}</h3>
            {items.map((item) => (
              <p key={item.evidenceId}>
                {item.phase} · {item.code} · {item.summary}
              </p>
            ))}
          </section>
        );
      })}
      {aspect === undefined || aspect === "usage" ? <ExternalUsage usage={usageQuery.data!.usage} /> : null}
      <Callouts items={notices} locale={locale} className="" />
      {sourceEvidence()}
      {aspect === undefined ? (
        <section aria-label={t("attempt.notes")}>
          <h3>{t("attempt.notes")}</h3>
          <dl>
            {notesQuery.data!.attempt.notes.map(function noteEntry(note) {
              function noteValue() {
                if (note.value === null) return t("cell.metricUnavailable");
                if (typeof note.value === "number") return formatNumericUnit(note.value, note.unit);
                return JSON.stringify(note.value);
              }
              return (
                <div key={note.sequence}>
                  <dt>{note.label}</dt>
                  <dd style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{noteValue()}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      ) : null}
      {aspect === undefined || aspect === "timing" ? (
        <Waterfall
          nodes={sliceData(timingQuery.data!)}
          title={{ en: "Execution timeline", "zh-CN": "执行时间轴" }}
          locale={locale}
          className=""
        />
      ) : null}
      {aspect === undefined || aspect === "usage" ? (
        <AttemptUsage data={sliceData(projectUsage(usageQuery.data!, trace))} />
      ) : null}
      {aspect === undefined || aspect === "execution" ? (
        <ExecutionTrace
          key={model.locator}
          locator={model.locator}
          initial={trace.trace.execution}
          selectedId={selectedId}
        />
      ) : null}
      {conversationEvidence()}
      {aspect === undefined || aspect === "execution" ? (
        <CommandEvidence data={sliceData(commands)} locale={locale} className="" />
      ) : null}
      {aspect === undefined || aspect === "diff" ? (
        <DiffView files={sliceData(diffQuery.data!)} locale={locale} className="" drillCommand={undefined} />
      ) : null}
      {aspect === "artifacts" ? <Artifacts locator={model.locator} selectedId={selectedId} /> : null}
    </Col>
  );
}

function Artifacts({
  locator,
  selectedId,
}: {
  readonly locator: string;
  readonly selectedId: string | undefined;
}): ReactElement {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const query = useInspectionQuery(
    selectedId === undefined
      ? { kind: "attempt.artifacts", locator, offset }
      : { kind: "attempt.artifact", locator, artifactId: selectedId as never, offset },
  );
  if (query.isPending) return <p role="status">{t("report.loadingDetails")}</p>;
  if (query.isError) return <p role="alert">{query.error.message}</p>;
  if (query.data.operation === "attempt.artifact") {
    const value = query.data.artifact;
    if (value.state !== "available") return <p>{value.state}</p>;
    const bytes = Uint8Array.from(atob(value.base64), (c) => c.charCodeAt(0));
    return (
      <section>
        <h3>{value.name}</h3>
        <p>
          {value.mediaType} · {value.byteLength} bytes
        </p>
        <pre>{new TextDecoder().decode(bytes)}</pre>
        {value.nextOffset === null ? null : (
          <button onClick={() => setOffset(value.nextOffset!)}>{t("executionTrace.nextBytes")}</button>
        )}
      </section>
    );
  }
  const value = query.data.artifacts;
  return (
    <section>
      <h3>Artifacts</h3>
      {value.state !== "available" ? (
        <p>{value.state}</p>
      ) : (
        <>
          <ul>
            {value.value.artifacts.map((item) => (
              <li key={item.artifactId}>
                <a
                  href={`#/attempt/${encodeURIComponent(locator.startsWith("@") ? locator.slice(1) : locator)}?aspect=artifacts&id=${encodeURIComponent(item.artifactId)}`}
                >
                  {item.label} · {item.mediaType} · {item.byteLength} bytes
                </a>
              </li>
            ))}
          </ul>
          {value.collection.nextOffset === null ? null : (
            <button onClick={() => setOffset(value.collection.nextOffset!)}>{t("executionTrace.nextPage")}</button>
          )}
        </>
      )}
    </section>
  );
}
