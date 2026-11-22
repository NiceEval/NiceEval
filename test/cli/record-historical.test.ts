import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { runCliInProcess } from "../../packages/niceeval/src/cli/in-process.ts";
import { createRecordProject } from "../integration/fixtures/record-harness/project.ts";

let cwd: string;
beforeAll(async () => {
  cwd = await createRecordProject("niceeval-record-historical-cli-", { held: false });
  await mkdir(join(cwd, ".niceeval"));
});
afterAll(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function cli(argv: string[]) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const code = await runCliInProcess({ argv, cwd, env: { NO_COLOR: "1" }, stdin: Readable.from([]), stdout, stderr });
  return { code, output: `${stdout.read()?.toString() ?? ""}${stderr.read()?.toString() ?? ""}` };
}

const commands = [
  ["show", "runs", "--json"],
  ["run", "list", "--json"],
];

// @feature docs/feature/run/README.md#historical-results
test.for(commands.map((argv) => ({ argv })))("$argv refuses a predecessor Record with a rerun hint, runs nothing, and keeps the original bytes", async ({ argv }) => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("0.15", "0.15-hooks", "0.16", "0.17", "0.17-nohooks", "0.18", "record-1"),
      async (predecessor) => {
        const record = join(cwd, ".niceeval", "record.sqlite");
        await copyFile(new URL(`../integration/fixtures/record-historical/predecessors/${predecessor}/record.sqlite`, import.meta.url), record);
        const original = await readFile(record);
        const { code, output } = await cli(argv);
        expect(code).not.toBe(0);
        expect(output).toMatch(/older version of NiceEval/u);
        expect(output).toMatch(/Rerun the experiment/u);
        expect(output).toContain("remove this Record storage");
        expect((await readFile(record)).equals(original)).toBe(true);
        expect(await readdir(join(cwd, ".niceeval"))).toEqual(["record.sqlite"]);
      },
    ),
    { numRuns: 3, examples: [["0.18"]] },
  );
});
