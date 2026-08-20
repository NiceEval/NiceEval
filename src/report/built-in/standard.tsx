/**
 * The standard information architecture.
 *
 * Detail Pages are deliberately listed here. `defineReport()` receives no
 * library page collection, so a consumer's arbitrary custom Report never
 * gains attempt or experiment routes as an implicit side effect.
 */

import type {
  ExperimentComparisonScope,
  ExperimentGroupIdentity,
  ExperimentId,
  Sample,
  SampleSnapshot,
} from "../../analysis/index.ts";
import {
  experimentComparisonScope,
  experimentGroups,
} from "../../analysis/index.ts";
import type {
  Page,
  PageEvidence,
  PageParams,
} from "../definition/report.ts";
import { Col, Link, Section, Text } from "../definition/primitives.tsx";
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

const StandardExperimentResults = defineComponent<{ readonly comparison: ExperimentComparisonScope }>(async (props) => {
  return (
    <Col>
      <Section title={{ en: "Experiment comparison", "zh-CN": "实验对比" }}>
        <ExperimentScatter comparison={props.comparison} />
      </Section>
      <Section title={{ en: "Experiments", "zh-CN": "实验" }}>
        <ExperimentTable comparison={props.comparison} />
      </Section>
    </Col>
  );
});

function standardOverview(sample: Sample) {
  const groups = experimentGroups(sample);
  const only = groups.length === 1 ? groups[0] : undefined;
  return (
    <Col>
      <Hero />
      <SampleNotices />
      <SampleSummary />
      {only === undefined ? (
        <Section title={{ en: "Experiment groups", "zh-CN": "实验组" }}>
          <Col>
            {groups.map((entry) => (
              <Link
                key={entry.group.key}
                target={{
                  page: entry.group.kind === "named" ? "group-named" : "group-singleton",
                  params: entry.group,
                }}
              >
                {entry.group.kind === "named" ? entry.group.groupId : String(entry.group.experimentId)}
              </Link>
            ))}
          </Col>
        </Section>
      ) : <StandardExperimentResults comparison={experimentComparisonScope(sample, only.group)} />}
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

type NamedGroupParams = {
  readonly kind: "named";
  readonly groupId: string;
  readonly key: `named/${string}`;
};
type SingletonGroupParams = {
  readonly kind: "singleton";
  readonly experimentId: ExperimentId;
  readonly key: `singleton/${string}`;
};

const namedGroupParams: PageParams<NamedGroupParams> = Object.freeze({
  encode: (params: NamedGroupParams) => params.groupId,
  decode: (key: string) => {
    if (!/^[a-z0-9][a-z0-9._~-]*$/u.test(key)) throw new TypeError("named Experiment Group key is not canonical");
    return Object.freeze({ kind: "named" as const, groupId: key, key: `named/${key}` as const });
  },
  enumerate: (sample: Sample) => experimentGroups(sample)
    .filter((entry): entry is typeof entry & { readonly group: NamedGroupParams } => entry.group.kind === "named")
    .map((entry) => entry.group),
});

const singletonGroupParams: PageParams<SingletonGroupParams> = Object.freeze({
  encode: (params: SingletonGroupParams) => String(params.experimentId),
  decode: (key: string) => {
    if (!/^[a-z0-9][a-z0-9._~-]*$/u.test(key)) throw new TypeError("singleton Experiment Group key is not canonical");
    return Object.freeze({
      kind: "singleton" as const,
      experimentId: key as ExperimentId,
      key: `singleton/${key}` as const,
    });
  },
  enumerate: (sample: Sample) => experimentGroups(sample)
    .filter((entry): entry is typeof entry & { readonly group: SingletonGroupParams } => entry.group.kind === "singleton")
    .map((entry) => entry.group),
});

function standardGroupPage<Params extends import("../../analysis/index.ts").JsonValue>(input: {
  readonly id: string;
  readonly path: string;
  readonly groupKind: "named" | "singleton";
  readonly params: PageParams<Params>;
}): Page<Params, ExperimentComparisonScope> {
  return {
    id: input.id,
    path: input.path,
    title: { en: "Experiment group", "zh-CN": "实验组" },
    navigation: false as const,
    role: { kind: "experiment-group" as const, groupKind: input.groupKind },
    params: input.params,
    load: (sample: Sample, params: Params) =>
      experimentComparisonScope(sample, params as ExperimentGroupIdentity),
    render: (comparison: ExperimentComparisonScope) => (
      <Col>
        <Text>{comparison.group.key}</Text>
        <StandardExperimentResults comparison={comparison} />
      </Col>
    ),
  } as unknown as Page<Params, ExperimentComparisonScope>;
}

export const standardNamedGroupPage = standardGroupPage({
  id: "group-named",
  path: "/group/named",
  groupKind: "named",
  params: namedGroupParams,
});

export const standardSingletonGroupPage = standardGroupPage({
  id: "group-singleton",
  path: "/group/singleton",
  groupKind: "singleton",
  params: singletonGroupParams,
});

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
    standardNamedGroupPage,
    standardSingletonGroupPage,
    standardAttemptPage,
    standardExperimentPage,
  ],
});

export default standard;
