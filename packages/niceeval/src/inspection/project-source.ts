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
import type { IdentityManifestEntry } from "../record/family/identity-manifests/schema.ts";
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
import {
  inspectionSourceError,
  openInspectionSource,
  operationalInspectionSource,
  type InspectionFactSource,
} from "./source.ts";
import { bindProjectInput, type CurrentResultSource } from "./project-input.ts";

/** One scoped reader owns both the availability inputs and Inspection facts. */
export const openCurrentProjectSource = Effect.fn("openCurrentProjectSource")(function* (input: {
  readonly cwd: string;
  readonly config: Config;
  readonly recordPath?: string;
  readonly freshImport?: boolean;
  readonly experimentIds?: readonly string[];
}) {
  const target = yield* prepareCurrentTarget({ cwd: input.cwd, config: input.config, freshImport: input.freshImport });
  const root = resolve(input.cwd, ".niceeval");
  const recordPath = input.recordPath;
  let source: InspectionFactSource;
  const resources: ReadableRunResource[] = [];
  if (input.recordPath === undefined && !existsSync(resolve(root, "record.sqlite"))) {
    source = yield* openInspectionSource(operationalInspectionSource(input.cwd));
  } else {
    const session =
      recordPath === undefined
        ? yield* acquireProjectRecordReadSession(root, { operationScoped: true }).pipe(
            Effect.mapError(inspectionSourceError),
          )
        : yield* Effect.acquireRelease(
            Effect.try({
              try: () => openHostOwnedRecordReadSession(recordPath, undefined, true),
              catch: inspectionSourceError,
            }),
            (opened) => Effect.sync(() => opened.close()),
          );
    session.beginOperation();
    const publication = session.publicationCutoff();
    const cutoff = { ...publication, identity: publicationCutoffIdentity(publication) };
    source = {
      kind: "project-record" as const,
      beginOperation: session.beginOperation ?? (() => {}),
      cutoff: () => cutoff,
      findExperimentRunIds: session.findExperimentRunIds,
      readRunResource: session.readRunResource,
      readRunResourcePage: (afterRunId = "", pageSize = 100) =>
        session.listRunResources({
          afterRunId,
          pageSize,
          cutoff: undefined,
          invocationId: undefined,
        }),
      readSealedRunSummaryPage: session.readSealedRunSummaryPage,
      findAttemptLocatorCandidates: session.findAttemptLocatorCandidates,
      readSealedRunCore: (runId: string) => session.readSealedRunCore(runId, true),
      readContentPage: session.readContentChunkPage,
      readCollectionPage: session.readCollectionItemPage,
    };
    let afterRunId = "";
    for (;;) {
      const page = session.listRunResources({
        afterRunId,
        pageSize: 100,
        cutoff: undefined,
        invocationId: undefined,
      });
      resources.push(...page.runs);
      if (page.nextAfterRunId === null) break;
      afterRunId = page.nextAfterRunId;
    }
  }
  const runs = yield* Effect.try({ try: () => loadInspectionRuns(source), catch: inspectionSourceError });
  const runsById = new Map(runs.map((run) => [run.run.runId, run]));
  const manifestsByRun = new Map<string, ReadonlyMap<string, IdentityManifestEntry>>();
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
      lifecycle: undefined,
      members: run.members.map((member) => {
        const stored = physicalBySlot.get(member.slotId);
        const bindingRevision =
          stored !== undefined && "attempt" in stored ? stored.attempt.publication?.bindingRevision : undefined;
        return {
          document: member,
          bindingRevision,
          attempt:
            member.attempt === null
              ? undefined
              : {
                  resolved: resolveInspectionMemberAttempt(runs, run, member),
                  sourceRunId: run.run.runId,
                  action: member.action as "executed" | "carried" | "accepted",
                  publication: published(slots?.get(member.slotId)?.publication),
                },
        };
      }),
    };
  });
  const lifecycleRuns = yield* mergeCurrentAssessmentRuns(assessmentRuns, resources);
  type Attempt = Ref & CurrentAssessmentAttempt;
  const experimentIds = input.experimentIds === undefined ? undefined : new Set(input.experimentIds);
  const assessedTarget =
    experimentIds === undefined
      ? target
      : { ...target, slots: target.slots.filter(({ experimentId }) => experimentIds.has(experimentId)) };
  const assessments = yield* assessCurrentTarget<Ref, Attempt, CurrentResultSource, Error>(assessedTarget, {
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
      Effect.try({
        try: () => {
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
        },
        catch: inspectionSourceError,
      }),
    readIdentityComparison: (run, current) =>
      Effect.try({
        try: () => {
          const runId = run.document.runId;
          const loaded = runsById.get(runId);
          let manifests = manifestsByRun.get(runId);
          if (manifests === undefined) {
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
            manifests = new Map(
              decoded !== undefined && Result.isSuccess(decoded)
                ? decoded.success.entries.map((entry) => [entry.evalId, entry])
                : [],
            );
            manifestsByRun.set(runId, manifests);
          }
          const historical = manifests.get(current.evalId);
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
              historical,
              current: current.identityManifest,
              context: run.document.context,
              source,
            }),
          };
        },
        catch: inspectionSourceError,
      }),
    readActivities: (attempt) =>
      Effect.try({
        try: () => {
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
        },
        catch: inspectionSourceError,
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
    selectionProblemScope: undefined,
  });
  bindProjectInput(source, {
    cutoffIdentity: source.cutoff().identity,
    target,
    assessments,
    runs,
    resources: resources,
  });
  return source;
});

function published(value: ReadableRunResource["slots"][number]["publication"] | undefined) {
  return value?.state === "published" ? value : undefined;
}
