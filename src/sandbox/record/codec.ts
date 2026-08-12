import { Schema } from "effect";
import {
  PositiveSafeIntegerV1Schema,
  SafeIdentifierV1Schema,
} from "../../o11y/record/codec.ts";
import {
  isSourceNativeSandboxIdV1,
  type SandboxAssignedPayloadV1,
  type SandboxAttachmentPayloadV1,
  type SandboxFreshReuseV1,
  type SandboxNotUsedPayloadV1,
  type SandboxPooledReuseV1,
  type SandboxReuseV1,
  type SourceNativeSandboxIdV1,
} from "./model.ts";

/** All Sandbox Attachment payloads aggregate errors and reject extra fields. */
export const SandboxAttachmentExactParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

export const SourceNativeSandboxIdV1Schema: Schema.Schema<
  SourceNativeSandboxIdV1,
  string
> = Schema.String.pipe(
  Schema.filter(isSourceNativeSandboxIdV1, {
    identifier: "SourceNativeSandboxIdV1",
    description: "a non-empty source-native safe UTF-8 sandbox id no longer than 256 bytes",
  }),
  Schema.brand("@niceeval/sandbox/SourceNativeSandboxIdV1"),
);

type SandboxFreshReuseV1Encoded = {
  readonly kind: "fresh";
};

type SandboxPooledReuseV1Encoded = {
  readonly kind: "pooled";
  readonly sandbox: number;
  readonly ordinal: number;
};

type SandboxReuseV1Encoded =
  | SandboxFreshReuseV1Encoded
  | SandboxPooledReuseV1Encoded;

type SandboxNotUsedPayloadV1Encoded = {
  readonly state: "not-used";
};

type SandboxAssignedPayloadV1Encoded = {
  readonly state: "assigned";
  readonly provider: string;
  readonly sandboxId: string;
  readonly reuse: SandboxReuseV1Encoded;
};

type SandboxAttachmentPayloadV1Encoded =
  | SandboxNotUsedPayloadV1Encoded
  | SandboxAssignedPayloadV1Encoded;

const SandboxFreshReuseV1Schema: Schema.Schema<
  SandboxFreshReuseV1,
  SandboxFreshReuseV1Encoded
> = Schema.Struct({
  kind: Schema.Literal("fresh"),
});

const SandboxPooledReuseV1Schema: Schema.Schema<
  SandboxPooledReuseV1,
  SandboxPooledReuseV1Encoded
> = Schema.Struct({
  kind: Schema.Literal("pooled"),
  sandbox: PositiveSafeIntegerV1Schema,
  ordinal: PositiveSafeIntegerV1Schema,
});

const SandboxReuseV1Schema: Schema.Schema<SandboxReuseV1, SandboxReuseV1Encoded> =
  Schema.Union(SandboxFreshReuseV1Schema, SandboxPooledReuseV1Schema);

const SandboxNotUsedPayloadV1Schema: Schema.Schema<
  SandboxNotUsedPayloadV1,
  SandboxNotUsedPayloadV1Encoded
> = Schema.Struct({
  state: Schema.Literal("not-used"),
});

const SandboxAssignedPayloadV1Schema: Schema.Schema<
  SandboxAssignedPayloadV1,
  SandboxAssignedPayloadV1Encoded
> = Schema.Struct({
  state: Schema.Literal("assigned"),
  provider: SafeIdentifierV1Schema,
  sandboxId: SourceNativeSandboxIdV1Schema,
  reuse: SandboxReuseV1Schema,
});

/** Exact durable schema for `niceeval.sandbox/v1`. */
export const SandboxAttachmentPayloadV1Schema: Schema.Schema<
  SandboxAttachmentPayloadV1,
  SandboxAttachmentPayloadV1Encoded
> = Schema.Union(
  SandboxNotUsedPayloadV1Schema,
  SandboxAssignedPayloadV1Schema,
);
