// @concord-file
// @concord-implements docs/feature/inspection/cli.md
// @concord-implements docs/feature/inspection/architecture.md#run-inspection-insight
import type { AssertionDetailResult } from "../inspection/assertion-projection.ts";
import type { AssertionFactValue } from "../assertions/record/model.ts";
import { formatNumericUnit } from "../assertions/quantity.ts";
import {
  renderTerminal,
  type TerminalBlock,
  type TerminalPanelContentBlock,
  charDisplayWidth,
  stringWidth,
  padDisplay,
  wrapDisplay,
  panelContentWidth,
} from "../terminal/index.ts";
import type {
  Aggregate,
  AttemptView,
  DiffView,
  ExperimentView,
  ExecutionValue,
  ExecutionDisplayPreviewBlock,
  ExecutionDisplayDetailBlock,
  Metric,
  OverviewView,
  RunView,
  ScoredValue,
  SourcesView,
  TimingView,
  TraceDetailView,
  TraceItem,
  TraceView,
  UsageView,
} from "./model.ts";
import { decodeBase64Bytes } from "../inspection/bytes.ts";
import { displayTextHasForbiddenCharacter } from "../record/family/execution-traces/schema.ts";
import type { InspectionProjectResult } from "../inspection/project-result.ts";

const TERMINAL_OPTIONS = Object.freeze({ width: 80, mode: "plain" as const });

const terminal = (blocks: readonly TerminalBlock[]): string =>
  renderTerminal(blocks, TERMINAL_OPTIONS);

const fmt = (value: number): string =>
  Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");

const metric = (
  value: Metric,
  formatValue: (value: number) => string = fmt,
): string => {
  if (value.value === null) return value.state;
  const rendered = formatValue(value.value);
  return value.state === "available"
    ? rendered
    : `${rendered} (${value.state})`;
};

const passRate = (value: Metric): string =>
  metric(value, (rate) => `${fmt(rate * 100)}%`);

const duration = (value: Metric): string => metric(value, (milliseconds) => {
  if (milliseconds < 1_000) return `${fmt(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${fmt(milliseconds / 1_000)} s`;
  if (milliseconds < 3_600_000) return `${fmt(milliseconds / 60_000)} min`;
  return `${fmt(milliseconds / 3_600_000)} h`;
});

const score = (value: ScoredValue, verdict: AttemptView["verdict"]): string =>
  value.state === "not-scored"
    ? value.state
    : `${fmt(value.earned)}/${fmt(value.possible)} (${value.state}${
      value.state === "unavailable"
        ? `; ${value.unavailable} unavailable`
        : ""
    }${value.state === "complete" && verdict === "passed" ? "; scored" : ""})`;

const aggregateEntries = (
  value: Aggregate,
): TerminalPanelContentBlock & { readonly kind: "keyValue" } => ({
  kind: "keyValue",
  entries: [
    { key: "Observed", value: `${value.observed}/${value.expected}` },
    {
        key: "Verdicts",
        value: value.failed === 0 && value.errored === 0 && value.skipped === 0
          ? `${value.passed} passed`
          : `${value.passed} passed; ${value.failed} failed; ${value.errored} errored; ${value.skipped} skipped`,
    },
    ...(value.evaluationKind === "points" ? [] : [{ key: "Pass rate", value: passRate(value.passRate) }]),
    ...(value.evaluationKind === "pass"
      ? []
      : [{ key: "Score", value: metric(value.score) }]),
    { key: "Duration", value: duration(value.durationMs) },
    { key: "Tokens", value: metric(value.tokens) },
  ],
});

interface ExperimentGroup {
  readonly name: string | null;
  readonly experiments: OverviewView["experiments"];
}

function experimentGroup(experimentId: string): string | null {
  const separator = experimentId.indexOf("/");
  return separator <= 0 ? null : experimentId.slice(0, separator);
}

