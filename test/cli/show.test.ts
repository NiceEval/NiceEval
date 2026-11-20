import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");
const { runCliInProcess } =
  require("./src/cli/in-process.ts") as typeof import("../../packages/niceeval/src/cli/in-process.ts");
const { decodeInspectionDocument } =
  require("niceeval/inspection") as typeof import("../../packages/niceeval/src/inspection/public.ts");

let cwd: string | undefined;
let locator: string;
let populatedLocator: string;

beforeAll(async () => {
  cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-show-cli-"));
  await Promise.all(["evals", "experiments"].map((dir) => mkdir(join(cwd!, dir))));
  await Promise.all([
    writeFile(join(cwd, "package.json"), JSON.stringify({ type: "module" })),
    writeFile(
      join(cwd, "adapter.ts"),
      `import { defineAdapter } from "niceeval/adapter";
       import { equals } from "niceeval/expect";
       export default defineAdapter({
         name: "show-fixture", behaviorRevision: "1", create: () => ({}),
         assertions: ({ check }) => ({ ready: () => check(1, equals(1)) }),
       });`,
    ),
    writeFile(
      join(cwd, "evals", "errored.eval.ts"),
      `import adapter from "../adapter.ts";
       export default adapter.defineEval({ test() { throw new Error("Fixture failed in eval.run"); } });`,
    ),
    writeFile(
      join(cwd, "evals", "populated.eval.ts"),
      `import adapter from "../adapter.ts";
       export default adapter.defineEval({ test(t) {
         t.ready().label("First");
         t.ready().label("Second");
       } });`,
    ),
    writeFile(
      join(cwd, "experiments", "show.ts"),
      `import { defineExperiment } from "niceeval";
       import adapter from "../adapter.ts";
       export default defineExperiment({ adapter, evals: ["errored", "populated"], attempts: 1 });`,
    ),
  ]);
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "show",
      config: { maxConcurrency: 1 },
      overrides: { rerun: "all" },
    }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan Run: ${JSON.stringify(planned)}`);
  await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  const [summary] = (await Effect.runPromise(runHost.list({ cwd }))).runs;
  const { slots } = (await Effect.runPromise(runHost.get({ cwd, runId: summary!.runId }))).run;
  function publishedLocator(evalId: string) {
    const slot = slots.find((slot) => slot.evalId === evalId);
    if (slot?.publication.state !== "published") throw new Error(`Attempt was not published: ${JSON.stringify(slot)}`);
    return slot.publication.attemptLocator;
  }
  locator = publishedLocator("errored");
  populatedLocator = publishedLocator("populated");
  const [outline] = await showDocuments([]);
  expect(outline).toMatchObject({
    outcome: "success",
    operation: "attempt.get",
    attempt: { verdict: "errored", assertions: { entries: [] } },
  });
});

afterAll(async () => {
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

async function invokeShow(attemptLocator: string, args: readonly string[]) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const code = await runCliInProcess({
    argv: ["show", attemptLocator, ...args],
    cwd: cwd!,
    env: { NO_COLOR: "1" },
    stdin: Readable.from([]),
    stdout,
    stderr,
  });
  const output: string = stdout.read()?.toString() ?? "";
  const diagnostics: string = stderr.read()?.toString() ?? "";
  return { code, stdout: output, stderr: diagnostics };
}

async function showDocuments(args: readonly string[], attemptLocator = locator) {
  const result = await invokeShow(attemptLocator, [...args, "--json"]);
  expect(result.code, result.stderr).toBe(0);
  const lines = result.stdout.split("\n");
  expect(lines.pop()).toBe("");
  return lines.map((line) => {
    const decoded = decodeInspectionDocument(JSON.parse(line));
    if (!decoded.success) throw new Error(decoded.reason);
    return decoded.value;
  });
}

const operations = {
  execution: "attempt.trace",
  timing: "attempt.timing",
  usage: "attempt.usage",
  diff: "attempt.diff",
  source: "attempt.sources",
  artifacts: "attempt.artifacts",
  assertions: "attempt.assertions",
} as const;

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
test("each show aspect emits one machine document for an errored Attempt", async () => {
  const aspects = Object.keys(operations) as (keyof typeof operations)[];
  await fc.assert(
    fc.asyncProperty(fc.array(fc.constantFrom(...aspects), { minLength: 1, maxLength: 3 }), async (queries) => {
      for (const aspect of queries) {
        const documents = await showDocuments([aspect]);
        expect(documents.map(({ operation, outcome }) => ({ operation, outcome }))).toEqual([
          { operation: operations[aspect], outcome: "success" },
        ]);
        if (aspect === "assertions") {
          expect(documents[0]).toMatchObject({
            assertions: [],
            links: [{ rel: "execution", command: `niceeval show ${locator} execution` }],
          });
        }
      }
    }),
    { seed: 42, numRuns: 12, examples: aspects.map((aspect) => [[aspect]]) },
  );
});

// @use-case docs/feature/inspection/use-case/inspection-show-as-json.md#attempt-assertions
test("show lists populated assertions in Attempt order and links to exact details", async () => {
  const documents = await showDocuments(["assertions"], populatedLocator);
  expect(documents).toHaveLength(1);
  const [list] = documents;
  if (list?.outcome !== "success" || list.operation !== "attempt.assertions") {
    throw new Error(`Expected an assertion list, got ${JSON.stringify(list)}`);
  }
  expect(list.assertions).toMatchObject([
    { projection: "compact", display: { label: "First" } },
    { projection: "compact", display: { label: "Second" } },
  ]);
  expect(list.links).toEqual(list.assertions.map(({ entryId }) => ({
    rel: "assertion", command: `niceeval show ${populatedLocator} ${entryId} --full`,
  })));
  const [entry] = list.assertions;
  const detail = await showDocuments([entry!.entryId], populatedLocator);
  expect(detail).toHaveLength(1);
  expect(detail[0]).toMatchObject({
    outcome: "success",
    operation: "attempt.assertion.detail",
    assertion: entry,
    publicationCutoff: list.publicationCutoff,
  });
});

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
test("show explains the empty assertion list and links to execution in text mode", async () => {
  const result = await invokeShow(locator, ["assertions"]);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain("No Assertion entries recorded");
  expect(result.stdout).toContain(`Next\n  niceeval show ${locator} execution\n`);
});
