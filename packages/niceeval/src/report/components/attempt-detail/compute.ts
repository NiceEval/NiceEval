// Attempt 详情组件族的计算函数（docs/feature/reports/library.md）。
// 输入全部是 Analysis 已关闭的 DomainView detail。每个 `attempt*Data(...)` 都是纯同步
// 派生，只做展示与序列化所需取舍；不读文件、不 fetch、不持 Sample，不取得 Record reader、
// path、AttemptHandle 或 Effect Scope，也不重复调用 DomainView 查询。

import type { AttemptLocator } from "../../../attempt-locator.ts";
import type { VerdictState } from "../../../eval/record/verdict.ts";
import type {
  AttemptEvidenceDomainDetail,
  ClosedCommandEntry,
  ClosedAssertionLimitation,
  ClosedAssertionDecision,
  ClosedAssertionSourceSite,
  ClosedAssertionFactValue,
  ClosedMatcherFilterDebugger,
  ClosedMatcherFilterRow,
  ClosedCommandsDetail,
  ClosedConversationDetail,
  ClosedConversationItem,
  ClosedDiagnosticsDetail,
  ClosedFileChangeEndpoint,
  ClosedFileChangesCollection,
  ClosedSourceFrame,
  ClosedTimingDetail,
  ClosedTimingInterval,
  ClosedTraceCollection,
  ClosedUsageDetail,
  ClosedUsageObservation,
  FileChangesDomainDetail,
  SourceNavigationDomainDetail,
} from "../../../analysis/index.ts";
import type { AssertionEvidenceContent } from "../../definition/primitives/assertion-evidence.tsx";
import type {
  MatcherFilterDebuggerContent,
  MatcherFilterFieldContent,
  MatcherFilterNotice,
  MatcherFilterRowContent,
} from "../../definition/primitives/matcher-filter-debugger.tsx";
import type { DiffFile, DiffFileWindow } from "../../definition/primitives/diff-lines.ts";

// ───────────────────────── 共享视图形状 ─────────────────────────

/** 不可变身份元组的展示投影。 */
export interface AttemptIdentityView {
  readonly runId: string;
  readonly evalId: string;
  /** 零基 attempt 序号，显示时 +1。 */
  readonly attempt: number;
}

/**
 * 证据切面开关。由对应 DomainView 的 `available` entry 在不在判定；组合层在
 * 装配时投影，compute 只消费布尔值。
 */
export interface AttemptCapabilitiesView {
  readonly source: boolean;
  readonly execution: boolean;
  readonly timing: boolean;
  readonly diff: boolean;
}

// ───────────────────────── AttemptSummary(恒非空) ─────────────────────────

export interface AttemptSummaryData {
  readonly locator: AttemptLocator;
  readonly experimentId: string;
  readonly identity: AttemptIdentityView;
  /**
   * 闭合证据里的 terminal verdict。当前闭合 DomainView 拿不到时是 "unknown",
   * 不伪装成 passed / skipped(「合法零值不是空值」同一条纪律)。
   */
  readonly verdict: VerdictState | "unknown";
  /** 闭合视图不携带 attempt 墙钟开始时间;未知时省略。 */
  readonly startedAt?: string;
  /** timing 区间记录的 attempt 时钟跨度;没有 timing 证据时为 null。 */
  readonly durationMs: number | null;
  /** 历史 observed provider-cost 的 USD 面额合计;不是 Report Profile projection。 */
  readonly observedCostUSD?: number;
  readonly capabilities: AttemptCapabilitiesView;
  /** 计分制 attempt 的本轮挣分；通过制省略。 */
  readonly totalScore?: number;
}

/**
 * 断言评分贡献的闭合形状:sealed result 的 `score` 只在这两种状态里出现。
 * `earned` 是本轮实际挣分,`points` 是该项可得分。
 */
export interface AttemptScoreView {
  readonly state: "earned" | "unavailable";
  readonly points: number;
  readonly earned?: number;
}

/** 闭合断言 entry 的展示投影。 */
export interface AttemptAssertionView {
  readonly entryId: string;
  readonly name: string;
  /** 展示角色:失败 gate、未计分 recorded、其余带分 scored。 */
  readonly severity: "gate" | "recorded" | "scored";
  /** 保留 sealed result，避免 scored mismatch 被改写成笼统的 failed。 */
  readonly result: ClosedAssertionDecision["result"];
  readonly outcome: "passed" | "failed" | "unavailable";
  readonly groupPath: readonly string[];
  /** Table 等紧凑读面的中立判定摘要。 */
  readonly detail: string;
  /** Source 展开区消费的五段闭合结构。 */
  readonly evidence: AssertionEvidenceContent;
  /** 得分点贡献;没有 score 贡献时整字段省略。 */
  readonly score?: AttemptScoreView;
}

// ───────────────────────── AttemptError ─────────────────────────

export interface AttemptErrorData {
  readonly code: string;
  readonly message: string;
  readonly phase: string;
  readonly locator: AttemptLocator;
  readonly commandEvidenceHint?: true;
}

// ───────────────────────── AttemptAssertions ─────────────────────────

export interface AttemptAssertionsData {
  /** 非 passed 与得分点(含 passed):平铺列表。 */
  readonly attention: readonly AttemptAssertionView[];
  /** 无得分点的 passed 断言按 `groupPath.join(" > ")` 收纳。 */
  readonly passedGroups: readonly {
    readonly group: string;
    readonly items: readonly AttemptAssertionView[];
  }[];
  /** 得分点挣满计数("2/5 得分点挣满"):挣满 = earned === points。 */
  readonly scorePointsEarned?: { readonly earned: number; readonly total: number };
  /** 计分制本轮挣分合计;通过制省略。 */
  readonly totalScore?: number;
  /** 题型判定:看 sealed score 状态,不从显示形状推断。 */
  readonly evaluationKind: "pass" | "points";
}

// ───────────────────────── AttemptFixPrompt ─────────────────────────

export interface AttemptFixPromptData {
  readonly prompt: string;
}

// ───────────────────────── AttemptTimeline / AttemptTrace ─────────────────────────

/** 当前闭合视图以 ClosedTimingInterval 树表示时间线。 */
export interface AttemptTimelineData {
  readonly locator: AttemptLocator;
  readonly collection: ClosedTraceCollection;
  readonly intervals: readonly ClosedTimingInterval[];
}

