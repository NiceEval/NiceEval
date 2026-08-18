// 实体列表计算函数(*Data):固定 Sample → 闭合组件数据。
// ExperimentTable / AttemptList / FailureList 的 *Data 都住在这里。
//
// 共同约定见 docs/feature/reports/architecture.md 与 calculations.md：
// - 第一参只收 Report Sample;issues 与 Evidence 留在 Analysis-owned MetricValue 里;
// - 指标一律来自 `aggregate()` facade,判定来自公开 attempt-evidence DomainView,
//   身份与覆盖事实来自 closed SampleSnapshot——这里不实现任何统计算法;
// - null ≠ 0:缺数据不编数,覆盖率经 samples/total 如实暴露;
// - 详情 href 一律经 `libraryDetailRoute()` + `attemptDetailTarget()` /
//   `experimentDetailTarget()` 建立,不自行编码 locator / experiment id 路径。

import type {
  AttemptEvidenceDomainView,
  CostMetricValue,
  JsonValue,
  MetricValue,
  PricingProfile,
  Sample,
} from "../../../analysis/index.ts";
import type { AttemptLocator } from "../../../attempt-locator.ts";
import type { EvalId, ExperimentId } from "../../../analysis/index.ts";
import type { Verdict } from "../../../shared/types.ts";
import {
  aggregate,
  attempt,
  evalId,
  experiment,
  type AggregationSubject,
} from "../../model/aggregate.ts";
import { costUSD, durationMs, passRate, tokens } from "../../model/metrics.ts";
import { toAttemptEvidence } from "../../model/conversions.ts";
import {
  attemptDetailTarget,
  experimentDetailTarget,
  libraryDetailRoute,
} from "../../library/details.ts";
import { assertionEntryViewOf } from "../attempt-detail/compute.ts";

type UtcMillis = Sample["snapshot"]["runs"][number]["startedAt"];
type ClosedAttemptEvidenceEntry = AttemptEvidenceDomainView["entries"][number];

export type EvaluationKindComposition = "pass" | "points" | "mixed";

/** 一个层级共用的四枚 Analysis-owned 读数。 */
export interface ExperimentMetrics {
  readonly passRate: MetricValue<number>;
  readonly durationMs: MetricValue<number>;
  /** Present only when the owning Report declares a PricingProfile. */
  readonly costUSD?: CostMetricValue;
  readonly tokens: MetricValue<number>;
}

/** 一次 attempt 的闭合行。 */
export interface AttemptListItem {
  readonly locator: AttemptLocator;
  readonly experimentId: ExperimentId;
  readonly evalId: EvalId;
  readonly attemptOrdinal: number;
  /** 来自公开 attempt-evidence DomainView;证据读取失败时为 null(不伪造判定)。 */
  readonly verdict: Verdict | null;
  /**
   * 闭合失败摘要:errored 取 outcome 词,failed 取首条 mismatched 断言条目的
   * display 标签;closed 数据没有可读摘录时为 null(渲染成 "—",不发明文案)。
   */
  readonly failureSummary: string | null;
  readonly evaluationKind: "pass" | "points";
  /** Complete earned score for this Attempt; absent for pass or incomplete score evidence. */
  readonly totalScore?: number;
  readonly passRate: MetricValue<number>;
  readonly durationMs: MetricValue<number>;
  /** Present only when the owning Report declares a PricingProfile. */
  readonly costUSD?: CostMetricValue;
  readonly tokens: MetricValue<number>;
  /** 所属 selected Run 的 startedAt(attempt 级起点不进 closed snapshot)。 */
  readonly startedAt: UtcMillis | null;
  /** 详情 href,经 libraryDetailRoute(attemptDetailTarget(locator)) 建立。 */
  readonly href: string;
}

