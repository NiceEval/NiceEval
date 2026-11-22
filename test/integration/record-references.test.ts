import { cp, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
  try {
    await cp(join(source, ".niceeval"), join(cwd, ".niceeval"), { recursive: true });
    return cwd;
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

const listIds = async (cwd: string) =>
  (await Effect.runPromise(runHost.list({ cwd }))).runs.map((run) => run.runId).sort();

async function deleteAndCheck(cwd: string, id: string, alive: Set<string>) {
  const liveReferences = dependencyIds.filter((dependency) => alive.has(dependency));
  const referencedOrigin = id === originId && alive.has(id) && liveReferences.length > 0;
  const record = join(cwd, ".niceeval", "record.sqlite");
  const before = referencedOrigin ? await readFile(record) : undefined;
  const result = await Effect.runPromise(Effect.result(runHost.delete({ cwd, runId: id })));
  if (!alive.has(id)) {
    expect(Result.isFailure(result) && result.failure.code).toBe("run-not-found");
  } else if (referencedOrigin) {
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe("run-referenced");
      for (const dependency of liveReferences) expect(result.failure.message).toContain(dependency);
      expect(result.failure.message).toContain(locator);
    }
    expect((await readFile(record)).equals(before!)).toBe(true);
  } else {
    expect(Result.isSuccess(result)).toBe(true);
    alive.delete(id);
  }
}

async function expectRemaining(cwd: string, alive: Set<string>) {
  const [remaining, origin] = await Promise.all([
    listIds(cwd),
    alive.has(originId) ? Effect.runPromise(runHost.get({ cwd, runId: originId })) : undefined,
  ]);
  expect(remaining).toEqual([...alive].sort());
  if (alive.has(originId)) {
    expect(origin?.run.slots[0]?.publication).toMatchObject({ state: "published", attemptLocator: locator });
  }
}

// Each sample deletes from a fresh Record copy, including during shrink.
const explorations = Array.from({ length: Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 3) }, (_, index) => index + 1);

// @feature docs/feature/run/README.md#reference-deletion
test.for(explorations)(
  "deletion follows the live reference set (exploration %s)",
  { timeout: 30_000 },
  async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: DEPENDENCIES }), { minLength: 1, maxLength: 2 }),
        async (targets) => {
          const cwd = await freshProject();
          try {
            const ids = [originId, ...dependencyIds];
            const alive = new Set(ids);
            for (const target of targets) await deleteAndCheck(cwd, ids[target]!, alive);
            await expectRemaining(cwd, alive);
          } finally {
            await rm(cwd, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 1 },
    );
  },
);

describe("deleting a referenced origin, then one of its dependencies", () => {
  let cwd: string;
  let alive: Set<string>;
  let refusal: Promise<void> | undefined;
  const refuseOrigin = () => (refusal ??= deleteAndCheck(cwd, originId, alive));

  beforeAll(async () => {
    cwd = await freshProject();
    alive = new Set([originId, ...dependencyIds]);
  });

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/run/README.md#reference-deletion
  test("refuses to delete the referenced origin without changing the Record", async () => {
    await refuseOrigin();
  });

  describe("after the origin deletion is refused", () => {
    beforeAll(refuseOrigin);

    // @feature docs/feature/run/README.md#reference-deletion
    test("one dependency can still be deleted and the origin Attempt stays readable", async () => {
      await deleteAndCheck(cwd, dependencyIds[0]!, alive);
      await expectRemaining(cwd, alive);
    });
  });
});

describe("retrying origin deletion after dropping its dependencies", () => {
  let cwd: string | undefined;

  beforeAll(async () => {
    cwd = await freshProject();
    for (const runId of dependencyIds) {
      await Effect.runPromise(runHost.delete({ cwd, runId }));
    }
    expect(await listIds(cwd)).toEqual([originId]);
  }, 30_000);

  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/run/README.md#reference-deletion
  test("the origin can be deleted when its last reference is removed", async () => {
    await Effect.runPromise(runHost.delete({ cwd: cwd!, runId: originId }));
    expect(await listIds(cwd!)).toEqual([]);
  });
});
