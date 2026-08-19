/**
 * The standard information architecture.
 *
 * Detail Pages are deliberately listed here. `defineReport()` receives no
 * library page collection, so a consumer's arbitrary custom Report never
 * gains attempt or experiment routes as an implicit side effect.
 */

import type {
  ExperimentId,
  Sample,
  SampleSnapshot,
} from "../../analysis/index.ts";
import type {
  Page,
  PageEvidence,
} from "../definition/report.ts";
import { Col } from "../definition/primitives.tsx";
import { AttemptDetails } from "../components/attempt-detail/index.tsx";
import { Hero, type HeroData } from "../components/site-components/index.tsx";
import { toAttemptObservability } from "../model/conversions.ts";
import {
  attemptDetailParams,
  experimentDetailParams,
  experimentDetailTarget,
} from "../library/details.ts";
import type {
  AttemptDetailTarget,
  ExperimentDetailTarget,
} from "../library/details.ts";
import {
  loadBuiltInAttemptRows,
  loadBuiltInExperimentRows,
  loadBuiltInSummaryRows,
  type BuiltInAttemptRows,
  type BuiltInExperimentRows,
  type BuiltInSummaryRows,
} from "./analysis-values.ts";
import {
  AttemptTrace,
  ExperimentDetailResultView,
  StandardAttemptsResultView,
  StandardOverviewResultView,
  type MembershipRow,
} from "./result-components.tsx";
import {
  builtInMachineProducerIds,
  defineBuiltInReport,
} from "./machine.ts";

interface StandardOverviewPageInput {
  readonly hero: HeroData;
  readonly summary: BuiltInSummaryRows;
  readonly experiments: BuiltInExperimentRows;
  readonly counts: {
    readonly experiments: number;
    readonly attempts: number;
    readonly expectedResults: number;
  };
}

interface StandardAttemptsPageInput {
  readonly hero: HeroData;
  readonly attempts: BuiltInAttemptRows;
}

interface StandardTracesPageInput {
  readonly hero: HeroData;
  readonly observability: Awaited<ReturnType<typeof toAttemptObservability>>;
}

interface StandardAttemptPageInput {
  readonly target: AttemptDetailTarget;
  readonly evidence: PageEvidence;
}

interface StandardExperimentPageInput {
  readonly hero: HeroData;
  readonly experiment: string;
  readonly rows: BuiltInExperimentRows;
  readonly members: readonly MembershipRow[];
}

function heroData(snapshot: SampleSnapshot): HeroData {
  const latest = snapshot.runs.reduce<number | null>(
    (current, run) => current === null || Number(run.startedAt) > current ? Number(run.startedAt) : current,
    null,
  );
  return Object.freeze({
    latestStartedAt: latest === null ? null : new Date(latest).toISOString(),
    runs: snapshot.runs.length,
  });
}

function membershipRows(
  snapshot: SampleSnapshot,
  filter: { readonly locator?: AttemptDetailTarget["locator"]; readonly experiment?: string } = {},
): readonly MembershipRow[] {
  return Object.freeze(snapshot.slots
    .filter((slot) => filter.experiment === undefined || String(slot.experimentId) === filter.experiment)
    .filter((slot) => filter.locator === undefined || (slot.state === "included" && slot.attempt.locator === filter.locator))
    .map((slot) => Object.freeze({
      key: `${slot.runId}:${slot.slotId}`,
      experiment: String(slot.experimentId),
      eval: String(slot.evalId),
      attempt: slot.attemptOrdinal,
      selectedRun: String(slot.runId),
      slot: String(slot.slotId),
      state: slot.state,
      relation: slot.state === "included" ? slot.relation : null,
      locator: slot.state === "included" ? slot.attempt.locator : null,
    })));
}

function includedAttemptCount(snapshot: SampleSnapshot): number {
  return snapshot.slots.filter((slot) => slot.state === "included").length;
}

