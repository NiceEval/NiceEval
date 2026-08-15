// Experiment 详情组合件的计算函数（docs/feature/reports/library.md）。
// `experimentDetailsData(sample, experimentId)` 把固定 Sample 上属于该 experiment 的闭合
// rows / DomainView 折成六区块共享的一份普通值；六区块只投影这份结果，不各自取数。组件源码
// 取不到 Record reader、path、AttemptHandle 或 Effect Scope。

import {
  aggregate,
  attemptEvidenceView,
  query,
  type AttemptEvidenceDomainView,
  type CostMetricValue,
  type ExperimentId,
  type JsonValue,
  type MetricValue,
  type PricingProfile,
  type Sample,
  type SampleSnapshot,
} from "../../../analysis/index.ts";
import type { VerdictState } from "../../../eval/record/verdict.ts";
import type { AttemptLocator } from "../../../attempt-locator.ts";
import { experiment } from "../../model/aggregate.ts";
import { durationMs, passRate, tokens, totalCostUSD } from "../../model/metrics.ts";
import { experimentListEvaluationKindComposition } from "../../model/format.ts";
import type { CalloutGroup } from "../../definition/primitives/callouts-logic.ts";
import type { VerdictCounts } from "../../definition/cell.ts";
import {
  assertionEntryViewOf,
  type SealedAssertionEntryView,
} from "../attempt-detail/compute.ts";

export interface ExperimentIdentityView {
  readonly experimentId: ExperimentId;
  readonly agent: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags?: Readonly<Record<string, JsonValue>>;
}

/** 读数摘要:全部是 Analysis 已关闭的 MetricValue,或闭合证据派生的展示值。 */
export interface ExperimentMetricsView {
  readonly passRate?: MetricValue;
  /** 计分制合计挣分(闭合断言 entries 的 earned 求和);通过制省略。 */
  readonly totalScore?: number;
  readonly costUSD?: CostMetricValue;
  readonly tokens?: MetricValue;
  readonly durationMs?: MetricValue;
}

export interface ExperimentAttemptView {
  readonly locator: AttemptLocator;
  readonly attemptOrdinal: number;
  readonly verdict: VerdictState | "unknown";
}

export interface ExperimentEvalView {
  readonly evalId: string;
  readonly verdict: VerdictState | "unknown";
  readonly attempts: readonly ExperimentAttemptView[];
}

export interface ExperimentDetailsView {
  readonly identity: ExperimentIdentityView;
  readonly evaluationKind: "pass" | "points" | "mixed";
  /** 该 experiment 最近一次 selected run 的完成时间(epoch ms);没有 run 时为 null。 */
  readonly lastRunAt: number | null;
  readonly evals: number;
  readonly attempts: number;
  readonly evalVerdicts: VerdictCounts;
  readonly metrics: ExperimentMetricsView;
  /** Eval → Attempt 层级清单,供题目清单表格。 */
  readonly evalsView: readonly ExperimentEvalView[];
  readonly missingEvalIds: readonly string[];
}

export interface ExperimentDetailsData {
  readonly experiment: ExperimentDetailsView;
  readonly catchUpCommand: string | null;
  readonly notices: readonly CalloutGroup[];
  readonly diagnostics: readonly CalloutGroup[];
}

export type ExperimentMetricRow = Awaited<ReturnType<typeof loadExperimentMetrics>>[number];

type IncludedSlot = Extract<SampleSnapshot["slots"][number], { readonly state: "included" }>;
type NotRecordedSlot = Extract<SampleSnapshot["slots"][number], { readonly state: "not-recorded" }>;
type EvidenceEntry = AttemptEvidenceDomainView["entries"][number];

function loadExperimentMetrics(sample: Sample, pricing: PricingProfile | null) {
  return aggregate(sample, {
    by: { experiment },
    values: pricing === null
      ? { passRate, durationMs, tokens }
      : { passRate, durationMs, tokens, totalCostUSD: totalCostUSD(pricing) },
  });
}

/** 一份闭合 evidence entry 的可读 sealed 断言清单(DomainView 边界是 JsonValue)。 */
function sealedEntriesOf(entry: EvidenceEntry | undefined): readonly SealedAssertionEntryView[] {
  if (entry?.state !== "available") return [];
  return entry.detail.entries
    .map(assertionEntryViewOf)
    .filter((sealed): sealed is SealedAssertionEntryView => sealed !== undefined);
}

/** sealed score 状态 → 题型:任一 entry 有非 not-scored 的 score 就是计分制。 */
function evaluationKindOf(entries: readonly SealedAssertionEntryView[]): "pass" | "points" {
  return entries.some((entry) => entry.result.score.state !== "not-scored") ? "points" : "pass";
}

