import type {
  InspectionAttemptDiffDocument,
  InspectionAttemptDocument,
  InspectionAttemptSourcesDocument,
  InspectionAttemptTimingDocument,
  InspectionAttemptTraceDetailDocument,
  InspectionAttemptTraceDocument,
  InspectionAttemptUsageDocument,
  InspectionExperimentDocument,
  InspectionOverviewDocument,
  InspectionOverviewResult,
  InspectionRunOverviewDocument,
  InspectionScoredValue,
  InspectionTraceDetailResult,
} from "../inspection/index.ts";
import type { AttemptOutcome as RecordAttemptOutcome, MembershipAction as RecordMembershipAction } from "../record/model/core.ts";
import type { Verdict as PublicVerdict } from "../shared/types.ts";
import type { AgentTurnOutcome as ReceiptAgentTurnOutcome, SANDBOX_COMMAND_PHASES } from "../record/family/protocol-values.ts";

export type MetricState = "available" | "partial" | "unavailable" | "empty" | "unsupported" | "failed";
export type Verdict = PublicVerdict;
export type MembershipAction = RecordMembershipAction;
export type AttemptOutcome = RecordAttemptOutcome;
export type AgentTurnOutcome = ReceiptAgentTurnOutcome;
export type SectionState = "available" | "not-recorded" | "partial" | "unavailable";
export type ProjectionState = "complete" | "partial" | "not-recorded" | "invalid";
export type SourceState = "available" | "not-recorded" | "invalid";
export type ScoredValue = InspectionScoredValue;
export type SourceContent =
  | { readonly state: "available"; readonly text: string }
  | { readonly state: "omitted"; readonly reason: "inspection-result-byte-limit"; readonly byteLength: number; readonly byteLimit: number };
export type AssertionSource =
  | { readonly state: "mapped"; readonly sourceItemId: string; readonly sha256: string }
  | { readonly state: "unmapped"; readonly reason: "source-snapshot-not-recorded" | "position-unrepresentable" };
