import { createRequire } from "node:module";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createFixtureProject,
  runSingleAttempt,
  selectInspectionOperation,
  withOperational,
  type FixtureProject,
} from "./fixtures/adapter-trace-usage-harness/harness.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Duration, Effect } =
  require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { TestClock } =
  require("effect/testing") as typeof import("../../packages/niceeval/node_modules/effect/dist/testing/index.js");

const cases = fc.sample(fc.integer({ min: 100, max: 999 }), { seed: 20261121, numRuns: 2 });
const gateKey = Symbol.for("niceeval.test.cleanup-deadline");
const projects: FixtureProject[] = [];
const observations: {
  before: string[];
  after: string[];
  diagnostic: string[];
  calls: string[];
}[] = [];

async function observe(budget: number) {
  const project = await createFixtureProject("niceeval-cleanup-deadline", {
    "adapter.ts": `
      import { defineAdapter } from "niceeval/adapter";
      function record(ctx, callId) {
        ctx.recordUsage({ callId, model: "fixture", provider: "offline", status: "succeeded", inputTokens: 1, outputTokens: 1 });
      }
      export default defineAdapter({
        name: "deadline-fixture", behaviorRevision: "1", cleanupTimeoutMs: ${budget},
        create(ctx) {
          const gate = Reflect.get(process, Symbol.for("niceeval.test.cleanup-deadline"));
          record(ctx, "during-eval");
          ctx.onCleanup(({ signal }) => new Promise((resolve) => {
            record(ctx, "before-deadline");
            gate.events.push("entered");
            signal.addEventListener("abort", () => {
              gate.events.push("aborted");
              try {
                record(ctx, "after-deadline");
                gate.events.push("late-accepted");
              } catch {
                gate.events.push("late-rejected");
              } finally {
                resolve();
              }
            }, { once: true });
            gate.entered.resolve();
          }));
          return {};
        },
      });
    `,
    "experiments/deadline.ts": `
      import { defineExperiment } from "niceeval";
      import adapter from "../adapter.ts";
      export default defineExperiment({ adapter, evals: ["deadline"] });
    `,
    "evals/deadline.eval.ts": `
      import { equals } from "niceeval/expect";
      import adapter from "../adapter.ts";
      export default adapter.defineEval({ test(t) { t.check(true, equals(true)); } });
    `,
  });
  projects.push(project);
  const entered = Promise.withResolvers<void>();
  const armed = Promise.withResolvers<void>();
  const events: string[] = [];
  Reflect.set(process, gateKey, { entered, events });
  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const base = yield* TestClock.make();
          yield* base.setTime(Date.now());
          const clock = {
            ...base,
            sleep: (duration: Parameters<typeof base.sleep>[0]) =>
              Effect.suspend(() => {
                if (Duration.toMillis(duration) === budget) armed.resolve();
                return base.sleep(duration);
              }),
          };
          const published = runSingleAttempt(project.cwd, "deadline", clock);
          void published.catch(() => {});
          yield* Effect.promise(() =>
            Promise.race([
              Promise.all([entered.promise, armed.promise]),
              published.then(() => {
                throw new Error("Attempt closed before arming cleanup");
              }),
            ]),
          );
          yield* base.adjust(budget - 1);
          const before = [...events];
          yield* base.adjust(1);
          const locator = yield* Effect.promise(() => published);
          return yield* Effect.promise(() =>
            withOperational(project.cwd, (facts) => {
              const attempt = selectInspectionOperation(facts, { kind: "attempt.get", locator }).attempt;
              const usage = selectInspectionOperation(facts, { kind: "attempt.usage", locator }).usage;
              return {
                before,
                after: [...events],
                diagnostic: attempt.diagnostics.items.map(({ code }) => code),
                calls: (usage.calls ?? []).map(({ callId }) => callId),
              };
            }),
          );
        }),
      ),
    );
  } finally {
    Reflect.deleteProperty(process, gateKey);
  }
}

beforeAll(async () => {
  for (const budget of cases) observations.push(await observe(budget));
}, 20_000);

afterAll(async () => {
  await Promise.all(projects.map((project) => project.dispose()));
});

// @feature docs/feature/experiments/README.md#cleanup-deadline
test("cleanup aborts once at the declared deadline and admits only evidence recorded before it", () => {
  for (const [index, { before, after, calls, diagnostic }] of observations.entries()) {
    const context = `cleanup budget ${cases[index]}ms`;
    expect(before, context).toEqual(["entered"]);
    expect(after, context).toEqual(["entered", "aborted", "late-rejected"]);
    expect(calls, context).toEqual(["during-eval", "before-deadline"]);
    expect(diagnostic, context).toContain("adapter-cleanup-timeout");
  }
});
