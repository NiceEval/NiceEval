import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import fc from "fast-check";
import { afterAll, beforeAll, expect, test } from "vitest";
import { invokeCli } from "./fixtures/judge-harness/harness.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect, Schema, Stream } = require("effect") as typeof import("effect");
const { Record, RecordBytesContentSchema, makeRecordHost, makeRecordRoot, NodeRecordLive } =
  require("./src/record/index.ts") as typeof import("../../packages/niceeval/src/record/index.ts");
const { ExperimentIdSchema, UtcMillisSchema, RunIdSchema } =
  require("./src/record/codec/identifiers.ts") as typeof import("../../packages/niceeval/src/record/codec/identifiers.ts");
// Arrange the same lifecycle fence used by the Experiment Host; content writes and reads use Record Host APIs.
const { createRunResource, closeRunResource } =
  require("./src/run/storage/sqlite.ts") as typeof import("../../packages/niceeval/src/run/storage/sqlite.ts");
const definition = Record.run({
  family: "test.batched-content",
  schema: Schema.Struct({ values: Schema.Array(RecordBytesContentSchema) }),
});
const host = makeRecordHost({ records: [definition] });
const runId = Schema.decodeUnknownSync(RunIdSchema)("run-content-batching");
const experimentId = Schema.decodeUnknownSync(ExperimentIdSchema)("content-batching");
const startedAt = Schema.decodeUnknownSync(UtcMillisSchema)(1000);
const writerGeneration = "content-batching";
// Empty Contents cross the row batch boundary; the final Content crosses the byte and chunk boundaries.
const values = [
  ...Array.from({ length: 2051 }, () => new Uint8Array()),
  ...fc.sample(fc.uint8Array({ minLength: 1, maxLength: 1024 }), { seed: 731_039, numRuns: 12 }),
  new Uint8Array(8 * 1024 * 1024 + 17).fill(97),
];
let cwd: string;
let observed: string[];
let exported: string;
let importedRoot: string;

beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "niceeval-content-batching-"));
  const rootPath = join(cwd, ".niceeval");
  const root = makeRecordRoot(rootPath);
  if (root._tag === "Failure") throw new Error("Invalid fixture root");
  observed = await Effect.runPromise(Effect.gen(function* () {
    const run = yield* host.createRun({
      root: root.success, runId, writerGeneration, experimentId, startedAt, expectedSlots: [],
      context: { experimentId, execution: { adapter: null, model: null, reasoningEffort: null, flags: {} }, labels: {} },
    });
    yield* createRunResource(rootPath, {
      runId, writerGeneration, invocationId: "content-batching", experimentId,
      startedAt: new Date(startedAt).toISOString(), expectedSlots: [], deadlineEpochMs: Date.now() + 30_000,
    });
    yield* run.records.write(definition, (build) => ({
      values: values.map((value) => build.content.stream(Stream.fromIterable([
        value.subarray(0, 3), value.subarray(3),
      ]))),
    }));
    yield* run.seal({ completedAt: startedAt });
    yield* closeRunResource(rootPath, {
      runId, writerGeneration, state: "completed", completedAt: new Date(startedAt).toISOString(),
      absences: [], deadlineEpochMs: Date.now() + 30_000,
    });
    const reader = yield* host.openRead({ root: root.success });
    const selection = yield* reader.selectRuns({ runIds: [runId] });
    const readRun = yield* reader.readRun(selection.runRefs[0]!);
    if (readRun.state !== "available") throw new Error("Missing Run");
    const read = yield* reader.read(readRun.value.owner, definition);
    if (read.state !== "available") throw new Error("Missing Content");
    return yield* Effect.forEach(read.value.values, (handle) => read.content.bytes(handle).pipe(
      Effect.map((bytes) => createHash("sha256").update(bytes).digest("hex")),
    ));
  }).pipe(Effect.scoped, Effect.provide(NodeRecordLive)));
  exported = join(cwd, "portable.sqlite");
  const exportResult = await invokeCli(cwd, ["run", "export", "--run", runId, "--out", exported, "--json"]);
  expect(exportResult.code, exportResult.stderr).toBe(0);
  importedRoot = join(cwd, "imported");
  const importResult = await invokeCli(importedRoot, ["run", "import", exported, "--json"]);
  expect(importResult.code, importResult.stderr).toBe(0);
}, 30_000);

afterAll(async () => {
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

// @feature docs/architecture.md#数据规模完整保存有界呈现
test("row and byte batching retains every empty and non-empty Content across stream boundaries", () => {
  expect(observed).toEqual(values.map((value) => createHash("sha256").update(value).digest("hex")));
});

function seal(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("SELECT logical_seal_identity FROM ne19_runs WHERE run_id=?").get(runId);
  } finally {
    db.close();
  }
}

// @feature docs/feature/run/README.md
test("batched streaming writes and portable replay retain the exact same logical Seal", () => {
  const original = seal(join(cwd, ".niceeval", "record.sqlite"));
  expect(original).toMatchObject({ logical_seal_identity: expect.stringMatching(/^[0-9a-f]{64}$/u) });
  expect(seal(exported)).toEqual(original);
  expect(seal(join(importedRoot, ".niceeval", "record.sqlite"))).toEqual(original);
});

// @feature docs/architecture.md#数据规模完整保存有界呈现
test("a producer failure after a persisted batch cannot publish a partial Run", async () => {
  const rootPath = join(cwd, "failed", ".niceeval");
  const root = makeRecordRoot(rootPath);
  if (root._tag === "Failure") throw new Error("Invalid fixture root");
  await Effect.runPromise(Effect.gen(function* () {
    const run = yield* host.createRun({
      root: root.success, runId, writerGeneration, experimentId, startedAt, expectedSlots: [],
      context: { experimentId, execution: { adapter: null, model: null, reasoningEffort: null, flags: {} }, labels: {} },
    });
    yield* createRunResource(rootPath, {
      runId, writerGeneration, invocationId: "failed-content-batching", experimentId,
      startedAt: new Date(startedAt).toISOString(), expectedSlots: [], deadlineEpochMs: Date.now() + 30_000,
    });
    const failure = new Error("producer failed after a batch");
    const written = yield* Effect.result(run.records.write(definition, (build) => ({
      values: [build.content.stream(Stream.concat(
        Stream.fromIterable([new Uint8Array(8 * 1024 * 1024 + 1)]),
        Stream.fail(failure),
      ))],
    })));
    expect(written._tag).toBe("Failure");
    const sealed = yield* Effect.result(run.seal({ completedAt: startedAt }));
    expect(sealed._tag).toBe("Failure");
    const reader = yield* host.openRead({ root: root.success });
    const selection = yield* reader.selectRuns();
    expect(selection.runRefs).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(NodeRecordLive)));
});