export type CommandPhase = (typeof SANDBOX_COMMAND_PHASES)[number];
export type CommandOutcome = "exited" | "terminated" | "not-started";
export type Metric = { readonly state: MetricState; readonly value: number | null };
export type Aggregate = {
  readonly expected: number;
  readonly observed: number;
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: number;
  readonly passRate: Metric;
  readonly score: Metric;
};
export interface OverviewView {
  readonly totals: Aggregate;
  readonly experiments: readonly { readonly experimentId: string; readonly aggregate: Aggregate }[];
  readonly cells: readonly {
    readonly experimentId: string;
    readonly evalId: string;
    readonly aggregate: Aggregate;
    readonly members: readonly {
      readonly locator: string | null;
      readonly action: MembershipAction | "pending";
      readonly relation: "origin" | "reference" | null;
      readonly score: Metric;
    }[];
  }[];
}
export interface ExperimentView {
  readonly experimentId: string;
  readonly aggregate: Aggregate;
  readonly cells: OverviewView["cells"];
}
export interface RunView {
  readonly runId: string;
  readonly experimentId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly expected: number;
  readonly observed: number;
  readonly coverage: InspectionRunOverviewDocument["runOverview"]["coverage"];
  readonly usage: InspectionRunOverviewDocument["runOverview"]["usage"];
  readonly limitations: InspectionRunOverviewDocument["runOverview"]["limitations"];
  readonly members: readonly {
    readonly slotId: string;
    readonly evalId: string;
    readonly attemptOrdinal: number;
    readonly locator: string | null;
    readonly state: MembershipAction | "missing";
    readonly relation: "origin" | "reference" | null;
    readonly outcome: AttemptOutcome | null;
    readonly verdict: Verdict | null;
    readonly score: ScoredValue | null;
    readonly coverage: InspectionRunOverviewDocument["runOverview"]["members"][number]["coverage"];
    readonly usage: InspectionRunOverviewDocument["runOverview"]["members"][number]["usage"];
    readonly limitations: InspectionRunOverviewDocument["runOverview"]["members"][number]["limitations"];
  }[];
}
export interface AttemptView {
  readonly locator: string;
  readonly verdict: Verdict | null;
  readonly attemptId: string;
  readonly evalId: string;
  readonly slotId: string;
  readonly outcome: AttemptOutcome;
  readonly originRunId: string;
  readonly experimentId: string;
  readonly score: ScoredValue;
  readonly sections: {
    readonly assertions: SectionState;
    readonly sources: SectionState;
    readonly trace: SectionState;
    readonly timing: SectionState;
    readonly usage: SectionState;
    readonly diff: SectionState;
  };
  readonly assertions: {
    readonly state: SourceState;
    readonly entries: readonly {
      readonly entryId: string;
      readonly label?: string;
      readonly key?: string;
      readonly groupPath: readonly string[];
    }[];
  };
  readonly evidenceCoverage: readonly string[];
  readonly limitations: readonly string[];
}
export interface SourcesView {
  readonly locator: string;
  readonly state: SourceState;
  readonly items: readonly { readonly path: string; readonly sourceItemId: string; readonly byteLength: number; readonly content: SourceContent }[];
  readonly assertions: {
    readonly state: SourceState;
    readonly sites: readonly {
      readonly entryId: string;
      readonly role: "declaration" | "threshold" | "score" | "gate" | "optional" | "stop";
      readonly start: { readonly line: number; readonly column: number };
      readonly end: { readonly line: number; readonly column: number };
      readonly source: AssertionSource;
    }[];
    readonly hasMoreSourceSites: boolean;
    readonly omittedSourceSiteCount: number;
  };
  readonly hasMore: boolean;
  readonly omittedItemCount: number;
}
type WithoutTurnId<Value> = Value extends unknown ? Omit<Value, "turnId"> : never;
export type TraceItem = WithoutTurnId<InspectionAttemptTraceDocument["trace"]["conversation"]["items"][number]>;
export interface TraceView {
  readonly locator: string;
  readonly conversation: {
    readonly state: ProjectionState;
    readonly limitations: InspectionAttemptTraceDocument["trace"]["conversation"]["limitations"];
    readonly limitationsTruncated: boolean;
    readonly omittedLimitationCount: number;
    readonly turnsTruncated: boolean;
    readonly omittedTurnCount: number;
    readonly itemCount: number;
    readonly itemsTruncated: boolean;
    readonly omittedItemCount: number;
    readonly turns: readonly { readonly turnId: string; readonly sequence: number; readonly outcome: AgentTurnOutcome; readonly items: readonly TraceItem[] }[];
  };
  readonly commands: {
    readonly state: ProjectionState;
    readonly limitations: InspectionAttemptTraceDocument["trace"]["commands"]["limitations"];
    readonly limitationsTruncated: boolean;
    readonly omittedLimitationCount: number;
    readonly hasMore: boolean;
    readonly omittedCommandCount: number;
    readonly items: readonly { readonly commandId: InspectionAttemptTraceDocument["trace"]["commands"]["items"][number]["commandId"]; readonly phase: CommandPhase; readonly outcome: CommandOutcome }[];
  };
  readonly diagnostics: InspectionAttemptTraceDocument["trace"]["diagnostics"];
  readonly identities: {
    readonly itemIds: InspectionAttemptTraceDocument["trace"]["identityIndex"]["itemIds"];
    readonly toolOccurrenceIds: InspectionAttemptTraceDocument["trace"]["identityIndex"]["toolOccurrenceIds"]["ids"];
    readonly commandIds: InspectionAttemptTraceDocument["trace"]["identityIndex"]["commandIds"];
  };
}
export interface TraceDetailView {
  readonly locator: string;
  readonly kind: "item" | "tool-occurrence" | "command";
  readonly stableId: string;
  readonly body: InspectionTraceDetailResult;
}
export type TimingView = { readonly locator: string } & InspectionAttemptTimingDocument["timing"];
export type UsageView = { readonly locator: string } & InspectionAttemptUsageDocument["usage"];
export type DiffView = { readonly locator: string } & InspectionAttemptDiffDocument["diff"];

const metric = (value: { readonly state: MetricState; readonly value: number | null }): Metric => ({ state: value.state, value: value.value });
const aggregate = (value: InspectionOverviewResult["totals"]): Aggregate => ({
  expected: value.denominator.expected,
  observed: value.denominator.observed,
  passed: value.verdict.tally.passed,
  failed: value.verdict.tally.failed,
  errored: value.verdict.tally.errored,
  skipped: value.verdict.tally.skipped,
  passRate: metric(value.verdict.passRate),
  score: metric(value.score),
});
const cells = (values: InspectionOverviewResult["cells"]): OverviewView["cells"] => values.map((cell) => ({
  experimentId: cell.experimentId,
  evalId: cell.evalId,
  aggregate: aggregate(cell),
  members: cell.members.map((member) => ({
    locator: member.locator,
    action: member.action,
    relation: member.relation,
    score: metric(member.score),
  })),
}));

