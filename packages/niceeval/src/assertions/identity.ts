import type { Brand } from "effect";

/** Stable identity shared by Assertion producers, durable records, and readers. */
export const ASSERTION_ENTRY_ID_BRAND =
  "@niceeval/assertions/AssertionEntryId" as const;

/** Identifies an assertion within one Attempt attachment; it is not derived from labels and is not stable across Attempts. */
export type AssertionEntryId =
  string & Brand.Brand<typeof ASSERTION_ENTRY_ID_BRAND>;
