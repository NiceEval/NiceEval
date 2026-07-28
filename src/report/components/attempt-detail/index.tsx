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
  Grid,
  SourceView,
  Stat,
  Table,
  Waterfall,
} from "../../definition/primitives.tsx";
import type { AttemptSummaryData, UsageTableData } from "../../model/types.ts";
import type { SourceInput } from "../../source.ts";
import type { DataProps } from "../shared.ts";
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
  web(props) {
    const d = props.data!;
    return (
      <div className="nre nre-attempt-summary">
        <h2>{d.locator}</h2>
        <Grid columns={3} className={props.className}>
          <Stat label="Verdict" value={d.verdict} />
          <Stat label="Duration" value={`${d.durationMs}ms`} />
          {d.costUSD !== null ? <Stat label="Cost" value={`$${d.costUSD}`} /> : null}
        </Grid>
      </div>
    );
  },
  text(props) {
    const d = props.data!;
    return `${d.locator} · ${d.verdict} · ${d.durationMs}ms`;
  },
});
AttemptSummary.displayName = "AttemptSummary";

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
    return (
      <Grid columns={3} className={props.className}>
        {d.turns !== undefined ? <Stat label="Turns" value={d.turns} /> : null}
        {d.toolCalls !== undefined ? <Stat label="Tool calls" value={d.toolCalls} /> : null}
        {d.estimatedCostUSD !== undefined ? <Stat label="Cost" value={`$${d.estimatedCostUSD}`} /> : null}
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
