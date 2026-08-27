import type { AssertionEvidenceContent } from "../../definition/primitives/assertion-evidence.tsx";
import type { CalloutGroup } from "../../definition/primitives/callouts-logic.ts";
import type {
  CommandEvidenceContent,
  ConversationContent,
} from "../../definition/primitives/conversation.tsx";
import type { CopyBlockContent } from "../../definition/primitives/copy-block.tsx";
import type { DiffContent } from "../../definition/primitives/diff-lines.ts";
import type { SourceContent } from "../../definition/primitives/source-view.tsx";
import type {
  ClosedAssertionFactValue,
  ClosedJsonValue,
} from "../../definition/primitives/shared.ts";
import type { WaterfallContent } from "../../definition/primitives/waterfall.tsx";

export interface EvidenceLimitation {
  readonly code: string;
  readonly summary: string;
}

export type ClosedEvidenceSlice<Data> =
  | { readonly state: "available"; readonly data: Data }
  | {
      readonly state: "partial";
      readonly data: Data;
      readonly limitations: readonly EvidenceLimitation[];
    }
  | {
      readonly state: "not-recorded" | "unavailable";
      readonly limitations: readonly EvidenceLimitation[];
    };

export interface AttemptIdentityView {
  readonly runId: string;
  readonly evalId: string;
  /** Zero-based, matching the retained Attempt identity. */
  readonly attempt: number;
}

export interface AttemptCapabilitiesView {
  readonly source: boolean;
  readonly execution: boolean;
  readonly timing: boolean;
  readonly diff: boolean;
}

export interface AttemptSummaryData {
  readonly experimentId: string;
  readonly identity: AttemptIdentityView;
  readonly verdict: import("../../../../../../shared/types.ts").ProjectedVerdict;
  readonly startedAt?: string;
  readonly durationMs: number | null;
  readonly observedCostUSD?: number;
  readonly capabilities: AttemptCapabilitiesView;
  readonly totalScore?: number;
}

export type AssertionDecisionState =
  | "matched"
  | "mismatched"
  | "unavailable"
  | "errored"
  | "not-applicable";

