// @concord-file
// @concord-implements docs/feature/inspection/cli.md
// @concord-implements docs/feature/inspection/architecture.md#run-inspection-insight
import type {
  InspectionOverviewResult,
  InspectionScoredValue,
  InspectionSuccessDocumentFor,
  InspectionTraceDetailResult,
} from "../inspection/index.ts";
import type {
  AttemptOutcome as RecordAttemptOutcome,
  MembershipAction as RecordMembershipAction,
} from "../record/model/core.ts";
import type { AdapterIdentity } from "../record/model/run-context.ts";
import type { Verdict as PublicVerdict } from "../shared/types.ts";
import type { AgentTurnOutcome as ReceiptAgentTurnOutcome } from "../record/family/protocol-values.ts";

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
  | {
      readonly state: "omitted";
      readonly reason: "inspection-result-byte-limit";
      readonly byteLength: number;
      readonly byteLimit: number;
    };
export type AssertionSource =
  | { readonly state: "mapped"; readonly sourceItemId: string; readonly sha256: string }
  | { readonly state: "unmapped"; readonly reason: "source-snapshot-not-recorded" | "position-unrepresentable" };
export type CommandPhase = InspectionSuccessDocumentFor<"attempt.trace">["trace"]["commands"]["items"][number]["phase"];
export type CommandOutcome =
  InspectionSuccessDocumentFor<"attempt.trace">["trace"]["commands"]["items"][number]["outcome"];
export type Metric = { readonly state: MetricState; readonly value: number | undefined };
export type ExecutionValue =
  | { readonly state: "available"; readonly value: string }
  | { readonly state: "mixed" }
  | { readonly state: "unavailable" };
export type AdapterValue =
  | { readonly state: "available"; readonly value: ShowAdapterIdentity }
  | { readonly state: "mixed" }
  | { readonly state: "none" };
interface ShowAdapterIdentity {
  readonly name: string;
  readonly contract: string;
  readonly behaviorRevision: string | undefined;
}

function adapterIdentity(value: AdapterIdentity | undefined): ShowAdapterIdentity | undefined {
  if (value === null || value === undefined) return undefined;
  return { name: value.name, contract: value.contract, behaviorRevision: value.behaviorRevision ?? undefined };
}

