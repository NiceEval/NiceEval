import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createExperimentBatch, planBatch, withSlowAttachmentReads } from "./fixtures/record-harness/experiment-batch.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");

let batch: Awaited<ReturnType<typeof createExperimentBatch>>;
let planned: Awaited<ReturnType<typeof planBatch>>;

beforeAll(async () => {
  batch = await createExperimentBatch(["first"]);
  planned = await planBatch(batch.cwd, ["runs", "more"]);
}, 20_000);

afterAll(async () => {
  if (batch !== undefined) await rm(batch.cwd, { recursive: true, force: true });
});

// @feature docs/feature/experiments/README.md#partial-reuse
test("carries eligible results across Experiments when attachment reads span a deadline", async () => {
  const result = await withSlowAttachmentReads(
    () => Effect.runPromise(experimentHost.invocation.run({ plan: planned })),
    3_000,
  );
  expect(result.receipt.completion).toBe("completed");
  const runs = await Promise.all(
    result.receipt.createdRunIds.map((runId) => Effect.runPromise(runHost.get({ cwd: batch.cwd, runId }))),
  );
  const published = new Map<string, string>();
  for (const { run } of runs) {
    for (const { evalId, publication } of run.slots) {
      expect(publication).toMatchObject({ state: "published", action: "carried" });
      if (publication.state === "published") published.set(`${run.experimentId}/${evalId}`, publication.attemptLocator);
    }
  }
  expect(published).toEqual(batch.locators);
});
