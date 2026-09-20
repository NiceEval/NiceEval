import { equals } from "niceeval/expect";
import { customTimeoutCancellation, timeoutClosedRegistrationReporter } from "../fixtures/custom-applications.ts";

export default customTimeoutCancellation.defineEval({
  description: "Attempt 取消后清理资源并拒绝迟到 Assertion",
  reporters: [timeoutClosedRegistrationReporter],
  async test(t) {
    const observations = t.observations;
    const { onCancellation } = t;
    const handle = t.hasMarker("registered-before-timeout")
      .label("取消前登记的 Assertion");
    t.onCancellation(() => {
      for (const [boundary, action] of [
        ["check", () => t.check("abort", equals("abort"))],
        ["handle", () => handle.label("abort mutation")],
        ["method", () => onCancellation(() => {})],
        ["assertion-method", () => t.hasMarker("abort")],
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
      t.hasMarker("late").label("取消后的迟到 Assertion");
      await observations.recordLateAssertion("accepted");
    } catch {
      await observations.recordLateAssertion("rejected");
    }
  },
});
