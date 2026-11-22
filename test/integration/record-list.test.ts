import { rm } from "node:fs/promises";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Effect, Result } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import { createRecordProject } from "./fixtures/record-harness/project.ts";

const config = { maxConcurrency: 2, maxRetries: 0 };
let cwd: string;
let newestFirst: string[];

beforeAll(async () => {
  cwd = await createRecordProject("niceeval-record-list-", { held: false });
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({ cwd, experimentSelector: "runs", config, overrides: { rerun: "all", earlyExit: false } }),
  );
  if (planned.status !== "ready") throw new Error("Could not plan Run");
  const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  const origin = receipt.createdRunIds[0]!;
  const slot = (await Effect.runPromise(runHost.get({ cwd, runId: origin }))).run.slots[0]!.publication;
  if (slot.state !== "published") throw new Error("Expected a published slot");
  const created = [origin];
  for (let index = 0; index < 2; index += 1) {
    const [accepted] = await Effect.runPromise(experimentHost.accept({ cwd, locators: [slot.attemptLocator], config }));
    created.push(accepted!.runId);
  }
  newestFirst = created.reverse();
}, 30_000);

afterAll(async () => {
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

// @use-case docs/feature/run/use-case/应用中列出运行.md
test("Run listing is newest-first, filtered by state and Experiment prefix, and reports how many Runs the limit omitted", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.subarray(["active", "recovering", "completed", "interrupted", "failed"] as const),
      fc.constantFrom("runs", "run", "r", "other"),
      fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }),
      async (states, prefix, limit) => {
        const result = await Effect.runPromise(
          runHost.list({
            cwd,
            ...(states.length > 0 ? { states: states as [(typeof states)[number], ...(typeof states)[number][]] } : {}),
            experimentIdPrefix: prefix,
            ...(limit === undefined ? {} : { limit }),
          }),
        );
        const prefixMatches = prefix === "runs";
        const expected = (states.length === 0 || states.includes("completed")) && prefixMatches ? newestFirst : [];
        const kept = limit === undefined ? expected : expected.slice(0, limit);
        expect(result.runs.map((run) => run.runId)).toEqual(kept);
        expect(result.omitted).toBe(expected.length - kept.length);
      },
    ),
    { numRuns: 12 },
  );
});

// @use-case docs/feature/run/use-case/应用中列出运行.md
test("invalid list filters are domain rejections", async () => {
  for (const request of [{ limit: 0 }, { limit: 1.5 }, { continuation: "not-a-continuation" }]) {
    const result = await Effect.runPromise(Effect.result(runHost.list({ cwd, ...request })));
    expect(Result.isFailure(result) && result.failure.code).toMatch(/^run-(filter-invalid|continuation-invalid)$/u);
  }
});
