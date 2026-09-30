import { equals } from "niceeval/expect";
import { interruptCapture } from "../../fixtures/adapter-capture/interrupt.ts";

export default interruptCapture.defineScoreEval({
  async test(t) {
    await t.check(true, equals(true)).score(7).label("earned before cancellation").orStop();
    const finalization = t.finalization;
    try {
      await t.waitForAbort();
    } finally {
      await finalization;
    }
  },
});
