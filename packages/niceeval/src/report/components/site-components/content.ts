/**
 * Closed values consumed by the Report site-display components.
 *
 * These declarations deliberately contain only ordinary data.  A page or an
 * Analysis facade is responsible for producing them while its Sample is live;
 * this directory only formats the values afterwards.
 */

import type { LocalizedText } from "../../model/locale.ts";

/** The small, closed run summary shown by the report hero. */
export interface HeroData {
  /** Latest contributing Run start time, or null when there was no Run. */
  readonly latestStartedAt: string | null;
  /** Number of Runs that contributed to the displayed report revision. */
  readonly runs: number;
}

export type SiteNoticeLevel = "info" | "warning" | "error";

/** One display-safe notice supplied by an upstream closed projection. */
export interface SiteWarning {
  readonly code: string;
  readonly message: LocalizedText;
  readonly level?: SiteNoticeLevel;
  /** An already-renderable command.  It is never executed by a component. */
  readonly action?: string | null;
  /** Optional grouping fact; it is not an identity capability. */
  readonly experimentId?: string;
  /** Optional display label for an otherwise opaque warning code. */
  readonly title?: LocalizedText;
  /** Optional short marker shown alongside a group heading. */
  readonly badge?: LocalizedText;
}

/** A diagnostic has already been reduced to a display-safe message. */
export interface ClosedDiagnostic {
  readonly code: string;
  readonly level: "warning" | "error";
  readonly message: string;
  readonly phase: string;
  /** Collapsed occurrences; omission means one occurrence. */
  readonly count?: number;
}

/** One closed Run diagnostic bundle. */
export interface SnapshotDiagnosticsItem {
  readonly experimentId: string;
  readonly startedAt: string;
  readonly diagnostics: readonly ClosedDiagnostic[];
}

export type SnapshotDiagnosticsData = readonly SnapshotDiagnosticsItem[];

/** A ready-to-copy remediation prompt and the already-counted failures behind it. */
export interface CopyFixPromptData {
  readonly prompt: string;
  readonly failures: number;
}

/** A closed failure fact used only when building a remediation prompt upstream. */
export interface ClosedFailureSummary {
  readonly experimentId: string;
  readonly evalId: string;
  readonly locator: string;
  readonly verdict: "failed" | "errored";
  readonly failureSummary?: string | null;
  readonly moreFailures?: number;
}

/** A closed visual interval in one attempt's already-captured trace summary. */
export interface TraceSpanSummary {
  readonly name: string;
  readonly kind: "agent" | "model" | "tool" | "other";
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly failed: boolean;
}

/** A closed trace row.  There is no trace handle or lazy artifact here. */
export interface TraceWaterfallRow {
  readonly experimentId: string;
  readonly evalId: string;
  readonly locator: string;
  readonly durationMs: number | null;
  readonly spans: readonly TraceSpanSummary[];
}

export type TraceWaterfallData = readonly TraceWaterfallRow[];

/** A face-neutral projection for grouped notices. */
export interface SiteCalloutItem {
  readonly level: SiteNoticeLevel;
  readonly message: string;
  readonly command?: string;
}

export interface SiteCalloutGroup {
  readonly title: string;
  readonly badges: readonly string[];
  readonly headCommand: string | null;
  readonly items: readonly SiteCalloutItem[];
}

export interface SiteCalloutContent {
  readonly summary: string;
  readonly level: SiteNoticeLevel;
  readonly groups: readonly SiteCalloutGroup[];
  readonly detailsOpen: boolean;
}

/** The closed copy block consumed by the fix-prompt face. */
export interface CopyFixPromptContent {
  readonly title: string;
  readonly text: string;
}

/** The display-safe input for a generic waterfall face. */
export interface WaterfallNodeContent {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly startOffsetMs: number;
  readonly durationMs: number | null;
  readonly failed?: boolean;
}

export interface WaterfallRowContent {
  readonly key: string;
  readonly label: string;
  readonly durationMs: number | null;
  readonly locator: string;
  readonly nodes: readonly WaterfallNodeContent[];
}

export type WaterfallContent = readonly WaterfallRowContent[];

export {
  runNoticesContent,
  sampleFixPromptContent,
  sampleNoticesContent,
  sampleTracesContent,
} from "./projections.ts";