/** experiment 层级表里一道 Eval 的闭合行;attempts 是它的可见子行。 */
export interface ExperimentListEvalRow {
  readonly evalId: EvalId;
  readonly evaluationKind: "pass" | "points";
  /** Mean of complete Attempt scores for this Eval. */
  readonly totalScore?: number;
  readonly endToEndPassRate: MetricValue<number>;
  readonly durationMs: MetricValue<number>;
  readonly costUSD?: CostMetricValue;
  readonly tokens: MetricValue<number>;
  readonly attempts: readonly AttemptListItem[];
}

/** 一个 experiment 的闭合行。 */
export interface ExperimentListItem {
  readonly experimentId: ExperimentId;
  /** 来自实验水位 Run 的 closed context;Run context 缺席时如实为 null。 */
  readonly agent: string | null;
  readonly model: string | null;
  readonly flags: Readonly<Record<string, JsonValue>> | null;
  readonly evaluationKind: EvaluationKindComposition;
  /** Sum of the visible per-Eval score cells; absent when no complete Score Eval exists. */
  readonly totalScore?: number;
  readonly endToEndPassRate: MetricValue<number>;
  readonly durationMs: MetricValue<number>;
  readonly costUSD?: CostMetricValue;
  readonly tokens: MetricValue<number>;
  /** 当前口径下没有 attempt 的题(active slot 为 not-recorded / core-invalid)。 */
  readonly missingEvalIds: readonly EvalId[];
  /**
   * 路径段组行的 Analysis-owned 读数,key 是完整组前缀(如 "downshift/basic")。
   * 组行不手写聚合:每个组前缀是 facade GroupFunction 的一个坐标,
   * 分母 / 状态 / Evidence 全部留在 Analysis。
   */
  readonly groupMetrics: ReadonlyMap<string, ExperimentMetrics>;
  readonly evalRows: readonly ExperimentListEvalRow[];
  /** 详情 href,经 libraryDetailRoute(experimentDetailTarget(id)) 建立。 */
  readonly href: string;
}

/** Eval 路径层级布局：叶子 / 路径段组。 */
export type EvalLayoutNode =
  | { readonly kind: "leaf"; readonly evalId: EvalId }
  | {
      readonly kind: "group";
      readonly segment: string;
      readonly prefix: string;
      readonly children: readonly EvalLayoutNode[];
    };

/** 相对已表达前缀的剩余路径;无前缀时是完整 evalId。 */
export function relativeEvalLabel(evalIdValue: EvalId, labelPrefix: string): string {
  if (!labelPrefix) return evalIdValue;
  const prefix = `${labelPrefix}/`;
  return evalIdValue.startsWith(prefix) ? evalIdValue.slice(prefix.length) : evalIdValue;
}

function joinEvalPath(prefix: string, segment: string): string {
  return prefix ? `${prefix}/${segment}` : segment;
}

/**
 * Eval 路径段 → 层级布局。两条收起条件在每一层兄弟之间各自判定
 * (docs/feature/reports/library.md「身份格与行数」):
 * 唯一组且无叶时剥壳前进,不插组行;组全为单成员或本层只有叶时全部放平。
 * 纯字符串投影,不读任何指标。
 */
export function experimentEvalLayout(evalIdValues: readonly EvalId[]): readonly EvalLayoutNode[] {
  return layoutLevel(evalIdValues, "");
}

function layoutLevel(members: readonly EvalId[], dirPrefix: string): readonly EvalLayoutNode[] {
  if (members.length === 0) return [];
  const leaves: EvalId[] = [];
  const groups = new Map<string, EvalId[]>();
  for (const member of members) {
    const remaining = relativeEvalLabel(member, dirPrefix).split("/").filter(Boolean);
    if (remaining.length <= 1) {
      leaves.push(member);
      continue;
    }
    const head = remaining[0]!;
    const list = groups.get(head);
    if (list) list.push(member);
    else groups.set(head, [member]);
  }
  const collapse =
    groups.size === 0 ||
    (groups.size === 1 && leaves.length === 0) ||
    [...groups.values()].every((group) => group.length === 1);
  if (collapse) {
    if (groups.size === 1 && leaves.length === 0) {
      const head = [...groups.keys()][0]!;
      return layoutLevel(members, joinEvalPath(dirPrefix, head));
    }
    return [...leaves]
      .sort((left, right) => left.localeCompare(right))
      .map((member): EvalLayoutNode => ({ kind: "leaf", evalId: member }));
  }
  const groupNodes: EvalLayoutNode[] = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([segment, groupMembers]) => ({
      kind: "group" as const,
      segment,
      prefix: joinEvalPath(dirPrefix, segment),
      children: layoutLevel(groupMembers, joinEvalPath(dirPrefix, segment)),
    }));
  const leafNodes: EvalLayoutNode[] = [...leaves]
    .sort((left, right) => left.localeCompare(right))
    .map((member): EvalLayoutNode => ({ kind: "leaf", evalId: member }));
  return [...groupNodes, ...leafNodes];
}

