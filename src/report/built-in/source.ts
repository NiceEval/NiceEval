import { Either } from "effect";
import { encodeAttemptLocator } from "../../attempt-locator.ts";
import type { AnalysisSlot } from "../../analysis/index.ts";
import {
  assembleAttemptSourceTree,
  assertionSourceSitesProjector,
  assertionsProjector,
  attemptOriginRunProjection,
  attemptSlotProjection,
  evaluationPlanProjector,
  selectedRunProjection,
  sourcesProjector,
  verdictProjector,
  type AttemptSourceTreeAssemblyResult,
  type AttemptSourceTreeSlot,
  type EvaluationPlanView,
  type ProjectedSample,
  type Verdict,
} from "../../projection/index.ts";
import {
  defineCalculation,
  definePage,
  defineReport,
  reportComponentId,
  reportId,
  reportInputs,
  reportRoute,
  type Report,
} from "../author/index.ts";
import {
  reportCodeBlock,
  reportDocument,
  reportStatus,
  reportText,
} from "../semantic/index.ts";
import {
  presentAttemptSource,
  renderPresentedSource,
  type PresentedSource,
  type SourcePresentMode,
} from "./source-present.ts";

const sourceInputs = reportInputs({
  "evaluation-plan": selectedRunProjection(evaluationPlanProjector),
  verdict: attemptSlotProjection(verdictProjector),
  assertions: attemptSlotProjection(assertionsProjector),
  "source-sites": attemptSlotProjection(assertionSourceSitesProjector),
  sources: attemptOriginRunProjection(sourcesProjector),
});

export interface SourceEvidenceReportOptions {
  readonly mode?: SourcePresentMode;
  readonly file?: string;
}

/**
 * A normal Author-API Report over the public source-navigation projections.
 * default/full/file only change presentation of the already-closed tree;
 * they never dump package or node_modules file texts.
 */
export function sourceEvidenceReport(input: SourceEvidenceReportOptions = {}): Report {
  const options = Object.freeze({
    mode: input.mode ?? "default",
    ...(input.file === undefined ? {} : { file: input.file }),
  });
  const sourceJson = defineCalculation({
    id: Either.getOrThrow(reportComponentId("source-json")),
    inputs: sourceInputs,
    completeness: "allow-partial",
    calculate: ({ inputs }) => sourceJsonValue(inputs, options),
  });
  const page = definePage({
    id: Either.getOrThrow(reportComponentId("source-evidence")),
    route: Either.getOrThrow(reportRoute("/")),
    inputs: sourceInputs,
    completeness: "allow-partial",
    calculations: { sourceJson },
    render: ({ calculations }) => sourceEvidenceDocument(calculations.sourceJson),
  });
  return defineReport({
    id: Either.getOrThrow(reportId("source-evidence")),
    calculations: { sourceJson },
    pages: [page],
  });
}

/** A reusable no-filter declaration for hosts that surface recorded source. */
export const defaultSourceEvidenceReport = sourceEvidenceReport();

type SourceInputs = {
  readonly "evaluation-plan": ProjectedSample<"selected-run", EvaluationPlanView>;
  readonly verdict: ProjectedSample<"attempt-slot", Verdict>;
  readonly assertions: Parameters<typeof assembleAttemptSourceTree>[0]["assertions"];
  readonly "source-sites": Parameters<typeof assembleAttemptSourceTree>[0]["sourceSites"];
  readonly sources: Parameters<typeof assembleAttemptSourceTree>[0]["sources"];
};

export type SourceShowJson = {
  readonly locator: string;
  readonly source: PresentedSource | null;
  readonly unavailable?: string;
};

function sourceJsonValue(
  inputs: SourceInputs,
  options: { readonly mode: SourcePresentMode; readonly file?: string },
): SourceShowJson {
  const presented = presentSourceInputs(inputs, options);
  if (presented.state === "unavailable") {
    return Object.freeze({
      locator: presented.locator,
      source: null,
      unavailable: presented.reason,
    });
  }
  return Object.freeze({
    locator: presented.locator,
    source: presented.value,
  });
}

function sourceEvidenceDocument(
  result:
    | { readonly state: "available"; readonly value: SourceShowJson }
    | { readonly state: "data-unavailable" | "execution-failed"; readonly problemIds: readonly number[] },
) {
  if (result.state !== "available") {
    return reportDocument({
      title: "Recorded source",
      presentation: "evidence-text",
      children: [reportStatus({
        tone: "warning",
        label: "Source evidence unavailable for this attempt",
      })],
    });
  }
  const value = result.value;
  if (value.source === null) {
    return reportDocument({
      title: "Recorded source",
      presentation: "evidence-text",
      children: [reportStatus({
        tone: "warning",
        label: value.unavailable ?? "Source evidence unavailable for this attempt",
        ...(value.locator.length === 0 ? {} : { detail: [reportText(value.locator)] }),
      })],
    });
  }
  return reportDocument({
    title: "Recorded source",
    presentation: "evidence-text",
    children: [reportCodeBlock({
      value: renderPresentedSource(value.source, terminalColumns()),
    })],
  });
}

