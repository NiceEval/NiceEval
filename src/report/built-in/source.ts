/** Recorded source is rendered only from its closed Sources DomainView. */

import type {
  Sample,
  SampleSnapshot,
} from "../../analysis/index.ts";
import { jsx, jsxs } from "react/jsx-runtime";
import type { Page } from "../definition/report.ts";
import { Col } from "../definition/primitives.tsx";
import { Hero, type HeroData } from "../components/site-components/index.tsx";
import {
  toAttemptEvidence,
  toSources,
} from "../model/conversions.ts";
import {
  AttemptEvidenceResultView,
  SourcesResultView,
} from "./result-components.tsx";
import {
  builtInMachineProducerIds,
  defineBuiltInReport,
} from "./machine.ts";

export interface SourceEvidenceReportOptions {
  /** Restrict the rendered source panel to one captured project-relative path. */
  readonly file?: string;
}

interface SourceEvidencePageInput {
  readonly hero: HeroData;
  readonly evidence: Awaited<ReturnType<typeof toAttemptEvidence>>;
  readonly sources: Awaited<ReturnType<typeof toSources>>;
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

function sourceEvidencePage(options: SourceEvidenceReportOptions) {
  return {
    id: "source-evidence",
    path: "/",
    title: "Recorded source",
    load: async (sample: Sample): Promise<SourceEvidencePageInput> => {
      const [evidence, sources] = await Promise.all([
        toAttemptEvidence(sample),
        toSources(sample),
      ]);
      return Object.freeze({ hero: heroData(sample.snapshot), evidence, sources });
    },
    render: (input: SourceEvidencePageInput) => jsxs(Col, {
      children: [
        jsx(Hero, { data: input.hero }),
        jsx(SourcesResultView, { view: input.sources, file: options.file }),
        jsx(AttemptEvidenceResultView, { view: input.evidence }),
      ],
    }),
  } satisfies Page<void, SourceEvidencePageInput>;
}

/** A report over origin-owned closed source data. */
export function sourceEvidenceReport(input: SourceEvidenceReportOptions = {}) {
  const options = Object.freeze({
    ...(input.file === undefined ? {} : { file: input.file }),
  });
  return defineBuiltInReport(builtInMachineProducerIds.sourceEvidence, {
    title: "Recorded source",
    pages: [sourceEvidencePage(options)],
  });
}

/** A reusable no-filter declaration for closed recorded source. */
export const defaultSourceEvidenceReport = sourceEvidenceReport();

export default defaultSourceEvidenceReport;