interface AttemptFact {
  readonly verdict: Verdict | null;
  readonly failureSummary: string | null;
  readonly evaluationKind: "pass" | "points";
  readonly totalScore?: number;
}

interface SlotSelection {
  readonly locator: AttemptLocator;
  readonly experimentId: ExperimentId;
  readonly evalId: EvalId;
  readonly attemptOrdinal: number;
  readonly startedAt: UtcMillis | null;
}

/** 一次 attempt 的闭合失败摘要(只读公开 DomainView,不重算断言展示)。 */
function closedFailureSummary(entry: ClosedAttemptEvidenceEntry | undefined): string | null {
  if (entry === undefined || entry.state !== "available") return null;
  const detail = entry.detail;
  if (detail.verdict === "errored") return detail.outcome;
  if (detail.verdict !== "failed") return null;
  for (const item of detail.entries) {
    const result = item.result;
    if (typeof result !== "object" || result === null || Array.isArray(result)) continue;
    if ((result as Readonly<Record<string, unknown>>).state !== "mismatched") continue;
    const display = item.display;
    if (typeof display === "object" && display !== null && !Array.isArray(display)) {
      const label = (display as Readonly<Record<string, unknown>>).label;
      if (typeof label === "string" && label.length > 0) return label;
    }
    return "assertion";
  }
  return null;
}

async function evidenceFacts(sample: Sample): Promise<ReadonlyMap<AttemptLocator, AttemptFact>> {
  const view = await toAttemptEvidence(sample);
  const facts = new Map<AttemptLocator, AttemptFact>();
  for (const entry of view.entries) {
    const locator = entry.attempt.locator;
    const assertions = entry.state === "available"
      ? entry.detail.entries.map(assertionEntryViewOf).filter((item) => item !== undefined)
      : [];
    const scoreContributions = assertions
      .map((item) => item.result.score)
      .filter((score) => score.state !== "not-scored");
    const completeScore = scoreContributions.length > 0 &&
      scoreContributions.every((score) => score.state === "earned" && score.earned !== undefined)
      ? scoreContributions.reduce((sum, score) => sum + (score.earned ?? 0), 0)
      : undefined;
    facts.set(locator, Object.freeze({
      verdict: entry.state === "available" ? (entry.detail.verdict as Verdict) : null,
      failureSummary: closedFailureSummary(entry),
      evaluationKind: scoreContributions.length > 0 ? "points" : "pass",
      ...(completeScore === undefined ? {} : { totalScore: completeScore }),
    }));
  }
  return facts;
}

async function attemptMetricRows(
  sample: Sample,
  pricing: PricingProfile | null,
): Promise<ReadonlyMap<string, ExperimentMetrics>> {
  const rows = await aggregate(sample, {
    by: { experiment, evalId, attempt },
    values: pricing === null
      ? { passRate, durationMs, tokens }
      : { passRate, durationMs, costUSD: costUSD(pricing), tokens },
  });
  const byKey = new Map<string, ExperimentMetrics>();
  for (const row of rows) {
    if (typeof row.attempt !== "string") continue;
    byKey.set(metricsKey(row.experiment as string, row.evalId as string, row.attempt), Object.freeze({
      passRate: row.passRate,
      durationMs: row.durationMs,
      ...(pricing === null ? {} : { costUSD: (row as unknown as { readonly costUSD: CostMetricValue }).costUSD }),
      tokens: row.tokens,
    }));
  }
  return byKey;
}

