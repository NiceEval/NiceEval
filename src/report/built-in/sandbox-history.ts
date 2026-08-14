import { Either } from "effect";
import { encodeAttemptLocator } from "../../attempt-locator.ts";
import type { AttemptId } from "../../record/index.ts";
import type { AnalysisSlot, IncludedAnalysisSlot } from "../../analysis/index.ts";
import {
  attemptSlotProjection,
  evaluationPlanProjector,
  sandboxProjector,
  selectedRunProjection,
  verdictProjector,
  type EvaluationPlanCoordinate,
  type EvaluationPlanView,
  type ProjectedRecordAttachmentResult,
  type ProjectedSample,
  type SandboxView,
  type Verdict,
} from "../../projection/index.ts";
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

const ORIGINS_MAX = 500;
const COORDINATES_PER_ORIGIN_MAX = 100;
const UNREADABLE_SLOTS_MAX = 500;
const PLAN_PROBLEMS_MAX = 500;

const sandboxHistoryInputs = reportInputs({
  "evaluation-plan": selectedRunProjection(evaluationPlanProjector),
  sandbox: attemptSlotProjection(sandboxProjector),
  verdict: attemptSlotProjection(verdictProjector),
});

type AttemptSlotEntry<Value> = ProjectedSample<
  "attempt-slot",
  Value
>["entries"][number];
type EvaluationPlanEntry = ProjectedSample<
  "selected-run",
  EvaluationPlanView
>["entries"][number];

interface SandboxHistoryInputs {
  readonly "evaluation-plan": ProjectedSample<
    "selected-run",
    EvaluationPlanView
  >;
  readonly sandbox: ProjectedSample<"attempt-slot", SandboxView>;
  readonly verdict: ProjectedSample<"attempt-slot", Verdict>;
}

interface SlotPlan {
  readonly slot: AnalysisSlot;
  readonly plan: EvaluationPlanEntry | undefined;
}

interface OriginSlot extends SlotPlan {
  readonly slot: IncludedAnalysisSlot;
}

interface OriginHistory {
  readonly originRunId: string;
  readonly attemptId: AttemptId;
  readonly sandbox: ProjectedRecordAttachmentResult<SandboxView>;
  readonly verdict: AttemptSlotEntry<Verdict> | undefined;
  readonly slots: readonly OriginSlot[];
}

interface MutableOriginHistory {
  readonly originRunId: string;
  readonly attemptId: AttemptId;
  readonly sandbox: ProjectedRecordAttachmentResult<SandboxView>;
  readonly verdict: AttemptSlotEntry<Verdict> | undefined;
  readonly slots: OriginSlot[];
}

interface SandboxHistoryAssembly {
  readonly origins: readonly OriginHistory[];
  readonly unreadableSlots: readonly SlotPlan[];
}

type UnavailableAttachment<Value> = Exclude<
  ProjectedRecordAttachmentResult<Value>,
  { readonly state: "available" }
>;

/**
 * A public-projection-only history Report. The caller chooses the all-runs
 * AnalysisSample; this Report neither reselects Runs nor opens a Record.
 */
export function sandboxHistoryReport(): Report {
  const page = definePage({
    id: Either.getOrThrow(reportComponentId("sandbox-history")),
    route: Either.getOrThrow(reportRoute("/")),
    inputs: sandboxHistoryInputs,
    completeness: "allow-partial",
    render: ({ inputs }) => sandboxHistoryDocument(inputs),
  });
  return defineReport({
    id: Either.getOrThrow(reportId("sandbox-history")),
    pages: [page],
  });
}

/** The built-in, capability-free Sandbox history Report. */
export const defaultSandboxHistoryReport = sandboxHistoryReport();

export default defaultSandboxHistoryReport;

