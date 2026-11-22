import { Effect, Exit, Option } from "effect";
import type { ExecutionTraceLimitation } from "../../adapter-execution-trace.ts";
import type { DiagnosticInput, ToolCall, TraceSpan } from "../../types.ts";
import type { TimingRecorder } from "../../runner/timing.ts";
import type { TraceReceiver } from "./receiver.ts";
import { enrichTraceWithIO } from "./select.ts";

export const TELEMETRY_COLLECTION_BUDGET_MS = 30_000;

const collectionGaps = {
  "telemetry.settle": "The OTLP trace may omit exports that had not settled.",
  "telemetry.read": "The OTLP trace may omit spans from unread data or an unfinished envelope.",
  "telemetry.decode": "The OTLP trace may omit spans awaiting decoding or still to be read.",
};
type CollectionStage = keyof typeof collectionGaps;

export const collectAttemptTelemetry = Effect.fnUntraced(function* (input: {
  readonly receiver?: TraceReceiver;
  readonly shared?: {
    readonly receiver: TraceReceiver;
    readonly read: () => { spans: TraceSpan[]; lateSpanCount: number };
    readonly disconnectedRequestsAtStart: number;
    readonly turnSettleExpired: boolean;
  };
  readonly initialSpans?: readonly TraceSpan[];
  readonly map: (spans: TraceSpan[]) => TraceSpan[];
  readonly toolCalls: readonly ToolCall[];
  readonly recorder: TimingRecorder;
  readonly diagnostic: (diagnostic: DiagnosticInput) => void;
}) {
  const receiver = input.receiver ?? input.shared?.receiver;
  let bytes: number | undefined =
    input.receiver?.drain !== undefined || input.receiver?.receivedBytes !== undefined ? 0 : undefined;
  let spans: TraceSpan[] = [...(input.initialSpans ?? [])];
  let settled = true;
  let disconnectedRequests = 0;
  let lateSpanCount = 0;
  const read = () => {
    const shared = input.shared?.read();
    lateSpanCount = shared?.lateSpanCount ?? 0;
    return input.receiver?.collect() ?? shared?.spans ?? spans;
  };
  let stage: CollectionStage = "telemetry.settle";
  const activity = <A>(
    key: CollectionStage | "telemetry.map",
    effect: Effect.Effect<A, unknown>,
    count?: (value: A) => number,
  ): Effect.Effect<A, unknown> =>
    Effect.suspend(() => {
      if (key !== "telemetry.map") stage = key;
      const startOffsetMs = input.recorder.offsetNow();
      const node = input.recorder.child({ key, label: key, startOffsetMs, durationMs: 0 });
      return effect.pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            const size = count?.(value);
            if (size !== undefined) {
              if (key === "telemetry.read") bytes = (bytes ?? 0) + size;
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
    yield* activity(
      "telemetry.settle",
      Effect.gen(function* () {
        if (input.receiver !== undefined) {
          const observed = yield* input.receiver.settle(250, 1500);
          settled = observed.settled;
          disconnectedRequests = observed.disconnectedRequests;
        }
        if (input.shared !== undefined) {
          const observed = yield* input.shared.receiver.settle(200, 1000);
          settled &&= observed.settled;
          disconnectedRequests = observed.disconnectedRequests;
        }
        if (input.receiver?.awaitAcceptedRequests !== undefined) yield* input.receiver.awaitAcceptedRequests;
      }),
    );
    if (receiver?.drain !== undefined) {
      yield* receiver.drain(activity);
      spans = receiver.collect();
    } else {
      spans = yield* activity(
        "telemetry.read",
        Effect.sync(read),
        input.receiver?.receivedBytes === undefined ? undefined : () => input.receiver!.receivedBytes!(),
      );
      yield* activity("telemetry.decode", Effect.void, () => spans.length);
    }
  });
  const completed = yield* work.pipe(Effect.timeoutOption(TELEMETRY_COLLECTION_BUDGET_MS));
  const limitations: ExecutionTraceLimitation[] = [];
  if (Option.isNone(completed)) {
    spans = read();
    if (input.receiver?.receivedBytes !== undefined) bytes = input.receiver.receivedBytes();
    const progress =
      `Decoded span count: ${spans.length}.` +
      (bytes === undefined ? "" : ` Bytes received in completed transfers: ${bytes}.`);
    const limitation = {
      code: "telemetry-budget-exceeded",
      message:
        `Telemetry collection exceeded its ${TELEMETRY_COLLECTION_BUDGET_MS} ms budget during ${stage}. ` +
        `${collectionGaps[stage]} ${progress}`,
    };
    limitations.push(limitation);
    input.diagnostic({
      ...limitation,
      level: "warning",
      data: { stage, incomplete: ["trace"], ...(bytes === undefined ? {} : { bytes }), spans: spans.length },
    });
  }
  const disconnected =
    (receiver?.disconnectedRequests?.() ?? disconnectedRequests) -
    (input.receiver === undefined ? (input.shared?.disconnectedRequestsAtStart ?? 0) : 0);
  if (disconnected > 0) {
    const limitation = {
      code: "telemetry-exports-disconnected",
      message: `The OTLP receiver observed ${disconnected} export requests disconnect before the receiver could read their complete bodies.`,
    };
    limitations.push(limitation);
    input.diagnostic({ ...limitation, level: "warning", data: { disconnectedRequests: disconnected } });
  }
  if (!settled || input.shared?.turnSettleExpired === true || lateSpanCount > 0) {
    input.diagnostic({
      code: "telemetry-settle-incomplete",
      level: "warning",
      message: "An OTLP settle window expired before exports reached quiet, or spans arrived after turn collection.",
      data: { attemptSettled: settled, turnSettleExpired: input.shared?.turnSettleExpired ?? false, lateSpanCount },
    });
  }
  // Author mappers are synchronous closures. Run exactly once over the decoded
  // prefix after the cancellable collection budget, while recording their cost.
  const trace = yield* activity(
    "telemetry.map",
    Effect.sync(() =>
      enrichTraceWithIO(
        input
          .map(spans)
          .slice()
          .sort((a, b) => a.startMs - b.startMs),
        input.toolCalls,
      ),
    ),
    (value) => value.length,
  );
  return { trace, limitations };
});
