// Attempt 详情组合件:叶子区块用原语 + sources.attempt.* 装配。

import type { AttemptEvidence } from "../../../record/attempt-evidence.ts";
import { defineComponent } from "../../definition/tree.ts";
import { defineComposition } from "../../source.ts";
import { sources } from "../../sources.ts";
import {
  Callouts,
  Col,
  Conversation,
  CopyBlock,
  DiffView,
  SourceView,
  Table,
  Waterfall,
} from "../../definition/primitives.tsx";
import type { AttemptSummaryData, UsageTableData } from "../../model/types.ts";
import { formatDurationMs, formatPoints } from "../../model/format.ts";
import { localeText } from "../../model/locale.ts";
import type { SourceInput } from "../../source.ts";
import { cx, type DataProps } from "../shared.ts";
import type { AttemptPageContext, ScopePageContext } from "../../definition/tree.ts";

export {
  validateAssertionsData,
  validateConversationData,
  validateDiagnosticsData,
  validateDiffData,
  validateErrorData,
  validateFixPromptData,
  validateSourceData,
  validateSummaryData,
  validateTimelineData,
  validateTraceData,
  validateUsageData,
} from "./validate.tsx";

type SummaryProps<Input extends SourceInput = SourceInput> = DataProps<
  AttemptSummaryData,
  globalThis.Record<never, never>,
  { className?: string },
  Input
>;

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
        <dl className="niceeval-attempt-summary-kpis">
          <div>
            <dt>Experiment</dt>
            <dd>{d.identity.experimentId}</dd>
          </div>
          <div>
            <dt>Eval</dt>
            <dd>{d.identity.evalId}</dd>
          </div>
          <div>
            <dt>Attempt</dt>
            <dd>{d.identity.attempt + 1}</dd>
          </div>
          {d.totalScore !== undefined ? (
            <div>
              <dt>Score</dt>
              <dd>{formatPoints(d.totalScore)}</dd>
            </div>
          ) : null}
          {d.startedAt ? (
            <div>
              <dt>Started</dt>
              <dd>{d.startedAt}</dd>
            </div>
          ) : null}
          <div>
            <dt>Duration</dt>
            <dd>{formatDurationMs(d.durationMs)}</dd>
          </div>
          {d.costUSD !== null ? (
            <div>
              <dt>Cost</dt>
              <dd>${d.costUSD.toFixed(4)}</dd>
            </div>
          ) : null}
        </dl>
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
    return `${d.locator} · ${d.verdict} · ${d.durationMs}ms`;
  },
});
AttemptSummary.displayName = "AttemptSummary";

const ATTEMPT_CAPABILITY_LABEL: globalThis.Record<keyof AttemptSummaryData["capabilities"], string> = {
  source: "source",
  execution: "execution",
  timing: "timing",
  diff: "diff",
};

type UsageProps<Input extends SourceInput = SourceInput> = DataProps<
  UsageTableData | null,
  globalThis.Record<never, never>,
  { className?: string },
  Input
>;

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
      <dl className={cx("niceeval-report", "niceeval-usage-table", props.className)}>
        {rows.map(([label, value]) => (
          <div key={label} className="niceeval-usage-table-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
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

function isAttemptPage(page: ScopePageContext | AttemptPageContext): page is AttemptPageContext {
  return page.input === "attempt";
}

export const AttemptAssessment = defineComposition<globalThis.Record<never, never>, AttemptEvidence>(
  async (_props, ctx) => {
    const page = ctx.page as ScopePageContext | AttemptPageContext;
    if (!isAttemptPage(page)) {
      throw new Error('AttemptAssessment requires an attempt-input page (input: "attempt").');
    }
    return (
      <Col>
        <Callouts source={sources.attempt.notices} />
        {page.evidence.capabilities.source ? (
          <SourceView source={sources.attempt.source} />
        ) : (
          <Table source={sources.attempt.assertions} />
        )}
      </Col>
    );
  },
);
AttemptAssessment.displayName = "AttemptAssessment";

export const AttemptDetail = defineComposition<globalThis.Record<never, never>, AttemptEvidence>(async (_props, ctx) => {
  const page = ctx.page as ScopePageContext | AttemptPageContext;
  const conversationLivesInSource =
    isAttemptPage(page) &&
    page.evidence.capabilities.source &&
    page.evidence.evalSource !== null;
  return (
    <Col>
      <AttemptSummary source={sources.attempt.snapshot} />
      <AttemptAssessment />
      <CopyBlock source={sources.attempt.fixPrompt} />
      <Waterfall source={sources.attempt.timeline} />
      <AttemptUsage source={sources.attempt.usage} />
      {conversationLivesInSource ? null : <Conversation source={sources.attempt.conversation} />}
      <Waterfall source={sources.attempt.trace} />
      <DiffView source={sources.attempt.diff} />
    </Col>
  );
});
AttemptDetail.displayName = "AttemptDetail";

export type AttemptSectionProps<Data> =
  | { input?: AttemptEvidence; data?: never; className?: string }
  | { data: Data; input?: never; className?: string };