function adapterValue(value: InspectionOverviewResult["experiments"][number]["adapter"]): AdapterValue {
  if (value.state === "mixed") return value;
  const identity = adapterIdentity(value.value);
  if (identity === undefined) return { state: "none" };
  return { state: "available", value: identity };
}
export type Aggregate = {
  readonly evaluationKind: "pass" | "points" | "mixed";
  readonly expected: number;
  readonly observed: number;
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: number;
  readonly passRate: Metric;
  readonly score: Metric;
  readonly durationMs: Metric;
  readonly tokens: Metric;
};
export interface OverviewView {
  readonly totals: Aggregate;
  readonly experiments: readonly {
    readonly experimentId: string;
    readonly adapter: AdapterValue;
    readonly model: ExecutionValue;
    readonly aggregate: Aggregate;
  }[];
  readonly cells: readonly {
    readonly experimentId: string;
    readonly evalId: string;
    readonly aggregate: Aggregate;
    readonly members: readonly {
      readonly publication:
        | { readonly state: "pending" }
        | { readonly state: "absent"; readonly reason: string }
        | {
            readonly state: "published";
            readonly action: MembershipAction;
            readonly attemptId: string;
            readonly attemptLocator: string;
            readonly originRunId: string;
            readonly originPlannedAttemptId: string;
            readonly verdict: Verdict | undefined;
            readonly stoppedAt: InspectionSuccessDocumentFor<"attempt.get">["attempt"]["stoppedAt"] | undefined;
            readonly score: Metric;
            readonly durationMs: Metric;
            readonly tokens: Metric;
          };
    }[];
  }[];
}
export interface ExperimentView {
  readonly labels: InspectionSuccessDocumentFor<"experiment.get">["experiment"]["experiment"]["labels"];
  readonly plugins: InspectionSuccessDocumentFor<"experiment.get">["experiment"]["experiment"]["plugins"];
  readonly notes: InspectionSuccessDocumentFor<"experiment.get">["experiment"]["notes"];
  readonly experimentId: string;
  readonly aggregate: Aggregate;
  readonly cells: OverviewView["cells"];
  readonly costSummary: InspectionSuccessDocumentFor<"experiment.get">["experiment"]["costSummary"];
  readonly modelUsage: InspectionSuccessDocumentFor<"experiment.get">["experiment"]["modelUsage"];
}
export interface RunView {
  readonly diagnostics: InspectionSuccessDocumentFor<"run.get">["run"]["diagnostics"];
  readonly runId: string;
  readonly experimentId: string;
  readonly adapter: ShowAdapterIdentity | undefined;
  readonly state: "active" | "recovering" | "completed" | "interrupted" | "failed";
  readonly startedAt: number;
  readonly completedAt: number | undefined;
  readonly expected: number;
  readonly observed: number;
  readonly coverage: InspectionSuccessDocumentFor<"run.get">["run"]["coverage"];
  readonly usage: InspectionSuccessDocumentFor<"run.get">["run"]["usage"];
  readonly limitations: InspectionSuccessDocumentFor<"run.get">["run"]["limitations"];
  readonly members: readonly {
    readonly plannedAttemptId: string;
    readonly evalId: string;
    readonly attemptOrdinal: number;
    readonly locator: string | undefined;
    readonly state: MembershipAction | "pending";
    readonly execution:
      | { readonly state: "not-recorded" }
      | { readonly state: "recorded"; readonly relation: "origin" | "reference"; readonly outcome: AttemptOutcome };
    readonly verdict: Verdict | undefined;
    readonly score: Metric;
    readonly coverage: InspectionSuccessDocumentFor<"run.get">["run"]["plannedAttempts"][number]["coverage"];
    readonly usage: InspectionSuccessDocumentFor<"run.get">["run"]["plannedAttempts"][number]["usage"];
    readonly limitations: InspectionSuccessDocumentFor<"run.get">["run"]["plannedAttempts"][number]["limitations"];
  }[];
}
export interface AttemptView {
  readonly verdictCauses: InspectionSuccessDocumentFor<"attempt.get">["attempt"]["verdictCauses"] | undefined;
  readonly diagnostics: InspectionSuccessDocumentFor<"attempt.get">["attempt"]["diagnostics"] | undefined;
  readonly stoppedAt: InspectionSuccessDocumentFor<"attempt.get">["attempt"]["stoppedAt"] | undefined;
  readonly notes: InspectionSuccessDocumentFor<"attempt.get">["attempt"]["notes"];
  readonly totalCosts: InspectionSuccessDocumentFor<"attempt.usage">["usage"]["totalCosts"] | undefined;
  readonly locator: string;
  readonly verdict: Verdict | undefined;
  readonly attemptId: string;
  readonly evalId: string;
  readonly plannedAttemptId: string;
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
    readonly diagnostics: SectionState;
  };
  readonly assertions: {
    readonly state: SourceState;
    readonly entries: readonly {
      readonly entryId: string;
      readonly label: string | undefined;
      readonly groupPath: readonly string[];
    }[];
  };
  readonly evidenceCoverage: InspectionSuccessDocumentFor<"attempt.get">["attempt"]["evidenceCoverage"];
  readonly limitations: InspectionSuccessDocumentFor<"attempt.get">["attempt"]["limitations"];
}
export interface SourcesView {
  readonly locator: string;
  readonly state: SourceState;
  readonly items: readonly {
    readonly path: string;
    readonly sourceItemId: string;
    readonly byteLength: number;
    readonly content: SourceContent;
  }[];
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
export type TraceItem = WithoutTurnId<
  InspectionSuccessDocumentFor<"attempt.trace">["trace"]["conversation"]["items"][number]
>;
export interface TraceView {
  readonly locator: string;
  readonly execution: InspectionSuccessDocumentFor<"attempt.trace">["trace"]["execution"];
  readonly conversation: {
    readonly state: ProjectionState;
    readonly limitations: InspectionSuccessDocumentFor<"attempt.trace">["trace"]["conversation"]["limitations"];
    readonly limitationsTruncated: boolean;
    readonly omittedLimitationCount: number;
    readonly turnsTruncated: boolean;
    readonly omittedTurnCount: number;
    readonly itemCount: number;
    readonly itemsTruncated: boolean;
    readonly omittedItemCount: number;
    readonly turns: readonly {
      readonly turnId: string;
      readonly sequence: number;
      readonly outcome: AgentTurnOutcome;
      readonly items: readonly TraceItem[];
    }[];
  };
  readonly commands: {
    readonly state: ProjectionState;
    readonly limitations: InspectionSuccessDocumentFor<"attempt.trace">["trace"]["commands"]["limitations"];
    readonly limitationsTruncated: boolean;
    readonly omittedLimitationCount: number;
    readonly hasMore: boolean;
    readonly omittedCommandCount: number;
    readonly items: readonly {
      readonly commandId: InspectionSuccessDocumentFor<"attempt.trace">["trace"]["commands"]["items"][number]["commandId"];
      readonly phase: CommandPhase;
      readonly checked?: boolean;
      readonly outcome: CommandOutcome;
    }[];
  };
  readonly diagnostics: InspectionSuccessDocumentFor<"attempt.trace">["trace"]["diagnostics"];
  readonly identities: {
    readonly itemIds: InspectionSuccessDocumentFor<"attempt.trace">["trace"]["identityIndex"]["itemIds"];
    readonly toolOccurrenceIds: InspectionSuccessDocumentFor<"attempt.trace">["trace"]["identityIndex"]["toolOccurrenceIds"]["ids"];
    readonly commandIds: InspectionSuccessDocumentFor<"attempt.trace">["trace"]["identityIndex"]["commandIds"];
    readonly omittedItemIdCount: number;
    readonly omittedToolOccurrenceIdCount: number;
    readonly omittedCommandIdCount: number;
  };
}
export interface TraceDetailView {
  readonly locator: string;
  readonly kind: InspectionTraceDetailResult["kind"];
  readonly stableId: string;
  readonly body: InspectionTraceDetailResult;
}
export type ExecutionDisplayPreviewBlock = Extract<
  TraceView["execution"]["events"][number]["display"],
  { state: "present" }
>["blocks"][number];
export type ExecutionDisplayDetailBlock = NonNullable<
  Extract<TraceDetailView["body"], { kind: "execution-event" }>["event"]["display"]
>[number];
export type TimingView = { readonly locator: string } & InspectionSuccessDocumentFor<"attempt.timing">["timing"];
export type UsageView = { readonly locator: string } & InspectionSuccessDocumentFor<"attempt.usage">["usage"];
export type DiffView = { readonly locator: string } & InspectionSuccessDocumentFor<"attempt.diff">["diff"];

export const projectMetric = (value: { readonly state: MetricState; readonly value: number | null }): Metric => ({
  state: value.state,
  value: value.value ?? undefined,
});
const metric = projectMetric;
const aggregate = (value: InspectionOverviewResult["totals"]): Aggregate => ({
  evaluationKind: value.evaluationKind,
  expected: value.denominator.expected,
  observed: value.denominator.observed,
  passed: value.verdict.tally.passed,
  failed: value.verdict.tally.failed,
  errored: value.verdict.tally.errored,
  skipped: value.verdict.tally.skipped,
  passRate: metric(value.verdict.passRate),
  score: metric(value.score),
  durationMs: metric(value.durationMs),
  tokens: metric(value.tokens),
});
const cells = (values: InspectionOverviewResult["cells"]): OverviewView["cells"] =>
  values.map((cell) => ({
    experimentId: cell.experimentId,
    evalId: cell.evalId,
    aggregate: aggregate(cell),
    members: cell.members.map((member) => ({
      publication:
        member.publication.state === "published"
          ? {
              ...member.publication,
              verdict: member.verdict ?? undefined,
              stoppedAt: member.stoppedAt,
              score: metric(member.score),
              durationMs: metric(member.durationMs),
              tokens: metric(member.tokens),
            }
          : member.publication,
    })),
  }));

export function projectOverview(document: InspectionSuccessDocumentFor<"overview.get">): OverviewView {
  return {
    totals: aggregate(document.overview.totals),
    experiments: document.overview.experiments.map((experiment) => ({
      experimentId: experiment.experimentId,
      adapter: adapterValue(experiment.adapter),
      model: experiment.model,
      aggregate: aggregate(experiment),
    })),
    cells: cells(document.overview.cells),
  };
}
export function projectExperiment(document: InspectionSuccessDocumentFor<"experiment.get">): ExperimentView {
  return {
    labels: document.experiment.experiment.labels,
    experimentId: document.experiment.experiment.experimentId,
    notes: document.experiment.notes,
    plugins: document.experiment.experiment.plugins,
    aggregate: aggregate(document.experiment.experiment),
    cells: cells(document.experiment.cells),
    costSummary: document.experiment.costSummary,
    modelUsage: document.experiment.modelUsage,
  };
}
// @concord-code
// @concord-implements docs/feature/inspection/use-case/inspection-check-completeness.md
export function projectRun(document: InspectionSuccessDocumentFor<"run.get">): RunView {
  const detail = document.run;
  const value = detail.value;
  return {
    diagnostics: detail.diagnostics,
    runId: value.runId,
    experimentId: value.experimentId,
    adapter: adapterIdentity(value.context?.execution.adapter),
    state: value.state,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    expected: detail.denominator.expected,
    observed: detail.denominator.published,
    coverage: detail.coverage,
    usage: detail.usage,
    limitations: detail.limitations,
    members: detail.plannedAttempts.map((member) => ({
      plannedAttemptId: member.plannedAttemptId,
      evalId: member.evalId,
      attemptOrdinal: member.attemptOrdinal,
      locator: member.publication.state === "published" ? member.publication.attemptLocator : undefined,
      state: member.state,
      execution:
        member.relation === null || member.outcome === null
          ? { state: "not-recorded" }
          : { state: "recorded", relation: member.relation, outcome: member.outcome },
      verdict: member.verdict ?? undefined,
      score: metric(member.score),
      coverage: member.coverage,
      usage: member.usage,
      limitations: member.limitations,
    })),
  };
}
// @concord-code
// @concord-implements docs/feature/inspection/cli.md
export function projectAttempt(
  document: InspectionSuccessDocumentFor<"attempt.get">,
  usage?: InspectionSuccessDocumentFor<"attempt.usage">,
): AttemptView {
  const value = document.attempt;
  return {
    locator: value.locator,
    notes: value.notes,
    diagnostics: value.diagnostics,
    verdictCauses: value.verdictCauses,
    stoppedAt: value.stoppedAt,
    totalCosts: usage?.usage.totalCosts,
    verdict: value.verdict ?? undefined,
    attemptId: value.core.attemptId,
    evalId: value.core.evalId,
    plannedAttemptId: value.core.plannedAttemptId,
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
      diagnostics: value.sections.diagnostics.state,
    },
    assertions: {
      state: value.assertions.state,
      entries: value.assertions.entries.map((entry) => ({
        entryId: entry.entryId,
        groupPath: entry.display.groupPath,
        label: entry.display.label,
      })),
    },
    evidenceCoverage: value.evidenceCoverage,
    limitations: value.limitations,
  };
}
export function projectSources(
  document: InspectionSuccessDocumentFor<"attempt.sources">,
  locator: string,
): SourcesView {
  const value = document.sources;
  return {
    locator,
    state: value.state,
    items: value.items.map((item) => ({
      path: item.path,
      sourceItemId: item.sourceItemId,
      byteLength: item.byteLength,
      content: item.content,
    })),
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
export function projectTrace(document: InspectionSuccessDocumentFor<"attempt.trace">, locator: string): TraceView {
  const value = document.trace;
  return {
    locator,
    execution: value.execution,
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
        items: value.conversation.items
          .filter((item) => item.turnId === turn.turnId)
          .map(({ turnId: _turnId, ...item }) => item),
      })),
    },
    commands: {
      state: value.commands.state,
      limitations: value.commands.limitations,
      limitationsTruncated: value.commands.limitationsTruncated,
      omittedLimitationCount: value.commands.omittedLimitationCount,
      hasMore: value.commands.hasMore,
      omittedCommandCount: value.commands.omittedCommandCount,
      items: value.commands.items.map((command) => ({
        commandId: command.commandId,
        phase: command.phase,
        ...(command.checked === undefined ? {} : { checked: command.checked }),
        outcome: command.outcome,
      })),
    },
    diagnostics: value.diagnostics,
    identities: {
      itemIds: value.identityIndex.itemIds,
      toolOccurrenceIds: value.identityIndex.toolOccurrenceIds.ids,
      commandIds: value.identityIndex.commandIds,
      omittedItemIdCount: value.identityIndex.omittedItemIdCount,
      omittedToolOccurrenceIdCount: value.identityIndex.toolOccurrenceIds.omittedIdCount,
      omittedCommandIdCount: value.identityIndex.omittedCommandIdCount,
    },
  };
}
export function projectTraceDetail(
  document: InspectionSuccessDocumentFor<"attempt.trace.detail">,
  locator: string,
): TraceDetailView {
  const body = document.detail;
  function stableId(): string {
    switch (body.kind) {
      case "turn":
        return body.turnId;
      case "item":
        return body.itemId;
      case "tool-occurrence":
        return body.toolOccurrenceId;
      case "command":
        return body.commandId;
      case "execution-event":
        return body.event.eventId;
      default:
        return body.evidenceId;
    }
  }
  return {
    locator,
    kind: body.kind,
    stableId: stableId(),
    body,
  };
}
export function projectTiming(document: InspectionSuccessDocumentFor<"attempt.timing">, locator: string): TimingView {
  return { locator, ...document.timing };
}
export function projectUsage(document: InspectionSuccessDocumentFor<"attempt.usage">, locator: string): UsageView {
  return { locator, ...document.usage };
}
export function projectDiff(document: InspectionSuccessDocumentFor<"attempt.diff">, locator: string): DiffView {
  return { locator, ...document.diff };
}
