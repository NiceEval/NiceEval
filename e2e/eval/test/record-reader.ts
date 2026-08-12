import { join } from "node:path";
import { Effect, Either, Schema } from "effect";
import {
  AttemptIdSchema,
  makeRecordRoot,
  NodeRecordLive,
  openRecordReader,
} from "niceeval/record";
import {
  attemptOriginRunProjection,
  attemptSlotProjection,
  projectAnalysisSample,
  selectAnalysisSampleForAttempt,
  type ProjectedEntry,
  type ProjectedSample,
  type RecordAttachmentProjector,
  type RecordProjection,
} from "niceeval/projection";

type AttemptProjectionAccess = "attempt-slot" | "attempt-origin-run";
type AttemptAttachmentEntry<
  Access extends AttemptProjectionAccess,
  Value,
> = Extract<ProjectedEntry<Access, Value>, { readonly state: "attachment-result" }>;

function isAttemptAttachmentEntry<
  Access extends AttemptProjectionAccess,
  Value,
>(
  entry: ProjectedEntry<Access, Value>,
): entry is AttemptAttachmentEntry<Access, Value> {
  return entry.state === "attachment-result";
}

function attemptIdFromLocator(locator: string) {
  if (!locator.startsWith("@")) {
    throw new Error(`Expected a current Attempt locator, received ${JSON.stringify(locator)}`);
  }
  const decoded = Schema.decodeUnknownEither(AttemptIdSchema)(locator.slice(1));
  if (Either.isLeft(decoded)) {
    throw new Error(`Eval emitted an invalid current Attempt locator: ${locator}`);
  }
  return decoded.right;
}

/**
 * Resolves an emitted current Attempt locator through the public frozen
 * RecordReader → AnalysisSampleHandle → RecordAttachment projection path.
 */
async function projectAttemptProjection<
  Access extends AttemptProjectionAccess,
  Value,
>(input: {
  readonly root: string;
  readonly locator: string;
  readonly projection: RecordProjection<Access, Value>;
}): Promise<ProjectedSample<Access, Value>> {
  const recordRoot = makeRecordRoot(join(input.root, ".niceeval", "record"));
  if (Either.isLeft(recordRoot)) {
    throw new Error(`Record root rejected the E2E run: ${recordRoot.left.code}`);
  }
  const attemptId = attemptIdFromLocator(input.locator);

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const reader = yield* openRecordReader({ root: recordRoot.right });
        const sampleHandle = yield* selectAnalysisSampleForAttempt({ reader, attemptId });
        return yield* projectAnalysisSample({
          sampleHandle,
          projection: input.projection,
        });
      }),
    ).pipe(Effect.provide(NodeRecordLive)),
  );
}

/** Projects one Attempt-owned Attachment through the selected Attempt Slot. */
export function projectAttemptAttachment<Value>(input: {
  readonly root: string;
  readonly locator: string;
  readonly projector: RecordAttachmentProjector<"attempt", Value>;
}): Promise<ProjectedSample<"attempt-slot", Value>> {
  return projectAttemptProjection({
    root: input.root,
    locator: input.locator,
    projection: attemptSlotProjection(input.projector),
  });
}

/** Projects the origin Run Attachment associated with one selected Attempt. */
export function projectAttemptOriginRunAttachment<Value>(input: {
  readonly root: string;
  readonly locator: string;
  readonly projector: RecordAttachmentProjector<"run", Value>;
}): Promise<ProjectedSample<"attempt-origin-run", Value>> {
  return projectAttemptProjection({
    root: input.root,
    locator: input.locator,
    projection: attemptOriginRunProjection(input.projector),
  });
}

/** A locator resolves to exactly one included Slot; other Run Slots remain excluded. */
export function singleAvailableAttemptAttachment<
  Access extends AttemptProjectionAccess,
  Value,
>(
  projected: ProjectedSample<Access, Value>,
  attachmentName = "Attempt Attachment",
): Value {
  const attachmentEntries = projected.entries.filter(
    isAttemptAttachmentEntry,
  );
  if (attachmentEntries.length !== 1) {
    throw new Error(
      `Expected one projected Attachment result for the locator, received ${attachmentEntries.length}`,
    );
  }
  const entry = attachmentEntries[0];
  if (entry === undefined) {
    throw new Error(`Attempt locator did not resolve to ${attachmentName}`);
  }
  if (entry.attachment.state !== "available") {
    throw new Error(`${attachmentName} read as ${entry.attachment.state}`);
  }
  return entry.attachment.value;
}
