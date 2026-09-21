import { appendFileSync } from "node:fs";
import { defineAdapter } from "niceeval";

export const timeoutCapture = defineAdapter<{ ready: boolean }>({
  name: "timeout-capture",
  behaviorRevision: "1",
  async create(ctx) {
    ctx.recordUsage({
      callId: "accepted-request", provider: "fixture", model: null,
      status: "succeeded", inputTokens: 3, outputTokens: 2,
    });
    await ctx.attach({ name: "accepted.txt", mediaType: "text/plain", body: "accepted-before-timeout" });
    await ctx.recordTrace({
      traceId: "before-timeout", schema: { id: "example.capture" },
      collection: { state: "complete", limitations: [] }, scopes: [],
      events: [{ key: "accepted", type: "operation.accepted", source: { id: "backend" }, summary: "Trace accepted before cleanup" }],
    });
    ctx.onCleanup(async ({ signal }) => {
      signal.addEventListener("abort", () => {
        void (async () => {
          try {
            ctx.recordUsage({
              callId: "late-request", provider: null, model: null,
              status: "unknown", inputTokens: null, outputTokens: null,
            });
            appendFileSync("capture-late.txt", "usage-accepted\n");
          } catch {
            appendFileSync("capture-late.txt", "usage-rejected\n");
          }
          try {
            await ctx.attach({ name: "late.txt", mediaType: "text/plain", body: "must-not-publish" });
            appendFileSync("capture-late.txt", "attachment-accepted\n");
          } catch {
            appendFileSync("capture-late.txt", "attachment-rejected\n");
          }
          try {
            await ctx.recordTrace({
              traceId: "late-trace", schema: { id: "example.capture" },
              collection: { state: "complete", limitations: [] }, scopes: [], events: [],
            });
            appendFileSync("capture-late.txt", "trace-accepted\n");
          } catch {
            appendFileSync("capture-late.txt", "trace-rejected\n");
          }
        })();
      }, { once: true });
      // Deliberately non-cooperative external cleanup; only the real shared
      // 30 second budget can finish this Attempt.
      await new Promise<void>(() => {});
    });
    return { ready: true };
  },
});
