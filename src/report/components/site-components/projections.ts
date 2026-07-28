// 专用件 → 原语 Content 的投影(remaining-gap 1.7)。Source compute 产出原语可直接吃的形状。

import type { ReportInput } from "../../model/types.ts";
import type { CalloutGroup } from "../../definition/primitives/callouts-logic.ts";
import type { CopyBlockContent } from "../../definition/primitives/copy-block.tsx";
import type { WaterfallContent, WaterfallNode } from "../../definition/primitives/waterfall.tsx";
import { groupScopeWarnings } from "./scope-warnings.ts";
import { copyFixPromptData, scopeWarningsData, snapshotDiagnosticsData, traceWaterfallData } from "./compute.ts";
import type { SnapshotDiagnosticsData } from "../../model/types.ts";

/** SampleIssue → CalloutGroup[]（文案在 Source 侧收口；Callouts 只渲染）。 */
export async function sampleNoticesContent(input: ReportInput): Promise<readonly CalloutGroup[]> {
  const issues = await scopeWarningsData(input);
  if (issues.length === 0) return [];
  // Content 携带已解析字符串(LocalizedText 的 string 形态);宿主 locale 切换不改写已烘文案。
  const { groups } = groupScopeWarnings(issues, "en");
  return groups.map((group) => ({
    title: group.title,
    ...(group.headCommand !== null ? { command: group.headCommand } : {}),
    badges: group.badges.map((badge) => badge.text),
    items: group.issues.map((issue) => ({
      level: issue.code === "unreadable-run" ? ("error" as const) : ("warning" as const),
      message: issue.detail,
      ...(issue.action !== null ? { command: issue.action } : {}),
    })),
  }));
}

/** Run diagnostics → CalloutGroup[]。 */
export async function runNoticesContent(input: ReportInput): Promise<readonly CalloutGroup[]> {
  const rows: SnapshotDiagnosticsData = await snapshotDiagnosticsData(input);
  if (rows.length === 0) return [];
  return rows.map((row) => ({
    title: `${row.experimentId} · ${row.startedAt}`,
    items: row.diagnostics.map((d) => ({
      level: d.level === "error" ? ("error" as const) : ("warning" as const),
      message: d.message,
    })),
  }));
}

/** Fix prompt → CopyBlockContent | null。 */
export async function sampleFixPromptContent(input: ReportInput): Promise<CopyBlockContent | null> {
  const data = await copyFixPromptData(input);
  if (data.failures === 0 || !data.prompt) return null;
  return {
    title: `Fix prompt · ${data.failures} failure${data.failures === 1 ? "" : "s"}`,
    text: data.prompt,
  };
}

/** TraceWaterfallRow[] → WaterfallContent。 */
export async function sampleTracesContent(input: ReportInput): Promise<WaterfallContent> {
  const rows = await traceWaterfallData(input);
  return rows.map((row) => {
    const nodes: WaterfallNode[] = row.spans.map((span, i) => ({
      key: `${row.locator}:${i}`,
      label: span.name,
      kind: span.kind,
      startOffsetMs: span.startOffsetMs,
      durationMs: span.durationMs,
      ...(span.failed ? { failed: true } : {}),
    }));
    return {
      key: row.locator,
      // label 是 experimentId/evalId;locator 由行头单独呈现,label 不重复它
      // (docs/feature/reports/components/sources/sample-traces.md)。
      label: `${row.experimentId}/${row.evalId}`,
      durationMs: row.durationMs,
      nodes,
      locator: row.locator,
    };
  });
}
