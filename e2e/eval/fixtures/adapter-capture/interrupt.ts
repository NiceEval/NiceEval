import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { defineAdapter } from "niceeval";

export const interruptCapture = defineAdapter({
  name: "interrupt-capture",
  behaviorRevision: "1",
  create(ctx) {
    appendFileSync("capture-created.txt", `${ctx.attempt}\n`);
    const aborted = new Promise<void>((resolve) => {
      if (ctx.signal.aborted) resolve();
      else ctx.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    // The Eval finally and onCleanup share this exact completion Promise.
    // The external file barrier keeps capture pending until after real SIGINT.
    const finalization = (async () => {
      await aborted;
      appendFileSync("capture-finish.txt", "start\n");
      while (!existsSync("capture-release.txt")) await setTimeout(20);
      ctx.recordUsage({
        callId: "cancelled-request", provider: "fixture", model: null,
        status: "cancelled", inputTokens: 13, outputTokens: 5,
      });
      await ctx.attach({ name: "tail.txt", mediaType: "text/plain", body: "cancelled-tail" });
      await ctx.recordTrace({
        traceId: "cancelled-complete", schema: { id: "example.capture" },
        collection: { state: "complete", limitations: [] }, scopes: [],
        events: [{ key: "cancelled", type: "operation.cancelled", source: { id: "backend" }, summary: "Cancellation observed; capture complete" }],
      });
      await ctx.recordTrace({
        traceId: "missing-checkpoint", schema: { id: "example.capture" },
        collection: { state: "partial", limitations: [{ code: "checkpoint-missing", message: "Checkpoint was not available" }] }, scopes: [],
        events: [{ key: "tail", type: "operation.observed", source: { id: "client" }, summary: "Verified cancellation tail" }],
      });
      appendFileSync("capture-finish.txt", "done\n");
    })();
    ctx.onCleanup(async ({ signal }) => {
      if (signal.aborted) throw new Error("cleanup inherited cancelled forward signal");
      await finalization;
    });
    return {
      finalization,
      waitForAbort() {
        writeFileSync("capture-ready.txt", "ready");
        return aborted;
      },
    };
  },
});
