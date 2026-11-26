import { randomUUID } from "node:crypto";
import { Effect, Random } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createFixtureProject, type FixtureProject } from "./fixtures/adapter-trace-usage-harness/harness.ts";

let project: FixtureProject;
const probe = `experiment-backoff-${randomUUID()}`;
const firstSend = Promise.withResolvers<void>();
const rejectFirst = Promise.withResolvers<void>();
const sends: string[] = [];
const abort = new AbortController();

function runPlan(plan: Parameters<typeof experimentHost.invocation.run>[0]["plan"]) {
  return Effect.runPromise(
    experimentHost.invocation.run({ plan, signal: abort.signal }).pipe(
      Effect.provideService(Random.Random, { nextDoubleUnsafe: () => 0, nextIntUnsafe: () => 0 }),
    ),
  );
}

let running: ReturnType<typeof runPlan>;

beforeAll(async () => {
  Reflect.set(process, Symbol.for(probe), async (text: string) => {
    sends.push(text);
    if (sends.length !== 1) return false;
    firstSend.resolve();
    await rejectFirst.promise;
    return true;
  });
  const evalFile = (id: string) => `
    import { defineEval } from "niceeval";
    export default defineEval({ async test(t) { await t.send(${JSON.stringify(id)}); } });
  `;
  project = await createFixtureProject("experiment-send-backoff", {
    "agent.ts": `
      import { completeEvidenceCoverage, defineAgent, makeSendFailure } from "niceeval/adapter";
      const shouldReject = Reflect.get(process, Symbol.for(${JSON.stringify(probe)}));
      export default defineAgent({
        name: "one-rejected-send", behaviorRevision: "1", evidenceCoverage: completeEvidenceCoverage,
        classifySendFailure: () => ({ retryable: true, reason: "fixture" }),
        async send(input) {
          if (await shouldReject(input.text)) {
            throw makeSendFailure({ acceptance: "rejected", message: "first send rejected" });
          }
          return { status: "completed", events: [] };
        }
      });
    `,
    "experiments/serial.ts": `
      import { defineExperiment } from "niceeval";
      import adapter from "../agent.ts";
      export default defineExperiment({ adapter, evals: ["alpha", "beta"], maxConcurrency: 1 });
    `,
    "evals/alpha.eval.ts": evalFile("alpha"),
    "evals/beta.eval.ts": evalFile("beta"),
  });
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd: project.cwd,
      experimentSelector: "serial",
      config: { maxConcurrency: 2 },
    }),
  );
  if (planned.status !== "ready") throw new Error(JSON.stringify(planned));
  running = runPlan(planned.plan);
  await Promise.race([
    firstSend.promise,
    running.then(() => {
      throw new Error("Invocation completed before the first send");
    }),
  ]);
});

afterAll(async () => {
  rejectFirst.resolve();
  abort.abort();
  try {
    await running;
  } finally {
    Reflect.deleteProperty(process, Symbol.for(probe));
    await project?.dispose();
  }
});

// @feature docs/feature/experiments/README.md#concurrency-and-queues
test("an Experiment with maxConcurrency 1 retains its slot during a rejected send's backoff", async () => {
  rejectFirst.resolve();
  const result = await running;
  expect(result.receipt.completion).toBe("completed");
  expect(result.summary.errored).toBe(0);
  const first = sends[0];
  expect(sends).toEqual([first, first, first === "alpha" ? "beta" : "alpha"]);
});
