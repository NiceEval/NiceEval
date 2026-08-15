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
  type ProjectedRecordAttachmentResult,
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
  return makeSourceEvidenceReport(input, 80);
}

/**
 * CLI-only factory: the host supplies its already-resolved terminal width.
 * It stays out of the public built-in entry so source presentation has no
 * ambient process dependency inside the Report graph.
 */
export function sourceEvidenceReportForTerminal(
  input: SourceEvidenceReportOptions,
  terminalWidth: number,
): Report {
  return makeSourceEvidenceReport(input, terminalWidth);
}

function makeSourceEvidenceReport(
  input: SourceEvidenceReportOptions,
  terminalWidth: number,
): Report {
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
    render: ({ calculations, inputs }) => sourceEvidenceDocument(
      calculations.sourceJson,
      options.mode === "default" ? firstAssertionAttachment(inputs.assertions) : undefined,
      terminalWidth,
    ),
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
  assertions: ProjectedRecordAttachmentResult<unknown> | undefined,
  terminalWidth: number,
) {
  if (result.state !== "available") {
    return reportDocument({
      title: "Recorded source",
      presentation: "evidence-text",
      children: [reportStatus({
        tone: "negative",
        label: result.state === "execution-failed"
          ? "Source evidence calculation/projection failed"
          : "Source evidence data unavailable",
        detail: [reportText(`state: ${result.state}; problemIds: ${result.problemIds.join(", ")}`)],
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
    children: [
      ...(assertions === undefined ? [] : [attachmentStatus("Assertions", assertions)]),
      reportCodeBlock({
        value: renderPresentedSource(value.source, terminalWidth),
      }),
    ],
  });
}

function firstAssertionAttachment(
  assertions: SourceInputs["assertions"],
): ProjectedRecordAttachmentResult<unknown> | undefined {
  return assertions.entries.find((entry) => entry.state === "attachment-result")?.attachment;
}

function attachmentStatus(
  name: string,
  result: ProjectedRecordAttachmentResult<unknown>,
) {
  switch (result.state) {
    case "available":
      return reportStatus({ tone: "positive", label: `${name}: available` });
    case "unavailable":
      return reportStatus({ tone: "warning", label: `${name}: unavailable` });
    case "migration-required":
      return reportStatus({
        tone: "warning",
        label: `${name}: migration required`,
        detail: [reportText(`${result.from} → ${result.to}; ${result.command}`)],
      });
    case "migration-unavailable":
      return reportStatus({
        tone: "warning",
        label: `${name}: migration unavailable`,
        detail: [reportText(result.reason)],
      });
    case "unsupported":
      return reportStatus({
        tone: "warning",
        label: `${name}: unsupported`,
        detail: [reportText(result.schemaId)],
      });
    case "invalid":
      return reportStatus({
        tone: "negative",
        label: `${name}: invalid`,
        detail: [reportText(result.issues.map((issue) => issue.code).join(", "))],
      });
  }
}

function presentSourceInputs(
  inputs: SourceInputs,
  options: { readonly mode: SourcePresentMode; readonly file?: string },
): { readonly state: "unavailable"; readonly locator: string; readonly reason: string } | {
  readonly state: "presented";
  readonly locator: string;
  readonly value: PresentedSource;
} {
  const selectedSlot = selectedIncludedSourceSlot(inputs.verdict);
  const locator = encodeAttemptLocator(selectedSlot.attempt.attemptId);
  const assembly = assembleAttemptSourceTree({
    assertions: inputs.assertions,
    sourceSites: inputs["source-sites"],
    sources: inputs.sources,
  });
  const slot = includedSourceSlot(assembly, selectedSlot);
  if (slot === undefined) {
    return Object.freeze({
      state: "unavailable" as const,
      locator,
      reason: `Source evidence unavailable for ${locator}; this attempt did not capture sources.`,
    });
  }
  if (slot.sources.attachment.state !== "available") {
    return Object.freeze({
      state: "unavailable" as const,
      locator,
      reason: `Source evidence unavailable for ${locator}; this attempt did not capture sources.`,
    });
  }
  const identity = sourceIdentity(inputs, selectedSlot);
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

function includedSourceSlot(
  assembly: AttemptSourceTreeAssemblyResult,
  selectedSlot: Extract<AnalysisSlot, { readonly state: "included" }>,
): Extract<AttemptSourceTreeSlot, { readonly state: "attachment-result" }> | undefined {
  if (assembly.state !== "assembled") return undefined;
  return assembly.value.slots.find(
    (slot): slot is Extract<AttemptSourceTreeSlot, { readonly state: "attachment-result" }> =>
      slot.state === "attachment-result"
      && slot.slot.runId === selectedSlot.runId
      && slot.slot.slotId === selectedSlot.slotId,
  );
}

function selectedIncludedSourceSlot(
  projected: ProjectedSample<"attempt-slot", Verdict>,
): Extract<AnalysisSlot, { readonly state: "included" }> {
  const matches = projected.entries.filter((entry) => entry.state === "attachment-result");
  if (matches.length !== 1 || matches[0]?.state !== "attachment-result") {
    throw new Error(`Source evidence lost its selected included Slot; got ${matches.length} matches`);
  }
  return matches[0].slot;
}

function sourceIdentity(
  inputs: SourceInputs,
  included: Extract<AnalysisSlot, { readonly state: "included" }>,
): {
  readonly locator: string;
  readonly evalId: string;
  readonly experimentId: string;
  readonly verdict: string;
  readonly runId: string;
  readonly attempt: number;
} {
  const locator = encodeAttemptLocator(included.attempt.attemptId);
  const runId = included.runId;
  const selectedPlan = availableSelectedRun(inputs["evaluation-plan"], included.runId);
  if (selectedPlan === undefined) {
    throw new Error("Source evidence lost its selected Run Evaluation Plan");
  }
  const plan = selectedPlan.coordinateForSlot(included.slotId);
  if (plan === undefined) {
    throw new Error("Source evidence Evaluation Plan does not contain the included Slot");
  }
  const verdict = availableAttemptSlot(inputs.verdict, included.runId, included.slotId);
  return Object.freeze({
    locator,
    evalId: plan.evalId,
    experimentId: plan.experimentId,
    verdict: verdict ?? "unavailable",
    runId,
    attempt: plan.attempt,
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
