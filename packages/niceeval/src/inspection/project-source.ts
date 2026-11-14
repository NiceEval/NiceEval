import { sourceHashesForIdentity } from "./sources.ts";
import { explainIdentityMismatch } from "../runner/manifest.ts";
import { publicationCutoffIdentity } from "../run/storage/cutoff.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Effect, Result } from "effect";
import { prepareCurrentTarget, assessCurrentTarget } from "../experiment/host/current.ts";
import { acquireProjectRecordReadSession, openHostOwnedRecordReadSession } from "../record/sqlite/index.ts";
import { hydrateRecordAttachmentCurrent } from "../record/attachment/protocol.ts";
import { NiceEvalCurrentRecordAttachments, NiceEvalRecordAttachments } from "../record/family/current.ts";
import { recordIssue } from "../record/errors/record-errors.ts";
import type { Config } from "../runner/types.ts";
import type { CurrentAssessmentRun } from "../runner/reuse-plan.ts";
import type { CurrentAssessmentAttempt } from "../runner/reuse-plan.ts";
import { mergeCurrentAssessmentRuns } from "../runner/reuse-plan.ts";
import type { ReadableRunResource } from "../run/storage/types.ts";
import type { ResolvedInspectionAttempt } from "./facts.ts";
import {
  loadInspectionRuns,
  resolveInspectionMemberAttempt,
  readInspectionAssertions,
  attemptAttachment,
  runAttachment,
} from "./facts.ts";
import { openInspectionSource, operationalInspectionSource, type InspectionFactSource } from "./source.ts";
import { bindProjectInput, type CurrentResultSource } from "./project-input.ts";

