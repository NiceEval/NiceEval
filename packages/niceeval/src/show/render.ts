// @concord-file
// @concord-implements docs/feature/inspection/cli.md
// @concord-implements docs/feature/inspection/architecture.md#run-inspection-insight
import type { AgentJudgeTrace } from "../assertions/agent-judge-audit.ts";
import { assertionRoleLabel, assertionRoleCounts, assertionVerdictLine } from "../assertions/display.ts";
import type { InspectionSuccessDocumentFor } from "../inspection/protocol.ts";
import type { InspectionAttemptResult } from "../inspection/results.ts";
import type { AssertionDetailResult, PagedAssertionDetailSchema } from "../inspection/assertion-result.ts";
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
import { projectMetric } from "./model.ts";
import { inspectionShellWord } from "../inspection/addressing.ts";
import { decodeBase64Bytes } from "../inspection/bytes.ts";
import { displayTextHasForbiddenCharacter } from "../record/family/execution-traces/schema.ts";
import type { InspectionProjectResult } from "../inspection/project-result.ts";
import type { IdentityExplanation } from "../runner/manifest.ts";
import { countedSummaries, factPhrase, recordedTextSummary, structuredSummary } from "./human-summary.ts";
import { structuredIdentityPaths } from "../runner/identity-summary.ts";

const TERMINAL_OPTIONS = Object.freeze({ width: 80, mode: "plain" as const });

const terminal = (blocks: readonly TerminalBlock[]): string => renderTerminal(blocks, TERMINAL_OPTIONS);

const fmt = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");

const metric = (value: Metric, formatValue: (value: number) => string = fmt): string => {
  if (value.value === undefined) return value.state;
  const rendered = formatValue(value.value);
  return value.state === "available" ? rendered : `${rendered} (${value.state})`;
};

const passRate = (value: Metric): string => metric(value, (rate) => `${fmt(rate * 100)}%`);

const duration = (value: Metric): string =>
  metric(value, (milliseconds) => {
    if (milliseconds < 1_000) return `${fmt(milliseconds)} ms`;
    if (milliseconds < 60_000) return `${fmt(milliseconds / 1_000)} s`;
    if (milliseconds < 3_600_000) return `${fmt(milliseconds / 60_000)} min`;
    return `${fmt(milliseconds / 3_600_000)} h`;
  });

const score = (value: ScoredValue, verdict: AttemptView["verdict"]): string =>
  value.state === "not-scored"
    ? value.state
    : `${fmt(value.earned)}/${fmt(value.possible)} (${value.state}${
        value.state === "unavailable" ? `; ${value.unavailable} unavailable` : ""
      }${value.state === "complete" && verdict === "passed" ? "; scored" : ""})`;

const aggregateEntries = (value: Aggregate): TerminalPanelContentBlock & { readonly kind: "keyValue" } => ({
  kind: "keyValue",
  entries: [
    { key: "Observed", value: `${value.observed}/${value.expected}` },
    {
      key: "Verdicts",
      value:
        value.failed === 0 && value.errored === 0 && value.skipped === 0
          ? `${value.passed} passed`
          : `${value.passed} passed; ${value.failed} failed; ${value.errored} errored; ${value.skipped} skipped`,
    },
    ...(value.evaluationKind === "points" ? [] : [{ key: "Pass rate", value: passRate(value.passRate) }]),
    ...(value.evaluationKind === "pass" ? [] : [{ key: "Score", value: metric(value.score) }]),
    { key: "Duration", value: duration(value.durationMs) },
    { key: "Tokens", value: metric(value.tokens) },
  ],
});

interface ExperimentGroup {
  readonly name: string | undefined;
  readonly experiments: OverviewView["experiments"];
}

function experimentGroup(experimentId: string): string | undefined {
  const separator = experimentId.indexOf("/");
  if (separator <= 0) return undefined;
  return experimentId.slice(0, separator);
}

function relativeToGroup(id: string, group: string | undefined): string {
  const prefix = group === undefined ? "" : `${group}/`;
  return prefix !== "" && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function groupExperiments(value: OverviewView): readonly ExperimentGroup[] {
  const groups = new Map<string | undefined, OverviewView["experiments"][number][]>();
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
  group: string | undefined,
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
          if (member.publication.verdict === "passed" || (member.publication.verdict === "failed" && !showFailed))
            return false;
          if (member.publication.verdict !== "errored") return true;
          shownErrors += 1;
          return shownErrors <= 5;
        });
    if (cell.members.length > 0 && members.length === 0) return [];
    return [
      {
        meta: undefined,
        kind: "divider" as const,
        title: `Eval ${relativeToGroup(cell.evalId, group)}`,
        attachNext: true,
      },
      {
        kind: "table" as const,
        columns: [
          { header: "Attempt", maxWidth: 14 },
          { maxWidth: 40, header: "Verdict" },
          { maxWidth: 40, header: "Duration" },
          ...(showScore ? [{ maxWidth: 40, header: "Score" }] : []),
        ],
        overflow: "wrap" as const,
        rows:
          members.length === 0
            ? [
                [
                  "not-recorded",
                  "not-recorded",
                  duration(cell.aggregate.durationMs),
                  ...(showScore ? [metric(cell.aggregate.score)] : []),
                ],
              ]
            : members.map((member) => {
                function publicationLabel(): string {
                  if (member.publication.state === "published") return member.publication.attemptLocator;
                  if (member.publication.state === "absent") return `absent (${member.publication.reason})`;
                  return "pending";
                }
                return [
                  publicationLabel(),
                  member.publication.state === "published"
                    ? `${member.publication.verdict ?? "not-recorded"}${member.publication.stoppedAt?.state !== "available" || member.publication.stoppedAt.value === null ? "" : " stopped"}`
                    : member.publication.state,
                  member.publication.state === "published"
                    ? duration(member.publication.durationMs)
                    : member.publication.state,
                  ...(showScore
                    ? [
                        member.publication.state === "published"
                          ? `${metric(member.publication.score)}${member.publication.verdict === "passed" && member.publication.score.state === "available" && member.publication.score.value !== undefined ? " (scored)" : ""}`
                          : member.publication.state,
                      ]
                    : []),
                ];
              }),
      },
    ];
  });
};

