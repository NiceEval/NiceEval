// 跨进程保证：文件与锁——多个 exp 并发写同一项目时，先收尾的进程不得删除其它 Invocation 正在创建的 Run
import { copyFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Effect } from "effect";
import { experimentHost, decodeExpTerminalEvent } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import { createRecordProject } from "../integration/fixtures/record-harness/project.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
async function planBatch(cwd: string, experimentIds: string[]) {
  const result = await Effect.runPromise(
    experimentHost.invocation.plan({ cwd, experimentIds, config: { maxConcurrency: 6 } }),
  );
  if (result.status !== "ready") throw new Error(JSON.stringify(result));
  return result.plan;
}
describe("concurrent CLI admission", () => {
  let cwd: string;
  beforeAll(async () => {
    cwd = await createRecordProject("niceeval-concurrent-admission-", { held: false });
    await writeFile(
      join(cwd, "evals/first.eval.ts"),
      `import adapter from "../adapter.ts"; export default adapter.defineEval({ test() {} });`,
    );
    await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        copyFile(join(cwd, "experiments/runs.ts"), join(cwd, `experiments/batch-${i}.ts`)),
      ),
    );
    const seed = await planBatch(
      cwd,
      Array.from({ length: 24 }, (_, i) => `batch-${i}`),
    );
    await Effect.runPromise(experimentHost.invocation.run({ plan: seed }));
  }, 30_000);
  afterAll(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/run/README.md#publication-visibility
  test.for(Array.from({ length: Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 1) }, (_, index) => index))(
    "a fast Invocation cannot remove Runs being admitted by concurrent Invocations [sample %i]",
    { timeout: 90_000 },
    async (index) => {
      await fc.assert(
        fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 6 }), { minLength: 4, maxLength: 4 }), async (sizes) => {
          const results = await Promise.all(
            sizes.map((size, group) =>
              execa(
                process.execPath,
                [
                  ...process.execArgv,
                  cli,
                  "exp",
                  ...Array.from({ length: size }, (_, i) => ["--experiment", `batch-${group * 6 + i}`]).flat(),
                  "--max-concurrency=6",
                  "--json",
                ],
                { cwd, reject: false, env: { NO_COLOR: "1" } },
              ),
            ),
          );
          const ids = results.flatMap((result, group) => {
            expect(result.exitCode, result.stderr || result.stdout).toBe(0);
            const events = result.stdout
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line));
            const terminal = decodeExpTerminalEvent(events.find((event) => event.type === "receipt"));
            expect(terminal.receipt.completion).toBe("completed");
            expect(terminal.receipt.createdRunIds).toHaveLength(sizes[group]!);
            return terminal.receipt.createdRunIds;
          });
          const { runs } = await Effect.runPromise(runHost.list({ cwd, limit: 1000 }));
          const admitted = runs.filter((run) => ids.includes(run.runId));
          expect(admitted.map((run) => run.runId).sort()).toEqual([...ids].sort());
          expect(admitted.map((run) => [run.state, run.coverage.expected, run.coverage.published])).toEqual(
            ids.map(() => ["completed", 1, 1]),
          );
        }),
        { numRuns: 1, seed: 104729 + index, examples: index === 0 ? [[[2, 1, 1, 5]]] : [] },
      );
    },
  );
});

// @feature docs/feature/run/README.md#publication-visibility
// Retain the original public Library counterexample beside the process test:
// its four concurrent Invocations exceed the Library layer's one-second budget.
test("Library admission replays the reduced [2,1,1,5] counterexample", async () => {
  const regressionCwd = await createRecordProject("niceeval-admission-regression-", { held: false });
  try {
    await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        copyFile(join(regressionCwd, "experiments/runs.ts"), join(regressionCwd, `experiments/batch-${i}.ts`)),
      ),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 6 }), { minLength: 4, maxLength: 4 }), async (sizes) => {
        const settled = await Promise.allSettled(
          sizes.map(async (size, group) => {
            const experimentIds = Array.from({ length: size }, (_, i) => `batch-${group * 6 + i}`);
            const planned = await Effect.runPromise(
              experimentHost.invocation.plan({ cwd: regressionCwd, experimentIds, config: { maxConcurrency: 1 } }),
            );
            if (planned.status !== "ready") throw new Error(JSON.stringify(planned));
            const result = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
            expect(result.receipt.completion).toBe("completed");
            expect(result.receipt.createdRunIds).toHaveLength(size);
            for (const runId of result.receipt.createdRunIds) {
              const { run } = await Effect.runPromise(runHost.get({ cwd: regressionCwd, runId }));
              expect(run.state).toBe("completed");
              expect(run.slots.map((slot) => slot.publication.state)).toEqual(["published"]);
            }
          }),
        );
        for (const result of settled) if (result.status === "rejected") throw result.reason;
      }),
      { numRuns: 1, seed: 104729, examples: [[[2, 1, 1, 5]]] },
    );
  } finally {
    await rm(regressionCwd, { recursive: true, force: true });
  }
}, 30_000);
