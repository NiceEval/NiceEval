// Attempt 详情组合件：叶子区块用原语和公开 to* 装配。
// 输入是 library-owned attempt 页的闭合 page input（或显式 locator）；证据一律经
// Analysis 的公开 DomainView 查询关闭。组件拿不到 Record reader、path、AttemptHandle
// 或 Effect Scope；详情 route 仍由 details.ts 的 attemptDetailTarget/Route 独占。

import type {
  AttemptEvidenceDomainDetail,
  AttemptEvidenceDomainView,
  AttemptObservabilityDomainView,
  ClosedTimingInterval,
  ClosedUsageObservation,
  FileChangesDomainView,
  SampleSnapshot,
  SourcesDomainView,
} from "../../../analysis/index.ts";
import type { AttemptLocator } from "../../../attempt-locator.ts";
import { defineComponent, type AuthorComposeContext } from "../../definition/tree.ts";
import {
  Callouts,
  Col,
  CommandEvidence,
  Conversation,
  CopyBlock,
  DiffView,
  Grid,
  SourceView,
  TableContentView,
  Waterfall,
} from "../../definition/primitives.tsx";
import type { CommandEvidenceContent, ConversationContent } from "../../definition/primitives/conversation.tsx";
import type { CalloutGroup } from "../../definition/primitives/callouts-logic.ts";
import type { DiffContent } from "../../definition/primitives/diff-lines.ts";
import type { SourceContent } from "../../definition/primitives/source-view.tsx";
import type { WaterfallContent } from "../../definition/primitives/waterfall.tsx";
import type { TableContent } from "../../definition/cell.ts";
import type { CopyBlockContent } from "../../definition/primitives/copy-block.tsx";
import { cx, type ValueProps } from "../../definition/primitives/shared.ts";
import { formatDurationMs, formatInstant, formatPoints, formatUSD } from "../../model/format.ts";
import { localeText } from "../../model/locale.ts";
import {
  toAttemptEvidence,
  toAttemptObservability,
  toFileChanges,
  toSources,
} from "../../model/conversions.ts";
import {
  attemptAssertionsContent,
  attemptCommandEvidenceContent,
  attemptConversationContent,
  attemptDiffContent,
  attemptFixPromptContent,
  attemptNoticesContent,
  embedConversationInSource,
  executionEvidenceUnavailableCallouts,
  projectedSourceContent,
  attemptTimelineContent,
} from "./content.tsx";
import {
  attemptAssertionsData,
  attemptCommandEvidenceData,
  attemptConversationData,
  attemptDiagnosticsData,
  attemptDiffData,
  attemptErrorData,
  attemptFixPromptData,
  attemptSourceData,
  attemptSummaryData,
  attemptTimelineData,
  observedCostUSD,
  usageTableData,
  type AttemptAssertionsData,
  type AttemptCapabilitiesView,
  type AttemptConversationData,
  type AttemptDiffData,
  type AttemptSourceData,
  type AttemptSummaryData,
  type UsageTableData,
} from "./compute.ts";

