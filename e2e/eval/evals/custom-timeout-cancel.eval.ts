import { equals } from "niceeval/expect";
import { customTimeoutCancellation, timeoutClosedRegistrationReporter } from "../fixtures/custom-applications.ts";

export default customTimeoutCancellation.defineEval({
  description: "Attempt 取消后清理资源并拒绝迟到 Assertion",
  reporters: [timeoutClosedRegistrationReporter],
  async test(t) {
    const observations = t.observations;
    const handle = t.check("registered-before-timeout", equals("registered-before-timeout"))
      .label("取消前登记的 Assertion");
    t.onCancellation(() => {
      for (const [boundary, action] of [
        ["check", () => t.check("abort", equals("abort"))],
        ["handle", () => handle.label("abort mutation")],
        ["method", () => t.onCancellation(() => {})],
      ] as const) {
        try {
          action();
          void observations.recordAbortCheck(boundary, "accepted");
        } catch {
          void observations.recordAbortCheck(boundary, "rejected");
        }
      }
    });
    await t.waitForCancellation();
    try {
      t.check("late", equals("different")).label("取消后的迟到 Assertion");
      await observations.recordLateAssertion("accepted");
    } catch {
      await observations.recordLateAssertion("rejected");
    }
  },
});
