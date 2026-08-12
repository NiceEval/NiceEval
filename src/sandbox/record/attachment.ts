import { Either } from "effect";
import {
  decodeJsonRecordAttachmentPayload,
  defineRecordAttachmentFamily,
  makeRecordAttachmentWrite,
  validateRecordAttachmentWrite,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentFamily,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import { defineBuiltinJsonRecordAttachment } from "../../record/attachment/internal.ts";
import { SandboxAttachmentPayloadV1Schema } from "./codec.ts";
import type {
  SandboxAttachmentPayloadV1,
  SandboxReuseV1,
} from "./model.ts";

/** The public input is a domain fact, never a raw Record envelope or payload. */
export type SandboxAttachmentInput =
  | { readonly state: "not-used" }
  | {
      readonly state: "assigned";
      readonly provider: string;
      readonly sandboxId: string;
      readonly reuse:
        | { readonly kind: "fresh" }
        | {
            readonly kind: "pooled";
            readonly sandbox: number;
            readonly ordinal: number;
          };
    };

export type SandboxAttachmentWriteError = {
  readonly code: "sandbox-attachment-input-invalid";
};

const SANDBOX_ATTACHMENT_NAME = "niceeval.sandbox" as const;
const SANDBOX_ATTACHMENT_SCHEMA_ID = "niceeval.sandbox/v1" as const;
const noSandboxAttachmentBlobDrafts: readonly RecordAttachmentBlobDraft<
  never,
  never
>[] = Object.freeze([]);
const sandboxAttachmentInputInvalid: SandboxAttachmentWriteError = Object.freeze({
  code: "sandbox-attachment-input-invalid" as const,
});

function requireAttachmentCapability<Result, Failure>(
  result: Either.Either<Result, Failure>,
  message: string,
): Result {
  if (Either.isLeft(result)) throw new Error(message);
  return result.right;
}

/** Package-owned definition for the sole Attempt-owned Sandbox fact. */
export const sandboxAttachmentDefinition = requireAttachmentCapability(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: SANDBOX_ATTACHMENT_NAME,
    schemaId: SANDBOX_ATTACHMENT_SCHEMA_ID,
    schema: SandboxAttachmentPayloadV1Schema,
    blobRefs: () => Object.freeze([]),
  }),
  "Sandbox RecordAttachment definition must be valid",
);

/** The current family has no legacy compatibility or alternate durable schema. */
export const sandboxAttachmentFamily: RecordAttachmentFamily<
  "attempt",
  SandboxAttachmentPayloadV1
> = requireAttachmentCapability(
  defineRecordAttachmentFamily({
    current: sandboxAttachmentDefinition,
    migrations: [],
  }),
  "Sandbox RecordAttachment family must be valid",
);

function freezeReuse(reuse: SandboxReuseV1): SandboxReuseV1 {
  return reuse.kind === "fresh"
    ? Object.freeze({ kind: "fresh" as const })
    : Object.freeze({
        kind: "pooled" as const,
        sandbox: reuse.sandbox,
        ordinal: reuse.ordinal,
      });
}

/** Copy decoded fields into the package-owned shape before retaining a write. */
function freezePayload(
  payload: SandboxAttachmentPayloadV1,
): SandboxAttachmentPayloadV1 {
  return payload.state === "not-used"
    ? Object.freeze({ state: "not-used" as const })
    : Object.freeze({
        state: "assigned" as const,
        provider: payload.provider,
        sandboxId: payload.sandboxId,
        reuse: freezeReuse(payload.reuse),
      });
}

/**
 * Creates the sole zero-blob write for one actual Attempt. Invalid, missing,
 * or extra input never becomes a durable `not-used` claim.
 */
export function createSandboxAttachmentWrite(
  input: SandboxAttachmentInput,
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  SandboxAttachmentWriteError
> {
  const decoded = decodeJsonRecordAttachmentPayload(
    sandboxAttachmentDefinition,
    input,
  );
  if (Either.isLeft(decoded)) return Either.left(sandboxAttachmentInputInvalid);

  const payload = freezePayload(decoded.right);
  const write = makeRecordAttachmentWrite(sandboxAttachmentFamily, () =>
    Object.freeze({
      payload,
      blobs: noSandboxAttachmentBlobDrafts,
    }),
  );
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) {
    throw new Error("Sandbox RecordAttachment write violated its zero-blob closure");
  }
  return Either.right(write);
}
