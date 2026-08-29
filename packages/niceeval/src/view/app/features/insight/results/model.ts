import type { InspectionSuccessDocumentFor } from "../../../../../inspection/public.ts";
import {
  type AttemptListItem,
  type ExperimentListEvalRow,
  type ExperimentListItem,
  type ExperimentMetrics,
  type MetricValue,
  type Verdict,
} from "../results/experiment-table/index.tsx";
import type { ViewCatalogSelection } from "../shell/manifest.ts";

interface OverviewCell {
  readonly experimentId: string;
  readonly evalId: string;
  readonly evaluationKind: "pass" | "points" | "mixed";
  readonly passRate: MetricValue<number>;
  readonly score: MetricValue<number>;
  readonly costUSD: MetricValue<number>;
  readonly durationMs: MetricValue<number>;
  readonly tokens: MetricValue<number>;
  readonly tally: Readonly<Record<Verdict, number>>;
  readonly members: readonly OverviewMember[];
}

interface OverviewMember {
  readonly runId: string;
  readonly attemptOrdinal: number;
  readonly publication:
    | { readonly state: "pending" }
    | { readonly state: "absent"; readonly reason: string }
    | {
        readonly state: "published";
        readonly locator: string;
        readonly score: MetricValue<number>;
        readonly costUSD: MetricValue<number>;
        readonly durationMs: MetricValue<number>;
        readonly tokens: MetricValue<number>;
      };
}

interface OverviewAggregate {
  readonly evaluationKind: "pass" | "points" | "mixed";
  readonly passRate: MetricValue<number>;
  readonly score: MetricValue<number>;
  readonly costUSD: MetricValue<number>;
  readonly durationMs: MetricValue<number>;
  readonly tokens: MetricValue<number>;
}

interface OverviewGroup extends OverviewAggregate {
  readonly groupPath: readonly string[];
}

interface OverviewExperiment extends OverviewAggregate {
  readonly experimentId: string;
  readonly agent: ExecutionValue;
  readonly model: ExecutionValue;
  readonly groups: readonly OverviewGroup[];
}

type ExecutionValue =
  | { readonly state: "available"; readonly value: string }
  | { readonly state: "mixed" }
  | { readonly state: "unavailable" };

export interface ClosedOverview {
  readonly cells: readonly OverviewCell[];
  readonly experiments: readonly OverviewExperiment[];
  readonly catalog: ViewCatalogSelection;
}

export interface ResultsPageModel {
  readonly overview: ClosedOverview;
  readonly selectedExperiments: readonly string[];
  readonly selectionTitle: string;
}

export function closeOverview(document: InspectionSuccessDocumentFor<"overview.get">): ClosedOverview {
  const cells = document.overview.cells.map((cell) => Object.freeze({
    experimentId: cell.experimentId,
    evalId: cell.evalId,
    evaluationKind: cell.evaluationKind,
    passRate: projectMetric(cell.verdict.passRate),
    score: projectMetric(cell.score),
    costUSD: projectMetric(cell.costUSD),
    durationMs: projectMetric(cell.durationMs),
    tokens: projectMetric(cell.tokens),
    tally: Object.freeze({ ...cell.verdict.tally }),
    members: Object.freeze(cell.members.map((member) => Object.freeze({
      runId: member.runId,
      attemptOrdinal: member.attemptOrdinal,
      publication: member.publication.state === "published"
        ? Object.freeze({
            state: "published" as const,
            locator: member.publication.attemptLocator,
            score: projectMetric(member.publication.score),
            costUSD: projectMetric(member.publication.costUSD),
            durationMs: projectMetric(member.publication.durationMs),
            tokens: projectMetric(member.publication.tokens),
          })
        : member.publication,
    }))),
  }));
  const experiments = document.overview.experiments.map((experiment) => Object.freeze({
    experimentId: experiment.experimentId,
    evaluationKind: experiment.evaluationKind,
    passRate: projectMetric(experiment.verdict.passRate),
    score: projectMetric(experiment.score),
    costUSD: projectMetric(experiment.costUSD),
    durationMs: projectMetric(experiment.durationMs),
    tokens: projectMetric(experiment.tokens),
    agent: experiment.agent,
    model: experiment.model,
    groups: Object.freeze(experiment.groups.map((group) => Object.freeze({
      groupPath: Object.freeze([...group.groupPath]),
      evaluationKind: group.evaluationKind,
      passRate: projectMetric(group.verdict.passRate),
      score: projectMetric(group.score),
      costUSD: projectMetric(group.costUSD),
      durationMs: projectMetric(group.durationMs),
      tokens: projectMetric(group.tokens),
    }))),
  }));
  const experimentIds = experiments.map(({ experimentId }) => experimentId);
  const runExperiments = uniqueBy(
    cells.flatMap((cell) => cell.members.map((member) => ({
      runId: member.runId,
      experimentId: cell.experimentId,
    }))),
    ({ runId }) => runId,
  );
  const attemptExperiments = uniqueBy(
    cells.flatMap((cell) => cell.members.flatMap((member) => member.publication.state !== "published"
      ? []
      : [{ locator: member.publication.locator, experimentId: cell.experimentId }])),
    ({ locator }) => locator,
  );
  return Object.freeze({
    cells: Object.freeze(cells),
    experiments: Object.freeze(experiments),
    catalog: Object.freeze({
      experiments: Object.freeze(experimentIds),
      runExperiments: Object.freeze(runExperiments),
      attemptExperiments: Object.freeze(attemptExperiments),
    }),
  });
}