export {
  validateAssertionsData,
  validateCommandEvidenceData,
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

/**
 * 身份 / 时间 / 成本与 usage 共用的格内容:一行标签、一行值。几何(一行几格、什么宽度
 * 换列、格内多密)全归 `Grid` 算,这里只出内容——Grid 的格可以是任意节点,不限定为
 * `Stat`,这两块要的是紧凑身份表而不是读数卡。
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
    const verdictLabel = d.verdict === "unknown" ? "unknown" : localeText(ctx.locale, `verdict.${d.verdict}`);
    return (
      <div className={cx("niceeval-report", "niceeval-attempt-summary", props.className)}>
        <div className="niceeval-attempt-summary-head">
          <span className={`niceeval-verdict-pill niceeval-verdict-${d.verdict}`}>
            {verdictLabel}
          </span>
          <span className="niceeval-attempt-summary-locator">{d.locator}</span>
        </div>
        <Grid className="niceeval-attempt-summary-kpis">
          <Kpi label="Experiment" value={d.experimentId} />
          <Kpi label="Eval" value={d.identity.evalId} />
          <Kpi label="Attempt" value={String(d.identity.attempt + 1)} />
          {d.totalScore !== undefined ? <Kpi label="Score" value={formatPoints(d.totalScore)} /> : null}
          {d.startedAt ? <Kpi label="Started" value={formatInstant(d.startedAt, ctx.locale)} /> : null}
          <Kpi label="Duration" value={d.durationMs === null ? "—" : formatDurationMs(d.durationMs)} />
          {d.observedCostUSD !== undefined ? <Kpi label="Cost" value={formatUSD(d.observedCostUSD)} /> : null}
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
    const duration = d.durationMs === null ? "—" : formatDurationMs(d.durationMs);
    return `${d.locator} · ${d.verdict} · ${duration}`;
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

function usageObservationRow(observation: ClosedUsageObservation): [string, string] {
  switch (observation.kind) {
    case "token-bucket":
      return [`${observation.provider} ${observation.bucket}`, observation.tokens.toLocaleString()];
    case "request":
      return [`${observation.provider} ${observation.requestKind}`, "1"];
    case "provider-cost":
      return [`${observation.provider} cost`, `${observation.amount} ${observation.currency}`];
  }
}

const AttemptUsage = defineComponent<UsageProps>({
  dimensions: () => ({}),
  web(props) {
    const d = props.data;
    if (d === null || d === undefined) return null;
    const rows: [string, string][] = [];
    if (d.turns !== undefined) rows.push(["turns", String(d.turns)]);
    if (d.toolCalls !== undefined) rows.push(["tool calls", String(d.toolCalls)]);
    for (const observation of d.observations ?? []) rows.push(usageObservationRow(observation));
    if (d.observedCostUSD !== undefined) rows.push(["observed cost", `$${d.observedCostUSD.toFixed(4)}`]);
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
    if (d.observedCostUSD !== undefined) parts.push(`observedCost=$${d.observedCostUSD}`);
    return parts.length > 0 ? `usage: ${parts.join(" ")}` : "";
  },
});
AttemptUsage.displayName = "AttemptUsage";

/** library-owned attempt 详情页的闭合 page input(load 产物)。 */
export interface AttemptDetailsPageInput {
  readonly target: Readonly<{ readonly kind: "attempt"; readonly locator: AttemptLocator }>;
  readonly evidence: AttemptEvidenceDomainView;
}

export type AttemptDetailsProps = {
  /** 已关闭的 library-owned page input;省略时从 props.locator 或当前参数页 target 取。 */
  attempt?: AttemptDetailsPageInput;
  /** 显式 canonical locator;与 attempt 的 target 互斥,重复时 attempt 优先。 */
  locator?: AttemptLocator;
  className?: string;
};

type IncludedSlot = Extract<SampleSnapshot["slots"][number], { readonly state: "included" }>;

function locatorOf(props: AttemptDetailsProps, ctx: AuthorComposeContext): AttemptLocator {
  const target = props.attempt?.target;
  if (target !== undefined) return target.locator;
  if (props.locator !== undefined) return props.locator;
  const params = ctx.page.params;
  if (typeof params === "object" && params !== null && !Array.isArray(params) &&
    (params as Readonly<Record<string, unknown>>)["kind"] === "attempt") {
    const locator = (params as Readonly<Record<string, unknown>>)["locator"];
    if (typeof locator === "string") return locator as AttemptLocator;
  }
  throw new Error(
    "AttemptDetails requires attempt={...} or locator={...}, or a page whose params are the library-owned attempt detail target.",
  );
}

function includedSlotOf(snapshot: SampleSnapshot, locator: AttemptLocator): IncludedSlot {
  const slot = snapshot.slots.filter((entry): entry is IncludedSlot =>
    entry.state === "included" && entry.attempt.locator === locator
  )[0];
  if (slot === undefined) {
    throw new Error(`Attempt locator ${locator} is not an included member of the fixed Sample.`);
  }
  return slot;
}

type ViewEntry<View extends { readonly entries: readonly { readonly attempt: { readonly locator: string } }[] }> =
  View["entries"][number];

function entryOf<View extends { readonly entries: readonly { readonly attempt: { readonly locator: string } }[] }>(
  view: View,
  locator: AttemptLocator,
): ViewEntry<View> | undefined {
  return view.entries.find((entry) => entry.attempt.locator === locator);
}

type AttemptObservabilityEntry = AttemptObservabilityDomainView["entries"][number];
type AttemptEvidenceEntry = AttemptEvidenceDomainView["entries"][number];
type FileChangesEntry = FileChangesDomainView["entries"][number];
type SourcesEntry = SourcesDomainView["entries"][number];

function capabilitiesOf(
  evidence: AttemptEvidenceEntry | undefined,
  observability: AttemptObservabilityEntry | undefined,
  fileChanges: FileChangesEntry | undefined,
  sources: SourcesEntry | undefined,
): AttemptCapabilitiesView {
  return {
    source: sources?.state === "available",
    execution: observability?.state === "available",
    timing: observability?.state === "available" && observability.detail.timing.intervals.length > 0,
    diff: fileChanges?.state === "available",
  };
}

/** 闭合视图自己的 collection/entry 状态问题,也进 Callouts,不吞成缺失。 */
function closedViewNotices(input: {
  readonly evidence: AttemptEvidenceEntry | undefined;
  readonly observability: AttemptObservabilityEntry | undefined;
  readonly fileChanges: FileChangesEntry | undefined;
  readonly diffData: AttemptDiffData | null;
}): readonly CalloutGroup[] {
  const groups: CalloutGroup[] = [];
  if (input.evidence === undefined || input.evidence.state !== "available") {
    const state = input.evidence?.state ?? "missing";
    groups.push({
      title: "Closed assertion evidence",
      items: [{ level: "warning", message: `Evidence entry state: ${state}.` }],
    });
  }
  if (input.observability === undefined || input.observability.state !== "available") {
    const state = input.observability?.state ?? "missing";
    groups.push({
      title: "Closed observability",
      items: [{ level: "warning", message: `Observability entry state: ${state}.` }],
    });
  }
  if (input.fileChanges === undefined || input.fileChanges.state !== "available") {
    const state = input.fileChanges?.state ?? "missing";
    groups.push({
      title: "Closed file changes",
      items: [{ level: "warning", message: `File changes entry state: ${state}.` }],
    });
  }
  if (input.diffData !== null && input.diffData.collection.state === "partial") {
    groups.push({
      title: "File changes collection",
      items: [{ level: "warning", message: "The file changes collection is partial; some windows may be missing." }],
    });
  }
  return groups;
}

const COMMAND_CLOSING_PHASES = new Set(["attempt.teardown"]);

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

interface AttemptDetailsAssembly {
  readonly summary: AttemptSummaryData;
  readonly notices: readonly CalloutGroup[] | null;
  readonly assertions: AttemptAssertionsData | null;
  readonly source: SourceContent | null;
  readonly fixPrompt: CopyBlockContent | null;
  readonly timeline: WaterfallContent | null;
  readonly usage: UsageTableData | null;
  readonly conversationData: AttemptConversationData | null;
  readonly conversation: ConversationContent | null;
  readonly commandContent: CommandEvidenceContent | null;
  readonly diff: DiffContent | null;
}

/**
 * 组合层的唯一取数装配:固定 Sample 存活期间把四份 DomainView 关闭一次,之后全是纯投影。
 * 不建立第二套统计,不重算分母,不缓存跨页值。
 */
async function assembleAttemptDetails(
  props: AttemptDetailsProps,
  ctx: AuthorComposeContext,
): Promise<AttemptDetailsAssembly> {
  const locator = locatorOf(props, ctx);
  const evidence = props.attempt?.evidence ?? await toAttemptEvidence(ctx.scope, locator);
  const [observability, fileChanges, sources] = await Promise.all([
    toAttemptObservability(ctx.scope, locator),
    toFileChanges(ctx.scope, locator),
    toSources(ctx.scope, locator),
  ]);
  const slot = includedSlotOf(ctx.scope.snapshot, locator);

  const evidenceEntry = entryOf(evidence, locator);
  const observabilityEntry = entryOf(observability, locator);
  const fileChangesEntry = entryOf(fileChanges, locator);
  const sourcesEntry = entryOf(sources, locator);

  const evidenceDetail: AttemptEvidenceDomainDetail | undefined =
    evidenceEntry?.state === "available" ? evidenceEntry.detail : undefined;
  const observabilityDetail = observabilityEntry?.state === "available" ? observabilityEntry.detail : undefined;
  const capabilities = capabilitiesOf(evidenceEntry, observabilityEntry, fileChangesEntry, sourcesEntry);
  const verdict = evidenceDetail?.verdict ?? "unknown";

  const assertions = attemptAssertionsData(evidenceDetail);
  const assertionsView = assertions?.attention ?? [];
  const commandData = attemptCommandEvidenceData(observabilityDetail?.commands, locator);
  const commandContent = attemptCommandEvidenceContent(commandData);
  const conversationData = attemptConversationData(observabilityDetail?.conversation, locator);
  const conversation = attemptConversationContent(conversationData);
  const diagnostics = attemptDiagnosticsData(observabilityDetail?.diagnostics);
  const errorData = attemptErrorData({
    locator,
    outcome: evidenceDetail?.outcome ?? "completed",
    diagnostics: observabilityDetail?.diagnostics,
    commands: commandData?.commands,
  });
  const diffData = attemptDiffData(
    fileChangesEntry?.state === "available" ? fileChangesEntry.detail : undefined,
    locator,
  );
  const durationMs = observabilityDetail === undefined
    ? null
    : timingSpanOf(observabilityDetail.timing.intervals);
  const observedCost = observabilityDetail === undefined
    ? undefined
    : observedCostUSD(observabilityDetail.usage.observations);
  const originRunId = evidenceEntry?.attempt.originRunId ?? slot.attempt.originRunId;
  const startedAt = ctx.scope.snapshot.runs.find((run) => run.runId === originRunId)?.startedAt;
  const summary = attemptSummaryData({
    locator,
    experimentId: slot.experimentId,
    identity: { runId: slot.runId, evalId: slot.evalId, attempt: slot.attemptOrdinal },
    verdict,
    ...(startedAt === undefined ? {} : { startedAt: new Date(Number(startedAt)).toISOString() }),
    durationMs,
    ...(observedCost === undefined ? {} : { observedCostUSD: observedCost }),
    capabilities,
    ...(assertions?.totalScore === undefined ? {} : { totalScore: assertions.totalScore }),
  });
  const evaluationKind = assertions?.evaluationKind ?? "pass";
  const fixPrompt = attemptFixPromptContent(attemptFixPromptData({
    locator,
    experimentId: slot.experimentId,
    evalId: slot.evalId,
    verdict: verdict === "unknown" ? "skipped" : verdict,
    evaluationKind,
    assertions: assertionsView,
  }));
  const timeline = attemptTimelineContent(attemptTimelineData(observabilityDetail?.timing, locator));
  const usage = usageTableData({
    locator,
    experimentId: slot.experimentId,
    identity: { runId: slot.runId, evalId: slot.evalId, attempt: slot.attemptOrdinal },
    verdict,
    conversation: observabilityDetail?.conversation,
    usage: observabilityDetail?.usage,
  });
  const sourceData: AttemptSourceData | null = sourcesEntry?.state === "available" && evidenceDetail !== undefined
    ? attemptSourceData({
      locator,
      items: sourcesEntry.detail.items,
      sourceSites: evidenceDetail.sourceSites,
      entries: assertions?.attention ?? [],
    })
    : null;
  const source = projectedSourceContent(sourceData, locator);
  const viewNotices = closedViewNotices({ evidence: evidenceEntry, observability: observabilityEntry, fileChanges: fileChangesEntry, diffData });
  const notices = attemptNoticesContent(errorData, diagnostics);
  return {
    summary,
    notices: [...viewNotices, ...(notices ?? [])],
    assertions,
    source,
    fixPrompt,
    timeline,
    usage,
    conversationData,
    conversation,
    commandContent,
    diff: attemptDiffContent(diffData),
  };
}

function timingSpanOf(intervals: readonly ClosedTimingInterval[]): number | null {
  if (intervals.length === 0) return null;
  const start = Math.min(...intervals.map((interval) => interval.startOffsetMs));
  const end = Math.max(...intervals.map((interval) => interval.startOffsetMs + interval.durationMs));
  return Math.max(0, end - start);
}

export const AttemptAssessment = defineComponent<AttemptDetailsProps>(async (props, ctx) => {
  const data = await assembleAttemptDetails(props, ctx);
  const hasSource = data.source !== null;
  const assertionsTable: TableContent | null = hasSource ? null : attemptAssertionsContent(data.assertions);
  return (
    <Col>
      <Callouts items={data.notices ?? []} />
      {hasSource ? (
        <SourceView data={data.source} />
      ) : assertionsTable !== null ? (
        <TableContentView data={assertionsTable} />
      ) : null}
    </Col>
  );
});
AttemptAssessment.displayName = "AttemptAssessment";

/** 公开 Attempt 详情组合;文档名 AttemptDetails。 */
export const AttemptDetails = defineComponent<AttemptDetailsProps>(async (props, ctx) => {
  const data = await assembleAttemptDetails(props, ctx);
  const hasSource = data.source !== null;
  const assertionsTable: TableContent | null = hasSource ? null : attemptAssertionsContent(data.assertions);
  const embedded = embedConversationInSource(data.source, data.conversation);
  const commandSections = commandEvidenceSections(data.commandContent);
  return (
    <Col className={props.className}>
      <AttemptSummary data={data.summary} />
      <Col>
        <Callouts items={data.notices ?? []} />
        <CommandEvidence data={commandSections.before} />
        {embedded.source !== null ? (
          <SourceView data={embedded.source} />
        ) : assertionsTable !== null ? (
          <TableContentView data={assertionsTable} />
        ) : null}
      </Col>
      <CopyBlock content={data.fixPrompt} />
      <Waterfall
        nodes={data.timeline}
        title={{ en: "Execution timeline", "zh-CN": "执行时间轴" }}
      />
      <AttemptUsage data={data.usage} />
      {data.conversation === null ? (
        <Callouts items={executionEvidenceUnavailableCallouts} />
      ) : embedded.conversation !== null ? (
        <Conversation data={embedded.conversation} />
      ) : (
        null
      )}
      <CommandEvidence data={commandSections.after} />
      <DiffView files={data.diff} />
    </Col>
  );
});
AttemptDetails.displayName = "AttemptDetails";
