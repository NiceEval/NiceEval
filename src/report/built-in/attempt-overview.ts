import { Either } from "effect";
import { encodeAttemptLocator } from "../../attempt-locator.ts";
import {
  assertionsProjector,
  attemptSlotProjection,
  verdictProjector,
  type AssertionSourceEntry,
  type AssertionSourceResult,
  type AssertionsSourceProjection,
  type EvaluationPlanCoordinate,
  type EvaluationPlanView,
  type ProjectedRecordAttachmentResult,
  type ProjectedSample,
  type Score,
  type Verdict,
} from "../../projection/index.ts";
import {
  attemptDiagnosticsProjector,
  type AttemptDiagnosticsView,
} from "../../o11y/record/family-projectors.ts";
import {
  definePage,
  defineReport,
  reportComponentId,
  reportId,
  reportInputs,
  reportRoute,
  type Report,
} from "../author/index.ts";
import {
  reportDocument,
  reportMetric,
  reportSection,
  reportStatus,
  reportTable,
  reportText,
  type ReportBlock,
} from "../semantic/index.ts";
import {
  reportEvaluationPlanProjection,
  reportScoreProjection,
} from "../evaluation-projections.ts";

const ASSERTION_ROWS_MAX = 200;

const assertionResultStates = [
  "matched",
  "mismatched",
  "unavailable",
  "errored",
  "not-applicable",
] as const;

const attemptOverviewInputs = reportInputs({
  "evaluation-plan": reportEvaluationPlanProjection,
  assertions: attemptSlotProjection(assertionsProjector),
  verdict: attemptSlotProjection(verdictProjector),
  score: reportScoreProjection,
  diagnostics: attemptSlotProjection(attemptDiagnosticsProjector),
});

type AttemptSlotEntry<Value> = ProjectedSample<
  "attempt-slot",
  Value
>["entries"][number];
type AttemptSlot = Extract<
  AttemptSlotEntry<unknown>,
  { readonly state: "attachment-result" }
>["slot"];
type EvaluationPlanEntry = ProjectedSample<
  "selected-run",
  EvaluationPlanView
>["entries"][number];

interface AttemptOverviewInputs {
  readonly "evaluation-plan": ProjectedSample<
    "selected-run",
    EvaluationPlanView
  >;
  readonly assertions: ProjectedSample<"attempt-slot", AssertionsSourceProjection>;
  readonly verdict: ProjectedSample<"attempt-slot", Verdict>;
  readonly score: ProjectedSample<"attempt-slot", Score>;
  readonly diagnostics: ProjectedSample<"attempt-slot", AttemptDiagnosticsView>;
}

interface AttemptOverviewSlot {
  readonly slot: AttemptSlot;
  readonly plan: EvaluationPlanEntry | undefined;
  readonly assertions: ProjectedRecordAttachmentResult<AssertionsSourceProjection> | undefined;
  readonly verdict: ProjectedRecordAttachmentResult<Verdict>;
  readonly score: ProjectedRecordAttachmentResult<Score> | undefined;
  readonly diagnostics: ProjectedRecordAttachmentResult<AttemptDiagnosticsView> | undefined;
}

/**
 * A capability-free Attempt overview built with the same public author API as
 * user Reports. It declares every Attachment it reads and receives no Record
 * reader, paths, or private evidence access.
 */
export function attemptOverviewReport(): Report {
  const page = definePage({
    id: Either.getOrThrow(reportComponentId("attempt-overview")),
    route: Either.getOrThrow(reportRoute("/")),
    inputs: attemptOverviewInputs,
    completeness: "allow-partial",
    render: ({ inputs }) => attemptOverviewDocument(inputs),
  });
  return defineReport({
    id: Either.getOrThrow(reportId("attempt-overview")),
    pages: [page],
  });
}

/** The built-in default for an exact Attempt locator. */
export const defaultAttemptOverviewReport = attemptOverviewReport();

export default defaultAttemptOverviewReport;