function metricsKey(experimentId: string, evalIdValue: string, locator?: string): string {
  return locator === undefined
    ? `${experimentId}\u0000${evalIdValue}`
    : `${experimentId}\u0000${evalIdValue}\u0000${locator}`;
}

/**
 * Included Analysis subjects always have an aggregate row, even when every
 * measure in that row is empty. Treat an omitted row as a broken Analysis
 * contract instead of manufacturing a Report-owned MetricValue.
 */
function requireMetrics(
  metrics: ExperimentMetrics | undefined,
  subject: string,
): ExperimentMetrics {
  if (metrics === undefined) {
    throw new Error(`Analysis aggregate omitted the required ${subject} row.`);
  }
  return metrics;
}

/** 每个 experiment 每道 Eval 一行,按 evalId 升序返回(不重排 attempt 语义)。 */
async function evalMetricRows(
  sample: Sample,
  pricing: PricingProfile | null,
): Promise<ReadonlyMap<string, ExperimentMetrics>> {
  const rows = await aggregate(sample, {
    by: { experiment, evalId },
    values: pricing === null
      ? { passRate, durationMs, tokens }
      : { passRate, durationMs, costUSD: costUSD(pricing), tokens },
  });
  const byKey = new Map<string, ExperimentMetrics>();
  for (const row of rows) {
    byKey.set(metricsKey(row.experiment as string, row.evalId as string), Object.freeze({
      passRate: row.passRate,
      durationMs: row.durationMs,
      ...(pricing === null ? {} : { costUSD: (row as unknown as { readonly costUSD: CostMetricValue }).costUSD }),
      tokens: row.tokens,
    }));
  }
  return byKey;
}

async function experimentMetricRows(
  sample: Sample,
  pricing: PricingProfile | null,
): Promise<ReadonlyMap<ExperimentId, ExperimentMetrics>> {
  const rows = await aggregate(sample, {
    by: { experiment },
    values: pricing === null
      ? { passRate, durationMs, tokens }
      : { passRate, durationMs, costUSD: costUSD(pricing), tokens },
  });
  const byId = new Map<ExperimentId, ExperimentMetrics>();
  for (const row of rows) {
    byId.set(row.experiment as ExperimentId, Object.freeze({
      passRate: row.passRate,
      durationMs: row.durationMs,
      ...(pricing === null ? {} : { costUSD: (row as unknown as { readonly costUSD: CostMetricValue }).costUSD }),
      tokens: row.tokens,
    }));
  }
  return byId;
}

/**
 * 组行读数的 facade 聚合:每个路径段组前缀是一个 GroupFunction 坐标,
 * 分母 / 状态 / Evidence 全部由 Analysis 按 logical slots 计算。
 */
async function groupMetricRows(
  sample: Sample,
  prefixByExperiment: ReadonlyMap<ExperimentId, ReadonlyMap<EvalId, string>>,
  pricing: PricingProfile | null,
): Promise<ReadonlyMap<string, ExperimentMetrics>> {
  const groupPrefix = (subject: AggregationSubject): string =>
    prefixByExperiment.get(subject.experimentId)?.get(subject.evalId) ?? "";
  const rows = await aggregate(sample, {
    by: { experiment, prefix: groupPrefix },
    values: pricing === null
      ? { passRate, durationMs, tokens }
      : { passRate, durationMs, costUSD: costUSD(pricing), tokens },
  });
  const byKey = new Map<string, ExperimentMetrics>();
  for (const row of rows) {
    const prefix = row.prefix;
    if (typeof prefix !== "string" || prefix.length === 0) continue;
    byKey.set(metricsKey(row.experiment as string, prefix), Object.freeze({
      passRate: row.passRate,
      durationMs: row.durationMs,
      ...(pricing === null ? {} : { costUSD: (row as unknown as { readonly costUSD: CostMetricValue }).costUSD }),
      tokens: row.tokens,
    }));
  }
  return byKey;
}

