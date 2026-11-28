import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { decodeInspectionDocument } from "niceeval/inspection";
import { runHost } from "niceeval/run/host";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runCliInProcess } from "../../packages/niceeval/src/cli/in-process.ts";
import { createRecordProject } from "../integration/fixtures/record-harness/project.ts";

const secret = "registered-fixture-sentinel";
const caseSources = {
  skip: `t.diagnostic({ code: "fixture-advisory", level: "warning", message: "Preparation advisory" });
    t.skip("No fixture for " + secret + " " + "跳".repeat(200));`,
  "gate-and-skip": `t.check(1, equals(2)); t.skip("Skip after a failed gate");`,
  "error-and-skip": `try { t.skip("Skip before execution failed"); } finally { throw new TypeError("Execution fixture failure"); }`,
  evaluator: `t.check(1, broken);`,
  "optional-evaluator": `t.check(1, broken).optional();`,
};

type Case = keyof typeof caseSources;

let cwd: string;
let historicalCwd: string;
let currentSlots: Awaited<ReturnType<typeof slots>>;
let historicalSlots: Awaited<ReturnType<typeof slots>>;
let historicalBytes: Buffer;

const fixture = new URL("./fixtures/terminal-facts-before.sqlite.gz", import.meta.url);

async function project() {
  const cwd = await createRecordProject("niceeval-terminal-facts-", { held: false });
  await Promise.all([
    ...Object.entries(caseSources).map(([id, body]) =>
      writeFile(join(cwd, "evals", `${id}.eval.ts`), `
        import { defineValueMatch, equals } from "niceeval/expect";
        import adapter from "../adapter.ts";
        const secret = ${JSON.stringify(secret)};
        const broken = defineValueMatch({ name: "broken-fixture", evaluate() {
          throw new RangeError("Evaluator rejected " + secret + " " + "错".repeat(200) + "\\nDo not retain this line");
        } });
        export default adapter.defineEval({ test(t) { t.sensitiveValues(secret); ${body} } });`),
    ),
    writeFile(join(cwd, "experiments", "terminal.ts"), `
      import { defineExperiment } from "niceeval";
      import adapter from "../adapter.ts";
      export default defineExperiment({ adapter, evals: ${JSON.stringify(Object.keys(caseSources))} });`),
  ]);
  return cwd;
}

async function run(cwd: string, rerun: "all" | "failed") {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({ cwd, experimentSelector: "terminal", config: { maxConcurrency: 2 }, overrides: { rerun } }),
  );
  if (planned.status !== "ready") throw new Error(`Planning failed: ${JSON.stringify(planned)}`);
  const result = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  const [runId] = result.receipt.createdRunIds;
  if (runId === undefined) throw new Error("Expected a Run");
  return runId;
}

async function slots(cwd: string, runId: string) {
  const { run } = await Effect.runPromise(runHost.get({ cwd, runId }));
  return new Map(run.slots.map((slot) => [slot.evalId, slot]));
}

function locator(byEval: Awaited<ReturnType<typeof slots>>, id: Case): string {
  const publication = byEval.get(id)?.publication;
  if (publication?.state !== "published") throw new Error(`No Attempt for ${id}`);
  return publication.attemptLocator;
}

async function show(cwd: string, args: string[]) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const code = await runCliInProcess({
    argv: ["show", ...args],
    cwd,
    env: { NO_COLOR: "1" },
    stdin: Readable.from([]),
    stdout,
    stderr,
  });
  expect(code, stderr.read()?.toString()).toBe(0);
  return stdout.read()?.toString() ?? "";
}

function documents(output: string) {
  return output.trim().split("\n").map((line) => {
    const decoded = decodeInspectionDocument(JSON.parse(line));
    if (!decoded.success || decoded.value.outcome !== "success") throw new Error(line);
    return decoded.value;
  });
}

function recordPath(cwd: string) {
  return join(cwd, ".niceeval", "record.sqlite");
}

beforeAll(async () => {
  cwd = await project();
  historicalCwd = await project();
  const runId = await run(cwd, "all");
  currentSlots = await slots(cwd, runId);
  historicalBytes = gunzipSync(await readFile(fixture));
  await mkdir(join(historicalCwd, ".niceeval"), { recursive: true });
  await writeFile(recordPath(historicalCwd), historicalBytes);
  const history = await Effect.runPromise(runHost.list({ cwd: historicalCwd }));
  const [previous] = history.runs;
  if (previous === undefined) throw new Error("Expected a historical Run");
  historicalSlots = await slots(historicalCwd, previous.runId);
}, 60_000);

afterAll(async () => {
  for (const project of [cwd, historicalCwd]) {
    if (project !== undefined) await rm(project, { recursive: true, force: true });
  }
});

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
// @use-case docs/feature/inspection/use-case/inspection-show-as-json.md#attempt-two-lines
test("show reads the bounded, redacted skip reason apart from advisories", async () => {
  const attempt = locator(currentSlots, "skip");
  const output = await show(cwd, [attempt, "--json"]);
  const [document] = documents(output);
  if (document?.operation !== "attempt.get") throw new Error("Expected Attempt overview");
  expect(document.attempt).toMatchObject({
    core: { outcome: "cancelled" },
    verdict: "skipped",
    terminal: { kind: "explicit-skip", reason: expect.stringContaining("No fixture for <redacted>"), truncated: true },
    diagnostics: { items: expect.arrayContaining([expect.objectContaining({ code: "fixture-advisory", kind: "advisory" })]) },
  });
  const terminal = document.attempt.terminal;
  if (terminal?.kind !== "explicit-skip") throw new Error("Expected explicit skip reason");
  expect(Buffer.byteLength(terminal.reason)).toBeLessThanOrEqual(256);
  expect(output).not.toContain(secret);
});

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
test("show displays the skip as the Outcome and places its reason before the advisory", async () => {
  const output = await show(cwd, [locator(currentSlots, "skip")]);
  expect(output).toMatch(/Outcome\s+explicit skip/u);
  expect(output).toMatch(/Skip reason[\s\S]*No fixture for <redacted>[\s\S]*Advisories/u);
  expect(output).not.toContain(secret);
});