function relativeToGroup(id: string, group: string | null): string {
  const prefix = group === null ? "" : `${group}/`;
  return prefix !== "" && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function groupExperiments(value: OverviewView): readonly ExperimentGroup[] {
  const groups = new Map<string | null, OverviewView["experiments"][number][]>();
  for (const experiment of value.experiments) {
    const group = experimentGroup(experiment.experimentId);
    const members = groups.get(group) ?? [];
    members.push(experiment);
    groups.set(group, members);
  }
  return [...groups].map(([name, experiments]) => ({ name, experiments }));
}

const attemptBlocks = (
  cells: OverviewView["cells"],
  group: string | null,
  all: boolean,
  showFailed = false,
): readonly TerminalPanelContentBlock[] => {
  let shownErrors = 0;
  return cells.flatMap((cell) => {
    const showScore = cell.aggregate.evaluationKind !== "pass";
    const members = all
      ? cell.members
      : cell.members.filter((member) => {
        if (member.publication.state !== "published") return true;
        if (
          member.publication.verdict === "passed" ||
          (member.publication.verdict === "failed" && !showFailed)
        ) return false;
        if (member.publication.verdict !== "errored") return true;
        shownErrors += 1;
        return shownErrors <= 5;
      });
    if (cell.members.length > 0 && members.length === 0) return [];
    return [
    {
      kind: "divider" as const,
      title: `Eval ${relativeToGroup(cell.evalId, group)}`,
      attachNext: true,
    },
    {
      kind: "table" as const,
      columns: [
        { header: "Attempt", maxWidth: 14 },
        { header: "Verdict" },
        { header: "Duration" },
        ...(showScore ? [{ header: "Score" }] : []),
      ],
      overflow: "wrap" as const,
      rows: members.length === 0
        ? [[
          "not-recorded",
          "not-recorded",
          duration(cell.aggregate.durationMs),
          ...(showScore ? [metric(cell.aggregate.score)] : []),
        ]]
        : members.map((member) => [
          member.publication.state === "published"
            ? member.publication.attemptLocator
            : member.publication.state === "absent"
              ? `absent (${member.publication.reason})`
              : "pending",
          member.publication.state === "published"
            ? member.publication.verdict ?? "not-recorded"
            : member.publication.state,
          member.publication.state === "published"
            ? duration(member.publication.durationMs)
            : member.publication.state,
          ...(showScore
            ? [member.publication.state === "published"
              ? `${metric(member.publication.score)}${member.publication.verdict === "passed" && member.publication.score.state === "available" && member.publication.score.value !== null ? " (scored)" : ""}`
              : member.publication.state]
            : []),
        ]),
    },
    ];
  });
};

const hiddenAttemptSummary = (cells: OverviewView["cells"], showFailed = false): string | null => {
  const counts = { passed: 0, scored: 0, failed: 0, errored: 0 };
  for (const cell of cells) {
    for (const member of cell.members) {
      if (member.publication.state !== "published") continue;
      const verdict = member.publication.verdict;
      if (verdict === "passed") {
        if (cell.aggregate.evaluationKind === "points" && member.publication.score.state === "available" && member.publication.score.value !== null) {
          counts.scored += 1;
        } else {
          counts.passed += 1;
        }
      } else if (verdict === "failed" || verdict === "errored") {
        counts[verdict] += 1;
      }
    }
  }
  const hidden = [
    ...(counts.passed > 0 ? [`${counts.passed} passed`] : []),
    ...(counts.scored > 0 ? [`${counts.scored} scored`] : []),
    ...(!showFailed && counts.failed > 0 ? [`${counts.failed} failed`] : []),
    ...(counts.errored > 5 ? [`${counts.errored - 5} errored`] : []),
  ];
  return hidden.length === 0 ? null : `${hidden.join("; ")} Attempts hidden`;
};

const compactContinuation = (
  cells: OverviewView["cells"],
  experimentId: string,
  all: boolean,
  showFailed = false,
): readonly TerminalPanelContentBlock[] => {
  if (all) return [];
  const hidden = hiddenAttemptSummary(cells, showFailed);
  return hidden === null
    ? []
    : [
      {
        kind: "divider",
        title: hidden,
        attachNext: true,
      },
      {
        kind: "keyValue",
        entries: [{
          key: "See more",
          value: `niceeval show --experiment ${experimentId}`,
        }],
      },
    ];
};

const textOrNotRecorded = (value: string | null | undefined): string =>
  value ?? "not-recorded";

export function renderOverview(
  value: OverviewView,
  options: { readonly all?: boolean; readonly recorded?: boolean; readonly current?: InspectionProjectResult } = {},
): string {
  const all = options.all === true;
  const current = options.current;
  const blocks: TerminalBlock[] = [
    {
      kind: "panel",
      title: current === undefined ? options.recorded === true ? "Recorded results" : "NiceEval results" : "Current results",
      blocks: [
        { kind: "divider", title: "Totals" },
        current === undefined ? aggregateEntries(value.totals) : {
          kind: "keyValue",
          entries: [
            { key: "Covered", value: `${current.coverage.covered}/${current.coverage.expected}` },
            { key: "Gaps", value: String(current.coverage.gaps) },
            { key: "Verdicts", value: `${value.totals.passed} passed; ${value.totals.failed} failed; ${value.totals.errored} errored; ${value.totals.skipped} skipped` },
            ...(value.totals.evaluationKind === "points" ? [] : [{ key: "Pass rate", value: passRate(value.totals.passRate) }]),
            ...(value.totals.evaluationKind === "pass" ? [] : [{ key: "Score", value: metric(value.totals.score) }]),
          ],
        },
        ...(current !== undefined && current.coverage.gaps > 0 && current.history.length > 0 ? [
          { kind: "divider" as const, title: "Reference results (from previous recorded attempts)" },
          {
            kind: "keyValue" as const,
            entries: [
              { key: "Notice", value: "Prior configuration; rerun required to update target" },
              { key: "Previous attempts", value: `${current.history.length} recorded` },
            ],
          },
        ] : []),
      ],
    },
  ];
  if (value.experiments.length > 0) {
    const groups = groupExperiments(value);
    blocks.push({
      kind: "panel",
      title: "Experiments",
      blocks: groups.flatMap((group) => {
        const showPassRate = group.experiments.some(({ aggregate }) =>
          aggregate.evaluationKind !== "points"
        );
        const showScore = group.experiments.some(({ aggregate }) =>
          aggregate.evaluationKind !== "pass"
        );
        return [
          ...(group.name === null
            ? []
            : [{ kind: "divider" as const, title: group.name }]),
          {
            kind: "table" as const,
            columns: [
              { header: "Experiment" },
              { header: current === undefined ? "Observed" : "Covered" },
              ...(current === undefined ? [{ header: "Adapter" }, { header: "Model" }] : [{ header: "Gaps" }]),
              ...(showPassRate ? [{ header: "Pass rate" }] : []),
              ...(showScore ? [{ header: "Score" }] : []),
            ],
            rows: group.experiments.map((experiment) => [
              relativeToGroup(experiment.experimentId, group.name),
              `${experiment.aggregate.observed}/${experiment.aggregate.expected}`,
              ...(current === undefined ? [adapterValue(experiment.adapter), executionValue(experiment.model)] : [String(current.experiments.find(({ experimentId }) => experimentId === experiment.experimentId)!.denominator.missing)]),
              ...(showPassRate ? [passRate(experiment.aggregate.passRate)] : []),
              ...(showScore ? [metric(experiment.aggregate.score)] : []),
            ]),
          },
        ];
      }),
    });
  }
  if (current !== undefined) {
    const currentGroups = groupExperiments(value).flatMap((group) => group.name === null
      ? group.experiments.map((experiment) => ({ name: null, experiments: [experiment] }))
      : [group]);
    for (const group of currentGroups) {
      blocks.push({
        kind: "panel",
        title: `Attempts · ${group.name ?? group.experiments[0]!.experimentId}`,
        blocks: group.experiments.flatMap((experiment) => {
          const experimentCells = value.cells.filter((cell) => cell.experimentId === experiment.experimentId && cell.members.length > 0);
          const gaps = current.plannedAttempts.filter((slot) => slot.experimentId === experiment.experimentId && slot.state === "gap");
          return [
            ...(group.name === null ? [] : [{ kind: "divider" as const, title: `Experiment ${experiment.experimentId}`, attachNext: true }]),
            ...gaps.flatMap((slot): TerminalPanelContentBlock[] => slot.state !== "gap" ? [] : [
              { kind: "divider", title: `Eval ${relativeToGroup(slot.evalId, group.name)}`, attachNext: true },
              { kind: "divider", title: `Gap ${slot.reason}`, attachNext: slot.previous !== null },
              ...(slot.previous === null ? [] : [{ kind: "divider" as const, title: `Previous result ${slot.previous.locator}` }]),
            ]),
            ...attemptBlocks(experimentCells, group.name, all, true),
            ...compactContinuation(experimentCells, experiment.experimentId, all, true),
          ];
        }),
      });
    }
    if (current.history.length > 0) blocks.push({
      kind: "panel",
      title: "History",
      blocks: [{
        kind: "table",
        columns: [{ header: "Experiment" }, { header: "Eval" }, { header: "Attempt" }, { header: "Previous result" }],
        rows: current.history.map((slot) => [slot.experimentId, slot.evalId, String(slot.attemptOrdinal), slot.locator ?? slot.sourceRunId]),
      }],
    });
    const next = current.experiments.filter((experiment) => experiment.denominator.missing > 0);
    return terminal(blocks) + next.map((experiment) => `\nNext: niceeval exp ${experiment.experimentId} --dry\n`).join("");
  }
  if (value.cells.length > 0) {
    for (const group of groupExperiments(value)) {
      const experimentIds = new Set(group.experiments.map(({ experimentId }) => experimentId));
      const cells = value.cells.filter(({ experimentId }) => experimentIds.has(experimentId));
      blocks.push({
        kind: "panel",
        title: group.name === null ? "Attempts" : `Attempts · ${group.name}`,
        blocks: group.experiments.flatMap((experiment) => {
          const experimentCells = cells.filter(({ experimentId }) =>
            experimentId === experiment.experimentId
          );
          return [
            {
              kind: "divider" as const,
              title: `Experiment ${experiment.experimentId}`,
              attachNext: true,
            },
            ...attemptBlocks(experimentCells, group.name, all),
            ...compactContinuation(experimentCells, experiment.experimentId, all),
          ];
        }),
      });
    }
  }
  return terminal(blocks);
}

function adapterValue(value: import("./model.ts").AdapterValue): string {
  if (value.state === "mixed") return "mixed";
  const identity = value.value;
  if (identity === null) return "—";
  return identity.behaviorRevision === null
    ? `${identity.name} (${identity.contract}; revision not declared)`
    : `${identity.name} (${identity.contract}; revision ${identity.behaviorRevision})`;
}

export function renderExperiment(value: ExperimentView): string {
  const { totalCosts, coverage } = value.costSummary;
  return terminal([
    {
      kind: "panel",
      title: `Experiment ${value.experimentId}`,
      blocks: [
        { kind: "divider", title: "Plugins" },
        { kind: "table", columns: ["Name", "Key", "Identity"].map((header) => ({ header })),
          rows: value.plugins.map((plugin) => [plugin.name, plugin.key, JSON.stringify(plugin.identity)]) },
        { kind: "divider", title: "Notes" },
        { kind: "table", columns: ["Label", "Count", "Min", "Median", "P90", "Max"].map((header) => ({ header })),
          rows: value.notes.map((note) => [note.label, String(note.count), ...[note.min, note.median, note.p90, note.max].map((n) => formatNumericUnit(n, note.unit))]) },
        { kind: "divider", title: totalCosts.state === "complete" ? "Experiment total costs" : "Experiment known subtotal" },
        ...totalCostBlocks(totalCosts).slice(1),
        { kind: "keyValue", entries: [
          { key: "Scope", value: "Latest recorded attempts; replaced executions excluded" },
          { key: "Planned attempts", value: String(coverage.plannedAttemptCount) },
          { key: "Recorded attempts", value: String(coverage.recordedAttemptCount) },
          { key: "Unique origin Attempts", value: String(coverage.originAttemptCount) },
          { key: "Attempts with complete costs", value: String(coverage.completeAttemptCount) },
          { key: "Attempts with partial costs", value: String(coverage.partialAttemptCount) },
          { key: "Attempts with unavailable costs", value: String(coverage.unavailableAttemptCount) },
          { key: "Missing attempts", value: String(coverage.missingAttemptCount) },
        ] },
        { kind: "divider", title: "Summary" },
        aggregateEntries(value.aggregate),
        { kind: "divider", title: "Attempts" },
        ...attemptBlocks(value.cells, null, true),
        { kind: "divider", title: "Models and usage" },
        { kind: "keyValue", entries: [
          { key: "Origin Attempts", value: `${value.modelUsage.attempts.length} shown; ${value.modelUsage.totalAttemptCount} selected; ${value.modelUsage.omittedAttemptCount} omitted; ${value.modelUsage.unresolvedAttemptCount} unresolved` },
          { key: "Scope", value: "Per origin Attempt; recorded calls only" },
        ] },
        ...value.modelUsage.attempts.flatMap<TerminalPanelContentBlock>((attempt) => [
          { kind: "divider", title: `Usage ${attempt.locator}` },
          { kind: "keyValue", entries: [
            { key: "Attempt", value: attempt.locator },
            { key: "Origin Run", value: attempt.originRunId },
          ] },
          ...totalCostBlocks(attempt.usage.totalCosts),
          ...modelUsageBlocks(attempt.usage),
          { kind: "divider", title: "Application totals" },
          { kind: "keyValue", entries: usageTotalEntries(attempt.usage.totals) },
        ]),
      ],
    },
  ]);
}

function executionValue(value: ExecutionValue): string {
  return value.state === "available" ? value.value : value.state;
}

// @concord-code
// @concord-implements docs/feature/inspection/use-case/inspection-check-completeness.md
export function renderRun(value: RunView): string {
  const blocks: TerminalBlock[] = [
    {
      kind: "panel",
      title: `Run ${value.runId}`,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Experiment", value: value.experimentId },
            { key: "Adapter", value: value.adapter === null
              ? "not-recorded"
              : adapterValue({ state: "available", value: value.adapter }) },
            { key: "State", value: value.state },
            { key: "Started", value: new Date(value.startedAt).toISOString() },
            ...(value.completedAt === undefined
              ? []
              : [{
                key: "Completed",
                value: new Date(value.completedAt).toISOString(),
              }]),
            {
              key: "Summary",
              value: `${value.observed}/${value.expected} attempts observed`,
            },
          ],
        },
        { kind: "divider", title: "Coverage" },
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: value.coverage.state },
            {
              key: "Members",
              value: `${value.coverage.observedMemberCount}/${value.coverage.expectedMemberCount} observed; ${value.coverage.completeMemberCount} complete`,
            },
            { key: "Facts", value: String(value.coverage.factCount) },
            {
              key: "Limitations",
              value: String(value.coverage.limitations.length),
            },
          ],
        },
        { kind: "divider", title: "Usage" },
        runUsageBlocks(value.usage),
        { kind: "divider", title: "Limitations" },
        runLocatedLimitationTable(value.limitations),
      ],
    },
  ];
  for (const diagnostic of value.diagnostics) {
    const affected = value.members.filter((member) =>
      diagnostic.affectedPlannedAttemptIds.includes(member.plannedAttemptId));
    const stage = {
      "run.before": "Experiment before",
      "run.discovery": "Discovery",
      "run.plan": "Planning",
      "run.dispatch": "Before dispatch",
      "run.after": "Experiment after",
    }[diagnostic.phase];
    blocks.push({
      kind: "panel",
      title: "Run error",
      blocks: [{
        kind: "keyValue",
        entries: [
          { key: "Stage", value: stage },
          { key: "Error", value: diagnostic.summary },
          { key: "Affected attempt count", value: String(affected.length) },
        ],
      }, {
        kind: "table",
        columns: [{ header: "Eval" }, { header: "Attempt ordinal" }],
        rows: affected.map((member) => [member.evalId, String(member.attemptOrdinal)]),
      }],
    });
  }
  for (const member of value.members) {
    blocks.push({
      kind: "panel",
      title: `Member ${member.plannedAttemptId}`,
      meta: member.state,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Eval", value: member.evalId },
            { key: "Attempt ordinal", value: String(member.attemptOrdinal) },
            { key: "Attempt", value: member.locator ?? "not-recorded" },
            { key: "Relation", value: member.relation ?? "not-recorded" },
            { key: "Outcome", value: member.outcome ?? "not-recorded" },
            { key: "Verdict", value: member.verdict ?? "not-recorded" },
            {
              key: "Score",
              value: `${metric(member.score)}${member.verdict === "passed" && member.score.state === "available" && member.score.value !== null ? " (scored)" : ""}`,
            },
          ],
        },
        { kind: "divider", title: "Coverage" },
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: member.coverage.state },
            { key: "Facts", value: String(member.coverage.facts.length) },
            {
              key: "Limitations",
              value: String(member.coverage.limitations.length),
            },
          ],
        },
        { kind: "divider", title: "Usage" },
        memberUsageBlocks(member.usage),
        { kind: "divider", title: "Limitations" },
        runMemberLimitationTable(member.limitations),
      ],
    });
  }
  return terminal(blocks);
}

