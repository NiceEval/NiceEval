import { Effect } from "effect";
import { canonicalJsonBytes, compareCanonicalBytes } from "../protocol/canonical.ts";
import {
  RadixNibbleV1Schema,
  RadixPathV1Schema,
  decodeProtocolSchema,
  sha256DigestOfBytes,
  type RadixNibbleV1,
  type RadixPathV1,
  type RecordProtocolError,
} from "../protocol/core.ts";
import type { CanonicalRadixKeyContract } from "./radix.ts";

const UTF8_ENCODER = new TextEncoder();
const RADIX_NIBBLE_INPUTS = Object.freeze([
  "0", "1", "2", "3", "4", "5", "6", "7",
  "8", "9", "a", "b", "c", "d", "e", "f",
]);

/** SHA-256(JCS(preimage)) without the digest algorithm prefix, validated as a 64-nibble path. */
export function radixPathForCanonicalPreimageV1(
  preimage: unknown,
): Effect.Effect<RadixPathV1, RecordProtocolError> {
  return canonicalJsonBytes(preimage).pipe(
    Effect.flatMap(sha256DigestOfBytes),
    Effect.flatMap((digest) =>
      decodeProtocolSchema(
        RadixPathV1Schema,
        digest.slice("sha256:".length),
        "derive-radix-path",
      )
    ),
  );
}

/** Builds the frozen v1 key grammar through protocol schemas instead of manufacturing brands. */
export function canonicalRadixKeyContractV1(): Effect.Effect<
  CanonicalRadixKeyContract,
  RecordProtocolError
> {
  return Effect.gen(function* () {
    const nibbles: RadixNibbleV1[] = [];
    for (const input of RADIX_NIBBLE_INPUTS) {
      nibbles.push(yield* decodeProtocolSchema(
        RadixNibbleV1Schema,
        input,
        "build-radix-key-contract",
      ));
    }
    return Object.freeze({
      length: 64,
      nibbles: Object.freeze(nibbles),
      compare: compareRadixPathsV1,
    });
  });
}

/** Radix paths are ASCII hex, so protocol's byte comparator is their canonical ordering. */
export function compareRadixPathsV1(left: string, right: string): number {
  return compareCanonicalBytes(UTF8_ENCODER.encode(left), UTF8_ENCODER.encode(right));
}
