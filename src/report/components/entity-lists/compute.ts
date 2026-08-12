// 计算函数(*Data):ReportInput → 一份组件数据。实体列表族(ExperimentList / EvalList /
// AttemptList / FailureList)的 *Data 都住在这里(docs/feature/reports/README.md)。
//
// 共同约定(docs/feature/reports/README.md「指标聚合不变量」):
// - 第一参收 ReportInput = Sample | readonly Run[];issues 不进组件数据(宿主统一显示);
// - 聚合前按身份键去重(dedupeAttempts;missing-startedAt 不去重、如实保留、不透出警告);
// - null ≠ 0:缺数据不编数,覆盖率经 samples/total 如实暴露;
// - core 中立:只认 Metric / Dimension 接口,不出现具体 agent 名的分支。

import type {
  AttemptListItem,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
  ReportInput,
  EvaluationKindComposition,
} from "../../model/types.ts";
import type { EvalResult } from "../../../types.ts";
import type { AttemptHandle, Run, SampleMissing } from "../../../record/types.ts";
import { comparabilityConfigOf, deepEqualJson } from "../../../sample/index.ts";
import { foldEvalVerdict } from "../../../shared/verdict.ts";
import {
  collectItems,
  computeCell,
  evalIdOf,
  experimentIdOf,
  fullEvalKey,
  groupItems,
  locatorOf,
  resolveInput,
  type Item,
} from "../../model/aggregate.ts";
import { attemptCostUSD, costUSD, durationMs, passRate, tokens } from "../../model/metrics.ts";
import { summaryText, verdictDisplaySummary } from "../../../assertions/display.ts";
import { firstLine } from "../../../util.ts";
import { summarizeItems } from "../shared-compute.ts";
import { assessmentScoreMetric } from "./score-metric.ts";

/**
 * 一次 attempt 的单行结果摘要(断言摘要契约):failed 取主失败断言摘要(不含
 * "+N more",N 单独进 moreFailures),errored 取结构化 error 的一层摘要
 * (phase · code · message)。没有声明 Assertions assessment 的列表只显示独立
 * Verdict / 结构化执行原因，绝不从已退役的结果壳重建断言细节。
 */
export function failureSummaryOf(result: EvalResult): { summary: string | null; more: number } {
  if (result.verdict === "errored" && result.error !== undefined) {
    // message 取首行:多行 message 的后续行(diagnose 的 output tail)是下钻证据,折进
    // 单行摘要会把 traceback 碎片挤满 Result 单元格;summaryText 只管折行与截断,分层归这里。
    const parts = [(result.error.origin?.scope === "attempt" ? result.error.origin.phase : undefined), result.error.code, firstLine(result.error.message)].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return { summary: summaryText(parts.join(" · ")), more: 0 };
  }
  if (result.verdict === "errored" && result.skipReason !== undefined) return { summary: summaryText(result.skipReason), more: 0 };
  const summary = verdictDisplaySummary({
    verdict: result.verdict,
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.skipReason === undefined ? {} : { skipReason: result.skipReason }),
  });
  return summary === undefined ? { summary: null, more: 0 } : { summary: summary.text, more: summary.more };
}

/** AttemptList / ExperimentList / EvalList 共用的叶子构造:一个 Item → 一个 AttemptListItem。 */
async function attemptListItemOf(item: Item): Promise<AttemptListItem> {
  const result = item.attempt.result;
  const { summary, more } = failureSummaryOf(result);
  return {
    experimentId: experimentIdOf(item),
    evalId: evalIdOf(item),
    attempt: result.attempt,
    agent: result.agent,
    evaluationKind: result.evaluationKind === "score" ? "score" : "pass",
    terminal: result.verdict,
    verdict: result.verdict,
    failureSummary: summary,
    moreFailures: more,
    examScore: await computeCell(assessmentScoreMetric, [item]),
    totalScore: await computeCell(assessmentScoreMetric, [item]),
    tokens: await computeCell(tokens, [item]),
    durationMs: result.durationMs,
    costUSD: attemptCostUSD(result),
    startedAt: result.startedAt ?? item.run.startedAt,
    locator: locatorOf(item),
  };
}