function runUsageBlocks(
  value: RunView["usage"],
): TerminalPanelContentBlock & { readonly kind: "keyValue" } {
  return {
    kind: "keyValue",
    entries: [
      { key: "State", value: value.state },
      {
        key: "Members",
        value: `${value.observedMemberCount}/${value.expectedMemberCount} observed; ${value.recordedAttemptCount} recorded attempts`,
      },
      ...usageTotalEntries(value.totals),
      { key: "Limitations", value: String(value.limitations.length) },
    ],
  };
}

function memberUsageBlocks(
  value: RunView["members"][number]["usage"],
): TerminalPanelContentBlock & { readonly kind: "keyValue" } {
  return {
    kind: "keyValue",
    entries: [
      { key: "State", value: value.state },
      {
        key: "Summary",
        value: value.summary === null
          ? "not-recorded"
          : `${value.summary.turnCount} turns; ${value.summary.observationCount} observations`,
      },
      ...usageTotalEntries(value.totals),
      {
        key: "Limitations",
        value: boundedPreview(
          value.limitations.length,
          value.limitationsTruncated,
          value.omittedLimitationCount,
        ),
      },
    ],
  };
}

type RunMemberLimitation = RunView["members"][number]["limitations"][number];

function runMemberLimitationTable(
  values: readonly RunMemberLimitation[],
): TerminalPanelContentBlock & { readonly kind: "table" } {
  return {
    kind: "table",
    columns: [{ header: "Limitation" }],
    rows: values.map((value) => [formatRunMemberLimitation(value)]),
    overflow: "wrap",
  };
}

function runLocatedLimitationTable(
  values: RunView["limitations"],
): TerminalPanelContentBlock & { readonly kind: "table" } {
  return {
    kind: "table",
    columns: [
      { header: "Planned attempt" },
      { header: "Attempt" },
      { header: "Limitation" },
    ],
    rows: values.map((value) => [
      value.plannedAttemptId,
      value.locator ?? "not-recorded",
      formatRunMemberLimitation(value.limitation),
    ]),
    overflow: "wrap",
  };
}

function formatRunMemberLimitation(value: RunMemberLimitation): string {
  switch (value.kind) {
    case "member-not-observed":
      return `${value.kind}; ${value.state}`;
    case "attempt-unresolved":
      return `${value.kind}; run ${value.originRunId}; attempt ${value.attemptId}`;
    case "coverage":
      return `${value.kind}; ${formatAttemptLimitation(value.detail)}`;
    case "usage":
      return `${value.kind}; ${formatUsageLimitation(value.detail)}`;
  }
}

type AttemptLimitation = RunView["members"][number]["coverage"]["limitations"][number];

function formatAttemptLimitation(value: AttemptLimitation): string {
  if ("channel" in value) {
    return `${value.channel}; ${value.status}${value.reason === undefined ? "" : `; ${value.reason}`}`;
  }
  return `assertion-material; ${value.state}; ${value.reason}; ${value.limitations.length} material limitations`;
}

// @concord-code
// @concord-implements docs/feature/inspection/cli.md
// @concord-implements docs/feature/error-classification/use-case/reading-errored.md
export function renderAttempt(value: AttemptView): string {
  return terminal([
    {
      kind: "panel",
      title: `Attempt ${value.locator}`,
      meta: value.verdict === "passed" && value.score.state === "complete"
        ? "scored"
        : value.verdict ?? value.outcome,
      blocks: [
        ...(value.totalCosts === undefined ? [] : totalCostBlocks(value.totalCosts)),
        {
          kind: "keyValue",
          entries: [
            { key: "Experiment", value: value.experimentId },
            { key: "Eval", value: value.evalId },
            { key: "Run", value: value.originRunId },
            { key: "Attempt", value: value.attemptId },
            { key: "Planned attempt", value: value.plannedAttemptId },
            { key: "Outcome", value: value.outcome },
            { key: "Verdict", value: value.verdict ?? "not-available" },
            { key: "Score", value: score(value.score, value.verdict) },
          ],
        },
        ...(value.outcome !== "errored" ? [] : [
          { kind: "divider" as const, title: "Failure diagnostics" },
          ...(value.diagnostics?.items.length ? value.diagnostics.items.map((diagnostic) => ({
            kind: "keyValue" as const,
            entries: [
              { key: "Phase", value: diagnostic.phase },
              { key: "Code", value: diagnostic.code },
              { key: "Error", value: diagnostic.summary },
              ...(diagnostic.summaryTruncated ? [{ key: "Summary", value: "partial; see --execution for recorded evidence" }] : []),
            ],
          })) : [{
            kind: "keyValue" as const,
            entries: [{ key: "Diagnostics", value: `unavailable: no recorded diagnostic items (${value.diagnostics?.state ?? "not-read"}); see --execution and --timing for the closest recorded evidence` }],
          }]),
          ...(value.diagnostics?.hasMore ? [{ kind: "keyValue" as const, entries: [{ key: "More diagnostics", value: "see --execution" }] }] : []),
        ]),
        {
          kind: "divider",
          title: `assertions ${value.sections.assertions} · ${value.assertions.entries.length} entries`,
        },
        {
          kind: "keyValue",
          entries: [
            {
              key: "Summary",
              value: `${value.sections.assertions}; entries: ${value.assertions.entries.length}`,
            },
          ],
        },
        {
          kind: "table",
          columns: [
            { header: "Assertion" },
            { header: "Entry ID" },
            { header: "Group" },
          ],
          rows: value.assertions.entries.map((entry) => [
            entry.label ?? entry.key ?? entry.entryId,
            entry.entryId,
            entry.groupPath.length === 0 ? "root" : entry.groupPath.join(" / "),
          ]),
        },
        { kind: "divider", title: "Notes" },
        { kind: "keyValue", entries: value.notes.map((note) => ({
          key: note.label,
          value: note.value === null ? "unavailable" : typeof note.value === "number" ? formatNumericUnit(note.value, note.unit) : JSON.stringify(note.value),
        })) },
        { kind: "divider", title: "Evidence" },
        {
          kind: "keyValue",
          entries: [
            {
              key: "coverage",
              value: value.evidenceCoverage.length === 0
                ? "none"
                : value.evidenceCoverage.join("; "),
            },
            {
              key: "limitations",
              value: value.limitations.length === 0
                ? "none"
                : value.limitations.join("; "),
            },
          ],
        },
        { kind: "divider", title: "Sections" },
        {
          kind: "keyValue",
          entries: [
            { key: "Source", value: value.sections.sources },
            { key: "Execution", value: value.sections.trace },
            { key: "Diagnostics", value: value.sections.diagnostics },
            { key: "Timing", value: value.sections.timing },
            { key: "Usage", value: value.sections.usage },
            { key: "Diff", value: value.sections.diff },
          ],
        },
        { kind: "divider", title: "Next" },
        { kind: "command", command: `niceeval show ${value.locator} --assertions` },
        { kind: "command", command: `niceeval show ${value.locator} --source` },
        {
          kind: "command",
          command: `niceeval show ${value.locator} --execution`,
        },
        { kind: "command", command: `niceeval show ${value.locator} --timing` },
        { kind: "command", command: `niceeval show ${value.locator} --usage` },
        { kind: "command", command: `niceeval show ${value.locator} --diff` },
      ],
    },
  ]);
}

export function renderSources(value: SourcesView): string {
  const blocks: TerminalBlock[] = [
    {
      kind: "panel",
      title: `Captured source ${value.locator}`,
      meta: value.state,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: value.state },
            { key: "Captured items", value: String(value.items.length) },
            {
              key: "Omitted items",
              value: value.hasMore ? String(value.omittedItemCount) : "0",
            },
          ],
        },
      ],
    },
  ];
  for (const item of value.items) {
    blocks.push({
      kind: "panel",
      title: `${item.path} · ${item.sourceItemId} · ${item.byteLength} bytes`,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Bytes", value: String(item.byteLength) },
            { key: "Content", value: item.content.state },
            ...(item.content.state === "omitted"
              ? [
                { key: "Reason", value: item.content.reason },
                {
                  key: "Byte limit",
                  value: `${item.content.byteLimit}/${item.content.byteLength} retained`,
                },
              ]
              : []),
          ],
        },
      ],
    });
    if (item.content.state === "available") {
      blocks.push({ kind: "code", text: item.content.text });
    }
  }
  blocks.push(
    {
      kind: "panel",
      title: "Assertion source facts",
      meta: value.assertions.state,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            {
              key: "Source sites",
              value: String(value.assertions.sites.length),
            },
            {
              key: "Omitted source sites",
              value: value.assertions.hasMoreSourceSites === true
                ? String(value.assertions.omittedSourceSiteCount ?? 0)
                : "0",
            },
          ],
        },
      ],
    },
    {
      kind: "raw",
      text: value.assertions.sites.map((site) =>
        `${site.entryId} · ${site.role} · ${sourceRange(site.start, site.end)} · ${
          site.source.state === "mapped"
            ? `mapped · ${site.source.sourceItemId} · ${site.source.sha256}`
            : `unmapped · ${site.source.reason}`
        }`
      ).join("\n"),
    },
  );
  return terminal(blocks);
}

function sourceRange(
  start: SourcesView["assertions"]["sites"][number]["start"],
  end: SourcesView["assertions"]["sites"][number]["end"],
): string {
  return `start ${start.line}:${start.column} · end ${end.line}:${end.column}`;
}

function safeEventText(text: string): string {
  return Array.from(text).filter((character) => !displayTextHasForbiddenCharacter(character)).join("");
}

function safeEventJson(value: unknown, space?: number): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === "string" ? safeEventText(item) : item, space);
}

function displayPreview(text: { readonly preview: string; readonly omittedBytes: number }, eventId: string): string {
  return safeEventText(text.preview) + (text.omittedBytes === 0 ? "" : `\n… (${text.omittedBytes} more bytes, --expand ${eventId})`);
}

function truncateCodeLine(line: string, width: number): string {
  if (stringWidth(line) <= width) return line;
  let text = "";
  let used = 0;
  for (const character of line) {
    const size = charDisplayWidth(character.codePointAt(0)!);
    if (used + size > width - 1) break;
    text += character;
    used += size;
  }
  return `${text}…`;
}

