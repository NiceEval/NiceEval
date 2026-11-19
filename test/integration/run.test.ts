import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, truncate, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");

const gateSymbol = Symbol.for("niceeval.test.run-gates");
const gates = new Map<string, { release: Promise<void>; entered: () => void }>();
const config = { maxConcurrency: 2, maxRetries: 0 };

async function prepareProject(held: boolean) {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-run-property-"));
  try {
    await Promise.all(["evals", "experiments"].map((dir) => mkdir(join(cwd, dir))));
    await Promise.all([
      writeFile(
        join(cwd, "adapter.ts"),
        `
        import { defineAdapter } from "niceeval/adapter";
        import { equals } from "niceeval/expect";
        export default defineAdapter({
          name: "run-property", behaviorRevision: "1", create: () => ({}),
          assertions: ({ check }) => ({ ready: () => check(1, equals(1)) }),
        });
      `,
      ),
      writeFile(
        join(cwd, "experiments", "runs.ts"),
        `
        import { defineExperiment } from "niceeval";
        import adapter from "../adapter.ts";
        export default defineExperiment({ adapter, evals: ${JSON.stringify(held ? ["first", "held"] : ["first"])}, attempts: 1 });
      `,
      ),
      writeFile(
        join(cwd, "evals", "first.eval.ts"),
        `
        import adapter from "../adapter.ts";
        export default adapter.defineEval({ test(t) { t.ready(); } });
      `,
      ),
      ...(held
        ? [
            writeFile(
              join(cwd, "evals", "held.eval.ts"),
              `
          import process from "node:process";
          import adapter from "../adapter.ts";
          export default adapter.defineEval({
            async test(t) {
              const gate = Reflect.get(process, Symbol.for("niceeval.test.run-gates")).get(${JSON.stringify(cwd)});
              gate.entered();
              await gate.release;
              t.ready();
            },
          });
        `,
            ),
          ]
        : []),
    ]);
    return cwd;
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

async function runExperiment(cwd: string) {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "runs",
      config,
      overrides: { rerun: "all", earlyExit: false },
    }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan Run: ${JSON.stringify(planned)}`);
  return Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
}

async function getRun(cwd: string, runId: string) {
  return (await Effect.runPromise(runHost.get({ cwd, runId }))).run;
}

describe("publication visibility", () => {
  let cwd: string;
  let runId: string;
  let running: ReturnType<typeof runExperiment> | undefined;
  const release = Promise.withResolvers<void>();

  beforeAll(async () => {
    cwd = await prepareProject(true);
    const entered = Promise.withResolvers<void>();
    Reflect.set(process, gateSymbol, gates);
    gates.set(cwd, { release: release.promise, entered: entered.resolve });
    running = runExperiment(cwd);

    const abort = new AbortController();
    try {
      await Promise.race([
        entered.promise,
        running.then(() => {
          throw new Error("Run closed before the held Eval started");
        }),
        setTimeout(8_000, undefined, { signal: abort.signal, ref: false }).then(() => {
          throw new Error("Held Eval never started");
        }),
      ]);
    } finally {
      abort.abort();
    }

    const deadline = Date.now() + 4_000;
    do {
      const [summary] = (await Effect.runPromise(runHost.list({ cwd }))).runs;
      if (summary) {
        expect(summary.coverage.expected).toBe(2);
        const run = await getRun(cwd, summary.runId);
        if (run.coverage.published === 1) {
          runId = run.runId;
          return;
        }
      }
      await setTimeout(10);
    } while (Date.now() < deadline);
    throw new Error("The first Attempt did not publish while the second was held");
  }, 15_000);

  afterAll(async () => {
    release.resolve();
    try {
      if (running !== undefined) expect((await running).receipt.completion).toBe("completed");
    } finally {
      gates.delete(cwd);
      Reflect.deleteProperty(process, gateSymbol);
      if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
    }
  });

  // @feature docs/feature/run/README.md#publication-visibility
  test("published slots are readable while the origin Run is active", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom("list", "get"), { minLength: 1, maxLength: 4 }), async (reads) => {
        const observations = await Promise.all(
          reads.map((read) =>
            read === "list"
              ? Effect.runPromise(runHost.list({ cwd })).then(({ runs }) => runs.find((run) => run.runId === runId))
              : getRun(cwd, runId),
          ),
        );
        for (const observation of observations) {
          expect(observation?.state).toBe("active");
          expect(observation?.coverage).toEqual({ expected: 2, published: 1, missing: 1 });
        }
        const run = await getRun(cwd, runId);
        expect(run.slots.map(({ evalId, publication }) => [evalId, publication.state]).sort()).toEqual([
          ["first", "published"],
          ["held", "pending"],
        ]);
      }),
      { numRuns: Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 4) },
    );
  });
});

describe("historical results", () => {
  let source: string;
  let historical: Awaited<ReturnType<typeof getRun>>;

  beforeAll(async () => {
    source = await prepareProject(false);
    const { receipt } = await runExperiment(source);
    historical = await getRun(source, receipt.createdRunIds[0]!);
    expect(historical.state).toBe("completed");
  }, 15_000);

  afterAll(async () => {
    if (source !== undefined) await rm(source, { recursive: true, force: true });
  });

  // @feature docs/feature/run/README.md#historical-results
  test("opening a historical Record preserves its bytes and classifies unreadable copies", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 16, max: 64 }), async (corruptLength) => {
        for (const bytes of [undefined, corruptLength]) {
          const cwd = await mkdtemp(join(tmpdir(), "niceeval-historical-record-"));
          try {
            await mkdir(join(cwd, ".niceeval"));
            const record = join(cwd, ".niceeval", "record.sqlite");
            await copyFile(join(source, ".niceeval", "record.sqlite"), record);
            if (bytes !== undefined) await truncate(record, bytes);
            const before = await readFile(record);
            if (bytes === undefined) {
              expect(await getRun(cwd, historical.runId)).toEqual(historical);
            } else {
              await expect(getRun(cwd, historical.runId)).rejects.toMatchObject({
                _tag: "RunReadError",
                code: "run-read-failed",
              });
            }
            expect(await readFile(record)).toEqual(before);
          } finally {
            await rm(cwd, { recursive: true, force: true });
          }
        }
      }),
      { numRuns: 1 },
    );
  });
});