/** 已选出的 AttemptHandle[] → 列表行；顺序保持传入顺序（不再次按 Sample 去重）。 */
export async function attemptRowsOf(attempts: readonly AttemptHandle[]): Promise<AttemptListItem[]> {
  return Promise.all(
    attempts.map((attempt) =>
      attemptListItemOf({ attempt, run: attempt.run, watermark: attempt.run }),
    ),
  );
}

/** `attemptListData(input)`:每个 Attempt 一项,顺序取自 Sample 展平顺序(不重排)。 */
export async function attemptListData(input: ReportInput): Promise<AttemptListItem[]> {
  const { runs, attempts } = resolveInput(input);
  const items = collectItems(runs, attempts);
  return Promise.all(items.map((item) => attemptListItemOf(item)));
}

/** `evalListData(input)`:每个 `experimentId + evalId` 一项,按 evalId 再按 experimentId 升序。 */
export async function evalListData(input: ReportInput): Promise<EvalListItem[]> {
  const { runs, attempts } = resolveInput(input);
  const items = collectItems(runs, attempts);
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = fullEvalKey(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const out: EvalListItem[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.attempt.result.attempt - b.attempt.result.attempt);
    const verdict = foldEvalVerdict(sorted.map((item) => item.attempt.result));
    const attempts = await Promise.all(sorted.map((item) => attemptListItemOf(item)));
    out.push({
      experimentId: experimentIdOf(sorted[0]!),
      evalId: evalIdOf(sorted[0]!),
      verdict,
      examScore: await computeCell(assessmentScoreMetric, sorted),
      totalScore: await computeCell(assessmentScoreMetric, sorted),
      durationMs: await computeCell(durationMs, sorted),
      costUSD: await computeCell(costUSD, sorted),
      attempts,
    });
  }
  out.sort((a, b) => a.evalId.localeCompare(b.evalId) || a.experimentId.localeCompare(b.experimentId));
  return out;
}

/**
 * `experimentListData` 默认排序专用的题型构成判据——列表自己的、只看这份 data 的局部决定,
 * 不是 `evaluationKindComposition()`(那是 Sample 级目标判据,见 measures.md「题型构成与主读数」)的
 * 第二份实现。跳过 attempts === 0 的行:这类行只可能来自 coverage-only 占位(真实 experiment
 * 分组恒 attempts >= 1),它们的 `evaluationKind` 是占位默认值而非读到的事实,一屏占位行不该把纯
 * 计分制列表误判成 mixed。
 */
function listEvaluationKindComposition(items: readonly ExperimentListItem[]): EvaluationKindComposition {
  let hasPass = false;
  let hasPoints = false;
  for (const item of items) {
    if (item.attempts === 0) continue;
    if (item.evaluationKind !== "pass") hasPoints = true;
    if (item.evaluationKind !== "score") hasPass = true;
  }
  if (hasPass && hasPoints) return "mixed";
  return hasPoints ? "score" : "pass";
}

function itemEvaluationKindComposition(items: readonly Item[]): EvaluationKindComposition {
  const hasPoints = items.some((item) => item.attempt.result.evaluationKind === "score");
  const hasPass = items.some((item) => item.attempt.result.evaluationKind !== "score");
  return hasPass && hasPoints ? "mixed" : hasPoints ? "score" : "pass";
}

function passEvaluationItems(items: readonly Item[]): Item[] {
  return items.filter((item) => item.attempt.result.evaluationKind !== "score");
}

/**
 * `ExperimentList` 默认排序的共用比较器形状:按 `valueOf` 降序,null 沉底(含双 null),
 * 同值一律按 experimentId 字典序收口。纯通过制传 `passRate`、纯计分制传 `totalScore`,
 * 复用同一形状而不是各写一份。
 */
function byMetricDescThenId(
  valueOf: (item: ExperimentListItem) => number | null,
): (a: ExperimentListItem, b: ExperimentListItem) => number {
  return (a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va === null && vb === null) return a.experimentId.localeCompare(b.experimentId);
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va || a.experimentId.localeCompare(b.experimentId);
  };
}

