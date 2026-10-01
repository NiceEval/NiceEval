import type { AttemptCancellation, AttemptSignal } from "../shared/attempt-lifecycle.ts";

/** Only the Attempt owner can produce reasons for this signal. */
export class AttemptCancellationController extends AbortController {
  declare readonly signal: AttemptSignal;
  override abort(reason: AttemptCancellation): void {
    if (!this.signal.aborted) super.abort(Object.freeze(reason));
  }
}
