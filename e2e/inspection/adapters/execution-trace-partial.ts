import { defineAdapter } from "niceeval";

export const partialExecutionTraceAdapter = defineAdapter({
  name: "partial-execution-trace-fixture",
  behaviorRevision: "1",
  create(ctx) {
    return {
      async archive(eventCount: number) {
        await ctx.recordTrace({
          traceId: "partial-journal",
          schema: { id: "example.telemetry" },
          collection: {
            state: "partial",
            limitations: [{ code: "producer-stream-interrupted", message: "Upstream journal ended before final acknowledgement." }],
          },
          scopes: [],
          events: Array.from({ length: eventCount }, (_, index) => ({
            key: String(index),
            type: "observation.recorded",
            source: { id: "telemetry-journal", sequence: index },
            actor: { id: "observer", label: "Observer" },
            summary: `Retained observation ${index}`,
          })),
        });
        return true;
      },
    };
  },
});
