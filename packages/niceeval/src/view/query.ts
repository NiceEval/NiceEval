import type { AttemptOutcome } from "../record/model/core.ts";
import type { Verdict } from "../shared/types.ts";

/** Current first-party View query results. These are compile-time business types, not a persisted wire format. */
export type AssertionState = "matched" | "mismatched" | "unavailable" | "errored" | "not-applicable";
export type CollectionState = "complete" | "partial" | "not-recorded";
export type CoverageStatus = "complete" | "partial" | "unavailable";
export type MembershipAction = "executed" | "carried" | "accepted" | "not-dispatched" | "interrupted";
export type PresenceState = "recorded" | "not-recorded";
export type ContentState = "available" | "unavailable" | "omitted" | "truncated";

export interface FamilyStatusResult {
  readonly state: CollectionState | PresenceState;
  readonly limitations: readonly { readonly code: string; readonly summary: string }[];
}

export interface AssertionResult {
  readonly id: string;
  readonly label: string;
  readonly state: AssertionState;
  readonly criterionState: "available" | "not-recorded";
  readonly coverageState: "complete" | "partial" | "unavailable";
  readonly contributionState: "not-scored" | "earned" | "unavailable";
  readonly limitations: readonly { readonly kind: string; readonly summary: string }[];
  readonly points?: number;
  readonly earned?: number;
  readonly observed?: string;
  readonly threshold?: number;
}

export interface SourceResult {
  readonly id: string;
  readonly path: string;
  readonly state: ContentState;
  readonly sha256: string;
  readonly text?: string;
  readonly reason?: string;
  readonly retainedBytes?: number;
  readonly totalBytes?: number;
}

export interface TrajectoryItemResult {
  readonly id: string;
  readonly kind: string;
  readonly state: "recorded" | "unavailable";
  readonly role?: string;
  readonly text: string;
  readonly tool?: string;
  readonly input?: string;
  readonly output?: string;
  readonly reason?: string;
}

export interface TurnResult {
  readonly id: string;
  readonly sequence: number;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted";
  readonly items: readonly TrajectoryItemResult[];
}

export interface CoverageResult {
  readonly channel: "events" | "actions" | "messages" | "usage" | "status" | "data";
  readonly status: CoverageStatus;
  readonly reason?: string;
}

export interface UsageResult {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly value: string;
}

export interface ActivityResult {
  readonly id: string;
  readonly phase: string;
  readonly label: string;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted" | "unknown";
}

export interface CommandResult {
  readonly id: string;
  readonly phase: string;
  readonly invocation: string;
  readonly outcome: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly state: Exclude<CollectionState, "not-recorded">;
  readonly stdoutState: "complete" | "truncated";
  readonly stderrState: "complete" | "truncated";
  readonly stdoutRetainedBytes: number;
  readonly stdoutTotalBytes: number;
  readonly stderrRetainedBytes: number;
  readonly stderrTotalBytes: number;
}

export interface DiagnosticResult {
  readonly id: string;
  readonly kind: string;
  readonly code: string;
  readonly summary: string;
  readonly redaction: { readonly state: "none" } | { readonly state: "applied"; readonly replacements: number };
}

export interface FileChangeResult {
  readonly id: string;
  readonly path: string;
  readonly kind: "created" | "modified" | "deleted";
  readonly state: string;
  readonly before: FileEndpointResult;
  readonly after: FileEndpointResult;
  readonly beforeText?: string;
  readonly afterText?: string;
}

export type FileEndpointResult =
  | { readonly state: "absent" }
  | { readonly state: "available"; readonly text: string }
  | { readonly state: "omitted" | "elided" | "unavailable"; readonly reason: string };

export interface ArtifactResult {
  readonly id: string;
  readonly label: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly state: "recorded";
}

