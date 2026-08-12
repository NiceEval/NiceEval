// 内建报告任务函数：Sample / AttemptEvidence / Run -> 可序列化的普通 Result。
//
// 这些函数是内建 page、show text 与 ShowJson 的共同计算锚点。它们只组合已有
// compute / conversion 算法，不返回 ReportNode，也不把公式留在 CLI 私有分支里。

import type { ExecutionTree } from "../o11y/execution-tree.ts";
import type { AttemptEvidence } from "../record/attempt-evidence.ts";
import type { AttemptHandle, Run, Sample } from "../record/types.ts";
import type { AttemptLocator } from "../record/locator.ts";
import type { AttemptIdentity } from "../record/locator.ts";
import type { AssertionsProjectionV1 } from "../assertions/record/model.ts";
import type { ScoreProjectionV1 } from "../eval/record/score.ts";
import type { AttemptSlotProjectedEntry } from "../projection/index.ts";
import type {
  EvalResult,
  CommandExitEvidence,
  PhaseTiming,
  SandboxBuildRecord,
  TimingActivity,
  TraceSpan,
  Verdict,
} from "../types.ts";
import { verdictDisplaySummary } from "../assertions/display.ts";
import {
  aggregate,
  agent,
  costUSD,
  experiment,
  passRate,
  totalScore,
  type EvidenceRow,
  type GroupFunction,
  type MetricValue,
} from "./model/calculation.ts";
import { attemptCostUSD } from "./model/metrics.ts";
import type {
  AttemptAssertionsData,
  AttemptConversationData,
  AttemptDiagnosticsData,
  AttemptDiffData,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptSummaryData,
  AttemptSourceDisplayInput,
  AttemptTraceData,
  DeltaData,
  DimensionInput,
  ExperimentListItem,
  HeroData,
  SampleSummaryContent,
  StabilityMatrixData,
  UsageTableData,
} from "./model/types.ts";
import type { CalloutGroup } from "./definition/primitives/callouts-logic.ts";
import type { CopyBlockContent } from "./definition/primitives/copy-block.tsx";
import {
  attemptAssertionsData,
  attemptConversationData,
  attemptDiagnosticsData,
  attemptDiffData,
  attemptErrorData,
  attemptFixPromptData,
  attemptSummaryData,
  attemptTraceData,
  usageTableData,
} from "./components/attempt-detail/compute.ts";
import { experimentListData } from "./components/entity-lists/compute.ts";
import { sampleSummary } from "./components/summaries/compute.ts";
import { evaluationKindComposition } from "./model/evaluation-kind.ts";
import {
  heroData,
} from "./components/site-components/compute.ts";
import {
  runNoticesContent,
  sampleFixPromptContent,
  sampleNoticesContent,
} from "./components/site-components/projections.ts";
import {
  deltaTableData,
  stabilityMatrixData,
  type DeltaTableOptions,
  type StabilityMatrixOptions,
} from "./slices/compute.ts";

export interface StandardOverviewPoint extends EvidenceRow {
  experiment: string;
  series: string;
  costUSD: MetricValue;
  passRate?: MetricValue;
  totalScore?: MetricValue;
}

export interface StandardOverviewChartResult {
  y: "passRate" | "totalScore";
  series: string;
  connect: boolean;
  points: readonly StandardOverviewPoint[];
}

/** 内建标准首页的一次完整计算；全部字段均为普通可序列化值。 */
export interface StandardOverviewResult {
  hero: HeroData;
  notices: readonly CalloutGroup[];
  diagnostics: readonly CalloutGroup[];
  fixPrompt: CopyBlockContent | null;
  summary: SampleSummaryContent;
  charts: readonly StandardOverviewChartResult[];
  experiments: readonly ExperimentListItem[];
}

export interface ComparisonCoverageResult {
  common: number;
  only: Readonly<Record<string, number>>;
}

/** DeltaData 加上 CLI / page 共用的覆盖摘要，避免 show 私算 common / only。 */
export interface ComparisonResult extends DeltaData {
  coverage: ComparisonCoverageResult;
}

export type ComparisonOptions = DeltaTableOptions;
export type StabilityOptions = StabilityMatrixOptions;
export type StabilityResult = StabilityMatrixData;

