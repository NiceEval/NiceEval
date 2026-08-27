import { Effect } from "effect";

import type { AgentRun, DiagnosticRecord } from "../../types.ts";
import { makeRunObservabilityCaptureIdentity } from "../capture-identity.ts";
import { normalizeRunDiagnostics } from "../diagnostics.ts";
import { RunRunnerDiagnosticsAttachmentSchema } from "../../../record/family/runner-diagnostics/definition.ts";
import {
  producerEntityIdInvalid,
  sourceCollection,
  type RunnerObservabilityProducerError,
} from "../support.ts";
import {
  decodeReceipt,
  receiptDiagnosticRedaction,
  segmentIds,
} from "./receipt-helpers.ts";
import { makeRunEntityMinter, storeRunCapture } from "./state.ts";

/**
 * Associates only the settled diagnostics that belong to this exact Run. The
 * invocation-wide timing recorder is intentionally not bound here: its facts
 * have no safe per-experiment owner attribution when an invocation has more
 * than one Run.
 */
export function bindRunnerRunObservabilityDiagnostics(input: {
  readonly run: AgentRun;
  readonly diagnostics: readonly DiagnosticRecord[];
}): Effect.Effect<void, RunnerObservabilityProducerError> {
  const capture = makeRunObservabilityCaptureIdentity();
  const minter = makeRunEntityMinter(capture);
  return Effect.gen(function* () {
    const normalization = yield* normalizeRunDiagnostics({
      diagnostics: input.diagnostics,
      mint: minter.mint,
    });
    const segmentIdByDiagnosticId = segmentIds(
      normalization.diagnostics.map((diagnostic) => diagnostic.diagnosticId),
    );
    if (segmentIdByDiagnosticId === undefined) {
      return yield* Effect.fail(producerEntityIdInvalid("diagnostic"));
    }
    const candidate = Object.freeze({
      collection: sourceCollection([
        { collection: normalization.collection, stage: "runner-diagnostic-sink" },
      ]),
      segments: Object.freeze(normalization.diagnostics.map((diagnostic, index) => Object.freeze({
        segmentId: segmentIdByDiagnosticId.get(diagnostic.diagnosticId),
        diagnosticId: diagnostic.diagnosticId,
        sequence: index + 1,
        kind: diagnostic.kind,
        code: diagnostic.code,
        phase: diagnostic.phase === "collection" ? "run.teardown" : diagnostic.phase,
        turnId: null,
        summary: diagnostic.summary,
        causes: Object.freeze(diagnostic.causes.map((cause) => Object.freeze({ code: cause.code, summary: cause.summary }))),
        redaction: receiptDiagnosticRedaction(diagnostic.redaction),
        sourceFrame: diagnostic.sourceFrame,
      }))),
    });
    const runnerDiagnostics = yield* decodeReceipt(
      RunRunnerDiagnosticsAttachmentSchema,
      candidate,
      "run",
    );
    storeRunCapture(input.run, Object.freeze({
      capture,
      snapshot: Object.freeze({ runnerDiagnostics }),
    }));
  });
}
