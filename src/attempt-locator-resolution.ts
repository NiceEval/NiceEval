import { Effect } from "effect";
import { encodeAttemptLocator, type AttemptLocator } from "./attempt-locator.ts";
import type { RecordReaderReadError } from "./record/reader/errors.ts";
import type {
  RecordReadSession,
  RecordSelection,
  SelectedAttemptRef,
  SelectedRunRef,
} from "./record/host/types.ts";
import type { SlotId } from "./record/model/identifiers.ts";

export type AttemptLocatorResolution =
  | {
      readonly kind: "found";
      readonly run: SelectedRunRef;
      readonly slotId: SlotId;
      readonly attempt: SelectedAttemptRef;
    }
  | { readonly kind: "not-found" }
  | { readonly kind: "ambiguous" };

interface LocatorMatch {
  readonly run: SelectedRunRef;
  readonly slotId: SlotId;
  readonly attempt: SelectedAttemptRef;
}

function sameReference(left: SelectedAttemptRef, right: SelectedAttemptRef): boolean {
  return left.originRunId === right.originRunId && left.attemptId === right.attemptId;
}

/**
 * Resolves a public locator only through Core issued by one live Record read
 * session and its frozen selection. A null Member has no Attempt and is never
 * interpreted as a pending or missing physical directory.
 */
export function resolveAttemptLocator(input: {
  readonly reader: RecordReadSession;
  readonly selection: RecordSelection;
  readonly locator: AttemptLocator;
}): Effect.Effect<AttemptLocatorResolution, RecordReaderReadError> {
  return Effect.gen(function* () {
    let first: LocatorMatch | undefined;
    for (const runRef of input.selection.runRefs) {
      const read = yield* input.reader.readRun(runRef);
      if (read.state !== "available") continue;
      for (const member of read.value.members) {
        // The two null representations are intentionally separate Record
        // states, but neither admits an exact Attempt capability.
        if (member.document.attempt === null || member.attempt === null) continue;
        if (encodeAttemptLocator(member.attempt.attemptId) !== input.locator) continue;
        const current: LocatorMatch = Object.freeze({
          run: runRef,
          slotId: member.document.slotId,
          attempt: member.attempt,
        });
        if (first === undefined) {
          first = current;
        } else if (!sameReference(first.attempt, current.attempt)) {
          return Object.freeze({ kind: "ambiguous" as const });
        }
      }
    }
    return first === undefined
      ? Object.freeze({ kind: "not-found" as const })
      : Object.freeze({ kind: "found" as const, ...first });
  });
}
