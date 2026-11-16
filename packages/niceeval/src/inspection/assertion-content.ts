import * as Schema from "effect/Schema";

/** Stable reference to complete Assertion Content within one Attempt. */
export const AssertionContentReferenceSchema = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  byteLength: Schema.Number.check(Schema.makeFilter(Number.isSafeInteger), Schema.isGreaterThanOrEqualTo(0)),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});
