import { Effect } from "effect";

import type { SealedAttemptAssertions } from "../../../assertions/api.ts";
import type { AgentRun, EvalResult } from "../../types.ts";
import {
  sealAttemptObservabilityCaptureIdentity,
  sealRunObservabilityCaptureIdentity,
} from "../capture-identity.ts";
import { normalizeAttemptDiagnostics } from "../diagnostics.ts";
import { normalizeAttemptTiming } from "../timing.ts";
import { AgentTurnsAttachmentSchema } from "../../../record/family/agent-turns/definition.ts";
import { AttemptRunnerActivitiesAttachmentSchema } from "../../../record/family/runner-activities/definition.ts";
import { AttemptRunnerDiagnosticsAttachmentSchema } from "../../../record/family/runner-diagnostics/definition.ts";
import {
  isRunnerObservabilityProducerError,
  producerCaptureMissing,
  producerCaptureSealInvalid,
  producerCommandRegistrationInvalid,
  producerEntityIdInvalid,
  sourceCollection,
  type RunnerObservabilityProducerError,
} from "../support.ts";
import type {
  RunnerAttemptSourceReceiptsCapture,
  RunnerRunSourceReceiptsCapture,
  StagedSandboxCommandReceipt,
} from "../types.ts";
import { recordTerminalCommandResult } from "./command-lifecycle.ts";
import {
  agentTurnTerminal,
  decodeReceipt,
  receiptConversationItem,
  receiptDiagnosticRedaction,
  segmentIds,
} from "./receipt-helpers.ts";
import {
  makeAttemptEntityMinter,
  markRuntimeFailure,
  resultRuntimeState,
  resultRuntimeStateConflicts,
  runCapture,
  runtimeState,
  storeResultRuntimeState,
  type RunnerAttemptObservabilityRuntime,
  type RunnerAttemptObservabilityRuntimeState,
} from "./state.ts";

function captureRunnerAttemptSourceSnapshot(
  result: EvalResult,
  runtime: RunnerAttemptObservabilityRuntimeState,
): Effect.Effect<RunnerAttemptSourceReceiptsCapture, RunnerObservabilityProducerError> {
  return Effect.gen(function* () {
    for (const turn of runtime.conversationTurns) {
      if (turn.outcome !== undefined) continue;
      runtime.conversationLimitations.addCaptureInterrupted("adapter", "conversation-item");
      turn.outcome = "interrupted";
    }
    for (const command of runtime.commands) {
      if (command.result !== undefined) continue;
      runtime.commandLimitations.addCaptureInterrupted("command-capture", "command-manifest");
      runtime.commandLimitations.addCaptureInterrupted("command-capture", "command-stdout");
      runtime.commandLimitations.addCaptureInterrupted("command-capture", "command-stderr");
      recordTerminalCommandResult(
        Object.freeze({ runtime, command }),
        Object.freeze({ kind: "terminated" as const, reason: "cancelled" as const }),
      );
    }
    if (runtime.failure !== undefined) return yield* Effect.fail(runtime.failure);

    const minter = makeAttemptEntityMinter(runtime);
    const timingNormalization = yield* normalizeAttemptTiming({
      result,
      mint: minter.mint,
      turns: runtime.conversationTurns,
    });
    const diagnosticsNormalization = yield* normalizeAttemptDiagnostics({ result, mint: minter.mint });
    const activitySegmentIds = segmentIds(
      timingNormalization.timing.intervals.map((interval) => interval.intervalId),
    );
    const diagnosticSegmentIds = segmentIds(
      diagnosticsNormalization.diagnostics.map((diagnostic) => diagnostic.diagnosticId),
    );
    if (activitySegmentIds === undefined || diagnosticSegmentIds === undefined) {
      return yield* Effect.fail(producerEntityIdInvalid("interval"));
    }

    const agentTurnsCandidate = runtime.conversationTurns.length === 0
      ? undefined
      : Object.freeze({
          collection: sourceCollection([
            { collection: runtime.conversationLimitations.collection(), stage: "adapter" },
            { collection: runtime.usageLimitations.collection(), stage: "adapter" },
          ]),
          segments: Object.freeze(runtime.conversationTurns.map((turn) => Object.freeze({
            segmentId: turn.segmentId,
            turnId: turn.turnId,
            sequence: turn.sequence,
            outcome: turn.outcome ?? "interrupted",
            terminal: agentTurnTerminal(turn),
            items: Object.freeze(turn.items.map(receiptConversationItem)),
            usage: Object.freeze(turn.usage.map(({ refs: _refs, ...usage }) => Object.freeze(usage))),
          }))),
        });
    const agentTurns = agentTurnsCandidate === undefined
      ? undefined
      : yield* decodeReceipt(AgentTurnsAttachmentSchema, agentTurnsCandidate, "attempt");

    const commandSegments: StagedSandboxCommandReceipt[] = [];
    for (const command of runtime.commands) {
      if (command.result === undefined) return yield* Effect.fail(producerCommandRegistrationInvalid());
      commandSegments.push(Object.freeze({
        segmentId: command.segmentId,
        commandId: command.commandId,
        sequence: command.sequence,
        turnId: null,
        phase: command.manifest.phase,
        invocation: command.manifest.invocation,
        workingDirectory: command.manifest.workingDirectory,
        outcome: command.result.outcome,
        stdout: command.result.stdout,
        stderr: command.result.stderr,
      }));
    }

    const activitiesCandidate = Object.freeze({
      collection: sourceCollection([
        { collection: timingNormalization.timing.collection, stage: "runner-clock" },
      ]),
      segments: Object.freeze(timingNormalization.timing.intervals.map((interval, index) => Object.freeze({
        segmentId: activitySegmentIds.get(interval.intervalId),
        activityId: interval.intervalId,
        sequence: index + 1,
        phase: interval.phase,
        label: interval.label,
        turnId: [...timingNormalization.intervalByTurnId]
          .find(([, intervalId]) => intervalId === interval.intervalId)?.[0] ?? null,
        startOffsetMs: interval.startOffsetMs,
        durationMs: interval.durationMs,
        parentActivityId: interval.parentIntervalId,
        outcome: interval.outcome,
      }))),
    });
    const runnerActivities = yield* decodeReceipt(
      AttemptRunnerActivitiesAttachmentSchema,
      activitiesCandidate,
      "attempt",
    );

    const diagnosticsCandidate = Object.freeze({
      collection: sourceCollection([
        { collection: diagnosticsNormalization.collection, stage: "runner-diagnostic-sink" },
      ]),
      segments: Object.freeze(diagnosticsNormalization.diagnostics.map((diagnostic, index) => Object.freeze({
        segmentId: diagnosticSegmentIds.get(diagnostic.diagnosticId),
        diagnosticId: diagnostic.diagnosticId,
        sequence: index + 1,
        kind: diagnostic.kind,
        code: diagnostic.code,
        phase: diagnostic.phase === "collection" ? "attempt.teardown" : diagnostic.phase,
        turnId: null,
        summary: diagnostic.summary,
        causes: Object.freeze(diagnostic.causes.map((cause) => Object.freeze({ code: cause.code, summary: cause.summary }))),
        redaction: receiptDiagnosticRedaction(diagnostic.redaction),
        sourceFrame: diagnostic.sourceFrame,
      }))),
    });
    const runnerDiagnostics = yield* decodeReceipt(
      AttemptRunnerDiagnosticsAttachmentSchema,
      diagnosticsCandidate,
      "attempt",
    );

    return Object.freeze({
      ...(agentTurns === undefined ? {} : { agentTurns }),
      ...(commandSegments.length === 0 && runtime.commandLimitations.collection().state === "complete"
        ? {}
        : { sandboxCommands: Object.freeze({
            collection: sourceCollection([
              { collection: runtime.commandLimitations.collection(), stage: "sandbox-wrapper" },
            ]),
            segments: Object.freeze(commandSegments),
          }) }),
      runnerActivities,
      runnerDiagnostics,
    });
  });
}

