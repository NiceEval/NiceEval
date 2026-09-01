import type { InspectionSuccessDocumentFor } from "../../../../../inspection/public.ts";

export interface RunPageModel {
  readonly runId: string;
  readonly experimentId: string;
  readonly members: readonly RunMemberModel[];
}

export interface RunMemberModel {
  readonly key: string;
  readonly slotId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly state: "executed" | "carried" | "accepted" | "not-dispatched" | "interrupted" | "missing";
  readonly locator: string | null;
  readonly outcome: "completed" | "errored" | "cancelled" | "interrupted" | null;
  readonly verdict: "passed" | "failed" | "errored" | "skipped" | null;
}

export function closeRun(
  run: InspectionSuccessDocumentFor<"run.get">,
  summary: InspectionSuccessDocumentFor<"run.summary">,
): RunPageModel {
  return Object.freeze({
    runId: run.run.value.runId,
    experimentId: run.run.value.experimentId,
    members: Object.freeze(summary.summary.members.map((member, index) => Object.freeze({
      key: `${member.slotId}:${index}`,
      slotId: member.slotId,
      evalId: member.evalId,
      attemptOrdinal: member.attemptOrdinal,
      state: member.state,
      locator: member.locator,
      outcome: member.outcome,
      verdict: member.verdict,
    }))),
  });
}