export interface AttemptSummaryResult {
  readonly key: string;
  readonly attemptId: string;
  readonly locator: string;
  readonly originRunId: string;
  readonly evalId: string;
  readonly outcome: AttemptOutcome;
  readonly verdict: Verdict;
  readonly scoreState: "not-scored" | "complete" | "unavailable";
  readonly scoreEarned: number;
  readonly scorePossible: number;
  readonly coverage: readonly CoverageResult[];
  readonly issues: readonly string[];
}

export interface AttemptResult extends AttemptSummaryResult {
  readonly assertionsStatus: FamilyStatusResult;
  readonly assertions: readonly AssertionResult[];
  readonly sourcesStatus: FamilyStatusResult;
  readonly sources: readonly SourceResult[];
  readonly turnsStatus: FamilyStatusResult;
  readonly turns: readonly TurnResult[];
  readonly usage: readonly UsageResult[];
  readonly activitiesStatus: FamilyStatusResult;
  readonly activities: readonly ActivityResult[];
  readonly commandsStatus: FamilyStatusResult;
  readonly commands: readonly CommandResult[];
  readonly diagnosticsStatus: FamilyStatusResult;
  readonly diagnostics: readonly DiagnosticResult[];
  readonly fileChangesStatus: FamilyStatusResult;
  readonly fileChanges: readonly FileChangeResult[];
  readonly artifactsStatus: FamilyStatusResult;
  readonly artifacts: readonly ArtifactResult[];
  readonly artifactsState: CollectionState;
}

export interface MemberResult {
  readonly slotId: string;
  readonly evalId: string;
  readonly action: MembershipAction;
  readonly attempt?: AttemptSummaryResult;
}

export interface RunSummaryResult {
  readonly runId: string;
  readonly experimentId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly members: readonly MemberResult[];
}

export interface ExperimentSummaryResult {
  readonly experimentId: string;
  readonly runCount: number;
  readonly evalCount: number;
  readonly attempts: number;
  readonly passed: number;
}

export interface CatalogResult {
  readonly experiments: readonly string[];
  readonly defaultExperimentId?: string;
  readonly runExperiments: readonly { readonly runId: string; readonly experimentId: string }[];
  readonly attemptExperiments: readonly { readonly locator: string; readonly experimentId: string }[];
}

export interface OverviewResult {
  readonly experiments: readonly ExperimentSummaryResult[];
  readonly selectedExperimentId?: string;
  readonly evalIds: readonly string[];
  readonly runs: readonly RunSummaryResult[];
  readonly attempts: number;
  readonly passed: number;
  readonly totalCost: number;
}

export interface RunResult {
  readonly run?: RunSummaryResult;
}

export interface AttemptQueryResult {
  readonly attempt?: AttemptResult;
}

export interface SourcesResult {
  readonly locator: string;
  readonly status: FamilyStatusResult;
  readonly sources: readonly SourceResult[];
}

export interface ArtifactsResult {
  readonly locator: string;
  readonly state: CollectionState;
  readonly status: FamilyStatusResult;
  readonly artifacts: readonly ArtifactResult[];
}

export interface CompareResult {
  readonly experiments: readonly {
    readonly experimentId: string;
    readonly runs: readonly { readonly runId: string }[];
  }[];
}

export interface ViewQueryDefinitions {
  readonly catalog: { readonly input: undefined; readonly output: CatalogResult };
  readonly overview: { readonly input: { readonly experimentId?: string }; readonly output: OverviewResult };
  readonly run: { readonly input: { readonly runId: string }; readonly output: RunResult };
  readonly attempt: { readonly input: { readonly locator: string }; readonly output: AttemptQueryResult };
  readonly sources: { readonly input: { readonly locator: string }; readonly output: SourcesResult };
  readonly artifacts: { readonly input: { readonly locator: string }; readonly output: ArtifactsResult };
  readonly compare: { readonly input: undefined; readonly output: CompareResult };
}

export type ViewQueryName = keyof ViewQueryDefinitions;
export type ViewQueryInput<Name extends ViewQueryName> = ViewQueryDefinitions[Name]["input"];
export type ViewQueryOutput<Name extends ViewQueryName> = ViewQueryDefinitions[Name]["output"];
