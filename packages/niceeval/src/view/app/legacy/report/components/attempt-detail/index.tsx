import type { ReactElement } from "react";

import {
  Callouts,
  Col,
  CommandEvidence,
  CopyBlock,
  DiffView,
  Grid,
  SourceView,
  TableContentView,
  TurnTrace,
  Waterfall,
} from "../../definition/primitives/index.tsx";
import { cx, formatDurationMs, formatInstant, formatPoints, formatUSD, type ReportLocale } from "../../definition/primitives/shared.ts";
import {
  attemptAssertionsContent,
  attemptDiagnosticsContent,
  attachAssertionsToSource,
  evidenceSliceCallouts,
  executionEvidenceUnavailableCallouts,
  sliceData,
} from "./content.tsx";
import type {
  AttemptDetailsData,
  AttemptSummaryData,
  AttemptUsageObservation,
  UsageTableData,
} from "./compute.ts";

export type { ReportLocale } from "../../definition/primitives/shared.ts";

export type {
  AssertionDecisionState,
  AttemptAssertionDiagnosticNode,
  AttemptAssertionDecision,
  AttemptAssertionDisplay,
  AttemptAssertionSourceSite,
  AttemptAssertionView,
  AttemptAssertionsData,
  AttemptCapabilitiesView,
  AttemptClosedAssertionEntry,
  AttemptCommandMatch,
  AttemptDetailsData,
  AttemptDiagnosticView,
  AttemptDiagnosticsData,
  AttemptIdentityView,
  AttemptInspectionAssertionSourceSite,
  AttemptMatcherDetail,
  AttemptMatcherTarget,
  AttemptScoreView,
  AttemptSummaryData,
  AttemptUsageObservation,
  ClosedEvidenceSlice,
  EvidenceLimitation,
  UsageTableData,
} from "./compute.ts";

export interface AttemptDetailsProps {
  /** One canonical locator and its already-closed evidence. */
  readonly data: AttemptDetailsData;
  readonly locale: ReportLocale;
  readonly className?: string;
}

function Kpi({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div className="niceeval-kpi">
      <span className="niceeval-kpi-label">{label}</span>
      <span className="niceeval-kpi-value">{value}</span>
    </div>
  );
}

const ATTEMPT_CAPABILITY_LABEL: Record<keyof AttemptSummaryData["capabilities"], string> = {
  source: "source",
  execution: "execution",
  timing: "timing",
  diff: "diff",
};

function verdictLabel(verdict: AttemptSummaryData["verdict"], locale: ReportLocale): string {
  if (locale !== "zh-CN") return verdict;
  if (verdict === "passed") return "通过";
  if (verdict === "failed") return "失败";
  if (verdict === "errored") return "错误";
  if (verdict === "skipped") return "跳过";
  return "未知";
}

export function AttemptSummary({
  locator,
  data,
  locale,
  className,
}: {
  readonly locator: string;
  readonly data: AttemptSummaryData;
  readonly locale: ReportLocale;
  readonly className?: string;
}): ReactElement {
  const capabilities = (Object.keys(data.capabilities) as (keyof AttemptSummaryData["capabilities"])[])
    .filter((key) => data.capabilities[key]);
  return (
    <div className={cx("niceeval-report", "niceeval-attempt-summary", className)}>
      <div className="niceeval-attempt-summary-head">
        <span className={`niceeval-verdict-pill niceeval-verdict-${data.verdict}`}>
          {verdictLabel(data.verdict, locale)}
        </span>
        <span className="niceeval-attempt-summary-locator">{locator}</span>
      </div>
      <Grid className="niceeval-attempt-summary-kpis">
        <Kpi label="Experiment" value={data.experimentId} />
        <Kpi label="Eval" value={data.identity.evalId} />
        <Kpi label="Attempt" value={String(data.identity.attempt + 1)} />
        {data.totalScore === undefined ? null : <Kpi label="Score" value={formatPoints(data.totalScore, locale)} />}
        {data.startedAt === undefined ? null : <Kpi label="Started" value={formatInstant(data.startedAt, locale)} />}
        <Kpi label="Duration" value={data.durationMs === null ? "—" : formatDurationMs(data.durationMs)} />
        {data.observedCostUSD === undefined ? null : <Kpi label="Cost" value={formatUSD(data.observedCostUSD)} />}
      </Grid>
      {capabilities.length === 0 ? null : (
        <p className="niceeval-attempt-summary-caps">
          {capabilities.map((key) => ATTEMPT_CAPABILITY_LABEL[key]).join(" · ")}
        </p>
      )}
    </div>
  );
}

