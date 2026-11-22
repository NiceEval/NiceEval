import { beforeAll, expect, test } from "vitest";
import {
  createFixtureProject,
  runSingleAttempt,
  selectInspectionOperation,
  withOperational,
} from "./fixtures/adapter-trace-usage-harness/harness.ts";

const names = [...Array.from({ length: 1_001 }, (_, index) => `completion-${index}`), "transport-detail"];

async function observeExport() {
  const project = await createFixtureProject("otlp-trace-retention", {
    "agent.ts": `
      import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
      export default defineAgent({
        name: "trace-fixture",
        evidenceCoverage: completeEvidenceCoverage,
        tracing: {},
        async send(_input, ctx) {
          const start = BigInt(Date.now()) * 1_000_000n;
          const spans = ${JSON.stringify(names)}.map((name, index) => ({
            traceId: "12".repeat(16),
            spanId: (index + 1).toString(16).padStart(16, "0"),
            name,
            startTimeUnixNano: String(start + BigInt(index) * 1_000_000n),
            endTimeUnixNano: String(start + BigInt(index + 1) * 1_000_000n),
          }));
          const response = await fetch(ctx.telemetry.endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] }),
          });
          if (!response.ok) throw new Error("Fixture OTLP export failed");
          await response.text();
          return { status: "completed", events: [] };
        },
      });
    `,
    "experiments/trace.ts": `
      import { defineExperiment } from "niceeval";
      import adapter from "../agent.ts";
      export default defineExperiment({ adapter, evals: ["trace"] });
    `,
    "evals/trace.eval.ts": `
      import { equals } from "niceeval/expect";
      import agent from "../agent.ts";
      export default agent.defineEval({ async test(t) { t.check((await t.send("trace")).status, equals("completed")); } });
    `,
  });
  try {
    const locator = await runSingleAttempt(project.cwd, "trace");
    return await withOperational(project.cwd, (facts) => {
      const first = selectInspectionOperation(facts, { kind: "attempt.trace", locator }).trace.execution;
      const summaries = first.events.map(({ summary }) => summary);
      let continuation = first.continuation;
      while (continuation !== undefined) {
        const page = selectInspectionOperation(facts, { kind: "attempt.trace", locator, continuation }).trace.execution;
        summaries.push(...page.events.map(({ summary }) => summary));
        continuation = page.continuation;
      }
      return {
        trace: first.traces.find(({ schema }) => schema.id === "niceeval.otlp"),
        omitted: first.omittedEventCount,
        firstPageCount: first.events.length,
        summaries,
      };
    });
  } finally {
    await project.dispose();
  }
}

let observed: Awaited<ReturnType<typeof observeExport>>;
beforeAll(async () => {
  observed = await observeExport();
}, 20_000);

// @feature docs/feature/inspection/README.md#portable-trace
test("OTLP span collection retains every event through paginated Inspection", () => {
  expect(observed.trace).toMatchObject({
    eventCount: names.length,
    collection: { state: "complete", limitations: [] },
  });
  expect(observed.omitted).toBe(names.length - observed.firstPageCount);
  expect(observed.summaries).toEqual(names);
});
