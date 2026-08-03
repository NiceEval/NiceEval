// 实体 / 提示 / 瀑布等公开转换：Sample 或 AttemptEvidence → 组件所需普通值。
// 契约见 docs/feature/reports/library.md「实体转换」。

import type { AttemptEvidence } from "../../record/attempt-evidence.ts";
import type { AttemptHandle, Sample } from "../../record/types.ts";
import type { CalloutGroup } from "../definition/primitives/callouts-logic.ts";
import type { CopyBlockContent } from "../definition/primitives/copy-block.tsx";
import type { WaterfallContent } from "../definition/primitives/waterfall.tsx";
import type {
  AttemptListItem,
  EvalListItem,
  ExperimentDetailsData,
  ExperimentListItem,
  SampleSummaryContent,
} from "./types.ts";
import { attemptListData, attemptRowsOf, evalListData, experimentListData } from "../components/entity-lists/compute.ts";
import { experimentDetailsData } from "../components/experiment-detail/compute.ts";
import { sampleSummary } from "../components/summaries/compute.ts";
import {
  runNoticesContent,
  sampleFixPromptContent,
  sampleNoticesContent,
  sampleTracesContent,
} from "../components/site-components/projections.ts";
import { heroData } from "../components/site-components/compute.ts";
import type { HeroData } from "./types.ts";
import {
  attemptAssertionsContent,
  attemptCommandEvidenceContent,
  attemptConversationContent,
  attemptDiffContent,
  attemptFixPromptContent,
  attemptNoticesContent,
  projectedSourceContent,
  attemptTimelineContent,
} from "../components/attempt-detail/content.tsx";
import {
  attemptAssertionsData,
  attemptCommandEvidenceData,
  attemptConversationData,
  attemptDiagnosticsData,
  attemptDiffData,
  attemptErrorData,
  attemptFixPromptData,
  attemptSummaryData,
  attemptTimelineData,
  usageTableData,
} from "../components/attempt-detail/compute.ts";

/** Sample 挑选警告 → Callouts items。 */
export function toSampleNotices(sample: Sample): Promise<readonly CalloutGroup[]> {
  return sampleNoticesContent(sample);
}

/** Run diagnostics → Callouts items。 */
export function toRunNotices(sample: Sample): Promise<readonly CalloutGroup[]> {
  return runNoticesContent(sample);
}

/** 失败修复 prompt → CopyBlock 内容；无可复制文本时为 null。 */
export function toSampleFixPrompt(sample: Sample): Promise<CopyBlockContent | null> {
  return sampleFixPromptContent(sample);
}

/** 范围内 attempt 执行时间树 → Waterfall nodes（多行形态）。 */
export function toTraceNodes(sample: Sample): Promise<WaterfallContent> {
  return sampleTracesContent(sample);
}

/** 范围摘要读数（Stat / SampleSummary 用）。 */
export function toSummaryItems(sample: Sample): Promise<SampleSummaryContent> {
  return sampleSummary(sample);
}

/** Hero 卡 meta。 */
export function toHeroData(sample: Sample): Promise<HeroData> {
  return heroData(sample);
}

/** 已选出的 Attempt → 表行。 */
export function toAttemptRows(attempts: readonly AttemptHandle[]): Promise<readonly AttemptListItem[]> {
  return attemptRowsOf(attempts);
}

export function toAttemptListRows(sample: Sample): Promise<readonly AttemptListItem[]> {
  return attemptListData(sample);
}

export function toExperimentRows(sample: Sample): Promise<readonly ExperimentListItem[]> {
  return experimentListData(sample);
}

/**
 * `ExperimentDetails` 的六区块共享转换:`sample` 必须收窄到恰好一个 experiment,否则按
 * 完整用户反馈报错(docs/feature/reports/components/experiment-detail/README.md)。
 */
export function toExperimentDetails(sample: Sample): Promise<ExperimentDetailsData> {
  return experimentDetailsData(sample);
}

export function toEvalRows(sample: Sample): Promise<readonly EvalListItem[]> {
  return evalListData(sample);
}

export async function toAttemptSummary(attempt: AttemptEvidence) {
  return attemptSummaryData(attempt);
}

export async function toAttemptNotices(attempt: AttemptEvidence): Promise<readonly CalloutGroup[]> {
  return attemptNoticesContent(attemptErrorData(attempt), attemptDiagnosticsData(attempt)) ?? [];
}

export async function toConversationTurns(attempt: AttemptEvidence) {
  return attemptConversationContent(attemptConversationData(attempt));
}

export async function toCommandEvidence(attempt: AttemptEvidence) {
  return attemptCommandEvidenceContent(attemptCommandEvidenceData(attempt));
}

export async function toDiffFiles(attempt: AttemptEvidence) {
  return attemptDiffContent(attemptDiffData(attempt));
}

export async function toTimelineNodes(attempt: AttemptEvidence): Promise<WaterfallContent> {
  return (await attemptTimelineContent(attemptTimelineData(attempt))) ?? [];
}

export async function toAttemptSource(attempt: AttemptEvidence) {
  const { annotatedSourceResult } = await import("../tasks.ts");
  const result = await annotatedSourceResult(attempt, { mode: "web" });
  return projectedSourceContent(result.source, result.locator);
}

export async function toAttemptAssertions(attempt: AttemptEvidence) {
  return attemptAssertionsContent(attemptAssertionsData(attempt));
}

export async function toAttemptFixPrompt(attempt: AttemptEvidence): Promise<CopyBlockContent | null> {
  return attemptFixPromptContent(attemptFixPromptData(attempt));
}

export async function toAttemptUsage(attempt: AttemptEvidence) {
  return usageTableData(attempt);
}