/** The default top-level report Page. */
export const standardOverviewPage = {
  id: "report",
  title: { en: "Report", "zh-CN": "报告" },
  load: async (sample: Sample): Promise<StandardOverviewPageInput> => {
    const [summary, experiments] = await Promise.all([
      loadBuiltInSummaryRows(sample),
      loadBuiltInExperimentRows(sample),
    ]);
    return Object.freeze({
      hero: heroData(sample.snapshot),
      summary,
      experiments,
      counts: Object.freeze({
        experiments: experiments.length,
        attempts: includedAttemptCount(sample.snapshot),
        expectedResults: sample.snapshot.slots.filter((slot) => slot.state !== "excluded").length,
      }),
    });
  },
  render: (input: StandardOverviewPageInput) => <StandardOverviewResultView {...input} />,
} satisfies Page<void, StandardOverviewPageInput>;

/** The standard attempt list does one aggregation and never queries detail views. */
export const standardAttemptsPage = {
  id: "attempts",
  title: "Attempts",
  load: async (sample: Sample): Promise<StandardAttemptsPageInput> => Object.freeze({
    hero: heroData(sample.snapshot),
    attempts: await loadBuiltInAttemptRows(sample),
  }),
  render: (input: StandardAttemptsPageInput) => <StandardAttemptsResultView {...input} />,
} satisfies Page<void, StandardAttemptsPageInput>;

/** Trace navigation reads only the observability DomainView needed by this Page. */
export const standardTracesPage = {
  id: "traces",
  title: { en: "Traces", "zh-CN": "追踪" },
  load: async (sample: Sample): Promise<StandardTracesPageInput> => Object.freeze({
    hero: heroData(sample.snapshot),
    observability: await toAttemptObservability(sample),
  }),
  render: (input: StandardTracesPageInput) => (
    <Col>
      <Hero data={input.hero} />
      <AttemptTrace view={input.observability} mode="execution" timingMode="full" />
    </Col>
  ),
} satisfies Page<void, StandardTracesPageInput>;

/** One standard detail Page for one already-selected Attempt. */
export const standardAttemptPage = {
  id: "attempt",
  path: "/attempt",
  title: "Attempt",
  navigation: false,
  params: attemptDetailParams,
  load: async (_sample: Sample, params: AttemptDetailTarget, context): Promise<StandardAttemptPageInput> =>
    Object.freeze({
      target: params,
      evidence: await context.evidence(params.locator),
    }),
  render: (input: StandardAttemptPageInput) => <AttemptDetails attempt={input} />,
} satisfies Page<AttemptDetailTarget, StandardAttemptPageInput>;

function experimentForTarget(sample: Sample, target: ExperimentDetailTarget): ExperimentId {
  const candidates = new Map<string, ExperimentId>();
  for (const run of sample.snapshot.runs) candidates.set(String(run.experimentId), run.experimentId);
  for (const slot of sample.snapshot.slots) candidates.set(String(slot.experimentId), slot.experimentId);
  for (const candidate of candidates.values()) {
    if (experimentDetailTarget(candidate).key === target.key) return candidate;
  }
  throw new TypeError("Experiment Page target does not belong to this Sample");
}

/** One standard detail Page for one fixed-Sample Experiment identity. */
export const standardExperimentPage = {
  id: "experiment",
  path: "/experiment",
  title: "Experiment",
  navigation: false,
  params: experimentDetailParams,
  load: async (sample: Sample, params: ExperimentDetailTarget): Promise<StandardExperimentPageInput> => {
    const experiment = experimentForTarget(sample, params);
    return Object.freeze({
      hero: heroData(sample.snapshot),
      experiment: String(experiment),
      rows: await loadBuiltInExperimentRows(sample),
      members: membershipRows(sample.snapshot, { experiment: String(experiment) }),
    });
  },
  render: (input: StandardExperimentPageInput) => <ExperimentDetailResultView {...input} />,
} satisfies Page<ExperimentDetailTarget, StandardExperimentPageInput>;

/** Explicit composition only: standard owns its two detail Pages. */
export const standard = defineBuiltInReport(builtInMachineProducerIds.standard, {
  title: "NiceEval standard report",
  pages: [
    standardOverviewPage,
    standardAttemptsPage,
    standardTracesPage,
    standardAttemptPage,
    standardExperimentPage,
  ],
});

export default standard;
