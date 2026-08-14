import type { AttemptId, RunId } from "../model/identifiers.ts";

/**
 * An exact historical Attempt reference used only by the sealed evaluation
 * plan boundary. Ordinary Record reading is exposed by `RecordHost.current`.
 */
export const frozenRecordAttemptBrand: unique symbol = Symbol(
  "@niceeval/record/FrozenRecordAttempt",
);

export interface FrozenRecordAttempt {
  readonly attemptId: AttemptId;
  readonly originRunId: RunId;
  readonly [frozenRecordAttemptBrand]: () => void;
}