const hiddenAttemptSummary = (cells: OverviewView["cells"], showFailed = false): string | undefined => {
  const counts = { passed: 0, scored: 0, failed: 0, errored: 0 };
  for (const cell of cells) {
    for (const member of cell.members) {
      if (member.publication.state !== "published") continue;
      const verdict = member.publication.verdict;
      if (verdict === "passed") {
        if (
          cell.aggregate.evaluationKind === "points" &&
          member.publication.score.state === "available" &&
          member.publication.score.value !== undefined
        ) {
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
  if (hidden.length === 0) return undefined;
  return `${hidden.join("; ")} Attempts hidden`;
};

const compactContinuation = (
  cells: OverviewView["cells"],
  experimentId: string,
  all: boolean,
  showFailed = false,
): readonly TerminalPanelContentBlock[] => {
  if (all) return [];
  const hidden = hiddenAttemptSummary(cells, showFailed);
  return hidden === undefined
    ? []
    : [
        {
          meta: undefined,
          kind: "divider",
          title: hidden,
          attachNext: true,
        },
        {
          kind: "keyValue",
          entries: [
            {
              key: "See more",
              value: `niceeval show exp:${experimentId}`,
            },
          ],
        },
      ];
};

type ReferenceAttempts = ReadonlyMap<string, Pick<InspectionAttemptResult, "verdict" | "score">>;

function explanationKey(explanation: IdentityExplanation | undefined): string | undefined {
  if (explanation?.kind === "changed")
    return JSON.stringify(
      explanation.deltas.map((delta) => [
        delta.selector,
        delta.kind,
        structuredIdentityPaths(delta) ?? [delta.from, delta.to],
      ]),
    );
  if (explanation?.kind === "unexplained") return JSON.stringify(explanation.diagnostic);
  return undefined;
}

function gapExplanation(explanation: IdentityExplanation | undefined, count?: number): TerminalPanelContentBlock[] {
  if (explanation === undefined || explanation.kind === "match") return [];
  const suffix = count === undefined ? "" : ` · all ${count} attempts`;
  const lines =
    explanation.kind === "unexplained"
      ? [`Unexplained  ${explanation.diagnostic.summary}`]
      : [
          ...explanation.deltas.slice(0, 3).map((delta) => {
            const paths = structuredIdentityPaths(delta);
            if (paths !== undefined) return `Changed  ${delta.selector} (${paths})`;
            function bounded(value: string | undefined): string {
              if (value === undefined) return "?";
              return /^(?:source|data):/u.test(delta.selector) ? value.slice(0, 8) : value;
            }
            function deltaDetail(): string {
              if (delta.kind === "added") return `${bounded(delta.to)}; added`;
              if (delta.kind === "removed") return `${bounded(delta.from)}; removed`;
              return `${bounded(delta.from)} → ${bounded(delta.to)}`;
            }
            return `Changed  ${delta.selector} (${deltaDetail()})`;
          }),
          ...(explanation.deltas.length > 3 ? [`+${explanation.deltas.length - 3} more`] : []),
        ];
  return lines.map((line, index) => ({
    meta: undefined,
    kind: "divider",
    title: line + (index === 0 ? suffix : ""),
    attachNext: true,
  }));
}

function previousResultText(locator: string, attempts: ReferenceAttempts): string {
  const attempt = attempts.get(locator);
  const outcome =
    attempt === undefined
      ? "unavailable"
      : `${attempt.verdict ?? "unavailable"}${attempt.score.state === "not-scored" ? "" : `, ${attempt.score.state === "unavailable" ? "?" : fmt(attempt.score.earned)}/${fmt(attempt.score.possible)}`}`;
  return `Previous result ${locator} (${outcome})`;
}

function referenceSummary(project: InspectionProjectResult, attempts: ReferenceAttempts): TerminalPanelContentBlock[] {
  const previous = project.plannedAttempts.flatMap((slot) =>
    slot.state === "gap" && slot.previous !== null ? [slot.previous] : [],
  );
  if (previous.length === 0) return [];
  const results = previous.flatMap((slot) => {
    const attempt = attempts.get(slot.locator);
    return attempt === undefined ? [] : [attempt];
  });
  const pass = results.filter((attempt) => attempt.score.state === "not-scored");
  const scored = results.flatMap((attempt) => (attempt.score.state === "not-scored" ? [] : [attempt.score]));
  const passDenominator = pass.filter((attempt) => attempt.verdict !== undefined).length;
  return [
    { meta: undefined, attachNext: false, kind: "divider", title: "Earlier results for these" },
    {
      kind: "keyValue",
      entries: [
        { key: "Previous attempts", value: `${previous.length} of ${project.coverage.gaps} needing a run` },
        {
          key: "Verdicts",
          value: ["passed", "failed", "errored", "skipped"]
            .map((verdict) => `${results.filter((attempt) => attempt.verdict === verdict).length} ${verdict}`)
            .join("; "),
        },
        ...(pass.length === 0
          ? []
          : [
              {
                key: "Pass rate",
                value:
                  passDenominator === 0
                    ? "unavailable"
                    : `${fmt((100 * pass.filter((attempt) => attempt.verdict === "passed").length) / passDenominator)}%`,
              },
            ]),
        ...(scored.length === 0
          ? []
          : [
              {
                key: "Score",
                value: `${scored.some((score) => score.state === "unavailable") ? "?" : fmt(scored.reduce((sum, score) => sum + score.earned, 0))}/${fmt(scored.reduce((sum, score) => sum + score.possible, 0))}`,
              },
            ]),
        { key: "Notice", value: "Prior configuration; rerun required to update target" },
      ],
    },
  ];
}

type ProjectGap = Extract<InspectionProjectResult["plannedAttempts"][number], { readonly state: "gap" }>;

function changedSelectorSummary(gaps: readonly ProjectGap[]): string {
  const counts = new Map<string, number>();
  for (const gap of gaps) {
    if (gap.explanation?.kind !== "changed") continue;
    for (const selector of new Set(gap.explanation.deltas.map((delta) => delta.selector)))
      counts.set(selector, (counts.get(selector) ?? 0) + 1);
  }
  const selectors = [...counts]
    .sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount || left.localeCompare(right))
    .map(([selector]) => selector);
  const visible = selectors.slice(0, 3);
  if (selectors.length > 3) visible.push(`+${selectors.length - 3} more`);
  return visible.join(", ");
}

function gapReasonSummary(gap: ProjectGap, references: ReferenceAttempts, changes: string): string {
  const reason: string = gap.reason;
  switch (reason) {
    case "no-result":
      return "Not run yet";
    case "pending":
      return "Running";
    case "not-published":
      return "Run did not finish";
    case "identity-mismatch":
      return `Needs rerun: ${changes || "inputs changed"}`;
    case "outcome-ineligible": {
      const previous = gap.previous === null ? undefined : references.get(gap.previous.locator);
      return `Needs rerun: last attempt ${previous?.verdict ?? "unavailable"}`;
    }
    case "score-incomplete":
      return "Needs rerun: score incomplete";
    case "timeout-exceeded":
      return "Needs rerun: timed out";
    case "adoption-unproven":
      return "Needs review: earlier result not proven equivalent";
    case "dynamic-module-unresolved":
      return "Needs rerun: source could not be resolved";
    case "stateful-input":
      return "Reruns every time: uses state";
    default:
      return "Needs rerun: evidence missing";
  }
}

function experimentGapSummary(gaps: readonly ProjectGap[], references: ReferenceAttempts): string {
  const changes = changedSelectorSummary(gaps);
  const reasons = [...new Set(gaps.map((gap) => gapReasonSummary(gap, references, changes)))];
  return [...reasons.slice(0, 3), ...(reasons.length > 3 ? [`+${reasons.length - 3} more`] : [])].join("; ");
}

function projectGaps(project: InspectionProjectResult, experimentId: string): ProjectGap[] {
  return project.plannedAttempts.filter(
    (slot): slot is ProjectGap => slot.state === "gap" && slot.experimentId === experimentId,
  );
}

export function currentProjectNextCommands(project: InspectionProjectResult): readonly string[] {
  const experiments = project.experiments
    .filter((experiment) => experiment.denominator.missing > 0)
    .sort(
      (left, right) =>
        right.denominator.missing - left.denominator.missing || left.experimentId.localeCompare(right.experimentId),
    );
  const count = experiments.length > 3 ? 2 : 3;
  const commands = experiments.slice(0, count).map((experiment) => `niceeval exp ${experiment.experimentId} --dry`);
  if (experiments.length > 3)
    commands.push(`+${experiments.length - count} more: niceeval show exp:${experiments[count]!.experimentId}`);
  return commands;
}

/** Current availability supplements the exact Experiment's recorded cost and result view. */
export function renderCurrentExperimentNeedsRun(
  project: InspectionProjectResult,
  references: ReferenceAttempts,
): string {
  const blocks: TerminalBlock[] = [];
  if (project.coverage.gaps === 0) return "";
  const earlier = referenceSummary(project, references);
  if (earlier.length > 0)
    blocks.push({
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: "Earlier results",
      blocks: earlier,
    });
  for (const experiment of project.experiments) {
    const gaps = projectGaps(project, experiment.experimentId);
    if (gaps.length === 0) continue;
    const first = gaps[0]!;
    const key = explanationKey(first.explanation);
    const shared = key !== undefined && gaps.every((gap) => explanationKey(gap.explanation) === key);
    blocks.push({
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Need a run · ${experiment.experimentId}`,
      blocks: [
        ...(shared
          ? [
              {
                meta: undefined,
                kind: "divider" as const,
                title: experimentGapSummary(gaps, references),
                attachNext: true,
              },
              ...gapExplanation(first.explanation, gaps.length),
            ]
          : []),
        ...gaps.flatMap((gap): TerminalPanelContentBlock[] => [
          { meta: undefined, kind: "divider", title: `Eval ${gap.evalId}`, attachNext: true },
          ...(shared
            ? []
            : [
                {
                  meta: undefined,
                  kind: "divider" as const,
                  title: gapReasonSummary(gap, references, changedSelectorSummary([gap])),
                  attachNext: true,
                },
                ...gapExplanation(gap.explanation),
              ]),
          ...(gap.previous === null
            ? []
            : [
                {
                  meta: undefined,
                  attachNext: false,
                  kind: "divider" as const,
                  title: previousResultText(gap.previous.locator, references),
                },
              ]),
        ]),
      ],
    });
  }
  return terminal(blocks);
}

export function renderOverview(
  value: OverviewView,
  options: {
    readonly all: boolean;
    readonly source:
      | { readonly kind: "current"; readonly project: InspectionProjectResult; readonly references: ReferenceAttempts }
      | { readonly kind: "recorded" | "default" };
  } = { all: false, source: { kind: "default" } },
): string {
  const all = options.all;
  const current = options.source.kind === "current" ? options.source.project : undefined;
  const references = options.source.kind === "current" ? options.source.references : new Map();
  function resultsTitle(): string {
    if (current !== undefined) return "Current results";
    return options.source.kind === "recorded" ? "Recorded results" : "NiceEval results";
  }
  const blocks: TerminalBlock[] = [
    {
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: resultsTitle(),
      blocks: [
        { meta: undefined, attachNext: false, kind: "divider", title: "Totals" },
        current === undefined
          ? aggregateEntries(value.totals)
          : {
              kind: "keyValue",
              entries: [
                { key: "Up to date", value: `${current.coverage.covered}/${current.coverage.expected}` },
                { key: "Need a run", value: String(current.coverage.gaps) },
                {
                  key: "Verdicts",
                  value: `${value.totals.passed} passed; ${value.totals.failed} failed; ${value.totals.errored} errored; ${value.totals.skipped} skipped`,
                },
                ...(value.totals.evaluationKind === "points"
                  ? []
                  : [{ key: "Pass rate", value: passRate(value.totals.passRate) }]),
                ...(value.totals.evaluationKind === "pass"
                  ? []
                  : [{ key: "Score", value: metric(value.totals.score) }]),
              ],
            },
        ...(current === undefined ? [] : referenceSummary(current, references)),
      ],
    },
  ];
  if (value.experiments.length > 0) {
    const groups = groupExperiments(value);
    blocks.push({
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: "Experiments",
      blocks: groups.flatMap((group) => {
        const showPassRate = group.experiments.some(({ aggregate }) => aggregate.evaluationKind !== "points");
        const showScore = group.experiments.some(({ aggregate }) => aggregate.evaluationKind !== "pass");
        return [
          ...(group.name === undefined
            ? []
            : [{ meta: undefined, attachNext: false, kind: "divider" as const, title: group.name }]),
          {
            overflow: "truncate",
            kind: "table" as const,
            columns: [
              { maxWidth: 40, header: "Experiment" },
              { maxWidth: 40, header: current === undefined ? "Observed" : "Up to date" },
              ...(current === undefined
                ? [
                    { maxWidth: 40, header: "Adapter" },
                    { maxWidth: 40, header: "Model" },
                  ]
                : [{ maxWidth: 40, header: "Need a run" }]),
              ...(showPassRate ? [{ maxWidth: 40, header: "Pass rate" }] : []),
              ...(showScore ? [{ maxWidth: 40, header: "Score" }] : []),
            ],
            rows: group.experiments.map((experiment) => [
              relativeToGroup(experiment.experimentId, group.name),
              `${experiment.aggregate.observed}/${experiment.aggregate.expected}`,
              ...(current === undefined
                ? [adapterValue(experiment.adapter), executionValue(experiment.model)]
                : [
                    String(
                      current.experiments.find(({ experimentId }) => experimentId === experiment.experimentId)!
                        .denominator.missing,
                    ),
                  ]),
              ...(showPassRate ? [passRate(experiment.aggregate.passRate)] : []),
              ...(showScore ? [metric(experiment.aggregate.score)] : []),
            ]),
          },
        ];
      }),
    });
  }
  if (current !== undefined) {
    if (current.coverage.gaps > 0)
      blocks.push({
        meta: undefined,
        footerCommand: undefined,
        capWidth: true,
        kind: "panel",
        title: "Need a run",
        blocks: current.experiments.flatMap((experiment): TerminalPanelContentBlock[] => {
          const gaps = projectGaps(current, experiment.experimentId);
          if (gaps.length === 0) return [];
          return [
            {
              meta: undefined,
              attachNext: false,
              kind: "divider",
              title: `${experiment.experimentId}  ${gaps.length} need a run · ${experimentGapSummary(gaps, references)}`,
            },
          ];
        }),
      });
    if (all)
      for (const experiment of value.experiments)
        blocks.push({
          meta: undefined,
          footerCommand: undefined,
          capWidth: true,
          kind: "panel",
          title: `Attempts · ${experiment.experimentId}`,
          blocks: attemptBlocks(
            value.cells.filter((cell) => cell.experimentId === experiment.experimentId),
            undefined,
            true,
            true,
          ),
        });
    if (current.history.length > 0)
      blocks.push({
        meta: undefined,
        footerCommand: undefined,
        capWidth: true,
        kind: "panel",
        title: "History",
        blocks: [
          {
            overflow: "truncate",
            kind: "table",
            columns: [
              { maxWidth: 40, header: "Experiment" },
              { maxWidth: 40, header: "Eval" },
              { maxWidth: 40, header: "Attempt" },
              { maxWidth: 40, header: "Previous result" },
            ],
            rows: current.history.map((slot) => [
              slot.experimentId,
              slot.evalId,
              String(slot.attemptOrdinal),
              slot.locator ?? slot.sourceRunId,
            ]),
          },
        ],
      });
    return terminal(blocks);
  }
  if (value.cells.length > 0) {
    for (const group of groupExperiments(value)) {
      const experimentIds = new Set(group.experiments.map(({ experimentId }) => experimentId));
      const cells = value.cells.filter(({ experimentId }) => experimentIds.has(experimentId));
      blocks.push({
        meta: undefined,
        footerCommand: undefined,
        capWidth: true,
        kind: "panel",
        title: group.name === undefined ? "Attempts" : `Attempts · ${group.name}`,
        blocks: group.experiments.flatMap((experiment) => {
          const experimentCells = cells.filter(({ experimentId }) => experimentId === experiment.experimentId);
          return [
            {
              meta: undefined,
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
  if (value.state === "none") return "—";
  const identity = value.value;
  return identity.behaviorRevision === undefined
    ? `${identity.name} (${identity.contract}; revision not declared)`
    : `${identity.name} (${identity.contract}; revision ${identity.behaviorRevision})`;
}

export function renderExperiment(value: ExperimentView): string {
  const { totalCosts, coverage } = value.costSummary;
  return terminal([
    {
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Experiment ${value.experimentId}`,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            {
              key: "labels",
              value:
                Object.entries(value.labels)
                  .map(([key, label]) => `${key}=${label.state === "available" ? label.value : label.state}`)
                  .join(", ") || "—",
            },
          ],
        },
        { meta: undefined, attachNext: false, kind: "divider", title: "Plugins" },
        {
          overflow: "truncate",
          kind: "table",
          columns: ["Name", "Key", "Identity"].map((header) => ({ maxWidth: 40, header })),
          rows: value.plugins.map((plugin) => [plugin.name, plugin.key, structuredSummary(plugin.identity)]),
        },
        { meta: undefined, attachNext: false, kind: "divider", title: "Notes" },
        {
          overflow: "truncate",
          kind: "table",
          columns: ["Label", "Count", "Min", "Median", "P90", "Max"].map((header) => ({ maxWidth: 40, header })),
          rows: value.notes.map((note) => [
            note.label,
            String(note.count),
            ...[note.min, note.median, note.p90, note.max].map((n) => formatNumericUnit(n, note.unit)),
          ]),
        },
        {
          meta: undefined,
          attachNext: false,
          kind: "divider",
          title: totalCosts.state === "complete" ? "Experiment total costs" : "Experiment known subtotal",
        },
        ...totalCostBlocks(totalCosts).slice(1),
        {
          kind: "keyValue",
          entries: [
            { key: "Scope", value: "Latest recorded attempts; replaced executions excluded" },
            { key: "Planned attempts", value: String(coverage.plannedAttemptCount) },
            { key: "Recorded attempts", value: String(coverage.recordedAttemptCount) },
            { key: "Unique origin Attempts", value: String(coverage.originAttemptCount) },
            { key: "Attempts with complete costs", value: String(coverage.completeAttemptCount) },
            { key: "Attempts with partial costs", value: String(coverage.partialAttemptCount) },
            { key: "Attempts with unavailable costs", value: String(coverage.unavailableAttemptCount) },
            { key: "Missing attempts", value: String(coverage.missingAttemptCount) },
          ],
        },
        { meta: undefined, attachNext: false, kind: "divider", title: "Summary" },
        aggregateEntries(value.aggregate),
        { meta: undefined, attachNext: false, kind: "divider", title: "Attempts" },
        ...attemptBlocks(value.cells, undefined, true),
        { meta: undefined, attachNext: false, kind: "divider", title: "Models and usage" },
        {
          kind: "keyValue",
          entries: [
            {
              key: "Origin Attempts",
              value: `${value.modelUsage.attempts.length} shown; ${value.modelUsage.totalAttemptCount} selected; ${value.modelUsage.omittedAttemptCount} omitted; ${value.modelUsage.unresolvedAttemptCount} unresolved`,
            },
            { key: "Scope", value: "Per origin Attempt; recorded calls only" },
          ],
        },
        ...value.modelUsage.attempts.flatMap<TerminalPanelContentBlock>((attempt) => [
          { meta: undefined, attachNext: false, kind: "divider", title: `Attempt ${attempt.locator}` },
          {
            kind: "keyValue",
            entries: [{ key: "Origin Run", value: attempt.originRunId }],
          },
          ...totalCostBlocks(attempt.usage.totalCosts),
          ...modelUsageBlocks(attempt.usage),
          { meta: undefined, attachNext: false, kind: "divider", title: "Application totals" },
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
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Run ${value.runId}`,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Experiment", value: value.experimentId },
            {
              key: "Adapter",
              value:
                value.adapter === undefined
                  ? "not recorded"
                  : adapterValue({ state: "available", value: value.adapter }),
            },
            { key: "State", value: factPhrase(value.state) },
            { key: "Started", value: new Date(value.startedAt).toISOString() },
            ...(value.completedAt === undefined
              ? []
              : [
                  {
                    key: "Completed",
                    value: new Date(value.completedAt).toISOString(),
                  },
                ]),
            {
              key: "Summary",
              value: `${value.observed}/${value.expected} attempts observed`,
            },
          ],
        },
        { meta: undefined, attachNext: false, kind: "divider", title: "Coverage" },
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: factPhrase(value.coverage.state) },
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
        { meta: undefined, attachNext: false, kind: "divider", title: "Usage" },
        runUsageBlocks(value.usage),
        { meta: undefined, attachNext: false, kind: "divider", title: "Limitations" },
        runLocatedLimitationTable(value.limitations),
      ],
    },
  ];
  for (const diagnostic of value.diagnostics) {
    const affected = value.members.filter((member) =>
      diagnostic.affectedPlannedAttemptIds.includes(member.plannedAttemptId),
    );
    const stage = {
      "run.before": "Experiment before",
      "run.discovery": "Discovery",
      "run.plan": "Planning",
      "run.dispatch": "Before dispatch",
      "run.after": "Experiment after",
    }[diagnostic.phase];
    blocks.push({
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: "Run error",
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Stage", value: stage },
            { key: "Error", value: diagnostic.summary },
            { key: "Affected attempt count", value: String(affected.length) },
          ],
        },
        {
          overflow: "truncate",
          kind: "table",
          columns: [
            { maxWidth: 40, header: "Eval" },
            { maxWidth: 40, header: "Attempt ordinal" },
          ],
          rows: affected.map((member) => [member.evalId, String(member.attemptOrdinal)]),
        },
      ],
    });
  }
  for (const member of value.members) {
    function executionRelation(): string {
      if (member.execution.state === "not-recorded") return "not recorded";
      switch (member.execution.relation) {
        case "origin":
          return "Recorded in this Run";
        case "reference":
          return "Recorded in an earlier Run";
        default:
          return "not recorded";
      }
    }
    blocks.push({
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Planned attempt ${member.plannedAttemptId}`,
      meta: factPhrase(member.state),
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Eval", value: member.evalId },
            { key: "Attempt ordinal", value: String(member.attemptOrdinal) },
            { key: "Attempt", value: member.locator ?? "not recorded" },
            {
              key: "Execution",
              value: executionRelation(),
            },
            {
              key: "Outcome",
              value: member.execution.state === "recorded" ? member.execution.outcome : "not recorded",
            },
            { key: "Verdict", value: member.verdict ?? "not recorded" },
            {
              key: "Score",
              value: `${metric(member.score)}${member.verdict === "passed" && member.score.state === "available" && member.score.value !== undefined ? " (scored)" : ""}`,
            },
          ],
        },
        { meta: undefined, attachNext: false, kind: "divider", title: "Coverage" },
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: factPhrase(member.coverage.state) },
            { key: "Facts", value: String(member.coverage.facts.length) },
            {
              key: "Limitations",
              value: String(member.coverage.limitations.length),
            },
          ],
        },
        { meta: undefined, attachNext: false, kind: "divider", title: "Usage" },
        memberUsageBlocks(member.usage),
        { meta: undefined, attachNext: false, kind: "divider", title: "Limitations" },
        runMemberLimitationTable(member.limitations),
      ],
    });
  }
  return terminal(blocks);
}

