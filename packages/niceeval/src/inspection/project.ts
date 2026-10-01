import { Schema } from "effect";
import { resolveInspectionMemberAttempt } from "./facts.ts";
import { aggregateInspectionCurrentSlots, selectInspectionOverview } from "./overview.ts";
import type { FrozenProjectInput } from "./project-input.ts";
import { InspectionProjectResultSchema, type InspectionProjectResult } from "./project-result.ts";
import type { ExecutionGapReason } from "../runner/reuse-plan.ts";

export function selectInspectionProject(input: FrozenProjectInput, experimentIds?: readonly string[]): InspectionProjectResult {
  const selectedIds = new Set(experimentIds ?? input.target.experiments.map((experiment) => experiment.experimentId));
  const assessments = input.assessments.filter((slot) => selectedIds.has(slot.experimentId));
  const logicalKey = (experimentId: string, evalId: string, ordinal: number) => JSON.stringify([experimentId, evalId, ordinal]);
  // Select historical entrances before aggregation; they never contribute quality.
  const previous = new Map<string, InspectionProjectResult["history"][number]>();
  const historical = [...input.runs].sort((left, right) =>
    (left.physical.createdRevision ?? 0) - (right.physical.createdRevision ?? 0)
    || compare(left.run.runId, right.run.runId));
  for (const run of historical) for (const slot of run.run.expectedSlots) {
    const member = run.members.find((member) => member.slotId === slot.slotId);
    const resolved = member === undefined ? undefined : resolveInspectionMemberAttempt(input.runs, run, member);
    previous.set(logicalKey(run.run.experimentId, slot.evalId, slot.attemptOrdinal), {
      experimentId: run.run.experimentId, evalId: slot.evalId, attemptOrdinal: slot.attemptOrdinal,
      sourceRunId: run.run.runId,
      locator: resolved?.locator ?? null,
    });
  }
  // A newer Run with no published Core is still the latest history occurrence.
  const unpublished = input.resources.filter((resource) => !input.runs.some((run) => run.run.runId === resource.runId));
  for (const resource of unpublished.sort((left, right) => left.createdRevision - right.createdRevision || compare(left.runId, right.runId))) {
    for (const slot of resource.slots) {
      const key = logicalKey(resource.experimentId, slot.evalId, slot.attemptOrdinal);
      const old = previous.get(key);
      const oldRevision = old === undefined ? -1 : input.resources.find((run) => run.runId === old.sourceRunId)?.createdRevision ?? 0;
      if (resource.createdRevision < oldRevision || resource.createdRevision === oldRevision && old !== undefined && compare(resource.runId, old.sourceRunId) <= 0) continue;
      previous.set(key, Schema.decodeUnknownSync(InspectionProjectResultSchema.fields.history.value)({ experimentId: resource.experimentId, evalId: slot.evalId, attemptOrdinal: slot.attemptOrdinal, sourceRunId: resource.runId, locator: null }));
    }
  }
  const currentPositions = new Set(input.target.slots.map((slot) => logicalKey(slot.experimentId, slot.evalId, slot.attempt)));
  const slots: InspectionProjectResult["slots"] = assessments.map((slot) => {
    const position = { experimentId: slot.experimentId as InspectionProjectResult["slots"][number]["experimentId"], evalId: slot.evalId as InspectionProjectResult["slots"][number]["evalId"], attemptOrdinal: slot.attempt };
    if (slot.state === "reuse") return { ...position, state: "reuse" as const, ...{
      sourceRunId: slot.source.sourceBarrier.runId, locator: slot.source.locator, relation: slot.source.relation, action: slot.source.action,
    } };
    const publishedPrevious = [...historical].reverse().flatMap((run) => {
      if (run.run.experimentId !== slot.experimentId) return [];
      const expected = run.run.expectedSlots.find((expected) => expected.evalId === slot.evalId && expected.attemptOrdinal === slot.attempt);
      const member = expected === undefined ? undefined : run.members.find((member) => member.slotId === expected.slotId);
      const resolved = member === undefined ? undefined : resolveInspectionMemberAttempt(input.runs, run, member);
      return resolved === undefined ? [] : [{ sourceRunId: run.run.runId, locator: resolved.locator }];
    })[0] ?? null;
    const resource = input.resources.find((resource) => resource.runId === slot.sourceBarrier?.runId);
    const reason = slot.reason === "source-member-missing" && resource?.state === "active" ? "pending" : gapReason(slot.reason);
    return { ...position, state: "gap" as const, reason, sourceRunId: slot.sourceBarrier?.runId ?? null,
      previous: publishedPrevious,
      issues: [...slot.issues.map((issue) => ({ code: issue.code, path: [...issue.path] })), { reason: slot.reason, scope: slot.scope, comparisons: slot.comparisons.map((comparison) => ({ ...comparison })) }],
    };
  });
  const overview = aggregateInspectionCurrentSlots(assessments.map((slot) => {
    const experiment = input.target.experiments.find((experiment) => experiment.experimentId === slot.experimentId)!;
    const recorded = slot.state !== "reuse" ? undefined : (() => {
      const target = input.runs.find((run) => run.run.runId === slot.source.sourceRunId)!;
      const expected = target.run.expectedSlots.find((expected) => expected.evalId === slot.evalId && expected.attemptOrdinal === slot.attempt)!;
      const member = target.members.find((member) => member.slotId === expected.slotId)!;
      const resolved = resolveInspectionMemberAttempt(input.runs, target, member)!;
      return { target, slot: expected, member, resolved };
    })();
    return { experimentId: slot.experimentId, evalId: slot.evalId, attemptOrdinal: slot.attempt,
      evaluationKind: slot.evaluationKind, adapter: experiment.adapter, model: experiment.model ?? null,
      labels: experiment.labels, ...(recorded === undefined ? {} : { recorded }) };
  }));
  const empty = selectInspectionOverview([]).totals;
  const experiments = input.target.experiments.filter((experiment) => selectedIds.has(experiment.experimentId)).map((experiment) =>
    overview.experiments.find((entry) => entry.experimentId === experiment.experimentId) ?? {
      ...empty, experimentId: experiment.experimentId, adapter: { state: "available" as const, value: experiment.adapter },
      model: experiment.model === undefined ? { state: "unavailable" as const } : { state: "available" as const, value: experiment.model }, labels: {}, groups: [],
    });
  const covered = slots.filter((slot) => slot.state === "reuse").length;
  const history = [...previous.values()].filter((slot) => !currentPositions.has(logicalKey(slot.experimentId, slot.evalId, slot.attemptOrdinal)) && (experimentIds === undefined || selectedIds.has(slot.experimentId)))
    .sort((left, right) => compare(left.experimentId, right.experimentId) || compare(left.evalId, right.evalId) || left.attemptOrdinal - right.attemptOrdinal);
  return Schema.decodeUnknownSync(InspectionProjectResultSchema)({ targetIdentity: input.target.identity, coverage: { expected: slots.length, covered, gaps: slots.length - covered }, slots,
    totals: overview.totals, experiments, cells: overview.cells, history });
}

function gapReason(reason: ExecutionGapReason): Extract<InspectionProjectResult["slots"][number], { state: "gap" }>["reason"] {
  switch (reason) {
    case "no-source-run": case "source-slot-missing": return "no-result";
    case "source-member-missing": case "source-publication-unavailable": return "not-published";
    case "identity-mismatch": case "identity-domain-mismatch": return "identity-mismatch";
    case "attempt-outcome-ineligible": case "verdict-ineligible": return "outcome-ineligible";
    case "score-incomplete": return "score-incomplete";
    case "timeout-exceeded": return "timeout-exceeded";
    case "adoption-unproven": return "adoption-unproven";
    default: return "evidence-unavailable";
  }
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
