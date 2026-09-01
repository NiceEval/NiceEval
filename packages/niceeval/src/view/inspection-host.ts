import { Effect, Result } from "effect";

import { decodeInspectionRequest, QUERY_PROTOCOL } from "../inspection/codec.ts";
import { openHostOwnedInspectionSource } from "../inspection/source.ts";
import { selectInspectionOperation } from "../inspection/select.ts";
import type { InspectionDocument } from "../inspection/protocol.ts";
import type { ViewGeneration } from "./revision.ts";

export async function inspectViewGeneration(generation: ViewGeneration, input: unknown): Promise<InspectionDocument> {
  const decoded = decodeInspectionRequest(input);
  if (Result.isFailure(decoded)) throw decoded.failure;
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const facts = yield* openHostOwnedInspectionSource(generation.recordPath);
    const cutoff = facts.cutoff();
    if (cutoff.identity !== generation.sourceCutoffIdentity) {
      return yield* Effect.fail(new Error("Pinned generation cutoff did not match its descriptor"));
    }
    return selectInspectionOperation(facts, decoded.success.operation);
  })).pipe(Effect.catch((cause) => Effect.succeed(Object.freeze({
    protocol: QUERY_PROTOCOL,
    outcome: "failure" as const,
    operation: decoded.success.operation.kind,
    failure: Object.freeze({
      code: "inspection-operation-failed" as const,
      reason: "Inspection could not be completed for this generation.",
      correction: "retry" as const,
    }),
  })))));
}
