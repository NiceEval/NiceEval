import { defineEval } from "niceeval";
import { appendPluginLifecycleEvent } from "../../fixtures/events.ts";

export default defineEval({
  async test(t) {
    const turn = await t.send("start the Direct Agent timeout fixture");
    await turn.succeeded().orStop();
    appendPluginLifecycleEvent({ kind: "direct.agent.test.started" });
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
    appendPluginLifecycleEvent({ kind: "direct.agent.test.aborted" });
    throw new Error("Direct Agent timeout fixture resumed after interruption.");
  },
});
