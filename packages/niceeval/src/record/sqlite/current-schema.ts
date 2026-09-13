import { RECORD_SQLITE_017_BASELINE_SQL } from "./legacy-schema-017.ts";

/**
 * Exact current ProjectDatabase 0.18 schema. The 0.18 namespace is disjoint
 * from every 0.17 writable object so stale prepared writers cannot cross the
 * migration commit boundary.
 */
export const RECORD_SQLITE_BASELINE_SQL = RECORD_SQLITE_017_BASELINE_SQL.replaceAll(/\bne_/gu, "ne18_");
