import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { expect, test } from "vitest";
import { Effect, Result } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import { createRecordProject } from "./fixtures/record-harness/project.ts";

const config = { maxConcurrency: 2, maxRetries: 0 };
const predecessors = ["0.15", "0.15-hooks", "0.16", "0.17", "0.17-nohooks", "0.18", "record-1"] as const;
const fixture = (name: string) => new URL(`./fixtures/record-historical/predecessors/${name}/record.sqlite`, import.meta.url);

async function projectWith(write: (record: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "niceeval-record-historical-"));
  await mkdir(join(cwd, ".niceeval"));
  const record = join(cwd, ".niceeval", "record.sqlite");
  await write(record);
  return { cwd, record };
}

type Failure = { readonly message: string; readonly code: string; readonly cause: unknown; readonly _tag: string; readonly operation: string };
type Outcome = import("effect").Result.Result<unknown, Failure>;
const settle = (effect: unknown) => Effect.runPromise(Effect.result(effect as never)) as Promise<Outcome>;
const operations = {
  list: (cwd: string, _runId: string) => settle(runHost.list({ cwd })),
  get: (cwd: string, runId: string) => settle(runHost.get({ cwd, runId })),
  delete: (cwd: string, runId: string) => settle(runHost.delete({ cwd, runId })),
  recover: (cwd: string, runId: string) => settle(runHost.recover({ cwd, runId })),
};

// @feature docs/feature/run/README.md#historical-results
test.for(["list", "get", "delete", "recover"] as const)(
  "%s refuses a predecessor Record with a rerun hint and leaves its bytes and directory untouched",
  async (operation) => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...predecessors), fc.uuid(), async (predecessor, runId) => {
        const { cwd, record } = await projectWith((target) => copyFile(fixture(predecessor), target));
        try {
          const before = await readFile(record);
          const result = await operations[operation](cwd, runId);
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.message).toMatch(/older version of NiceEval/u);
            expect(result.failure.message).toMatch(/Rerun the experiment or remove this Record storage/u);
            expect(result.failure.cause).toMatchObject({ _tag: "SqliteRecordError", code: "record-schema-unsupported" });
          }
          expect((await readFile(record)).equals(before)).toBe(true);
          expect(await readdir(join(cwd, ".niceeval"))).toEqual(["record.sqlite"]);
        } finally {
          await rm(cwd, { recursive: true, force: true });
        }
      }),
      operation === "list"
        ? { numRuns: 2, examples: [["0.18", "00000000-0000-4000-8000-000000000000"]] }
        : { numRuns: 1 },
    );
  },
);

// @feature docs/feature/run/README.md#historical-results
test("an unreadable Record file keeps a classified read failure and its original bytes", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uint8Array({ minLength: 1, maxLength: 256 }),
      fc.constantFrom("list", "get"),
      fc.uuid(),
      async (bytes, operation, runId) => {
        const { cwd, record } = await projectWith((target) => writeFile(target, bytes));
        try {
          const result = await operations[operation](cwd, runId);
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure).toMatchObject({ _tag: "RunReadError", operation, code: "run-read-failed" });
            expect(result.failure.message).not.toBe("");
            expect(result.failure.cause).toBeDefined();
          }
          expect(Buffer.from(await readFile(record)).equals(Buffer.from(bytes))).toBe(true);
        } finally {
          await rm(cwd, { recursive: true, force: true });
        }
      },
    ),
    { numRuns: 4, examples: [[new TextEncoder().encode("not a SQLite database"), "list", "00000000-0000-4000-8000-000000000000"]] },
  );
});

// @feature docs/feature/run/README.md#historical-results
test.for([
  { label: "0.18 regression", examples: [["0.18"]] as ["0.18"][] },
  { label: "exploration", examples: [] },
])(
  "planning or running an Experiment over a predecessor Record fails without executing or touching it ($label)",
  async ({ examples }) => {
    const cwd = await createRecordProject("niceeval-record-historical-exp-", { held: false });
    try {
      await mkdir(join(cwd, ".niceeval"));
      const record = join(cwd, ".niceeval", "record.sqlite");
      await fc.assert(
        fc.asyncProperty(fc.constantFrom(...predecessors), async (predecessor) => {
          await copyFile(fixture(predecessor), record);
          const original = await readFile(record);
          const planned = await Effect.runPromise(
            experimentHost.invocation.plan({
              cwd,
              experimentSelector: "runs",
              config,
              overrides: { rerun: "all", earlyExit: false },
            }),
          );
          if (planned.status !== "ready") throw new Error("expected a ready plan");
          const outcome = await Effect.runPromise(Effect.result(experimentHost.invocation.run({ plan: planned.plan })));
          expect(Result.isFailure(outcome)).toBe(true);
          expect(
            Result.isFailure(outcome) ? JSON.stringify(outcome.failure) + String(outcome.failure.message) : "",
          ).toMatch(/older version of NiceEval/u);
          expect((await readFile(record)).equals(original)).toBe(true);
        }),
        { numRuns: 1, examples },
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);
