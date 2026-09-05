import { defineEval } from "niceeval";
import { appendPluginLifecycleEvent } from "../../fixtures/events.ts";
import { interruptEvalLifecycle } from "../../plugins/lifecycle.ts";

export default defineEval({
  plugins: [interruptEvalLifecycle()],
  async test(t) {
    const turn = await t.send("start the Eval Plugin interruption fixture");
    await turn.succeeded().orStop();
    appendPluginLifecycleEvent({ kind: "eval.plugin.interrupt.test.started" });
    if (!t.signal.aborted) {
      await new Promise<void>((resolve) => {
        const aborted = (): void => {
          t.signal.removeEventListener("abort", aborted);
          resolve();
        };
        t.signal.addEventListener("abort", aborted, { once: true });
        if (t.signal.aborted) aborted();
      });
    }
    appendPluginLifecycleEvent({ kind: "eval.plugin.interrupt.test.aborted" });
    throw new Error("Eval Plugin SIGINT fixture resumed after interruption.");
  },
});
