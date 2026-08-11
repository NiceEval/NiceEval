import type { Effect } from "effect";
import type { RecordFormatId } from "../model/identifiers.ts";

/**
 * A trusted Core converter changes one in-memory Core snapshot between adjacent
 * majors. It is intentionally generic: the current v1 registry needs zero
 * edges, while a later v2/v3 release can add only v1→v2 and v2→v3 steps.
 */
export interface RecordCoreMigrationEdge<CoreValue> {
  readonly from: RecordFormatId;
  readonly to: RecordFormatId;
  readonly convert: (
    source: CoreValue,
  ) => Effect.Effect<CoreValue, unknown, never>;
}

export interface RecordCoreMigrationRegistryInput<CoreValue> {
  readonly currentFormat: RecordFormatId;
  readonly edges: readonly RecordCoreMigrationEdge<CoreValue>[];
}
