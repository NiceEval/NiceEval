// @concord-file
// @concord-implements docs/feature/judge/architecture.md
import { Context } from "effect";
import type { TimingActivity } from "../runner/types.ts";
import type { TimingRecorder } from "../runner/timing.ts";

export type JudgeTimingOutcome = "completed" | "failed" | "cancelled";

/** Explicit parents keep overlapping entries independent of the recorder's stack. */
export class JudgeTimingSpan {
  private closed = false;
  private readonly children: JudgeTimingSpan[] = [];
  private constructor(
    private readonly recorder: TimingRecorder,
    private readonly node: TimingActivity,
  ) {}

  static start(
    recorder: TimingRecorder | undefined,
    label: string,
    parent?: JudgeTimingSpan,
    entryIndex?: number,
    transmissionOrdinal?: number,
  ): JudgeTimingSpan | undefined {
    if (recorder === undefined) return undefined;
    try {
      const value: Omit<TimingActivity, "id"> = {
        key: label,
        label,
        ...(label === "simulated-user.reply" ? {} : { judgeOwned: true as const }),
        startOffsetMs: recorder.offsetNow(),
        durationMs: 0,
        ...(entryIndex === undefined ? {} : { assertionEntryIndex: entryIndex }),
        ...(transmissionOrdinal === undefined ? {} : { transmissionOrdinal }),
      };
      const node = parent === undefined ? recorder.child(value) : recorder.childOf(parent.node, value);
      if (node === undefined) return undefined;
      const span = new JudgeTimingSpan(recorder, node);
      parent?.children.push(span);
      return span;
    } catch {
      markIncomplete(recorder);
      return undefined;
    }
  }

  child(
    label: string,
    entryIndex = this.node.assertionEntryIndex,
    transmissionOrdinal?: number,
  ): JudgeTimingSpan | undefined {
    if (this.closed) return undefined;
    return JudgeTimingSpan.start(this.recorder, label, this, entryIndex, transmissionOrdinal);
  }

  end(outcome: JudgeTimingOutcome = "completed"): void {
    if (this.closed) return;
    this.closed = true;
    for (const child of this.children) child.end(outcome === "completed" ? "failed" : outcome);
    try {
      this.node.durationMs = Math.max(0, this.recorder.offsetNow() - this.node.startOffsetMs);
      this.node.outcome = outcome;
    } catch {
      markIncomplete(this.recorder);
    }
  }
}

function markIncomplete(recorder: TimingRecorder): void {
  try {
    // The source normalizer turns an unsupported capture marker into a limitation.
    recorder.child({
      key: "judge.timing.capture-failed",
      label: "judge.timing.capture-failed",
      startOffsetMs: 0,
      durationMs: 0,
    });
  } catch {
    // A broken recorder must still not change the evaluation result.
  }
}

export const CurrentJudgeTiming = Context.Reference<JudgeTimingSpan | undefined>("niceeval/judge/CurrentTiming", {
  defaultValue: () => undefined,
});

/** Observe actual HTTP attempts, including SDK retries, through body completion. */
export function judgeTimingFetch(parent: () => JudgeTimingSpan | undefined): typeof globalThis.fetch {
  const ordinals = new WeakMap<JudgeTimingSpan, number>();
  return async (input, init) => {
    const owner = parent();
    const ordinal = owner === undefined ? 1 : (ordinals.get(owner) ?? 0) + 1;
    if (owner !== undefined) ordinals.set(owner, ordinal);
    const span = owner?.child("judge.request", undefined, ordinal);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const abort = () => span?.end("cancelled");
    const finish = (outcome: JudgeTimingOutcome) => {
      signal?.removeEventListener("abort", abort);
      span?.end(outcome);
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await globalThis.fetch(input, init);
      const outcome = response.ok ? "completed" : "failed";
      if (response.body === null) {
        finish(outcome);
        return response;
      }
      const reader = response.body.getReader();
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const result = await reader.read();
              if (result.done) {
                finish(outcome);
                controller.close();
              } else controller.enqueue(result.value);
            } catch (error) {
              finish(signal?.aborted ? "cancelled" : "failed");
              controller.error(error);
            }
          },
          async cancel(reason) {
            finish(signal?.aborted ? "cancelled" : "failed");
            await reader.cancel(reason);
          },
        }),
        { status: response.status, statusText: response.statusText, headers: response.headers },
      );
    } catch (error) {
      finish(signal?.aborted ? "cancelled" : "failed");
      throw error;
    }
  };
}
