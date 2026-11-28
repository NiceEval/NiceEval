import { NiceEvalCurrentRecordAttachments } from "../record/family/current.ts";
import type { InspectionPresentationIssue, InspectionRunSummary } from "./experiment-presentation-schema.ts";
import { runAttachment, type LoadedInspectionRun } from "./facts.ts";
import { readCurrentAttachment } from "./trace.ts";

export function inspectRunPresentation(
  identity: Pick<InspectionRunSummary, "runId" | "experimentId">,
  run: LoadedInspectionRun | undefined,
): { readonly summary: InspectionRunSummary; readonly issue?: InspectionPresentationIssue } {
  const fallback = { ...identity, displayName: identity.experimentId };
  const unavailable = (problems: readonly string[]) => ({
    summary: { ...fallback, displayNameState: "unavailable" as const },
    issue: { code: "experiment-presentation-unavailable" as const, runId: identity.runId, problems },
  });
  if (run === undefined) return unavailable(["run-presentation-not-published"]);
  const persistence = NiceEvalCurrentRecordAttachments.experimentPresentation;
  const attachment = runAttachment(run, persistence.attachment.family);
  if (attachment === undefined) return { summary: { ...fallback, displayNameState: "fallback-missing" } };
  try {
    const read = readCurrentAttachment(persistence, attachment);
    if (read.state === "invalid") return unavailable(read.issues);
    if (read.state !== "available") return unavailable(["source-attachment-unavailable"]);
    if (read.value.experimentId !== identity.experimentId) return unavailable(["source-attachment-identity-invalid"]);
    return { summary: { ...identity, displayName: read.value.displayName, displayNameState: "recorded" } };
  } catch {
    return unavailable(["source-attachment-unreadable"]);
  }
}
