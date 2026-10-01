import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Effect, Result } from "effect";
import { prepareCurrentTarget, assessCurrentTarget } from "../experiment/host/current.ts";
import { acquireProjectRecordReadSession } from "../record/sqlite/index.ts";
import { hydrateRecordAttachmentCurrent } from "../record/attachment/protocol.ts";
import { NiceEvalCurrentRecordAttachments, NiceEvalRecordAttachments } from "../record/family/current.ts";
import { recordIssue } from "../record/errors/record-errors.ts";
import type { Config } from "../runner/types.ts";
import type { CurrentAssessmentRun } from "../runner/reuse-plan.ts";
import type { CurrentAssessmentAttempt } from "../runner/reuse-plan.ts";
import { mergeCurrentAssessmentRuns } from "../runner/reuse-plan.ts";
import type { ReadableRunResource } from "../run/storage/types.ts";
import type { ResolvedInspectionAttempt } from "./facts.ts";
import { loadInspectionRuns, resolveInspectionMemberAttempt, readInspectionAssertions, attemptAttachment } from "./facts.ts";
import { openInspectionSource, operationalInspectionSource, type InspectionFactSource } from "./source.ts";
import { bindProjectInput, type CurrentResultSource } from "./project-input.ts";

/** One scoped reader owns both the availability inputs and Inspection facts. */
export const openCurrentProjectSource = Effect.fn("openCurrentProjectSource")(function*(input: { readonly cwd: string; readonly config: Config }) {
  const root = resolve(input.cwd, ".niceeval");
  let source: InspectionFactSource;
  const resources: ReadableRunResource[] = [];
  if (!existsSync(resolve(root, "record.sqlite"))) {
    source = yield* openInspectionSource(operationalInspectionSource(input.cwd));
  } else {
    const session = yield* acquireProjectRecordReadSession(root);
    const cutoff = session.readSealedRunSummaryPage("", 1).cutoff;
    source = Object.freeze({
      kind: "project-record" as const,
      cutoff: () => cutoff,
      readRunResource: session.readRunResource,
      readSealedRunSummaryPage: session.readSealedRunSummaryPage,
      findAttemptLocatorCandidates: session.findAttemptLocatorCandidates,
      readSealedRunCore: session.readSealedRunCore,
      readContentPage: session.readContentChunkPage,
      readCollectionPage: session.readCollectionItemPage,
    });
    let afterRunId = "";
    for (;;) {
      const page = session.listRunResources({ afterRunId, pageSize: 100 });
      resources.push(...page.runs);
      if (page.nextAfterRunId === null) break;
      afterRunId = page.nextAfterRunId;
    }
  }
  const target = yield* prepareCurrentTarget(input);
  const runs = yield* Effect.try(() => loadInspectionRuns(source));
  type Ref = { readonly resolved: ResolvedInspectionAttempt | undefined; readonly sourceRunId: string; readonly publication: Extract<ReadableRunResource["slots"][number]["publication"], { state: "published" }> | undefined };
  const assessmentRuns: CurrentAssessmentRun<Ref>[] = runs.map((run) => ({
    createdRevision: run.physical.createdRevision,
    document: run.run,
    members: run.members.map((member) => ({
      document: member,
      bindingRevision: run.physical.members.find((row) => row.slotId === member.slotId)?.bindingRevision,
      attempt: member.attempt === null ? null : {
        resolved: resolveInspectionMemberAttempt(runs, run, member),
        sourceRunId: run.run.runId,
        publication: published(resources.find((resource) => resource.runId === run.run.runId)?.slots.find((slot) => slot.slotId === member.slotId)?.publication),
      },
    })),
  }));
  const lifecycleRuns = yield* mergeCurrentAssessmentRuns(assessmentRuns, resources);
  type Attempt = Ref & CurrentAssessmentAttempt;
  const assessments = yield* assessCurrentTarget<Ref, Attempt, CurrentResultSource, never>(target, {
    runs: lifecycleRuns,
    byRunId: new Map(lifecycleRuns.map((run) => [run.document.runId, run])),
    selectionHasProblem: false,
    coreIssues: [],
    readAttempt: (ref: Ref) => Effect.succeed(ref.resolved === undefined ? { state: "missing" as const } : {
      state: "available" as const,
      value: { ...ref, document: ref.resolved.attempt, publicationAvailable: ref.publication !== undefined || ref.resolved.origin.physical.attempts.some((attempt) => attempt.attemptId === ref.resolved!.attempt.attemptId && attempt.publicationIdentity !== undefined) },
    }),
    readAssertions: (attempt) => Effect.sync(() => {
      const read = readInspectionAssertions(attempt.resolved!);
      if (read.state === "available") return { state: "available" as const, value: read.value };
      if (read.state === "not-recorded") return { state: "not-recorded" as const };
      if (read.state === "unsupported") return { state: "unsupported" as const, family: NiceEvalRecordAttachments.assertions.family, revision: read.attachment!.physical.familyRevision };
      return { state: "invalid" as const, issues: [recordIssue("record-schema-invalid", ["assertions", "current-invalid"])] as const };
    }),
    readActivities: (attempt) => Effect.sync(() => {
      const definition = NiceEvalRecordAttachments.runnerActivities.attempt;
      const attachment = attemptAttachment(attempt.resolved!, definition.family);
      if (attachment === undefined) return { state: "not-recorded" as const };
      if (attachment.physical.familyRevision !== NiceEvalCurrentRecordAttachments.runnerActivities.attempt.revision) return { state: "unsupported" as const, family: definition.family, revision: attachment.physical.familyRevision };
      const value = hydrateRecordAttachmentCurrent(definition, attachment.value, { content: () => Result.succeed(undefined), reference: () => Result.succeed(undefined) });
      return Result.isSuccess(value) ? { state: "available" as const, value: value.success } : { state: "invalid" as const, issues: [recordIssue("record-schema-invalid", [definition.family, value.failure.code])] as const };
    }),
    sourceFor: (attempt, sourceBarrier): CurrentResultSource => ({
      attemptId: attempt.document.attemptId,
      origin: { runId: attempt.document.originRunId, slotId: attempt.document.slotId },
      sourceBarrier,
      sourceRunId: attempt.sourceRunId,
      locator: attempt.resolved!.locator,
      relation: attempt.sourceRunId === attempt.document.originRunId ? "origin" : "reference",
      action: attempt.publication?.action ?? (runs.find((run) => run.run.runId === attempt.sourceRunId)!.members.find((member) => member.attempt?.attemptId === attempt.document.attemptId)!.action as "executed" | "carried" | "accepted"),
    }),
  });
  bindProjectInput(source, { cutoffIdentity: source.cutoff().identity, target, assessments, runs, resources: Object.freeze(resources) });
  return source;
});

function published(value: ReadableRunResource["slots"][number]["publication"] | undefined) {
  return value?.state === "published" ? value : undefined;
}
