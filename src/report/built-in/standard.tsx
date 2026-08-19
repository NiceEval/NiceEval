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
import { Col, Section } from "../definition/primitives.tsx";
import { defineComponent } from "../definition/tree.ts";
import { AttemptDetails } from "../components/attempt-detail/index.tsx";
import { ExperimentTable } from "../components/entity-lists/index.tsx";
import { experimentListData } from "../components/entity-lists/compute.ts";
import {
  Hero,
  SampleNotices,
  type HeroData,
} from "../components/site-components/index.tsx";
import {
  ExperimentScatter,
  SampleSummary,
} from "../components/summaries/index.tsx";
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
  loadBuiltInExperimentRows,
  type BuiltInExperimentRows,
} from "./analysis-values.ts";
import {
  ExperimentDetailResultView,
  type MembershipRow,
} from "./result-components.tsx";
import {
  builtInMachineProducerIds,
  defineBuiltInReport,
} from "./machine.ts";

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

const StandardExperimentResults = defineComponent(async (_props, context) => {
  const rows = await experimentListData(context.scope, context.report.pricing);
  return (
    <Col>
      <Section title={{ en: "Experiment comparison", "zh-CN": "实验对比" }}>
        <ExperimentScatter rows={rows} />
      </Section>
      <Section title={{ en: "Experiments", "zh-CN": "实验" }}>
        <ExperimentTable rows={rows} />
      </Section>
    </Col>
  );
});

function standardOverview() {
  return (
    <Col>
      <Hero />
      <SampleNotices />
      <SampleSummary />
      <StandardExperimentResults />
    </Col>
  );
}

/** The default top-level report Page uses the public classic component composition. */
export const standardOverviewPage = {
  id: "overview",
  path: "/",
  title: { en: "Overview", "zh-CN": "总览" },
  render: standardOverview,
} satisfies Page;

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
  title: "NiceEval overview",
  pages: [
    standardOverviewPage,
    standardAttemptPage,
    standardExperimentPage,
  ],
});

export default standard;
