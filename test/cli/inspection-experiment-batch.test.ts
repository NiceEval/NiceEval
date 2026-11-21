import { rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createExperimentBatch, withSlowAttachmentReads } from "../integration/fixtures/record-harness/experiment-batch.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { runCliInProcess } =
  require("./src/cli/in-process.ts") as typeof import("../../packages/niceeval/src/cli/in-process.ts");

let batch: Awaited<ReturnType<typeof createExperimentBatch>>;

beforeAll(async () => {
  batch = await createExperimentBatch();
}, 20_000);

afterAll(async () => {
  if (batch !== undefined) await rm(batch.cwd, { recursive: true, force: true });
});

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
test("reads a selected Experiment without evaluating an unrelated Experiment module", async () => {
  const unrelated = join(batch.cwd, "experiments", "unrelated.ts");
  await writeFile(unrelated, 'throw new Error("Unrelated Experiment was evaluated");\n');
  try {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const code = await runCliInProcess({
      argv: ["show", "exp:more"],
      cwd: batch.cwd,
      env: { NO_COLOR: "1" },
      stdin: Readable.from([]),
      stdout,
      stderr,
    });
    expect(code, stderr.read()?.toString()).toBe(0);
    expect(stdout.read()?.toString()).toContain(batch.locators.get("more/first"));
  } finally {
    await rm(unrelated);
  }
});

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
test.each([["more"], ["runs", "more"]].map((ids) => ({ ids })))(
  "shows selected published results across Runs when attachment reads span a deadline ($ids)",
  async ({ ids }) => {
    const size = ids.length;
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(["runs", "more"], { minLength: size, maxLength: size }), async (experimentIds) => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const code = await withSlowAttachmentReads(() =>
          runCliInProcess({
            argv: ["show", ...experimentIds.map((id) => `exp:${id}`)],
            cwd: batch.cwd,
            env: { NO_COLOR: "1" },
            stdin: Readable.from([]),
            stdout,
            stderr,
          }),
        );
        expect(code, stderr.read()?.toString()).toBe(0);
        const output = stdout.read()?.toString() ?? "";
        for (const [position, locator] of batch.locators) {
          expect(output.includes(locator)).toBe(experimentIds.some((id) => position.startsWith(`${id}/`)));
        }
      }),
      { numRuns: 1, seed: 7398, examples: [[ids]] },
    );
  },
);