function attemptOverviewDocument(inputs: AttemptOverviewInputs) {
  const slots = assembleAttemptOverviewSlots(inputs);
  return reportDocument({
    title: "Attempt overview",
    children: slots.length === 0
      ? [reportStatus({
        tone: "warning",
        label: "No selected Slot has a readable Attempt",
      })]
      : [
        reportMetric({ label: "Selected Attempts", value: slots.length }),
        ...slots.map(attemptOverviewSlotBlock),
      ],
  });
}

function assembleAttemptOverviewSlots(
  inputs: AttemptOverviewInputs,
): readonly AttemptOverviewSlot[] {
  const assertionsBySlot = entriesBySlot(inputs.assertions);
  const scoreBySlot = entriesBySlot(inputs.score);
  const diagnosticsBySlot = entriesBySlot(inputs.diagnostics);
  const plansByRun = new Map<string, EvaluationPlanEntry>();
  for (const entry of inputs["evaluation-plan"].entries) {
    plansByRun.set(entry.run.runId, entry);
  }

  const slots: AttemptOverviewSlot[] = [];
  for (const entry of inputs.verdict.entries) {
    if (entry.state !== "attachment-result") continue;
    const key = slotKey(entry.slot);
    slots.push(Object.freeze({
      slot: entry.slot,
      plan: plansByRun.get(entry.slot.runId),
      assertions: attachmentForSlot(assertionsBySlot.get(key)),
      verdict: entry.attachment,
      score: attachmentForSlot(scoreBySlot.get(key)),
      diagnostics: attachmentForSlot(diagnosticsBySlot.get(key)),
    }));
  }
  return Object.freeze(slots);
}

function entriesBySlot<Value>(
  projection: ProjectedSample<"attempt-slot", Value>,
): ReadonlyMap<string, AttemptSlotEntry<Value>> {
  const entries = new Map<string, AttemptSlotEntry<Value>>();
  for (const entry of projection.entries) {
    entries.set(slotKey(entry.slot), entry);
  }
  return entries;
}

function slotKey(slot: Pick<AttemptSlot, "runId" | "slotId">): string {
  return `${slot.runId}\u0000${slot.slotId}`;
}

function attachmentForSlot<Value>(
  entry: AttemptSlotEntry<Value> | undefined,
): ProjectedRecordAttachmentResult<Value> | undefined {
  return entry?.state === "attachment-result" ? entry.attachment : undefined;
}

function attemptOverviewSlotBlock(input: AttemptOverviewSlot): ReportBlock {
  const coordinate = evaluationCoordinate(input.slot, input.plan);
  return reportSection({
    heading: `Attempt ${encodeAttemptLocator(input.slot.attempt.attemptId)}`,
    children: [
      reportSection({
        heading: "Identity",
        children: identityBlocks(input.slot, input.plan, coordinate),
      }),
      reportSection({
        heading: coordinate?.kind === "score" ? "Score status" : "Verdict",
        children: verdictBlocks(input.verdict, input.score, coordinate?.kind),
      }),
      ...executionErrorBlocks(input.diagnostics),
      reportSection({
        heading: "Assertions",
        children: assertionBlocks(input.assertions),
      }),
      reportSection({
        heading: "Score",
        children: scoreBlocks(input.score, coordinate?.kind),
      }),
    ],
  });
}

function executionErrorBlocks(
  diagnostics: ProjectedRecordAttachmentResult<AttemptDiagnosticsView> | undefined,
): readonly ReportBlock[] {
  if (diagnostics?.state !== "available") return [];
  const errors = diagnostics.value.diagnostics.filter(
    (diagnostic) => diagnostic.kind === "execution-error",
  );
  if (errors.length === 0) return [];
  return [reportSection({
    heading: "Execution error",
    children: [reportTable({
      caption: "Execution errors",
      columns: [
        { key: "code", label: "Code" },
        { key: "phase", label: "Phase" },
        { key: "summary", label: "Summary" },
      ],
      rows: errors.map((error) => ({
        code: error.code,
        phase: error.phase,
        summary: error.summary,
      })),
    })],
  })];
}

