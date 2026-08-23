import { Effect, Either, ParseResult, Schema } from "effect";

import { recordAttachmentMigration } from "../../../attachment/index.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import {
  AssertionsAttachmentSchema,
  type AssertionsAttachment,
  type AssertionsAttachmentV1,
} from "../schema.ts";
import { assertionsV1, assertionsV2 } from "../version.ts";

/** Pure logical transform shared by the branded SPI and the current Host bridge. */
export function migrateAssertionsV1Value(
  previous: AssertionsAttachmentV1,
): AssertionsAttachment {
  const migrated = Object.freeze({
    entries: Object.freeze(previous.entries.map((entry) => Object.freeze({
      entryId: entry.entryId,
      display: entry.display,
      criterion: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
      materials: Object.freeze({
        source: Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" as const }),
        evidence: Object.freeze([]),
        coverage: Object.freeze({ state: "unavailable" as const, reason: "not-collected" as const }),
        limitations: Object.freeze([]),
      }),
      evaluation: Object.freeze({
        observed: Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" as const }),
      }),
      decision: Object.freeze({
        result: entry.result.state,
        reason: "reason" in entry.result ? entry.result.reason : null,
        gate: entry.result.gate,
      }),
      policy: Object.freeze({
        requirement: entry.result.gate === "not-gate"
          ? Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const })
          : Object.freeze({ state: "available" as const, value: "required" as const }),
        condition: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
      }),
      contribution: entry.result.score,
      explanationRetention: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
    }))),
    sourceSites: previous.sourceSites,
  });
  const validated = Schema.validateEither(
    AssertionsAttachmentSchema,
    RecordExactParseOptions,
  )(migrated);
  if (Either.isLeft(validated)) {
    throw new Error(
      `Assertions v1 migration did not produce a current payload: ${ParseResult.TreeFormatter.formatErrorSync(validated.left)}`,
    );
  }
  return validated.right;
}

export const assertionsV1ToV2 = recordAttachmentMigration({
  from: assertionsV1,
  to: assertionsV2,
  migrate: (input) => Effect.sync(() => Object.freeze({
    value: migrateAssertionsV1Value(input.value),
    sources: Object.freeze([]),
  })),
});