function runUsageBlocks(value: RunView["usage"]): TerminalPanelContentBlock & { readonly kind: "keyValue" } {
  return {
    kind: "keyValue",
    entries: [
      { key: "State", value: factPhrase(value.state) },
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
      { key: "State", value: factPhrase(value.state) },
      {
        key: "Summary",
        value:
          value.summary === null
            ? "not recorded"
            : `${value.summary.turnCount} turns; ${value.summary.observationCount} observations`,
      },
      ...usageTotalEntries(value.totals),
      {
        key: "Limitations",
        value: boundedPreview(value.limitations.length, value.limitationsTruncated, value.omittedLimitationCount),
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
    columns: [{ maxWidth: 40, header: "Limitation" }],
    rows: countedSummaries(values.map(formatRunMemberLimitation)).map((value) => [value]),
    overflow: "wrap",
  };
}

function runLocatedLimitationTable(
  values: RunView["limitations"],
): TerminalPanelContentBlock & { readonly kind: "table" } {
  const groups = new Map<string, { plannedAttemptId: string; locator: string; summary: string; count: number }>();
  for (const value of values) {
    const summary = formatRunMemberLimitation(value.limitation);
    const key = `${value.plannedAttemptId}\0${summary}`;
    const previous = groups.get(key);
    if (previous === undefined)
      groups.set(key, {
        plannedAttemptId: value.plannedAttemptId,
        locator: value.locator ?? "not recorded",
        summary,
        count: 1,
      });
    else previous.count++;
  }
  return {
    kind: "table",
    columns: [
      { maxWidth: 40, header: "Planned attempt" },
      { maxWidth: 40, header: "Attempt" },
      { maxWidth: 40, header: "Limitation" },
    ],
    rows: [...groups.values()].map((value) => [
      value.plannedAttemptId,
      value.locator,
      value.count === 1 ? value.summary : `${value.summary} ×${value.count}`,
    ]),
    overflow: "wrap",
  };
}

function formatRunMemberLimitation(value: RunMemberLimitation): string {
  switch (value.kind) {
    case "member-not-observed":
      return `Attempt not observed; ${factPhrase(value.state)}`;
    case "attempt-unresolved":
      return `Attempt could not be read; run ${value.originRunId}; attempt ${value.attemptId}`;
    case "coverage":
      return formatAttemptLimitation(value.detail);
    case "usage":
      return `Usage; ${formatUsageLimitation(value.detail)}`;
  }
}

type AttemptLimitation = RunView["members"][number]["coverage"]["limitations"][number];

function formatAttemptLimitation(value: AttemptLimitation): string {
  if ("channel" in value) {
    return `${factPhrase(value.channel)} ${factPhrase(value.status)}${value.reason === undefined ? "" : ` (${factPhrase(value.reason)})`}`;
  }
  return `Assertion material ${factPhrase(value.state)} (${factPhrase(value.reason)}; ${value.limitations.length} material limitations)`;
}

// @concord-code
// @concord-implements docs/feature/inspection/cli.md
// @concord-implements docs/feature/error-classification/use-case/reading-errored.md
export function renderAttempt(
  value: AttemptView,
  state?: {
    readonly context: import("../state/protocol.ts").AttemptState;
    readonly execution: import("../state/protocol.ts").StateExecution;
  },
  record?: string,
): string {
  const terminalFact = value.terminal;
  const outcome =
    value.outcome === "cancelled" && terminalFact?.kind === "explicit-skip"
      ? "explicit skip"
      : terminalFact?.kind === "historical-cancelled"
        ? "cancelled (historical)"
        : value.outcome;
  const skipReason =
    terminalFact?.kind === "explicit-skip"
      ? `${terminalFact.reason}${terminalFact.truncated ? " [truncated]" : ""}`
      : terminalFact?.kind === "historical-cancelled"
        ? "not recorded (historical)"
        : undefined;
  return terminal([
    {
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Attempt ${value.locator}`,
      meta:
        value.verdict === "passed" && value.score.state === "complete" ? "scored" : (value.verdict ?? value.outcome),
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
            { key: "Outcome", value: outcome },
            { key: "Verdict", value: value.verdict ?? "not available" },
            ...(skipReason === undefined ? [] : [{ key: "Skip reason", value: skipReason }]),
            ...(state?.execution.bindings.map(({ lineage, origin }) => ({
              key: "State",
              value: `${lineage.name} cohort ${lineage.cohort} · ${origin.kind === "fresh" ? "fresh" : `from ${origin.checkpoint.digest}`} · ${state.context.earlierAttempts} earlier attempts in this sandbox · save ${state.execution.save.status}`,
            })) ?? []),
            ...(value.verdictCauses?.groups.map((group) => ({
              key: "Cause",
              value: `Errored because ${group.count} required assertions are ${group.result}: ${factPhrase(group.failureDetail ?? group.reason ?? "not recorded")} ×${group.count}`,
            })) ?? []),
            ...(value.verdictCauses?.hasMore || value.verdictCauses?.omittedGroupCount
              ? [
                  {
                    key: "Causes preview",
                    value: `${value.verdictCauses.items.length}/${value.verdictCauses.total} entries; ${value.verdictCauses.omittedGroupCount} omitted groups`,
                  },
                ]
              : []),
            ...(value.stoppedAt?.state !== "available" || value.stoppedAt.value === null
              ? []
              : [{ key: "Stopped", value: `Stopped at ${value.stoppedAt.value.label}; later steps did not run` }]),
            { key: "Score", value: score(value.score, value.verdict) },
          ],
        },
        ...attemptDiagnosticBlocks(value, record),
        ...agentInstallBlocks(value.agentInstall),
        {
          meta: undefined,
          attachNext: false,
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
          overflow: "truncate",
          kind: "table",
          columns: [
            { maxWidth: 40, header: "Assertion" },
            { maxWidth: 40, header: "Entry ID" },
            { maxWidth: 40, header: "Group" },
          ],
          rows: value.assertions.entries.map((entry) => [
            entry.label ?? entry.entryId,
            entry.entryId,
            entry.groupPath.length === 0 ? "root" : entry.groupPath.join(" / "),
          ]),
        },
        { meta: undefined, attachNext: false, kind: "divider", title: "Notes" },
        {
          kind: "keyValue",
          entries: value.notes.map((note) => {
            function noteValue(): string {
              if (note.value === null) return "unavailable";
              if (typeof note.value === "number") return formatNumericUnit(note.value, note.unit);
              return structuredSummary(note.value);
            }
            return { key: note.label, value: noteValue() };
          }),
        },
        { meta: undefined, attachNext: false, kind: "divider", title: "Evidence" },
        {
          kind: "keyValue",
          entries: [
            {
              key: "coverage",
              value:
                value.evidenceCoverage.length === 0
                  ? "none"
                  : countedSummaries(value.evidenceCoverage.map(formatAttemptLimitation)).join("; "),
            },
            {
              key: "limitations",
              value:
                value.limitations.length === 0
                  ? "none"
                  : countedSummaries(value.limitations.map(formatAttemptLimitation)).join("; "),
            },
          ],
        },
        { meta: undefined, attachNext: false, kind: "divider", title: "Sections" },
        {
          kind: "keyValue",
          entries: [
            { key: "Source", value: factPhrase(value.sections.sources) },
            { key: "Execution", value: factPhrase(value.sections.trace) },
            { key: "Diagnostics", value: factPhrase(value.sections.diagnostics) },
            { key: "Timing", value: factPhrase(value.sections.timing) },
            { key: "Usage", value: factPhrase(value.sections.usage) },
            { key: "Diff", value: factPhrase(value.sections.diff) },
          ],
        },
      ],
    },
  ]);
}

function agentInstallBlocks(install: AttemptView["agentInstall"]): TerminalPanelContentBlock[] {
  if (install.state === "unavailable") {
    return install.reason === "not-recorded"
      ? []
      : [{ kind: "keyValue", entries: [{ key: "Agent install", value: "unavailable (invalid attachment)" }] }];
  }
  return [
    { meta: undefined, attachNext: false, kind: "divider", title: "Agent install" },
    ...install.value.map((fact): TerminalPanelContentBlock => {
      const { agent, version, revision } = fact.identity;
      return {
        kind: "keyValue",
        entries: [
          { key: `${agent}@${version}`, value: `${fact.outcome} (revision ${revision})` },
          ...(fact.outcome === "hit" ? [] : [{ key: "Probe miss", value: fact.probeMissReason }]),
          ...(fact.outcome === "installed" && fact.repairFailureReason !== undefined
            ? [{ key: "Repair failure", value: fact.repairFailureReason }]
            : []),
        ],
      };
    }),
  ];
}

function attemptDiagnosticBlocks(value: AttemptView, record?: string): TerminalPanelContentBlock[] {
  const executionCommand = diagnosticShowCommand(value.locator, "execution", record);
  const items = value.diagnostics?.items ?? [];
  const failures = items.filter((item) => item.kind !== "advisory");
  const advisories = items.filter((item) => item.kind === "advisory");
  const blocks: TerminalPanelContentBlock[] = [];
  for (const [title, diagnostics] of [
    ["Failure diagnostics", failures],
    ["Advisories", advisories],
  ] as const) {
    if (diagnostics.length === 0) continue;
    blocks.push({ meta: undefined, attachNext: false, kind: "divider", title });
    for (const diagnostic of diagnostics) {
      blocks.push(
        {
          kind: "keyValue",
          entries: [
            { key: "Phase", value: diagnostic.phase },
            { key: "Reason", value: factPhrase(diagnostic.code) },
            { key: "Error", value: diagnostic.summary },
            ...(diagnostic.summaryTruncated
              ? [{ key: "Summary", value: "partial; open the saved diagnostic for the full text" }]
              : []),
            ...(COMMAND_PHASES.has(diagnostic.phase) ? [{ key: "Command output", value: executionCommand }] : []),
          ],
        },
        {
          kind: "command",
          command: diagnosticShowCommand(value.locator, diagnostic.evidenceId, record),
        },
      );
    }
  }
  if (value.outcome === "errored" && failures.length === 0 && value.verdictCauses === undefined) {
    blocks.unshift(
      { meta: undefined, attachNext: false, kind: "divider", title: "Failure diagnostics" },
      {
        kind: "keyValue",
        entries: [
          {
            key: "Diagnostics",
            value: `unavailable: no recorded failure diagnostic items (${value.diagnostics?.state ?? "not-read"})`,
          },
        ],
      },
      { kind: "command", command: executionCommand },
    );
  }
  if (value.diagnostics?.hasMore)
    blocks.push({ kind: "keyValue", entries: [{ key: "More diagnostics", value: executionCommand }] });
  return blocks;
}

function diagnosticShowCommand(locator: string, target: string, record: string | undefined): string {
  const recordArg = record === undefined ? "" : ` --record ${inspectionShellWord(record)}`;
  return `niceeval show ${locator} ${target}${recordArg}`;
}

export function renderSources(value: SourcesView): string {
  const blocks: TerminalBlock[] = [
    {
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Captured source ${value.locator}`,
      meta: factPhrase(value.state),
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: factPhrase(value.state) },
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
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `${item.path} · ${item.sourceItemId} · ${item.byteLength} bytes`,
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Bytes", value: String(item.byteLength) },
            { key: "Content", value: factPhrase(item.content.state) },
            ...(item.content.state === "omitted"
              ? [
                  { key: "Reason", value: factPhrase(item.content.reason) },
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
      blocks.push({ kind: "raw", text: item.content.text });
    }
  }
  blocks.push(
    {
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: "Assertion source facts",
      meta: factPhrase(value.assertions.state),
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
              value:
                value.assertions.hasMoreSourceSites === true
                  ? String(value.assertions.omittedSourceSiteCount ?? 0)
                  : "0",
            },
          ],
        },
      ],
    },
    {
      kind: "raw",
      text: value.assertions.sites
        .map(
          (site) =>
            `${site.entryId} · ${site.role} · ${sourceRange(site.start, site.end)} · ${
              site.source.state === "mapped"
                ? `mapped · ${site.source.sourceItemId} · ${site.source.sha256}`
                : `unmapped · ${factPhrase(site.source.reason)}`
            }`,
        )
        .join("\n"),
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
  return Array.from(text)
    .filter((character) => !displayTextHasForbiddenCharacter(character))
    .join("");
}

function displayPreview(text: { readonly preview: string; readonly omittedBytes: number }, eventId: string): string {
  return (
    safeEventText(text.preview) + (text.omittedBytes === 0 ? "" : `\n… (${text.omittedBytes} more bytes, ${eventId})`)
  );
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

function displayLines(
  block: ExecutionDisplayPreviewBlock | ExecutionDisplayDetailBlock,
  eventId: string,
  width: number,
): string[] {
  const textValue = (text: string | { readonly preview: string; readonly omittedBytes: number }): string =>
    typeof text === "string" ? safeEventText(text) : displayPreview(text, eventId);
  switch (block.kind) {
    case "text":
      return wrapDisplay(textValue(block.text), width);
    case "message": {
      const label = safeEventText(block.speaker ?? block.role);
      const prefix = `${label}: `;
      return wrapDisplay(textValue(block.text), Math.max(4, width - stringWidth(prefix))).map(
        (line, index) => `${index === 0 ? prefix : " ".repeat(stringWidth(prefix))}${line}`,
      );
    }
    case "fields": {
      const labelWidth = Math.max(0, ...block.fields.map((field) => stringWidth(safeEventText(field.label))));
      return block.fields.flatMap((field) => {
        function fieldValue(): string {
          if (typeof field.value === "object" && field.value !== null) return textValue(field.value);
          if (typeof field.value === "string") return safeEventText(field.value);
          return JSON.stringify(field.value);
        }
        return wrapDisplay(fieldValue(), Math.max(4, width - labelWidth - 2)).map(
          (line, index) =>
            `${index === 0 ? padDisplay(safeEventText(field.label), labelWidth) : " ".repeat(labelWidth)}  ${line}`,
        );
      });
    }
    case "code": {
      if (typeof block.text === "string") return safeEventText(block.text).split("\n");
      return [
        ...safeEventText(block.text.preview)
          .split("\n")
          .map((line) => truncateCodeLine(line, width)),
        ...(block.text.omittedBytes === 0 ? [] : [`… (${block.text.omittedBytes} more bytes, ${eventId})`]),
      ];
    }
    case "image":
      return [
        ...wrapDisplay(`[image] ${safeEventText(block.alt)}`, width),
        ...wrapDisplay(`${block.mediaType} · ${block.byteLength} bytes · artifact ${block.artifactId}`, width),
      ];
  }
}

function displayDetailBlocks(block: ExecutionDisplayDetailBlock, locator: string, eventId: string): TerminalBlock[] {
  const lines = displayLines(block, eventId, TERMINAL_OPTIONS.width);
  const blocks: TerminalBlock[] = [{ kind: "raw", text: lines.join("\n") }];
  if (block.kind === "image") {
    blocks.push({ kind: "raw", text: `niceeval show ${locator} ${block.artifactId}` });
  }
  return blocks;
}

function captureLimitationSummary(value: TraceView["execution"]["limitations"][number]): string {
  switch (value.code) {
    case "capture-failed":
      return "Adapter could not record execution";
    case "capture-interrupted":
      return "Execution recording was interrupted while finishing the Attempt";
    case "collection-cap-reached":
      return `Recording limit reached; at least ${value.omittedAtLeast} entries omitted`;
    case "legacy-source-state":
      return value.message;
  }
}

function traceLiteral(text: string): string {
  return Array.from(text, (character) =>
    displayTextHasForbiddenCharacter(character)
      ? "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0")
      : character,
  ).join("");
}

function traceProvenanceEntries(
  archive: TraceView["execution"]["traces"][number]["archive"],
  index?: TraceView["execution"]["index"],
) {
  return [
    ...(archive === undefined
      ? []
      : [
          { key: "Archive", value: traceLiteral(archive.system + " " + JSON.stringify(archive.locator)) },
          ...(archive.sha256 === undefined ? [] : [{ key: "Archive SHA-256", value: archive.sha256 }]),
          ...(archive.byteLength === undefined ? [] : [{ key: "Archive bytes", value: String(archive.byteLength) }]),
        ]),
    ...(index === undefined ? [] : [{ key: "Index", value: "not-published (historical)" }]),
  ];
}

export function renderTraceKeys(value: InspectionSuccessDocumentFor<"attempt.trace.keys">): string {
  const rows = value.rows.map((row) => {
    switch (row.kind) {
      case "event":
        return traceLiteral(JSON.stringify(row.key)) + "  " + row.eventId;
      case "evidence":
        return (
          "  " +
          traceLiteral(JSON.stringify(row.eventKey)) +
          "  " +
          traceLiteral(JSON.stringify(row.key)) +
          "  " +
          row.evidenceId
        );
      case "missing":
        return traceLiteral(JSON.stringify(row.key)) + "  missing";
    }
  });
  return terminal([
    { kind: "keyValue", entries: traceProvenanceEntries(undefined, value.index) },
    { kind: "raw", text: rows.length === 0 ? "No event keys recorded." : rows.join("\n") },
  ]);
}

function traceOutlineRows({ execution }: TraceView) {
  const scopes = execution.scopeItems ?? [];
  let scopeIndex = 0;
  const rows: Array<
    | { readonly kind: "event"; readonly event: TraceView["execution"]["events"][number] }
    | NonNullable<TraceView["execution"]["scopeItems"]>[number]
  > = [];
  for (let i = 0; i <= execution.events.length; i += 1) {
    while (scopes[scopeIndex]?.beforeEvent === i) {
      const scope = scopes[scopeIndex];
      if (scope !== undefined) rows.push(scope);
      scopeIndex += 1;
    }
    const event = execution.events[i];
    if (event !== undefined) rows.push({ kind: "event", event });
  }
  return rows;
}

export function renderTrace(value: TraceView, record?: string): string {
  const blocks: TerminalBlock[] = [
    {
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Execution ${value.locator}`,
      blocks: [],
    },
    {
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: "Generic execution traces",
      blocks: [
        {
          kind: "keyValue",
          entries: [
            { key: "Capture", value: factPhrase(value.execution.state) },
            ...traceProvenanceEntries(undefined, value.execution.index),
            { key: "Traces", value: String(value.execution.traces.length) },
            {
              key: "Events",
              value: `${value.execution.events.length} shown; ${value.execution.omittedEventCount} remaining in this selection`,
            },
            {
              key: "Page",
              value: value.execution.hasMore
                ? value.execution.omittedEventCount > 0
                  ? "more events available"
                  : "more trace items available"
                : "end of selected events",
            },
            ...(value.execution.continuation === undefined
              ? []
              : [{ key: "Continuation", value: value.execution.continuation }]),
          ],
        },
        {
          kind: "table",
          columns: [{ maxWidth: 40, header: "Capture limitation" }],
          rows: countedSummaries(
            value.execution.limitations.map((limitation) => safeEventText(captureLimitationSummary(limitation))),
          ).map((limitation) => [limitation]),
          overflow: "wrap",
        },
        ...value.execution.traces.flatMap<TerminalPanelContentBlock>((trace) => [
          { meta: undefined, attachNext: false, kind: "divider", title: `Trace ${safeEventText(trace.sourceTraceId)}` },
          {
            kind: "keyValue",
            entries: [
              { key: "Trace ID", value: trace.traceId },
              { key: "Schema", value: safeEventText(trace.schema.id) },
              { key: "Producer collection", value: factPhrase(trace.collection.state) },
              { key: "Recorded events", value: String(trace.eventCount) },
              ...(trace.scopeCount === undefined ? [] : [{ key: "Recorded scopes", value: String(trace.scopeCount) }]),
              ...(trace.evidenceCount === undefined
                ? []
                : [{ key: "Recorded evidence", value: String(trace.evidenceCount) }]),
              ...traceProvenanceEntries(trace.archive),
            ],
          },
          {
            kind: "table",
            columns: [{ maxWidth: 40, header: "Recording limitation" }],
            rows: countedSummaries(
              trace.collection.limitations.map((limitation) =>
                safeEventText(
                  limitation.code === "niceeval.trace-stream-cut"
                    ? limitation.code + " · " + limitation.message
                    : limitation.message,
                ),
              ),
            ).map((message) => [message]),
            overflow: "wrap",
          },
        ]),
        { meta: undefined, attachNext: false, kind: "divider", title: "Event page" },
        ...traceOutlineRows(value).flatMap<TerminalPanelContentBlock>((row) => {
          if (row.kind === "scope") {
            return [
              {
                kind: "keyValue",
                entries: [
                  { key: "Scope", value: safeEventText(row.scope.label) },
                  { key: "Scope ID", value: safeEventText(row.scope.scopeId) },
                  { key: "Boundary", value: safeEventText(JSON.stringify(row.scope.boundary)) },
                ],
              },
            ];
          }
          const { event } = row;
          if (
            event.source.id === "niceeval.simulated-user" &&
            value.conversation.turns.some((turn) =>
              event.scopeMemberships.some((scope) => scope.scopeId === turn.turnId && scope.state === "included"),
            )
          )
            return [];
          return [
            { meta: undefined, attachNext: false, kind: "divider", title: safeEventText(event.type) },
            {
              kind: "keyValue",
              entries: [
                { key: "Event ID", value: event.eventId },
                { key: "Actor", value: safeEventText(event.actor?.label ?? event.actor?.id ?? "not recorded") },
                { key: "Source", value: safeEventText(event.source.id) },
                ...(event.time === undefined
                  ? []
                  : [
                      {
                        key: "Time",
                        value: safeEventText(`${event.time.clockId}: ${event.time.value} ${event.time.unit}`),
                      },
                    ]),
                { key: "Summary", value: safeEventText(event.summary) },
              ],
            },
            ...(event.display.state === "absent"
              ? []
              : event.display.blocks.map(
                  (block): TerminalPanelContentBlock => ({
                    kind: "command",
                    command: displayLines(
                      block,
                      event.eventId,
                      panelContentWidth(TERMINAL_OPTIONS.width, TERMINAL_OPTIONS.mode),
                    ).join("\n"),
                  }),
                )),
          ];
        }),
      ],
    },
    {
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Conversation · ${factPhrase(value.conversation.state)}`,
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
        { meta: undefined, attachNext: false, kind: "divider", title: "Limitations" },
        limitationTable(value.conversation.limitations),
      ],
    },
  ];
  for (const turn of value.conversation.turns) {
    blocks.push({
      footerCommand: undefined,
      capWidth: true,
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
    for (const event of value.execution.events.filter(
      (event) =>
        event.source.id === "niceeval.simulated-user" &&
        event.scopeMemberships.some((scope) => scope.scopeId === turn.turnId && scope.state === "included"),
    )) {
      blocks.push({
        meta: undefined,
        footerCommand: undefined,
        capWidth: true,
        kind: "panel",
        title: "Simulated user",
        blocks: [
          {
            kind: "keyValue",
            entries: [
              { key: "Event ID", value: event.eventId },
              { key: "Summary", value: safeEventText(event.summary) },
              ...event.evidence.map((evidence) => ({
                key: "Audit",
                value: `niceeval show ${value.locator} ${evidence.evidenceId}`,
              })),
            ],
          },
          ...(event.display.state === "absent"
            ? []
            : event.display.blocks.map(
                (block): TerminalPanelContentBlock => ({
                  kind: "command",
                  command: displayLines(
                    block,
                    event.eventId,
                    panelContentWidth(TERMINAL_OPTIONS.width, TERMINAL_OPTIONS.mode),
                  ).join("\n"),
                }),
              )),
        ],
      });
    }
  }
  blocks.push({
    meta: undefined,
    footerCommand: undefined,
    capWidth: true,
    kind: "panel",
    title: `Commands · ${factPhrase(value.commands.state)}`,
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
      { meta: undefined, attachNext: false, kind: "divider", title: "Limitations" },
      limitationTable(value.commands.limitations),
      { meta: undefined, attachNext: false, kind: "divider", title: "Command outline" },
      {
        overflow: "truncate",
        kind: "table",
        columns: [
          { maxWidth: 40, header: "Command ID" },
          { maxWidth: 40, header: "Phase" },
          { maxWidth: 40, header: "Outcome" },
        ],
        rows: value.commands.items.map((command) => [
          command.commandId,
          command.phase,
          commandOutcome(command.outcome, command.checked),
        ]),
      },
    ],
  });
  blocks.push({
    meta: undefined,
    footerCommand: undefined,
    capWidth: true,
    kind: "panel",
    title: `Diagnostics · ${factPhrase(value.diagnostics.state)}`,
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
      { meta: undefined, attachNext: false, kind: "divider", title: "Limitations" },
      limitationTable(value.diagnostics.limitations),
      { meta: undefined, attachNext: false, kind: "divider", title: "Diagnostic outline" },
      {
        kind: "table",
        columns: [
          { maxWidth: 40, header: "Diagnostic ID" },
          { maxWidth: 40, header: "Phase" },
          { maxWidth: 40, header: "Kind" },
          { maxWidth: 40, header: "Code" },
          { maxWidth: 40, header: "Summary" },
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
      ...value.diagnostics.items
        .filter((diagnostic) => diagnostic.code === "cache-degraded")
        .flatMap((diagnostic): TerminalPanelContentBlock[] => [
          { kind: "keyValue", entries: [{ key: "Cache degradation", value: diagnostic.summary }] },
          { kind: "command", command: diagnosticShowCommand(value.locator, diagnostic.evidenceId, record) },
        ]),
    ],
  });
  blocks.push(
    {
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: "Stable identities",
      blocks: [],
    },
    {
      kind: "raw",
      text: [
        ...value.execution.events.flatMap((event) => [
          `event ${event.eventId}`,
          ...event.evidence.map((evidence) => `  evidence ${evidence.evidenceId}`),
        ]),
        ...value.identities.itemIds.map((id) => `item ${id}`),
        ...value.identities.toolOccurrenceIds.map((id) => `tool occurrence ${id}`),
        ...value.identities.commandIds.map((id) => `command ${id}`),
      ].join("\n"),
    },
  );
  return terminal(blocks);
}

function boundedPreview(shown: number, truncated: boolean, omitted: number): string {
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
    columns: [{ maxWidth: 40, header: "Limitation" }],
    rows: countedSummaries(limitations.map(formatProjectionLimitation)).map((limitation) => [limitation]),
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
      return `Agent turns; turn ${value.turnId}; ${factPhrase(value.channel)}; ${factPhrase(value.state)}; ${factPhrase(value.reason)}`;
    }
    const details = value.limitations.map(formatProjectionLimitation).join("; ");
    return `${factPhrase(value.source)}; ${factPhrase(value.state)}${details.length === 0 ? "" : `; ${details}`}`;
  }
  switch (value.code) {
    case "capture-failed":
    case "capture-interrupted":
      return `${factPhrase(value.code)}; stage ${value.stage}; target ${value.target}`;
    case "collection-cap-reached":
    case "unsupported-input":
      return `${factPhrase(value.code)}; target ${value.target}; omitted at least ${value.omittedAtLeast}`;
    case "text-truncated":
    case "redacted":
    case "invalid-utf8-replaced":
    case "unsafe-control-stripped":
      return `${factPhrase(value.code)}; target ${value.target}; replaced or omitted ${value.replacementOrOmittedCount}`;
  }
}

type UsageLimitation = UsageView["limitations"][number];

function formatUsageLimitation(value: UsageLimitation): string {
  if ("issue" in value) return value.issue;
  if ("source" in value) {
    return `${factPhrase(value.source)}; turn ${value.turnId}; ${factPhrase(value.channel)}; ${factPhrase(value.state)}; ${factPhrase(value.reason)}`;
  }
  return formatProjectionLimitation(value);
}

function traceItemBlocks(item: TraceItem): readonly TerminalBlock[] {
  const entries: { key: string; value: string }[] = [
    { key: "Kind", value: factPhrase(item.kind) },
    { key: "Sequence", value: String(item.sequence) },
  ];
  let content: string | undefined;
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
          value: item.toolOccurrenceId ?? "not recorded",
        },
      );
      content = recordedTextSummary(item.input);
      break;
    case "tool-result":
      entries.push(
        { key: "Outcome", value: item.outcome },
        {
          key: "Tool occurrence",
          value: item.toolOccurrenceId ?? "not recorded",
        },
      );
      content = recordedTextSummary(item.output);
      break;
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      content = item.summary;
      break;
    case "subagent":
      entries.push({ key: "State", value: factPhrase(item.state) }, { key: "Label", value: item.label });
      content = item.summary;
      break;
    case "input-request":
      entries.push({ key: "State", value: factPhrase(item.state) });
      content = `Prompt: ${item.prompt}\nResponse: ${item.response ?? "not recorded"}`;
      break;
    case "skill-load":
    case "conversation-error":
      entries.push({ key: "Reason", value: factPhrase(item.code) });
      content = item.summary;
      break;
  }
  return [
    {
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Item ${item.itemId}`,
      blocks: [{ kind: "keyValue", entries }],
    },
    ...(content === undefined ? [] : [{ kind: "raw" as const, text: content }]),
  ];
}

export function renderTraceDetail(value: TraceDetailView): string {
  const body = value.body;
  const heading: TerminalBlock = {
    footerCommand: undefined,
    capWidth: true,
    kind: "panel",
    title: `Execution detail ${value.locator}`,
    meta: `${value.kind} ${value.stableId}`,
    blocks: [],
  };
  if (body.kind === "diagnostic")
    return terminal([heading, { kind: "raw", text: `${body.phase} · ${body.code}\n${body.summary}` }]);
  if (body.kind === "execution-event") {
    return terminal([
      heading,
      {
        meta: undefined,
        footerCommand: undefined,
        capWidth: true,
        kind: "panel",
        title: `${safeEventText(body.event.type)} · ${body.event.eventId}`,
        blocks: [
          {
            kind: "keyValue",
            entries: [
              { key: "Trace", value: body.event.traceId },
              ...traceProvenanceEntries(body.archive, body.index),
              { key: "Source", value: safeEventText(body.event.source.id) },
              { key: "Native event ID", value: safeEventText(body.event.source.eventId ?? "not recorded") },
              {
                key: "Client sequence",
                value: body.event.source.sequence === undefined ? "not recorded" : String(body.event.source.sequence),
              },
              { key: "Actor", value: safeEventText(body.event.actor?.id ?? "not recorded") },
              {
                key: "Time",
                value:
                  body.event.time === undefined
                    ? "not recorded"
                    : safeEventText(`${body.event.time.value} ${body.event.time.unit} (${body.event.time.clockId})`),
              },
              { key: "Summary", value: safeEventText(body.event.summary) },
              { key: "Evidence", value: String(body.evidence.length) },
            ],
          },
        ],
      },
      ...(body.event.display ?? []).flatMap((block) => displayDetailBlocks(block, value.locator, body.event.eventId)),
      { meta: undefined, attachNext: false, kind: "divider", title: "Event" },
      {
        kind: "keyValue",
        entries: [
          { key: "Payload", value: safeEventText(structuredSummary(body.event.payload ?? null)) },
          { key: "Relationships", value: String(body.event.links.length) },
          { key: "Scopes", value: String(body.event.scopeMemberships.length) },
        ],
      },
      ...body.evidence.flatMap((evidence): readonly TerminalBlock[] => [
        {
          footerCommand: undefined,
          capWidth: true,
          kind: "panel",
          title: `${safeEventText(evidence.label)} · ${evidence.evidenceId}`,
          meta: evidence.truncated ? "preview" : "complete",
          blocks: [
            {
              kind: "keyValue",
              entries: [
                { key: "Artifact", value: evidence.artifactId },
                { key: "Pointer", value: safeEventText(evidence.pointer) },
                { key: "Bytes", value: String(evidence.targetByteLength) },
                { key: "Target SHA-256", value: evidence.targetSha256 },
                { key: "Next offset", value: evidence.nextOffset === null ? "complete" : String(evidence.nextOffset) },
              ],
            },
          ],
        },
        { kind: "raw", text: safeEventText(recordedTextSummary(executionEvidenceText(evidence.base64))) },
      ]),
    ]);
  }
  if (body.kind === "execution-evidence") {
    return terminal([
      heading,
      {
        meta: undefined,
        footerCommand: undefined,
        capWidth: true,
        kind: "panel",
        title: `${safeEventText(body.label)} · ${body.evidenceId}`,
        blocks: [
          {
            kind: "keyValue",
            entries: [
              { key: "Trace", value: body.traceId },
              ...traceProvenanceEntries(body.archive, body.index),
              { key: "Event", value: body.eventId },
              { key: "Artifact", value: body.artifactId },
              { key: "Pointer", value: safeEventText(body.pointer) },
              { key: "Range", value: `${body.offset}..${body.nextOffset ?? body.targetByteLength}` },
              { key: "Target SHA-256", value: body.targetSha256 },
            ],
          },
        ],
      },
      { kind: "raw", text: safeEventText(recordedTextSummary(executionEvidenceText(body.base64))) },
    ]);
  }
  if (body.kind === "turn") return terminal([heading, ...body.items.flatMap((item) => traceDetailItemBlocks(item))]);
  if (body.kind === "item") {
    return terminal([heading, ...traceDetailItemBlocks(body.item)]);
  }
  if (body.kind === "tool-occurrence") {
    return terminal([
      heading,
      {
        meta: undefined,
        footerCommand: undefined,
        capWidth: true,
        kind: "panel",
        title: "Occurrence turns",
        blocks: [
          {
            kind: "keyValue",
            entries: [
              {
                key: "Call",
                value:
                  body.turn.call === null
                    ? "not recorded"
                    : `${body.turn.call.turnId}; sequence ${body.turn.call.sequence}; ${body.turn.call.outcome}`,
              },
              {
                key: "Result",
                value:
                  body.turn.result === null
                    ? "not recorded"
                    : `${body.turn.result.turnId}; sequence ${body.turn.result.sequence}; ${body.turn.result.outcome}`,
              },
            ],
          },
        ],
      },
      ...(body.call === null
        ? [
            {
              footerCommand: undefined,
              capWidth: true,
              kind: "panel" as const,
              title: "Call",
              meta: "not recorded",
              blocks: [],
            },
          ]
        : traceDetailItemBlocks(body.call, "Call")),
      ...(body.result === null
        ? [
            {
              footerCommand: undefined,
              capWidth: true,
              kind: "panel" as const,
              title: "Result",
              meta: "not recorded",
              blocks: [],
            },
          ]
        : traceDetailItemBlocks(body.result, "Result")),
    ]);
  }
  return terminal([
    heading,
    {
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
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
            { key: "Outcome", value: commandOutcome(body.outcome, body.checked) },
            { key: "Turn", value: body.turnId ?? "not recorded" },
            { key: "Phase", value: body.phase },
            { key: "Sequence", value: String(body.sequence) },
          ],
        },
        { meta: undefined, attachNext: false, kind: "divider", title: "stdout" },
        streamMetadata(body.stdout),
        { meta: undefined, attachNext: false, kind: "divider", title: "stderr" },
        streamMetadata(body.stderr),
      ],
    },
    { kind: "raw", text: body.stdout.text },
    { kind: "raw", text: body.stderr.text },
  ]);
}

function executionEvidenceText(base64: string): string {
  return new TextDecoder("utf-8").decode(decodeBase64Bytes(base64));
}

type TraceDetailItem = Extract<TraceDetailView["body"], { readonly kind: "item" }>["item"];

function traceDetailItemBlocks(item: TraceDetailItem, title = `Item ${item.itemId}`): readonly TerminalBlock[] {
  const entries: { key: string; value: string }[] = [
    { key: "Item ID", value: item.itemId },
    { key: "Kind", value: factPhrase(item.kind) },
    { key: "Turn", value: item.turnId },
    { key: "Turn sequence", value: String(item.turnSequence) },
    { key: "Turn outcome", value: item.turnOutcome },
    { key: "Session", value: item.sessionId ?? "not recorded" },
    { key: "Event", value: item.eventId ?? "not recorded" },
    {
      key: "Sequence",
      value: item.sequence === undefined ? "not recorded" : String(item.sequence),
    },
  ];
  for (const [field, value] of Object.entries(item)) {
    if (
      field.endsWith("Truncation") &&
      value !== undefined &&
      value !== null &&
      typeof value === "object" &&
      "retainedBytes" in value
    ) {
      entries.push({
        key: field.slice(0, -"Truncation".length),
        value: `Truncated; ${value.retainedBytes} retained bytes${"originalBytes" in value ? `; ${value.originalBytes} original bytes` : "; original bytes unknown"}`,
      });
    }
  }
  let content: string | undefined;
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
          value: item.toolOccurrenceId ?? "not recorded",
        },
      );
      content = recordedTextSummary(item.input);
      break;
    case "tool-result":
      entries.push(
        { key: "Outcome", value: item.outcome },
        {
          key: "Tool occurrence",
          value: item.toolOccurrenceId ?? "not recorded",
        },
      );
      content = recordedTextSummary(item.output);
      break;
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      content = item.summary;
      break;
    case "subagent":
      entries.push({ key: "State", value: factPhrase(item.state) }, { key: "Label", value: item.label });
      content = item.summary;
      break;
    case "input-request":
      entries.push({ key: "State", value: factPhrase(item.state) });
      content = `Prompt: ${item.prompt}\nResponse: ${item.response ?? "not recorded"}`;
      break;
    case "skill-load":
    case "conversation-error":
      entries.push({ key: "Reason", value: factPhrase(item.code) });
      content = item.summary;
      break;
  }
  return [
    {
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title,
      blocks: [{ kind: "keyValue", entries }],
    },
    ...(content === undefined ? [] : [{ kind: "raw" as const, text: content }]),
  ];
}

type CommandDetail = Extract<TraceDetailView["body"], { readonly kind: "command" }>;

function streamMetadata(stream: CommandDetail["stdout"]): TerminalPanelContentBlock & { readonly kind: "keyValue" } {
  return {
    kind: "keyValue",
    entries: [
      { key: "Retained bytes", value: String(stream.retainedBytes) },
      { key: "Total safe UTF-8 bytes", value: String(stream.totalSafeUtf8Bytes) },
      { key: "SHA-256", value: stream.sha256 },
      { key: "Truncation", value: factPhrase(stream.truncation.state) },
      {
        key: "Omitted safe UTF-8 bytes",
        value: String(stream.truncation.omittedSafeUtf8Bytes),
      },
    ],
  };
}

function commandInvocation(value: CommandDetail["invocation"]): string {
  return value.kind === "shell" ? value.command : [value.executable, ...value.arguments].join(" ");
}

function workingDirectory(value: CommandDetail["workingDirectory"]): string {
  return value.kind === "project-relative" ? value.path : value.kind;
}

const COMMAND_PHASES: ReadonlySet<string> = new Set(["sandbox.prepare", "sandbox.command", "agent.install"]);

function commandOutcome(value: CommandDetail["outcome"], checked: boolean | undefined): string {
  if (value.kind === "exited") {
    if (value.exitCode === 0 || checked === undefined) return `exited; code ${value.exitCode}`;
    return `${checked ? "failed" : "observed"}; exit code ${value.exitCode}`;
  }
  return `${factPhrase(value.kind)}; ${factPhrase(value.reason)}`;
}

export function renderTiming(
  value: TimingView,
  stdout: { readonly isTTY: boolean; readonly columns: number | undefined },
): string {
  const piped = !stdout.isTTY;
  const headers = piped
    ? [
        "Activity ID",
        "Parent",
        "Turn",
        "Phase",
        "Label",
        "Assertion ID",
        "Assertion",
        "Transmission",
        "Start",
        "Duration",
        "Outcome",
      ]
    : ["Phase", "Label", "Duration", "Outcome"];
  const rows = value.activities.map((activity) =>
    piped
      ? [
          activity.activityId,
          activity.parentActivityId ?? "none",
          activity.turnId ?? "none",
          activity.phase,
          activity.label,
          activity.entryId ?? "none",
          activity.assertionLabel ?? "none",
          activity.transmissionOrdinal === undefined ? "none" : String(activity.transmissionOrdinal),
          `${fmt(activity.startOffsetMs)} ms`,
          `${fmt(activity.durationMs)} ms`,
          activity.outcome,
        ]
      : [
          activity.phase,
          [
            activity.label,
            activity.assertionLabel,
            activity.transmissionOrdinal === undefined ? undefined : `attempt ${activity.transmissionOrdinal}`,
          ]
            .filter(Boolean)
            .join(" · "),
          `${fmt(activity.durationMs)} ms`,
          activity.outcome,
        ],
  );
  const widths = headers.map((header, index) =>
    Math.max(stringWidth(header), ...rows.map((row) => stringWidth(row[index]!))),
  );
  const width = piped
    ? Math.max(80, widths.reduce((sum, size) => sum + size, 0) + 2 * headers.length)
    : stdout.columns || TERMINAL_OPTIONS.width;
  const failedActivities = value.activities.filter((activity) => activity.outcome === "failed");
  return renderTerminal(
    [
      {
        footerCommand: undefined,
        capWidth: true,
        kind: "panel",
        title: `Timing ${value.locator}`,
        meta: factPhrase(value.state),
        blocks: [
          {
            kind: "keyValue",
            entries: [
              { key: "State", value: factPhrase(value.state) },
              { key: "Activities", value: String(value.activities.length) },
              {
                key: "Omitted activities",
                value: value.hasMore ? String(value.omittedActivityCount) : "0",
              },
              { key: "Limitations", value: String(value.limitations.length) },
              ...(value.continuation === undefined
                ? []
                : [
                    {
                      key: "Next",
                      value: `niceeval show ${value.locator} timing --continuation ${value.continuation}`,
                    },
                  ]),
            ],
          },
          { meta: undefined, attachNext: false, kind: "divider", title: "Limitations" },
          projectionLimitationTable(value.limitations),
          { meta: undefined, attachNext: false, kind: "divider", title: "Activities" },
          {
            kind: "table",
            columns: headers.map((header, index) => ({ header, maxWidth: widths[index] })),
            rows,
            overflow: "wrap",
          },
          ...(failedActivities.length > 0
            ? [
                { meta: undefined, attachNext: false, kind: "divider" as const, title: "Failed activities" },
                ...failedActivities.map((activity) => ({
                  kind: "keyValue" as const,
                  entries: [
                    { key: "Activity", value: activity.label },
                    { key: "Phase", value: activity.phase },
                    ...(activity.assertionLabel === undefined
                      ? []
                      : [{ key: "Assertion", value: activity.assertionLabel }]),
                    { key: "Duration", value: `${fmt(activity.durationMs)} ms` },
                  ],
                })),
              ]
            : []),
        ],
      },
    ],
    { ...TERMINAL_OPTIONS, width },
  );
}

type UsageTotals = UsageView["totals"];

function numericUsageTotal(total: UsageTotals["inputTokens"]): string {
  return `${total.value === null ? "not recorded" : fmt(total.value)} (${total.state}; ${total.observationCount} observations)`;
}

function usageTotalEntries(totals: UsageTotals): readonly { readonly key: string; readonly value: string }[] {
  return [
    { key: "Input tokens", value: numericUsageTotal(totals.inputTokens) },
    ...(totals.inputTotalTokens === undefined
      ? []
      : [{ key: "Input including cache", value: numericUsageTotal(totals.inputTotalTokens) }]),
    { key: "Output tokens", value: numericUsageTotal(totals.outputTokens) },
    { key: "Requests", value: numericUsageTotal(totals.requests) },
    totals.costs === undefined
      ? {
          key: "Provider costs",
          value: `${totals.providerCosts?.state ?? "unavailable"}; ${totals.providerCosts?.observationCount ?? 0} observations${
            (totals.providerCosts?.values.length ?? 0) === 0
              ? "; no recorded values"
              : `; ${totals
                  .providerCosts!.values.map(
                    (cost) => `${cost.value} ${cost.currency} (${cost.observationCount} observations)`,
                  )
                  .join("; ")}`
          }`,
        }
      : {
          key: "Application cost",
          value: `${totals.costs.state}${totals.costs.state === "partial" ? "; known subtotal" : ""}; ${totals.costs.source ?? "unknown"}; ${
            totals.costs.values.length === 0
              ? `0/${totals.costs.totalCalls} covered calls; no recorded values`
              : totals.costs.values
                  .map(
                    (cost) =>
                      `${cost.value} ${cost.currency} (${cost.coveredCalls}/${totals.costs!.totalCalls} covered calls; ${cost.source}; ${cost.estimatedCalls} estimated)`,
                  )
                  .join("; ")
          }`,
        },
  ];
}

function estimatedCostRangeEntry({ currency, lower, upper }: NonNullable<UsageView["totalCosts"]["estimatedRange"]>) {
  return { key: "Estimated cost range (covered usage)", value: `${currency} ${lower}–${upper}` };
}

function totalCostBlocks(costs: UsageView["totalCosts"]): readonly TerminalPanelContentBlock[] {
  const complete = costs.state === "complete";
  const reasons = {
    "no-pricing-profile": "No applicable prices for recorded model token usage",
    "provider-cost-not-reported": "Provider cost or priceable call evidence was not reported",
    "token-buckets-incomplete": "Sealed prices lack required token buckets",
    "observed-usage-cost-incomplete": "Application usage observed. Physical call ledger and complete cost are missing",
    "usage-not-recorded": "Usage was not recorded completely",
  };
  const models = [...new Set(costs.gaps.flatMap((gap) => gap.models))].sort();
  return [
    { meta: undefined, attachNext: false, kind: "divider", title: complete ? "Total costs" : "Known subtotal" },
    {
      kind: "keyValue",
      entries: [
        { key: "Cost coverage", value: complete ? "Complete" : "Incomplete" },
        ...(costs.simulatedUser === undefined
          ? []
          : [
              {
                key: "simulated-user",
                value: `${costs.simulatedUser.amountUSD === null ? "Unpriced" : `USD ${costs.simulatedUser.amountUSD}`} · ${costs.simulatedUser.calls} requests · ${costs.simulatedUser.state}`,
              },
              ...(costs.simulatedUser.builtinCatalogCalls === undefined
                ? []
                : [
                    {
                      key: "Built-in catalog estimate",
                      value: `${costs.simulatedUser.builtinCatalogCalls} simulated-user calls`,
                    },
                  ]),
            ]),
        ...(costs.missingSources.length === 0
          ? []
          : [{ key: "Missing sources", value: costs.missingSources.join(", ") }]),
        ...costs.gaps.map((gap) => ({
          key: gap.source,
          value:
            gap.reason === "no-pricing-profile"
              ? `${reasons[gap.reason]} (${gap.totalModelCount} models)${gap.models.length === 0 ? "" : ` · ${gap.models.join(", ")}`}`
              : reasons[gap.reason],
        })),
        ...(costs.values.length === 0
          ? [{ key: "Amount", value: complete ? "No recorded charges" : "Unavailable" }]
          : []),
      ],
    },
    ...(costs.values.length === 0
      ? []
      : [
          {
            kind: "table" as const,
            columns: [
              { maxWidth: 40, header: "Currency" },
              { maxWidth: 40, header: complete ? "Total" : "Known subtotal" },
              { maxWidth: 40, header: "Source" },
            ],
            rows: costs.values.map((cost) => [cost.currency, cost.value, cost.source]),
            overflow: "wrap" as const,
          },
        ]),
    ...(costs.estimatedRange === undefined
      ? []
      : [{ kind: "keyValue" as const, entries: [estimatedCostRangeEntry(costs.estimatedRange)] }]),
    ...(models.length === 0
      ? []
      : [
          {
            meta: undefined,
            attachNext: false,
            kind: "divider" as const,
            title: `Pricing: add prices for ${models.join(", ")} to defineConfig({ pricing })`,
          },
          {
            meta: undefined,
            attachNext: false,
            kind: "divider" as const,
            title: "Pricing: https://niceeval.dev/reference/define-config#pricing",
          },
        ]),
  ];
}

function cacheReadBlocks(
  report: import("../o11y/cache-read.ts").CacheReadReport | undefined,
): readonly TerminalPanelContentBlock[] {
  if (report === undefined) return [];
  const row = (label: string, summary: import("../o11y/cache-read.ts").CacheReadSummary) => [
    label,
    summary.rate.state === "exact" ? `${(summary.rate.value * 100).toFixed(2)}%` : "Unavailable",
    `${summary.coveredCalls}/${summary.recordedCalls}`,
    summary.collectionComplete ? "Complete" : "Incomplete",
    summary.reasons
      .map((reason) =>
        reason === "adapter-usage-required" ? "Adapter physical call ledger required" : factPhrase(reason),
      )
      .join(", ") || "—",
  ];
  return [
    { meta: undefined, attachNext: false, kind: "divider", title: "Cache read rate" },
    {
      kind: "table",
      columns: [
        { maxWidth: 40, header: "Scope" },
        { maxWidth: 40, header: "Rate" },
        { maxWidth: 40, header: "Covered calls" },
        { maxWidth: 40, header: "Collection" },
        { maxWidth: 40, header: "Reasons" },
      ],
      rows: [
        row("Total", report.total),
        ...report.roles.map((group) => row(`Role: ${group.modelRole ?? "not recorded"}`, group)),
        ...report.models.map((group) =>
          row(
            `${group.modelRole ?? "not recorded"} / ${group.provider ?? "not recorded"} / ${group.model ?? "not recorded"}`,
            group,
          ),
        ),
      ],
      overflow: "wrap",
    },
  ];
}

function modelUsageBlocks(
  value: Pick<UsageView, "configuredModels" | "modelGroups" | "totalCosts"> & {
    readonly judgeUsage: import("../inspection/results.ts").JudgeUsageSummary;
  },
): readonly TerminalPanelContentBlock[] {
  const configured = value.configuredModels;
  const groups = value.modelGroups;
  function recordedCalls(count: number | null): string {
    if (count === null) return "—";
    return count === 0 ? "0 (no recorded calls)" : String(count);
  }
  function configurationBlocks(): readonly TerminalPanelContentBlock[] {
    if (configured.state !== "available")
      return [{ kind: "keyValue", entries: [{ key: "Configuration", value: factPhrase(configured.state) }] }];
    if (configured.bindings.length === 1 && configured.bindings[0].modelRole === "default") {
      const defaultBinding = configured.bindings[0];
      return [
        {
          kind: "keyValue",
          entries: [
            { key: "Configured model (default)", value: defaultBinding.model ?? "—" },
            ...(defaultBinding.reasoningEffort === null
              ? []
              : [{ key: "Effort", value: defaultBinding.reasoningEffort }]),
            { key: "Recorded calls", value: recordedCalls(defaultBinding.recordedCalls) },
          ],
        },
      ];
    }
    if (configured.bindings.length === 0)
      return [{ kind: "keyValue", entries: [{ key: "Configured roles", value: "0" }] }];
    return [
      {
        kind: "table",
        columns: [
          { maxWidth: 40, header: "Role" },
          { maxWidth: 40, header: "Configured model" },
          { maxWidth: 40, header: "Effort" },
          { maxWidth: 40, header: "Recorded calls" },
        ],
        rows: configured.bindings.map((binding) => [
          binding.modelRole,
          binding.model ?? "—",
          binding.reasoningEffort ?? "—",
          recordedCalls(binding.recordedCalls),
        ]),
        overflow: "wrap",
      },
    ];
  }
  return [
    { meta: undefined, attachNext: false, kind: "divider", title: "Configured model roles" },
    ...configurationBlocks(),
    { meta: undefined, attachNext: false, kind: "divider", title: "Actual model usage" },
    {
      kind: "keyValue",
      entries: [
        { key: "State", value: factPhrase(groups.state) },
        { key: "Basis", value: groups.basis },
        {
          key: "Groups",
          value: `${groups.groups.length} shown; ${groups.totalGroupCount ?? "unknown"} total; ${groups.omittedGroupCount} omitted${groups.groupsTruncated ? " (truncated)" : ""}`,
        },
        ...("reason" in groups && groups.reason !== undefined
          ? [{ key: "Reason", value: factPhrase(groups.reason) }]
          : []),
      ],
    },
    {
      kind: "table",
      columns: [
        { header: "Role / provider / actual model", maxWidth: 30 },
        { header: "Calls / tokens", maxWidth: 18 },
        { header: "Application cost", maxWidth: 24 },
      ],
      rows: groups.groups.map((group) => [
        `Role: ${group.modelRole ?? "not recorded"}\nProvider: ${group.provider ?? "not recorded"}\n${group.model ?? "not recorded"}`,
        `${group.recordedCalls} calls\nInput incl. cache: ${metric(projectMetric(group.tokens.inputTotalTokens))}\nOutput: ${metric(projectMetric(group.tokens.outputTokens))}\nTotal: ${metric(projectMetric(group.tokens.totalTokens))}`,
        group.costs.values.length === 0
          ? group.costs.state
          : group.costs.values
              .map(
                (cost) =>
                  `${cost.value} ${cost.currency} (${group.costs.state}${group.costs.state === "partial" ? "; known subtotal" : ""}; ${cost.coveredCalls}/${group.costs.totalCalls} covered; ${cost.source})`,
              )
              .join("; "),
      ]),
      overflow: "wrap",
    },
    { meta: undefined, attachNext: false, kind: "divider", title: "Judge usage" },
    {
      kind: "keyValue",
      entries:
        "totals" in value.judgeUsage
          ? [
              {
                key: "Physical calls",
                value:
                  value.judgeUsage.totals.requests.value === 0 && value.judgeUsage.totals.requests.state === "available"
                    ? "No Judge calls"
                    : metric(projectMetric(value.judgeUsage.totals.requests)),
              },
              { key: "Input tokens", value: metric(projectMetric(value.judgeUsage.totals.inputTotalTokens)) },
              { key: "Output tokens", value: metric(projectMetric(value.judgeUsage.totals.outputTokens)) },
              { key: "Total tokens", value: metric(projectMetric(value.judgeUsage.totals.totalTokens)) },
              { key: "Cost", value: factPhrase(value.judgeUsage.totals.costs.state) },
              ...(value.judgeUsage.builtinCatalogCalls === undefined
                ? []
                : [{ key: "Built-in catalog estimate", value: `${value.judgeUsage.builtinCatalogCalls} Judge calls` }]),
              ...value.judgeUsage.totals.costs.values.map((cost) => ({
                key: cost.currency,
                value: `${cost.value} (${cost.coveredCalls}/${value.judgeUsage.state === "complete" || value.judgeUsage.state === "partial" ? value.judgeUsage.totals.costs.totalCalls : "unknown"} covered; ${cost.source})`,
              })),
              ...(value.judgeUsage.totals.estimatedRange === undefined
                ? []
                : [estimatedCostRangeEntry(value.judgeUsage.totals.estimatedRange)]),
            ]
          : [{ key: "State", value: `${value.judgeUsage.state}; ${factPhrase(value.judgeUsage.reason)}` }],
    },
  ];
}

function turnCacheReadBlocks(summary: UsageView["turnCacheRead"]): readonly TerminalPanelContentBlock[] {
  return [
    { meta: undefined, attachNext: false, kind: "divider", title: "Cached input share (turn-observed)" },
    {
      kind: "keyValue",
      entries: [
        {
          key: "Share",
          value:
            summary.value === null
              ? factPhrase(summary.state)
              : `${(summary.value * 100).toFixed(2)}% (${summary.state})`,
        },
        {
          key: "Basis",
          value:
            "turn-observed input token buckets. This share measures tokens, with no inference about physical requests or their hit rate.",
        },
        { key: "Covered Turns", value: String(summary.coveredTurns) },
        ...(summary.reason === null ? [] : [{ key: "Reason", value: factPhrase(summary.reason) }]),
        ...summary.missingTurns.map(({ turnId, buckets }) => ({
          key: "Missing buckets",
          value: `${turnId}: ${buckets.join(", ")}`,
        })),
      ],
    },
  ];
}

export function renderUsage(value: UsageView): string {
  return terminal([
    {
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Usage ${value.locator}`,
      meta: factPhrase(value.state),
      blocks: [
        ...totalCostBlocks(value.totalCosts),
        { meta: undefined, attachNext: false, kind: "divider", title: "Application usage" },
        {
          kind: "keyValue",
          entries: [
            { key: "State", value: factPhrase(value.state) },
            ...(value.source === "adapter"
              ? [
                  { key: "Coverage", value: "Recorded calls only" },
                  {
                    key: "Calls",
                    value: boundedPreview(
                      value.calls?.length ?? 0,
                      value.callsTruncated ?? false,
                      value.omittedCallCount ?? 0,
                    ),
                  },
                ]
              : []),
            ...usageTotalEntries(value.totals),
            {
              key: "Limitations",
              value: boundedPreview(value.limitations.length, value.limitationsTruncated, value.omittedLimitationCount),
            },
            {
              key: "Turns",
              value: boundedPreview(value.turns.length, value.turnsTruncated, value.omittedTurnCount),
            },
            {
              key: "Omitted observations",
              value: value.hasMore ? String(value.omittedObservationCount) : "0",
            },
          ],
        },
        ...cacheReadBlocks(value.cacheRead),
        ...turnCacheReadBlocks(value.turnCacheRead),
        ...modelUsageBlocks(value),
        { meta: undefined, attachNext: false, kind: "divider", title: "Limitations" },
        {
          kind: "table",
          columns: [{ maxWidth: 40, header: "Limitation" }],
          rows: countedSummaries(value.limitations.map(formatUsageLimitation)).map((limitation) => [limitation]),
          overflow: "wrap",
        },
        {
          meta: undefined,
          attachNext: false,
          kind: "divider",
          title: value.totals.costs === undefined ? "Provider costs" : "Application costs",
        },
        {
          overflow: "truncate",
          kind: "table",
          columns: [
            { maxWidth: 40, header: "Currency" },
            { maxWidth: 40, header: "Value" },
            { maxWidth: 40, header: "State" },
            { maxWidth: 40, header: "Observations" },
          ],
          rows:
            value.totals.costs === undefined
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
        { meta: undefined, attachNext: false, kind: "divider", title: "Turn coverage" },
        {
          overflow: "truncate",
          kind: "table",
          columns: [
            { maxWidth: 40, header: "Turn" },
            { maxWidth: 40, header: "Coverage" },
            { maxWidth: 40, header: "Reason" },
          ],
          rows: value.turns.map((turn) => [
            turn.turnId,
            turn.coverage.state,
            turn.coverage.state === "complete" ? "none" : factPhrase(turn.coverage.reason),
          ]),
        },
        { meta: undefined, attachNext: false, kind: "divider", title: "Observation provenance" },
        {
          kind: "table",
          columns: [
            { maxWidth: 40, header: "Turn" },
            { maxWidth: 40, header: "Observation ID" },
            { maxWidth: 40, header: "Kind" },
            { maxWidth: 40, header: "Provider" },
            { maxWidth: 40, header: "Recorded value" },
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

function usageObservationValue(value: UsageView["observations"][number]): string {
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
  if ((value.state === "complete" || value.state === "partial") && value.detail !== undefined) {
    const { detail } = value;
    const pageStatus = (page: typeof detail.before | typeof detail.hunks) =>
      page.state === "available" && page.omittedBytes > 0
        ? `available through byte ${page.endOffset} (${page.omittedBytes} bytes remaining)`
        : page.state;
    const hunk = detail.hunks.state === "available" ? detail.hunks.text : "Unified diff unavailable";
    const remaining = detail.hunks.omittedBytes > 0 ? `\nHunks: ${pageStatus(detail.hunks)}` : "";
    return `Diff ${detail.path} (${detail.changeId})\nBefore: ${pageStatus(detail.before)}\nAfter: ${pageStatus(detail.after)}\n${hunk}${remaining}\n`;
  }
  const statusBlocks: TerminalPanelContentBlock[] = [
    {
      kind: "keyValue",
      entries: [
        { key: "State", value: factPhrase(value.state) },
        { key: "Windows", value: String(value.windows.length) },
      ],
    },
  ];
  if (value.state === "invalid") {
    statusBlocks.push(
      { meta: undefined, attachNext: false, kind: "divider", title: "Issues" },
      {
        kind: "table",
        columns: [{ maxWidth: 40, header: "Issue" }],
        rows: value.issues.map((issue) => [issue]),
        overflow: "wrap",
      },
    );
  }
  if (value.state === "complete" || value.state === "partial") {
    if (value.omittedWindowCount > 0) {
      statusBlocks.push({
        kind: "keyValue",
        entries: [
          { key: "Windows remaining", value: String(value.omittedWindowCount) },
          { key: "Changes remaining", value: String(value.omittedChangeCount) },
        ],
      });
    }
    statusBlocks.push(
      { meta: undefined, attachNext: false, kind: "divider", title: "Limitations" },
      {
        kind: "table",
        columns: [{ maxWidth: 40, header: "Limitation" }],
        rows: countedSummaries(value.limitations.map(formatDiffLimitation)).map((limitation) => [limitation]),
        overflow: "wrap",
      },
    );
  }
  const blocks: TerminalBlock[] = [
    {
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Diff ${value.locator}`,
      meta: factPhrase(value.state),
      blocks: statusBlocks,
    },
  ];
  for (const window of value.windows) {
    blocks.push({
      footerCommand: undefined,
      capWidth: true,
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
        footerCommand: undefined,
        capWidth: true,
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

type DiffLimitation = Extract<DiffView, { readonly state: "complete" | "partial" }>["limitations"][number];

function formatDiffLimitation(value: DiffLimitation): string {
  switch (value.code) {
    case "capture-failed":
    case "capture-interrupted":
      return `${factPhrase(value.code)}; stage ${value.stage}; window ${value.atWindowId ?? "not recorded"}`;
    case "collection-cap-reached":
      return `${factPhrase(value.code)}; target ${value.target}; omitted at least ${value.omittedAtLeast}; window ${value.atWindowId ?? "not recorded"}`;
    case "unsupported-input":
      return `${factPhrase(value.code)}; target ${value.target}; omitted at least ${value.omittedAtLeast}`;
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
    return `elided; ${factPhrase(revision.reason)}; ${revision.byteLength} bytes`;
  }
  return `unavailable; ${factPhrase(revision.reason)}`;
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
  return comparison.pairs.filter(
    ({ left, right }) =>
      comparisonTransition(attempts.get(left.locator)!, attempts.get(right.locator)!) === "regressed",
  ).length;
}

function comparisonCostDelta(left: ComparisonAttempt, right: ComparisonAttempt): string {
  if (left.totalCosts?.state !== "complete" || right.totalCosts?.state !== "complete") return "unavailable";
  const currencies = new Set([...left.totalCosts.values, ...right.totalCosts.values].map(({ currency }) => currency));
  return (
    [...currencies]
      .map((currency) => {
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
        function deltaSign(): string {
          if (delta < 0n) return "-";
          return delta > 0n ? "+" : "";
        }
        return `${currency} ${deltaSign()}${places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`}`;
      })
      .join("; ") || "No charged calls"
  );
}

export function renderComparison(comparison: Comparison, attempts: ComparisonAttempts): string {
  const blocks: TerminalBlock[] = [
    { meta: undefined, attachNext: false, kind: "divider", title: `Run comparison · ${comparison.mode}` },
  ];
  const memberRows = (members: Comparison["left"]["members"]) =>
    members.map((member) => {
      const attempt = attempts.get(member.locator)!;
      return [
        member.evalId,
        String(member.attemptOrdinal),
        member.locator,
        attempt.verdict ?? "unavailable",
        score(attempt.score, attempt.verdict),
        attempt.totalCosts?.values.map(({ currency, value }) => `${currency} ${value}`).join("; ") || "unavailable",
        attempt.totalCosts?.state ?? "unavailable",
      ];
    });
  if (comparison.mode === "side-by-side") {
    for (const side of ["left", "right"] as const) {
      blocks.push(
        { meta: undefined, attachNext: false, kind: "divider", title: side === "left" ? "Baseline" : "Candidate" },
        {
          kind: "table",
          columns: ["Eval", "Ordinal", "Attempt", "Verdict", "Score", "Costs", "Cost state"].map((header) => ({
            maxWidth: 40,
            header,
          })),
          rows: memberRows(comparison[side].members),
          overflow: "wrap",
        },
      );
    }
  } else {
    for (const { left, right } of comparison.pairs) {
      const a = attempts.get(left.locator)!;
      const b = attempts.get(right.locator)!;
      const delta =
        a.score.state === "complete" && b.score.state === "complete" && a.score.possible === b.score.possible
          ? fmt(b.score.earned - a.score.earned)
          : "unavailable";
      blocks.push(
        { meta: undefined, attachNext: false, kind: "divider", title: `${left.evalId} · ${left.attemptOrdinal}` },
        {
          kind: "keyValue",
          entries: [
            {
              key: "Baseline",
              value: `${left.locator} · ${a.verdict ?? "unavailable"} · ${score(a.score, a.verdict)}`,
            },
            {
              key: "Candidate",
              value: `${right.locator} · ${b.verdict ?? "unavailable"} · ${score(b.score, b.verdict)}`,
            },
            { key: "Transition", value: comparisonTransition(a, b) },
            { key: "Score delta", value: delta },
            { key: "Cost delta", value: comparisonCostDelta(a, b) },
          ],
        },
      );
    }
  }
  blocks.push({
    kind: "keyValue",
    entries: [
      {
        key: "Members",
        value: `${comparison.left.members.length} baseline; ${comparison.right.members.length} candidate`,
      },
      { key: "Paired", value: String(comparison.pairs.length) },
      ...["stable-passed", "stable-failed", "improved", "incomparable"].map((transition) => ({
        key: transition,
        value:
          comparison.mode === "side-by-side"
            ? "not evaluated"
            : String(
                comparison.pairs.filter(
                  ({ left, right }) =>
                    comparisonTransition(attempts.get(left.locator)!, attempts.get(right.locator)!) === transition,
                ).length,
              ),
      })),
      {
        key: "Regressed",
        value:
          comparison.mode === "side-by-side" ? "not evaluated" : String(comparisonRegressions(comparison, attempts)),
      },
      { key: "Exact member set", value: String(comparison.exactMemberSet) },
    ],
  });
  return terminal(blocks);
}

export function renderReferences(project: InspectionProjectResult, attempts: ReferenceAttempts = new Map()): string {
  const previous = project.plannedAttempts.flatMap((slot) =>
    slot.state === "gap" && slot.previous !== null ? [{ ...slot, previous: slot.previous }] : [],
  );
  return terminal([
    {
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: "Historical reference results",
      blocks: [
        ...referenceSummary(project, attempts),
        ...previous.map((slot) => ({
          meta: undefined,
          attachNext: false,
          kind: "divider" as const,
          title: `${slot.experimentId} · ${slot.evalId} · ${slot.attemptOrdinal} · ${previousResultText(slot.previous.locator, attempts)}`,
        })),
        ...(project.history.length === 0
          ? []
          : [
              {
                overflow: "truncate" as const,
                kind: "table" as const,
                columns: [
                  { maxWidth: 40, header: "Experiment" },
                  { maxWidth: 40, header: "Eval" },
                  { maxWidth: 40, header: "Attempt" },
                  { maxWidth: 40, header: "Historical result" },
                ],
                rows: project.history.map((slot) => [
                  slot.experimentId,
                  slot.evalId,
                  String(slot.attemptOrdinal),
                  slot.locator ?? slot.sourceRunId,
                ]),
              },
            ]),
      ],
    },
  ]);
}

export function renderAssertions(
  locator: string,
  assertions: readonly AssertionDetailResult[],
  options: {
    readonly full: boolean;
    readonly agentJudgeTraces: ReadonlyMap<string, AgentJudgeTrace>;
    readonly summary:
      | { readonly kind: "not-requested" }
      | { readonly kind: "available"; readonly verdict: string; readonly score: ScoredValue };
  } = { full: false, agentJudgeTraces: new Map(), summary: { kind: "not-requested" } },
): string {
  const blocks: TerminalPanelContentBlock[] = [];
  const renderedAgentTraces = new Set<string>();
  const roles = assertions.flatMap((assertion) =>
    "entry" in assertion
      ? [
          {
            gate: assertion.entry.decision.gate,
            result: assertion.entry.decision.result,
            contribution: assertion.entry.contribution,
          },
        ]
      : [],
  );
  if (options.summary.kind === "available") {
    const { verdict, score } = options.summary;
    blocks.push({
      meta: undefined,
      attachNext: false,
      kind: "divider",
      title: assertionVerdictLine(verdict === "passed" && score.state === "complete" ? "scored" : verdict, score),
    });
  }
  const counts = assertionRoleCounts(roles);
  if (counts !== "") blocks.push({ meta: undefined, attachNext: false, kind: "divider", title: counts });

  for (const assertion of assertions) {
    if (!("entry" in assertion)) {
      blocks.push({
        meta: undefined,
        attachNext: false,
        kind: "divider",
        title: `${assertion.entryId}: ${assertion.state}`,
      });
      continue;
    }
    const entry = assertion.entry;
    blocks.push({
      meta: undefined,
      attachNext: false,
      kind: "divider",
      title: `${assertionRoleLabel({ gate: entry.decision.gate, result: entry.decision.result, contribution: entry.contribution })}  ${entry.entryId} · ${assertion.check.label}`,
    });
    const reasons = assertionReasons(entry.evaluation.observed);
    if (entry.explanationRetention.state === "retained")
      reasons.push(...assertionReasons(entry.explanationRetention.value));
    const failure = options.full ? entry.evaluatorFailure : undefined;
    blocks.push({
      kind: "keyValue",
      entries: [
        ...(entry.decision.reason === null ? [] : [{ key: "Reason", value: factPhrase(entry.decision.reason) }]),
        ...(failure === undefined
          ? []
          : [
              {
                key: "Evaluator failure",
                value:
                  failure.state === "recorded"
                    ? `${failure.name}: ${failure.message}${failure.truncated ? " [truncated]" : ""}`
                    : "not recorded",
              },
            ]),
        ...[...new Set(reasons)].map((value) => ({ key: "Rationale", value })),
        ...commandAssertionFields(entry.evaluation.observed),
      ],
    });
    if (entry.explanationRetention.state === "retained" && entry.explanationRetention.value.kind === "fields") {
      const labels: Readonly<Record<string, string>> = {
        code: "Failure",
        message: "Diagnostic",
        failureDetail: "Failure",
        failureEvidence: "Diagnostic",
      };
      const entries = entry.explanationRetention.value.fields.flatMap((field) =>
        labels[field.label] !== undefined && field.value.kind === "value" && typeof field.value.value === "string"
          ? [{ key: labels[field.label]!, value: field.value.value }]
          : [],
      );
      if (entries.length > 0) blocks.push({ kind: "keyValue", entries });
    }
    if (!("criterion" in entry)) continue;
    const scoreAudit = entry.scoreMatchAudit;
    if (
      scoreAudit?.state === "available" &&
      scoreAudit.audit.kind === "images" &&
      scoreAudit.audit.calls.some(
        (call) => call.state === "admitted" && call.wireBodyVerification === "unavailable-redacted-template",
      )
    ) {
      blocks.push({
        kind: "keyValue",
        entries: [
          {
            key: "Request audit",
            value:
              "The template was redacted. The digest identifies the original bytes sent and cannot be verified from the template.",
          },
        ],
      });
    }
    const agentAudit = entry.agentJudgeAudit;
    if (agentAudit?.state === "available") {
      blocks.push({
        kind: "keyValue",
        entries: [
          { key: "Prompt", value: agentAudit.audit.prompt },
          ...(agentAudit.audit.submission === null
            ? []
            : [
                {
                  key: "Measurement",
                  value: String(
                    "satisfied" in agentAudit.audit.submission.value
                      ? Number(agentAudit.audit.submission.value.satisfied)
                      : agentAudit.audit.submission.value.measurement,
                  ),
                },
                { key: "Rationale", value: agentAudit.audit.submission.value.rationale },
                ...agentAudit.audit.submission.value.evidence.map((item) => ({
                  key: `Evidence (${item.kind})`,
                  value: `${item.ref}: ${item.note}`,
                })),
              ]),
        ],
      });
      const trace = options.agentJudgeTraces.get(agentAudit.audit.trace.id);
      if (options.full && trace !== undefined && !renderedAgentTraces.has(agentAudit.audit.trace.id)) {
        renderedAgentTraces.add(agentAudit.audit.trace.id);
        for (const compact of trace.compactions)
          blocks.push({
            kind: "keyValue",
            entries: [
              {
                key: "Compaction",
                value: `After turn ${compact.trigger}; ${compact.tokensBefore ?? "unknown"} tokens`,
              },
              { key: "Summary", value: compact.summary ?? compact.failure?.message ?? "not recorded" },
            ],
          });
        blocks.push({
          kind: "table",
          columns: [
            { maxWidth: 40, header: "Turn" },
            { maxWidth: 40, header: "Tool" },
            { maxWidth: 40, header: "State" },
            { maxWidth: 40, header: "Arguments" },
            { maxWidth: 40, header: "Result" },
          ],
          rows: trace.tools.map((tool) => [
            String(tool.generation),
            tool.name,
            factPhrase(tool.state),
            recordedTextSummary(tool.arguments),
            tool.result === null ? "not recorded" : recordedTextSummary(tool.result),
          ]),
          overflow: "wrap",
        });
        blocks.push({
          kind: "keyValue",
          entries: [{ key: "Judge session", value: `${trace.session.length} entries` }],
        });
      }
    } else if (agentAudit !== undefined)
      blocks.push({
        kind: "keyValue",
        entries: [
          { key: "Agent Judge audit", value: agentAudit.state },
          ...(agentAudit.state === "invalid" ? [{ key: "Diagnostic", value: agentAudit.message }] : []),
        ],
      });
    if (options.full) {
      if (
        entry.criterion.state === "available" &&
        "kind" in entry.criterion.value &&
        entry.criterion.value.kind === "builtin" &&
        entry.criterion.value.id === "sandbox-change-scope"
      ) {
        blocks.push({
          kind: "keyValue",
          entries: [
            { key: "Criterion", value: entry.criterion.value.id },
            { key: "Allowed paths", value: entry.criterion.value.data.paths.join(", ") },
          ],
        });
      }
      if (
        entry.criterion.state === "available" &&
        "kind" in entry.criterion.value &&
        entry.criterion.value.kind === "builtin" &&
        entry.criterion.value.id === "sandbox-unchanged-within"
      ) {
        blocks.push({
          kind: "keyValue",
          entries: [
            { key: "Criterion", value: entry.criterion.value.id },
            { key: "Protected paths", value: entry.criterion.value.data.paths.join(", ") },
          ],
        });
      }
      if (
        entry.criterion.state === "available" &&
        "kind" in entry.criterion.value &&
        entry.criterion.value.kind === "builtin" &&
        entry.criterion.value.id === "sandbox-in-diff"
      ) {
        const criterion = entry.criterion.value;
        blocks.push({
          kind: "keyValue",
          entries: [
            { key: "Criterion", value: criterion.id },
            { key: "Pattern", value: `/${criterion.data.pattern}/${criterion.data.flags}` },
            { key: "Content", value: criterion.data.content },
          ],
        });
      }
      if (
        entry.criterion.state === "available" &&
        "kind" in entry.criterion.value &&
        entry.criterion.value.kind === "builtin" &&
        entry.criterion.value.id === "sandbox-diff-paths"
      ) {
        const criterion = entry.criterion.value;
        blocks.push({
          kind: "keyValue",
          entries: [
            { key: "Criterion", value: criterion.id },
            { key: "Operation", value: criterion.data.operation },
            { key: "Pattern", value: `/${criterion.data.pattern}/${criterion.data.flags}` },
            { key: "Content", value: "none" },
          ],
        });
      }
      if (entry.explanationRetention.state === "retained") {
        const value = entry.explanationRetention.value;
        if (value.kind === "fields") {
          const equalityMismatch = value.fields.some(
            ({ label, value }) => label === "code" && value.kind === "value" && value.value === "equals-mismatch",
          );
          const labels: Readonly<Record<string, string>> = {
            expected: "Expected",
            received: equalityMismatch ? "Actual" : "Received",
          };
          blocks.push({
            kind: "keyValue",
            entries: Object.entries(labels).flatMap(([label, key]) => {
              const field = value.fields.find((field) => field.label === label)?.value;
              if (field?.kind === "value" && typeof field.value === "string") return [{ key, value: field.value }];
              return equalityMismatch ? [{ key, value: "comparison preview not recorded" }] : [];
            }),
          });
        }
      }
      if (
        assertion.matcher.state === "available" &&
        assertion.matcher.sourceLedger.sourceSnapshot.scope === "session"
      ) {
        blocks.push({
          kind: "keyValue",
          entries: [{ key: "Session", value: assertion.matcher.sourceLedger.sourceSnapshot.sessionId }],
        });
      }
    }
    const debuggerView = assertion.matcher.debugger;
    if (options.full && debuggerView?.state === "current" && debuggerView.steps.length > 0) {
      blocks.push({
        kind: "table",
        columns: [
          { maxWidth: 40, header: "Step" },
          { maxWidth: 40, header: "State" },
          { maxWidth: 40, header: "Source row" },
        ],
        rows: debuggerView.steps.map((step) => [
          String(step.step),
          factPhrase(step.state),
          step.sourceRow ?? "not recorded",
        ]),
        overflow: "wrap",
      });
    }
  }
  if (assertions.length === 0)
    blocks.push({ meta: undefined, attachNext: false, kind: "divider", title: "No Assertion entries recorded" });
  return terminal([
    {
      meta: undefined,
      footerCommand: undefined,
      capWidth: true,
      kind: "panel",
      title: `Assertions ${locator}`,
      blocks,
    },
  ]);
}

function commandAssertionFields(value: AssertionFactValue): { key: string; value: string }[] {
  if (value.kind !== "fields") return [];
  const command = value.fields.find((field) => field.label === "commandResult")?.value;
  if (command?.kind !== "fields") return [];
  return command.fields.flatMap((field) =>
    field.value.kind === "value" ? [{ key: field.label, value: String(field.value.value) }] : [],
  );
}

function assertionReasons(value: AssertionFactValue): string[] {
  if (value.kind !== "fields") return [];
  const state = value.fields.find((field) => field.label === "state")?.value;
  if (state?.kind === "value" && state.value === "unavailable") return [];
  return value.fields.flatMap((field) => {
    if (field.label === "rationale" || field.label === "reason") {
      if (field.value.kind === "value" && typeof field.value.value === "string")
        return [field.label === "reason" ? factPhrase(field.value.value) : recordedTextSummary(field.value.value)];
      if (field.label === "rationale" && field.value.kind === "fields") {
        const state = field.value.fields.find((item) => item.label === "state")?.value;
        const text = field.value.fields.find((item) => item.label === "value")?.value;
        if (
          state?.kind === "value" &&
          state.value === "available" &&
          text?.kind === "value" &&
          typeof text.value === "string"
        )
          return [text.value];
      }
    }
    return assertionReasons(field.value);
  });
}

export function renderAssertionPage(assertion: typeof PagedAssertionDetailSchema.Type): string {
  return terminal([
    { kind: "divider", meta: undefined, attachNext: false, title: `Assertion ${assertion.entryId}` },
    {
      kind: "keyValue",
      entries: assertion.fields.map((field) => {
        const preview = new TextDecoder()
          .decode(decodeBase64Bytes(field.base64.slice(0, 160)), { stream: true })
          .replaceAll("\uFFFD", "");
        return {
          key: field.path,
          value: `Bytes ${field.offset}–${field.nextOffset ?? field.byteLength} of ${field.byteLength}  ${preview}`,
        };
      }),
    },
  ]);
}

export function renderAssertionMatrix(matrix: import("../inspection/assertion-matrix.ts").AssertionMatrix): string {
  const blocks: TerminalBlock[] = [];
  for (const value of matrix.evals) {
    blocks.push({ meta: undefined, attachNext: false, kind: "divider", title: value.evalId });
    blocks.push({ kind: "raw", text: "* marks different decisions or scores across columns." });
    value.columns.forEach((column, index) =>
      blocks.push({
        kind: "raw",
        text: `${index + 1}: ${column.experimentId} #${column.attemptOrdinal} ${column.locator ?? (column.publication.state === "absent" ? column.publication.reason : "pending")}`,
      }),
    );
    blocks.push({
      overflow: "truncate",
      kind: "table",
      columns: [
        { maxWidth: 40, header: "Criterion" },
        ...value.columns.map((_, index) => ({ maxWidth: 40, header: String(index + 1) })),
      ],
      rows: [
        [
          "Verdict / score",
          ...value.columns.map((column) => `${column.verdict ?? "—"} / ${metric(projectMetric(column.score))}`),
        ],
        ...value.rows.map((row) => [
          `${row.distinct ? "* " : ""}${[...row.groupPath, row.label].join(" / ")}`,
          ...row.cells.map(function matrixCell(cell) {
            if (cell.state === "absent") return "—";
            if (cell.state !== "available") return cell.state;
            return cell.entries
              .map(function entryScore({ result, contribution }) {
                if (contribution.state === "earned") return `${fmt(contribution.earned)}/${fmt(contribution.points)}`;
                if (contribution.state === "unavailable") return `${result} (—/${fmt(contribution.points)})`;
                return result;
              })
              .join("; ");
          }),
        ]),
      ],
    });
    if (value.unlabeled.some((count) => count > 0))
      blocks.push({ kind: "raw", text: `Unlabeled entries by column: ${value.unlabeled.join(", ")}` });
  }
  blocks.push({
    kind: "raw",
    text: `Matrix ${matrix.state}; omitted: ${matrix.omitted.evals} evals, ${matrix.omitted.rows} rows, ${matrix.omitted.columns} columns.`,
  });
  return terminal(blocks);
}