/** Source site exactly as retained by Inspection assertion detail. */
export interface AttemptInspectionAssertionSourceSite {
  readonly entryId: string;
  readonly sourceOrder: number;
  readonly role: string;
  readonly source: ClosedJsonValue;
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

/**
 * Page-closed source binding. The exact site remains intact and the canonical
 * source identity is either supplied explicitly or explicitly unavailable.
 */
export interface AttemptAssertionSourceSite extends AttemptInspectionAssertionSourceSite {
  readonly target:
    | { readonly state: "exact"; readonly sourceItemId: string; readonly sha256: string }
    | { readonly state: "unavailable"; readonly reason: string };
}

export interface AttemptAssertionDiagnosticNode {
  readonly label: string;
  readonly state: string;
  readonly expected: ClosedJsonValue;
  readonly observed: ClosedJsonValue;
  readonly reason: string | null;
  readonly anchor: ClosedJsonValue;
  readonly children: readonly AttemptAssertionDiagnosticNode[];
}

export interface AttemptMatcherTarget {
  readonly state: string;
  readonly anchor:
    | { readonly kind: "tool-occurrence"; readonly toolOccurrenceId: string }
    | { readonly kind: "event"; readonly eventId: string };
  readonly difference: ClosedJsonValue;
  /** Anchor string shared with the trace DOM, supplied by the page assembler. */
  readonly conversationAnchor?: string;
}

export type AttemptCommandMatch =
  | { readonly state: "matched"; readonly commandId: string }
  | { readonly state: "unavailable"; readonly reason: string };

export interface AttemptMatcherDetail {
  readonly state: "ordinary" | "legacy" | "available" | "missing";
  readonly sourceState: string | null;
  readonly comparator: ClosedJsonValue;
  readonly sourceLedger: ClosedJsonValue;
  readonly receipt: ClosedJsonValue;
  readonly result: ClosedJsonValue;
  readonly targets: readonly AttemptMatcherTarget[];
  readonly sandboxCommandJoin: AttemptCommandMatch;
  readonly commandMatch: AttemptCommandMatch;
  readonly reason?: string;
}

export interface AttemptClosedAssertionEntry {
  readonly format: "niceeval.inspection.assertion-detail/v1";
  readonly entryId: string;
  readonly display: {
    readonly key?: string;
    readonly label?: string;
    readonly groupPath: readonly string[];
  };
  readonly entry: ClosedJsonValue;
  readonly sourceSites: readonly AttemptInspectionAssertionSourceSite[];
  readonly check: AttemptAssertionDiagnosticNode;
  readonly matcher: AttemptMatcherDetail;
}

export interface AttemptAssertionDecision {
  readonly result: AssertionDecisionState;
  readonly observed: ClosedAssertionFactValue;
  readonly expected: ClosedAssertionFactValue;
  readonly diagnosticTree: ClosedAssertionFactValue;
  readonly reason?: string;
}

export interface AttemptAssertionDisplay {
  readonly name: string;
  readonly severity: "gate" | "recorded" | "scored";
  readonly outcome: "passed" | "failed" | "unavailable";
  readonly groupPath: readonly string[];
  readonly detail: string;
}

export interface AttemptScoreView {
  readonly state: "earned" | "unavailable";
  readonly points: number;
  readonly earned?: number;
}

/**
 * Full closed assertion entry. The renderer keeps the original check,
 * decision diagnostic tree, display projection, and exact source identities.
 */
export interface AttemptAssertionView {
  readonly entryId: string;
  /** Full closed detail from the canonical assertion selection. */
  readonly closed: AttemptClosedAssertionEntry;
  readonly display: AttemptAssertionDisplay;
  readonly sourceSites: readonly AttemptAssertionSourceSite[];
  readonly check: ClosedAssertionFactValue;
  readonly decision: AttemptAssertionDecision;
  readonly evidence: AssertionEvidenceContent;
  readonly score?: AttemptScoreView;
  /** Additional current Inspection fields retained without interpretation. */
  readonly retained?: Readonly<Record<string, ClosedJsonValue>>;
}

export interface AttemptAssertionsData {
  readonly attention: readonly AttemptAssertionView[];
  readonly passedGroups: readonly {
    readonly group: string;
    readonly items: readonly AttemptAssertionView[];
  }[];
  readonly scorePointsEarned?: { readonly earned: number; readonly total: number };
  readonly totalScore?: number;
  readonly evaluationKind: "pass" | "points";
}

export interface AttemptDiagnosticView {
  readonly diagnosticId: string;
  readonly code: string;
  readonly kind: string;
  readonly phase: string;
  readonly summary: string;
  readonly level: "warning" | "error";
  readonly causes: readonly { readonly code: string; readonly summary: string }[];
  readonly redaction:
    | { readonly state: "none" }
    | { readonly state: "applied"; readonly replacements: number };
  readonly sourceFrame?: ClosedJsonValue;
}

export interface AttemptDiagnosticsData {
  readonly groups: readonly {
    readonly phase: string;
    readonly items: readonly AttemptDiagnosticView[];
  }[];
}

export type AttemptUsageObservation =
  | {
      readonly kind: "token-bucket";
      readonly usageObservationId: string;
      readonly turnId: string;
      readonly provider: string;
      readonly bucket: string;
      readonly tokens: number;
    }
  | {
      readonly kind: "request";
      readonly usageObservationId: string;
      readonly turnId: string;
      readonly provider: string;
      readonly requestKind: string;
    }
  | {
      readonly kind: "provider-cost";
      readonly usageObservationId: string;
      readonly turnId: string;
      readonly provider: string;
      readonly amount: string;
      readonly currency: string;
    };

export interface UsageTableData {
  readonly turns?: number;
  readonly toolCalls?: number;
  readonly observations: readonly AttemptUsageObservation[];
  readonly observedCostUSD?: number;
}

/** One canonical locator and all already-closed evidence consumed by the page. */
export interface AttemptDetailsData {
  readonly locator: string;
  readonly summary: AttemptSummaryData;
  readonly notices: readonly CalloutGroup[];
  readonly assertions: ClosedEvidenceSlice<AttemptAssertionsData>;
  readonly source: ClosedEvidenceSlice<SourceContent>;
  readonly fixPrompt: CopyBlockContent | null;
  readonly timeline: ClosedEvidenceSlice<WaterfallContent>;
  readonly usage: ClosedEvidenceSlice<UsageTableData>;
  readonly conversation: ClosedEvidenceSlice<ConversationContent>;
  readonly commands: ClosedEvidenceSlice<CommandEvidenceContent>;
  readonly diagnostics: ClosedEvidenceSlice<AttemptDiagnosticsData>;
  readonly diff: ClosedEvidenceSlice<DiffContent>;
}