function displayLines(block: ExecutionDisplayPreviewBlock | ExecutionDisplayDetailBlock, eventId: string, width: number): string[] {
  const textValue = (text: string | { readonly preview: string; readonly omittedBytes: number }): string =>
    typeof text === "string" ? safeEventText(text) : displayPreview(text, eventId);
  switch (block.kind) {
    case "text": return wrapDisplay(textValue(block.text), width);
    case "message": {
      const label = safeEventText(block.speaker ?? block.role);
      const prefix = `${label}: `;
      return wrapDisplay(textValue(block.text), Math.max(4, width - stringWidth(prefix)))
        .map((line, index) => `${index === 0 ? prefix : " ".repeat(stringWidth(prefix))}${line}`);
    }
    case "fields": {
      const labelWidth = Math.max(0, ...block.fields.map((field) => stringWidth(safeEventText(field.label))));
      return block.fields.flatMap((field) => {
        const value = typeof field.value === "object" && field.value !== null
          ? textValue(field.value)
          : typeof field.value === "string" ? safeEventText(field.value) : JSON.stringify(field.value);
        return wrapDisplay(value, Math.max(4, width - labelWidth - 2)).map((line, index) =>
          `${index === 0 ? padDisplay(safeEventText(field.label), labelWidth) : " ".repeat(labelWidth)}  ${line}`);
      });
    }
    case "code": {
      if (typeof block.text === "string") return safeEventText(block.text).split("\n");
      return [
        ...safeEventText(block.text.preview).split("\n").map((line) => truncateCodeLine(line, width)),
        ...(block.text.omittedBytes === 0 ? [] : [`… (${block.text.omittedBytes} more bytes, --expand ${eventId})`]),
      ];
    }
    case "image": return [
      ...wrapDisplay(`[image] ${safeEventText(block.alt)}`, width),
      ...wrapDisplay(`${block.mediaType} · ${block.byteLength} bytes · artifact ${block.artifactId}`, width),
    ];
  }
}

function displayDetailBlocks(block: ExecutionDisplayDetailBlock, locator: string, eventId: string): TerminalBlock[] {
  const lines = displayLines(block, eventId, TERMINAL_OPTIONS.width);
  const blocks: TerminalBlock[] = [{ kind: "code", text: lines.join("\n") }];
  if (block.kind === "image") {
    const request = JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.artifact", locator, artifactId: block.artifactId } });
    blocks.push({ kind: "code", text: `niceeval query run --request - <<'NICEEVAL_REQUEST'\n${request}\nNICEEVAL_REQUEST` });
  }
  return blocks;
}

export function renderTrace(value: TraceView): string {
  const blocks: TerminalBlock[] = [
    {
      kind: "panel",
      title: `Execution ${value.locator}`,
      blocks: [],
    },
    {
      kind: "panel",
      title: "Generic execution traces",
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Capture", value: value.execution.state },
            { key: "Traces", value: String(value.execution.traces.length) },
            {
              key: "Events",
              value: `${value.execution.events.length} shown; ${value.execution.omittedEventCount} remaining in this selection`,
            },
            { key: "Page", value: value.execution.hasMore ? "more events available" : "end of selected events" },
            ...(value.execution.continuation === undefined ? [] : [{ key: "Continuation", value: value.execution.continuation }]),
          ],
        },
        {
          kind: "table",
          columns: [{ header: "Capture limitation" }],
          rows: value.execution.limitations.map((limitation) => [safeEventJson(limitation)]),
          overflow: "wrap",
        },
        ...value.execution.traces.flatMap<TerminalPanelContentBlock>((trace) => [
          { kind: "divider", title: `Trace ${safeEventText(trace.sourceTraceId)}` },
          {
            kind: "keyValue",
            entries: [
              { key: "Trace ID", value: trace.traceId },
              { key: "Producer collection", value: trace.collection.state },
              { key: "Recorded events", value: String(trace.eventCount) },
            ],
          },
          {
            kind: "table",
            columns: [{ header: "Producer limitation" }, { header: "Reason" }],
            rows: trace.collection.limitations.map((limitation) => [safeEventText(limitation.code), safeEventText(limitation.message)]),
            overflow: "wrap",
          },
        ]),
        { kind: "divider", title: "Event page" },
        ...value.execution.events.flatMap<TerminalPanelContentBlock>((event) => [
          { kind: "divider", title: safeEventText(event.type) },
          {
            kind: "keyValue",
            entries: [
              { key: "Event ID", value: event.eventId },
              { key: "Actor", value: safeEventText(event.actor?.label ?? event.actor?.id ?? "not-recorded") },
              { key: "Source", value: safeEventText(event.source.id) },
              ...(event.time === undefined ? [] : [{ key: "Time", value: safeEventText(`${event.time.clockId}: ${event.time.value} ${event.time.unit}`) }]),
              { key: "Summary", value: safeEventText(event.summary) },
            ],
          },
          ...(event.display.state === "absent" ? [] : event.display.blocks.map((block): TerminalPanelContentBlock => ({
            kind: "command",
            command: displayLines(block, event.eventId, panelContentWidth(TERMINAL_OPTIONS.width, TERMINAL_OPTIONS.mode)).join("\n"),
          }))),
        ]),
      ],
    },
    {
      kind: "panel",
      title: `Conversation · ${value.conversation.state}`,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            {
              key: "Turns",
              value: boundedPreview(
                value.conversation.turns.length,
                value.conversation.turnsTruncated,
                value.conversation.omittedTurnCount,
              ),
            },
            {
              key: "Items",
              value: boundedPreview(
                value.conversation.itemCount,
                value.conversation.itemsTruncated,
                value.conversation.omittedItemCount,
              ),
            },
            {
              key: "Limitations",
              value: boundedPreview(
                value.conversation.limitations.length,
                value.conversation.limitationsTruncated,
                value.conversation.omittedLimitationCount,
              ),
            },
          ],
        },
        { kind: "divider", title: "Limitations" },
        limitationTable(value.conversation.limitations),
      ],
    },
  ];
  for (const turn of value.conversation.turns) {
    blocks.push({
      kind: "panel",
      title: `Turn ${turn.turnId}`,
      meta: turn.outcome,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Sequence", value: String(turn.sequence) },
            { key: "Items", value: String(turn.items.length) },
          ],
        },
      ],
    });
    for (const item of turn.items) blocks.push(...traceItemBlocks(item));
  }
  blocks.push({
    kind: "panel",
    title: `Commands · ${value.commands.state}`,
    blocks: [
      {
        kind: "keyValue",
        entries: [
          {
            key: "Items",
            value: boundedPreview(
              value.commands.items.length,
              value.commands.hasMore,
              value.commands.omittedCommandCount,
            ),
          },
          {
            key: "Limitations",
            value: boundedPreview(
              value.commands.limitations.length,
              value.commands.limitationsTruncated,
              value.commands.omittedLimitationCount,
            ),
          },
        ],
      },
      { kind: "divider", title: "Limitations" },
      limitationTable(value.commands.limitations),
      { kind: "divider", title: "Command outline" },
      {
        kind: "table",
        columns: [
          { header: "Command ID" },
          { header: "Phase" },
          { header: "Outcome" },
        ],
        rows: value.commands.items.map((command) => [
          command.commandId,
          command.phase,
          command.outcome,
        ]),
      },
    ],
  });
  blocks.push({
    kind: "panel",
    title: `Diagnostics · ${value.diagnostics.state}`,
    blocks: [
      {
        kind: "keyValue",
        entries: [
          {
            key: "Items",
            value: boundedPreview(
              value.diagnostics.items.length,
              value.diagnostics.hasMore,
              value.diagnostics.omittedDiagnosticCount,
            ),
          },
          {
            key: "Limitations",
            value: boundedPreview(
              value.diagnostics.limitations.length,
              value.diagnostics.limitationsTruncated,
              value.diagnostics.omittedLimitationCount,
            ),
          },
        ],
      },
      { kind: "divider", title: "Limitations" },
      limitationTable(value.diagnostics.limitations),
      { kind: "divider", title: "Diagnostic outline" },
      {
        kind: "table",
        columns: [
          { header: "Diagnostic ID" },
          { header: "Phase" },
          { header: "Kind" },
          { header: "Code" },
          { header: "Summary" },
        ],
        rows: value.diagnostics.items.map((diagnostic) => [
          diagnostic.diagnosticId,
          diagnostic.phase,
          diagnostic.kind,
          diagnostic.code,
          diagnostic.summary,
        ]),
        overflow: "wrap",
      },
    ],
  });
  blocks.push(
    { kind: "panel", title: "Stable identities", blocks: [] },
    {
      kind: "raw",
      text: [
        ...value.execution.events.flatMap((event) => [
          `event ${event.eventId}`,
          ...event.evidence.map((evidence) => `  evidence ${evidence.evidenceId}`),
        ]),
        ...value.identities.itemIds.map((id) => `item ${id}`),
        ...value.identities.toolOccurrenceIds.map((id) =>
          `tool occurrence ${id}`
        ),
        ...value.identities.commandIds.map((id) => `command ${id}`),
      ].join("\n"),
    },
  );
  return terminal(blocks);
}

function boundedPreview(
  shown: number,
  truncated: boolean,
  omitted: number,
): string {
  return `${shown} shown; ${truncated ? `bounded preview, ${omitted} omitted` : "complete preview, 0 omitted"}`;
}

type ProjectionLimitation =
  | TimingView["limitations"][number]
  | TraceView["conversation"]["limitations"][number]
  | TraceView["diagnostics"]["limitations"][number];

function limitationTable(
  limitations: readonly ProjectionLimitation[],
): TerminalPanelContentBlock & { readonly kind: "table" } {
  return {
    kind: "table",
    columns: [{ header: "Limitation" }],
    rows: limitations.map((limitation) => [formatProjectionLimitation(limitation)]),
    overflow: "wrap",
  };
}

function projectionLimitationTable(
  limitations: readonly ProjectionLimitation[],
): TerminalPanelContentBlock & { readonly kind: "table" } {
  return limitationTable(limitations);
}

function formatProjectionLimitation(value: ProjectionLimitation): string {
  if ("issue" in value) return `invalid projection; ${value.issue}`;
  if ("source" in value) {
    if (value.source === "agent-turns") {
      return `${value.source}; turn ${value.turnId}; ${value.channel}; ${value.state}; ${value.reason}`;
    }
    const details = value.limitations.map(formatProjectionLimitation).join("; ");
    return `${value.source}; ${value.state}${details.length === 0 ? "" : `; ${details}`}`;
  }
  switch (value.code) {
    case "capture-failed":
    case "capture-interrupted":
      return `${value.code}; stage ${value.stage}; target ${value.target}`;
    case "collection-cap-reached":
    case "unsupported-input":
      return `${value.code}; target ${value.target}; omitted at least ${value.omittedAtLeast}`;
    case "text-truncated":
    case "redacted":
    case "invalid-utf8-replaced":
    case "unsafe-control-stripped":
      return `${value.code}; target ${value.target}; replaced or omitted ${value.replacementOrOmittedCount}`;
  }
}