/**
 * Associates the exact final EvalResult object with its Attempt-local
 * capture. Result shape stays public-contract-neutral; Record later looks up
 * this identity rather than reading an added field.
 */
export function bindRunnerAttemptObservabilityCapture(
  result: EvalResult,
  runtime: RunnerAttemptObservabilityRuntime,
): Effect.Effect<void, RunnerObservabilityProducerError> {
  const state = runtimeState(runtime);
  if (state === undefined) return Effect.fail(producerCaptureMissing());
  if (resultRuntimeStateConflicts(result, state)) {
    markRuntimeFailure(state, producerCaptureSealInvalid("attempt"));
    return Effect.fail(state.failure ?? producerCaptureSealInvalid("attempt"));
  }
  return captureRunnerAttemptSourceSnapshot(result, state).pipe(
    Effect.tap((snapshot) => Effect.sync(() => {
      state.snapshot = snapshot;
      storeResultRuntimeState(result, state);
    })),
    Effect.asVoid,
  );
}

export function createRunnerAttemptSourceReceiptsCapture(input: {
  readonly result: EvalResult;
  readonly sealed: SealedAttemptAssertions;
}): Effect.Effect<
  RunnerAttemptSourceReceiptsCapture,
  RunnerObservabilityProducerError
> {
  const capture = Effect.gen(function* () {
    const runtime = resultRuntimeState(input.result);
    if (runtime === undefined) return yield* Effect.fail(producerCaptureMissing());
    if (runtime.failure !== undefined) return yield* Effect.fail(runtime.failure);
    if (runtime.snapshot === undefined) return yield* Effect.fail(producerCaptureMissing());
    if (!sealAttemptObservabilityCaptureIdentity(runtime.capture)) {
      return yield* Effect.fail(producerCaptureSealInvalid("attempt"));
    }
    return runtime.snapshot;
  });
  return capture.pipe(
    Effect.catchAll((error) =>
      isRunnerObservabilityProducerError(error)
        ? Effect.fail(error)
        : Effect.die(error)),
  );
}

/**
 * The generic Record adapter receives only per-experiment facts that Runner
 * can safely attribute to one Run. Invocation-wide timing remains partial:
 * its single clock cannot be copied into every Run without inventing owner
 * attribution. Settled Run diagnostics are bound by run.ts immediately before
 * this same publish boundary.
 */
export function createRunnerRunSourceReceiptsCapture(input: {
  readonly run: AgentRun;
}): Effect.Effect<RunnerRunSourceReceiptsCapture, RunnerObservabilityProducerError> {
  return Effect.gen(function* () {
    const captured = runCapture(input.run);
    if (captured === undefined) return Object.freeze({});
    if (!sealRunObservabilityCaptureIdentity(captured.capture)) {
      return yield* Effect.fail(producerCaptureSealInvalid("run"));
    }
    return captured.snapshot;
  });
}