/**
 * `experimentListData(input)`:每个 experiment 一项,展开到每道 Eval;初始排序按这份列表
 * 自身的题型构成选择主读数——纯通过制沿用端到端通过率降序,纯计分制改按总分降序(缺数据
 * 沉底,同值按 id 收口);两者都出现时两种读数不能互相排名,退回 experiment id 字典序
 * (measures.md「题型构成与主读数」)。一行只有一套 agent / model / flags 是输入约束:
 * 宿主注入的 current() Sample 保证每个 experiment 只由可比性配置一致的快照拼成;作者自选
 * Run[] 时若同一 experiment 混入不一致的可比性配置,按完整用户反馈失败并指引——
 * 看跨配置演化用 run 维度或 MetricLine,不把两套配置拼成一行冒充单一配置。
 */
export async function experimentListData(input: ReportInput): Promise<ExperimentListItem[]> {
  const { runs, attempts, coverage } = resolveInput(input);
  const coverageByExperiment = new Map(coverage.map((c) => [c.experimentId, c]));

  // 可比性配置单义检查:同一 experiment 的输入快照必须共享一套可比性配置。
  const configByExperiment = new Map<string, { run: Run; config: ReturnType<typeof comparabilityConfigOf> }>();
  for (const run of runs) {
    const config = comparabilityConfigOf(run);
    const existing = configByExperiment.get(run.experimentId);
    if (existing === undefined) {
      configByExperiment.set(run.experimentId, { run, config });
    } else if (!deepEqualJson(existing.config, config)) {
      throw new Error(
        `experimentListData got inconsistent comparability configs for experiment "${run.experimentId}" ` +
          `(runs ${existing.run.startedAt} and ${run.startedAt} differ in agent/model/reasoningEffort/flags/budget/timeoutMs/sandbox). ` +
          "One row shows one configuration — it cannot honestly merge two. To chart evolution across configs, " +
          'use the "run" dimension or MetricLine; to show the current level, pass results.current() which selects a single config per experiment.',
      );
    }
  }

  const items = collectItems(runs, attempts);
  const groups = groupItems(items, "experiment");
  const out: ExperimentListItem[] = [];
  for (const [experimentId, group] of groups) {
    const stats = summarizeItems(group);
    // 这一行显示的 agent/model/flags 读水位基准 Run(贡献来源中 startedAt 最新者),
    // 不是任取某个真实来源(docs/feature/reports/README.md「Sample 是计算入口」)——
    // 组内每个 item 的 watermark 是同一个对象,取任一个即可;优先找真实来源恰好等于水位
    // 基准的 item,好让下面混读的 attempt 级字段(model/evaluationKind 等)也来自同一份数据。
    const watermark = group[0]!.watermark;
    const newest = group.find((item) => item.run === watermark) ?? group[0]!;
    const evalGroups = groupItems(group, "eval");
    const evalRows: ExperimentListEvalRow[] = [];
    for (const [evalId, evalItems] of evalGroups) {
      const sorted = [...evalItems].sort((a, b) => a.attempt.result.attempt - b.attempt.result.attempt);
      const verdict = foldEvalVerdict(sorted.map((item) => item.attempt.result));
      const attempts = await Promise.all(sorted.map((item) => attemptListItemOf(item)));
      evalRows.push({
        evalId,
        evaluationKind: itemEvaluationKindComposition(sorted),
        verdict,
        endToEndPassRate: await computeCell(passRate, passEvaluationItems(sorted)),
        totalScore: await computeCell(assessmentScoreMetric, sorted),
        durationMs: await computeCell(durationMs, sorted),
        costUSD: await computeCell(costUSD, sorted),
        tokens: await computeCell(tokens, sorted),
        attempts,
      });
    }
    const coverageEntry = coverageByExperiment.get(experimentId);
    const target = coverageEntry?.target;
    const experiment = newest.run.experiment ?? newest.attempt.result.experiment;
    const model = target?.model ?? newest.attempt.result.model ?? newest.run.model;
    const targetKinds = new Set(target?.evals.map((entry) => entry.evaluationKind) ?? []);
    const targetComposition: EvaluationKindComposition | undefined = targetKinds.size === 0
      ? undefined
      : targetKinds.size > 1
        ? "mixed"
        : targetKinds.has("score") ? "score" : "pass";
    out.push({
      experimentId,
      agent: target?.agent ?? (newest.run.agent || newest.attempt.result.agent),
      ...(model !== undefined ? { model } : {}),
      ...(target !== undefined ? { flags: target.flags } : experiment?.flags ? { flags: experiment.flags } : {}),
      evaluationKind: targetComposition ?? itemEvaluationKindComposition(group),
      evalVerdicts: stats.verdicts,
      endToEndPassRate: await computeCell(passRate, passEvaluationItems(group)),
      totalScore: await computeCell(assessmentScoreMetric, group),
      costUSD: await computeCell(costUSD, group),
      durationMs: await computeCell(durationMs, group),
      tokens: await computeCell(tokens, group),
      evals: stats.evals,
      attempts: stats.attempts,
      knownEvalIds: coverageEntry?.knownEvalIds ?? [],
      missing: coverageEntry?.missing ?? [],
      lastRunAt: stats.lastRunAt!,
      evalRows,
    });
  }
  // coverage 不是 attempt 的附属品:current() 可能让一个实验当前口径下零 attempt。仍然给它
  // 一行,让 missing 的占位题可达,不能把整实验静默吞掉。
  for (const coverageEntry of coverage) {
    if (groups.has(coverageEntry.experimentId)) continue;
    const emptyItems: Item[] = [];
    const anchor = coverageEntry.run;
    const target = coverageEntry.target;
    if (anchor === undefined && target === undefined) continue;
    const experiment = anchor?.experiment;
    const kinds = new Set(target?.evals.map((entry) => entry.evaluationKind) ?? []);
    const composition: EvaluationKindComposition = kinds.size > 1
      ? "mixed"
      : kinds.has("score") ? "score" : "pass";
    out.push({
      experimentId: coverageEntry.experimentId,
      // 锚点 Run 给出 agent / model / flags：零 attempt 的 Experiment 仍能按配置归组。
      agent: target?.agent ?? anchor!.agent,
      ...((target?.model ?? anchor?.model) !== undefined ? { model: target?.model ?? anchor?.model } : {}),
      ...(target !== undefined ? { flags: target.flags } : experiment?.flags ? { flags: experiment.flags } : {}),
      // SampleCoverage 不携带题型事实(没有 attempt 可读);"pass" 是同一条「占位默认值」
      // 纪律下的默认,不是从任何真实数据推断出来的。
      evaluationKind: composition,
      evalVerdicts: { passed: 0, failed: 0, errored: 0, skipped: 0 },
      endToEndPassRate: await computeCell(passRate, emptyItems),
      totalScore: await computeCell(assessmentScoreMetric, emptyItems),
      costUSD: await computeCell(costUSD, emptyItems),
      durationMs: await computeCell(durationMs, emptyItems),
      tokens: await computeCell(tokens, emptyItems),
      evals: 0,
      attempts: 0,
      knownEvalIds: coverageEntry.knownEvalIds,
      missing: coverageEntry.missing,
      ...(anchor !== undefined ? { lastRunAt: anchor.startedAt } : {}),
      evalRows: [],
    });
  }
  // 默认排序按这份列表自身的题型构成选择主读数(占位行不计入构成判断,见
  // listEvaluationKindComposition):纯通过制沿用端到端通过率降序;纯计分制改按总分降序——
  // endToEndPassRate 对计分制 attempt 同样是良态数字,此前一律拿它预排会把总分列表
  // 悄悄按错误指标排序,这正是本节点要修的 bug。两型并存时两种读数不能互相排名,
  // 退回 experiment id 字典序。
  const composition = listEvaluationKindComposition(out);
  if (composition === "score") {
    out.sort(byMetricDescThenId((item) => item.totalScore.value));
  } else if (composition === "mixed") {
    out.sort((a, b) => a.experimentId.localeCompare(b.experimentId));
  } else {
    out.sort(byMetricDescThenId((item) => item.endToEndPassRate.value));
  }
  return out;
}
