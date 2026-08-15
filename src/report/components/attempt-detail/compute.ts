// Attempt 详情组件族的计算函数（docs/feature/reports/library.md）。
// 输入全部是 Analysis 已关闭的 DomainView detail。每个 `attempt*Data(...)` 都是纯同步
// 派生，只做展示与序列化所需取舍；不读文件、不 fetch、不持 Sample，不取得 Record reader、
// path、AttemptHandle 或 Effect Scope，也不重复调用 DomainView 查询。

import type { AttemptLocator } from "../../../attempt-locator.ts";
import type { VerdictState } from "../../../eval/record/verdict.ts";
import type {
  AttemptEvidenceDomainDetail,
  ClosedCommandEntry,
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
  JsonValue,
} from "../../../analysis/index.ts";
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
  /** sealed gate 投影:failed / unavailable 是 gate,其余是 soft。 */
  readonly severity: "gate" | "soft";
  readonly outcome: "passed" | "failed" | "unavailable";
  readonly groupPath: readonly string[];
  /** 展示层预拼好的判定详情(原因 / coverage / limitations / diagnostic)。 */
  readonly detail: string;
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

export type AttemptConversationReply =
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
    };

export interface AttemptInputRequestView {
  readonly state: "requested" | "answered" | "cancelled";
  readonly promptSummary: string;
  readonly responseSummary: string | null;
}

