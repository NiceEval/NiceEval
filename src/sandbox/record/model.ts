import type { Brand } from "effect";
import {
  isSafeText,
  utf8ByteLength,
  type PositiveSafeInteger,
  type SafeIdentifier,
} from "../../o11y/record/model.ts";

/** The durable bound for a provider-native Sandbox identifier. */
export const MAX_SOURCE_NATIVE_SANDBOX_ID_UTF8_BYTES = 256;

export const SOURCE_NATIVE_SANDBOX_ID__BRAND =
  "@niceeval/sandbox/SourceNativeSandboxId" as const;

/** A provider-issued identifier preserved verbatim after safe UTF-8 validation. */
export type SourceNativeSandboxId = string & Brand.Brand<
  typeof SOURCE_NATIVE_SANDBOX_ID__BRAND
>;

export interface SandboxFreshReuse {
  readonly kind: "fresh";
}

export interface SandboxPooledReuse {
  readonly kind: "pooled";
  readonly sandbox: PositiveSafeInteger;
  readonly ordinal: PositiveSafeInteger;
}

export type SandboxReuse = SandboxFreshReuse | SandboxPooledReuse;

export interface SandboxNotUsedPayload {
  readonly state: "not-used";
}

export interface SandboxAssignedPayload {
  readonly state: "assigned";
  readonly provider: SafeIdentifier;
  readonly sandboxId: SourceNativeSandboxId;
  readonly reuse: SandboxReuse;
}

/** Transient sandbox assignment facts used while producing File Changes. */
export type SandboxAttachmentPayload =
  | SandboxNotUsedPayload
  | SandboxAssignedPayload;

/**
 * Sandbox IDs are source-native, so their punctuation and case remain intact.
 * They cannot contain control characters or newlines that would reshape a
 * durable display, and they must round-trip through strict UTF-8.
 */
export function isSourceNativeSandboxId(
  value: string,
): value is SourceNativeSandboxId {
  return (
    value.length > 0
    && !value.includes("\n")
    && isSafeText(value)
    && utf8ByteLength(value) <= MAX_SOURCE_NATIVE_SANDBOX_ID_UTF8_BYTES
  );
}