type UsageLimitation = UsageView["limitations"][number];

function formatUsageLimitation(value: UsageLimitation): string {
  if ("issue" in value) return value.issue;
  if ("source" in value) {
    return `${value.source}; turn ${value.turnId}; ${value.channel}; ${value.state}; ${value.reason}`;
  }
  return formatProjectionLimitation(value);
}

function traceItemBlocks(item: TraceItem): readonly TerminalBlock[] {
  const entries: { key: string; value: string }[] = [
    { key: "Kind", value: item.kind },
    { key: "Sequence", value: String(item.sequence) },
  ];
  let content: string | null = null;
  switch (item.kind) {
    case "message":
      entries.push({ key: "Role", value: item.role });
      content = item.text;
      break;
    case "tool-call":
      entries.push(
        { key: "Tool", value: item.tool },
        {
          key: "Tool occurrence",
          value: item.toolOccurrenceId ?? "not-recorded",
        },
      );
      content = item.input;
      break;
    case "tool-result":
      entries.push(
        { key: "Outcome", value: item.outcome },
        {
          key: "Tool occurrence",
          value: item.toolOccurrenceId ?? "not-recorded",
        },
      );
      content = item.output;
      break;
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      content = item.summary;
      break;
    case "subagent":
      entries.push(
        { key: "State", value: item.state },
        { key: "Label", value: item.label },
      );
      content = item.summary;
      break;
    case "input-request":
      entries.push({ key: "State", value: item.state });
      content = `Prompt: ${item.prompt}\nResponse: ${textOrNotRecorded(item.response)}`;
      break;
    case "skill-load":
    case "conversation-error":
      entries.push({ key: "Code", value: item.code });
      content = item.summary;
      break;
  }
  return [
    {
      kind: "panel",
      title: `Item ${item.itemId}`,
      blocks: [{ kind: "keyValue", entries }],
    },
    ...(content === null ? [] : [{ kind: "code" as const, text: content }]),
  ];
}

export function renderTraceDetail(value: TraceDetailView): string {
  const body = value.body;
  const heading: TerminalBlock = {
    kind: "panel",
    title: `Execution detail ${value.locator}`,
    meta: `${value.kind} ${value.stableId}`,
    blocks: [],
  };
  if (body.kind === "execution-event") {
    const eventJson = safeEventJson({
      key: body.event.key,
      type: body.event.type,
      source: body.event.source,
      actor: body.event.actor ?? null,
      time: body.event.time ?? null,
      summary: body.event.summary,
      payload: body.event.payload ?? null,
      links: body.event.links,
      scopeMemberships: body.event.scopeMemberships,
    }, 2);
    return terminal([
      heading,
      {
        kind: "panel",
        title: `${safeEventText(body.event.type)} · ${body.event.eventId}`,
        blocks: [{
          kind: "keyValue",
          entries: [
            { key: "Trace", value: body.event.traceId },
            { key: "Source", value: safeEventText(body.event.source.id) },
            { key: "Native event ID", value: safeEventText(body.event.source.eventId ?? "not-recorded") },
            { key: "Client sequence", value: body.event.source.sequence === undefined ? "not-recorded" : String(body.event.source.sequence) },
            { key: "Actor", value: safeEventText(body.event.actor?.id ?? "not-recorded") },
            { key: "Time", value: body.event.time === undefined ? "not-recorded" : safeEventText(`${body.event.time.value} ${body.event.time.unit} (${body.event.time.clockId})`) },
            { key: "Summary", value: safeEventText(body.event.summary) },
            { key: "Evidence", value: String(body.evidence.length) },
          ],
        }],
      },
      ...(body.event.display ?? []).flatMap((block) => displayDetailBlocks(block, value.locator, body.event.eventId)),
      { kind: "divider", title: "Event" },
      { kind: "code", text: eventJson },
      ...body.evidence.flatMap((evidence): readonly TerminalBlock[] => ([
        {
          kind: "panel",
          title: `${safeEventText(evidence.label)} · ${evidence.evidenceId}`,
          meta: evidence.truncated ? "preview" : "complete",
          blocks: [{
            kind: "keyValue",
            entries: [
              { key: "Artifact", value: evidence.artifactId },
              { key: "Pointer", value: safeEventText(evidence.pointer) },
              { key: "Bytes", value: String(evidence.targetByteLength) },
              { key: "Target SHA-256", value: evidence.targetSha256 },
              { key: "Next offset", value: evidence.nextOffset === null ? "complete" : String(evidence.nextOffset) },
            ],
          }],
        },
        { kind: "code", text: safeEventText(executionEvidenceText(evidence.base64)) },
        ...(evidence.nextOffset === null ? [] : [{
          kind: "command" as const,
          command: `Query attempt.trace.detail for ${evidence.evidenceId} with offset ${evidence.nextOffset}`,
        }]),
      ])),
    ]);
  }
  if (body.kind === "execution-evidence") {
    return terminal([
      heading,
      {
        kind: "panel",
        title: `${safeEventText(body.label)} · ${body.evidenceId}`,
        blocks: [{
          kind: "keyValue",
          entries: [
            { key: "Trace", value: body.traceId },
            { key: "Event", value: body.eventId },
            { key: "Artifact", value: body.artifactId },
            { key: "Pointer", value: safeEventText(body.pointer) },
            { key: "Range", value: `${body.offset}..${body.nextOffset ?? body.targetByteLength}` },
            { key: "Target SHA-256", value: body.targetSha256 },
          ],
        }],
      },
      { kind: "code", text: safeEventText(executionEvidenceText(body.base64)) },
      ...(body.nextOffset === null ? [] : [{
        kind: "command" as const,
        command: `Query attempt.trace.detail for ${body.evidenceId} with offset ${body.nextOffset}`,
      }]),
    ]);
  }
  if (body.kind === "item") {
    return terminal([heading, ...traceDetailItemBlocks(body.item)]);
  }
  if (body.kind === "tool-occurrence") {
    return terminal([
      heading,
      {
        kind: "panel",
        title: "Occurrence turns",
        blocks: [
          {
            kind: "keyValue",
            entries: [
              {
                key: "Call",
                value: body.turn.call === null
                  ? "not-recorded"
                  : `${body.turn.call.turnId}; sequence ${body.turn.call.sequence}; ${body.turn.call.outcome}`,
              },
              {
                key: "Result",
                value: body.turn.result === null
                  ? "not-recorded"
                  : `${body.turn.result.turnId}; sequence ${body.turn.result.sequence}; ${body.turn.result.outcome}`,
              },
            ],
          },
        ],
      },
      ...(body.call === null
        ? [{
          kind: "panel" as const,
          title: "Call",
          meta: "not-recorded",
          blocks: [],
        }]
        : traceDetailItemBlocks(body.call, "Call")),
      ...(body.result === null
        ? [{
          kind: "panel" as const,
          title: "Result",
          meta: "not-recorded",
          blocks: [],
        }]
        : traceDetailItemBlocks(body.result, "Result")),
    ]);
  }
  return terminal([
    heading,
    {
      kind: "panel",
      title: `Command ${body.commandId}`,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Invocation", value: commandInvocation(body.invocation) },
            {
              key: "Working directory",
              value: workingDirectory(body.workingDirectory),
            },
            { key: "Outcome", value: commandOutcome(body.outcome) },
            { key: "Turn", value: body.turnId ?? "not-recorded" },
            { key: "Phase", value: body.phase },
            { key: "Sequence", value: String(body.sequence) },
          ],
        },
        { kind: "divider", title: "stdout" },
        streamMetadata(body.stdout),
        { kind: "divider", title: "stderr" },
        streamMetadata(body.stderr),
      ],
    },
    { kind: "code", text: body.stdout.text },
    { kind: "code", text: body.stderr.text },
  ]);
}

function executionEvidenceText(base64: string): string {
  return new TextDecoder("utf-8").decode(decodeBase64Bytes(base64));
}

type TraceDetailItem = Extract<
  TraceDetailView["body"],
  { readonly kind: "item" }
>["item"];

function traceDetailItemBlocks(
  item: TraceDetailItem,
  title = `Item ${item.itemId}`,
): readonly TerminalBlock[] {
  const entries: { key: string; value: string }[] = [
    { key: "Item ID", value: item.itemId },
    { key: "Kind", value: item.kind },
    { key: "Turn", value: item.turnId },
    { key: "Turn sequence", value: String(item.turnSequence) },
    { key: "Turn outcome", value: item.turnOutcome },
    { key: "Session", value: item.sessionId ?? "not-recorded" },
    { key: "Event", value: item.eventId ?? "not-recorded" },
    {
      key: "Sequence",
      value: item.sequence === undefined ? "not-recorded" : String(item.sequence),
    },
  ];
  let content: string | null = null;
  switch (item.kind) {
    case "message":
      entries.push({ key: "Role", value: item.role });
      content = item.text;
      break;
    case "tool-call":
      entries.push(
        { key: "Tool", value: item.tool },
        {
          key: "Tool occurrence",
          value: item.toolOccurrenceId ?? "not-recorded",
        },
      );
      content = item.input;
      break;
    case "tool-result":
      entries.push(
        { key: "Outcome", value: item.outcome },
        {
          key: "Tool occurrence",
          value: item.toolOccurrenceId ?? "not-recorded",
        },
      );
      content = item.output;
      break;
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      content = item.summary;
      break;
    case "subagent":
      entries.push(
        { key: "State", value: item.state },
        { key: "Label", value: item.label },
      );
      content = item.summary;
      break;
    case "input-request":
      entries.push({ key: "State", value: item.state });
      content = `Prompt: ${item.prompt}\nResponse: ${textOrNotRecorded(item.response)}`;
      break;
    case "skill-load":
    case "conversation-error":
      entries.push({ key: "Code", value: item.code });
      content = item.summary;
      break;
  }
  return [
    {
      kind: "panel",
      title,
      blocks: [{ kind: "keyValue", entries }],
    },
    ...(content === null ? [] : [{ kind: "code" as const, text: content }]),
  ];
}

type CommandDetail = Extract<
  TraceDetailView["body"],
  { readonly kind: "command" }
