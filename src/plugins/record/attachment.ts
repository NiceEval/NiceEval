import { Either } from "effect";
import {
  defineRecordAttachmentFamily,
  type JsonRecordAttachmentDefinition,
  type RecordAttachmentFamily,
  type RecordAttachmentPayloadSnapshot,
  type RecordAttachmentValue,
} from "../../record/attachment/index.ts";
import { defineBuiltinJsonRecordAttachment } from "../../record/attachment/internal.ts";
import {
  AttemptPluginProvenanceV1Schema,
  RunPluginProvenanceV1Schema,
  decodeAttemptPluginProvenanceV1,
  decodeRunPluginProvenanceV1,
} from "./codec.ts";
import type {
  AttemptPluginProvenanceV1,
  RunPluginProvenanceV1,
} from "./model.ts";

export const PLUGIN_PROVENANCE_ATTACHMENT_NAME_V1 =
  "niceeval.plugin-provenance" as const;
export const PLUGIN_PROVENANCE_ATTACHMENT_SCHEMA_ID_V1 =
  "niceeval.plugin-provenance/v1" as const;

function expectDefinition<Owner extends "run" | "attempt", Payload>(
  result: Either.Either<
    JsonRecordAttachmentDefinition<Owner, Payload>,
    { readonly code: string }
  >,
): JsonRecordAttachmentDefinition<Owner, Payload> {
  if (Either.isLeft(result)) {
    throw new Error(`Plugin provenance Attachment definition invariant failed: ${result.left.code}`);
  }
  return result.right;
}

function expectFamily<Owner extends "run" | "attempt", Payload>(
  result: Either.Either<
    RecordAttachmentFamily<Owner, Payload>,
    { readonly code: string }
  >,
): RecordAttachmentFamily<Owner, Payload> {
  if (Either.isLeft(result)) {
    throw new Error(`Plugin provenance Attachment family invariant failed: ${result.left.code}`);
  }
  return result.right;
}

/** Framework-owned Run Attachment definition; Plugins cannot define `niceeval.*`. */
export const RunPluginProvenanceV1Definition: JsonRecordAttachmentDefinition<
  "run",
  RunPluginProvenanceV1
> = expectDefinition<"run", RunPluginProvenanceV1>(
  defineBuiltinJsonRecordAttachment({
    owner: "run",
    name: PLUGIN_PROVENANCE_ATTACHMENT_NAME_V1,
    schemaId: PLUGIN_PROVENANCE_ATTACHMENT_SCHEMA_ID_V1,
    schema: RunPluginProvenanceV1Schema,
    blobRefs: () => [],
  }),
);

/** Framework-owned Attempt Attachment definition; it is deliberately a separate exact schema. */
export const AttemptPluginProvenanceV1Definition: JsonRecordAttachmentDefinition<
  "attempt",
  AttemptPluginProvenanceV1
> = expectDefinition<"attempt", AttemptPluginProvenanceV1>(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: PLUGIN_PROVENANCE_ATTACHMENT_NAME_V1,
    schemaId: PLUGIN_PROVENANCE_ATTACHMENT_SCHEMA_ID_V1,
    schema: AttemptPluginProvenanceV1Schema,
    blobRefs: () => [],
  }),
);

export const RunPluginProvenanceV1Family: RecordAttachmentFamily<
  "run",
  RunPluginProvenanceV1
> = expectFamily<"run", RunPluginProvenanceV1>(
  defineRecordAttachmentFamily({
    current: RunPluginProvenanceV1Definition,
    migrations: [],
  }),
);

export const AttemptPluginProvenanceV1Family: RecordAttachmentFamily<
  "attempt",
  AttemptPluginProvenanceV1
> = expectFamily<"attempt", AttemptPluginProvenanceV1>(
  defineRecordAttachmentFamily({
    current: AttemptPluginProvenanceV1Definition,
    migrations: [],
  }),
);

/** A projector is synchronous and only reads the already-materialized snapshot. */
export function projectRunPluginProvenanceV1(
  value: RecordAttachmentValue<RunPluginProvenanceV1>,
): RecordAttachmentPayloadSnapshot<RunPluginProvenanceV1> {
  if (Either.isLeft(decodeRunPluginProvenanceV1(value.payload))) {
    throw new Error("An available Run Plugin provenance Attachment failed its exact decoder.");
  }
  return value.payload;
}

/** A projector is synchronous and only reads the already-materialized snapshot. */
export function projectAttemptPluginProvenanceV1(
  value: RecordAttachmentValue<AttemptPluginProvenanceV1>,
): RecordAttachmentPayloadSnapshot<AttemptPluginProvenanceV1> {
  if (Either.isLeft(decodeAttemptPluginProvenanceV1(value.payload))) {
    throw new Error("An available Attempt Plugin provenance Attachment failed its exact decoder.");
  }
  return value.payload;
}
