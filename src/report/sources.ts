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
import {
  attemptAssertionsContent,
  attemptConversationContent,
  attemptDiagnosticsContent,
  attemptDiffContent,
  attemptFixPromptContent,
  attemptNoticesContent,
  attemptSourceContent,
  attemptTimelineContent,
  attemptTraceContent,
} from "./components/attempt-detail/content.tsx";
import { attemptListData, evalListData, experimentListData } from "./components/entity-lists/compute.ts";
import {
  attemptListContent,
  evalListContent,
  experimentListContent,
} from "./components/entity-lists/content.ts";
import {
  deltaTableData,
  measureRowsData,
  metricMatrixData,
  metricScatterData,
  scoreboardData,
  stabilityMatrixData,
} from "./components/metric-views/compute.ts";
import {
  deltaTableContent,
  metricMatrixContent,
  scoreboardContent,
  stabilityMatrixContent,
} from "./components/metric-views/content.ts";
import { sampleSummary } from "./components/summaries/compute.ts";
import { heroData } from "./components/site-components/compute.ts";
import {
  runNoticesContent,
  sampleFixPromptContent,
  sampleNoticesContent,
  sampleTracesContent,
} from "./components/site-components/projections.ts";
import { defineSource, type Source } from "./source.ts";
import { scatterDataToDataset } from "./model/dataset.ts";

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
    experiments: sampleSource("entity.experiments", async (sample) => experimentListContent(await experimentListData(sample))),
    evals: sampleSource("entity.evals", async (sample) => evalListContent(await evalListData(sample))),
    attempts: sampleSource("entity.attempts", async (sample) => attemptListContent(await attemptListData(sample))),
  },
  measure: {
    rows: (options: Parameters<typeof measureRowsData>[1]) =>
      sampleSource("measure.rows", (sample) => measureRowsData(sample, options)),
    matrix: (options: Parameters<typeof metricMatrixData>[1]) =>
      sampleSource("measure.matrix", async (sample) => metricMatrixContent(await metricMatrixData(sample, options))),
    scoreboard: (options: Parameters<typeof scoreboardData>[1]) =>
      sampleSource("measure.scoreboard", async (sample) => scoreboardContent(await scoreboardData(sample, options))),
    delta: (options: Parameters<typeof deltaTableData>[1]) =>
      sampleSource("measure.delta", async (sample) => deltaTableContent(await deltaTableData(sample, options))),
    stability: (options: Parameters<typeof stabilityMatrixData>[1]) =>
      sampleSource("measure.stability", async (sample) => stabilityMatrixContent(await stabilityMatrixData(sample, options))),
    chart: (options: Parameters<typeof metricScatterData>[1]) =>
      sampleSource("measure.chart", async (sample) => scatterDataToDataset(await metricScatterData(sample, options))),
  },
  sample: {
    snapshot: sampleSource("sample.snapshot", sampleSummary),
    traces: sampleSource("sample.traces", sampleTracesContent),
    notices: sampleSource("sample.notices", sampleNoticesContent),
    fixPrompt: sampleSource("sample.fixPrompt", sampleFixPromptContent),
  },
  site: {
    hero: sampleSource("site.hero", heroData),
  },
  run: {
    diagnostics: sampleSource("run.diagnostics", runNoticesContent),
  },
  attempt: {
    snapshot: attemptSource("attempt.snapshot", attemptSummaryData),
    diagnostics: attemptSource("attempt.diagnostics", (e) => attemptDiagnosticsContent(attemptDiagnosticsData(e)) ?? []),
    assertions: attemptSource("attempt.assertions", (e) => attemptAssertionsContent(attemptAssertionsData(e))),
    source: attemptSource("attempt.source", (e) => attemptSourceContent(attemptSourceData(e))),
    conversation: attemptSource("attempt.conversation", (e) => attemptConversationContent(attemptConversationData(e))),
    timeline: attemptSource("attempt.timeline", (e) => attemptTimelineContent(attemptTimelineData(e))),
    trace: attemptSource("attempt.trace", (e) => attemptTraceContent(attemptTraceData(e))),
    diff: attemptSource("attempt.diff", (e) => attemptDiffContent(attemptDiffData(e))),
    error: attemptSource("attempt.error", attemptErrorData),
    fixPrompt: attemptSource("attempt.fixPrompt", (e) => attemptFixPromptContent(attemptFixPromptData(e))),
    usage: attemptSource("attempt.usage", usageTableData),
    notices: attemptSource("attempt.notices", (e) => attemptNoticesContent(attemptErrorData(e), attemptDiagnosticsData(e)) ?? []),
  },
} as const;