/** text / web / JSON 共用的已投影源码任务结果。 */
export interface ProjectedSourceResult<BlobRef = unknown> {
  locator: AttemptLocator;
  source: AttemptSourceDisplayInput<BlobRef> | null;
}

/** One logical slot's declared Assertions, Verdict, and optional Score projections. */
export interface AttemptAssessmentInput<BlobRef = unknown> {
  readonly assertions: AttemptSlotProjectedEntry<AssertionsProjectionV1<BlobRef>>;
  readonly verdict: AttemptSlotProjectedEntry<Verdict>;
  readonly score?: AttemptSlotProjectedEntry<ScoreProjectionV1>;
  readonly sites?: AttemptAssertionsData<BlobRef>["sites"];
}

/** The complete public input required to render one Attempt detail result. */
export interface AttemptDetailsInput<BlobRef = unknown> {
  readonly attempt: AttemptEvidence;
  readonly assessment: AttemptAssessmentInput<BlobRef>;
  readonly source: AttemptSourceDisplayInput<BlobRef> | null;
}

/** execution text 与 AttemptConversation 组件共同所需的普通数据。 */
export interface ConversationResult {
  locator: AttemptLocator;
  experimentId: string;
  identity: AttemptIdentity;
  conversation: AttemptConversationData | null;
  execution: ExecutionTree | null;
  commands: readonly CommandExitEvidence[];
  phases: readonly PhaseTiming[];
  durationMs: number;
}

export interface AttemptTimingResult {
  kind: "attempt";
  locator: AttemptLocator;
  durationMs: number;
  error?: EvalResult["error"];
  phases: readonly PhaseTiming[];
  trace: readonly TraceSpan[] | null;
}

export interface RunTimingBuildResult extends SandboxBuildRecord {
  durationMs?: number;
  dependents?: string[];
}

export interface RunTimingResult {
  kind: "run";
  experimentId: string;
  runId: string;
  startedAt: string;
  timings: readonly TimingActivity[];
  sandboxBuilds: readonly RunTimingBuildResult[];
}

export type TimingResult = AttemptTimingResult | RunTimingResult;

/** identity 字段恒在；没有 usage 事实时其余字段省略。 */
export type UsageResult = UsageTableData;
export type DiffResult = AttemptDiffData | null;

/** AttemptRecord 全字段 + show / history 所需的归属与公共派生。 */
export type HistoryAttemptResult = EvalResult & {
  experimentId: string;
  runStartedAt: string;
  terminal: Verdict;
  summary?: string;
  costUSD: number | null;
};

export interface HistorySectionResult {
  experimentId: string;
  evalId: string;
  attempts: readonly HistoryAttemptResult[];
}

export interface HistoryResult {
  sections: readonly HistorySectionResult[];
}

export interface HistoryOptions {
  evals?: string | readonly string[];
}

export interface AttemptDetailsResult<BlobRef = unknown> {
  summary: AttemptSummaryData;
  error: AttemptErrorData | null;
  assertions: AttemptAssertionsData<BlobRef>;
  source: ProjectedSourceResult<BlobRef>;
  fixPrompt: AttemptFixPromptData | null;
  timing: AttemptTimingResult;
  conversation: ConversationResult;
  diagnostics: AttemptDiagnosticsData | null;
  usage: UsageResult;
  trace: AttemptTraceData | null;
  diff: DiffResult;
}

function lineGroup(sample: Sample): { key: string; group: GroupFunction; connect: boolean } {
  const hasLine = sample.runs.some((run) => run.experiment?.labels?.["line"] !== undefined);
  if (!hasLine) return { key: "agent", group: agent, connect: false };
  const group: GroupFunction = (subject) => {
    const value = subject.run.experiment?.labels?.["line"];
    return value === undefined || value === null ? "(missing)" : String(value);
  };
  Object.defineProperty(group, "name", { value: "line" });
  return { key: "line", group, connect: true };
}