function presentSourceInputs(
  inputs: SourceInputs,
  options: { readonly mode: SourcePresentMode; readonly file?: string },
): { readonly state: "unavailable"; readonly locator: string; readonly reason: string } | {
  readonly state: "presented";
  readonly locator: string;
  readonly value: PresentedSource;
} {
  const assembly = assembleAttemptSourceTree({
    assertions: inputs.assertions,
    sourceSites: inputs["source-sites"],
    sources: inputs.sources,
  });
  const slot = firstIncludedSourceSlot(assembly);
  const identity = sourceIdentity(inputs, slot?.slot);
  if (slot === undefined) {
    return Object.freeze({
      state: "unavailable" as const,
      locator: identity.locator,
      reason: `Source evidence unavailable for ${identity.locator}; this attempt did not capture sources.`,
    });
  }
  if (slot.sources.attachment.state !== "available") {
    return Object.freeze({
      state: "unavailable" as const,
      locator: identity.locator,
      reason: `Source evidence unavailable for ${identity.locator}; this attempt did not capture sources.`,
    });
  }
  const presented = presentAttemptSource({
    tree: slot.tree,
    locator: identity.locator,
    evalId: identity.evalId,
    experimentId: identity.experimentId,
    verdict: identity.verdict,
    runId: identity.runId,
    attempt: identity.attempt,
    options,
  });
  if ("state" in presented) {
    return Object.freeze({
      state: "unavailable" as const,
      locator: identity.locator,
      reason: `Captured source file not found in annotated source tree: ${presented.file}`,
    });
  }
  return Object.freeze({
    state: "presented" as const,
    locator: identity.locator,
    value: presented,
  });
}

function firstIncludedSourceSlot(
  assembly: AttemptSourceTreeAssemblyResult,
): Extract<AttemptSourceTreeSlot, { readonly state: "attachment-result" }> | undefined {
  if (assembly.state !== "assembled") return undefined;
  return assembly.value.slots.find(
    (slot): slot is Extract<AttemptSourceTreeSlot, { readonly state: "attachment-result" }> =>
      slot.state === "attachment-result",
  );
}

function sourceIdentity(
  inputs: SourceInputs,
  slot: AnalysisSlot | undefined,
): {
  readonly locator: string;
  readonly evalId: string;
  readonly experimentId: string;
  readonly verdict: string;
  readonly runId: string;
  readonly attempt: number;
} {
  const included = slot?.state === "included" ? slot : undefined;
  const locator = included === undefined ? "@unknown" : encodeAttemptLocator(included.attempt.attemptId);
  const runId = slot?.runId ?? "unknown";
  const plan = included === undefined
    ? undefined
    : availableSelectedRun(inputs["evaluation-plan"], included.runId)?.coordinateForSlot(included.slotId);
  const verdict = included === undefined
    ? "unknown"
    : availableAttemptSlot(inputs.verdict, included.runId, included.slotId) ?? "unknown";
  return Object.freeze({
    locator,
    evalId: plan?.evalId ?? "unknown",
    experimentId: plan?.experimentId ?? "unknown",
    verdict,
    runId,
    attempt: plan?.attempt ?? 0,
  });
}

function availableSelectedRun(
  projected: ProjectedSample<"selected-run", EvaluationPlanView>,
  runId: string,
): EvaluationPlanView | undefined {
  for (const entry of projected.entries) {
    if (entry.state === "attachment-result" && entry.run.runId === runId && entry.attachment.state === "available") {
      return entry.attachment.value;
    }
  }
  return undefined;
}

function availableAttemptSlot(
  projected: ProjectedSample<"attempt-slot", Verdict>,
  runId: string,
  slotId: AnalysisSlot["slotId"],
): Verdict | undefined {
  for (const entry of projected.entries) {
    if (
      entry.state === "attachment-result"
      && entry.slot.runId === runId
      && entry.slot.slotId === slotId
      && entry.attachment.state === "available"
    ) {
      return entry.attachment.value;
    }
  }
  return undefined;
}

function terminalColumns(): number {
  const raw = typeof process === "undefined" ? undefined : process.env.COLUMNS;
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) return 80;
  const columns = Number(raw);
  return Number.isSafeInteger(columns) ? Math.max(40, columns) : 80;
}