>;

function streamMetadata(
  stream: CommandDetail["stdout"],
): TerminalPanelContentBlock & { readonly kind: "keyValue" } {
  return {
    kind: "keyValue",
    entries: [
      { key: "Retained bytes", value: String(stream.retainedBytes) },
      { key: "Total safe UTF-8 bytes", value: String(stream.totalSafeUtf8Bytes) },
      { key: "SHA-256", value: stream.sha256 },
      { key: "Truncation", value: stream.truncation.state },
      {
        key: "Omitted safe UTF-8 bytes",
        value: String(stream.truncation.omittedSafeUtf8Bytes),
      },
    ],
  };
}

function commandInvocation(value: CommandDetail["invocation"]): string {
  return value.kind === "shell"
    ? value.command
    : [value.executable, ...value.arguments].join(" ");
}

function workingDirectory(value: CommandDetail["workingDirectory"]): string {
  return value.kind === "project-relative" ? value.path : value.kind;
}

function commandOutcome(value: CommandDetail["outcome"]): string {
  if (value.kind === "exited") return `exited; code ${value.exitCode}`;
  return `${value.kind}; ${value.reason}`;
}

export function renderTiming(value: TimingView): string {
  const piped = process.stdout.isTTY !== true;
  const headers = piped
    ? ["Activity ID", "Parent", "Turn", "Phase", "Label", "Start", "Duration", "Outcome"]
    : ["Phase", "Label", "Duration", "Outcome"];
  const rows = value.activities.map((activity) => piped ? [
    activity.activityId,
    activity.parentActivityId ?? "none",
    activity.turnId ?? "none",
    activity.phase,
    activity.label,
    `${fmt(activity.startOffsetMs)} ms`,
    `${fmt(activity.durationMs)} ms`,
    activity.outcome,
  ] : [activity.phase, activity.label, `${fmt(activity.durationMs)} ms`, activity.outcome]);
  const widths = headers.map((header, index) => Math.max(stringWidth(header), ...rows.map((row) => stringWidth(row[index]!))));
  const width = piped ? Math.max(80, widths.reduce((sum, size) => sum + size, 0) + 2 * headers.length) : process.stdout.columns || 80;
  return renderTerminal([
    {
      kind: "panel",
      title: `Timing ${value.locator}`,
      meta: value.state,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: value.state },
            { key: "Activities", value: String(value.activities.length) },
            {
              key: "Omitted activities",
              value: value.hasMore ? String(value.omittedActivityCount) : "0",
            },
            { key: "Limitations", value: String(value.limitations.length) },
          ],
        },
        { kind: "divider", title: "Limitations" },
        projectionLimitationTable(value.limitations),
        { kind: "divider", title: "Activities" },
        {
          kind: "table",
          columns: headers.map((header, index) => ({ header, maxWidth: widths[index] })),
          rows,
          overflow: "wrap",
        },
        ...(value.activities.some((activity) => activity.outcome === "failed") ? [
          { kind: "divider" as const, title: "Failed activities" },
          ...value.activities.filter((activity) => activity.outcome === "failed").map((activity) => ({
            kind: "keyValue" as const,
            entries: [
              { key: "Label", value: activity.label },
              { key: "Phase", value: activity.phase },
              { key: "Activity ID", value: activity.activityId },
              { key: "Parent", value: activity.parentActivityId ?? "none" },
              { key: "Turn", value: activity.turnId ?? "none" },
              { key: "Duration", value: `${fmt(activity.durationMs)} ms` },
            ],
          })),
        ] : []),
      ],
    },
  ], { ...TERMINAL_OPTIONS, width });
}

type UsageTotals = UsageView["totals"];

function numericUsageTotal(
  total: UsageTotals["inputTokens"],
): string {
  return `${total.value === null ? "not-recorded" : fmt(total.value)} (${total.state}; ${total.observationCount} observations)`;
}

function usageTotalEntries(
  totals: UsageTotals,
): readonly { readonly key: string; readonly value: string }[] {
  return [
    { key: "Input tokens", value: numericUsageTotal(totals.inputTokens) },
    ...(totals.inputTotalTokens === undefined ? [] : [{ key: "Input including cache", value: numericUsageTotal(totals.inputTotalTokens) }]),
    { key: "Output tokens", value: numericUsageTotal(totals.outputTokens) },
    { key: "Requests", value: numericUsageTotal(totals.requests) },
    totals.costs === undefined
      ? {
          key: "Provider costs",
          value: `${totals.providerCosts?.state ?? "unavailable"}; ${totals.providerCosts?.observationCount ?? 0} observations${
            (totals.providerCosts?.values.length ?? 0) === 0
              ? "; no recorded values"
              : `; ${totals.providerCosts!.values.map((cost) =>
                `${cost.value} ${cost.currency} (${cost.observationCount} observations)`
              ).join("; ")}`
          }`,
        }
      : {
          key: "Application cost",
          value: `${totals.costs.state}${totals.costs.state === "partial" ? "; known subtotal" : ""}; ${totals.costs.source ?? "unknown"}; ${
            totals.costs.values.length === 0
              ? `0/${totals.costs.totalCalls} covered calls; no recorded values`
              : totals.costs.values.map((cost) =>
                `${cost.value} ${cost.currency} (${cost.coveredCalls}/${totals.costs!.totalCalls} covered calls; ${cost.source}; ${cost.estimatedCalls} estimated)`
              ).join("; ")
          }`,
        },
  ];
}

function totalCostBlocks(costs: UsageView["totalCosts"]): readonly TerminalPanelContentBlock[] {
  const complete = costs.state === "complete";
  return [
    { kind: "divider", title: complete ? "Total costs" : "Known subtotal" },
    { kind: "keyValue", entries: [
      { key: "Cost coverage", value: complete ? "Complete" : "Incomplete" },
      ...(costs.missingSources.length === 0 ? [] : [{ key: "Missing sources", value: costs.missingSources.join(", ") }]),
      ...(costs.values.length === 0 ? [{ key: "Amount", value: complete ? "No recorded charges" : "Unavailable" }] : []),
    ] },
    ...(costs.values.length === 0 ? [] : [{ kind: "table" as const,
      columns: [{ header: "Currency" }, { header: complete ? "Total" : "Known subtotal" }, { header: "Source" }],
      rows: costs.values.map((cost) => [cost.currency, cost.value, cost.source]), overflow: "wrap" as const }]),
  ];
}

function cacheReadBlocks(report: import("../o11y/cache-read.ts").CacheReadReport | undefined): readonly TerminalPanelContentBlock[] {
  if (report === undefined) return [];
  const row = (label: string, summary: import("../o11y/cache-read.ts").CacheReadSummary) => [
    label, summary.rate.state === "exact" ? `${(summary.rate.value * 100).toFixed(2)}%` : "Unavailable",
    `${summary.coveredCalls}/${summary.recordedCalls}`, summary.collectionComplete ? "Complete" : "Incomplete",
    summary.reasons.join(", ") || "—",
  ];
  return [{ kind: "divider", title: "Cache read rate" }, { kind: "table",
    columns: [{ header: "Scope" }, { header: "Rate" }, { header: "Covered calls" }, { header: "Collection" }, { header: "Reasons" }],
    rows: [row("Total", report.total), ...report.roles.map((group) => row(`Role: ${group.modelRole ?? "not-recorded"}`, group)),
      ...report.models.map((group) => row(`${group.modelRole ?? "not-recorded"} / ${group.provider ?? "not-recorded"} / ${group.model ?? "not-recorded"}`, group))], overflow: "wrap" }];
}

function modelUsageBlocks(
  value: Pick<UsageView, "configuredModels" | "modelGroups" | "totalCosts"> & { readonly judgeUsage: import("../inspection/results.ts").JudgeUsageSummary; readonly cacheRead?: import("../o11y/cache-read.ts").CacheReadReport },
): readonly TerminalPanelContentBlock[] {
  const configured = value.configuredModels;
  const groups = value.modelGroups;
  const recordedCalls = (count: number | null): string => count === null ? "—" : count === 0 ? "0 (no recorded calls)" : String(count);
  const defaultBinding = configured.state === "available" && configured.bindings.length === 1 && configured.bindings[0].modelRole === "default" ? configured.bindings[0] : null;
  const configurationBlocks: readonly TerminalPanelContentBlock[] = configured.state !== "available"
    ? [{ kind: "keyValue", entries: [{ key: "Configuration", value: configured.state }] }]
    : defaultBinding !== null
    ? [{ kind: "keyValue", entries: [
      { key: "Configured model (default)", value: defaultBinding.model ?? "—" },
      ...(defaultBinding.reasoningEffort === null ? [] : [{ key: "Effort", value: defaultBinding.reasoningEffort }]),
      { key: "Recorded calls", value: recordedCalls(defaultBinding.recordedCalls) },
    ] }]
    : configured.bindings.length === 0
    ? [{ kind: "keyValue", entries: [{ key: "Configured roles", value: "0" }] }]
    : [{ kind: "table", columns: [{ header: "Role" }, { header: "Configured model" }, { header: "Effort" }, { header: "Recorded calls" }],
      rows: configured.bindings.map((binding) => [binding.modelRole, binding.model ?? "—", binding.reasoningEffort ?? "—", recordedCalls(binding.recordedCalls)]), overflow: "wrap" }];
  return [
    ...cacheReadBlocks(value.cacheRead),
    { kind: "divider", title: "Configured model roles" },
    ...configurationBlocks,
    { kind: "divider", title: "Actual model usage" },
    { kind: "keyValue", entries: [
      { key: "State", value: groups.state },
      { key: "Basis", value: groups.basis },
      { key: "Groups", value: `${groups.groups.length} shown; ${groups.totalGroupCount ?? "unknown"} total; ${groups.omittedGroupCount} omitted${groups.groupsTruncated ? " (truncated)" : ""}` },
      ...("reason" in groups && groups.reason !== undefined ? [{ key: "Reason", value: groups.reason }] : []),
    ] },
    { kind: "table", columns: [
      { header: "Role / provider / actual model", maxWidth: 30 },
      { header: "Calls / tokens", maxWidth: 18 }, { header: "Application cost", maxWidth: 24 },
    ], rows: groups.groups.map((group) => [
      `Role: ${group.modelRole ?? "not-recorded"}\nProvider: ${group.provider ?? "not-recorded"}\n${group.model ?? "not-recorded"}`,
      `${group.recordedCalls} calls\nInput incl. cache: ${metric(group.tokens.inputTotalTokens)}\nOutput: ${metric(group.tokens.outputTokens)}\nTotal: ${metric(group.tokens.totalTokens)}`,
      group.costs.values.length === 0 ? group.costs.state : group.costs.values.map((cost) =>
        `${cost.value} ${cost.currency} (${group.costs.state}${group.costs.state === "partial" ? "; known subtotal" : ""}; ${cost.coveredCalls}/${group.costs.totalCalls} covered; ${cost.source})`
      ).join("; "),
    ]), overflow: "wrap" },
    { kind: "divider", title: "Judge usage" },
    { kind: "keyValue", entries: "totals" in value.judgeUsage ? [
      { key: "Physical calls", value: value.judgeUsage.totals.requests.value === 0 && value.judgeUsage.totals.requests.state === "available" ? "No Judge calls" : metric(value.judgeUsage.totals.requests) },
      { key: "Input tokens", value: metric(value.judgeUsage.totals.inputTotalTokens) },
      { key: "Output tokens", value: metric(value.judgeUsage.totals.outputTokens) },
      { key: "Total tokens", value: metric(value.judgeUsage.totals.totalTokens) },
      { key: "Cost", value: value.judgeUsage.totals.costs.state },
      ...value.judgeUsage.totals.costs.values.map((cost) => ({ key: cost.currency,
        value: `${cost.value} (${cost.coveredCalls}/${value.judgeUsage.state === "complete" || value.judgeUsage.state === "partial" ? value.judgeUsage.totals.costs.totalCalls : "unknown"} covered; ${cost.source})` })),
    ] : [{ key: "State", value: `${value.judgeUsage.state}; ${value.judgeUsage.reason}` }] },
  ];
}