async function overviewChart(
  sample: Sample,
  y: "passRate" | "totalScore",
  series: ReturnType<typeof lineGroup>,
): Promise<StandardOverviewChartResult> {
  const rows = y === "passRate"
    ? await aggregate(sample, {
        by: { experiment, [series.key]: series.group },
        values: { costUSD, passRate },
      })
    : await aggregate(sample, {
        by: { experiment, [series.key]: series.group },
        values: { costUSD, totalScore },
      });
  const points: StandardOverviewPoint[] = rows.map((row) => {
    const common = {
      experiment: row.experiment,
      series: row[series.key]!,
      costUSD: row.costUSD,
      refs: row.refs,
    };
    return y === "passRate"
      ? { ...common, passRate: (row as typeof row & { passRate: MetricValue }).passRate }
      : { ...common, totalScore: (row as typeof row & { totalScore: MetricValue }).totalScore };
  });
  return { y, series: "series", connect: series.connect, points };
}

export async function standardOverviewResult(sample: Sample): Promise<StandardOverviewResult> {
  const series = lineGroup(sample);
  const composition = await evaluationKindComposition(sample);
  const passSample = composition === "mixed"
    ? sample.filter((attempt) => attempt.result.evaluationKind !== "score")
    : sample;
  const pointsSample = composition === "mixed"
    ? sample.filter((attempt) => attempt.result.evaluationKind === "score")
    : sample;
  const chartPromises: Array<Promise<StandardOverviewChartResult>> = [];
  if (composition !== "score") chartPromises.push(overviewChart(passSample, "passRate", series));
  if (composition !== "pass") chartPromises.push(overviewChart(pointsSample, "totalScore", series));
  const [hero, notices, diagnostics, fixPrompt, summary, experiments, charts] = await Promise.all([
    heroData(sample),
    sampleNoticesContent(sample),
    runNoticesContent(sample),
    sampleFixPromptContent(sample),
    sampleSummary(sample),
    experimentListData(sample),
    Promise.all(chartPromises),
  ]);
  return { hero, notices, diagnostics, fixPrompt, summary, charts, experiments };
}

export async function comparisonResult(
  sample: Sample,
  options: ComparisonOptions,
): Promise<ComparisonResult> {
  const data = await deltaTableData(sample, options);
  const common = data.rows.filter((row) =>
    data.conditions.every((condition) => row.cells[condition] !== undefined)
  ).length;
  const only: Record<string, number> = {};
  for (const condition of data.conditions) {
    only[condition] = data.rows.filter((row) =>
      row.cells[condition] !== undefined &&
      data.conditions.every((other) => other === condition || row.cells[other] === undefined)
    ).length;
  }
  return { ...data, coverage: { common, only } };
}

export function stabilityResult(
  sample: Sample | readonly Run[],
  options: StabilityOptions = { by: "experiment" },
): Promise<StabilityResult> {
  return stabilityMatrixData(sample, options);
}

export async function conversationResult(attempt: AttemptEvidence): Promise<ConversationResult> {
  return {
    locator: attempt.locator,
    experimentId: attempt.experimentId,
    identity: attempt.identity,
    conversation: attemptConversationData(attempt),
    execution: attempt.execution,
    commands: attempt.commands ?? [],
    phases: attempt.result.phases ?? [],
    durationMs: attempt.result.durationMs,
  };
}

function findTimingActivityById(
  nodes: readonly TimingActivity[],
  id: string,
): TimingActivity | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findTimingActivityById(node.children ?? [], id);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function timingResult(attempt: AttemptEvidence): Promise<AttemptTimingResult>;
export function timingResult(run: Run): Promise<RunTimingResult>;
export async function timingResult(input: AttemptEvidence | Run): Promise<TimingResult> {
  if ("locator" in input) {
    return {
      kind: "attempt",
      locator: input.locator,
      durationMs: input.result.durationMs,
      ...(input.result.error !== undefined ? { error: input.result.error } : {}),
      phases: input.result.phases ?? [],
      trace: input.trace,
    };
  }
  const timings = input.timings ?? [];
  const sandboxBuilds = (input.sandboxBuilds ?? []).map((build): RunTimingBuildResult => {
    const timing = findTimingActivityById(timings, build.timingNodeId);
    const dependents = input.attempts
      .filter((attempt) => {
        const origin = attempt.result.error?.origin;
        return origin?.scope === "run" && origin.timingNodeId === build.timingNodeId;
      })
      .map((attempt) => attempt.locator ?? `${attempt.evalId}#${attempt.result.attempt}`);
    return {
      ...build,
      ...(timing !== undefined ? { durationMs: timing.durationMs } : {}),
      ...(dependents.length > 0 ? { dependents } : {}),
    };
  });
  return {
    kind: "run",
    experimentId: input.experimentId,
    runId: input.runId,
    startedAt: input.startedAt,
    timings,
    sandboxBuilds,
  };
}

