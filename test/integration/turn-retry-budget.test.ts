import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Clock, Duration, Effect, Random } from "effect";
import { TestClock } from "effect/testing";
import { experimentHost } from "niceeval/experiment/host";
import { createFixtureProject, type FixtureProject } from "./fixtures/adapter-trace-usage-harness/harness.ts";

const fixture = {
  "agent.ts": `
    import { appendFileSync, readFileSync } from "node:fs";
    import { completeEvidenceCoverage, defineAgent, makeSendFailure } from "niceeval/adapter";
    const scenario = () => JSON.parse(readFileSync(new URL("scenario.json", import.meta.url), "utf8"));
    export default defineAgent({
      name: "retry-property", behaviorRevision: "1", evidenceCoverage: completeEvidenceCoverage,
      classifySendFailure: () => ({ retryable: true, reason: "fixture-rejection" }),
      async send(input) {
        appendFileSync(new URL("sent.txt", import.meta.url), input.text + "\\n");
        const sent = readFileSync(new URL("sent.txt", import.meta.url), "utf8").trim().split("\\n");
        const copies = sent.filter((text) => text === input.text).length;
        const { rejectCount, acceptance } = scenario();
        if (copies <= rejectCount) throw makeSendFailure({ acceptance, message: "fixture" });
        return { status: "completed", events: [] };
      },
    });
  `,
  "experiments/retry.ts": `
    import { defineExperiment } from "niceeval";
    import adapter from "../agent.ts";
    export default defineExperiment({ adapter, evals: ["retry"], attempts: 1 });
  `,
  "evals/retry.eval.ts": `
    import { defineEval } from "niceeval";
    import { readFileSync } from "node:fs";
    export default defineEval({ async test(t) {
      const { turns } = JSON.parse(readFileSync(new URL("../scenario.json", import.meta.url), "utf8"));
      for (let index = 0; index < turns; index++) await t.send("turn-" + index);
    } });
  `,
};

type Scenario = { rejectCount: number; turns: number; acceptance: "rejected" | "started" | "unknown" };

const scenario: fc.Arbitrary<Scenario> = fc.record({
  rejectCount: fc.integer({ min: 1, max: 5 }),
  turns: fc.integer({ min: 1, max: 9 }),
  acceptance: fc.constantFrom("rejected", "unknown", "started"),
});

function expectedResult({ rejectCount, turns, acceptance }: Scenario) {
  let remaining = 8;
  const sent: string[] = [];
  for (let index = 0; index < turns; index++) {
    const retries = acceptance === "rejected" ? Math.min(3, remaining, rejectCount) : 0;
    sent.push(...Array.from({ length: 1 + retries }, () => `turn-${index}`));
    if (retries < rejectCount) return { sent, errored: 1 };
    remaining -= retries;
  }
  return { sent, errored: 0 };
}

let project: FixtureProject;

async function prepare(actions: Scenario) {
  const { cwd } = project;
  const sentPath = join(cwd, "sent.txt");
  await Promise.all([writeFile(sentPath, ""), writeFile(join(cwd, "scenario.json"), JSON.stringify(actions))]);
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "retry",
      config: { maxConcurrency: 1 },
      overrides: { rerun: "all" },
    }),
  );
  if (planned.status !== "ready") throw new Error(JSON.stringify(planned));
  return { plan: planned.plan, sentPath };
}

beforeAll(async () => {
  project = await createFixtureProject("niceeval-turn-retry", fixture);
  // Initialize import, Record and Run resources once before measuring retry cases.
  const { plan } = await prepare({ rejectCount: 0, turns: 1, acceptance: "rejected" });
  await Effect.runPromise(experimentHost.invocation.run({ plan }));
});

afterAll(async () => {
  await project?.dispose();
});

const cases: [string, fc.Arbitrary<Scenario>][] = [
  [
    "per-send budget",
    fc.record({
      rejectCount: fc.integer({ min: 4, max: 5 }),
      turns: fc.integer({ min: 1, max: 3 }),
      acceptance: fc.constant("rejected"),
    }),
  ],
  [
    "Attempt budget",
    fc.record({
      rejectCount: fc.integer({ min: 1, max: 3 }),
      turns: fc.integer({ min: 9, max: 11 }),
      acceptance: fc.constant("rejected"),
    }),
  ],
  [
    "unproven acceptance",
    fc.record({
      rejectCount: fc.integer({ min: 1, max: 2 }),
      turns: fc.integer({ min: 1, max: 3 }),
      acceptance: fc.constantFrom("started", "unknown"),
    }),
  ],
  ["generated input", scenario],
];

for (const [label, arbitrary] of cases) {
  // @feature docs/feature/error-classification/README.md#bounded-send-retry
  test(`adapter sends respect the retry safety and budget for ${label}`, async () => {
    await fc.assert(
      fc.asyncProperty(arbitrary, async (actions) => {
        const { plan, sentPath } = await prepare(actions);
        // Zero is a legal jitter sample. It keeps the budget test independent of real backoff delays.
        const response = await Effect.runPromise(
          experimentHost.invocation
            .run({ plan })
            .pipe(Effect.provideService(Random.Random, { nextDoubleUnsafe: () => 0, nextIntUnsafe: () => 0 })),
        );
        const sent = (await readFile(sentPath, "utf8")).trim().split("\n");
        expect({ sent, errored: response.summary.errored }, JSON.stringify(actions)).toEqual(expectedResult(actions));
      }),
      { numRuns: 1, seed: 20261121 },
    );
  });
}

for (const cancel of [false, true]) {
  // @feature docs/feature/error-classification/README.md#send-backoff
  test(`Send backoff ${cancel ? "ends on Invocation cancellation" : "waits until its deadline"}`, async () => {
    const { plan, sentPath } = await prepare({ rejectCount: 1, turns: 1, acceptance: "rejected" });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const base = yield* TestClock.make();
          yield* base.setTime(Date.now());
          const armed = Promise.withResolvers<void>();
          const abort = new AbortController();
          const clock = {
            ...base,
            sleep: (duration: Parameters<typeof base.sleep>[0]) =>
              Effect.suspend(() => {
                if (Duration.toMillis(duration) === 5_000) armed.resolve();
                return base.sleep(duration);
              }),
          };

          const running = Effect.runPromise(
            experimentHost.invocation
              .run({ plan, signal: abort.signal })
              .pipe(
                Effect.provideService(Clock.Clock, clock),
                Effect.provideService(Random.Random, { nextDoubleUnsafe: () => 1, nextIntUnsafe: () => 1 }),
              ),
          );
          void running.catch(() => {});
          const sent = () => Effect.promise(() => readFile(sentPath, "utf8"));
          try {
            yield* Effect.promise(() =>
              Promise.race([
                armed.promise,
                running.then(() => {
                  throw new Error("Invocation closed before arming backoff");
                }),
              ]),
            );
            yield* base.adjust(4_999);
            expect(yield* sent()).toBe("turn-0\n");
            if (cancel) abort.abort();
            else yield* base.adjust(1);
            const result = yield* Effect.promise(() => running);
            yield* base.adjust(5_000);
            expect(result.receipt.completion).toBe(cancel ? "interrupted" : "completed");
            expect(yield* sent()).toBe(cancel ? "turn-0\n" : "turn-0\nturn-0\n");
          } finally {
            abort.abort();
            yield* Effect.promise(() => running.catch(() => {}));
          }
        }),
      ),
    );
  });
}