function identityBlocks(
  slot: AttemptSlot,
  plan: EvaluationPlanEntry | undefined,
  coordinate: EvaluationPlanCoordinate | undefined,
): readonly ReportBlock[] {
  const rows: Array<Readonly<Record<string, string | number>>> = [
    { field: "Attempt", value: encodeAttemptLocator(slot.attempt.attemptId) },
    { field: "Origin Run", value: slot.attempt.originRunId },
    { field: "Selected Run", value: slot.runId },
    { field: "Slot", value: slot.slotId },
    { field: "Member relation", value: slot.relation },
  ];
  if (coordinate !== undefined) {
    rows.push(
      { field: "Experiment", value: coordinate.experimentId },
      { field: "Eval", value: coordinate.evalId },
      { field: "Evaluation kind", value: coordinate.kind },
      { field: "Attempt ordinal", value: coordinate.attempt },
    );
  }

  return [
    reportTable({
      caption: "Attempt identity",
      columns: [
        { key: "field", label: "Field" },
        { key: "value", label: "Value" },
      ],
      rows,
    }),
    ...evaluationPlanStatus(slot, plan, coordinate),
  ];
}

function evaluationPlanStatus(
  slot: AttemptSlot,
  plan: EvaluationPlanEntry | undefined,
  coordinate: EvaluationPlanCoordinate | undefined,
): readonly ReportBlock[] {
  if (plan === undefined) {
    return [projectionAlignmentStatus("Evaluation identity")];
  }
  if (plan.attachment.state !== "available") {
    return [attachmentStatus("Evaluation identity", plan.attachment)];
  }
  if (coordinate === undefined) {
    return [reportStatus({
      tone: "negative",
      label: `Evaluation identity: no coordinate for Slot ${slot.slotId}`,
    })];
  }
  return [reportStatus({
    tone: "positive",
    label: "Evaluation identity: available",
  })];
}

function evaluationCoordinate(
  slot: AttemptSlot,
  plan: EvaluationPlanEntry | undefined,
): EvaluationPlanCoordinate | undefined {
  return plan?.attachment.state === "available"
    ? plan.attachment.value.coordinateForSlot(slot.slotId)
    : undefined;
}

function verdictBlocks(
  verdict: ProjectedRecordAttachmentResult<Verdict>,
  score: ProjectedRecordAttachmentResult<Score> | undefined,
  evaluationKind: EvaluationPlanCoordinate["kind"] | undefined,
): readonly ReportBlock[] {
  if (verdict.state !== "available") return [attachmentStatus("Verdict", verdict)];
  if (evaluationKind === "score") {
    const status = verdict.value === "skipped"
      ? "skipped"
      : verdict.value === "errored" || score?.state !== "available" || score.value.state !== "complete"
        ? "errored"
        : "scored";
    return [
      reportStatus({
        tone: status === "scored" ? "positive" : status === "skipped" ? "neutral" : "negative",
        label: `Score status: ${status}`,
        detail: [reportText("Only scored Attempts participate in score comparison.")],
      }),
      reportStatus({
        tone: "neutral",
        label: `Historical verdict claim: ${verdict.value}`,
      }),
    ];
  }
  return [reportStatus({
    tone: verdictTone(verdict.value),
    label: `Verdict: ${verdict.value}`,
    detail: [reportText("Four-state Verdict: passed, failed, errored, or skipped.")],
  })];
}

function verdictTone(value: Verdict): "positive" | "neutral" | "negative" {
  switch (value) {
    case "passed":
      return "positive";
    case "skipped":
      return "neutral";
    case "failed":
    case "errored":
      return "negative";
  }
}

