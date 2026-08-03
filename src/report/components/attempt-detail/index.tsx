// Attempt 详情组合件:叶子区块用原语 + 公开 to* 装配。

import { isAttemptEvidence, type AttemptEvidence } from "../../../record/attempt-evidence.ts";
import { defineComponent } from "../../definition/tree.ts";
import {
  Callouts,
  Col,
  Conversation,
  CopyBlock,
  DiffView,
  Grid,
  SourceView,
  TableContentView,
  Waterfall,
} from "../../definition/primitives.tsx";
import type { AttemptSummaryData, UsageTableData } from "../../model/types.ts";
import { formatDurationMs, formatInstant, formatPoints, formatUSD } from "../../model/format.ts";
import { localeText } from "../../model/locale.ts";
import { cx, type ValueProps } from "../shared.ts";
import type { PageContext } from "../../definition/tree.ts";
import {
  toAttemptAssertions,
  toAttemptFixPrompt,
  toAttemptNotices,
  toAttemptSource,
  toAttemptSummary,
  toAttemptUsage,
  toConversationTurns,
  toDiffFiles,
  toTimelineNodes,
} from "../../model/conversions.ts";
import { embedConversationInSource, executionEvidenceUnavailableCallouts } from "./content.tsx";

export {
  validateAssertionsData,
  validateConversationData,
  validateDiagnosticsData,
  validateDiffData,
  validateErrorData,
  validateFixPromptData,
  validateSummaryData,
  validateTimelineData,
  validateTraceData,
  validateUsageData,
} from "./validate.tsx";

/**
 * 身份 / 时间 / 成本与 usage 共用的格内容:一行标签、一行值。几何(一行几格、什么宽度换列、
 * 格内多密)全归 `Grid` 算,这里只出内容——Grid 的格可以是任意节点,不限定为 `Stat`,
 * 这两块要的是紧凑身份表而不是读数卡。
 */
function Kpi(props: { label: string; value: string }) {
  return (
    <div className="niceeval-kpi">
      <span className="niceeval-kpi-label">{props.label}</span>
      <span className="niceeval-kpi-value">{props.value}</span>
    </div>
  );
}

type SummaryProps = ValueProps<AttemptSummaryData, { className?: string }>;

export const AttemptSummary = defineComponent<SummaryProps>({
  dimensions: () => ({}),
  web(props, ctx) {
    const d = props.data!;
    const caps = (Object.keys(d.capabilities) as (keyof AttemptSummaryData["capabilities"])[]).filter(
      (key) => d.capabilities[key],
    );
    return (
      <div className={cx("niceeval-report", "niceeval-attempt-summary", props.className)}>
        <div className="niceeval-attempt-summary-head">
          <span className={`niceeval-verdict-pill niceeval-verdict-${d.verdict}`}>
            {localeText(ctx.locale, `verdict.${d.verdict}`)}
          </span>
          <span className="niceeval-attempt-summary-locator">{d.locator}</span>
        </div>
        <Grid className="niceeval-attempt-summary-kpis">
          <Kpi label="Experiment" value={d.experimentId} />
          <Kpi label="Eval" value={d.identity.evalId} />
          <Kpi label="Attempt" value={String(d.identity.attempt + 1)} />
          {d.totalScore !== undefined ? <Kpi label="Score" value={formatPoints(d.totalScore)} /> : null}
          {d.startedAt ? <Kpi label="Started" value={formatInstant(d.startedAt, ctx.locale)} /> : null}
          <Kpi label="Duration" value={formatDurationMs(d.durationMs)} />
          {d.costUSD !== null ? <Kpi label="Cost" value={formatUSD(d.costUSD)} /> : null}
        </Grid>
        {caps.length > 0 ? (
          <p className="niceeval-attempt-summary-caps">
            {caps.map((key) => ATTEMPT_CAPABILITY_LABEL[key]).join(" · ")}
          </p>
        ) : null}
      </div>
    );
  },
  text(props) {
    const d = props.data!;
    return `${d.locator} · ${d.verdict} · ${formatDurationMs(d.durationMs)}`;
  },
});
AttemptSummary.displayName = "AttemptSummary";

const ATTEMPT_CAPABILITY_LABEL: globalThis.Record<keyof AttemptSummaryData["capabilities"], string> = {
  source: "source",
  execution: "execution",
  timing: "timing",
  diff: "diff",
};

type UsageProps = ValueProps<UsageTableData | null, { className?: string }>;

