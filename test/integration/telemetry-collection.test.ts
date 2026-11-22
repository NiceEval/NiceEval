import { mkdir, readFile, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import fc from "fast-check";
import { beforeAll, expect, test } from "vitest";
import {
  Clock,
  createFixtureProject,
  Duration,
  Effect,
  runSingleAttempt,
  selectInspectionOperation,
  withOperational,
} from "./fixtures/adapter-trace-usage-harness/harness.ts";

async function observeCollection(paddingMiB: number, readsBeforeTimeout: number, compressible = true) {
  const hookKey = `niceeval-telemetry-test-${crypto.randomUUID()}`;
  const stalledRead = Promise.withResolvers<void>();
  const hooks = globalThis as unknown as Record<string, () => void>;
  const project = await createFixtureProject("telemetry-collection", {
    "sandbox-base.ts": await readFile(new URL("./fixtures/inspection-core/sandbox.ts.txt", import.meta.url), "utf8"),
    "sandbox.ts": `
      import { Effect } from "effect";
      import { defineSandbox } from "niceeval/sandbox";
      import { hostPlatform, hostSandbox } from "./sandbox-base.ts";
      export default defineSandbox({
        name: "telemetry-fixture",
        exclusive: true,
        targetPlatform: hostPlatform(),
        create: () => Effect.promise(async () => {
          const sandbox = await hostSandbox();
          let reads = 0;
          const collect = (read, options) => {
            if (++reads <= ${readsBeforeTimeout}) return read();
            globalThis[${JSON.stringify(hookKey)}]();
            return new Promise((_, reject) => {
              const signal = options.signal;
              if (signal.aborted) reject(signal.reason);
              else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
          };
          return {
            ...sandbox,
            otlpHost: null,
            runShell(script, options) {
              const run = () => sandbox.runShell(script, options);
              return script.includes("dd if=/tmp/.niceeval-otlp-spans-") ? collect(run, options) : run();
            },
            runCommand(command, args, options) {
              const run = () => sandbox.runCommand(command, args, options);
              return args?.some((arg) => arg.startsWith("/tmp/.niceeval-otlp-spans-")) ? collect(run, options) : run();
            },
          };
        }),
      });
    `,
    "agent.ts": `
      import { createCipheriv } from "node:crypto";
      import { gzipSync } from "node:zlib";
      import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
      import { shell } from "niceeval/sandbox";

      const padding = ${compressible}
        ? "a".repeat(${paddingMiB} * 1024 * 1024)
        : createCipheriv("aes-128-ctr", Buffer.alloc(16), Buffer.alloc(16))
            .update(Buffer.alloc(${paddingMiB} * 1024 * 1024)).toString("base64");

      export default defineSandboxAgent({
        name: "telemetry-fixture",
        install: { identity: { agent: "telemetry-fixture", version: "1", revision: "1" }, probe: shell("true") },
        evidenceCoverage: completeEvidenceCoverage,
        tracing: {},
        async send(_input, ctx) {
          for (const [i, name] of ["first-span", "large-span", "last-span"].entries()) {
            const span = {
              traceId: "abcd", spanId: "span-" + i, name,
              startTimeUnixNano: String((i + 1) * 1_000_000),
              endTimeUnixNano: String((i + 2) * 1_000_000),
            };
            const payload = JSON.stringify({
              resourceSpans: [{ scopeSpans: [{ spans: [span] }] }],
              padding: i === 1 ? padding : "",
            });
            const response = await fetch(ctx.telemetry.endpoint, {
              method: "POST", body: i === 1 ? gzipSync(payload) : payload,
              headers: {
                "content-type": "application/json",
                ...(i === 1 ? { "content-encoding": "gzip" } : {}),
              },
            });
            if (!response.ok) throw new Error("fixture OTLP export failed");
            await response.text();
          }
          return {
            status: "completed",
            usage: { inputTokens: 3, outputTokens: 2 },
            events: [
              { type: "operation.started", operationId: "tool", operation: { kind: "tool", name: "fixture-tool" } },
              { type: "operation.finished", operationId: "tool", kind: "tool", status: "completed" },
              { type: "message", role: "assistant", text: "Done." },
            ],
          };
        },
      });
    `,
    "experiments/trace.ts": `
      import { defineExperiment } from "niceeval";
      import adapter from "../agent.ts";
      import sandbox from "../sandbox.ts";
      export default defineExperiment({ adapter, sandbox, evals: ["trace"] });
    `,
    "evals/trace.eval.ts": `
      import { equals } from "niceeval/expect";
      import agent from "../agent.ts";
      export default agent.defineEval({ async test(t) { t.check((await t.send("trace")).status, equals("completed")); } });
    `,
  });
  hooks[hookKey] = stalledRead.resolve;
  try {
    const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
    const dependencies = join(project.cwd, "node_modules");
    await mkdir(dependencies);
    await symlink(dirname(require.resolve("effect/package.json")), join(dependencies, "effect"), "dir");
    const clock = await Effect.runPromise(Clock.clockWith(Effect.succeed));
    const budgetClock: typeof clock = Object.create(clock);
    budgetClock.sleep = (duration) => {
      if (readsBeforeTimeout !== 1 || Duration.toMillis(duration) !== 30_000) return clock.sleep(duration);
      // Other scoped work can register a deadline of the same duration before collection.
      // Advance the budget only once the provider has attempted the stalled read.
      return Effect.promise(() => stalledRead.promise);
    };
    const locator = await runSingleAttempt(project.cwd, "trace", budgetClock);
    return await withOperational(project.cwd, (facts) => ({
      trace: selectInspectionOperation(facts, { kind: "attempt.trace", locator }).trace,
      attempt: selectInspectionOperation(facts, { kind: "attempt.get", locator }).attempt,
      timing: selectInspectionOperation(facts, { kind: "attempt.timing", locator }).timing,
      usage: selectInspectionOperation(facts, { kind: "attempt.usage", locator }).usage,
    }));
  } finally {
    delete hooks[hookKey];
    await project.dispose();
  }
}

const compressibleAttempts = new Map<number, Awaited<ReturnType<typeof observeCollection>>>();
const interruptedAttempts = new Map<number, Awaited<ReturnType<typeof observeCollection>>>();
let highEntropyAttempt: Awaited<ReturnType<typeof observeCollection>>;

beforeAll(async () => {
  for (const paddingMiB of [4, 5]) {
    const [complete, interrupted] = await Promise.all([
      observeCollection(paddingMiB, 2),
      observeCollection(paddingMiB, 1),
    ]);
    compressibleAttempts.set(paddingMiB, complete);
    interruptedAttempts.set(paddingMiB, interrupted);
  }
  highEntropyAttempt = await observeCollection(2, 4, false);
}, 30_000);

// @feature docs/feature/inspection/README.md#portable-trace
test("compressible OTLP exports reach the trace tail within a constrained read budget", () => {
  fc.assert(
    fc.property(fc.integer({ min: 4, max: 5 }), (paddingMiB) => {
      const { trace, timing } = compressibleAttempts.get(paddingMiB)!;
      const collection = trace.execution.traces.find((item) => item.schema.id === "niceeval.otlp")?.collection;
      expect(collection).toEqual({ state: "complete", limitations: [] });
      expect(trace.execution.events.map((event) => event.summary)).toEqual(["first-span", "large-span", "last-span"]);
      const reads = timing.activities.filter((activity) => activity.label.startsWith("telemetry.read.bytes."));
      const bytes = reads.reduce((total, activity) => total + Number(activity.label.split(".").at(-1)), 0);
      expect(bytes).toBeLessThan(64 * 1024);
    }),
    { numRuns: 2, examples: [[4]], seed: 7493 },
  );
});

// @feature docs/feature/inspection/README.md#portable-trace
test("an interrupted OTLP read discloses the missing spans and preserves behavior evidence", () => {
  fc.assert(
    fc.property(fc.integer({ min: 4, max: 5 }), (paddingMiB) => {
      const { attempt, trace, usage } = interruptedAttempts.get(paddingMiB)!;
      const diagnostic = trace.diagnostics.items.find((item) => item.code === "telemetry-budget-exceeded");
      expect(diagnostic?.summary).toMatch(/telemetry\.read.*unread data/);
      expect(diagnostic?.summary).toMatch(/Decoded span count: 1\. Bytes received in completed transfers: \d+\./);
      expect(trace.execution.traces.find((item) => item.schema.id === "niceeval.otlp")?.collection).toEqual({
        state: "partial",
        limitations: [{ code: "telemetry-budget-exceeded", message: diagnostic?.summary }],
      });
      expect(trace.execution.events.map((event) => event.summary)).toEqual(["first-span"]);
      expect(trace.identityIndex.toolOccurrenceIds.ids).toHaveLength(1);
      expect(attempt.verdict).toBe("passed");
      expect(attempt.evidenceCoverage).toEqual(
        ["actions", "data", "events", "messages", "status", "usage"].map((channel) => ({ channel, status: "complete" })),
      );
      expect(usage.totals).toMatchObject({ inputTokens: { value: 3 }, outputTokens: { value: 2 } });
    }),
    { numRuns: 2, examples: [[4]], seed: 7493 },
  );
});

// @feature docs/feature/inspection/README.md#portable-trace
test("raw fallback reads preserve the span across chunk boundaries", () => {
  const { trace, timing } = highEntropyAttempt;
  expect(trace.execution.traces.find((item) => item.schema.id === "niceeval.otlp")?.collection).toEqual({
    state: "complete",
    limitations: [],
  });
  expect(trace.execution.events.map((event) => event.summary)).toEqual(["first-span", "large-span", "last-span"]);
  const reads = timing.activities.filter((activity) => activity.label.startsWith("telemetry.read.bytes."));
  expect(reads.filter((activity) => activity.label === "telemetry.read.bytes.1398106")).toHaveLength(3);
});
