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
  private readonly recorder: TimingRecorder;
  private readonly node: TimingActivity;
  private constructor(recorder: TimingRecorder, node: TimingActivity) {
    this.recorder = recorder;
    this.node = node;
  }

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

/** Number actual transport attempts across successive model turns under the same prompt. */
export function judgeRequestTiming(parent: () => JudgeTimingSpan | undefined): () => JudgeTimingSpan | undefined {
  const ordinals = new WeakMap<JudgeTimingSpan, number>();
  return () => {
    const owner = parent();
    if (owner === undefined) return undefined;
    const ordinal = (ordinals.get(owner) ?? 0) + 1;
    ordinals.set(owner, ordinal);
    return owner.child("judge.request", undefined, ordinal);
  };
}