/** One scoped reader owns both the availability inputs and Inspection facts. */
export const openCurrentProjectSource = Effect.fn("openCurrentProjectSource")(function* (input: {
  readonly cwd: string;
  readonly config: Config;
  readonly recordPath?: string;
  readonly freshImport?: boolean;
}) {
  const root = resolve(input.cwd, ".niceeval");
  let source: InspectionFactSource;
  const resources: ReadableRunResource[] = [];
  if (input.recordPath === undefined && !existsSync(resolve(root, "record.sqlite"))) {
    source = yield* openInspectionSource(operationalInspectionSource(input.cwd));
  } else {
    const session =
      input.recordPath === undefined
        ? yield* acquireProjectRecordReadSession(root)
        : yield* Effect.acquireRelease(
            Effect.try(() => openHostOwnedRecordReadSession(input.recordPath!)),
            (opened) => Effect.sync(() => opened.close()),
          );
    const publication = session.publicationCutoff();
    const cutoff = Object.freeze({ ...publication, identity: publicationCutoffIdentity(publication) });
    source = Object.freeze({
      kind: "project-record" as const,
      cutoff: () => cutoff,
      findExperimentRunIds: session.findExperimentRunIds,
      readRunResource: session.readRunResource,
      readRunResourcePage: (afterRunId = "", pageSize = 100) => session.listRunResources({ afterRunId, pageSize }),
      readSealedRunSummaryPage: session.readSealedRunSummaryPage,
      findAttemptLocatorCandidates: session.findAttemptLocatorCandidates,
      readSealedRunCore: (runId: string) => session.readSealedRunCore(runId, true),
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
  const publishedAttemptIds = new Map(
    runs.map((run) => [
      run.run.runId,
      new Set(
        run.physical.attempts
          .filter((attempt) => attempt.publicationIdentity !== undefined)
          .map((attempt) => attempt.attemptId),
      ),
    ]),
  );
  const slotsByRunId = new Map(
    resources.map((resource) => [resource.runId, new Map(resource.slots.map((slot) => [slot.slotId, slot]))]),
  );
  type Ref = {
    readonly action: "executed" | "carried" | "accepted";
    readonly resolved: ResolvedInspectionAttempt | undefined;
    readonly sourceRunId: string;
    readonly publication:
      | Extract<ReadableRunResource["slots"][number]["publication"], { state: "published" }>
      | undefined;
  };
  const assessmentRuns: CurrentAssessmentRun<Ref>[] = runs.map((run) => {
    const physicalBySlot = new Map(run.physical.members.map((row) => [row.slotId, row]));
    const slots = slotsByRunId.get(run.run.runId);
    return {
      createdRevision: run.physical.createdRevision,
      document: run.run,
      members: run.members.map((member) => ({
        document: member,
        bindingRevision: physicalBySlot.get(member.slotId)?.bindingRevision,
        attempt:
          member.attempt === null
            ? null
            : {
                resolved: resolveInspectionMemberAttempt(runs, run, member),
                sourceRunId: run.run.runId,
                action: member.action as "executed" | "carried" | "accepted",
                publication: published(slots?.get(member.slotId)?.publication),
              },
      })),
    };
  });
  const lifecycleRuns = yield* mergeCurrentAssessmentRuns(assessmentRuns, resources);
  type Attempt = Ref & CurrentAssessmentAttempt;
  const assessments = yield* assessCurrentTarget<Ref, Attempt, CurrentResultSource, Error>(target, {
    runs: lifecycleRuns,
    byRunId: new Map(lifecycleRuns.map((run) => [run.document.runId, run])),
    selectionHasProblem: false,
    coreIssues: [],
    readAttempt: (ref: Ref) =>
      Effect.succeed(
        ref.resolved === undefined
          ? { state: "missing" as const }
          : {
              state: "available" as const,
              value: {
                ...ref,
                document: ref.resolved.attempt,
                publicationAvailable:
                  ref.publication !== undefined ||
                  publishedAttemptIds.get(ref.resolved.origin.run.runId)?.has(ref.resolved.attempt.attemptId) === true,
              },
            },
      ),
    readAssertions: (attempt) =>
      Effect.try(() => {
        const read = readInspectionAssertions(attempt.resolved!);
        if (read.state === "available") return { state: "available" as const, value: read.value };
        if (read.state === "not-recorded") return { state: "not-recorded" as const };
        if (read.state === "unsupported")
          return {
            state: "unsupported" as const,
            family: NiceEvalRecordAttachments.assertions.family,
            revision: read.attachment!.physical.familyRevision,
          };
        return {
          state: "invalid" as const,
          issues: [recordIssue("record-schema-invalid", ["assertions", "current-invalid"])] as const,
        };
      }),
    readIdentityComparison: (run, current) =>
      Effect.try(() => {
        const loaded = runs.find((loaded) => loaded.run.runId === run.document.runId);
        const definition = NiceEvalRecordAttachments.identityManifests;
        const attachment = loaded === undefined ? undefined : runAttachment(loaded, definition.family);
        const decoded =
          attachment === undefined ||
          attachment.physical.familyRevision !== NiceEvalCurrentRecordAttachments.identityManifests.revision
            ? undefined
            : hydrateRecordAttachmentCurrent(definition, attachment.value, {
                content: () => Result.succeed(undefined),
                reference: () => Result.succeed(undefined),
              });
        const historical =
          decoded !== undefined && Result.isSuccess(decoded)
            ? decoded.success.entries.find((entry) => entry.evalId === current.evalId)
            : undefined;
        const sources =
          historical !== undefined || loaded === undefined
            ? undefined
            : runAttachment(loaded, NiceEvalRecordAttachments.sources.family);
        let source: Readonly<Record<string, string>> | undefined;
        if (sources !== undefined) {
          try {
            source = sourceHashesForIdentity(sources);
          } catch {
            /* Unreadable Sources cannot explain a delta. */
          }
        }
        return {
          historical,
          explanation: explainIdentityMismatch({
            ...(historical === undefined ? {} : { historical }),
            ...(current.identityManifest === undefined ? {} : { current: current.identityManifest }),
            ...(run.document.context === undefined ? {} : { context: run.document.context }),
            ...(source === undefined ? {} : { source }),
          }),
        };
      }),
    readActivities: (attempt) =>
      Effect.try(() => {
        const definition = NiceEvalRecordAttachments.runnerActivities.attempt;
        const attachment = attemptAttachment(attempt.resolved!, definition.family);
        if (attachment === undefined) return { state: "not-recorded" as const };
        if (attachment.physical.familyRevision !== NiceEvalCurrentRecordAttachments.runnerActivities.attempt.revision)
          return {
            state: "unsupported" as const,
            family: definition.family,
            revision: attachment.physical.familyRevision,
          };
        const value = hydrateRecordAttachmentCurrent(definition, attachment.value, {
          content: () => Result.succeed(undefined),
          reference: () => Result.succeed(undefined),
        });
        return Result.isSuccess(value)
          ? { state: "available" as const, value: value.success }
          : {
              state: "invalid" as const,
              issues: [recordIssue("record-schema-invalid", [definition.family, value.failure.code])] as const,
            };
      }),
    sourceFor: (attempt, sourceBarrier): CurrentResultSource => ({
      attemptId: attempt.document.attemptId,
      origin: { runId: attempt.document.originRunId, slotId: attempt.document.slotId },
      sourceBarrier,
      sourceRunId: attempt.sourceRunId,
      locator: attempt.resolved!.locator,
      relation: attempt.sourceRunId === attempt.document.originRunId ? "origin" : "reference",
      action: attempt.publication?.action ?? attempt.action,
    }),
  });
  bindProjectInput(source, {
    cutoffIdentity: source.cutoff().identity,
    target,
    assessments,
    runs,
    resources: Object.freeze(resources),
  });
  return source;
});

function published(value: ReadableRunResource["slots"][number]["publication"] | undefined) {
  return value?.state === "published" ? value : undefined;
}
