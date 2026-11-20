import { cp, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { afterAll, beforeAll, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");
const { runHost } = require("niceeval/run/host") as typeof import("../../packages/niceeval/src/run/host/index.ts");
const { runCliInProcess } =
  require("./src/cli/in-process.ts") as typeof import("../../packages/niceeval/src/cli/in-process.ts");

const { decodeInspectionDocument, narrowInspectionSuccess } =
  require("niceeval/inspection") as typeof import("../../packages/niceeval/src/inspection/public.ts");

const FIXTURE = fileURLToPath(new URL("fixtures/turn-sandbox/", import.meta.url));
const TURNS = [["a.txt"], [], ["a.txt", "nested/c.txt"]];
let cwd: string | undefined;
let locator: string;

beforeAll(async () => {
  cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-turn-cli-"));
  await cp(FIXTURE, cwd, { recursive: true });
  for (const source of ["agent.ts", "sandbox.ts", "evals/turns.eval.ts", "experiments/turns.ts"]) {
    await rename(join(cwd, `${source}.txt`), join(cwd, source));
  }
  await writeFile(join(cwd, "turns.json"), JSON.stringify(TURNS));
  locator = await runTurns(cwd);
}, 60_000);

afterAll(async () => {
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

async function runTurns(cwd: string) {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "turns",
      config: { maxConcurrency: 1 },
      overrides: { rerun: "all" },
    }),
  );
  if (planned.status !== "ready") throw new Error(`Could not plan Run: ${JSON.stringify(planned)}`);
  await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  const [summary] = (await Effect.runPromise(runHost.list({ cwd }))).runs;
  const [slot] = (await Effect.runPromise(runHost.get({ cwd, runId: summary!.runId }))).run.slots;
  if (slot?.publication.state !== "published") throw new Error(`Attempt was not published: ${JSON.stringify(slot)}`);
  return slot.publication.attemptLocator;
}

async function showDocuments(cwd: string, locator: string, ...selection: string[]) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  stdout.on("data", (chunk: Buffer) => out.push(chunk));
  stderr.on("data", (chunk: Buffer) => err.push(chunk));
  const code = await runCliInProcess({
    argv: ["show", locator, ...selection, "--json"],
    cwd,
    env: { NO_COLOR: "1" },
    stdin: Readable.from([]),
    stdout,
    stderr,
  });
  stdout.end();
  stderr.end();
  await Promise.all([finished(stdout), finished(stderr)]);
  expect(code, Buffer.concat(err).toString()).toBe(0);
  return Buffer.concat(out).toString().split("\n").filter(Boolean).map((line) => {
    const decoded = decodeInspectionDocument(JSON.parse(line));
    if (!decoded.success) throw new Error(decoded.reason);
    return decoded.value;
  });
}

async function showAssertionDocuments(cwd: string, locator: string, ...selection: string[]) {
  return (await showDocuments(cwd, locator, ...selection)).map((document) => {
    const detail = narrowInspectionSuccess(document, "attempt.assertion.detail");
    if (!detail.success) throw new Error(detail.reason);
    return detail.value.assertion;
  });
}

async function showAssertions(cwd: string, locator: string) {
  const entries = await showAssertionDocuments(cwd, locator, "assertions");
  const assertions = [];
  for (const { entryId } of entries) {
    expect(entryId).toMatch(/^ae_/u);
    const details = await showAssertionDocuments(cwd, locator, entryId, "--full");
    expect(details).toHaveLength(1);
    const detail = details[0]!;
    expect(detail.entryId).toBe(entryId);
    if (!("entry" in detail) || !("criterion" in detail.entry)) {
      throw new Error(`Expected full projection for ${entryId}`);
    }
    assertions.push(detail.entry);
  }
  return assertions;
}

// @feature docs/feature/sandbox/library/asserting-results.md#限定到某一轮
test("Show projects a window only for Turn-scoped diff assertions", async () => {
  const assertions = await showAssertions(cwd!, locator);
  expect(assertions).toHaveLength(TURNS.length + 1);
  const [outline] = await showDocuments(cwd!, locator);
  const attempt = narrowInspectionSuccess(outline!, "attempt.get");
  if (!attempt.success) throw new Error(attempt.reason);
  expect(attempt.value.attempt.verdict).toBe("passed");

  const union = [...new Set(TURNS.flat())];
  for (const [index, paths] of [...TURNS, union].entries()) {
    const entry = assertions[index]!;
    expect(entry.decision.result).toBe("matched");
    if (entry.criterion.state !== "available") {
      throw new Error(`Criterion unavailable for ${entry.entryId}`);
    }
    expect(entry.criterion.value).toMatchObject({
      kind: "builtin",
      id: "sandbox-result",
      data: { operation: "changed-paths", paths },
    });
    const criterion = entry.criterion.value.data;
    if (index < TURNS.length) {
      expect(criterion).toHaveProperty("window", `turn${index + 1}`);
    } else {
      expect(criterion).not.toHaveProperty("window");
    }
  }
});