function attemptHref(locator: AttemptLocator): string {
  return libraryDetailRoute(attemptDetailTarget(locator));
}

function experimentHref(experimentId: ExperimentId): string {
  return libraryDetailRoute(experimentDetailTarget(experimentId));
}

/** SampleSnapshot → 每个 experiment 的身份水位(最新 startedAt 的 Run)。 */
function watermarksByExperiment(
  sample: Sample,
): ReadonlyMap<ExperimentId, { readonly startedAt: UtcMillis; readonly agent: string | null; readonly model: string | null; readonly flags: Readonly<Record<string, JsonValue>> | null }> {
  const runsByExperiment = new Map<ExperimentId, typeof sample.snapshot.runs[number][]>();
  for (const run of sample.snapshot.runs) {
    const list = runsByExperiment.get(run.experimentId);
    if (list) list.push(run);
    else runsByExperiment.set(run.experimentId, [run]);
  }
  const byExperiment = new Map<ExperimentId, { readonly startedAt: UtcMillis; readonly agent: string | null; readonly model: string | null; readonly flags: Readonly<Record<string, JsonValue>> | null }>();
  for (const [experimentId, runs] of runsByExperiment) {
    const newest = runs.reduce((best, run) => run.startedAt > best.startedAt ? run : best, runs[0]!);
    const context = newest.context;
    byExperiment.set(experimentId, Object.freeze({
      startedAt: newest.startedAt,
      agent: context?.execution.agentId ?? null,
      model: context?.execution.model ?? null,
      flags: context ? Object.freeze({ ...context.execution.flags }) : null,
    }));
  }
  return byExperiment;
}

function runStartedAtByRunId(sample: Sample): ReadonlyMap<string, UtcMillis> {
  const byRunId = new Map<string, UtcMillis>();
  for (const run of sample.snapshot.runs) byRunId.set(run.runId, run.startedAt);
  return byRunId;
}

/**
 * 按 locator 去重的 included slot 选择:同一 locator 出现多份(跨 Run 携带)时
 * 取 startedAt 最新的一份作展示行。Member 的 action / relation 是 Run provenance，
 * 不在质量列表里折成额外的时效状态。
 */
function selectedSlots(sample: Sample): readonly SlotSelection[] {
  const runStartedAt = runStartedAtByRunId(sample);
  const byLocator = new Map<AttemptLocator, SlotSelection>();
  for (const slot of sample.snapshot.slots) {
    if (slot.state !== "included") continue;
    const locator = slot.attempt.locator;
    const startedAt = runStartedAt.get(slot.runId) ?? null;
    const existing = byLocator.get(locator);
    if (existing === undefined ||
      (startedAt !== null && (existing.startedAt === null || startedAt > existing.startedAt))) {
      byLocator.set(locator, Object.freeze({
        locator,
        experimentId: slot.experimentId,
        evalId: slot.evalId,
        attemptOrdinal: slot.attemptOrdinal,
        startedAt,
      }));
    }
  }
  return Object.freeze([...byLocator.values()]);
}

/**
 * `attemptListData(sample)`:每个 included attempt 一项,顺序取自 Sample 展平顺序
 * (按 locator 去重后保持首次出现序,不重排)。
 */