export interface AttemptConversationRound {
  readonly turnId: string;
  readonly sequence: number;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted";
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
  readonly role: string;
  readonly sourceItemId: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface AttemptSourceData {
  readonly locator: AttemptLocator;
  /** 第一个 item 是 spine，其余是 detached。 */
  readonly items: readonly AttemptSourceItemView[];
  readonly sites: readonly AttemptSourceSiteView[];
  readonly entries: readonly AttemptAssertionView[];
}

// ───────────────────────── AttemptSummary ─────────────────────────

export function attemptSummaryData(input: {
  readonly locator: AttemptLocator;
  readonly experimentId: string;
  readonly identity: AttemptIdentityView;
  readonly verdict: VerdictState | "unknown";
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

/**
 * sealed 断言 entry 的结构读取形状。DomainView 边界把整条 entry 声明成 JsonValue,
 * 展示层按已知 sealed 形状做最小结构读取(与 sourceSites 的 siteViewOf 同一条纪律):
 * 读不到的字段省略、读不懂的 entry 跳过,前向兼容,不伪造事实。
 */
export interface SealedAssertionEntryView {
  readonly entryId: string;
  readonly display: SealedAssertionDisplayView;
  readonly result: SealedAssertionResultView;
  readonly coverage: SealedAssertionCoverageView;
  readonly limitations: readonly SealedAssertionLimitationView[];
}

export interface SealedAssertionDisplayView {
  readonly label?: string;
  readonly key?: string;
  readonly groupPath: readonly string[];
}

export interface SealedAssertionCoverageView {
  readonly state: "complete" | "partial" | "unavailable" | "not-applicable";
  readonly reason?: string;
}

export interface SealedAssertionLimitationView {
  readonly kind: string;
}

export interface SealedAssertionResultView {
  readonly state: "matched" | "mismatched" | "unavailable" | "errored";
  readonly reason?: string;
  readonly gate: "not-gate" | "satisfied" | "failed" | "unavailable";
  readonly score: SealedAssertionScoreView;
  readonly diagnostic?: JsonValue;
}

export interface SealedAssertionScoreView {
  readonly state: "not-scored" | "earned" | "unavailable";
  readonly earned?: number;
  readonly points?: number;
}

function jsonRecordOf(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | undefined {
  if (value === undefined || typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, JsonValue>>;
}

function jsonStringOf(record: Readonly<Record<string, JsonValue>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function jsonNumberOf(record: Readonly<Record<string, JsonValue>>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function jsonStringArrayOf(record: Readonly<Record<string, JsonValue>>, key: string): readonly string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    items.push(item);
  }
  return items;
}

/** 整条 sealed assertion entry 的结构读取;读不懂(形状不符)返回 undefined,调用方跳过。 */
export function assertionEntryViewOf(value: JsonValue): SealedAssertionEntryView | undefined {
  const record = jsonRecordOf(value);
  if (record === undefined) return undefined;
  const entryId = jsonStringOf(record, "entryId");
  const display = jsonRecordOf(record["display"]);
  const result = jsonRecordOf(record["result"]);
  const coverage = jsonRecordOf(record["coverage"]);
  if (entryId === undefined || display === undefined || result === undefined || coverage === undefined) return undefined;
  const state = jsonStringOf(result, "state");
  const gate = jsonStringOf(result, "gate");
  const score = jsonRecordOf(result["score"]);
  if (state === undefined || gate === undefined || score === undefined) return undefined;
  if (state !== "matched" && state !== "mismatched" && state !== "unavailable" && state !== "errored") return undefined;
  if (gate !== "not-gate" && gate !== "satisfied" && gate !== "failed" && gate !== "unavailable") return undefined;
  const scoreState = jsonStringOf(score, "state");
  if (scoreState !== "not-scored" && scoreState !== "earned" && scoreState !== "unavailable") return undefined;
  const coverageState = jsonStringOf(coverage, "state");
  if (coverageState !== "complete" && coverageState !== "partial" &&
    coverageState !== "unavailable" && coverageState !== "not-applicable") return undefined;
  const limitations: SealedAssertionLimitationView[] = [];
  const rawLimitations = Array.isArray(record["limitations"]) ? record["limitations"] : [];
  for (const item of rawLimitations) {
    const kind = jsonStringOf(jsonRecordOf(item) ?? {}, "kind");
    if (kind !== undefined) limitations.push({ kind });
  }
  const earned = jsonNumberOf(score, "earned");
  const points = jsonNumberOf(score, "points");
  return {
    entryId,
    display: {
      ...(jsonStringOf(display, "label") === undefined ? {} : { label: jsonStringOf(display, "label") }),
      ...(jsonStringOf(display, "key") === undefined ? {} : { key: jsonStringOf(display, "key") }),
      groupPath: jsonStringArrayOf(display, "groupPath") ?? [],
    },
    result: {
      state,
      ...(jsonStringOf(result, "reason") === undefined ? {} : { reason: jsonStringOf(result, "reason") }),
      gate,
      score: {
        state: scoreState,
        ...(earned === undefined ? {} : { earned }),
        ...(points === undefined ? {} : { points }),
      },
      ...(result["diagnostic"] === undefined ? {} : { diagnostic: result["diagnostic"] }),
    },
    coverage: {
      state: coverageState,
      ...(jsonStringOf(coverage, "reason") === undefined ? {} : { reason: jsonStringOf(coverage, "reason") }),
    },
    limitations,
  };
}

/** sealed result → 展示 outcome;errored 归 failed,理由留在 detail。 */
function assertionOutcomeOf(entry: SealedAssertionEntryView): AttemptAssertionView["outcome"] {
  const state = entry.result.state;
  if (state === "matched") return "passed";
  if (state === "mismatched" || state === "errored") return "failed";
  return "unavailable";
}

function assertionSeverityOf(entry: SealedAssertionEntryView): AttemptAssertionView["severity"] {
  return entry.result.gate === "failed" || entry.result.gate === "unavailable" ? "gate" : "soft";
}

function scoreOf(entry: SealedAssertionEntryView): AttemptScoreView | undefined {
  const score = entry.result.score;
  if (score.state === "not-scored") return undefined;
  return {
    state: score.state,
    points: score.points ?? 0,
    ...(score.state === "earned" ? { earned: score.earned ?? 0 } : {}),
  };
}

/** 展示层预拼的判定详情;字段全闭合,不再有 expected / received 等旧形状。 */
export function assertionDetailOf(entry: SealedAssertionEntryView): string {
  const parts: string[] = [];
  if (entry.result.state === "mismatched") parts.push(`reason: ${entry.result.reason}`);
  if (entry.result.state === "unavailable") parts.push(`reason: ${entry.result.reason}`);
  if (entry.result.state === "errored") parts.push(`reason: ${entry.result.reason}`);
  if (entry.coverage.state !== "complete") {
    parts.push(`coverage: ${entry.coverage.state}${entry.coverage.reason === undefined ? "" : ` (${entry.coverage.reason})`}`);
  }
  for (const limitation of entry.limitations) {
    parts.push(`limitations: ${limitation.kind}`);
  }
  if (entry.result.diagnostic !== undefined) {
    parts.push(`diagnostic: ${stableJson(entry.result.diagnostic)}`);
  }
  return parts.join(" · ");
}

function assertionNameOf(entry: SealedAssertionEntryView): string {
  const display = entry.display;
  if (display.label !== undefined && display.label.length > 0) return display.label;
  if (display.key !== undefined && display.key.length > 0) return display.key;
  return entry.entryId;
}

export function assertionViewOf(entry: SealedAssertionEntryView): AttemptAssertionView {
  const score = scoreOf(entry);
  return {
    entryId: entry.entryId,
    name: assertionNameOf(entry),
    severity: assertionSeverityOf(entry),
    outcome: assertionOutcomeOf(entry),
    groupPath: entry.display.groupPath,
    detail: assertionDetailOf(entry),
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
  const entries = detail.entries
    .map(assertionEntryViewOf)
    .filter((entry): entry is SealedAssertionEntryView => entry !== undefined);
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

function conversationReplyOf(item: ClosedConversationItem): AttemptConversationReply {
  switch (item.kind) {
    case "message":
      return item.role === "assistant"
        ? { kind: "assistant", text: item.text }
        : { kind: "user", text: item.text };
    case "tool-call":
      return { kind: "tool", name: item.tool, inputSummary: item.inputSummary };
    case "tool-result":
      return {
        kind: "tool",
        name: item.callId,
        inputSummary: "",
        outputSummary: item.outputSummary,
        outcome: item.outcome,
        failed: item.outcome === "failed" || item.outcome === "rejected",
      };
    case "thinking-summary":
      return { kind: "thinking", text: item.summary };
    case "compaction":
      return { kind: "compaction", text: item.summary };
    case "context-injection":
      return { kind: "context", text: item.summary };
    case "subagent":
      return {
        kind: "subagent",
        name: item.label,
        state: item.state,
        summary: item.summary,
        failed: item.state === "failed",
      };
    case "input-request":
      return {
        kind: "input",
        request: {
          state: item.state,
          promptSummary: item.promptSummary,
          responseSummary: item.responseSummary,
        },
      };
    case "skill-load":
      return { kind: "skill", skill: item.code, text: item.summary };
    case "conversation-error":
      return { kind: "error", text: `${item.code}: ${item.summary}` };
  }
}

function roundsOf(detail: ClosedConversationDetail): readonly AttemptConversationRound[] {
  const itemsByTurn = new Map<string, ClosedConversationItem[]>();
  for (const item of detail.items) {
    const items = itemsByTurn.get(item.turnId) ?? [];
    items.push(item);
    itemsByTurn.set(item.turnId, items);
  }
  return [...detail.turns].sort(compareTurns).map((turn) => ({
    turnId: turn.turnId,
    sequence: turn.sequence,
    outcome: turn.outcome,
    replies: Object.freeze(
      [...(itemsByTurn.get(turn.turnId) ?? [])].sort(compareItems).map(conversationReplyOf),
    ),
  }));
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
): AttemptConversationData | null {
  if (detail === undefined || (detail.turns.length === 0 && detail.items.length === 0)) return null;
  return { locator, collection: detail.collection, rounds: roundsOf(detail) };
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

/** sourceSites 在 DomainView 边界是 JsonValue;这里做最小结构读取,读不到即跳过。 */
function siteViewOf(value: JsonValue): AttemptSourceSiteView | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  const entryId = record["entryId"];
  const role = record["role"];
  const sourceItemId = record["sourceItemId"];
  const start = record["start"];
  const end = record["end"];
  if (typeof entryId !== "string" || typeof role !== "string" || typeof sourceItemId !== "string") return undefined;
  if (typeof start !== "object" || start === null || Array.isArray(start)) return undefined;
  if (typeof end !== "object" || end === null || Array.isArray(end)) return undefined;
  const startLine = (start as Readonly<Record<string, unknown>>)["line"];
  const endLine = (end as Readonly<Record<string, unknown>>)["line"];
  if (typeof startLine !== "number" || typeof endLine !== "number") return undefined;
  if (startLine < 1 || endLine < startLine) return undefined;
  return { entryId, role, sourceItemId, startLine, endLine };
}

export function attemptSourceData(input: {
  readonly locator: AttemptLocator;
  readonly items: readonly {
    readonly sourceItemId: string;
    readonly path: string;
    readonly sha256: string;
    readonly content: { readonly state: "available"; readonly text: string } | { readonly state: "unavailable" | "binary" };
  }[];
  readonly sourceSites: readonly JsonValue[];
  readonly entries: readonly AttemptAssertionView[];
}): AttemptSourceData | null {
  const { locator, items, sourceSites, entries } = input;
  if (items.length === 0) return null;
  const knownEntryIds = new Set(entries.map((entry) => entry.entryId));
  const sites = sourceSites
    .map(siteViewOf)
    .filter((site): site is AttemptSourceSiteView => site !== undefined && knownEntryIds.has(site.entryId));
  return {
    locator,
    items: items.map((item) => ({
      sourceItemId: item.sourceItemId,
      path: item.path,
      sha256: item.sha256,
      lines: item.content.state === "available" ? item.content.text.replace(/\n$/, "").split("\n") : [],
      ...(item.content.state !== "available" ? { unavailable: item.content.state } : {}),
    })),
    sites,
    entries,
  };
}

// ───────────────────────── helpers ─────────────────────────

export function stableJson(value: JsonValue): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return typeof value === "string" ? value : String(value);
  }
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  const keys = Object.keys(value).sort(compareText);
  if (keys.length === 0) return "{}";
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson((value as Readonly<Record<string, JsonValue>>)[key]!)}`).join(",")}}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