export function renderUsage(value: UsageView): string {
  return terminal([
    {
      kind: "panel",
      title: `Usage ${value.locator}`,
      meta: value.state,
      blocks: [
        ...totalCostBlocks(value.totalCosts),
        { kind: "divider", title: "Application usage" },
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: value.state },
            ...(value.source === "adapter" ? [
              { key: "Coverage", value: "Recorded calls only" },
              { key: "Calls", value: boundedPreview(value.calls?.length ?? 0, value.callsTruncated ?? false, value.omittedCallCount ?? 0) },
            ] : []),
            ...usageTotalEntries(value.totals),
            {
              key: "Limitations",
              value: boundedPreview(
                value.limitations.length,
                value.limitationsTruncated,
                value.omittedLimitationCount,
              ),
            },
            {
              key: "Turns",
              value: boundedPreview(
                value.turns.length,
                value.turnsTruncated,
                value.omittedTurnCount,
              ),
            },
            {
              key: "Omitted observations",
              value: value.hasMore ? String(value.omittedObservationCount) : "0",
            },
          ],
        },
        ...modelUsageBlocks(value),
        { kind: "divider", title: "Limitations" },
        {
          kind: "table",
          columns: [{ header: "Limitation" }],
          rows: value.limitations.map((limitation) => [
            formatUsageLimitation(limitation),
          ]),
          overflow: "wrap",
        },
        { kind: "divider", title: value.totals.costs === undefined ? "Provider costs" : "Application costs" },
        {
          kind: "table",
          columns: [
            { header: "Currency" },
            { header: "Value" },
            { header: "State" },
            { header: "Observations" },
          ],
          rows: value.totals.costs === undefined
            ? (value.totals.providerCosts?.values ?? []).map((cost) => [
                cost.currency,
                cost.value,
                value.totals.providerCosts!.state,
                String(cost.observationCount),
              ])
            : value.totals.costs.values.map((cost) => [
                cost.currency,
                cost.value,
                value.totals.costs!.state,
                `${cost.coveredCalls}/${value.totals.costs!.totalCalls}`,
              ]),
        },
        { kind: "divider", title: "Turn coverage" },
        {
          kind: "table",
          columns: [
            { header: "Turn" },
            { header: "Coverage" },
            { header: "Reason" },
          ],
          rows: value.turns.map((turn) => [
            turn.turnId,
            turn.coverage.state,
            turn.coverage.state === "complete" ? "none" : turn.coverage.reason,
          ]),
        },
        { kind: "divider", title: "Observation provenance" },
        {
          kind: "table",
          columns: [
            { header: "Turn" },
            { header: "Observation ID" },
            { header: "Kind" },
            { header: "Provider" },
            { header: "Recorded value" },
          ],
          rows: value.observations.map((observation) => [
            observation.turnId,
            observation.usageObservationId,
            observation.kind,
            observation.provider,
            usageObservationValue(observation),
          ]),
          overflow: "wrap",
        },
      ],
    },
  ]);
}

function usageObservationValue(
  value: UsageView["observations"][number],
): string {
  switch (value.kind) {
    case "token-bucket":
      return `${value.bucket}; ${value.tokens} tokens`;
    case "request":
      return value.requestKind;
    case "provider-cost":
      return `${value.amount} ${value.currency}`;
  }
}

export function renderDiff(value: DiffView): string {
  const statusBlocks: TerminalPanelContentBlock[] = [
    {
      kind: "keyValue",
      entries: [
        { key: "State", value: value.state },
        { key: "Windows", value: String(value.windows.length) },
      ],
    },
  ];
  if (value.state === "invalid") {
    statusBlocks.push(
      { kind: "divider", title: "Issues" },
      {
        kind: "table",
        columns: [{ header: "Issue" }],
        rows: value.issues.map((issue) => [issue]),
        overflow: "wrap",
      },
    );
  }
  if (value.state === "complete" || value.state === "partial") {
    statusBlocks.push(
      { kind: "divider", title: "Limitations" },
      {
        kind: "table",
        columns: [{ header: "Limitation" }],
        rows: value.limitations.map((limitation) => [
          formatDiffLimitation(limitation),
        ]),
        overflow: "wrap",
      },
    );
  }
  const blocks: TerminalBlock[] = [
    {
      kind: "panel",
      title: `Diff ${value.locator}`,
      meta: value.state,
      blocks: statusBlocks,
    },
  ];
  for (const window of value.windows) {
    blocks.push({
      kind: "panel",
      title: `Window ${window.windowId}`,
      meta: `sequence ${window.sequence}`,
      blocks: [
        {
          kind: "keyValue",
          entries: [{ key: "Changes", value: String(window.changes.length) }],
        },
      ],
    });
    for (const change of window.changes) {
      blocks.push({
        kind: "panel",
        title: `Change ${change.changeId}`,
        meta: change.kind,
        blocks: [
          {
            kind: "keyValue",
            entries: [
              { key: "Path", value: change.path },
              { key: "Before", value: fileEndpoint(change.before) },
              { key: "After", value: fileEndpoint(change.after) },
            ],
          },
        ],
      });
    }
  }
  return terminal(blocks);
}

type DiffLimitation = Extract<
  DiffView,
  { readonly state: "complete" | "partial" }
>["limitations"][number];

function formatDiffLimitation(value: DiffLimitation): string {
  switch (value.code) {
    case "capture-failed":
    case "capture-interrupted":
      return `${value.code}; stage ${value.stage}; window ${value.atWindowId ?? "not-recorded"}`;
    case "collection-cap-reached":
      return `${value.code}; target ${value.target}; omitted at least ${value.omittedAtLeast}; window ${value.atWindowId ?? "not-recorded"}`;
    case "unsupported-input":
      return `${value.code}; target ${value.target}; omitted at least ${value.omittedAtLeast}`;
  }
}

type DiffEndpoint = Extract<
  DiffView["windows"][number]["changes"][number]["before"],
  { readonly state: "absent" | "present" }
>;

function fileEndpoint(value: DiffEndpoint): string {
  if (value.state === "absent") return "absent";
  const revision = value.revision;
  if (revision.kind === "text") {
    return `text; ${revision.content}; ${revision.byteLength} bytes; ${revision.sha256}`;
  }
  if (revision.kind === "elided") {
    return `elided; ${revision.reason}; ${revision.byteLength} bytes`;
  }
  return `unavailable; ${revision.reason}`;
}

export function traceSelector(value: TraceView, id: string) {
  if (value.execution.identityIndex.eventIds.includes(id)) {
    return { kind: "execution-event" as const, eventId: id };
  }
  if (value.execution.identityIndex.evidenceIds.includes(id)) {
    return { kind: "execution-evidence" as const, evidenceId: id };
  }
  if (value.identities.itemIds.includes(id)) {
    return { kind: "item" as const, itemId: id };
  }
  if (value.identities.toolOccurrenceIds.includes(id)) {
    return { kind: "tool-occurrence" as const, toolOccurrenceId: id };
  }
  if (value.identities.commandIds.includes(id)) {
    return { kind: "command" as const, commandId: id };
  }
  return undefined;
}

type Comparison = import("../inspection/index.ts").InspectionSuccessDocumentFor<"runs.compare">["comparison"];
export type ComparisonAttempt = Pick<AttemptView, "verdict" | "score" | "totalCosts">;
type ComparisonAttempts = ReadonlyMap<string, ComparisonAttempt>;

export function comparisonTransition(left: Pick<AttemptView, "verdict">, right: Pick<AttemptView, "verdict">): string {
  if (left.verdict === "passed" && right.verdict === "passed") return "stable-passed";
  if (left.verdict === "failed" && right.verdict === "failed") return "stable-failed";
  if (left.verdict === "passed" && right.verdict === "failed") return "regressed";
  if (left.verdict === "failed" && right.verdict === "passed") return "improved";
  return "incomparable";
}

export function comparisonRegressions(comparison: Comparison, attempts: ComparisonAttempts): number {
  return comparison.pairs.filter(({ left, right }) =>
    comparisonTransition(attempts.get(left.locator)!, attempts.get(right.locator)!) === "regressed",
  ).length;
}

