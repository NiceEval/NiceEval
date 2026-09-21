import { defineAdapter, type ExecutionTraceInput } from "niceeval";
import { writeFile } from "node:fs/promises";

export const executionTraceAdapter = defineAdapter({
  name: "execution-trace-fixture",
  behaviorRevision: "1",
  create(ctx) {
    return {
      async archive() {
        const originals = Array.from({ length: 10_003 }, (_, index) => ({
          ...(index === 10_001 ? {} : { eventId: `source-${index}` }),
          origin: index % 2 === 0 ? "server" : "client",
          type: index === 0 ? "model.request" : index === 10_002 ? "operation.completed" : "position.observed",
          data: index === 0
            ? { context: "request-evidence-sentinel", input: "large input ".repeat(3_000) }
            : { x: index, result: index === 10_002 ? "actual-movement-sentinel" : "observed" },
        }));
        const artifact = await ctx.attach({
          name: "sealed-events.json",
          mediaType: "application/json",
          body: JSON.stringify({ events: originals }),
        });
        const snapshot: ExecutionTraceInput = {
          traceId: "sealed-session",
          schema: { id: "example.simulation", revision: 1 },
          collection: { state: "complete", limitations: [] },
          scopes: [{ scopeId: "measurement", label: "Measured interval", boundary: { throughSequence: 10_000, gameTime: 20 } }],
          events: originals.map((event, index) => ({
            key: String(index),
            type: event.type,
            source: {
              id: event.origin,
              ...(event.eventId === undefined ? {} : { eventId: event.eventId }),
              ...(event.origin === "client" ? { sequence: index } : {}),
            },
            actor: { id: index % 2 === 0 ? "actor-a" : "actor-b", label: index % 2 === 0 ? "Courier" : "Guide" },
            time: { clockId: "simulation", value: index / 100, unit: "seconds" },
            summary: index === 10_002 ? "Movement completed after measurement" : `Observed event ${index}`,
            // Legal domain keys must never be confused with an internal codec error.
            payload: index === 10_001 ? { code: "inspection-result-invalid", reason: "domain-value", ["__proto__"]: { domain: "preserved" } } : { x: index },
            links: index === 10_002 ? [{ relation: "model-request", targetKey: "0" }] : [],
            evidence: [
              { key: "original", label: "Original event", artifactId: artifact.artifactId, pointer: `/events/${index}` },
              ...(index === 10_002 ? [{ key: "request", label: "Referenced request", artifactId: artifact.artifactId, pointer: "/events/0" }] : []),
            ],
            scopeMemberships: [{ scopeId: "measurement", state: index > 10_000 ? "excluded" : event.origin === "server" ? "unknown" : "included" }],
          })),
        };
        const receipt = await ctx.recordTrace(snapshot);
        const again = await ctx.recordTrace(snapshot);
        if (JSON.stringify(receipt) !== JSON.stringify(again)) throw new Error("Duplicate archive changed stable identities");
        const last = receipt.events.find((event) => event.key === "10002")!;
        const missingNative = receipt.events.find((event) => event.key === "10001")!;
        // These selectors come from the public acceptance receipt, not private Record bytes.
        await writeFile("execution-selectors.txt", [last.eventId, last.evidence.find((item) => item.key === "request")!.evidenceId, missingNative.eventId].join("\n"));
        return true;
      },
    };
  },
});
