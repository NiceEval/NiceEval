// 计算函数(*Data):ReportInput → 一份组件数据。站点组件族(Hero / ScopeWarnings /
// CopyFixPrompt / TraceWaterfall)的 *Data 都住在这里
// (docs/feature/reports/components/site/README.md)。
//
// 共同约定(docs/feature/reports/architecture.md「指标聚合不变量」):
// - 第一参收 ReportInput = Sample | readonly Run[];issues 不进组件数据(宿主统一显示);
// - null ≠ 0:缺数据不编数。

import type {
  CopyFixPromptData,
  HeroData,
  ReportInput,
  SampleIssue,
  SnapshotDiagnosticsData,
  TraceSpanSummary,
  TraceWaterfallRow,
} from "../../model/types.ts";
import type { TraceSpan } from "../../../types.ts";
import { collectItems, evalIdOf, experimentIdOf, locatorOf, resolveInput } from "../../model/aggregate.ts";
import { attemptListData } from "../entity-lists/compute.ts";

// ───────────────────────── 站点组件的计算函数(hero / issues / fix prompt / trace)─────────────────────────

/**
 * `heroData(input)`:站点标题区的运行 meta——`latestStartedAt` 取范围内最新快照的开始时间
 * (空范围为 null,不编造当前时间),`runs` 计贡献当前水位的快照数
 * (docs/feature/reports/components/site/hero-card.md)。
 */
export async function heroData(input: ReportInput): Promise<HeroData> {
  const { runs } = resolveInput(input);
  let latest: string | null = null;
  for (const run of runs) {
    if (latest === null || run.startedAt > latest) latest = run.startedAt;
  }
  return { latestStartedAt: latest, runs: runs.length };
}

/**
 * `scopeWarningsData(input)`:Sample 携带的挑选警告原样透出;`input` 是裸 `Run[]` 时
 * 没有挑选过程、没有警告,返回空数组,也如实
 * (docs/feature/reports/components/summaries/sample-notices.md)。
 */
export async function scopeWarningsData(input: ReportInput): Promise<readonly SampleIssue[]> {
  return resolveInput(input).issues;
}

/**
 * `snapshotDiagnosticsData(input)`:只投影 diagnostics 非空的真实 Run,不携带 `evals` 或
 * `AttemptHandle`,不跨快照合并;按 experiment id 字典序排列,同一实验内按 startedAt 从新到旧
 * (docs/feature/reports/components/sources/run-diagnostics.md)。
 */
export async function snapshotDiagnosticsData(input: ReportInput): Promise<SnapshotDiagnosticsData> {
  const { runs } = resolveInput(input);
  return runs
    .filter((s) => s.diagnostics !== undefined && s.diagnostics.length > 0)
    .map((s) => ({ experimentId: s.experimentId, startedAt: s.startedAt, diagnostics: s.diagnostics! }))
    .sort((a, b) => a.experimentId.localeCompare(b.experimentId) || b.startedAt.localeCompare(a.startedAt));
}

/**
 * `copyFixPromptData(input)`:把范围内全部失败(verdict 为 failed / errored 的 attempt)
 * 整理成一段可交给 coding agent 的修复 prompt——逐失败含 eval id、主失败摘要与 attempt
 * 下钻命令(`niceeval show @<locator>`)。prompt 面向 agent,固定英文
 * (docs/feature/reports/components/summaries/sample-fix-prompt.md)。
 */
export async function copyFixPromptData(input: ReportInput): Promise<CopyFixPromptData> {
  const items = await attemptListData(input);
  const failures = items.filter((item) => item.verdict === "failed" || item.verdict === "errored");
  if (failures.length === 0) return { prompt: "", failures: 0 };
  const lines = failures
    .map((item, i) => {
      const reason =
        item.failureSummary === null
          ? null
          : item.moreFailures > 0
            ? `${item.failureSummary} (+${item.moreFailures} more failures)`
            : item.failureSummary;
      return [
        `${i + 1}. eval "${item.evalId}" [experiment ${item.experimentId}] — ${item.verdict}`,
        reason ? `   reason: ${reason}` : null,
        `   inspect: niceeval show ${item.locator}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  const experiments = [...new Set(failures.map((item) => item.experimentId))].join(" / ");
  const prompt = [
    "Fix the failing evals from this niceeval run.",
    "",
    "## Failures",
    lines,
    "",
    "## Steps",
    "1. niceeval is NOT in your training data. Read the relevant guide in `node_modules/niceeval/docs-site/` (English at the top level, Chinese under `zh/`) before changing anything.",
    "2. For each failure, run its inspect command above to see the verdict and assertions; add `--execution` for the full agent transcript (tool calls included), `--timing` for the execution timeline, and `--diff` for the workspace diff.",
    "3. Decide which side the defect is on: the program under test, or the eval itself (over-tight assertion, wrong fixture, missing setup). Fix that side; do not weaken assertions just to turn the run green.",
    `4. Re-run: \`npx niceeval exp ${experiments || "<experiment>"} <eval-id-prefix>\`. Already-passing evals are unreadable by the fingerprint cache; pass \`--rerun all\` to re-run everything.`,
    "5. Run `npx niceeval show` and confirm these failures are gone.",
  ].join("\n");
  return { prompt, failures: failures.length };
}

/** TraceSpan 的语义角色 → 瀑布摘要的 kind:turn 归入 agent(一轮就是一次 agent 调用),未识别落 other。 */
function waterfallKindOf(kind: TraceSpan["kind"]): TraceSpanSummary["kind"] {
  switch (kind) {
    case "agent":
    case "turn":
      return "agent";
    case "model":
      return "model";
    case "tool":
      return "tool";
    default:
      return "other";
  }
}

/**
 * `traceWaterfallData(input)`:每个 attempt 一行的执行时间瀑布摘要。span 事实只来自
 * trace artifact(经 AttemptHandle 懒加载的 canonical OTel span);runner 生命周期节点
 * (`result.phases`)不进瀑布。行内只汇总顶层 span(parentSpanId 缺失或不在本 trace 内),
 * 按 startOffsetMs 升序;trace 缺失或为空时 `durationMs` 为 null、行照常出现
 * (docs/feature/reports/components/sources/sample-traces.md)。
 */
export async function traceWaterfallData(input: ReportInput): Promise<readonly TraceWaterfallRow[]> {
  const { runs, attempts } = resolveInput(input);
  const items = collectItems(runs, attempts);
  return Promise.all(
    items.map(async (item): Promise<TraceWaterfallRow> => {
      const spans = await item.attempt.trace();
      if (spans === null || spans.length === 0) {
        return {
          experimentId: experimentIdOf(item),
          evalId: evalIdOf(item),
          locator: locatorOf(item),
          durationMs: null,
          spans: [],
        };
      }
      const t0 = Math.min(...spans.map((s) => s.startMs));
      const t1 = Math.max(...spans.map((s) => s.endMs));
      const ids = new Set(spans.map((s) => s.spanId));
      const topLevel = spans.filter((s) => s.parentSpanId === undefined || !ids.has(s.parentSpanId));
      const summaries = topLevel
        .map(
          (s): TraceSpanSummary => ({
            name: s.name,
            kind: waterfallKindOf(s.kind),
            startOffsetMs: s.startMs - t0,
            durationMs: s.endMs - s.startMs,
            failed: s.status === "error",
          }),
        )
        .sort((a, b) => a.startOffsetMs - b.startOffsetMs);
      return {
        experimentId: experimentIdOf(item),
        evalId: evalIdOf(item),
        locator: locatorOf(item),
        durationMs: Math.max(0, t1 - t0),
        spans: summaries,
      };
    }),
  );
}
