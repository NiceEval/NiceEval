import { Effect, Exit, Option } from "effect";
import type { DiagnosticInput, ToolCall, TraceSpan } from "../../types.ts";
import type { TimingRecorder } from "../../runner/timing.ts";
import type { TraceCollectionActivity, TraceReceiver } from "./receiver.ts";
import { enrichTraceWithIO, selectTraceSpans } from "./select.ts";

export const TELEMETRY_COLLECTION_BUDGET_MS = 30_000;

export const collectAttemptTelemetry = Effect.fnUntraced(function* (input: {
  readonly receiver?: TraceReceiver;
  readonly shared?: Effect.Effect<TraceSpan[], unknown>;
  readonly initialSpans?: readonly TraceSpan[];
  readonly map: (spans: TraceSpan[]) => TraceSpan[];
  readonly toolCalls: readonly ToolCall[];
  readonly recorder: TimingRecorder;
  readonly diagnostic: (diagnostic: DiagnosticInput) => void;
}) {
  let bytes: number | undefined =
    input.receiver?.drain !== undefined || input.receiver?.receivedBytes !== undefined ? 0 : undefined;
  let decoded = 0;
  let spans: TraceSpan[] = [...(input.initialSpans ?? [])];
  const activity = <A>(
    key: string,
    effect: Effect.Effect<A, unknown>,
    count?: (value: A) => number,
  ): Effect.Effect<A, unknown> =>
    Effect.suspend(() => {
      const startOffsetMs = input.recorder.offsetNow();
      const node = input.recorder.child({ key, label: key, startOffsetMs, durationMs: 0 });
      return effect.pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            const size = count?.(value);
            if (size !== undefined) {
              if (key === "telemetry.read") bytes = (bytes ?? 0) + size;
              if (key === "telemetry.decode") decoded += size;
              if (node) node.label = `${key}.${key === "telemetry.read" ? "bytes" : "spans"}.${size}`;
            }
          }),
        ),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (node) {
              node.durationMs = Math.max(0, input.recorder.offsetNow() - startOffsetMs);
              if (Exit.isFailure(exit)) node.failed = true;
            }
          }),
        ),
      );
    });
  const work = Effect.gen(function* () {
    yield* activity("telemetry.settle", input.receiver?.settle(250, 1500) ?? Effect.void);
    if (input.receiver?.drain !== undefined) {
      yield* input.receiver.drain(activity as TraceCollectionActivity);
      spans = input.receiver.collect();
    } else {
      spans = yield* activity(
        "telemetry.read",
        input.shared ?? Effect.sync(() => input.receiver?.collect() ?? []),
        input.receiver?.receivedBytes === undefined ? undefined : () => input.receiver!.receivedBytes!(),
      );
      yield* activity("telemetry.decode", Effect.void, () => spans.length);
    }
  });
  const completed = yield* work.pipe(Effect.timeoutOption(TELEMETRY_COLLECTION_BUDGET_MS));
  const partial = Option.isNone(completed);
  if (partial) {
    spans = input.receiver?.collect() ?? spans;
    if (input.receiver?.receivedBytes !== undefined) bytes = input.receiver.receivedBytes();
    // The receiver publishes only completely decoded envelopes. Never retain
    // an unfinished JSON line as evidence or change the sealed Verdict.
    input.diagnostic({
      code: "telemetry-budget-exceeded",
      level: "warning",
      message: "Telemetry collection exceeded its 30000 ms budget; retaining the decoded trace and existing Verdict.",
      data: { ...(bytes === undefined ? {} : { bytes }), spans: decoded || spans.length },
    });
  }
  // Author mappers are synchronous closures. Run exactly once over the decoded
  // prefix after the cancellable collection budget, while recording their cost.
  const trace = yield* activity(
    "telemetry.map",
    Effect.sync(() => enrichTraceWithIO(selectTraceSpans(input.map(spans)), input.toolCalls)),
    (value) => value.length,
  );
  return { trace, partial, bytes, spans: decoded || spans.length };
});
