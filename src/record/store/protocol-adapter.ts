// Store 对 frozen protocol 的唯一适配点。这里仅把 protocol worker 已稳定提供的 descriptor、
// marker 与 Layout codec 接到本地文件 backend；不重新声明 Descriptor / Layout 的结构。

import { Buffer } from "node:buffer";
import { Effect } from "effect";
import {
  LayoutV2Schema,
  RecordGraphRefV1Schema,
  StoreFormatMarkerV1Schema,
  decodeDescriptorV1,
  decodeProtocolSchema,
  typedReferenceIdentityBytes,
  verifyTypedObjectDescriptor,
  type DescriptorV1,
  type LayoutV2,
  type RecordGraphRef,
} from "../protocol/core.ts";
import { canonicalJsonBytes, decodeCanonicalJsonBytes } from "../protocol/canonical.ts";
import { RecordProtocolError } from "../protocol/errors.ts";
import type { LocalObjectProtocol, LocalObjectVerification } from "./objects.ts";
import type { LocalStagingProtocol } from "./staging.ts";

export type ProtocolDecodeResult<A> =
  | { readonly state: "valid"; readonly value: A }
  | { readonly state: "invalid"; readonly detail: string };

function protocolDetail(cause: unknown): string {
  return cause instanceof RecordProtocolError ? cause.message : "protocol codec rejected the value";
}

function attempt<A>(effect: Effect.Effect<A, RecordProtocolError>): ProtocolDecodeResult<A> {
  try {
    return { state: "valid", value: Effect.runSync(effect) };
  } catch (cause) {
    return { state: "invalid", detail: protocolDetail(cause) };
  }
}

function descriptorAddress(descriptor: DescriptorV1): string | undefined {
  const decoded = attempt(decodeDescriptorV1(descriptor, "local-store-object-address"));
  return decoded.state === "valid" ? decoded.value.digest.slice("sha256:".length) : undefined;
}

function verifyDescriptorBytes(
  descriptor: DescriptorV1,
  bytes: Uint8Array,
): LocalObjectVerification {
  const result = attempt(verifyTypedObjectDescriptor(descriptor, bytes));
  return result.state === "valid" ? { state: "valid" } : { state: "invalid", detail: result.detail };
}

/**
 * Full typed identity is JCS descriptor bytes, not digest-only. It is used by staging / pin maps
 * and mirrors graph's same deduplication rule.
 */
function descriptorIdentity(descriptor: DescriptorV1): string {
  const result = attempt(typedReferenceIdentityBytes(descriptor));
  if (result.state === "invalid") {
    throw new RecordProtocolError({
      code: "descriptor-invalid",
      operation: "local-store-reference-key",
      path: [],
      message: result.detail,
    });
  }
  return Buffer.from(result.value).toString("base64");
}

export const localDescriptorProtocol: LocalObjectProtocol<DescriptorV1> = Object.freeze({
  objectAddress: descriptorAddress,
  verifyObject: verifyDescriptorBytes,
});

export const localStagingProtocol: LocalStagingProtocol<DescriptorV1> = Object.freeze({
  referenceKey: descriptorIdentity,
  encodeReference: (reference: DescriptorV1): unknown => Object.freeze({
    mediaType: reference.mediaType,
    digest: reference.digest,
    size: reference.size,
  }),
  decodeReference: (value: unknown): DescriptorV1 | undefined => {
    const decoded = attempt(decodeDescriptorV1(value, "decode-local-store-reference"));
    return decoded.state === "valid" ? decoded.value : undefined;
  },
});

/** Read leases persist a frozen RecordGraphRef through the protocol decoder, never a local clone. */
export interface LocalReadLeaseProtocol {
  readonly encodeRecordGraphRef: (reference: RecordGraphRef) => unknown;
  readonly decodeRecordGraphRef: (value: unknown) => RecordGraphRef | undefined;
}

export const localReadLeaseProtocol: LocalReadLeaseProtocol = Object.freeze({
  encodeRecordGraphRef: (reference: RecordGraphRef): unknown => {
    const decoded = attempt(decodeProtocolSchema(RecordGraphRefV1Schema, reference, "encode-local-read-lease-ref"));
    if (decoded.state === "invalid") {
      throw new RecordProtocolError({
        code: "schema-invalid",
        operation: "encode-local-read-lease-ref",
        path: [],
        message: decoded.detail,
      });
    }
    return Object.freeze({
      recordId: decoded.value.recordId,
      graph: Object.freeze({
        mediaType: decoded.value.graph.mediaType,
        digest: decoded.value.graph.digest,
        size: decoded.value.graph.size,
      }),
    });
  },
  decodeRecordGraphRef: (value: unknown): RecordGraphRef | undefined => {
    const decoded = attempt(decodeProtocolSchema(RecordGraphRefV1Schema, value, "decode-local-read-lease-ref"));
    return decoded.state === "valid" ? decoded.value : undefined;
  },
});

/** Exact JCS marker bytes; an ordinary JSON equivalent is deliberately not accepted on open. */
export function localStoreMarkerBytes(): Uint8Array {
  const marker = attempt(
    decodeProtocolSchema(
      StoreFormatMarkerV1Schema,
      {
        schema: "niceeval.record-store-marker/1",
        format: "niceeval.record-store",
        version: 1,
      },
      "encode-local-store-marker",
    ).pipe(Effect.flatMap((value) => canonicalJsonBytes(value))),
  );
  if (marker.state === "invalid") {
    throw new RecordProtocolError({
      code: "schema-invalid",
      operation: "encode-local-store-marker",
      path: [],
      message: marker.detail,
    });
  }
  return marker.value;
}

export function decodeLocalStoreMarker(bytes: Uint8Array): ProtocolDecodeResult<void> {
  const decoded = attempt(
    decodeCanonicalJsonBytes(bytes).pipe(
      Effect.flatMap((value) => decodeProtocolSchema(StoreFormatMarkerV1Schema, value, "decode-local-store-marker")),
      Effect.asVoid,
    ),
  );
  return decoded;
}

export function encodeLocalLayout(layout: LayoutV2): ProtocolDecodeResult<Uint8Array> {
  return attempt(
    decodeProtocolSchema(LayoutV2Schema, layout, "encode-local-store-layout").pipe(
      Effect.flatMap((value) => canonicalJsonBytes(value)),
    ),
  );
}

export function decodeLocalLayout(bytes: Uint8Array): ProtocolDecodeResult<LayoutV2> {
  return attempt(
    decodeCanonicalJsonBytes(bytes).pipe(
      Effect.flatMap((value) => decodeProtocolSchema(LayoutV2Schema, value, "decode-local-store-layout")),
    ),
  );
}
