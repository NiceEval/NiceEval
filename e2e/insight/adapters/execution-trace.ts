import { defineAdapter } from "niceeval/adapter";

export const executionTrace = defineAdapter({
  name: "execution-trace-browser",
  behaviorRevision: "1",
  create(ctx) {
    return {
      async archive() {
        const artifact = await ctx.attach({
          name: "original-event.json", mediaType: "application/json",
          body: JSON.stringify({ event: { result: "sealed-evidence-browser-sentinel", position: { x: 12, y: 4 } } }),
        });
        await ctx.recordTrace({
          traceId: "sealed-world", schema: { id: "example.world", revision: 1 },
          collection: { state: "complete", limitations: [] }, scopes: [],
          events: [{
            key: "0", type: "operation.completed", source: { id: "server", eventId: "real-event-1" },
            actor: { id: "courier", label: "Courier" }, time: { clockId: "world", value: 12, unit: "seconds" },
            summary: "Courier reached the observed destination",
            evidence: [{ key: "original", label: "Original movement", artifactId: artifact.artifactId, pointer: "/event" }],
          }],
        });
        return true;
      },
    };
  },
});
