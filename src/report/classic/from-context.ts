import type { AnalysisSample } from "../../analysis/index.ts";
import type { ProjectedSample, ProjectionAccess } from "../../projection/model.ts";
import { classicHostBinding } from "./host.ts";
import { buildClassicSample, type ClassicProjectedInputs } from "./project.ts";
import type { Sample } from "./sample.ts";

export function classicSampleFromProjectedInputs(input: {
  readonly sample: AnalysisSample;
  readonly inputs: Readonly<Record<string, ProjectedSample<ProjectionAccess, unknown> | undefined>>;
}): Sample {
  const host = classicHostBinding(input.sample);
  return buildClassicSample({
    sample: input.sample,
    projections: classicProjectedInputs(input.inputs),
    selectionOrigin: host.selectionOrigin,
    locale: host.locale,
  });
}

export function classicProjectedInputs(
  inputs: Readonly<Record<string, ProjectedSample<ProjectionAccess, unknown> | undefined>>,
): ClassicProjectedInputs {
  return Object.freeze({
    evaluationPlan: inputs["evaluation-plan"],
    verdict: inputs.verdict,
    score: inputs.score,
    timing: inputs.timing,
    usage: inputs.usage,
  });
}