/** 闭合断言 entries 的本轮挣分合计(纯闭合值求和,无分母语义)。 */
function earnedTotalOf(entries: readonly SealedAssertionEntryView[]): number {
  let total = 0;
  for (const entry of entries) {
    const score = entry.result.score;
    if (score.state === "earned" && score.earned !== undefined) total += score.earned;
  }
  return total;
}

function evidenceEntryOf(evidence: AttemptEvidenceDomainView, locator: AttemptLocator): EvidenceEntry | undefined {
  return evidence.entries.find((entry) => entry.attempt.locator === locator);
}

function verdictOf(entry: EvidenceEntry | undefined): VerdictState | "unknown" {
  return entry?.state === "available" ? entry.detail.verdict : "unknown";
}

function experimentSlots(sample: Sample, experimentId: ExperimentId) {
  return sample.snapshot.slots.filter((slot) => slot.state !== "excluded" && slot.experimentId === experimentId);
}

function experimentRuns(sample: Sample, experimentId: ExperimentId) {
  return sample.snapshot.runs.filter((run) => run.experimentId === experimentId);
}

function identityOf(sample: Sample, experimentId: ExperimentId): ExperimentIdentityView {
  const runWithContext = experimentRuns(sample, experimentId).find((run) => run.context !== null);
  const context = runWithContext?.context;
  const model = context?.execution.model;
  const reasoningEffort = context?.execution.reasoningEffort;
  return {
    experimentId,
    agent: context?.execution.agentId ?? "unknown",
    ...(model === null || model === undefined ? {} : { model }),
    ...(reasoningEffort === null || reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(context === undefined || context === null ? {} : { flags: context.execution.flags }),
  };
}

function lastRunAtOf(sample: Sample, experimentId: ExperimentId): number | null {
  const runs = experimentRuns(sample, experimentId);
  if (runs.length === 0) return null;
  return runs.reduce((latest, run) => (run.completedAt > latest ? run.completedAt : latest), runs[0]!.completedAt);
}

function evalsViewOf(
  sample: Sample,
  experimentId: ExperimentId,
  evidence: AttemptEvidenceDomainView,
): ExperimentEvalView[] {
  const slots = experimentSlots(sample, experimentId);
  const byEval = new Map<string, IncludedSlot[]>();
  for (const slot of slots) {
    if (slot.state !== "included") continue;
    const list = byEval.get(slot.evalId) ?? [];
    list.push(slot);
    byEval.set(slot.evalId, list);
  }
  const rows: ExperimentEvalView[] = [];
  for (const [evalId, members] of [...byEval.entries()].sort(([left], [right]) => compareText(left, right))) {
    // 每个 eval 的判定取最高 attempt 序号的那条 included attempt(closed verdict 是
    // terminal fact,不重跑 fold)。
    const attempts = [...members].sort((left, right) => left.attemptOrdinal - right.attemptOrdinal).map((slot) => ({
      locator: slot.attempt.locator,
      attemptOrdinal: slot.attemptOrdinal,
      verdict: verdictOf(evidenceEntryOf(evidence, slot.attempt.locator)),
    }));
    const evalVerdict = attempts.at(-1)?.verdict ?? "unknown";
    rows.push({ evalId, verdict: evalVerdict, attempts });
  }
  return rows;
}

function evalVerdictsOf(evals: readonly ExperimentEvalView[]): VerdictCounts {
  const counts: Record<VerdictState, number> = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const row of evals) {
    if (row.verdict === "unknown") continue;
    counts[row.verdict] += 1;
  }
  return counts;
}

function missingEvalIdsOf(sample: Sample, experimentId: ExperimentId): readonly string[] {
  const ids = new Set<string>();
  for (const slot of experimentSlots(sample, experimentId)) {
    if (slot.state === "not-recorded") ids.add((slot as NotRecordedSlot).evalId);
    if (slot.state === "core-invalid") ids.add(slot.evalId);
  }
  return Object.freeze([...ids].sort(compareText));
}

/** sample 选择问题 + 实验缺口 → notices;Analysis issues → diagnostics。 */
function noticesOf(sample: Sample, experimentId: ExperimentId, evidence: AttemptEvidenceDomainView): readonly CalloutGroup[] {
  const groups: CalloutGroup[] = [];
  for (const problem of sample.snapshot.selection.problems) {
    groups.push({
      title: "Sample selection",
      items: [{ level: "warning", message: `${problem.code}: ${problem.runId}` }],
    });
  }
  const missing = missingEvalIdsOf(sample, experimentId);
  if (missing.length > 0) {
    groups.push({
      title: "Coverage gaps",
      items: [{ level: "warning", message: `${missing.length} eval(s) without an Attempt in this experiment.` }],
    });
  }
  const experimentLocators = new Set(
    experimentSlots(sample, experimentId)
      .filter((slot): slot is IncludedSlot => slot.state === "included")
      .map((slot) => slot.attempt.locator),
  );
  for (const entry of evidence.entries) {
    if (entry.state === "available" || !experimentLocators.has(entry.attempt.locator)) continue;
    groups.push({
      title: "Closed assertion evidence",
      items: [{ level: "warning", message: `${entry.attempt.locator}: entry state ${entry.state}.` }],
    });
  }
  return groups;
}