// @feature docs/feature/verdict/README.md#verdict-precedence
test.for([
  { id: "gate-and-skip", verdict: "failed", outcome: "completed", reason: "Skip after a failed gate" },
  { id: "error-and-skip", verdict: "errored", outcome: "errored", reason: "Skip before execution failed" },
] as const)("show retains a skip when $verdict has precedence", async ({ id, verdict, outcome, reason }) => {
  const [document] = documents(await show(cwd, [locator(currentSlots, id), "--json"]));
  if (document?.operation !== "attempt.get") throw new Error("Expected Attempt overview");
  expect(document.attempt).toMatchObject({ core: { outcome }, verdict, terminal: { kind: "explicit-skip", reason, truncated: false } });
});

// @feature docs/feature/run/README.md#historical-results
test("show reads a historical cancelled Attempt without inventing a reason", async () => {
  const [document] = documents(await show(historicalCwd, [locator(historicalSlots, "skip"), "--json"]));
  if (document?.operation !== "attempt.get") throw new Error("Expected Attempt overview");
  expect(document.attempt).toMatchObject({
    core: { outcome: "cancelled" },
    verdict: "skipped",
    terminal: { kind: "historical-cancelled", reason: "not-recorded" },
  });
  expect(await readFile(recordPath(historicalCwd))).toEqual(historicalBytes);
});

async function evaluatorEntry(cwd: string, attempt: string) {
  const output = await show(cwd, [attempt, "assertions", "--json"]);
  const [document] = documents(output);
  if (document?.operation !== "attempt.assertions") throw new Error("Expected Assertion list");
  const [assertion] = document.assertions;
  if (assertion === undefined || !("entry" in assertion)) throw new Error("Expected Assertion entry");
  return { entry: assertion.entry, output };
}

const recordedFailure = {
  state: "recorded",
  name: "RangeError",
  message: expect.stringContaining("Evaluator rejected <redacted>"),
  truncated: true,
};

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
// @use-case docs/feature/inspection/use-case/inspection-show-as-json.md#attempt-assertions
test("show lists the evaluator exception name and a bounded, redacted first line", async () => {
  const { entry, output } = await evaluatorEntry(cwd, locator(currentSlots, "evaluator"));
  expect(entry).toMatchObject({ decision: { reason: "evaluator-failed" }, evaluatorFailure: recordedFailure });
  if (entry.evaluatorFailure?.state !== "recorded") throw new Error("Expected evaluator failure");
  expect(Buffer.byteLength(entry.evaluatorFailure.message)).toBeLessThanOrEqual(256);
  expect(output).not.toContain(secret);
  expect(output).not.toContain("Do not retain this line");
});

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
test.for(["human", "json"] as const)("show full Assertion presents the evaluator failure in %s", async (format) => {
  const attempt = locator(currentSlots, "evaluator");
  const { entry } = await evaluatorEntry(cwd, attempt);
  const args = [attempt, entry.entryId, "--full"];
  const output = await show(cwd, format === "json" ? [...args, "--json"] : args);
  if (format === "json") {
    const [document] = documents(output);
    if (document?.operation !== "attempt.assertion.detail") throw new Error("Expected Assertion detail");
    expect(document).toMatchObject({ assertion: { entry: { evaluatorFailure: recordedFailure } } });
  } else {
    expect(output).toMatch(/RangeError[\s\S]*Evaluator rejected <redacted>/u);
    expect(output).toContain("[truncated]");
  }
  expect(output).not.toContain(secret);
  expect(output).not.toContain("Do not retain this line");
});

// @feature docs/feature/run/README.md#historical-results
test("show reads a historical Assertion without inventing an evaluator cause", async () => {
  const attempt = locator(historicalSlots, "evaluator");
  const { entry } = await evaluatorEntry(historicalCwd, attempt);
  expect(entry).toMatchObject({ decision: { reason: "evaluator-failed" }, evaluatorFailure: { state: "not-recorded" } });
  expect(await show(historicalCwd, [attempt, entry.entryId, "--full"])).toMatch(/Evaluator failure\s+not recorded/u);
  expect(await readFile(recordPath(historicalCwd))).toEqual(historicalBytes);
});

describe("Attempt reuse", () => {
  const reused = new Map<string, Awaited<ReturnType<typeof slots>>>();
  beforeAll(async () => {
    for (const [kind, project] of [["current", cwd], ["historical", historicalCwd]] as const) {
      reused.set(kind, await slots(project, await run(project, "failed")));
    }
  }, 30_000);

  // @feature docs/feature/experiments/README.md#partial-reuse
  test.for(["current", "historical"] as const)("carries the eligible %s Attempt with the same identity", (kind) => {
    const original = kind === "current" ? currentSlots : historicalSlots;
    const id = "optional-evaluator";
    const before = original.get(id);
    const after = reused.get(kind)?.get(id);
    expect(after).toMatchObject({
      executionIdentityDigest: before?.executionIdentityDigest,
      publication: { state: "published", action: "carried", attemptLocator: locator(original, id) },
    });
  });
});
