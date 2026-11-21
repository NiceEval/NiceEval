import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");
const { runCliInProcess } =
  require("./src/cli/in-process.ts") as typeof import("../../packages/niceeval/src/cli/in-process.ts");
const { decodeInspectionDocument, narrowInspectionSuccess } =
  require("niceeval/inspection") as typeof import("../../packages/niceeval/src/inspection/public.ts");
const { noSandboxBackendCapabilities, registerSandboxCapabilities, supportedBackendCapability } =
  require("./src/sandbox/backend.ts") as typeof import("../../packages/niceeval/src/sandbox/backend.ts");

const FIXTURE = fileURLToPath(new URL("fixtures/turn-sandbox/", import.meta.url));
const PATHS = ["a.txt", "b.txt", "nested/c.txt"];
const turns = fc.array(fc.subarray(PATHS), { minLength: 1, maxLength: 3 });
const samples = [
  [[], ["b.txt", "nested/c.txt"]],
  [["b.txt", "a.txt"], [], ["a.txt"]],
  ...fc.sample(turns, { numRuns: 4, seed: 801_531 }),
];
const cases = samples.map((pathsByTurn, index) => ({ index, pathsByTurn }));
const missingWindow = [[], [], [], []];
let cwd: string | undefined;
const locators = new Map<string, string>();
const sandboxProbe = Symbol.for("niceeval.test.turn-sandbox");
const resetSnapshots: boolean[] = [];