export interface AttemptTraceData {
  readonly locator: AttemptLocator;
  readonly collection: ClosedTraceCollection;
  readonly intervals: readonly ClosedTimingInterval[];
}

// ───────────────────────── AttemptConversation ─────────────────────────

interface AttemptConversationReplyTarget {
  readonly anchor?: string;
}

export type AttemptConversationReply = AttemptConversationReplyTarget & (
  | { readonly kind: "assistant"; readonly text: string }
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "error"; readonly text: string }
  | { readonly kind: "context"; readonly text: string }
  | { readonly kind: "skill"; readonly skill: string; readonly text?: string }
  | { readonly kind: "input"; readonly request: AttemptInputRequestView }
  | { readonly kind: "compaction"; readonly text: string }
  | {
      readonly kind: "tool";
      readonly callId: string;
      readonly name: string;
      readonly inputSummary: string;
      readonly outputSummary?: string;
      readonly outcome?: "completed" | "rejected" | "failed" | "cancelled";
      readonly failed?: boolean;
    }
  | {
      readonly kind: "subagent";
      readonly name: string;
      readonly state: "started" | "completed" | "failed";
      readonly summary: string;
      readonly failed?: boolean;
    }
);

export interface AttemptInputRequestView {
  readonly state: "requested" | "answered" | "cancelled";
  readonly promptSummary: string;
  readonly responseSummary: string | null;
}

export interface AttemptConversationRound {
  readonly turnId: string;
  readonly sequence: number;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted";
  readonly durationMs?: number;
  readonly replies: readonly AttemptConversationReply[];
}

export interface AttemptConversationData {
  readonly locator: AttemptLocator;
  readonly collection: ClosedTraceCollection;
  readonly rounds: readonly AttemptConversationRound[];
}

// ───────────────────────── AttemptCommandEvidence ─────────────────────────

/** 展示层唯一的命令分类规则;当前闭合视图只保存 outcome,没有 checked 语义。 */
export type AttemptCommandClassification = "succeeded" | "observed" | "failed";

