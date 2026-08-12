// Attempt 详情组合件:只组合已计算的纯投影值，不读取 Record 或 evidence shell。

import { defineComponent } from "../../definition/tree.ts";
import {
  Callouts,
  CommandEvidence,
  Col,
  Conversation,
  CopyBlock,
  DiffView,
  Grid,
  SourceView,
  TableContentView,
  Waterfall,
} from "../../definition/primitives.tsx";
import type { CalloutGroup } from "../../definition/primitives/callouts-logic.ts";
import type { CopyBlockContent } from "../../definition/primitives/copy-block.tsx";
import type { CommandEvidenceContent, ConversationContent } from "../../definition/primitives/conversation.tsx";
import type { DiffContent } from "../../definition/primitives/diff-view.tsx";
import type { SourceContent } from "../../definition/primitives/source-view.tsx";
import type { WaterfallContent } from "../../definition/primitives/waterfall.tsx";
import type { AttemptAssertionsData, AttemptSummaryData, UsageTableData } from "../../model/types.ts";
import { formatDurationMs, formatInstant, formatPoints, formatUSD } from "../../model/format.ts";
import { cx, type ValueProps } from "../shared.ts";
import {
  attemptAssertionsContent,
  embedConversationInSource,
  executionEvidenceUnavailableCallouts,
} from "./content.tsx";

export {
  validateAssertionsData,
  validateCommandEvidenceData,
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

function scoreText(score: NonNullable<AttemptSummaryData["score"]>): string {
  if (score.state !== "attachment-result") return score.state;
  switch (score.attachment.state) {
    case "available":
      switch (score.attachment.value.state) {
        case "complete":
          return `complete · ${formatPoints(score.attachment.value.earned)}`;
        case "partial":
          return `partial · ${formatPoints(score.attachment.value.earned)} · ${score.attachment.value.reasons.join(", ")}`;
        case "unavailable":
          return `unavailable · ${score.attachment.value.reasons.join(", ")}`;
      }
    case "unavailable":
      return "Attachment unavailable";
    case "migration-required":
      return "migration required";
    case "migration-unavailable":
      return "migration unavailable";
    case "unsupported":
      return "unsupported";
    case "invalid":
      return "invalid";
  }
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
            {d.verdict}
          </span>
          <span className="niceeval-attempt-summary-locator">{d.locator}</span>
        </div>
        <Grid className="niceeval-attempt-summary-kpis">
          <Kpi label="Experiment" value={d.experimentId} />
          <Kpi label="Eval" value={d.identity.evalId} />
          <Kpi label="Attempt" value={String(d.identity.attempt + 1)} />
          {d.score !== undefined ? <Kpi label="Score" value={scoreText(d.score)} /> : null}
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
    return [d.locator, d.verdict, d.score === undefined ? undefined : scoreText(d.score), formatDurationMs(d.durationMs)]
      .filter((part): part is string => part !== undefined)
      .join(" · ");
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

type AssertionsProps = ValueProps<AttemptAssertionsData | null, { className?: string }>;

/** Renders only the public Projection/Calculation result, including attachment states. */
export const AttemptAssertions = defineComponent<AssertionsProps>({
  dimensions: () => ({}),
  web(props) {
    const table = attemptAssertionsContent(props.data);
    return table === null ? null : <TableContentView data={table} className={props.className} />;
  },
  text() {
    return "";
  },
});
AttemptAssertions.displayName = "AttemptAssertions";

export interface AttemptAssessmentProps {
  readonly notices: readonly CalloutGroup[];
  readonly source: SourceContent | null;
  readonly assertions: AttemptAssertionsData | null;
  className?: string;
}

export interface AttemptDetailsProps extends AttemptAssessmentProps {
  readonly summary: AttemptSummaryData;
  readonly fixPrompt: CopyBlockContent | null;
  readonly timeline: WaterfallContent | null;
  readonly usage: UsageTableData | null;
  readonly commandEvidence: CommandEvidenceContent | null;
  readonly conversation: ConversationContent | null;
  readonly diff: DiffContent | null;
}

const COMMAND_CLOSING_PHASES = new Set(["agent.teardown", "sandbox.cleanup", "sandbox.suspend", "sandbox.stop"]);

function commandEvidenceSections(data: CommandEvidenceContent | null): {
  before: CommandEvidenceContent | null;
  after: CommandEvidenceContent | null;
} {
  if (data === null || data.commands.length === 0) return { before: null, after: null };
  const beforeCommands = data.commands.filter((command) => !COMMAND_CLOSING_PHASES.has(command.phase));
  const afterCommands = data.commands.filter((command) => COMMAND_CLOSING_PHASES.has(command.phase));
  return {
    before: beforeCommands.length > 0 ? { ...data, commands: beforeCommands } : null,
    after: afterCommands.length > 0 ? { ...data, commands: afterCommands } : null,
  };
}

export const AttemptAssessment = defineComponent<AttemptAssessmentProps>((props) => {
  return (
    <Col className={props.className}>
      <Callouts items={props.notices} />
      <AttemptAssertions data={props.assertions} />
      {props.source !== null ? <SourceView data={props.source} /> : null}
    </Col>
  );
});
AttemptAssessment.displayName = "AttemptAssessment";

/** 公开 Attempt 详情组合；文档名 AttemptDetails。 */
export const AttemptDetails = defineComponent<AttemptDetailsProps>((props) => {
  const embedded = embedConversationInSource(props.source, props.conversation);
  const commandSections = commandEvidenceSections(props.commandEvidence);
  return (
    <Col className={props.className}>
      <AttemptSummary data={props.summary} />
      <Col>
        <Callouts items={props.notices} />
        <CommandEvidence data={commandSections.before} />
        <AttemptAssertions data={props.assertions} />
        {embedded.source !== null ? (
          <SourceView data={embedded.source} />
        ) : null}
      </Col>
      <CopyBlock content={props.fixPrompt} />
      <Waterfall
        nodes={props.timeline}
        title={{ en: "Execution timeline", "zh-CN": "执行时间轴" }}
      />
      <AttemptUsage data={props.usage} />
      {props.conversation === null ? (
        <Callouts items={executionEvidenceUnavailableCallouts} />
      ) : embedded.conversation !== null ? (
        <Conversation data={embedded.conversation} />
      ) : (
        null
      )}
      <CommandEvidence data={commandSections.after} />
      <DiffView files={props.diff} />
    </Col>
  );
});
AttemptDetails.displayName = "AttemptDetails";