const AttemptUsage = defineComponent<UsageProps>({
  dimensions: () => ({}),
  web(props) {
    const d = props.data;
    if (d === null || d === undefined) return null;
    const rows: [string, string][] = [];
    if (d.turns !== undefined) rows.push(["turns", String(d.turns)]);
    if (d.toolCalls !== undefined) rows.push(["tool calls", String(d.toolCalls)]);
    if (d.usage?.inputTokens !== undefined) {
      rows.push([
        d.usage.cacheReadTokens !== undefined ? "uncached in" : "in",
        d.usage.inputTokens.toLocaleString(),
      ]);
    }
    if (d.usage?.cacheReadTokens !== undefined) {
      rows.push(["cache read", d.usage.cacheReadTokens.toLocaleString()]);
    }
    if (d.usage?.outputTokens !== undefined) {
      rows.push(["out", d.usage.outputTokens.toLocaleString()]);
    }
    if (d.usage?.requests !== undefined) rows.push(["requests", String(d.usage.requests)]);
    if (d.estimatedCostUSD !== undefined) rows.push(["cost", `$${d.estimatedCostUSD.toFixed(4)}`]);
    return (
      <Grid className={cx("niceeval-usage-table", props.className)}>
        {rows.map(([label, value]) => (
          <Kpi key={label} label={label} value={value} />
        ))}
      </Grid>
    );
  },
  text(props) {
    const d = props.data;
    if (d === null || d === undefined) return "";
    const parts: string[] = [];
    if (d.turns !== undefined) parts.push(`turns=${d.turns}`);
    if (d.toolCalls !== undefined) parts.push(`tools=${d.toolCalls}`);
    if (d.estimatedCostUSD !== undefined) parts.push(`cost=$${d.estimatedCostUSD}`);
    return parts.length > 0 ? `usage: ${parts.join(" ")}` : "";
  },
});
AttemptUsage.displayName = "AttemptUsage";

function evidenceOf(props: { attempt?: AttemptEvidence }, ctx: { page: PageContext }): AttemptEvidence {
  if (props.attempt !== undefined) return props.attempt;
  const input = ctx.page.input;
  if (!isAttemptEvidence(input)) {
    throw new Error(
      "AttemptDetails requires attempt={evidence} or a page whose load produces AttemptEvidence (e.g. the standard attempt page).",
    );
  }
  return input;
}

export type AttemptDetailsProps = {
  attempt?: AttemptEvidence;
  className?: string;
};

export const AttemptAssessment = defineComponent<AttemptDetailsProps>(async (props, ctx) => {
  const evidence = evidenceOf(props, ctx);
  const notices = await toAttemptNotices(evidence);
  const pageInput = ctx.page.input;
  const hasSource = isAttemptEvidence(pageInput) ? pageInput.capabilities.source : evidence.capabilities.source;
  const assertions = hasSource ? null : await toAttemptAssertions(evidence);
  return (
    <Col>
      <Callouts items={notices} />
      {hasSource ? (
        <SourceView data={await toAttemptSource(evidence)} />
      ) : assertions !== null && assertions.rows.length > 0 ? (
        <TableContentView data={assertions} />
      ) : null}
    </Col>
  );
});
AttemptAssessment.displayName = "AttemptAssessment";

/** 公开 Attempt 详情组合；文档名 AttemptDetails。 */
export const AttemptDetails = defineComponent<AttemptDetailsProps>(async (props, ctx) => {
  const evidence = evidenceOf(props, ctx);
  const hasSource = evidence.capabilities.source;
  const [notices, source, assertions, summary, fixPrompt, timeline, usage, conversation, diff] = await Promise.all([
    toAttemptNotices(evidence),
    hasSource ? toAttemptSource(evidence) : Promise.resolve(null),
    hasSource ? Promise.resolve(null) : toAttemptAssertions(evidence),
    toAttemptSummary(evidence),
    toAttemptFixPrompt(evidence),
    toTimelineNodes(evidence),
    toAttemptUsage(evidence),
    toConversationTurns(evidence),
    toDiffFiles(evidence),
  ]);
  const embedded = embedConversationInSource(source, conversation);
  return (
    <Col className={props.className}>
      <AttemptSummary data={summary} />
      <Col>
        <Callouts items={notices} />
        {embedded.source !== null ? (
          <SourceView data={embedded.source} />
        ) : assertions !== null && assertions.rows.length > 0 ? (
          <TableContentView data={assertions} />
        ) : null}
      </Col>
      <CopyBlock content={fixPrompt} />
      <Waterfall
        nodes={timeline}
        title={{ en: "Execution timeline", "zh-CN": "执行时间轴" }}
      />
      <AttemptUsage data={usage} />
      {conversation === null ? (
        <Callouts items={executionEvidenceUnavailableCallouts} />
      ) : embedded.conversation !== null ? (
        <Conversation data={embedded.conversation} />
      ) : (
        null
      )}
      <DiffView files={diff} />
    </Col>
  );
});
AttemptDetails.displayName = "AttemptDetails";