export interface AttemptCommandCard {
  readonly key: string;
  /** 闭合视图没有命令 ↔ timing 节点的关联,这里用命令自身身份保持稳定键。 */
  readonly timingNodeId: string;
  readonly phase: string;
  readonly display: string;
  readonly exitCode: number;
  readonly classification: AttemptCommandClassification;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface AttemptCommandEvidenceData {
  readonly locator: AttemptLocator;
  readonly collection: ClosedTraceCollection;
  readonly commands: readonly AttemptCommandCard[];
}

// ───────────────────────── AttemptDiagnostics ─────────────────────────

export interface AttemptDiagnosticView {
  readonly code: string;
  readonly kind: "advisory" | "execution-error";
  readonly phase: string;
  readonly summary: string;
  readonly level: "warning" | "error";
  readonly causes: readonly { readonly code: string; readonly summary: string }[];
  readonly redaction: { readonly state: "none" } | { readonly state: "applied"; readonly replacements: number };
  readonly sourceFrame: ClosedSourceFrame | null;
}

export interface AttemptDiagnosticsData {
  readonly collection: ClosedTraceCollection;
  readonly groups: readonly {
    readonly phase: string;
    readonly items: readonly AttemptDiagnosticView[];
  }[];
}

// ───────────────────────── UsageTable ─────────────────────────

export interface UsageTableData {
  readonly locator: AttemptLocator;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly verdict: VerdictState | "unknown";
  /** conversation ledger 派生的轮数;没有 conversation 证据时整对省略。 */
  readonly turns?: number;
  readonly toolCalls?: number;
  /** 闭合 usage 观测原样保留(provider 与 bucket 词表开放,不压进假字段)。 */
  readonly observations?: readonly ClosedUsageObservation[];
  /** provider-cost 中的历史 observed USD 面额合计;没有可合计金额时省略。 */
  readonly observedCostUSD?: number;
}

// ───────────────────────── AttemptDiff ─────────────────────────

export interface AttemptDiffData {
  readonly locator: AttemptLocator;
  readonly collection: ClosedFileChangesCollection;
  /** 有证据但 agent 一个文件都没有可证净改动时是空清单(不是 null)。 */
  readonly files: readonly DiffFile[];
}

// ───────────────────────── AttemptSource ─────────────────────────

export interface AttemptSourceItemView {
  readonly sourceItemId: string;
  readonly path: string;
  readonly sha256: string;
  readonly lines: readonly string[];
  /** 内容不可渲染时是明确的缺失标记,不编造行。 */
  readonly unavailable?: "unavailable" | "binary";
}

export interface AttemptSourceSiteView {
  readonly entryId: string;
  readonly sourceOrder: number;
  readonly role: string;
  readonly sourceItemId: string;
  readonly sha256: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface AttemptSourceData {
  readonly locator: AttemptLocator;
  /** 第一个 item 是 spine，其余是 detached。 */
  readonly items: readonly AttemptSourceItemView[];
  readonly sites: readonly AttemptSourceSiteView[];
  readonly entries: readonly AttemptAssertionView[];
  readonly navigation?: SourceNavigationDomainDetail;
}

// ───────────────────────── AttemptSummary ─────────────────────────

export function attemptSummaryData(input: {
  readonly locator: AttemptLocator;
  readonly experimentId: string;
  readonly identity: AttemptIdentityView;
  readonly verdict: VerdictState | "unknown";
  readonly startedAt?: string;
  readonly durationMs: number | null;
  readonly observedCostUSD?: number;
  readonly capabilities: AttemptCapabilitiesView;
  readonly totalScore?: number;
}): AttemptSummaryData {
  return {
    locator: input.locator,
    experimentId: input.experimentId,
    identity: input.identity,
    verdict: input.verdict,
    ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
    durationMs: input.durationMs,
    ...(input.observedCostUSD === undefined ? {} : { observedCostUSD: input.observedCostUSD }),
    capabilities: input.capabilities,
    ...(input.totalScore === undefined ? {} : { totalScore: input.totalScore }),
  };
}

// ───────────────────────── AttemptError ─────────────────────────

/**
 * `message` 疑似只剩某条失败命令 stdout/stderr 的截断尾部:去首尾空白后,严格短于该字段
 * 且是它的后缀。严格短于(不是 `<=`)排除「message 恰好等于完整字段」的场景:那种情况
 * 没有被截掉的内容,提示「还有更多证据」是误导。
 */
function looksLikeTruncatedCommandTail(
  message: string,
  commands: readonly AttemptCommandCard[],
): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return commands.filter((command) => command.classification === "failed").some((command) =>
    [command.stdout, command.stderr].some((field) => {
      const full = (field ?? "").trim();
      return full.length > trimmed.length && full.endsWith(trimmed);
    }),
  );
}

/**
 * 执行级错误投影:outcome 非 completed,或闭合 diagnostics 里有 execution-error。
 * 当前闭合视图没有旧 Record 的 AttemptError 结构,这两处是唯一的闭合事实来源。
 */
export function attemptErrorData(input: {
  readonly locator: AttemptLocator;
  readonly outcome: AttemptEvidenceDomainDetail["outcome"];
  readonly diagnostics?: ClosedDiagnosticsDetail;
  readonly commands?: readonly AttemptCommandCard[];
}): AttemptErrorData | null {
  const executionError = input.diagnostics?.diagnostics.find((diagnostic) =>
    diagnostic.kind === "execution-error"
  );
  const interrupted = input.outcome === "errored" || input.outcome === "interrupted";
  if (!interrupted && executionError === undefined) return null;
  const code = executionError?.code ?? `execution.${input.outcome}`;
  const message = executionError?.summary ?? "Attempt execution did not complete.";
  const phase = executionError?.phase ?? "attempt";
  const commands = input.commands;
  const hint = commands !== undefined && commands.length > 0 &&
    looksLikeTruncatedCommandTail(message, commands);
  return {
    code,
    message,
    phase,
    locator: input.locator,
    ...(hint ? { commandEvidenceHint: true as const } : {}),
  };
}

// ───────────────────────── AttemptAssertions ─────────────────────────

export type SealedAssertionEntryView = AttemptEvidenceDomainDetail["entries"][number];

/** Typed Analysis entry → report view. No Record or matcher shape is parsed here. */
export function assertionEntryViewOf(value: SealedAssertionEntryView): SealedAssertionEntryView {
  return value;
}

function assertionOutcomeOf(entry: SealedAssertionEntryView): AttemptAssertionView["outcome"] {
  const state = entry.decision.result;
  if (state === "matched") return "passed";
  if (state === "mismatched" || state === "errored") return "failed";
  return "unavailable";
}

function assertionSeverityOf(entry: SealedAssertionEntryView): AttemptAssertionView["severity"] {
  if (entry.decision.gate === "failed" || entry.decision.gate === "unavailable") return "gate";
  return entry.decision.contribution.state === "not-scored" ? "recorded" : "scored";
}

function scoreOf(entry: SealedAssertionEntryView): AttemptScoreView | undefined {
  const score = entry.decision.contribution;
  if (score.state === "not-scored") return undefined;
  return {
    state: score.state,
    points: score.points,
    ...(score.state === "earned" ? { earned: score.earned } : {}),
  };
}

export function assertionDetailOf(entry: SealedAssertionEntryView): string {
  const parts: string[] = [];
  if (entry.decision.reason !== null) parts.push(`reason: ${entry.decision.reason}`);
  if (entry.source.coverage.state !== "complete") {
    parts.push(`coverage: ${entry.source.coverage.state} (${entry.source.coverage.reason})`);
  }
  return parts.join(" · ");
}

function assertionNameOf(entry: SealedAssertionEntryView): string {
  const display = entry.display;
  if (display.label !== undefined && display.label.length > 0) return display.label;
  if (display.key !== undefined && display.key.length > 0) return display.key;
  return entry.entryId;
}

function factValue(value: null | boolean | number | string): ClosedAssertionFactValue {
  return { kind: "value", value };
}

function limitationFact(limitation: ClosedAssertionLimitation): ClosedAssertionFactValue {
  switch (limitation.kind) {
    case "redacted":
      return { kind: "fields", fields: [
        { label: "kind", value: factValue(limitation.kind) },
        { label: "fieldCount", value: factValue(limitation.fieldCount) },
      ] };
    case "sampled":
      return { kind: "fields", fields: [
        { label: "kind", value: factValue(limitation.kind) },
        { label: "captured", value: factValue(limitation.captured) },
        ...(limitation.knownTotal === undefined
          ? []
          : [{ label: "knownTotal", value: factValue(limitation.knownTotal) }]),
      ] };
    case "truncated":
      return { kind: "fields", fields: [
        { label: "kind", value: factValue(limitation.kind) },
        { label: "omittedBytes", value: factValue(limitation.omittedBytes) },
      ] };
    case "provider-limited":
      return { kind: "fields", fields: [
        { label: "kind", value: factValue(limitation.kind) },
      ] };
  }
}

function closedFactText(value: ClosedAssertionFactValue): string {
  switch (value.kind) {
    case "unavailable":
      return value.reason;
    case "value":
      return typeof value.value === "string" ? value.value : String(value.value);
    case "text":
      return value.text;
    case "list":
      return value.items.map(closedFactText).join(", ");
    case "fields":
      return value.fields.map((field) => `${field.label}: ${closedFactText(field.value)}`).join(" · ");
  }
}

function closedFactField(
  value: ClosedAssertionFactValue,
  label: string,
): ClosedAssertionFactValue | undefined {
  return value.kind === "fields"
    ? value.fields.find((field) => field.label === label)?.value
    : undefined;
}

function matcherQueryName(value: ClosedAssertionFactValue): string | undefined {
  const matcher = closedFactField(value, "matcher");
  if (matcher === undefined) return undefined;
  const summary = closedFactText(matcher);
  return summary.length === 0 ? undefined : summary;
}

function matcherCollectionQuerySummary(value: ClosedAssertionFactValue): string {
  const matcher = matcherQueryName(value);
  const quantifier = closedFactField(value, "quantifier");
  const kind = quantifier === undefined ? undefined : closedFactField(quantifier, "kind");
  const count = quantifier === undefined ? undefined : closedFactField(quantifier, "count");
  if (matcher === undefined || kind?.kind !== "value" || typeof kind.value !== "string") {
    return closedFactText(value);
  }
  if (kind.value === "absent") return `none × ${matcher}`;
  if (count?.kind !== "value" || typeof count.value !== "number") return closedFactText(value);
  if (kind.value === "exact") return `exactly ${count.value} × ${matcher}`;
  if (kind.value === "at-least") return `at least ${count.value} × ${matcher}`;
  return closedFactText(value);
}

function matcherOrderQuerySummary(value: ClosedAssertionFactValue): string {
  return matcherQueryName(value) ?? closedFactText(value);
}

function matcherFilterFields(value: ClosedAssertionFactValue): readonly MatcherFilterFieldContent[] {
  if (value.kind === "fields") {
    return value.fields.map((field) => ({ label: field.label, value: closedFactText(field.value) }));
  }
  if (value.kind === "list") {
    return value.items.map((item, index) => ({ label: String(index + 1), value: closedFactText(item) }));
  }
  return [{ label: "value", value: closedFactText(value) }];
}

function matcherFilterRowContent(row: ClosedMatcherFilterRow): MatcherFilterRowContent {
  const difference = row.evaluation.result === "matched" ||
      row.evaluation.result === "mismatched" ||
      row.evaluation.result === "unavailable" ||
      row.evaluation.result === "not-evaluated" ||
      row.evaluation.result === "not-retained"
    ? row.evaluation.difference
    : undefined;
  return {
    key: row.rowId,
    number: row.number,
    kind: row.kind,
    summary: row.summary,
    state: row.evaluation.result,
    fields: matcherFilterFields(row.detail),
    ...(difference === undefined ? {} : { difference: matcherFilterFields(difference) }),
    ...(row.conversationTarget.state === "exact"
      ? { conversationTarget: { anchor: row.conversationTarget.anchor } }
      : {}),
  };
}

function matcherRelationNotice(
  debuggerView: ClosedMatcherFilterDebugger,
): MatcherFilterNotice | undefined {
  if (debuggerView.state === "legacy") return "historical-not-recorded";
  if (debuggerView.identityRelation.state === "exact") return undefined;
  return debuggerView.identityRelation.reason === "ambiguous"
    ? "ambiguous-relation"
    : "source-unavailable";
}

function matcherFilterDebuggerContent(
  debuggerView: ClosedMatcherFilterDebugger,
): MatcherFilterDebuggerContent {
  if (debuggerView.state === "legacy") {
    const final = debuggerView.source.final;
    return {
      state: "legacy",
      queryKind: "unavailable",
      subject: debuggerView.subject,
      querySummary: "Matcher query was not retained",
      facts: [],
      atEvaluation: {
        state: final.state,
        rows: final.rows.map(matcherFilterRowContent),
      },
      afterEvaluation: [],
      relationNotice: "historical-not-recorded",
    };
  }
  const atEvaluation = debuggerView.source.atEvaluation;
  const final = debuggerView.source.final;
  const querySummary = debuggerView.query.kind === "collection-filter"
    ? matcherCollectionQuerySummary(debuggerView.query.summary)
    : debuggerView.query.summaries.map(matcherOrderQuerySummary).join(" → ");
  const receipt = debuggerView.receipt;
  const collection = debuggerView.query.kind === "collection-filter";
  const observed = collection && "matched" in receipt
    ? {
        en: `${receipt.matched} matched · ${receipt.mismatched} not matched · ${receipt.unavailable} unknown`,
        "zh-CN": `${receipt.matched} 条命中 · ${receipt.mismatched} 条未命中 · ${receipt.unavailable} 条无法判断`,
      }
    : !collection && "definitePrefixLength" in receipt
    ? {
        en: `${receipt.definitePrefixLength}/${debuggerView.query.summaries.length} definite · ${receipt.possiblePrefixLength}/${debuggerView.query.summaries.length} possible`,
        "zh-CN": `${receipt.definitePrefixLength}/${debuggerView.query.summaries.length} 步确定 · ${receipt.possiblePrefixLength}/${debuggerView.query.summaries.length} 步可能`,
      }
    : { en: "unavailable", "zh-CN": "不可用" };
  const examined = collection && "examined" in receipt
    ? {
        en: `${receipt.examined}/${receipt.knownTotal ?? "?"} rows`,
        "zh-CN": `${receipt.examined}/${receipt.knownTotal ?? "?"} 条记录`,
      }
    : !collection && "sourceRows" in receipt
    ? {
        en: `${receipt.sourceRows} rows · ${receipt.comparisons} comparisons`,
        "zh-CN": `${receipt.sourceRows} 条记录 · ${receipt.comparisons} 次比较`,
      }
    : { en: "unavailable", "zh-CN": "不可用" };
  const atRows = atEvaluation.rows.map(matcherFilterRowContent);
  const afterRows = final.rows
    .filter((row) => row.phase === "outside-evaluation-snapshot")
    .map(matcherFilterRowContent);
  const relationNotice = matcherRelationNotice(debuggerView);
  const notices: MatcherFilterNotice[] = [
    ...(atEvaluation.state === "partial" ? ["source-partial" as const] : []),
    ...(debuggerView.overlayRetention === "partial" ? ["overlay-partial" as const] : []),
    ...(atEvaluation.state === "unavailable" ? ["source-unavailable" as const] : []),
  ].filter((notice) => notice !== relationNotice);
  return {
    state: "current",
    queryKind: debuggerView.query.kind,
    subject: debuggerView.subject,
    querySummary,
    facts: [
      { kind: "observed", value: observed },
      { kind: "examined", value: examined },
    ],
    steps: debuggerView.steps.map((step) => ({
      step: step.step,
      summary: closedFactText(step.summary),
      state: step.state,
      ...(step.sourceRow === undefined ? {} : { sourceRow: step.sourceRow }),
      ...(step.conversationTarget?.state === "exact"
        ? { conversationTarget: { anchor: step.conversationTarget.anchor } }
        : {}),
    })),
    atEvaluation: {
      state: atEvaluation.state,
      rows: atRows,
      ...(notices.length === 0 ? {} : { notices }),
    },
    afterEvaluation: afterRows,
    ...(relationNotice === undefined ? {} : { relationNotice }),
  };
}

function assertionEvidenceOf(entry: SealedAssertionEntryView): AssertionEvidenceContent {
  const coverageFields: { readonly label: string; readonly value: ClosedAssertionFactValue }[] = [
    { label: "state", value: factValue(entry.source.coverage.state) },
  ];
  if ("reason" in entry.source.coverage) {
    coverageFields.push({ label: "reason", value: factValue(entry.source.coverage.reason) });
  }
  const source: ClosedAssertionFactValue = {
    kind: "fields",
    fields: [
      ...entry.source.fields,
      { label: "coverage", value: { kind: "fields", fields: coverageFields } },
      ...(entry.source.limitations.length === 0
        ? []
        : [{
            label: "limitations",
            value: { kind: "list" as const, items: entry.source.limitations.map(limitationFact) },
          }]),
    ],
  };
  const receipt = entry.observed.receipt;
  const observed: ClosedAssertionFactValue = receipt === undefined
    ? entry.observed
    : {
        kind: "fields",
        fields: [
          ...entry.observed.fields,
          {
            label: "receipt",
            value: {
              kind: "fields",
              fields: [
                { label: "examined", value: factValue(receipt.examined) },
                { label: "matched", value: factValue(receipt.matched) },
                { label: "mismatched", value: factValue(receipt.mismatched) },
                { label: "unavailable", value: factValue(receipt.unavailable) },
                { label: "knownTotal", value: factValue(receipt.knownTotal) },
                { label: "complete", value: factValue(receipt.complete) },
                { label: "exhaustive", value: factValue(receipt.exhaustive) },
                { label: "decisive", value: factValue(receipt.decisive) },
              ],
            },
          },
        ],
      };
  return {
    source,
    check: entry.check,
    observed: { kind: "fields", fields: observed.kind === "fields" ? observed.fields : [] },
    expected: entry.expected,
    explanation: entry.explanation,
    ...(entry.matcherDebugger === undefined
      ? {}
      : { matcherDebugger: matcherFilterDebuggerContent(entry.matcherDebugger) }),
  };
}

export function assertionViewOf(entry: SealedAssertionEntryView): AttemptAssertionView {
  const score = scoreOf(entry);
  return {
    entryId: entry.entryId,
    name: assertionNameOf(entry),
    severity: assertionSeverityOf(entry),
    result: entry.decision.result,
    outcome: assertionOutcomeOf(entry),
    groupPath: entry.display.groupPath,
    detail: assertionDetailOf(entry),
    evidence: assertionEvidenceOf(entry),
    ...(score === undefined ? {} : { score }),
  };
}

/** 按 `groupPath.join(" > ")` 分组(无分组归到空键 ""),组内保持传入顺序。 */
function groupByPath<T extends { groupPath?: readonly string[] }>(items: readonly T[]): { group: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.groupPath?.join(" > ") ?? "";
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

/**
 * 得分点挣满计数:分母是全部带 score 贡献的断言;挣满 = earned === points。
 * 得分点(带 score)豁免 passed 收纳:即使 passed 也进平铺列表。
 */
function scorePointsEarnedOf(assertions: readonly AttemptAssertionView[]): { earned: number; total: number } | undefined {
  const scorePoints = assertions.filter((assertion) => assertion.score !== undefined);
  if (scorePoints.length === 0) return undefined;
  const earned = scorePoints.filter((assertion) =>
    assertion.score !== undefined && assertion.score.earned !== undefined &&
    assertion.score.earned === assertion.score.points
  ).length;
  return { earned, total: scorePoints.length };
}

export function attemptAssertionsData(
  detail: AttemptEvidenceDomainDetail | undefined,
): AttemptAssertionsData | null {
  if (detail === undefined) return null;
  const entries = detail.entries.map(assertionEntryViewOf);
  if (entries.length === 0) return null;
  const assertions = entries.map(assertionViewOf);
  const attentionBase = assertions.filter((assertion) =>
    assertion.outcome !== "passed" || assertion.score !== undefined
  );
  const passed = assertions.filter((assertion) =>
    assertion.outcome === "passed" && assertion.score === undefined
  );
  const scorePointsEarned = scorePointsEarnedOf(assertions);
  const scored = assertions.filter((assertion) => assertion.score !== undefined);
  const totalScore = scored.length === 0 ? undefined : scored.reduce(
    (sum, assertion) =>
      sum + (assertion.score!.state === "earned" && assertion.score!.earned !== undefined
        ? assertion.score!.earned
        : 0),
    0,
  );
  const evaluationKind = assertions.some((assertion) => assertion.score !== undefined)
    ? "points"
    : "pass";
  return {
    attention: attentionBase,
    passedGroups: groupByPath(passed),
    ...(scorePointsEarned ? { scorePointsEarned } : {}),
    ...(totalScore === undefined ? {} : { totalScore }),
    evaluationKind,
  };
}

// ───────────────────────── AttemptFixPrompt ─────────────────────────

/**
 * 单条 attempt 版的批量修复 prompt(与 CopyFixPrompt 的多条版本同一份步骤文案)。三态:
 * 计分制丢分或中止 → 非 null(围绕丢分检查点组装);计分制挣满且未中止、或通过制 passed
 * → null;skipped 恒 null。
 */
export function attemptFixPromptData(input: {
  readonly locator: AttemptLocator;
  readonly experimentId: string;
  readonly evalId: string;
  readonly verdict: VerdictState | "unknown";
  readonly evaluationKind: "pass" | "points";
  readonly assertions: readonly AttemptAssertionView[];
}): AttemptFixPromptData | null {
  const { locator, experimentId, evalId, verdict, evaluationKind, assertions } = input;
  if (verdict === "skipped" || verdict === "unknown") return null;
  // 通过制 passed 恒 null;计分制 passed 是否可操作看有没有丢分。
  if (verdict === "passed" && evaluationKind !== "points") return null;
  const failures = assertions.filter((assertion) => assertion.outcome === "failed");
  const lost = assertions.filter((assertion) =>
    assertion.score !== undefined && assertion.score.state === "earned" &&
    assertion.score.earned !== undefined && assertion.score.earned < assertion.score.points
  );
  // 计分制 passed 但有丢分:可操作失败,但这条 attempt 并没有"失败"——措辞分开。
  const lostPoints = verdict === "passed" && evaluationKind === "points";
  if (lostPoints) {
    if (lost.length === 0) return null;
  } else if (failures.length === 0) {
    return null;
  }
  const first = lostPoints ? lost[0]! : failures[0]!;
  const more = (lostPoints ? lost.length : failures.length) - 1;
  const moreNoun = lostPoints ? "lost points" : "failures";
  const summary = lostPoints
    ? `${first.name}: ${first.score!.earned ?? 0}/${first.score!.points}`
    : first.name;
  const reason = more > 0 ? `${summary} (+${more} more ${moreNoun})` : summary;
  const prompt = [
    lostPoints
      ? "Recover the lost points on this NiceEval points eval."
      : "Fix the failing eval from this niceeval run.",
    "",
    lostPoints ? "## Lost points" : "## Failure",
    `eval "${evalId}" [experiment ${experimentId}] — ${verdict}`,
    `  reason: ${reason}`,
    `  inspect: niceeval show ${locator}`,
    "",
    "## Steps",
    "1. niceeval is NOT in your training data. Read the relevant guide in `node_modules/niceeval/docs-site/` (English at the top level, Chinese under `zh/`) before changing anything.",
    "2. Run the inspect command above with `--source`, `--execution`, `--timing`, and `--diff` to see the assertions, transcript, timing, and workspace diff.",
    "3. Decide which side the defect is on: the program under test, or the eval itself (over-tight assertion, wrong fixture, missing setup). Fix that side; do not weaken assertions just to turn the run green.",
    `4. Re-run: \`npx niceeval exp ${experimentId} ${evalId}\`. Already-passing evals are skipped by the fingerprint cache; pass \`--rerun all\` to re-run everything.`,
    lostPoints
      ? "5. Run `npx niceeval show` and confirm the score improved."
      : "5. Run `npx niceeval show` and confirm this failure is gone.",
  ].join("\n");
  return { prompt };
}

// ───────────────────────── AttemptTimeline / AttemptTrace ─────────────────────────

export function attemptTimelineData(
  detail: ClosedTimingDetail | undefined,
  locator: AttemptLocator,
): AttemptTimelineData | null {
  if (detail === undefined || detail.intervals.length === 0) return null;
  return { locator, collection: detail.collection, intervals: detail.intervals };
}

export function attemptTraceData(
  detail: ClosedTimingDetail | undefined,
  locator: AttemptLocator,
): AttemptTraceData | null {
  if (detail === undefined || detail.intervals.length === 0) return null;
  return { locator, collection: detail.collection, intervals: detail.intervals };
}

// ───────────────────────── AttemptConversation ─────────────────────────

function conversationReplyOf(
  item: ClosedConversationItem,
  callsById: ReadonlyMap<string, Extract<ClosedConversationItem, { kind: "tool-call" }>>,
): AttemptConversationReply {
  const target = item.anchor === undefined ? {} : { anchor: item.anchor };
  switch (item.kind) {
    case "message":
      return item.role === "assistant"
        ? { ...target, kind: "assistant", text: item.text }
        : { ...target, kind: "user", text: item.text };
    case "tool-call":
      return { ...target, kind: "tool", callId: item.callId, name: item.tool, inputSummary: item.inputSummary };
    case "tool-result": {
      const call = callsById.get(item.callId);
      return {
        ...target,
        kind: "tool",
        callId: item.callId,
        name: call?.tool ?? item.callId,
        inputSummary: call?.inputSummary ?? "",
        outputSummary: item.outputSummary,
        outcome: item.outcome,
        failed: item.outcome === "failed",
      };
    }
    case "thinking-summary":
      return { ...target, kind: "thinking", text: item.summary };
    case "compaction":
      return { ...target, kind: "compaction", text: item.summary };
    case "context-injection":
      return { ...target, kind: "context", text: item.summary };
    case "subagent":
      return {
        ...target,
        kind: "subagent",
        name: item.label,
        state: item.state,
        summary: item.summary,
        failed: item.state === "failed",
      };
    case "input-request":
      return {
        ...target,
        kind: "input",
        request: {
          state: item.state,
          promptSummary: item.promptSummary,
          responseSummary: item.responseSummary,
        },
      };
    case "skill-load":
      return { ...target, kind: "skill", skill: item.code, text: item.summary };
    case "conversation-error":
      return { ...target, kind: "error", text: `${item.code}: ${item.summary}` };
  }
}

function roundsOf(
  detail: ClosedConversationDetail,
  timing?: ClosedTimingDetail,
  navigation?: SourceNavigationDomainDetail,
): readonly AttemptConversationRound[] {
  const itemsByTurn = new Map<string, ClosedConversationItem[]>();
  const callsById = new Map<string, Extract<ClosedConversationItem, { kind: "tool-call" }>>();
  for (const item of detail.items) {
    const items = itemsByTurn.get(item.turnId) ?? [];
    items.push(item);
    itemsByTurn.set(item.turnId, items);
    if (item.kind === "tool-call") callsById.set(item.callId, item);
  }
  const intervalById = new Map((timing?.intervals ?? []).map((interval) => [interval.intervalId, interval] as const));
  const navigationByTurn = new Map((navigation?.rows ?? []).map((row) => [row.turnId, row] as const));
  return [...detail.turns].sort(compareTurns).map((turn) => {
    const navigationRow = navigationByTurn.get(turn.turnId);
    const interval = navigationRow?.timing.state === "linked"
      ? intervalById.get(navigationRow.timing.intervalId)
      : undefined;
    return {
      turnId: turn.turnId,
      sequence: turn.sequence,
      outcome: turn.outcome,
      ...(interval === undefined ? {} : { durationMs: interval.durationMs }),
      replies: Object.freeze(
        [...(itemsByTurn.get(turn.turnId) ?? [])]
          .sort(compareItems)
          .map((item) => conversationReplyOf(item, callsById)),
      ),
    };
  });
}

function compareTurns(left: ClosedConversationDetail["turns"][number], right: ClosedConversationDetail["turns"][number]): number {
  return left.sequence - right.sequence || compareText(left.turnId, right.turnId);
}

function compareItems(left: ClosedConversationItem, right: ClosedConversationItem): number {
  return left.sequence - right.sequence || compareText(left.itemId, right.itemId);
}

export function attemptConversationData(
  detail: ClosedConversationDetail | undefined,
  locator: AttemptLocator,
  timing?: ClosedTimingDetail,
  navigation?: SourceNavigationDomainDetail,
): AttemptConversationData | null {
  if (detail === undefined || (detail.turns.length === 0 && detail.items.length === 0)) return null;
  return { locator, collection: detail.collection, rounds: roundsOf(detail, timing, navigation) };
}

// ───────────────────────── AttemptCommandEvidence ─────────────────────────

export function commandClassification(
  outcome: ClosedCommandEntry["result"]["outcome"],
): AttemptCommandClassification {
  if (outcome.kind === "exited") return outcome.exitCode === 0 ? "succeeded" : "failed";
  return "observed";
}

export function commandExitCode(outcome: ClosedCommandEntry["result"]["outcome"]): number {
  return outcome.kind === "exited" ? outcome.exitCode : -1;
}

export function commandInvocationText(command: ClosedCommandEntry): string {
  const invocation = command.manifest.invocation;
  return invocation.kind === "shell"
    ? invocation.command
    : [invocation.executable, ...invocation.arguments].join(" ");
}

/** 命令流 → 可渲染文本;blob 不可读或二进制时省略(不编造内容)。 */
function commandStreamText(stream: ClosedCommandEntry["result"]["stdout"]): string | undefined {
  if (stream.kind === "inline") return stream.text;
  if (stream.content.state === "available") return stream.content.text;
  return undefined;
}

export function commandCardOf(command: ClosedCommandEntry): AttemptCommandCard {
  return {
    key: command.commandId,
    timingNodeId: command.commandId,
    phase: command.manifest.phase,
    display: commandInvocationText(command),
    exitCode: commandExitCode(command.result.outcome),
    classification: commandClassification(command.result.outcome),
    ...(commandStreamText(command.result.stdout) !== undefined
      ? { stdout: commandStreamText(command.result.stdout) }
      : {}),
    ...(commandStreamText(command.result.stderr) !== undefined
      ? { stderr: commandStreamText(command.result.stderr) }
      : {}),
  };
}

/** 独立命令证据投影;不依赖 Conversation 是否有事件轮次。 */
export function attemptCommandEvidenceData(
  detail: ClosedCommandsDetail | undefined,
  locator: AttemptLocator,
): AttemptCommandEvidenceData | null {
  if (detail === undefined || detail.entries.length === 0) return null;
  return {
    locator,
    collection: detail.collection,
    commands: detail.entries.map(commandCardOf),
  };
}

// ───────────────────────── AttemptDiagnostics ─────────────────────────

export function attemptDiagnosticsData(
  detail: ClosedDiagnosticsDetail | undefined,
): AttemptDiagnosticsData | null {
  if (detail === undefined || detail.diagnostics.length === 0) return null;
  const groups = new Map<string, AttemptDiagnosticView[]>();
  for (const diagnostic of detail.diagnostics) {
    const list = groups.get(diagnostic.phase);
    const view: AttemptDiagnosticView = {
      code: diagnostic.code,
      kind: diagnostic.kind,
      phase: diagnostic.phase,
      summary: diagnostic.summary,
      level: diagnostic.kind === "execution-error" ? "error" : "warning",
      causes: diagnostic.causes,
      redaction: diagnostic.redaction,
      sourceFrame: diagnostic.sourceFrame,
    };
    if (list) list.push(view);
    else groups.set(diagnostic.phase, [view]);
  }
  return {
    collection: detail.collection,
    groups: [...groups.entries()].map(([phase, items]) => ({ phase, items })),
  };
}

// ───────────────────────── UsageTable ─────────────────────────

/** USD 面额的 observed provider-cost 合计;非 USD 不换汇，绝不是 Profile projection。 */
export function observedCostUSD(observations: readonly ClosedUsageObservation[]): number | undefined {
  let total: number | undefined;
  for (const observation of observations) {
    if (observation.kind !== "provider-cost" || observation.currency !== "USD") continue;
    const amount = Number.parseFloat(observation.amount);
    if (!Number.isFinite(amount)) continue;
    total = total === undefined ? amount : total + amount;
  }
  return total;
}

/**
 * 组装口径单源:identity 字段恒有;turns/toolCalls 是 conversation ledger 派生;token /
 * 请求 / 成本事实来自闭合 usage 观测(词表开放,原样保留,不压进旧 Usage 字段)。
 * 三者全部缺失时返回 null——没有任何用量事实可摆。
 */
export function usageTableData(input: {
  readonly locator: AttemptLocator;
  readonly experimentId: string;
  readonly identity: AttemptIdentityView;
  readonly verdict: VerdictState | "unknown";
  readonly conversation?: ClosedConversationDetail;
  readonly usage?: ClosedUsageDetail;
}): UsageTableData | null {
  const { locator, experimentId, identity, verdict, conversation, usage } = input;
  const turns = conversation?.turns.length;
  const toolCalls = conversation?.items.filter((item) => item.kind === "tool-call").length;
  const observations = usage?.observations;
  if (turns === undefined && toolCalls === undefined && observations === undefined) return null;
  const observed = observations === undefined ? undefined : observedCostUSD(observations);
  return {
    locator,
    experimentId,
    evalId: identity.evalId,
    attempt: identity.attempt,
    verdict,
    ...(turns === undefined ? {} : { turns }),
    ...(toolCalls === undefined ? {} : { toolCalls }),
    ...(observations === undefined ? {} : { observations }),
    ...(observed === undefined ? {} : { observedCostUSD: observed }),
  };
}

// ───────────────────────── AttemptDiff ─────────────────────────

/** 有界行 diff(公共前后缀修剪):对单区域编辑精确,复杂编辑给出上界近似。 */
function lineDelta(before: string | undefined, after: string | undefined): { added: number; deleted: number } {
  const a = before === undefined ? [] : before.split("\n");
  const b = after === undefined ? [] : after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return { added: b.length - prefix - suffix, deleted: a.length - prefix - suffix };
}

const MAX_HUNK_LINES = 200;

/** 一个窗口内单文件的最小 unified hunk(公共前后缀修剪);超预算截断。 */
function windowHunk(before: string | undefined, after: string | undefined): string {
  const a = before === undefined ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === undefined ? [] : after.replace(/\n$/, "").split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const removed = a.slice(prefix, a.length - suffix);
  const added = b.slice(prefix, b.length - suffix);
  const ctxBefore = a.slice(Math.max(0, prefix - 2), prefix);
  const start = Math.max(1, prefix - ctxBefore.length + 1);
  const lines = [`@@ -${start},${removed.length + ctxBefore.length} +${start},${added.length + ctxBefore.length} @@`];
  for (const line of ctxBefore) lines.push(` ${line}`);
  const shownRemoved = removed.slice(0, MAX_HUNK_LINES);
  const shownAdded = added.slice(0, MAX_HUNK_LINES);
  for (const line of shownRemoved) lines.push(`-${line}`);
  if (removed.length > shownRemoved.length) lines.push(`… (${removed.length - shownRemoved.length} more removed lines)`);
  for (const line of shownAdded) lines.push(`+${line}`);
  if (added.length > shownAdded.length) lines.push(`… (${added.length - shownAdded.length} more added lines)`);
  return lines.join("\n");
}

function endpointText(endpoint: ClosedFileChangeEndpoint): string | undefined {
  if (endpoint.state !== "present" || endpoint.revision.kind !== "text") return undefined;
  const content = endpoint.revision.content;
  if (content.state !== "available" || content.content.state !== "available") return undefined;
  return content.content.text;
}

function elidedReasonOf(endpoint: ClosedFileChangeEndpoint): "binary" | "oversized-text" | undefined {
  if (endpoint.state !== "present" || endpoint.revision.kind !== "elided") return undefined;
  return endpoint.revision.reason === "binary" ? "binary" : "oversized-text";
}

function endpointBytes(endpoint: ClosedFileChangeEndpoint): number | undefined {
  if (endpoint.state !== "present" || endpoint.revision.kind === "unavailable") return undefined;
  return endpoint.revision.byteLength;
}

/**
 * 净变化为 indeterminate 的路径不可证方向:不进 DiffFile 清单(不把不可证说成
 * modified);`collection.state === "partial"` 与 limitations 由组合层的 Callouts 交代。
 */
export function attemptDiffData(
  detail: FileChangesDomainDetail | undefined,
  locator: AttemptLocator,
): AttemptDiffData | null {
  if (detail === undefined) return null;
  const files: DiffFile[] = [];
  for (const pathEntry of detail.paths) {
    const net = pathEntry.net;
    if (net.state !== "available" || net.kind === "none") continue;
    const change = net.kind === "created" ? "added" : net.kind === "deleted" ? "deleted" : "modified";
    const touched = detail.trajectory.filter((window) =>
      pathEntry.changes.some((ref) => ref.windowId === window.windowId)
    );
    const windows: DiffFileWindow[] = [];
    for (const window of touched) {
      const changeIds = new Set(
        pathEntry.changes.filter((ref) => ref.windowId === window.windowId).map((ref) => ref.changeId),
      );
      const changes = window.changes.filter((entry) => changeIds.has(entry.changeId));
      const patches = changes
        .map((entry) => {
          const before = entry.kind === "created" ? undefined : endpointText(entry.before);
          const after = entry.kind === "deleted" ? undefined : endpointText(entry.after);
          if (before === undefined && after === undefined) return undefined;
          return windowHunk(before, after);
        })
        .filter((patch): patch is string => patch !== undefined);
      windows.push({
        window: `window ${window.sequence}`,
        ...(patches.length > 0 ? { patch: patches.join("\n") } : {}),
      });
    }
    const beforeElided = elidedReasonOf(net.before);
    const afterElided = elidedReasonOf(net.after);
    const elided = beforeElided ?? afterElided;
    if (elided !== undefined) {
      files.push({
        path: pathEntry.path,
        change,
        added: 0,
        removed: 0,
        elided: {
          reason: elided,
          ...(endpointBytes(net.before) !== undefined ? { beforeBytes: endpointBytes(net.before) } : {}),
          ...(endpointBytes(net.after) !== undefined ? { afterBytes: endpointBytes(net.after) } : {}),
        },
        windows,
      });
      continue;
    }
    const before = net.kind === "created" ? undefined : endpointText(net.before);
    const after = net.kind === "deleted" ? undefined : endpointText(net.after);
    const lines = lineDelta(before, after);
    files.push({
      path: pathEntry.path,
      change,
      added: lines.added,
      removed: lines.deleted,
      windows,
    });
  }
  return { locator, collection: detail.collection, files };
}

// ───────────────────────── AttemptSource ─────────────────────────

function siteViewOf(value: ClosedAssertionSourceSite): AttemptSourceSiteView {
  return {
    entryId: value.entryId,
    sourceOrder: value.sourceOrder,
    role: value.role,
    sourceItemId: value.sourceItemId,
    sha256: value.sha256,
    startLine: value.start.line,
    endLine: value.end.line,
  };
}

export function attemptSourceData(input: {
  readonly locator: AttemptLocator;
  readonly items: readonly {
    readonly sourceItemId: string;
    readonly path: string;
    readonly sha256: string;
    readonly content: { readonly state: "available"; readonly text: string } | { readonly state: "unavailable" | "binary" };
  }[];
  readonly sourceSites: readonly ClosedAssertionSourceSite[];
  readonly entries: readonly AttemptAssertionView[];
  readonly navigation?: SourceNavigationDomainDetail;
}): AttemptSourceData | null {
  const { locator, items, sourceSites, entries, navigation } = input;
  if (items.length === 0) return null;
  const knownEntryIds = new Set(entries.map((entry) => entry.entryId));
  const sites = sourceSites
    .map(siteViewOf)
    .filter((site) => knownEntryIds.has(site.entryId));
  const firstOrderByItem = new Map<string, number>();
  for (const site of sites) {
    const key = `${site.sourceItemId}:${site.sha256}`;
    const current = firstOrderByItem.get(key);
    if (current === undefined || site.sourceOrder < current) firstOrderByItem.set(key, site.sourceOrder);
  }
  for (const row of navigation?.rows ?? []) {
    if (row.source.state !== "mapped" || row.sourceOrder === null) continue;
    const key = `${row.source.sourceItemId}:${row.source.sha256}`;
    const current = firstOrderByItem.get(key);
    if (current === undefined || row.sourceOrder < current) firstOrderByItem.set(key, row.sourceOrder);
  }
  const referencedItems = items
    .filter((item) => firstOrderByItem.has(`${item.sourceItemId}:${item.sha256}`))
    .sort((left, right) =>
      firstOrderByItem.get(`${left.sourceItemId}:${left.sha256}`)! -
        firstOrderByItem.get(`${right.sourceItemId}:${right.sha256}`)! ||
      compareText(left.path, right.path) ||
      compareText(left.sourceItemId, right.sourceItemId)
    );
  if (referencedItems.length === 0) return null;
  return {
    locator,
    items: referencedItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      path: item.path,
      sha256: item.sha256,
      lines: item.content.state === "available" ? item.content.text.replace(/\n$/, "").split("\n") : [],
      ...(item.content.state !== "available" ? { unavailable: item.content.state } : {}),
    })),
    sites,
    entries,
    ...(navigation === undefined ? {} : { navigation }),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
