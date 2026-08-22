/** Closed product data to face-neutral site component content. */

import type {
  CopyFixPromptContent,
  CopyFixPromptData,
  SiteCalloutContent,
  SiteCalloutGroup,
  SiteNoticeLevel,
  SiteWarning,
  SnapshotDiagnosticsData,
  TraceWaterfallData,
  WaterfallContent,
} from "./content.ts";
import { groupScopeWarnings } from "./scope-warnings.ts";
import { groupSnapshotDiagnostics } from "./snapshot-diagnostics.ts";
import {
  localeText,
  type ReportLocale,
} from "../../model/locale.ts";

function highestLevel(levels: readonly SiteNoticeLevel[]): SiteNoticeLevel {
  if (levels.includes("error")) return "error";
  if (levels.includes("warning")) return "warning";
  return "info";
}

/** Closed site warnings become render-ready notice groups. */
export function sampleNoticesContent(
  input: readonly SiteWarning[],
  locale: ReportLocale,
): SiteCalloutContent | null {
  if (input.length === 0) return null;
  const grouped = groupScopeWarnings(input, locale);
  const groups: SiteCalloutGroup[] = grouped.groups.map((group) => ({
    title: group.title,
    badges: group.badges.map((badge) => badge.text),
    headCommand: group.headCommand,
    items: group.issues.map((issue) => ({
      level: issue.level,
      message: issue.detail,
      ...(issue.action === null ? {} : { command: issue.action }),
    })),
  }));
  return Object.freeze({
    summary: grouped.summary,
    level: highestLevel(groups.flatMap((group) => group.items.map((item) => item.level))),
    groups: Object.freeze(groups),
    detailsOpen: grouped.detailsOpen,
  });
}

/** Closed Run diagnostics become notice groups; messages are never re-derived. */
export function runNoticesContent(
  input: SnapshotDiagnosticsData,
  locale: ReportLocale,
): SiteCalloutContent | null {
  if (input.length === 0) return null;
  const grouped = groupSnapshotDiagnostics(input, locale);
  const groups: SiteCalloutGroup[] = grouped.groups.map((group) => ({
    title: group.experimentId,
    badges: [],
    headCommand: null,
    items: group.items.flatMap((item) => item.diagnostics.map((diagnostic) => ({
      level: diagnostic.level,
      message: `${item.startedAt} · ${diagnostic.phase}: ${diagnostic.message}`,
    }))),
  }));
  return Object.freeze({
    summary: grouped.summary,
    level: grouped.severity,
    groups: Object.freeze(groups),
    detailsOpen: input.length <= 3,
  });
}

/** A supplied remediation prompt becomes a visible copy block only when non-empty. */
export function sampleFixPromptContent(data: CopyFixPromptData, locale: ReportLocale): CopyFixPromptContent | null {
  if (data.failures === 0 || data.prompt.length === 0) return null;
  return Object.freeze({
    title: localeText(locale, `copyFixPrompt.summary.${data.failures === 1 ? "one" : "other"}`, { n: data.failures }),
    text: data.prompt,
  });
}

/** Closed trace summaries become stable Waterfall rows without opening artifacts. */
export function sampleTracesContent(input: TraceWaterfallData): WaterfallContent {
  return Object.freeze(input.map((row) => Object.freeze({
    key: row.locator,
    label: `${row.experimentId}/${row.evalId}`,
    locator: row.locator,
    durationMs: row.durationMs,
    nodes: Object.freeze(row.spans.map((span, index) => Object.freeze({
      key: `${row.locator}:${index}`,
      label: span.name,
      kind: span.kind,
      startOffsetMs: span.startOffsetMs,
      durationMs: span.durationMs,
      ...(span.failed ? { failed: true } : {}),
    }))),
  })));
}