type OverviewMetric = InspectionSuccessDocumentFor<"overview.get">["overview"]["cells"][number]["score"];

function projectMetric(metric: OverviewMetric): MetricValue<number> {
  return Object.freeze({
    value: metric.value,
    state: metric.state,
    samples: metric.samples,
    total: metric.total,
    basis: metric.basis,
    issues: Object.freeze(metric.issues),
    refs: Object.freeze(metric.refs.map((ref) => Object.freeze({
      identity: Object.freeze({ kind: ref.identity.kind, locator: ref.identity.locator }),
    }))),
    ...(metric.unit === undefined ? {} : { unit: metric.unit }),
    ...("source" in metric &&
        (metric.source === "observed" || metric.source === "estimated" || metric.source === null)
      ? { source: metric.source }
      : {}),
    ...(metric.bounds === undefined ? {} : { bounds: Object.freeze({ ...metric.bounds }) }),
  });
}

export function overviewData(
  overview: ClosedOverview,
  selectedExperiments: readonly string[],
): readonly ExperimentListItem[] {
  const selected = new Set(selectedExperiments);
  const cells = overview.cells.filter(({ experimentId }) => selected.has(experimentId));
  const allEvalIds = [...new Set(cells.map(({ evalId }) => evalId))];
  return selectedExperiments.flatMap((experimentId) => {
    const experiment = overview.experiments.find((candidate) =>
      candidate.experimentId === experimentId);
    if (experiment === undefined) return [];
    const experimentCells = cells.filter((cell) => cell.experimentId === experimentId);
    if (experimentCells.length === 0) return [];
    const evalRows = experimentCells.map(closeEvalRow);
    const evaluationKind = experiment.evaluationKind;
    const missingEvalIds = allEvalIds.filter((evalId) =>
      !experimentCells.some((cell) => cell.evalId === evalId));
    return [Object.freeze({
      experimentId,
      agent: experiment.agent,
      model: experiment.model,
      flags: null,
      evaluationKind,
      score: experiment.score,
      costUSD: experiment.costUSD,
      durationMs: experiment.durationMs,
      tokens: experiment.tokens,
      endToEndPassRate: experiment.passRate,
      missingEvalIds: Object.freeze(missingEvalIds),
      groupMetrics: groupMetrics(experiment.groups),
      evalRows: Object.freeze(evalRows),
      href: `#/experiment/${encodeURIComponent(experimentId)}`,
    } satisfies ExperimentListItem)];
  });
}

function closeEvalRow(cell: OverviewCell): ExperimentListEvalRow {
  const attempts = cell.members.flatMap((member): readonly AttemptListItem[] => {
    if (member.publication.state !== "published") return [];
    const verdict = cell.members.length === 1 ? onlyVerdict(cell.tally) : null;
    return [Object.freeze({
      locator: member.publication.locator,
      experimentId: cell.experimentId,
      evalId: cell.evalId,
      attemptOrdinal: member.attemptOrdinal,
      verdict,
      failureSummary: null,
      evaluationKind: cell.evaluationKind === "pass" ? "pass" : "points",
      score: member.publication.score,
      costUSD: member.publication.costUSD,
      durationMs: member.publication.durationMs,
      tokens: member.publication.tokens,
      startedAt: null,
      href: `#/attempt/${member.publication.locator.startsWith("@") ? member.publication.locator.slice(1) : member.publication.locator}`,
    })];
  });
  return Object.freeze({
    evalId: cell.evalId,
    evaluationKind: cell.evaluationKind === "pass" ? "pass" : "points",
    score: cell.score,
    costUSD: cell.costUSD,
    durationMs: cell.durationMs,
    tokens: cell.tokens,
    endToEndPassRate: cell.passRate,
    attempts: Object.freeze(attempts),
  });
}

function groupMetrics(groups: readonly OverviewGroup[]): ReadonlyMap<string, ExperimentMetrics> {
  return new Map(groups.map((group) => [group.groupPath.join("/"), Object.freeze({
    passRate: group.passRate,
    score: group.score,
    costUSD: group.costUSD,
    durationMs: group.durationMs,
    tokens: group.tokens,
  })] as const));
}

function onlyVerdict(tally: Readonly<Record<Verdict, number>>): Verdict | null {
  if (tally.passed === 1 && tally.failed === 0 && tally.errored === 0 && tally.skipped === 0) {
    return "passed";
  }
  if (tally.passed === 0 && tally.failed === 1 && tally.errored === 0 && tally.skipped === 0) {
    return "failed";
  }
  if (tally.passed === 0 && tally.failed === 0 && tally.errored === 1 && tally.skipped === 0) {
    return "errored";
  }
  if (tally.passed === 0 && tally.failed === 0 && tally.errored === 0 && tally.skipped === 1) {
    return "skipped";
  }
  return null;
}

function uniqueBy<Value>(
  values: readonly Value[],
  keyOf: (value: Value) => string,
): readonly Value[] {
  const output = new Map<string, Value>();
  for (const value of values) output.set(keyOf(value), value);
  return Object.freeze([...output.values()]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
