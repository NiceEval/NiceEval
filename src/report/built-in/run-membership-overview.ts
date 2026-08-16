/** The stable explicit-Run membership selector. */

import type {
  Sample,
  SampleSnapshot,
} from "../../analysis/index.ts";
import { jsx } from "react/jsx-runtime";
import type { Page } from "../definition/report.ts";
import { type HeroData } from "../components/site-components/index.tsx";
import { toAttemptEvidence } from "../model/conversions.ts";
import {
  loadBuiltInSummaryRows,
  type BuiltInSummaryRows,
} from "./analysis-values.ts";
import {
  RunMembershipResultView,
  type MembershipRow,
} from "./result-components.tsx";
import {
  builtInMachineProducerIds,
  defineBuiltInReport,
} from "./machine.ts";

interface RunMembershipPageInput {
  readonly hero: HeroData;
  readonly summary: BuiltInSummaryRows;
  readonly members: readonly MembershipRow[];
  readonly evidence: Awaited<ReturnType<typeof toAttemptEvidence>>;
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

function membershipRows(snapshot: SampleSnapshot): readonly MembershipRow[] {
  return Object.freeze(snapshot.slots.map((slot) => Object.freeze({
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

const runMembershipPage = {
  id: "run-membership",
  path: "/",
  title: "Run membership overview",
  load: async (sample: Sample): Promise<RunMembershipPageInput> => {
    const [summary, evidence] = await Promise.all([
      loadBuiltInSummaryRows(sample),
      toAttemptEvidence(sample),
    ]);
    return Object.freeze({
      hero: heroData(sample.snapshot),
      summary,
      members: membershipRows(sample.snapshot),
      evidence,
    });
  },
  render: (input: RunMembershipPageInput) => jsx(RunMembershipResultView, input),
} satisfies Page<void, RunMembershipPageInput>;

/** The bounded default for explicit historical Run selectors. */
export function runMembershipOverviewReport() {
  return defineBuiltInReport(builtInMachineProducerIds.runMembershipOverview, {
    title: "Run membership overview",
    pages: [runMembershipPage],
  });
}

/** The CLI default Report for one or more explicit `--run` selectors. */
export const defaultRunMembershipOverviewReport = runMembershipOverviewReport();

export default defaultRunMembershipOverviewReport;