function sandboxHistoryDocument(inputs: SandboxHistoryInputs) {
  const assembly = assembleSandboxHistory(inputs);
  const visibleOrigins = assembly.origins.slice(0, ORIGINS_MAX);
  const omittedOrigins = assembly.origins.length - visibleOrigins.length;

  return reportDocument({
    title: "Sandbox history",
    children: [
      reportMetric({
        label: "Selected runs",
        value: inputs.sandbox.sample.runs.length,
      }),
      reportMetric({
        label: "Unique origin Attempts",
        value: assembly.origins.length,
      }),
      reportSection({
        heading: "Origin Attempts",
        children: assembly.origins.length === 0
          ? [reportStatus({
            tone: "warning",
            label: "No selected Slot has a readable origin Attempt",
          })]
          : [
            ...visibleOrigins.map(originHistoryBlocks),
            ...(omittedOrigins === 0
              ? []
              : [reportStatus({
                tone: "warning",
                label: `${omittedOrigins} additional origin Attempt(s) omitted from this bounded history`,
              })]),
          ],
      }),
      reportSection({
        heading: "Slots without a readable origin Attempt",
        children: unreadableSlotBlocks(assembly.unreadableSlots),
      }),
      reportSection({
        heading: "Evaluation plan problems",
        children: evaluationPlanProblemBlocks(inputs["evaluation-plan"]),
      }),
    ],
  });
}

function assembleSandboxHistory(inputs: SandboxHistoryInputs): SandboxHistoryAssembly {
  const verdictsBySlot = entriesBySlot(inputs.verdict);
  const planEntriesByRun = plansByRun(inputs["evaluation-plan"]);
  const originsByKey = new Map<string, MutableOriginHistory>();
  const unreadableSlots: SlotPlan[] = [];

  for (const entry of inputs.sandbox.entries) {
    if (entry.state !== "attachment-result") {
      unreadableSlots.push({
        slot: entry.slot,
        plan: planEntriesByRun.get(entry.slot.runId),
      });
      continue;
    }

    const key = originKey(entry.owner.attempt.originRunId, entry.owner.attempt.attemptId);
    const slot: OriginSlot = {
      slot: entry.slot,
      plan: planEntriesByRun.get(entry.slot.runId),
    };
    const current = originsByKey.get(key);
    if (current === undefined) {
      originsByKey.set(key, {
        originRunId: entry.owner.attempt.originRunId,
        attemptId: entry.owner.attempt.attemptId,
        sandbox: entry.attachment,
        verdict: verdictsBySlot.get(slotKey(entry.slot)),
        slots: [slot],
      });
    } else {
      current.slots.push(slot);
    }
  }

  return Object.freeze({
    origins: Object.freeze(
      [...originsByKey.values()].map((origin) =>
        Object.freeze({
          originRunId: origin.originRunId,
          attemptId: origin.attemptId,
          sandbox: origin.sandbox,
          verdict: origin.verdict,
          slots: Object.freeze(origin.slots),
        })
      ),
    ),
    unreadableSlots: Object.freeze(unreadableSlots),
  });
}

function originHistoryBlocks(origin: OriginHistory): ReportBlock {
  const locator = encodeAttemptLocator(origin.attemptId);
  return reportSection({
    heading: `Origin ${locator}`,
    children: [
      reportTable({
        caption: "Origin locator",
        columns: [
          { key: "run", label: "Origin Run" },
          { key: "attempt", label: "Attempt" },
        ],
        rows: [{ run: origin.originRunId, attempt: locator }],
      }),
      ...sandboxBlocks(origin.sandbox),
      ...verdictBlocks(origin.verdict),
      reportSection({
        heading: "Evaluation coordinates",
        children: evaluationCoordinateBlocks(origin.slots),
      }),
    ],
  });
}

function sandboxBlocks(
  attachment: ProjectedRecordAttachmentResult<SandboxView>,
): readonly ReportBlock[] {
  if (attachment.state !== "available") {
    return [attachmentProblemBlock("Sandbox", attachment)];
  }

  if (attachment.value.state === "not-used") {
    return [reportStatus({ tone: "neutral", label: "Sandbox: not used" })];
  }

  const reuse = attachment.value.reuse;
  return [reportTable({
    caption: "Sandbox",
    columns: [
      { key: "provider", label: "Provider" },
      { key: "sandboxId", label: "Source-native sandbox ID" },
      { key: "reuse", label: "Reuse" },
      { key: "sandbox", label: "Sandbox", align: "end" },
      { key: "ordinal", label: "Ordinal", align: "end" },
    ],
    rows: [{
      provider: attachment.value.provider,
      sandboxId: attachment.value.sandboxId,
      reuse: reuse.kind,
      sandbox: reuse.kind === "pooled" ? reuse.sandbox : "—",
      ordinal: reuse.kind === "pooled" ? reuse.ordinal : "—",
    }],
  })];
}

