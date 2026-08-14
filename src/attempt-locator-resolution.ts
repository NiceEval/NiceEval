import { Effect, Stream } from "effect";

import { encodeAttemptLocator, type AttemptLocator } from "./attempt-locator.ts";
import type { RecordAttemptRef } from "./record/model/core.ts";
import type { RecordReaderReadError } from "./record/reader/errors.ts";
import { resolveFrozenRecordReaderPort } from "./record/reader/internal.ts";
import type { FrozenRecordView } from "./record/reader/types.ts";

export interface AttemptLocatorViewInvalid {
  readonly code: "attempt-locator-view-invalid";
}

export type AttemptLocatorResolution =
  | { readonly kind: "found"; readonly attempt: RecordAttemptRef }
  | { readonly kind: "not-found" }
  | { readonly kind: "ambiguous" };

function sameReference(left: RecordAttemptRef, right: RecordAttemptRef): boolean {
  return left.originRunId === right.originRunId && left.attemptId === right.attemptId;
}

/** Resolve a derived locator against available immutable Attempts in one frozen Record view. */
export function resolveAttemptLocator(
  view: FrozenRecordView<RecordReaderReadError>,
  locator: AttemptLocator,
): Effect.Effect<AttemptLocatorResolution, RecordReaderReadError | AttemptLocatorViewInvalid> {
  return Effect.gen(function* () {
    const port = resolveFrozenRecordReaderPort(view);
    if (port === undefined) {
      return yield* Effect.fail<AttemptLocatorViewInvalid>({
        code: "attempt-locator-view-invalid",
      });
    }
    yield* port.assertOpen(view);
    const scan = yield* Stream.runFoldEffect(
      port.candidates(view),
      Object.freeze({ first: undefined as RecordAttemptRef | undefined, ambiguous: false }),
      (current, candidate): Effect.Effect<{
        readonly first: RecordAttemptRef | undefined;
        readonly ambiguous: boolean;
      }, RecordReaderReadError> => {
        if (current.ambiguous || candidate.state !== "available") {
          return Effect.succeed(current);
        }
        return Effect.gen(function* () {
          let first = current.first;
          let ambiguous = false;
          for (const slotId of candidate.value.expectedSlots) {
            const member = yield* port.member(view, candidate.value, slotId);
            if (member.state !== "available") continue;
            if (encodeAttemptLocator(member.value.attempt.attemptId) !== locator) continue;
            if (first === undefined) {
              first = member.value.attempt;
            } else if (!sameReference(first, member.value.attempt)) {
              ambiguous = true;
              break;
            }
          }
          return Object.freeze({ first, ambiguous });
        });
      },
    );
    if (scan.ambiguous) return Object.freeze({ kind: "ambiguous" as const });
    if (scan.first === undefined) return Object.freeze({ kind: "not-found" as const });
    return Object.freeze({ kind: "found" as const, attempt: scan.first });
  });
}
