/** Focused views over the closed observability DomainView. */

import type {
  Sample,
  SampleSnapshot,
} from "../../analysis/index.ts";
import { jsx, jsxs } from "react/jsx-runtime";
import type { Page } from "../definition/report.ts";
import { Col } from "../definition/primitives.tsx";
import { Hero, type HeroData } from "../components/site-components/index.tsx";
import { toAttemptObservability } from "../model/conversions.ts";
import { AttemptTrace } from "./result-components.tsx";
import {
  builtInMachineProducerIds,
  defineBuiltInReport,
} from "./machine.ts";

export interface ExecutionEvidenceReportOptions {
  /** Match retained conversation and command text with one JavaScript regular expression. */
  readonly grep?: string;
}

export interface TimingEvidenceReportOptions {
  /** Summary hides interval identity and offsets; full retains them. */
  readonly mode?: "summary" | "full";
}

interface ObservabilityPageInput {
  readonly hero: HeroData;
  readonly observability: Awaited<ReturnType<typeof toAttemptObservability>>;
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

function observabilityPage(
  id: "execution-evidence" | "timing-evidence",
  title: string,
  trace: { readonly mode: "execution" | "timing"; readonly grep?: string; readonly timingMode?: "summary" | "full" },
) {
  return {
    id,
    path: "/",
    title,
    load: async (sample: Sample): Promise<ObservabilityPageInput> => Object.freeze({
      hero: heroData(sample.snapshot),
      observability: await toAttemptObservability(sample),
    }),
    render: (input: ObservabilityPageInput) => jsxs(Col, {
      children: [
        jsx(Hero, { data: input.hero }),
        jsx(AttemptTrace, { view: input.observability, ...trace }),
      ],
    }),
  } satisfies Page<void, ObservabilityPageInput>;
}

/** A focused execution page over closed trace data; no component reopens the Sample. */
export function executionEvidenceReport(
  input: ExecutionEvidenceReportOptions = {},
) {
  if (input.grep !== undefined) new RegExp(input.grep);
  const options = Object.freeze({
    ...(input.grep === undefined ? {} : { grep: input.grep }),
  });
  return defineBuiltInReport(builtInMachineProducerIds.executionEvidence, {
    title: "Attempt execution",
    pages: [observabilityPage("execution-evidence", "Attempt execution", { mode: "execution", ...options })],
  });
}

/** The built-in execution report token target. */
export const defaultExecutionEvidenceReport = executionEvidenceReport();

/** A focused timing Page over the same closed observability DomainView. */
export function timingEvidenceReport(
  input: TimingEvidenceReportOptions = {},
) {
  const options = Object.freeze({ mode: input.mode ?? "summary" } as const);
  return defineBuiltInReport(builtInMachineProducerIds.timingEvidence, {
    title: "Attempt timing",
    pages: [observabilityPage("timing-evidence", "Attempt timing", { mode: "timing", timingMode: options.mode })],
  });
}

export const defaultTimingEvidenceReport = timingEvidenceReport();