function verdictBlocks(
  entry: AttemptSlotEntry<Verdict> | undefined,
): readonly ReportBlock[] {
  if (entry === undefined) {
    return [reportStatus({
      tone: "warning",
      label: "Verdict: no projected entry was supplied for this origin Attempt",
    })];
  }

  if (entry.state !== "attachment-result") {
    return [slotProjectionStateBlock("Verdict", entry.slot)];
  }

  if (entry.attachment.state !== "available") {
    return [attachmentProblemBlock("Verdict", entry.attachment)];
  }

  return [reportStatus({
    tone: entry.attachment.value === "passed" ? "positive" : "neutral",
    label: `Verdict: ${entry.attachment.value}`,
  })];
}

function evaluationCoordinateBlocks(slots: readonly SlotPlan[]): readonly ReportBlock[] {
  const visibleSlots = slots.slice(0, COORDINATES_PER_ORIGIN_MAX);
  const rows: Array<Record<string, string | number>> = [];
  const missing: ReportBlock[] = [];

  for (const { slot, plan } of visibleSlots) {
    const coordinate = evaluationCoordinateForSlot(slot, plan);
    if (coordinate === undefined) {
      missing.push(reportStatus({
        tone: "warning",
        label: `No available evaluation coordinate for Slot ${slot.runId}/${slot.slotId}`,
      }));
      continue;
    }
    rows.push({
      run: slot.runId,
      slot: slot.slotId,
      experiment: coordinate.experimentId,
      eval: coordinate.evalId,
      attempt: coordinate.attempt,
      kind: coordinate.kind,
      relation: slot.state === "included" ? slot.relation : "not available",
    });
  }

  const omittedSlots = slots.length - visibleSlots.length;
  return [
    ...(rows.length === 0
      ? []
      : [reportTable({
        caption: "Slot coordinates",
        columns: [
          { key: "run", label: "Run" },
          { key: "slot", label: "Slot" },
          { key: "experiment", label: "Experiment" },
          { key: "eval", label: "Eval" },
          { key: "attempt", label: "Attempt", align: "end" },
          { key: "kind", label: "Kind" },
          { key: "relation", label: "Member relation" },
        ],
        rows,
      })]),
    ...missing,
    ...(omittedSlots === 0
      ? []
      : [reportStatus({
        tone: "warning",
        label: `${omittedSlots} additional Slot coordinate(s) omitted from this origin`,
      })]),
  ];
}

function evaluationCoordinateForSlot(
  slot: Pick<AnalysisSlot, "slotId">,
  plan: EvaluationPlanEntry | undefined,
): EvaluationPlanCoordinate | undefined {
  if (plan === undefined || plan.attachment.state !== "available") {
    return undefined;
  }
  return plan.attachment.value.coordinateForSlot(slot.slotId);
}

function unreadableSlotBlocks(slots: readonly SlotPlan[]): readonly ReportBlock[] {
  if (slots.length === 0) {
    return [reportStatus({
      tone: "positive",
      label: "Every displayed origin was read from an included Slot",
    })];
  }

  const visibleSlots = slots.slice(0, UNREADABLE_SLOTS_MAX);
  const omittedSlots = slots.length - visibleSlots.length;
  return [
    ...visibleSlots.map((entry) => reportSection({
      heading: `Slot ${entry.slot.runId}/${entry.slot.slotId}`,
      children: [
        slotProjectionStateBlock("Sandbox and Verdict", entry.slot),
        ...evaluationCoordinateBlocks([entry]),
      ],
    })),
    ...(omittedSlots === 0
      ? []
      : [reportStatus({
        tone: "warning",
        label: `${omittedSlots} additional unreadable Slot(s) omitted from this bounded list`,
      })]),
  ];
}

