import type { AttemptEvidence } from "../record/attempt-evidence.ts";
import type { Sample } from "../record/types.ts";
import {
  attemptAssertionsData,
  attemptConversationData,
  attemptDiagnosticsData,
  attemptDiffData,
  attemptErrorData,
  attemptFixPromptData,
  attemptSourceData,
  attemptSummaryData,
  attemptTimelineData,
  attemptTraceData,
  usageTableData,
} from "./components/attempt-detail/compute.ts";
import { attemptListData, evalListData, experimentListData } from "./components/entity-lists/compute.ts";
import {
  deltaTableData,
  metricMatrixData,
  metricScatterData,
  metricTableData,
  scoreboardData,
  stabilityMatrixData,
} from "./components/metric-views/compute.ts";
import { sampleSummary } from "./components/summaries/compute.ts";
import {
  copyFixPromptData,
  scopeWarningsData,
  snapshotDiagnosticsData,
  traceWaterfallData,
} from "./components/site-components/compute.ts";
import { defineSource, type Source } from "./source.ts";

function sampleSource<Content>(name: string, compute: (sample: Sample) => Content | Promise<Content>): Source<Sample, Content> {
  return defineSource({ name, compute: async (sample) => compute(sample) });
}

function attemptSource<Content>(
  name: string,
  compute: (evidence: AttemptEvidence) => Content | Promise<Content>,
): Source<AttemptEvidence, Content> {
  return defineSource({ name, compute: async (evidence) => compute(evidence) });
}

/** 官方查询层。工厂每次调用生成一个独立 Source，因而缓存边界完全由对象身份决定。 */
export const sources = {
  entity: {
    experiments: sampleSource("entity.experiments", experimentListData),
    evals: sampleSource("entity.evals", evalListData),
    attempts: sampleSource("entity.attempts", attemptListData),
  },
  measure: {
    rows: (options: Parameters<typeof metricTableData>[1]) =>
      sampleSource("measure.rows", (sample) => metricTableData(sample, options)),
    matrix: (options: Parameters<typeof metricMatrixData>[1]) =>
      sampleSource("measure.matrix", (sample) => metricMatrixData(sample, options)),
    scoreboard: (options: Parameters<typeof scoreboardData>[1]) =>
      sampleSource("measure.scoreboard", (sample) => scoreboardData(sample, options)),
    delta: (options: Parameters<typeof deltaTableData>[1]) =>
      sampleSource("measure.delta", (sample) => deltaTableData(sample, options)),
    stability: (options: Parameters<typeof stabilityMatrixData>[1]) =>
      sampleSource("measure.stability", (sample) => stabilityMatrixData(sample, options)),
    chart: (options: Parameters<typeof metricScatterData>[1]) =>
      sampleSource("measure.chart", (sample) => metricScatterData(sample, options)),
  },
  sample: {
    snapshot: sampleSource("sample.snapshot", sampleSummary),
    traces: sampleSource("sample.traces", traceWaterfallData),
    notices: sampleSource("sample.notices", scopeWarningsData),
    fixPrompt: sampleSource("sample.fixPrompt", copyFixPromptData),
  },
  run: {
    diagnostics: sampleSource("run.diagnostics", snapshotDiagnosticsData),
  },
  attempt: {
    snapshot: attemptSource("attempt.snapshot", attemptSummaryData),
    diagnostics: attemptSource("attempt.diagnostics", attemptDiagnosticsData),
    assertions: attemptSource("attempt.assertions", attemptAssertionsData),
    source: attemptSource("attempt.source", attemptSourceData),
    conversation: attemptSource("attempt.conversation", attemptConversationData),
    timeline: attemptSource("attempt.timeline", attemptTimelineData),
    trace: attemptSource("attempt.trace", attemptTraceData),
    diff: attemptSource("attempt.diff", attemptDiffData),
    error: attemptSource("attempt.error", attemptErrorData),
    fixPrompt: attemptSource("attempt.fixPrompt", attemptFixPromptData),
    usage: attemptSource("attempt.usage", usageTableData),
  },
} as const;
