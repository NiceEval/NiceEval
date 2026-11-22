import { Effect } from "effect";

import type { DiagnosticRecord, EvalResult, TimingOrigin } from "../types.ts";
import {
  compareObservabilityText,
  makeSafeText,
  makeSafeIdentifier,
  type DiagnosticId,
  type ObservabilityEntityIdForKind,
} from "../../record/family/source-receipt/model.ts";
import type {
  AttemptDiagnostic,
  AttemptDiagnosticsAttachment,
  RunDiagnostic,
  RunDiagnosticsAttachment,
} from "./model.ts";
import { RunnerCollectionLimitations, type RunnerObservabilityProducerError } from "./support.ts";

type AttemptEntityMinter = (
  kind: "diagnostic",
) => Effect.Effect<ObservabilityEntityIdForKind<"diagnostic">, RunnerObservabilityProducerError>;

type RunEntityMinter = (
  kind: "diagnostic",
) => Effect.Effect<ObservabilityEntityIdForKind<"diagnostic">, RunnerObservabilityProducerError>;

function attemptDiagnosticPhase(origin: TimingOrigin | undefined): AttemptDiagnostic["phase"] {
  if (origin === undefined || origin.scope !== "attempt") return "collection";
  switch (origin.phase) {
    case "attempt.setup":
    case "sandbox.create":
    case "workspace.baseline":
    case "agent.setup":
    case "telemetry.configure":
      return "attempt.setup";
    case "sandbox.prepare":
    case "sandbox.prepare.eval":
    case "sandbox.prepare.group":
    case "sandbox.prepare.experiment":
      return "sandbox.prepare";
    case "agent.install":
      return "agent.install";
    case "eval.run":
      return "eval.run";
    case "agent.run":
      return "agent.send";
    case "assertions.evaluate":
      return "assertion.evaluate";
    case "agent.teardown":
    case "attempt.teardown":
    case "sandbox.cleanup":
    case "sandbox.suspend":
    case "sandbox.stop":
      return "attempt.teardown";
    case "judge.precheck":
    case "experiment.setup":
    case "experiment.teardown":
    case "sandbox.queue":
    case "workspace.diff":
    case "telemetry.collect":
      return "collection";
  }
}

export function normalizeAttemptDiagnostics(input: {
  readonly result: EvalResult;
  readonly mint: AttemptEntityMinter;
}): Effect.Effect<AttemptDiagnosticsAttachment, RunnerObservabilityProducerError> {
  return Effect.gen(function* () {
    const limitations = new RunnerCollectionLimitations();
    const diagnostics: AttemptDiagnostic[] = [];
    const append = (value: {
      readonly code: string;
      readonly detail: string;
      readonly kind: AttemptDiagnostic["kind"];
      readonly reason: string | undefined;
      readonly origin: DiagnosticRecord["origin"] | undefined;
    }): Effect.Effect<void, RunnerObservabilityProducerError> => {
      const code = makeSafeIdentifier(value.code);
      if (code === undefined) {
        limitations.addUnsupported("diagnostic");
        return Effect.void;
      }
      const retainedSummary = makeSafeText(value.detail);
      if (retainedSummary === undefined) {
        limitations.addUnsupported("diagnostic");
      }
      return Effect.map(input.mint("diagnostic"), (diagnosticId) => {
        diagnostics.push({
          diagnosticId: diagnosticId as DiagnosticId,
          kind: value.kind,
          code,
          phase: attemptDiagnosticPhase(value.origin),
          // The result's one-line detail is already Runner-redacted. Causes,
          // stacks, paths, and arbitrary context remain outside this durable
          // family. Unsafe detail falls back to a generic summary and partial coverage.
          summary:
            retainedSummary ??
            makeSafeText(
              value.kind === "execution-error"
                ? "Runner recorded an execution error."
                : "Runner recorded an advisory diagnostic.",
            )!,
          causes:
            value.reason === undefined
              ? []
              : [
                  {
                    code: makeSafeIdentifier(value.reason)!,
                    summary: makeSafeText(value.reason)!,
                  },
                ],
          context: [],
          redaction: { state: "none" as const },
          sourceFrame: null,
          refs: [],
        });
      });
    };

    if (input.result.error !== undefined) {
      yield* append({
        code: input.result.error.code,
        detail: input.result.error.message,
        kind: "execution-error" as const,
        origin: input.result.error.origin,
        reason: input.result.error.code.startsWith("simulated-user-") ? input.result.error.cause?.code : undefined,
      });
    }
    for (const diagnostic of input.result.diagnostics ?? []) {
      yield* append({
        code: diagnostic.code,
        detail: diagnostic.detail,
        kind: diagnostic.level === "error" ? ("execution-error" as const) : ("advisory" as const),
        origin: diagnostic.origin,
        reason: undefined,
      });
    }
    return {
      collection: limitations.collection(),
      diagnostics: diagnostics.sort((left, right) => compareObservabilityText(left.diagnosticId, right.diagnosticId)),
    };
  });
}

function runDiagnosticPhase(origin: TimingOrigin | undefined): RunDiagnostic["phase"] {
  // Runner's existing experiment diagnostic accumulator predates the
  // owner-local Attachment and represents its lifecycle anchor as an Attempt
  // origin. Its phase is still a real Run fact; no timing-node or provider
  // attribute is inferred here.
  switch (origin?.scope === "attempt" ? origin.phase : undefined) {
    case "judge.precheck":
    case "experiment.setup":
      return "run.setup";
    case "sandbox.queue":
      return "run.dispatch";
    case "experiment.teardown":
      return "run.teardown";
    default:
      return "collection";
  }
}

export function normalizeRunDiagnostics(input: {
  readonly diagnostics: readonly DiagnosticRecord[];
  readonly mint: RunEntityMinter;
}): Effect.Effect<RunDiagnosticsAttachment, RunnerObservabilityProducerError> {
  return Effect.gen(function* () {
    const limitations = new RunnerCollectionLimitations();
    const diagnostics: RunDiagnostic[] = [];
    for (const source of input.diagnostics) {
      const code = makeSafeIdentifier(source.code);
      if (code === undefined) {
        limitations.addUnsupported("diagnostic");
        continue;
      }
      const summary = makeSafeText(source.detail);
      if (summary === undefined) limitations.addUnsupported("diagnostic");
      const diagnosticId = yield* input.mint("diagnostic");
      diagnostics.push({
        ...(source.affectedSlotIds === undefined ? {} : { affectedSlotIds: source.affectedSlotIds }),
        diagnosticId: diagnosticId as DiagnosticId,
        kind: source.level === "error" ? ("execution-error" as const) : ("advisory" as const),
        code,
        phase: runDiagnosticPhase(source.origin),
        summary:
          summary ??
          makeSafeText(
            source.level === "error"
              ? "Runner recorded an execution error."
              : "Runner recorded an advisory diagnostic.",
          )!,
        causes: [],
        context: [],
        redaction: { state: "none" as const },
        sourceFrame: null,
        refs: [],
      });
    }
    return {
      collection: limitations.collection(),
      diagnostics: diagnostics.sort((left, right) => compareObservabilityText(left.diagnosticId, right.diagnosticId)),
    };
  });
}
