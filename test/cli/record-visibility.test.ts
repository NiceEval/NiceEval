import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { PassThrough, Readable } from "node:stream";
import { setTimeout } from "node:timers/promises";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createRecordProject, openGate, waitForGate } from "../integration/fixtures/record-harness/project.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");
const { decodeInspectionDocument } =
  require("niceeval/inspection") as typeof import("../../packages/niceeval/src/inspection/public.ts");
const { runCliInProcess } =
  require("./src/cli/in-process.ts") as typeof import("../../packages/niceeval/src/cli/in-process.ts");

const config = { maxConcurrency: 2, maxRetries: 0 };
let cwd: string;
let runId: string;
let locator: string;
let running: Promise<unknown>;

beforeAll(async () => {
  cwd = await createRecordProject("niceeval-record-visibility-", { held: true });
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({ cwd, experimentSelector: "runs", config, overrides: { rerun: "all", earlyExit: false } }),
  );
  if (planned.status !== "ready") throw new Error("Could not plan Run");
  running = Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  await waitForGate(cwd, "entered");
  for (const deadline = Date.now() + 8_000; ; ) {
    const [summary] = (await Effect.runPromise(runHost.list({ cwd }))).runs;
    if (summary?.coverage.published === 1) {
      runId = summary.runId;
      const published = (await Effect.runPromise(runHost.get({ cwd, runId }))).run.slots.find(
        ({ publication }) => publication.state === "published",
      )!.publication;
      if (published.state !== "published") throw new Error("unreachable");
      locator = published.attemptLocator;
      return;
    }
    if (Date.now() >= deadline) throw new Error("The first Attempt did not publish");
    await setTimeout(10);
  }
}, 20_000);

afterAll(async () => {
  await openGate(cwd, "release");
  try {
    await running;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

async function cli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const code = await runCliInProcess({ argv, cwd, env: { NO_COLOR: "1" }, stdin: Readable.from([]), stdout, stderr });
  return { code, stdout: stdout.read()?.toString() ?? "", stderr: stderr.read()?.toString() ?? "" };
}

// @feature docs/feature/run/README.md#publication-visibility
test("a published Attempt is readable and its Run lists as active with pending slots while the Run is open", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom("run-json", "run-human", "attempt-json", "list"), { minLength: 1, maxLength: 2 }),
      async (reads) => {
        const results = await Promise.all(
          reads.map(async (read) => {
            const argv = {
              "run-json": ["show", `run:${runId}`, "--json"],
              "run-human": ["show", `run:${runId}`],
              "attempt-json": ["show", locator, "--json"],
              list: ["run", "list", "--json"],
            }[read];
            return [read, await cli(argv)] as const;
          }),
        );
        for (const [read, result] of results) {
          expect(result.code, result.stderr).toBe(0);
          if (read === "run-human") {
            expect(result.stdout).toMatch(/State\s+active/u);
            expect(result.stdout).toContain("1/2 attempts observed");
            expect(result.stdout).not.toContain("Completed");
          } else if (read === "attempt-json") {
            const lines = result.stdout.split("\n");
            expect(lines.pop()).toBe("");
            const documents = lines.map((line) => {
              const decoded = decodeInspectionDocument(JSON.parse(line));
              if (!decoded.success) throw new Error(decoded.reason);
              return decoded.value;
            });
            expect(documents).toMatchObject([
              { operation: "attempt.get", outcome: "success", attempt: { locator, core: { outcome: "completed" } } },
              { operation: "attempt.usage", outcome: "success" },
            ]);
          } else if (read === "run-json") {
            expect(JSON.parse(result.stdout).run).toMatchObject({
              value: { runId, state: "active" },
              denominator: { expected: 2, published: 1, missing: 1 },
            });
          } else {
            expect(JSON.parse(result.stdout).runs).toEqual([
              expect.objectContaining({ runId, state: "active", coverage: { expected: 2, published: 1, missing: 1 } }),
            ]);
          }
        }
      },
    ),
    { numRuns: 2, examples: [[["attempt-json", "run-human"]], [["attempt-json", "run-json"]]] },
  );
});
