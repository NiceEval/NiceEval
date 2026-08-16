/** The stable project-current built-in selector. */

import type {
  Sample,
  SampleSnapshot,
} from "../../analysis/index.ts";
import { jsx } from "react/jsx-runtime";
import type { Page } from "../definition/report.ts";
import { type HeroData } from "../components/site-components/index.tsx";
import {
  loadBuiltInExperimentRows,
  loadBuiltInSummaryRows,
  type BuiltInExperimentRows,
  type BuiltInSummaryRows,
} from "./analysis-values.ts";
import {
  StandardOverviewResultView,
} from "./result-components.tsx";
import {
  builtInMachineProducerIds,
  defineBuiltInReport,
} from "./machine.ts";

interface OverviewPageInput {
  readonly hero: HeroData;
  readonly summary: BuiltInSummaryRows;
  readonly experiments: BuiltInExperimentRows;
  readonly counts: {
    readonly experiments: number;
    readonly attempts: number;
  };
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

const overviewPage = {
  id: "overview",
  path: "/",
  title: "Overview",
  load: async (sample: Sample): Promise<OverviewPageInput> => {
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
        attempts: sample.snapshot.slots.filter((slot) => slot.state === "included").length,
      }),
    });
  },
  render: (input: OverviewPageInput) => jsx(StandardOverviewResultView, input),
} satisfies Page<void, OverviewPageInput>;

/** The default project-current report over Analysis-issued closed rows. */
export const defaultOverviewReport = defineBuiltInReport(builtInMachineProducerIds.defaultOverview, {
  title: "NiceEval overview",
  pages: [overviewPage],
});

/** Stable built-in token target for an explicit `--report overview`. */
export const overview = defaultOverviewReport;

export default defaultOverviewReport;