export async function usageResult(attempt: AttemptEvidence): Promise<UsageResult> {
  return usageTableData(attempt) ?? {
    locator: attempt.locator,
    experimentId: attempt.experimentId,
    evalId: attempt.identity.evalId,
    attempt: attempt.identity.attempt,
    terminal: attempt.result.verdict,
    verdict: attempt.result.verdict,
  };
}

export async function diffResult(attempt: AttemptEvidence): Promise<DiffResult> {
  return attemptDiffData(attempt);
}

function historyAttemptKey(attempt: AttemptHandle): string | undefined {
  const startedAt = attempt.result.startedAt;
  return startedAt === undefined
    ? undefined
    : `${attempt.experimentId}\u0000${attempt.evalId}\u0000${attempt.result.attempt}\u0000${startedAt}`;
}

function historySummary(result: EvalResult): string | undefined {
  return verdictDisplaySummary({
    verdict: result.verdict,
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.skipReason === undefined ? {} : { skipReason: result.skipReason }),
  })?.text;
}

function matchesEvalOption(evalId: string, option: HistoryOptions["evals"]): boolean {
  if (option === undefined) return true;
  const prefixes = typeof option === "string" ? [option] : option;
  return prefixes.some((prefix) => evalId.startsWith(prefix));
}

export async function historyResult(
  attempts: readonly AttemptHandle[],
  options: HistoryOptions = {},
): Promise<HistoryResult> {
  const seen = new Set<string>();
  const groups = new Map<string, AttemptHandle[]>();
  for (const attempt of attempts) {
    if (!matchesEvalOption(attempt.evalId, options.evals)) continue;
    const identity = historyAttemptKey(attempt);
    if (identity !== undefined) {
      if (seen.has(identity)) continue;
      seen.add(identity);
    }
    const key = `${attempt.experimentId}\u0000${attempt.evalId}`;
    const group = groups.get(key);
    if (group) group.push(attempt);
    else groups.set(key, [attempt]);
  }
  const sections = [...groups.values()]
    .map((group): HistorySectionResult => {
      group.sort((a, b) => {
        const aStarted = a.result.startedAt;
        const bStarted = b.result.startedAt;
        if (aStarted === undefined && bStarted === undefined) return 0;
        if (aStarted === undefined) return 1;
        if (bStarted === undefined) return -1;
        return aStarted.localeCompare(bStarted);
      });
      const first = group[0]!;
      return {
        experimentId: first.experimentId,
        evalId: first.evalId,
        attempts: group.map((attempt): HistoryAttemptResult => {
          const summary = historySummary(attempt.result);
          return {
            ...attempt.result,
            experimentId: attempt.experimentId,
            runStartedAt: attempt.run.startedAt,
            terminal: attempt.result.verdict,
            ...(summary !== undefined ? { summary } : {}),
            costUSD: attemptCostUSD(attempt.result),
          };
        }),
      };
    })
    .sort((a, b) =>
      a.experimentId.localeCompare(b.experimentId) || a.evalId.localeCompare(b.evalId)
    );
  return { sections };
}

export async function attemptDetailsResult<BlobRef>(
  input: AttemptDetailsInput<BlobRef>,
): Promise<AttemptDetailsResult<BlobRef>> {
  const { attempt } = input;
  const assessment = attemptAssertionsData(input.assessment);
  const [timing, conversation, usage, diff] = await Promise.all([
    timingResult(attempt),
    conversationResult(attempt),
    usageResult(attempt),
    diffResult(attempt),
  ]);
  return {
    summary: attemptSummaryData(attempt, input.assessment.score),
    error: attemptErrorData(attempt),
    assertions: assessment,
    source: { locator: attempt.locator, source: input.source },
    fixPrompt: attemptFixPromptData({
      locator: attempt.locator,
      experimentId: attempt.experimentId,
      identity: attempt.identity,
      assessment,
    }),
    timing,
    conversation,
    diagnostics: attemptDiagnosticsData(attempt),
    usage,
    trace: attemptTraceData(attempt),
    diff,
  };
}