function comparisonCostDelta(left: ComparisonAttempt, right: ComparisonAttempt): string {
  if (left.totalCosts?.state !== "complete" || right.totalCosts?.state !== "complete") return "unavailable";
  const currencies = new Set([...left.totalCosts.values, ...right.totalCosts.values].map(({ currency }) => currency));
  return [...currencies].map((currency) => {
    const a = left.totalCosts!.values.find((value) => value.currency === currency);
    const b = right.totalCosts!.values.find((value) => value.currency === currency);
    if (a === undefined || b === undefined) return `${currency} unavailable`;
    // Align decimal places before subtraction so recorded money never passes through binary floats.
    const places = Math.max(a.value.split(".")[1]?.length ?? 0, b.value.split(".")[1]?.length ?? 0);
    const integer = (value: string) => {
      const [whole, fraction = ""] = value.split(".");
      return BigInt(`${whole}${fraction.padEnd(places, "0")}`);
    };
    const delta = integer(b.value) - integer(a.value);
    const digits = (delta < 0n ? -delta : delta).toString().padStart(places + 1, "0");
    return `${currency} ${delta < 0n ? "-" : delta > 0n ? "+" : ""}${places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`}`;
  }).join("; ") || "No charged calls";
}

export function renderComparison(comparison: Comparison, attempts: ComparisonAttempts): string {
  const blocks: TerminalBlock[] = [{ kind: "divider", title: `Run comparison · ${comparison.mode}` }];
  const memberRows = (members: Comparison["left"]["members"]) => members.map((member) => {
    const attempt = attempts.get(member.locator)!;
    return [member.evalId, String(member.attemptOrdinal), member.locator, attempt.verdict ?? "unavailable", score(attempt.score, attempt.verdict), attempt.totalCosts?.values.map(({ currency, value }) => `${currency} ${value}`).join("; ") || "unavailable", attempt.totalCosts?.state ?? "unavailable"];
  });
  if (comparison.mode === "side-by-side") {
    for (const side of ["left", "right"] as const) {
      blocks.push({ kind: "divider", title: side === "left" ? "Baseline" : "Candidate" }, {
        kind: "table", columns: ["Eval", "Ordinal", "Attempt", "Verdict", "Score", "Costs", "Cost state"].map((header) => ({ header })),
        rows: memberRows(comparison[side].members), overflow: "wrap",
      });
    }
  } else {
    for (const { left, right } of comparison.pairs) {
      const a = attempts.get(left.locator)!;
      const b = attempts.get(right.locator)!;
      const delta = a.score.state === "complete" && b.score.state === "complete" && a.score.possible === b.score.possible
        ? fmt(b.score.earned - a.score.earned) : "unavailable";
      blocks.push({ kind: "divider", title: `${left.evalId} · ${left.attemptOrdinal}` }, {
        kind: "keyValue", entries: [
          { key: "Baseline", value: `${left.locator} · ${a.verdict ?? "unavailable"} · ${score(a.score, a.verdict)}` },
          { key: "Candidate", value: `${right.locator} · ${b.verdict ?? "unavailable"} · ${score(b.score, b.verdict)}` },
          { key: "Transition", value: comparisonTransition(a, b) },
          { key: "Score delta", value: delta },
          { key: "Cost delta", value: comparisonCostDelta(a, b) },
        ],
      });
    }
  }
  blocks.push({ kind: "keyValue", entries: [
    { key: "Members", value: `${comparison.left.members.length} baseline; ${comparison.right.members.length} candidate` },
    { key: "Paired", value: String(comparison.pairs.length) },
    ...["stable-passed", "stable-failed", "improved", "incomparable"].map((transition) => ({ key: transition, value: comparison.mode === "side-by-side" ? "not evaluated" : String(comparison.pairs.filter(({ left, right }) => comparisonTransition(attempts.get(left.locator)!, attempts.get(right.locator)!) === transition).length) })),
    { key: "Regressed", value: comparison.mode === "side-by-side" ? "not evaluated" : String(comparisonRegressions(comparison, attempts)) },
    { key: "Exact member set", value: String(comparison.exactMemberSet) },
  ] });
  return terminal(blocks);
}

export function renderReferences(project: InspectionProjectResult): string {
  return terminal([{
    kind: "panel", title: "Historical reference results", blocks: [{
      kind: "table", columns: [{ header: "Experiment" }, { header: "Eval" }, { header: "Attempt" }, { header: "Previous result" }],
      rows: project.history.map((slot) => [slot.experimentId, slot.evalId, String(slot.attemptOrdinal), slot.locator ?? slot.sourceRunId]),
    }],
  }]);
}

export function renderAssertions(locator: string, assertions: readonly AssertionDetailResult[], options: { readonly full: boolean; readonly entryId?: string } = { full: false }): string {
  const blocks: TerminalPanelContentBlock[] = [];
  let passed = 0;
  let failed = 0;
  let total = 0;
  let earnedScore = 0;
  let totalScore = 0;

  for (const assertion of assertions) {
    if (!("entry" in assertion)) continue;
    total += 1;
    const entry = assertion.entry;
    if (entry.decision.result === "matched") passed += 1;
    else if (entry.decision.result === "mismatched") failed += 1;
    if (entry.contribution.state === "earned") {
      earnedScore += entry.contribution.earned;
      totalScore += entry.contribution.points;
    }
  }

  if (total > 0) {
    blocks.push({
      kind: "divider",
      title: `Passed ${passed}, Failed ${failed}, Total ${total}${totalScore > 0 ? ` (score: ${fmt(earnedScore)}/${fmt(totalScore)})` : ""}`,
    });
  }

  for (const assertion of assertions) {
    if (!("entry" in assertion)) {
      blocks.push({ kind: "divider", title: `${assertion.entryId}: ${assertion.state}` });
      continue;
    }
    const entry = assertion.entry;
    const status = entry.decision.result === "matched" ? "PASS" : entry.decision.result === "mismatched" ? "FAIL" : entry.decision.result.toUpperCase();
    const contribution = entry.contribution;
    const points = contribution.state === "earned" ? `${fmt(contribution.earned)}/${fmt(contribution.points)}` : contribution.state;
    blocks.push({ kind: "divider", title: `[${status}] ${entry.display.key ?? entry.entryId} · ${assertion.check.label} (${points})` });
    const reasons = assertionReasons(entry.evaluation.observed);
    if (entry.explanationRetention.state === "retained") reasons.push(...assertionReasons(entry.explanationRetention.value));
    blocks.push({ kind: "keyValue", entries: [
      ...(entry.decision.reason === null ? [] : [{ key: "Reason", value: entry.decision.reason }]),
      ...[...new Set(reasons)].map((value) => ({ key: "Rationale", value })),
    ] });
    if (options.full) {
      if (entry.criterion.state === "available" && "kind" in entry.criterion.value && entry.criterion.value.kind === "builtin" && entry.criterion.value.id === "sandbox-change-scope/v1") {
        blocks.push({ kind: "keyValue", entries: [{ key: "Criterion", value: entry.criterion.value.id }, { key: "Allowed paths", value: entry.criterion.value.data.paths.join(", ") }] });
      }
      if (entry.explanationRetention.state === "retained") {
        const value = entry.explanationRetention.value;
        if (value.kind === "fields") {
          const labels: Readonly<Record<string, string>> = { message: "Diagnostic", expected: "Expected", received: "Received" };
          blocks.push({ kind: "keyValue", entries: value.fields.flatMap(field => labels[field.label] !== undefined && field.value.kind === "value" && typeof field.value.value === "string"
            ? [{ key: labels[field.label]!, value: field.value.value }] : []) });
        }
      }
      if (assertion.matcher.state === "available" && assertion.matcher.sourceLedger.sourceSnapshot.scope === "session") {
        blocks.push({ kind: "keyValue", entries: [{ key: "Session", value: assertion.matcher.sourceLedger.sourceSnapshot.sessionId }] });
      }
    }
    const debuggerView = assertion.matcher.debugger;
    if (options.full && debuggerView?.state === "current" && debuggerView.steps.length > 0) {
      blocks.push({ kind: "table", columns: [{ header: "Step" }, { header: "State" }, { header: "Source row" }],
        rows: debuggerView.steps.map((step) => [String(step.step), step.state, step.sourceRow ?? "not-recorded"]), overflow: "wrap" });
    }
    if (!options.full || options.entryId !== entry.entryId) {
      blocks.push({ kind: "divider", title: "Next" });
      blocks.push({ kind: "command", command: `niceeval show ${locator} --assertions --entry ${JSON.stringify(entry.entryId)} --full` });
    }
  }
  if (assertions.length === 0) blocks.push({ kind: "divider", title: "No Assertion entries recorded" });
  return terminal([{ kind: "panel", title: `Assertions ${locator}`, blocks }]);
}

function assertionReasons(value: AssertionFactValue): string[] {
  if (value.kind !== "fields") return [];
  const state = value.fields.find((field) => field.label === "state")?.value;
  if (state?.kind === "value" && state.value === "unavailable") return [];
  return value.fields.flatMap((field) => {
    if (field.label === "rationale" || field.label === "reason") {
      if (field.value.kind === "value" && typeof field.value.value === "string") return [field.value.value];
      if (field.label === "rationale" && field.value.kind === "fields") {
        const state = field.value.fields.find((item) => item.label === "state")?.value;
        const text = field.value.fields.find((item) => item.label === "value")?.value;
        if (state?.kind === "value" && state.value === "available" && text?.kind === "value" && typeof text.value === "string") return [text.value];
      }
    }
    return assertionReasons(field.value);
  });
}

export function renderAssertionMatrix(matrix: import("../inspection/assertion-matrix.ts").AssertionMatrix): string {
  const blocks: TerminalBlock[] = [];
  for (const value of matrix.evals) {
    blocks.push({ kind: "divider", title: value.evalId });
    blocks.push({ kind: "raw", text: "* marks different decisions or scores across columns." });
    value.columns.forEach((column, index) => blocks.push({ kind: "raw", text: `${index + 1}: ${column.experimentId} #${column.attemptOrdinal} ${column.locator ?? (column.publication.state === "absent" ? column.publication.reason : "pending")}` }));
    blocks.push({ kind: "table", columns: [{ header: "Criterion" }, ...value.columns.map((_, index) => ({ header: String(index + 1) }))], rows: [
      ["Verdict / score", ...value.columns.map((column) => `${column.verdict ?? "—"} / ${metric(column.score)}`)],
      ...value.rows.map((row) => [`${row.distinct ? "* " : ""}${[...row.groupPath, row.label ?? row.key ?? ""].join(" / ")}`, ...row.cells.map((cell) => cell.state === "absent" ? "—" : cell.state !== "available" ? cell.state : cell.entries.map(({ result, contribution }) => contribution.state === "earned" ? `${fmt(contribution.earned)}/${fmt(contribution.points)}` : contribution.state === "unavailable" ? `${result} (—/${fmt(contribution.points)})` : result).join("; "))]),
    ] });
    if (value.unkeyed.some((count) => count > 0)) blocks.push({ kind: "raw", text: `Unkeyed entries by column: ${value.unkeyed.join(", ")}` });
  }
  blocks.push({ kind: "raw", text: `Matrix ${matrix.state}; omitted: ${matrix.omitted.evals} evals, ${matrix.omitted.rows} rows, ${matrix.omitted.columns} columns.` });
  return terminal(blocks);
}
