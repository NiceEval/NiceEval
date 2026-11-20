import { cp, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createRecordProject } from "./fixtures/record-harness/project.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect, Result } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");

const config = { maxConcurrency: 2, maxRetries: 0 };
const DEPENDENCIES = 2;

let source: string;
let originId: string;
let dependencyIds: string[];
let locator: string;

beforeAll(async () => {
  source = await createRecordProject("niceeval-record-references-", { held: false });
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({ cwd: source, experimentSelector: "runs", config, overrides: { rerun: "all", earlyExit: false } }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan Run: ${JSON.stringify(planned)}`);
  const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  originId = receipt.createdRunIds[0]!;
  const slot = (await Effect.runPromise(runHost.get({ cwd: source, runId: originId }))).run.slots[0]!.publication;
  if (slot.state !== "published") throw new Error("Expected a published origin slot");
  locator = slot.attemptLocator;
  dependencyIds = [];
  for (let index = 0; index < DEPENDENCIES; index += 1) {
    const [accepted] = await Effect.runPromise(experimentHost.accept({ cwd: source, locators: [locator], config }));
    dependencyIds.push(accepted!.runId);
  }
  // Warm the worker path on a throwaway copy so sample timings measure steady state.
  const warm = await freshProject();
  try {
    await Effect.runPromise(runHost.delete({ cwd: warm, runId: dependencyIds[0]! }));
    await listIds(warm);
  } finally {
    await rm(warm, { recursive: true, force: true });
  }
}, 30_000);

afterAll(async () => {
  if (source !== undefined) await rm(source, { recursive: true, force: true });
});

// Fresh copy of the arranged Record per sample: deletions are destructive.
async function freshProject() {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-record-delete-"));
  await cp(join(source, ".niceeval"), join(cwd, ".niceeval"), { recursive: true });
  return cwd;
}

const listIds = async (cwd: string) =>
  (await Effect.runPromise(runHost.list({ cwd }))).runs.map((run) => run.runId).sort();

// Each sample deletes from a fresh Record copy, so Vitest measures its cost separately.
const schedules: { label: string; examples: [number[]][] }[] = [
  { label: "regression: refused while referenced", examples: [[[0, 1]]] },
  { label: "regression: removed after its dependencies", examples: [[[1, 2, 0]]] },
  ...Array.from({ length: Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 3) }, (_, index) => ({
    label: `exploration ${index + 1}`,
    examples: [] as [number[]][],
  })),
];

// @feature docs/feature/run/README.md#reference-deletion
test.for(schedules)("deleting a referenced origin writes nothing, and succeeds once its dependencies are removed ($label)", { timeout: 30_000 }, async ({ examples }) => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.integer({ min: 0, max: DEPENDENCIES }), { minLength: 1, maxLength: 2 }), async (targets) => {
      const cwd = await freshProject();
      try {
        const ids = [originId, ...dependencyIds];
        const alive = new Set(ids);
        for (const target of targets) {
          const id = ids[target]!;
          const before = await readFile(join(cwd, ".niceeval", "record.sqlite"));
          const result = await Effect.runPromise(Effect.result(runHost.delete({ cwd, runId: id })));
          const dependenciesAlive = dependencyIds.some((dependency) => alive.has(dependency));
          if (!alive.has(id)) {
            expect(Result.isFailure(result) && result.failure.code).toBe("run-not-found");
          } else if (id === originId && dependenciesAlive) {
            expect(Result.isFailure(result)).toBe(true);
            if (Result.isFailure(result)) {
              expect(result.failure.code).toBe("run-referenced");
              for (const dependency of dependencyIds.filter((dep) => alive.has(dep))) {
                expect(result.failure.message).toContain(dependency);
              }
              expect(result.failure.message).toContain(locator);
            }
            // Zero writes: the origin and its Attempt stay exactly as they were.
            expect((await readFile(join(cwd, ".niceeval", "record.sqlite"))).equals(before)).toBe(true);
          } else {
            expect(Result.isSuccess(result)).toBe(true);
            alive.delete(id);
          }
        }
        expect(await listIds(cwd)).toEqual([...alive].sort());
        if (alive.has(originId)) {
          const origin = (await Effect.runPromise(runHost.get({ cwd, runId: originId }))).run;
          expect(origin.slots[0]!.publication).toMatchObject({ state: "published", attemptLocator: locator });
        }
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    }),
    { numRuns: 1, examples },
  );
});