export function projectOverview(document: InspectionOverviewDocument): OverviewView {
  return {
    totals: aggregate(document.overview.totals),
    experiments: document.overview.experiments.map((experiment) => ({ experimentId: experiment.experimentId, aggregate: aggregate(experiment) })),
    cells: cells(document.overview.cells),
  };
}
export function projectExperiment(document: InspectionExperimentDocument): ExperimentView {
  return {
    experimentId: document.experiment.experiment.experimentId,
    aggregate: aggregate(document.experiment.experiment),
    cells: cells(document.experiment.cells),
  };
}
export function projectRun(document: InspectionRunOverviewDocument): RunView {
  const value = document.runOverview;
  return {
    runId: value.identity.runId,
    experimentId: value.identity.experimentId,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    expected: value.denominator.expected,
    observed: value.denominator.observed,
    coverage: value.coverage,
    usage: value.usage,
    limitations: value.limitations,
    members: value.members.map((member) => ({
      slotId: member.slot.slotId,
      evalId: member.slot.evalId,
      attemptOrdinal: member.slot.attemptOrdinal,
      locator: member.locator,
      state: member.state,
      relation: member.relation,
      outcome: member.outcome,
      verdict: member.verdict,
      score: member.score,
      coverage: member.coverage,
      usage: member.usage,
      limitations: member.limitations,
    })),
  };
}
export function projectAttempt(document: InspectionAttemptDocument): AttemptView {
  const value = document.attempt;
  return {
    locator: value.locator,
    verdict: value.verdict,
    attemptId: value.core.attemptId,
    evalId: value.core.evalId,
    slotId: value.core.slotId,
    outcome: value.core.outcome,
    originRunId: value.core.originRunId,
    experimentId: value.originRun.experimentId,
    score: value.score,
    sections: {
      assertions: value.sections.assertions.state,
      sources: value.sections.sources.state,
      trace: value.sections.trace.state,
      timing: value.sections.timing.state,
      usage: value.sections.usage.state,
      diff: value.sections.diff.state,
    },
    assertions: {
      state: value.assertions.state,
      entries: value.assertions.entries.map((entry) => ({ entryId: entry.entryId, ...entry.display })),
    },
    evidenceCoverage: value.evidenceCoverage.map((entry) => JSON.stringify(entry)),
    limitations: value.limitations.map((entry) => JSON.stringify(entry)),
  };
}
export function projectSources(document: InspectionAttemptSourcesDocument, locator: string): SourcesView {
  const value = document.sources;
  return {
    locator,
    state: value.state,
    items: value.items.map((item) => ({ path: item.path, sourceItemId: item.sourceItemId, byteLength: item.byteLength, content: item.content })),
    assertions: {
      state: value.assertions.state,
      sites: value.assertions.sourceSites.map((site) => ({
        entryId: site.entryId,
        role: site.role,
        start: site.start,
        end: site.end,
        source: site.source,
      })),
      hasMoreSourceSites: value.assertions.hasMoreSourceSites,
      omittedSourceSiteCount: value.assertions.omittedSourceSiteCount,
    },
    hasMore: value.hasMore,
    omittedItemCount: value.omittedItemCount,
  };
}
export function projectTrace(document: InspectionAttemptTraceDocument, locator: string): TraceView {
  const value = document.trace;
  return {
    locator,
    conversation: {
      state: value.conversation.state,
      limitations: value.conversation.limitations,
      limitationsTruncated: value.conversation.limitationsTruncated,
      omittedLimitationCount: value.conversation.omittedLimitationCount,
      turnsTruncated: value.conversation.turnsTruncated,
      omittedTurnCount: value.conversation.omittedTurnCount,
      itemCount: value.conversation.items.length,
      itemsTruncated: value.conversation.itemsTruncated,
      omittedItemCount: value.conversation.omittedItemCount,
      turns: value.conversation.turns.map((turn) => ({
        ...turn,
        items: value.conversation.items.filter((item) => item.turnId === turn.turnId).map(({ turnId: _turnId, ...item }) => item),
      })),
    },
    commands: {
      state: value.commands.state,
      limitations: value.commands.limitations,
      limitationsTruncated: value.commands.limitationsTruncated,
      omittedLimitationCount: value.commands.omittedLimitationCount,
      hasMore: value.commands.hasMore,
      omittedCommandCount: value.commands.omittedCommandCount,
      items: value.commands.items.map((command) => ({ commandId: command.commandId, phase: command.phase, outcome: command.outcome.kind })),
    },
    diagnostics: value.diagnostics,
    identities: {
      itemIds: value.identityIndex.itemIds,
      toolOccurrenceIds: value.identityIndex.toolOccurrenceIds.ids,
      commandIds: value.identityIndex.commandIds,
    },
  };
}
export function projectTraceDetail(document: InspectionAttemptTraceDetailDocument, locator: string): TraceDetailView {
  const body = document.detail;
  return {
    locator,
    kind: body.kind,
    stableId: body.kind === "item" ? body.itemId : body.kind === "tool-occurrence" ? body.toolOccurrenceId : body.commandId,
    body,
  };
}
export function projectTiming(document: InspectionAttemptTimingDocument, locator: string): TimingView {
  return { locator, ...document.timing };
}
export function projectUsage(document: InspectionAttemptUsageDocument, locator: string): UsageView {
  return { locator, ...document.usage };
}
export function projectDiff(document: InspectionAttemptDiffDocument, locator: string): DiffView {
  return { locator, ...document.diff };
}
