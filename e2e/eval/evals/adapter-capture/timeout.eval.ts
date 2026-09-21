import { equals } from "niceeval/expect";
import { timeoutCapture } from "../../fixtures/adapter-capture/timeout.ts";

export default timeoutCapture.defineScoreEval({
  async test(t) {
    await t.check(true, equals(true)).score(7).label("earned before cleanup timeout").orStop();
  },
});
