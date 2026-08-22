import { Schema } from "effect";
import {
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
} from "../../o11y/record/codec.ts";
import {
  isSourceNativeSandboxId,
  type SandboxAssignedPayload,
  type SandboxAttachmentPayload,
  type SandboxFreshReuse,
  type SandboxNotUsedPayload,
  type SandboxPooledReuse,
  type SandboxReuse,
  type SourceNativeSandboxId,
} from "./model.ts";

/** Sandbox capture values aggregate errors and reject extra fields. */
export const SandboxAttachmentExactParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

export const SourceNativeSandboxIdSchema: Schema.Schema<
  SourceNativeSandboxId,
  string
> = Schema.String.pipe(
  Schema.filter(isSourceNativeSandboxId, {
    identifier: "SourceNativeSandboxId",
    description: "a non-empty source-native safe UTF-8 sandbox id no longer than 256 bytes",
  }),
  Schema.brand("@niceeval/sandbox/SourceNativeSandboxId"),
);

type SandboxFreshReuseEncoded = {
  readonly kind: "fresh";
};

type SandboxPooledReuseEncoded = {
  readonly kind: "pooled";
  readonly sandbox: number;
  readonly ordinal: number;
};

type SandboxReuseEncoded =
  | SandboxFreshReuseEncoded
  | SandboxPooledReuseEncoded;

type SandboxNotUsedPayloadEncoded = {
  readonly state: "not-used";
};

type SandboxAssignedPayloadEncoded = {
  readonly state: "assigned";
  readonly provider: string;
  readonly sandboxId: string;
  readonly reuse: SandboxReuseEncoded;
};

type SandboxAttachmentPayloadEncoded =
  | SandboxNotUsedPayloadEncoded
  | SandboxAssignedPayloadEncoded;

const SandboxFreshReuseSchema: Schema.Schema<
  SandboxFreshReuse,
  SandboxFreshReuseEncoded
> = Schema.Struct({
  kind: Schema.Literal("fresh"),
});

const SandboxPooledReuseSchema: Schema.Schema<
  SandboxPooledReuse,
  SandboxPooledReuseEncoded
> = Schema.Struct({
  kind: Schema.Literal("pooled"),
  sandbox: PositiveSafeIntegerSchema,
  ordinal: PositiveSafeIntegerSchema,
});

const SandboxReuseSchema: Schema.Schema<SandboxReuse, SandboxReuseEncoded> =
  Schema.Union(SandboxFreshReuseSchema, SandboxPooledReuseSchema);

const SandboxNotUsedPayloadSchema: Schema.Schema<
  SandboxNotUsedPayload,
  SandboxNotUsedPayloadEncoded
> = Schema.Struct({
  state: Schema.Literal("not-used"),
});

const SandboxAssignedPayloadSchema: Schema.Schema<
  SandboxAssignedPayload,
  SandboxAssignedPayloadEncoded
> = Schema.Struct({
  state: Schema.Literal("assigned"),
  provider: SafeIdentifierSchema,
  sandboxId: SourceNativeSandboxIdSchema,
  reuse: SandboxReuseSchema,
});

/** Exact transient capture schema; it is never a Record Attachment payload. */
export const SandboxAttachmentPayloadSchema: Schema.Schema<
  SandboxAttachmentPayload,
  SandboxAttachmentPayloadEncoded
> = Schema.Union(
  SandboxNotUsedPayloadSchema,
  SandboxAssignedPayloadSchema,
);
