import type { Brand } from "effect";
import {
  isSafeTextV1,
  utf8ByteLengthV1,
  type PositiveSafeInteger,
  type SafeIdentifier,
} from "../../o11y/record/model.ts";

/** The durable bound for a provider-native Sandbox identifier. */
export const MAX_SOURCE_NATIVE_SANDBOX_ID_UTF8_BYTES_V1 = 256;

export const SOURCE_NATIVE_SANDBOX_ID_V1_BRAND =
  "@niceeval/sandbox/SourceNativeSandboxIdV1" as const;

/** A provider-issued identifier preserved verbatim after safe UTF-8 validation. */
export type SourceNativeSandboxIdV1 = string & Brand.Brand<
  typeof SOURCE_NATIVE_SANDBOX_ID_V1_BRAND
>;

export interface SandboxFreshReuseV1 {
  readonly kind: "fresh";
}

export interface SandboxPooledReuseV1 {
  readonly kind: "pooled";
  readonly sandbox: PositiveSafeInteger;
  readonly ordinal: PositiveSafeInteger;
}

export type SandboxReuseV1 = SandboxFreshReuseV1 | SandboxPooledReuseV1;

export interface SandboxNotUsedPayloadV1 {
  readonly state: "not-used";
}

export interface SandboxAssignedPayloadV1 {
  readonly state: "assigned";
  readonly provider: SafeIdentifier;
  readonly sandboxId: SourceNativeSandboxIdV1;
  readonly reuse: SandboxReuseV1;
}

/** The exact durable payload for the Attempt-owned `niceeval.sandbox/v1` family. */
export type SandboxAttachmentPayloadV1 =
  | SandboxNotUsedPayloadV1
  | SandboxAssignedPayloadV1;

/**
 * Sandbox IDs are source-native, so their punctuation and case remain intact.
 * They cannot contain control characters or newlines that would reshape a
 * durable display, and they must round-trip through strict UTF-8.
 */
export function isSourceNativeSandboxIdV1(
  value: string,
): value is SourceNativeSandboxIdV1 {
  return (
    value.length > 0
    && !value.includes("\n")
    && isSafeTextV1(value)
    && utf8ByteLengthV1(value) <= MAX_SOURCE_NATIVE_SANDBOX_ID_UTF8_BYTES_V1
  );
}
