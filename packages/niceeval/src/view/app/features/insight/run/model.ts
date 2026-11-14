import type { InspectionSuccessDocumentFor } from "../../../../../inspection/public.ts";
import type { AdapterIdentity } from "../../../../../record/model/run-context.ts";

export interface RunPageModel {
  readonly runId: string;
  readonly experimentId: string;
  readonly adapter: AdapterIdentity | null;
  readonly diagnostics: InspectionSuccessDocumentFor<"run.get">["run"]["diagnostics"];
  readonly members: readonly RunMemberModel[];
}

export interface RunMemberModel {
  readonly key: string;
  readonly plannedAttemptId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly state: "executed" | "carried" | "accepted" | "not-dispatched" | "interrupted" | "pending";
  readonly locator: string | null;
  readonly outcome: "completed" | "errored" | "cancelled" | "interrupted" | null;
  readonly verdict: "passed" | "failed" | "errored" | "skipped" | null;
  readonly score?: InspectionSuccessDocumentFor<"run.get">["run"]["plannedAttempts"][number]["score"];
}

export function closeRun(run: InspectionSuccessDocumentFor<"run.get">): RunPageModel {
  return Object.freeze({
    runId: run.run.value.runId,
    experimentId: run.run.value.experimentId,
    adapter: run.run.value.context?.execution.adapter ?? null,
    diagnostics: run.run.diagnostics,
    members: Object.freeze(
      run.run.plannedAttempts.map((member, index) =>
        Object.freeze({
          key: `${member.plannedAttemptId}:${index}`,
          plannedAttemptId: member.plannedAttemptId,
          evalId: member.evalId,
          attemptOrdinal: member.attemptOrdinal,
          state: member.state,
          locator: member.publication.state === "published" ? member.publication.attemptLocator : null,
          outcome: member.outcome,
          verdict: member.verdict,
          score: member.score,
        }),
      ),
    ),
  });
}
