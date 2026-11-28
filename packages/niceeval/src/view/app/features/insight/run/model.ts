import type { InspectionSuccessDocumentFor } from "../../../../../inspection/public.ts";
import { closeAdapterIdentity, type ClosedAdapterIdentity } from "../data/adapter-identity.ts";

export interface RunPageModel {
  readonly runId: string;
  readonly experimentId: string;
  readonly displayName: string;
  readonly adapter: ClosedAdapterIdentity | undefined;
  readonly diagnostics: InspectionSuccessDocumentFor<"run.get">["run"]["diagnostics"];
  readonly members: readonly RunMemberModel[];
}

export interface RunMemberModel {
  readonly key: string;
  readonly plannedAttemptId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly state: "executed" | "carried" | "accepted" | "not-dispatched" | "interrupted" | "pending";
  readonly locator: string | undefined;
  readonly outcome: "completed" | "errored" | "cancelled" | "interrupted" | undefined;
  readonly verdict: "passed" | "failed" | "errored" | "skipped" | undefined;
  readonly score: InspectionSuccessDocumentFor<"run.get">["run"]["plannedAttempts"][number]["score"] | undefined;
}

export function closeRun(run: InspectionSuccessDocumentFor<"run.get">): RunPageModel {
  const { runId, experimentId } = run.run.value;
  return {
    runId,
    experimentId,
    displayName: run.selection.selectedRuns?.find((summary) => summary.runId === runId)?.displayName ?? experimentId,
    adapter: closeAdapterIdentity(run.run.value.context?.execution.adapter),
    diagnostics: run.run.diagnostics,
    members: run.run.plannedAttempts.map((member, index) => ({
      key: `${member.plannedAttemptId}:${index}`,
      plannedAttemptId: member.plannedAttemptId,
      evalId: member.evalId,
      attemptOrdinal: member.attemptOrdinal,
      state: member.state,
      locator: member.publication.state === "published" ? member.publication.attemptLocator : undefined,
      outcome: member.outcome ?? undefined,
      verdict: member.verdict ?? undefined,
      score: member.score,
    })),
  };
}
