import { Schema } from "effect";
import {
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
} from "../../record/family/source-receipt/codec.ts";
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

export const SourceNativeSandboxIdSchema: Schema.Codec<
  SourceNativeSandboxId,
  string
> = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isSourceNativeSandboxId, {
    identifier: "SourceNativeSandboxId",
    description: "a non-empty source-native safe UTF-8 sandbox id no longer than 256 bytes",
  })),
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

const SandboxFreshReuseSchema: Schema.Codec<
  SandboxFreshReuse,
  SandboxFreshReuseEncoded
> = Schema.Struct({
  kind: Schema.Literal("fresh"),
});

const SandboxPooledReuseSchema: Schema.Codec<
  SandboxPooledReuse,
  SandboxPooledReuseEncoded
> = Schema.Struct({
  kind: Schema.Literal("pooled"),
  sandbox: PositiveSafeIntegerSchema,
  ordinal: PositiveSafeIntegerSchema,
});

const SandboxReuseSchema: Schema.Codec<SandboxReuse, SandboxReuseEncoded> =
  Schema.Union([SandboxFreshReuseSchema, SandboxPooledReuseSchema]);

const SandboxNotUsedPayloadSchema: Schema.Codec<
  SandboxNotUsedPayload,
  SandboxNotUsedPayloadEncoded
> = Schema.Struct({
  state: Schema.Literal("not-used"),
});

const SandboxAssignedPayloadSchema: Schema.Codec<
  SandboxAssignedPayload,
  SandboxAssignedPayloadEncoded
> = Schema.Struct({
  state: Schema.Literal("assigned"),
  provider: SafeIdentifierSchema,
  sandboxId: SourceNativeSandboxIdSchema,
  reuse: SandboxReuseSchema,
});

/** Exact transient capture schema; it is never a Record Attachment payload. */
export const SandboxAttachmentPayloadSchema: Schema.Codec<
  SandboxAttachmentPayload,
  SandboxAttachmentPayloadEncoded
> = Schema.Union([SandboxNotUsedPayloadSchema, SandboxAssignedPayloadSchema]);
