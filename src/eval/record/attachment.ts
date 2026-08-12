import { Either, Schema } from "effect";
import {
  makeRecordAttachmentWrite,
  validateRecordAttachmentWrite,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentFamily,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import type { RecordAttachmentOwner } from "../../record/model/core.ts";

/**
 * Every RecordAttachment payload is decoded as an exact JSON object. Keep this
 * option next to the producer-owned payload schemas so their direct checks use
 * the same boundary as the future RecordAttachment definition.
 */
export const ExactRecordAttachmentParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

/** A path-derived Eval or Experiment identity kept in an Attachment payload. */
export const EvaluationRecordIdentitySchema = Schema.String.pipe(
  Schema.filter(
    (value) => value.length > 0 && !value.includes("\u0000"),
    {
      identifier: "EvaluationRecordIdentity",
      description: "a non-empty identity string without NUL",
    },
  ),
);

/** Shared numeric boundary for sealed points and durable earned-score values. */
export const FiniteNonNegativeNumberV1Schema = Schema.Number.pipe(
  Schema.finite(),
  Schema.nonNegative(),
);

export type FiniteNonNegativeNumberV1 = Schema.Schema.Type<
  typeof FiniteNonNegativeNumberV1Schema
>;

/**
 * Built-in Attachment payloads in this directory never own blobs. This is an
 * input fragment for the Record Attachment API, not an Attachment runtime.
 */
export function noRecordAttachmentBlobs(): readonly [] {
  return [];
}

/**
 * The empty builder collection carries `never` in its element type so
 * RecordAttachment's generic write derives no blob errors or requirements.
 */
const noRecordAttachmentBlobDraftsV1: readonly RecordAttachmentBlobDraft<
  never,
  never
>[] = Object.freeze([]);

/** A built-in definition/family failure is a package construction defect. */
export function requireRecordAttachmentCapabilityV1<Result, Failure>(
  result: Either.Either<Result, Failure>,
  message: string,
): Result {
  if (Either.isLeft(result)) {
    throw new Error(message);
  }
  return result.right;
}

/**
 * Connects an already-built payload to Record's real opaque write capability.
 * These three business Attachments never project blob refs, so closure
 * validation is still executed through Record rather than reimplemented here.
 */
export function makeNoBlobRecordAttachmentWriteV1<
  Owner extends RecordAttachmentOwner,
  Payload,
>(
  family: RecordAttachmentFamily<Owner, Payload>,
  payload: Payload,
): RecordAttachmentWrite<Owner, never, never> {
  const write = makeRecordAttachmentWrite<
    Owner,
    Payload,
    typeof noRecordAttachmentBlobDraftsV1
  >(
    family,
    () => ({
      payload,
      blobs: noRecordAttachmentBlobDraftsV1,
    }),
  );
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) {
    throw new Error("A no-blob Evaluation RecordAttachment write was invalid");
  }
  return write;
}