function evaluationPlanProblemBlocks(
  projection: ProjectedSample<"selected-run", EvaluationPlanView>,
): readonly ReportBlock[] {
  const problems: Array<{
    readonly runId: string;
    readonly attachment: UnavailableAttachment<EvaluationPlanView>;
  }> = [];
  for (const entry of projection.entries) {
    if (entry.attachment.state !== "available") {
      problems.push({ runId: entry.run.runId, attachment: entry.attachment });
    }
  }
  if (problems.length === 0) {
    return [reportStatus({
      tone: "positive",
      label: "Every selected Run has an available evaluation plan Attachment",
    })];
  }

  const visibleProblems = problems.slice(0, PLAN_PROBLEMS_MAX);
  const omittedProblems = problems.length - visibleProblems.length;
  return [
    ...visibleProblems.map((entry) => attachmentProblemBlock(
      `Evaluation plan for Run ${entry.runId}`,
      entry.attachment,
    )),
    ...(omittedProblems === 0
      ? []
      : [reportStatus({
        tone: "warning",
        label: `${omittedProblems} additional evaluation plan problem(s) omitted from this bounded list`,
      })]),
  ];
}

function attachmentProblemBlock<Value>(
  name: string,
  attachment: UnavailableAttachment<Value>,
): ReportBlock {
  switch (attachment.state) {
    case "unavailable":
      return reportStatus({ tone: "warning", label: `${name}: attachment unavailable` });
    case "migration-required":
      return reportStatus({
        tone: "warning",
        label: `${name}: migration required`,
        detail: [reportText(`${attachment.from} → ${attachment.to}; ${attachment.command}`)],
      });
    case "migration-unavailable":
      return reportStatus({
        tone: "warning",
        label: `${name}: migration unavailable`,
        detail: [reportText(`${attachment.from} → ${attachment.to}; ${attachment.reason}`)],
      });
    case "unsupported":
      return reportStatus({
        tone: "warning",
        label: `${name}: unsupported attachment`,
        detail: [reportText(attachment.schemaId)],
      });
    case "invalid":
      return reportStatus({
        tone: "negative",
        label: `${name}: invalid attachment`,
        detail: [reportText(issueCodes(attachment.issues))],
      });
    default:
      return unreachable(attachment);
  }
}

function slotProjectionStateBlock(name: string, slot: AnalysisSlot): ReportBlock {
  switch (slot.state) {
    case "included":
      return reportStatus({ tone: "positive", label: `${name}: included` });
    case "not-recorded":
      return reportStatus({
        tone: "warning",
        label: `${name}: not recorded because this Slot has no Member`,
      });
    case "core-invalid":
      return reportStatus({
        tone: "negative",
        label: `${name}: unavailable because Record Core is invalid`,
        detail: [reportText(issueCodes(slot.issues))],
      });
    case "excluded":
      return reportStatus({
        tone: "neutral",
        label: `${name}: excluded from the selected denominator`,
        detail: [reportText(excludedSlotDetail(slot))],
      });
    default:
      return unreachable(slot);
  }
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

function plansByRun(
  projection: ProjectedSample<"selected-run", EvaluationPlanView>,
): ReadonlyMap<string, EvaluationPlanEntry> {
  const plans = new Map<string, EvaluationPlanEntry>();
  for (const entry of projection.entries) {
    plans.set(entry.run.runId, entry);
  }
  return plans;
}

function slotKey(slot: Pick<AnalysisSlot, "runId" | "slotId">): string {
  return `${slot.runId}\u0000${slot.slotId}`;
}

function originKey(runId: string, attemptId: string): string {
  return `${runId}\u0000${attemptId}`;
}

function excludedSlotDetail(
  slot: Extract<AnalysisSlot, { readonly state: "excluded" }>,
): string {
  return slot.base.state === "core-invalid"
    ? `Underlying state is core-invalid: ${issueCodes(slot.base.issues)}`
    : `Underlying state is ${slot.base.state}.`;
}

function issueCodes(issues: readonly { readonly code: string }[]): string {
  return issues.map((issue) => issue.code).join(", ");
}

function unreachable(value: never): never {
  throw new Error(`Unexpected Sandbox history value: ${String(value)}`);
}