export async function attemptListData(
  sample: Sample,
  pricing: PricingProfile | null = null,
): Promise<readonly AttemptListItem[]> {
  const [facts, metrics] = await Promise.all([
    evidenceFacts(sample),
    attemptMetricRows(sample, pricing),
  ]);
  const selections = selectedSlots(sample);
  return Object.freeze(selections.map((selection): AttemptListItem => {
    const fact: AttemptFact = facts.get(selection.locator) ?? Object.freeze({
      verdict: null,
      failureSummary: null,
      evaluationKind: "pass" as const,
    });
    const metric = requireMetrics(
      metrics.get(metricsKey(selection.experimentId, selection.evalId, selection.locator)),
      `attempt ${JSON.stringify(selection.locator)}`,
    );
    const item: AttemptListItem = Object.freeze({
      locator: selection.locator,
      experimentId: selection.experimentId,
      evalId: selection.evalId,
      attemptOrdinal: selection.attemptOrdinal,
      verdict: fact.verdict,
      failureSummary: fact.failureSummary,
      evaluationKind: fact.evaluationKind,
      ...(fact.totalScore === undefined ? {} : { totalScore: fact.totalScore }),
      passRate: metric.passRate,
      durationMs: metric.durationMs,
      ...(metric.costUSD === undefined ? {} : { costUSD: metric.costUSD }),
      tokens: metric.tokens,
      startedAt: selection.startedAt,
      href: attemptHref(selection.locator),
    });
    return item;
  }));
}

/**
 * `experimentListData(sample)`:每个 experiment 一项,展开到每道 Eval;初始排序按
 * 这份列表自身的题型构成选择主读数——当前 facade 只有通过制读数,恒为
 * endToEndPassRate 降序(缺数据沉底,同值按 experimentId 字典序收口)。
 */
