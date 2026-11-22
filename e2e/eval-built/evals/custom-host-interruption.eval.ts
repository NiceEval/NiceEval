import { equals } from "niceeval/expect";
import { customHostInterruption } from "../fixtures/custom-applications.ts";

export default customHostInterruption.defineEval({
  async test(t) {
    const observations = t.observations;
    t.check("before-interruption", equals("before-interruption"));
    t.onCancellation(() => {
      try {
        t.check("abort", equals("abort"));
        void observations.recordAbortAssertion("accepted");
      } catch {
        void observations.recordAbortAssertion("rejected");
      }
    });
    const cancellation = t.waitForCancellation();
    await t.enterTest();
    await cancellation;
    try {
      t.check("late", equals("late"));
      await observations.recordLateAssertion("accepted");
    } catch {
      await observations.recordLateAssertion("rejected");
    }
  },
});
