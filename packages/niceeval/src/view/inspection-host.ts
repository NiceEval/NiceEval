// @concord-file
// @concord-implements docs/feature/inspection/architecture.md
// @concord-implements docs/feature/inspection/architecture.md#run-inspection-insight
import { Effect, Result } from "effect";

import { decodeInspectionRequest } from "../inspection/codec.ts";
import { openHostOwnedInspectionSource } from "../inspection/source.ts";
import { selectInspectionOperation } from "../inspection/select.ts";
import { bindProjectInput } from "../inspection/project-input.ts";
import { loadSelectedInspectionRuns } from "../inspection/facts.ts";
import type { InspectionDocument } from "../inspection/protocol.ts";
import type { ViewGeneration } from "./revision.ts";

// @concord-code
// @concord-implements docs/feature/inspection/architecture.md
export function inspectViewGeneration(generation: ViewGeneration, input: unknown) {
  return Effect.suspend(() => {
    const decoded = decodeInspectionRequest(input);
    if (Result.isFailure(decoded)) return Effect.fail(decoded.failure);
    return Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* openHostOwnedInspectionSource(generation.recordPath);
        const facts =
          decoded.success.operation.kind === "project.get" && generation.target.kind === "current"
            ? Object.freeze({ ...opened, kind: "project-record" as const })
            : opened;
        const cutoff = facts.cutoff();
        if (cutoff.identity !== generation.sourceCutoffIdentity) {
          return yield* Effect.fail(new Error("Pinned generation cutoff did not match its descriptor"));
        }
        if (decoded.success.operation.kind === "project.get" && generation.target.kind === "current") {
          if (
            generation.target.input.cutoffIdentity !== cutoff.identity ||
            generation.target.input.target.identity !== generation.target.identity
          ) {
            return yield* Effect.fail(new Error("Pinned current target did not match its descriptor"));
          }
          // Prepared Runs contain lazy attachment readers owned by preparation's
          // closed Scope. Rebind their exact identities to this request's reader
          // at the already verified generation cutoff; keep the frozen target.
          bindProjectInput(facts, {
            ...generation.target.input,
            runs: loadSelectedInspectionRuns(
              facts,
              generation.target.input.runs.map((run) => run.run.runId),
            ),
          });
        }
        return selectInspectionOperation(facts, decoded.success.operation);
      }),
    ).pipe(
      Effect.catch(() =>
        Effect.succeed(
          Object.freeze({
            outcome: "failure" as const,
            operation: decoded.success.operation.kind,
            failure: Object.freeze({
              code: "inspection-operation-failed" as const,
              reason: "Inspection could not be completed for this generation.",
              correction: "retry" as const,
            }),
          }) satisfies InspectionDocument,
        ),
      ),
    );
  });
}