// Publish all samples via one Experiment Run, then read each Attempt independently.
beforeAll(async () => {
  cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-turn-property-"));
  await cp(FIXTURE, cwd, { recursive: true });
  await mkdir(join(cwd, "node_modules"));
  await symlink(dirname(require.resolve("effect/package.json")), join(cwd, "node_modules/effect"), "dir");
  for (const source of ["agent.ts", "sandbox.ts", "experiments/turns.ts"]) {
    await rename(join(cwd, `${source}.txt`), join(cwd, source));
  }
  Reflect.set(process, sandboxProbe, {
    register(sandbox: Parameters<typeof registerSandboxCapabilities>[0]) {
      registerSandboxCapabilities(sandbox, {
        ...noSandboxBackendCapabilities,
        rootCommands: supportedBackendCapability(true),
      });
    },
    stopped: (hasResetSnapshot: boolean) => resetSnapshots.push(hasResetSnapshot),
  });
  const source = await readFile(join(cwd, "evals/turns.eval.ts.txt"), "utf8");
  for (const [index, paths] of [...samples, missingWindow].entries()) {
    const id = `case-${index}`;
    await writeFile(join(cwd, "evals", `${id}.json`), JSON.stringify(paths));
    await writeFile(join(cwd, "evals", `${id}.eval.ts`), source.replace("CASE_FILE", id));
  }
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "turns",
      config: { maxConcurrency: 4 },
      overrides: { rerun: "all" },
    }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan Run: ${JSON.stringify(planned)}`);
  const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  const [runId] = receipt.createdRunIds;
  if (runId === undefined) throw new Error("Expected a Run");
  const { run } = await Effect.runPromise(runHost.get({ cwd, runId }));
  for (const slot of run.slots) {
    if (slot.publication.state !== "published") throw new Error(`Attempt was not published: ${JSON.stringify(slot)}`);
    locators.set(slot.evalId, slot.publication.attemptLocator);
  }
}, 60_000);

afterAll(async () => {
  Reflect.deleteProperty(process, sandboxProbe);
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

async function showDocuments(index: number, ...selection: string[]) {
  const locator = locators.get(`case-${index}`);
  if (cwd === undefined || locator === undefined) {
    throw new Error(`Missing Attempt for case-${index}. Published Evals: ${[...locators.keys()].join(", ")}`);
  }
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const chunks: Buffer[] = [];
  stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  const code = await runCliInProcess({
    argv: ["show", locator, ...selection, "--json"],
    cwd,
    env: { NO_COLOR: "1" },
    stdin: Readable.from([]),
    stdout,
    stderr,
  });
  expect(code, stderr.read()?.toString()).toBe(0);
  stdout.end();
  await finished(stdout);
  return Buffer.concat(chunks).toString().split("\n").filter(Boolean).map((line) => {
    const decoded = decodeInspectionDocument(JSON.parse(line));
    if (!decoded.success) throw new Error(decoded.reason);
    return decoded.value;
  });
}

async function showAssertionIds(index: number) {
  const [document] = await showDocuments(index);
  const outline = narrowInspectionSuccess(document!, "attempt.get");
  if (!outline.success) throw new Error(outline.reason);
  return outline.value.attempt.assertions.entries.map(({ entryId }) => entryId);
}

async function showFullAssertion(index: number, entryId: string) {
  const [document] = await showDocuments(index, entryId, "--full");
  const detail = narrowInspectionSuccess(document!, "attempt.assertion.detail");
  if (!detail.success) throw new Error(detail.reason);
  const assertion = detail.value.assertion;
  if (!("entry" in assertion) || !("criterion" in assertion.entry)) {
    throw new Error(`Expected full projection for ${entryId}`);
  }
  return assertion.entry;
}

async function showAssertions(index: number) {
  const ids = await showAssertionIds(index);
  return Promise.all(ids.map((entryId) => showFullAssertion(index, entryId)));
}

// @feature docs/feature/sandbox/library/asserting-results.md#限定到某一轮
test.each(cases)("changedPaths scopes case $index to its windows and their union", async ({ index, pathsByTurn }) => {
  const entries = await showAssertions(index);
  expect(entries.map(({ decision }) => decision.result), JSON.stringify(pathsByTurn)).toEqual([
    ...pathsByTurn.flatMap(() => ["matched", "mismatched"]),
    "matched",
  ]);
});

// @feature docs/feature/sandbox/architecture/README.md
test("single-use root-capable Sandboxes capture the diff without a reset metadata snapshot", async () => {
  const entries = await showAssertions(1);
  expect(entries[0]?.decision.result).toBe("matched");
  expect(resetSnapshots).toEqual(Array.from({ length: samples.length + 1 }, () => false));
});

// @feature docs/feature/sandbox/library/asserting-results.md#限定到某一轮
test("a missing window is unavailable alongside captured empty windows", async () => {
  const entries = await showAssertions(samples.length);
  expect(entries.map(({ decision }) => decision.result)).toEqual([
    "matched", "matched", "matched", "unavailable", "matched",
  ]);
  expect(entries[3]?.decision).toMatchObject({ reason: "source-unavailable" });
  expect(entries[3]?.criterion).toMatchObject({ value: { data: { window: "turn4" } } });
});

// @feature docs/feature/sandbox/library/asserting-results.md#限定到某一轮
test("the Attempt-wide criterion retains its original Show JSON encoding", async () => {
  const ids = await showAssertionIds(1);
  const { criterion } = await showFullAssertion(1, ids.at(-1)!);
  if (criterion.state !== "available") throw new Error("Expected a retained criterion");
  expect(JSON.stringify(criterion.value)).toBe(
    '{"data":{"operation":"changed-paths","paths":["b.txt","a.txt"]},"id":"sandbox-result","kind":"builtin"}',
  );
});

// @feature docs/feature/sandbox/library/asserting-results.md#限定到某一轮
test("only Turn-scoped criteria identify their send window", async () => {
  const ids = await showAssertionIds(1);
  for (const [index, paths] of samples[1]!.entries()) {
    const entry = await showFullAssertion(1, ids[index * 2]!);
    expect(entry.criterion).toMatchObject({
      state: "available",
      value: {
        kind: "builtin",
        id: "sandbox-result",
        data: { operation: "changed-paths", paths, window: `turn${index + 1}` },
      },
    });
  }
});
