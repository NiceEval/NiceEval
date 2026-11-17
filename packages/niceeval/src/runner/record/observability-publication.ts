import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { RecordAttachmentEncodeError } from "../../record/writer/errors.ts";
import type { AttemptRunnerDiagnosticsAttachment } from "../../record/family/runner-diagnostics/definition.ts";
import { boundedErrorText } from "../../shared/bounded-error-text.ts";

function isEncodeError(error: unknown): error is RecordAttachmentEncodeError {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "record-attachment-encode-error"
  );
}

/** Catch only pre-admission encoding failures; storage and content failures remain fatal. */
export function attemptObservabilityPublication() {
  const failures: RecordAttachmentEncodeError[] = [];
  return {
    write<E, R>(effect: Effect.Effect<void, E, R>): Effect.Effect<void, E, R> {
      return effect.pipe(
        Effect.catch((error) => {
          if (!isEncodeError(error)) return Effect.fail(error);
          failures.push(error);
          return Effect.void;
        }),
      );
    },
    diagnostics(original?: AttemptRunnerDiagnosticsAttachment): AttemptRunnerDiagnosticsAttachment {
      const segments = [...(original?.segments ?? [])];
      for (const failure of failures) {
        const id = randomUUID().replaceAll("-", "");
        segments.push({
          segmentId: `seg.${id}`,
          diagnosticId: `diag.${id}`,
          sequence: segments.length + 1,
          turnId: null,
          kind: "advisory",
          code: "attachment-encode-failed",
          phase: "attempt.teardown",
          summary: `Observability attachment ${failure.family} could not be encoded and was not recorded.`,
          // Paths and stable codes only: Schema messages may contain raw values.
          causes: failure.issues.slice(0, 8).map((issue) => ({
            code: issue.code,
            summary: boundedErrorText(JSON.stringify(issue.path), 512),
          })),
          redaction: { state: "none" },
          sourceFrame: null,
        });
      }
      return { collection: original?.collection ?? { state: "complete", limitations: [] }, segments };
    },
    get failureCount(): number {
      return failures.length;
    },
  };
}