export async function experimentListData(
  sample: Sample,
  pricing: PricingProfile | null = null,
): Promise<readonly ExperimentListItem[]> {
  const snapshot = sample.snapshot;
  const attempts = await attemptListData(sample, pricing);
  const [experimentMetrics, evalMetrics] = await Promise.all([
    experimentMetricRows(sample, pricing),
    evalMetricRows(sample, pricing),
  ]);

  const attemptsByEval = new Map<string, AttemptListItem[]>();
  for (const item of attempts) {
    const key = metricsKey(item.experimentId, item.evalId);
    const list = attemptsByEval.get(key);
    if (list) list.push(item);
    else attemptsByEval.set(key, [item]);
  }

  const activeSlots = snapshot.slots.filter((slot) => slot.state !== "excluded");
  const experiments = new Map<ExperimentId, { evalIds: Set<EvalId>; included: Set<EvalId> }>();
  for (const slot of activeSlots) {
    const entry = experiments.get(slot.experimentId);
    if (entry === undefined) {
      experiments.set(slot.experimentId, {
        evalIds: new Set([slot.evalId]),
        included: slot.state === "included" ? new Set([slot.evalId]) : new Set(),
      });
      continue;
    }
    entry.evalIds.add(slot.evalId);
    if (slot.state === "included") entry.included.add(slot.evalId);
  }

  // 组前缀布局(纯字符串)与 facade GroupFunction 坐标先于指标聚合固定。
  const prefixByExperiment = new Map<ExperimentId, ReadonlyMap<EvalId, string>>();
  for (const [experimentId, entry] of experiments) {
    const layout = experimentEvalLayout([...entry.evalIds]);
    const prefixFor = new Map<EvalId, string>();
    const walk = (nodes: readonly EvalLayoutNode[]): void => {
      for (const node of nodes) {
        if (node.kind === "leaf") continue;
        for (const evalIdValue of evalIdsUnder(node)) prefixFor.set(evalIdValue, node.prefix);
        walk(node.children);
      }
    };
    walk(layout);
    prefixByExperiment.set(experimentId, prefixFor);
  }
  const hasGroups = [...prefixByExperiment.values()].some((prefixFor) => prefixFor.size > 0);
  const groupMetrics = hasGroups
    ? await groupMetricRows(sample, prefixByExperiment, pricing)
    : new Map<string, ExperimentMetrics>();
  const watermarks = watermarksByExperiment(sample);

  const items: ExperimentListItem[] = [];
  for (const [experimentId, entry] of experiments) {
    const evalIds = [...entry.evalIds];
    const missing = [...evalIds].filter((evalIdValue) => !entry.included.has(evalIdValue));
    const evalRows: ExperimentListEvalRow[] = [];
    for (const evalIdValue of evalIds) {
      if (!entry.included.has(evalIdValue)) continue;
      const list = attemptsByEval.get(metricsKey(experimentId, evalIdValue)) ?? [];
      const sorted = [...list].sort((left, right) =>
        left.attemptOrdinal - right.attemptOrdinal || left.locator.localeCompare(right.locator));
      const metrics = requireMetrics(
        evalMetrics.get(metricsKey(experimentId, evalIdValue)),
        `experiment/eval ${JSON.stringify(experimentId)}/${JSON.stringify(evalIdValue)}`,
      );
      const evaluationKind = sorted.some((attempt) => attempt.evaluationKind === "points") ? "points" : "pass";
      const completeScores = sorted.flatMap((attempt) => attempt.totalScore === undefined ? [] : [attempt.totalScore]);
      evalRows.push(Object.freeze({
        evalId: evalIdValue,
        evaluationKind,
        ...(completeScores.length === 0
          ? {}
          : { totalScore: completeScores.reduce((sum, score) => sum + score, 0) / completeScores.length }),
        endToEndPassRate: metrics.passRate,
        durationMs: metrics.durationMs,
        ...(metrics.costUSD === undefined ? {} : { costUSD: metrics.costUSD }),
        tokens: metrics.tokens,
        attempts: Object.freeze(sorted),
      }));
    }
    const watermark = watermarks.get(experimentId);
    const experimentMetric = requireMetrics(
      experimentMetrics.get(experimentId),
      `experiment ${JSON.stringify(experimentId)}`,
    );
    const groupMetricsForItem = new Map<string, ExperimentMetrics>();
    const prefixes = [...new Set(prefixByExperiment.get(experimentId)?.values() ?? [])];
    for (const prefix of prefixes) {
      const metric = groupMetrics.get(metricsKey(experimentId, prefix));
      if (metric !== undefined) groupMetricsForItem.set(prefix, metric);
    }
    const evaluationKind = evalRows.some((row) => row.evaluationKind === "points")
      ? evalRows.some((row) => row.evaluationKind === "pass") ? "mixed" : "points"
      : "pass";
    const completeEvalScores = evalRows.flatMap((row) => row.totalScore === undefined ? [] : [row.totalScore]);
    items.push(Object.freeze({
      experimentId,
      agent: watermark?.agent ?? null,
      model: watermark?.model ?? null,
      flags: watermark?.flags ?? null,
      evaluationKind,
      ...(completeEvalScores.length === 0
        ? {}
        : { totalScore: completeEvalScores.reduce((sum, score) => sum + score, 0) }),
      endToEndPassRate: experimentMetric.passRate,
      durationMs: experimentMetric.durationMs,
      ...(experimentMetric.costUSD === undefined ? {} : { costUSD: experimentMetric.costUSD }),
      tokens: experimentMetric.tokens,
      missingEvalIds: Object.freeze(missing.sort((left, right) => left.localeCompare(right))),
      groupMetrics: groupMetricsForItem,
      evalRows: Object.freeze(evalRows),
      href: experimentHref(experimentId),
    }));
  }
  const composition = items.some((item) => item.evaluationKind !== "pass")
    ? items.some((item) => item.evaluationKind !== "points") ? "mixed" : "points"
    : "pass";
  items.sort(byMetricDescThenId((item) => composition !== "pass"
    ? item.totalScore ?? null
    : item.endToEndPassRate.value));
  return Object.freeze(items);
}

function evalIdsUnder(node: EvalLayoutNode): readonly EvalId[] {
  if (node.kind === "leaf") return [node.evalId];
  return node.children.flatMap(evalIdsUnder);
}

function byMetricDescThenId(
  valueOf: (item: ExperimentListItem) => number | null,
): (left: ExperimentListItem, right: ExperimentListItem) => number {
  return (left, right) => {
    const leftValue = valueOf(left);
    const rightValue = valueOf(right);
    if (leftValue === null && rightValue === null) {
      return left.experimentId.localeCompare(right.experimentId);
    }
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return rightValue - leftValue || left.experimentId.localeCompare(right.experimentId);
  };
}