function diagnosticsOf(
  metrics: readonly ExperimentMetricRow[],
  evidence: AttemptEvidenceDomainView,
  experimentId: ExperimentId,
): readonly CalloutGroup[] {
  const groups: CalloutGroup[] = [];
  const row = metrics.find((entry) => entry.experiment === experimentId);
  const metricIssues = row === undefined
    ? []
    : Object.values(row).flatMap((value) => typeof value === "object" && value !== null &&
      "issues" in value && Array.isArray((value as { issues: unknown }).issues)
      ? (value as { issues: readonly { code: string; message: string }[] }).issues
      : []
    );
  const issues = [...metricIssues, ...evidence.issues];
  if (issues.length === 0) return groups;
  groups.push({
    title: "Analysis issues",
    items: issues.map((issue) => ({ level: "warning" as const, message: `${issue.code}: ${issue.message}` })),
  });
  return groups;
}

/**
 * 收窄目标必须恰好属于当前固定 Sample:不在 sample 里按完整用户反馈报错,不静默取第一个
 * experiment——把调用方的收窄 bug 藏成错数据。
 */
export async function experimentDetailsData(
  sample: Sample,
  experimentId: ExperimentId,
  pricing: PricingProfile | null = null,
): Promise<ExperimentDetailsData> {
  const present = sample.snapshot.slots.some((slot) =>
    slot.state !== "excluded" && slot.experimentId === experimentId
  );
  if (!present) {
    throw new Error(
      `ExperimentDetails received experiment "${experimentId}" which is not a member of the fixed Sample. ` +
        "Pass an experimentId that belongs to the current Sample.",
    );
  }
  const [metrics, evidence] = await Promise.all([
    loadExperimentMetrics(sample, pricing),
    query(sample, { kind: "domain-view", view: attemptEvidenceView }),
  ]);
  const row = metrics.find((entry) => entry.experiment === experimentId);
  const included = experimentSlots(sample, experimentId).filter(
    (slot): slot is IncludedSlot => slot.state === "included",
  );
  const evalsView = evalsViewOf(sample, experimentId, evidence);
  const evidenceById = new Map<string, EvidenceEntry>();
  for (const entry of evidence.entries) evidenceById.set(entry.attempt.locator, entry);
  const kindByEval = new Map<string, "pass" | "points">();
  for (const evalEntry of evalsView) {
    for (const attempt of evalEntry.attempts) {
      const entry = evidenceById.get(attempt.locator);
      if (entry?.state === "available") {
        kindByEval.set(evalEntry.evalId, evaluationKindOf(sealedEntriesOf(entry)));
        break;
      }
    }
  }
  const evaluationKind = experimentListEvaluationKindComposition(
    evalsView.map((entry) => ({ evaluationKind: kindByEval.get(entry.evalId) ?? "pass", attempts: entry.attempts.length })),
  );
  const scored = evalsView.flatMap((entry) => entry.attempts)
    .map((attempt) => evidenceById.get(attempt.locator))
    .reduce((sum, entry) => sum + earnedTotalOf(sealedEntriesOf(entry)), 0);
  const hasPoints = evalsView.some((entry) => kindByEval.get(entry.evalId) === "points");
  const experiment: ExperimentDetailsView = {
    identity: identityOf(sample, experimentId),
    evaluationKind,
    lastRunAt: lastRunAtOf(sample, experimentId),
    evals: evalsView.length,
    attempts: included.length,
    evalVerdicts: evalVerdictsOf(evalsView),
    metrics: {
      ...(row === undefined || evaluationKind === "points" ? {} : { passRate: row.passRate }),
      ...(row === undefined ? {} : {
        ...(pricing === null ? {} : { costUSD: (row as unknown as { readonly totalCostUSD: CostMetricValue }).totalCostUSD }),
        tokens: row.tokens,
        durationMs: row.durationMs,
      }),
      ...(hasPoints ? { totalScore: scored } : {}),
    },
    evalsView,
    missingEvalIds: missingEvalIdsOf(sample, experimentId),
  };
  return {
    experiment,
    catchUpCommand: experiment.missingEvalIds.length > 0 ? `niceeval exp ${experimentId}` : null,
    notices: noticesOf(sample, experimentId, evidence),
    diagnostics: diagnosticsOf(metrics, evidence, experimentId),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
