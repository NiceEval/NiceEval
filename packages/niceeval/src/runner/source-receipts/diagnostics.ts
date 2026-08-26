import { Effect } from "effect";

import type { DiagnosticRecord, EvalResult, TimingOrigin } from "../types.ts";
import {
  MAX_DIAGNOSTICS,
  MAX_DIAGNOSTIC_SUMMARY_BYTES,
} from "../../record/family/source-receipt/limits.ts";
import {
  compareObservabilityText,
  makeBoundedSafeText,
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
import {
  RunnerCollectionLimitations,
  type RunnerObservabilityProducerError,
} from "./support.ts";

type AttemptEntityMinter = (
  kind: "diagnostic",
) => Effect.Effect<ObservabilityEntityIdForKind<"diagnostic">, RunnerObservabilityProducerError>;

type RunEntityMinter = (
  kind: "diagnostic",
) => Effect.Effect<ObservabilityEntityIdForKind<"diagnostic">, RunnerObservabilityProducerError>;

function attemptDiagnosticPhase(
  origin: TimingOrigin | undefined,
): AttemptDiagnostic["phase"] {
  if (origin === undefined || origin.scope !== "attempt") return "collection";
  switch (origin.phase) {
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
    case "agent.ensure":
      return "agent.ensure";
    case "eval.run":
      return "eval.run";
    case "agent.run":
      return "agent.send";
    case "assertions.evaluate":
      return "assertion.evaluate";
    case "agent.teardown":
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
    const append = (
      value: {
        readonly code: string;
        readonly detail: string;
        readonly kind: AttemptDiagnostic["kind"];
        readonly origin?: DiagnosticRecord["origin"];
      },
    ): Effect.Effect<void, RunnerObservabilityProducerError> => {
      const code = makeSafeIdentifier(value.code);
      if (code === undefined) {
        limitations.addUnsupported("diagnostic");
        return Effect.void;
      }
      const retainedSummary = makeBoundedSafeText(
        value.detail,
        MAX_DIAGNOSTIC_SUMMARY_BYTES,
      );
      if (retainedSummary === undefined) {
        limitations.addUnsupported("diagnostic");
      }
      if (diagnostics.length >= MAX_DIAGNOSTICS) {
        limitations.addCap("diagnostic", diagnostics.length);
        return Effect.void;
      }
      return Effect.map(input.mint("diagnostic"), (diagnosticId) => {
        diagnostics.push(Object.freeze({
          diagnosticId: diagnosticId as DiagnosticId,
          kind: value.kind,
          code,
          phase: attemptDiagnosticPhase(value.origin),
          // The result's one-line detail is already Runner-redacted. Causes,
          // stacks, paths, and arbitrary context remain outside this durable
          // family. An unsafe or oversized detail is deliberately replaced by
          // a generic bounded summary and represented as partial coverage.
          summary: retainedSummary ?? makeBoundedSafeText(
            value.kind === "execution-error"
              ? "Runner recorded an execution error."
              : "Runner recorded an advisory diagnostic.",
            MAX_DIAGNOSTIC_SUMMARY_BYTES,
          )!,
          causes: Object.freeze([]),
          context: Object.freeze([]),
          redaction: Object.freeze({ state: "none" as const }),
          sourceFrame: null,
          refs: Object.freeze([]),
        }));
      });
    };

    if (input.result.error !== undefined) {
      yield* append(Object.freeze({
        code: input.result.error.code,
        detail: input.result.error.message,
        kind: "execution-error" as const,
        origin: input.result.error.origin,
      }));
    }
    for (const diagnostic of input.result.diagnostics ?? []) {
      yield* append(Object.freeze({
        code: diagnostic.code,
        detail: diagnostic.detail,
        kind: diagnostic.level === "error" ? "execution-error" as const : "advisory" as const,
        ...(diagnostic.origin === undefined ? {} : { origin: diagnostic.origin }),
      }));
    }
    return Object.freeze({
      collection: limitations.collection(),
      diagnostics: Object.freeze(
        [...diagnostics].sort((left, right) =>
          compareObservabilityText(left.diagnosticId, right.diagnosticId),
        ),
      ),
    });
  });
}

function runDiagnosticPhase(
  origin: TimingOrigin | undefined,
): RunDiagnostic["phase"] {
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
      const summary = makeBoundedSafeText(source.detail, MAX_DIAGNOSTIC_SUMMARY_BYTES);
      if (summary === undefined) limitations.addUnsupported("diagnostic");
      if (diagnostics.length >= MAX_DIAGNOSTICS) {
        limitations.addCap("diagnostic", diagnostics.length);
        continue;
      }
      const diagnosticId = yield* input.mint("diagnostic");
      diagnostics.push(Object.freeze({
        diagnosticId: diagnosticId as DiagnosticId,
        kind: source.level === "error" ? "execution-error" as const : "advisory" as const,
        code,
        phase: runDiagnosticPhase(source.origin),
        summary: summary ?? makeBoundedSafeText(
          source.level === "error"
            ? "Runner recorded an execution error."
            : "Runner recorded an advisory diagnostic.",
          MAX_DIAGNOSTIC_SUMMARY_BYTES,
        )!,
        causes: Object.freeze([]),
        context: Object.freeze([]),
        redaction: Object.freeze({ state: "none" as const }),
        sourceFrame: null,
        refs: Object.freeze([]),
      }));
    }
    return Object.freeze({
      collection: limitations.collection(),
      diagnostics: Object.freeze(
        [...diagnostics].sort((left, right) =>
          compareObservabilityText(left.diagnosticId, right.diagnosticId),
        ),
      ),
    });
  });
}