function usageObservationRow(observation: AttemptUsageObservation): readonly [string, string] {
  if (observation.kind === "token-bucket") {
    return [`${observation.provider} ${observation.bucket}`, observation.tokens.toLocaleString()];
  }
  if (observation.kind === "request") return [`${observation.provider} ${observation.requestKind}`, "1"];
  return [`${observation.provider} cost`, `${observation.amount} ${observation.currency}`];
}

function AttemptUsage({
  data,
  className,
}: {
  readonly data: UsageTableData | null;
  readonly className?: string;
}): ReactElement | null {
  if (data === null) return null;
  const rows: Array<readonly [string, string]> = [];
  if (data.turns !== undefined) rows.push(["turns", String(data.turns)]);
  if (data.toolCalls !== undefined) rows.push(["tool calls", String(data.toolCalls)]);
  for (const observation of data.observations) rows.push(usageObservationRow(observation));
  if (data.observedCostUSD !== undefined) rows.push(["observed cost", `$${data.observedCostUSD.toFixed(4)}`]);
  if (rows.length === 0) return null;
  return (
    <Grid className={cx("niceeval-usage-table", className)}>
      {rows.map(([label, value], index) => <Kpi key={`${label}:${index}`} label={label} value={value} />)}
    </Grid>
  );
}

function collectedNotices(data: AttemptDetailsData) {
  return [
    ...data.notices,
    ...attemptDiagnosticsContent(sliceData(data.diagnostics)),
    ...evidenceSliceCallouts("Assertions", data.assertions),
    ...evidenceSliceCallouts("Source", data.source),
    ...evidenceSliceCallouts("Execution timeline", data.timeline),
    ...evidenceSliceCallouts("Usage", data.usage),
    ...evidenceSliceCallouts("Conversation", data.conversation),
    ...evidenceSliceCallouts("Commands", data.commands),
    ...evidenceSliceCallouts("Diagnostics", data.diagnostics),
    ...evidenceSliceCallouts("File changes", data.diff),
  ];
}

export function AttemptAssessment({ data, locale, className }: AttemptDetailsProps): ReactElement {
  const assertions = sliceData(data.assertions);
  const source = attachAssertionsToSource(sliceData(data.source), assertions);
  const assertionsTable = source === null ? attemptAssertionsContent(assertions) : null;
  return (
    <Col className={className}>
      <Callouts items={collectedNotices(data)} locale={locale} />
      {source !== null
        ? <SourceView data={source} locale={locale} />
        : <TableContentView data={assertionsTable} locale={locale} />}
    </Col>
  );
}

/** Ordinary React 19 component; it consumes only the supplied closed data. */
export function AttemptDetails({ data, locale, className }: AttemptDetailsProps): ReactElement {
  const assertions = sliceData(data.assertions);
  const source = attachAssertionsToSource(sliceData(data.source), assertions);
  const conversation = sliceData(data.conversation);
  const assertionsTable = source === null ? attemptAssertionsContent(assertions) : null;
  const timeline = sliceData(data.timeline);
  const usage = sliceData(data.usage);
  const commands = sliceData(data.commands);
  const diff = sliceData(data.diff);
  return (
    <Col className={className}>
      <AttemptSummary locator={data.locator} data={data.summary} locale={locale} />
      <Col>
        <Callouts items={collectedNotices(data)} locale={locale} />
        {source !== null
          ? <SourceView data={source} locale={locale} />
          : <TableContentView data={assertionsTable} locale={locale} />}
      </Col>
      <CopyBlock content={data.fixPrompt} locale={locale} />
      <Waterfall
        nodes={timeline}
        title={{ en: "Execution timeline", "zh-CN": "执行时间轴" }}
        locale={locale}
      />
      <AttemptUsage data={usage} />
      {conversation === null
        ? <Callouts items={executionEvidenceUnavailableCallouts} locale={locale} />
        : <TurnTrace data={conversation} locale={locale} />}
      <CommandEvidence data={commands} locale={locale} />
      <DiffView files={diff} locale={locale} />
    </Col>
  );
}
