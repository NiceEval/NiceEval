/** The stable exact-Attempt selector. */

import type {
  Sample,
  SampleSnapshot,
} from "../../analysis/index.ts";
import { jsx } from "react/jsx-runtime";
import type { AttemptLocator } from "../../attempt-locator.ts";
import type { Page } from "../definition/report.ts";
import { type HeroData } from "../components/site-components/index.tsx";
import {
  toAttemptEvidence,
  toAttemptObservability,
  toFileChanges,
  toSandboxHistory,
  toSources,
} from "../model/conversions.ts";
import {
  AttemptDetailResultView,
  type MembershipRow,
} from "./result-components.tsx";
import {
  builtInMachineProducerIds,
  defineBuiltInReport,
} from "./machine.ts";

interface AttemptOverviewPageInput {
  readonly hero: HeroData;
  readonly locator: AttemptLocator | null;
  readonly members: readonly MembershipRow[];
  readonly evidence: Awaited<ReturnType<typeof toAttemptEvidence>>;
  readonly observability: Awaited<ReturnType<typeof toAttemptObservability>>;
  readonly fileChanges: Awaited<ReturnType<typeof toFileChanges>>;
  readonly sources: Awaited<ReturnType<typeof toSources>>;
  readonly sandbox: Awaited<ReturnType<typeof toSandboxHistory>>;
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

function selectedLocator(snapshot: SampleSnapshot): AttemptLocator | null {
  const locators = snapshot.slots
    .filter((slot) => slot.state === "included")
    .map((slot) => slot.attempt.locator);
  return locators.length === 1 ? locators[0]! : null;
}

function membershipRows(snapshot: SampleSnapshot, locator: AttemptLocator | null): readonly MembershipRow[] {
  return Object.freeze(snapshot.slots
    .filter((slot) => locator === null || (slot.state === "included" && slot.attempt.locator === locator))
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

const attemptOverviewPage = {
  id: "attempt-overview",
  path: "/",
  title: "Attempt overview",
  load: async (sample: Sample): Promise<AttemptOverviewPageInput> => {
    const locator = selectedLocator(sample.snapshot);
    const [evidence, observability, fileChanges, sources, sandbox] = await Promise.all([
      toAttemptEvidence(sample, locator ?? undefined),
      toAttemptObservability(sample, locator ?? undefined),
      toFileChanges(sample, locator ?? undefined),
      toSources(sample, locator ?? undefined),
      toSandboxHistory(sample, locator ?? undefined),
    ]);
    return Object.freeze({
      hero: heroData(sample.snapshot),
      locator,
      members: membershipRows(sample.snapshot, locator),
      evidence,
      observability,
      fileChanges,
      sources,
      sandbox,
    });
  },
  render: (input: AttemptOverviewPageInput) => jsx(AttemptDetailResultView, input),
} satisfies Page<void, AttemptOverviewPageInput>;

/** The exact-locator default consumes only the selected closed Page data. */
export function attemptOverviewReport() {
  return defineBuiltInReport(builtInMachineProducerIds.attemptOverview, {
    title: "Attempt overview",
    pages: [attemptOverviewPage],
  });
}

/** The built-in default for an exact Attempt locator. */
export const defaultAttemptOverviewReport = attemptOverviewReport();

export default defaultAttemptOverviewReport;