function assertionBlocks(
  assertions: ProjectedRecordAttachmentResult<AssertionsSourceProjection> | undefined,
): readonly ReportBlock[] {
  if (assertions === undefined) return [projectionAlignmentStatus("Assertions")];
  if (assertions.state !== "available") return [attachmentStatus("Assertions", assertions)];

  const entries = assertions.value.entries;
  const visible = entries.slice(0, ASSERTION_ROWS_MAX);
  const omitted = entries.length - visible.length;
  return [
    reportMetric({ label: "Recorded Assertions", value: entries.length }),
    reportTable({
      caption: "Assertion summary",
      columns: [
        { key: "result", label: "Result" },
        { key: "assertions", label: "Assertions", align: "end" },
      ],
      rows: assertionResultStates.map((state) => ({
        result: state,
        assertions: entries.filter((entry) => entry.entry.result.state === state).length,
      })),
    }),
    ...(entries.length === 0
      ? [reportStatus({ tone: "neutral", label: "No recorded Assertions" })]
      : [reportTable({
        caption: "Assertions",
        columns: [
          { key: "assertion", label: "Assertion" },
          { key: "result", label: "Result" },
          { key: "gate", label: "Gate" },
          { key: "score", label: "Score" },
          { key: "entry", label: "Entry" },
          { key: "reason", label: "Reason" },
        ],
        rows: visible.map(assertionRow),
      })]),
    ...(omitted === 0
      ? []
      : [reportStatus({
        tone: "warning",
        label: `${omitted} additional Assertion(s) omitted from this bounded table`,
      })]),
  ];
}

function assertionRow(entry: AssertionSourceEntry): Readonly<Record<string, string>> {
  return {
    assertion: assertionLabel(entry),
    result: entry.entry.result.state,
    gate: entry.entry.result.gate,
    score: assertionScoreLabel(entry.entry.result),
    entry: assertionEntryState(entry),
    reason: assertionReason(entry.entry.result),
  };
}

function assertionLabel(entry: AssertionSourceEntry): string {
  const display = entry.entry.display;
  const label = display.label ?? display.key ?? entry.entry.entryId;
  return display.groupPath.length === 0 ? label : `${display.groupPath.join(" / ")} / ${label}`;
}

function assertionScoreLabel(result: AssertionSourceResult): string {
  switch (result.score.state) {
    case "not-scored":
      return "not scored";
    case "earned":
      return `${result.score.earned} / ${result.score.points}`;
    case "unavailable":
      return `unavailable: ${result.score.reason}`;
  }
}

function assertionEntryState(entry: AssertionSourceEntry): string {
  return entry.state === "available" ? "available" : `${entry.state}: ${entry.reason}`;
}

function assertionReason(result: AssertionSourceResult): string {
  return result.state === "matched" ? "—" : result.reason;
}

function scoreBlocks(
  score: ProjectedRecordAttachmentResult<Score> | undefined,
  evaluationKind: EvaluationPlanCoordinate["kind"] | undefined,
): readonly ReportBlock[] {
  if (evaluationKind === "pass") {
    return [
      reportStatus({
        tone: "neutral",
        label: "Score: not applicable for a pass evaluation",
      }),
    ];
  }
  if (evaluationKind === "score") {
    if (score === undefined) return [projectionAlignmentStatus("Score")];
    return score.state === "available"
      ? scoreValueBlocks(score.value)
      : [attachmentStatus("Score", score)];
  }
  return [
    reportStatus({
      tone: "warning",
      label: "Score applicability is unknown because Evaluation kind is unavailable",
    }),
    ...(score === undefined
      ? [projectionAlignmentStatus("Score")]
      : score.state === "available"
        ? scoreValueBlocks(score.value)
        : [attachmentStatus("Score", score)]),
  ];
}

function scoreValueBlocks(score: Score): readonly ReportBlock[] {
  switch (score.state) {
    case "complete":
      return [reportStatus({
        tone: "positive",
        label: `Score: ${score.earned}`,
      })];
    case "partial":
      return [reportStatus({
        tone: "warning",
        label: `Score: partial (${score.earned}; not comparable)`,
        detail: [reportText(`Reasons: ${score.reasons.join(", ")}`)],
      })];
    case "unavailable":
      return [reportStatus({
        tone: "warning",
        label: "Score: unavailable",
        detail: [reportText(`Reasons: ${score.reasons.join(", ")}`)],
      })];
  }
}

function projectionAlignmentStatus(name: string): ReportBlock {
  return reportStatus({
    tone: "negative",
    label: `${name}: projection alignment unavailable`,
  });
}

function attachmentStatus<Value>(
  name: string,
  result: Exclude<ProjectedRecordAttachmentResult<Value>, { readonly state: "available" }>,
): ReportBlock {
  switch (result.state) {
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
