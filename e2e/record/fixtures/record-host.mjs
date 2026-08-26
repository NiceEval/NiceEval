import { createHash } from "node:crypto";
import { Effect, Option, Schema, Stream } from "effect";
import {
  makeRecordHost,
  makeRecordRoot,
  NodeRecordLive,
  Record,
  RecordBytesContentSchema,
} from "niceeval/record";

const mode = process.argv[2];
const recordRoot = process.argv[3];
const ITEM_COUNT = 50_000;
const CONTENT_BYTES = 144 * 1024 * 1024;
const SOURCE_CHUNK_BYTES = 64 * 1024;

function rightOf(value) {
  if (value?._tag !== "Right") throw new Error("could not create public Record root");
  return value.right;
}

function* metricSource() {
  for (let ordinal = 0; ordinal < ITEM_COUNT; ordinal += 1) {
    yield { ordinal, marker: `metric-${ordinal}` };
  }
}

function metricStream() {
  return Stream.unfold(0, (ordinal) => ordinal >= ITEM_COUNT
    ? Option.none()
    : Option.some([{ ordinal, marker: `metric-${ordinal}` }, ordinal + 1]));
}

function digestMetrics() {
  const hash = createHash("sha256");
  for (const item of metricSource()) hash.update(JSON.stringify(item)).update("\n");
  return hash.digest("hex");
}

function* byteSource() {
  for (let offset = 0; offset < CONTENT_BYTES; offset += SOURCE_CHUNK_BYTES) {
    const size = Math.min(SOURCE_CHUNK_BYTES, CONTENT_BYTES - offset);
    // Every source chunk is fresh, bounded, and derived only from its ordinal.
    yield new Uint8Array(size).fill(Math.floor(offset / SOURCE_CHUNK_BYTES) % 251);
  }
}

function byteStream() {
  return Stream.unfold(0, (offset) => {
    if (offset >= CONTENT_BYTES) return Option.none();
    const size = Math.min(SOURCE_CHUNK_BYTES, CONTENT_BYTES - offset);
    const bytes = new Uint8Array(size).fill(Math.floor(offset / SOURCE_CHUNK_BYTES) % 251);
    return Option.some([bytes, offset + size]);
  });
}

function digestBytes() {
  const hash = createHash("sha256");
  for (const bytes of byteSource()) hash.update(bytes);
  return hash.digest("hex");
}

function core(slotId) {
  return {
    experimentId: "record-streaming-boundary",
    context: {
      experimentId: "record-streaming-boundary",
      execution: { agentId: "e2e", model: null, reasoningEffort: null, flags: {} },
      labels: {},
    },
    startedAt: 1,
    expectedSlots: [{
      slotId,
      evalId: "record-streaming-boundary",
      attemptOrdinal: 0,
      executionIdentityDigest: "0".repeat(64),
    }],
  };
}

function readableAttempt(reader, runId) {
  return Effect.gen(function* () {
    const selection = yield* reader.selectRuns({ runIds: [runId] });
    if (selection.runRefs.length !== 1) throw new Error("sealed run was not selectable");
    const run = yield* reader.readRun(selection.runRefs[0]);
    if (run.state !== "available" || run.value.members.length !== 1) throw new Error("sealed run was not readable");
    const attemptRef = run.value.members[0].attempt;
    if (attemptRef === null) throw new Error("sealed run had no Attempt");
    const attempt = yield* reader.readAttempt(attemptRef);
    if (attempt.state !== "available") throw new Error("sealed Attempt was not readable");
    return attempt.value.owner;
  });
}

async function holdAtPreSeal() {
  const collection = Record.attemptCollection({
    family: "e2e.recovery-items",
    item: Schema.Struct({ marker: Schema.String }),
  });
  const host = makeRecordHost({ records: [collection] });
  const root = rightOf(makeRecordRoot(recordRoot));
  const program = Effect.scoped(Effect.gen(function* () {
    const run = yield* host.createRun({ root, core: core("recovery-slot") });
    const attempt = yield* run.createAttempt({ slotId: "recovery-slot" });
    yield* attempt.records.append(collection, { marker: "recovery" });
    yield* attempt.records.close(collection, { state: "complete" });
    yield* attempt.complete("completed");
    process.stdout.write(`${JSON.stringify({ event: "before-seal" })}\n`);
    yield* Effect.never;
  }));
  await Effect.runPromise(Effect.provide(program, NodeRecordLive));
}

async function sealAndHold() {
  const collection = Record.attemptCollection({
    family: "e2e.recovery-items",
    item: Schema.Struct({ marker: Schema.String }),
  });
  const host = makeRecordHost({ records: [collection] });
  const root = rightOf(makeRecordRoot(recordRoot));
  const program = Effect.scoped(Effect.gen(function* () {
    const run = yield* host.createRun({ root, core: core("sealed-recovery-slot") });
    const attempt = yield* run.createAttempt({ slotId: "sealed-recovery-slot" });
    yield* attempt.records.append(collection, { marker: "sealed-recovery" });
    yield* attempt.records.close(collection, { state: "complete" });
    yield* attempt.complete("completed");
    const receipt = yield* run.seal({ completedAt: 2 });
    process.stdout.write(`${JSON.stringify({ event: "sealed", runId: receipt.runId })}\n`);
    yield* Effect.never;
  }));
  await Effect.runPromise(Effect.provide(program, NodeRecordLive));
}

async function heavyStreamingBoundary() {
  const collection = Record.attemptCollection({
    family: "e2e.large-items",
    item: Schema.Struct({ ordinal: Schema.Number, marker: Schema.String }),
  });
  const bytesFact = Record.attempt({
    family: "e2e.large-bytes",
    schema: Schema.Struct({ payload: RecordBytesContentSchema }),
  });
  const host = makeRecordHost({ records: [collection, bytesFact] });
  const root = rightOf(makeRecordRoot(recordRoot));
  const expectedMetricDigest = digestMetrics();
  const expectedContentDigest = digestBytes();
  const program = Effect.scoped(Effect.gen(function* () {
    const run = yield* host.createRun({ root, core: core("streaming-slot") });
    const attempt = yield* run.createAttempt({ slotId: "streaming-slot" });
    yield* attempt.records.appendAll(collection, metricStream());
    yield* attempt.records.close(collection, { state: "complete" });
    yield* attempt.records.write(bytesFact, ({ content }) => ({
      payload: content.stream(byteStream()),
    }));
    yield* attempt.complete("completed");
    const receipt = yield* run.seal({ completedAt: 2 });

    const reader = yield* host.openRead({ root });
    const owner = yield* readableAttempt(reader, receipt.runId);
    const wholeCollection = yield* Effect.either(reader.read(owner, collection));
    if (wholeCollection._tag !== "Left") throw new Error("large collection whole-value read was admitted");

    const opened = yield* reader.openCollection(owner, collection);
    if (opened.state !== "available" || opened.count !== ITEM_COUNT || !/^[a-f0-9]{64}$/u.test(opened.digest) ||
      !/^[a-f0-9]{64}$/u.test(opened.logicalIdentity) || !/^[a-f0-9]{64}$/u.test(opened.logicalSealIdentity)) {
      throw new Error("large collection was not stream-readable with its sealed metadata");
    }
    let count = 0;
    let first;
    let last;
    const itemHash = createHash("sha256");
    yield* Stream.runForEach(opened.items, (item) => Effect.sync(() => {
      if (count === 0) first = item;
      last = item;
      count += 1;
      itemHash.update(JSON.stringify(item)).update("\n");
    }));
    if (count !== ITEM_COUNT || itemHash.digest("hex") !== expectedMetricDigest || first?.ordinal !== 0 || last?.ordinal !== ITEM_COUNT - 1) {
      throw new Error("large collection Stream lost identity or order");
    }
    const attachment = yield* reader.read(owner, bytesFact);
    if (attachment.state !== "available") throw new Error("large Content attachment was not available");
    const byteLength = yield* attachment.content.byteLength(attachment.value.payload);
    if (byteLength !== CONTENT_BYTES) throw new Error(`wrong streamed Content byteLength: ${byteLength}`);
    const wholeContent = yield* Effect.either(attachment.content.bytes(attachment.value.payload));
    if (wholeContent._tag !== "Left") throw new Error("large Content whole-value read was admitted");
    const contentHash = createHash("sha256");
    let contentChunks = 0;
    yield* Stream.runForEach(attachment.content.stream(attachment.value.payload), (chunk) => Effect.sync(() => {
      contentChunks += 1;
      contentHash.update(chunk);
    }));
    if (contentChunks < 2 || contentHash.digest("hex") !== expectedContentDigest) {
      throw new Error("large Content Stream did not preserve its source bytes");
    }
    return {
      runId: receipt.runId,
      collection: { count, first, last, digest: expectedMetricDigest },
      content: { byteLength, chunks: contentChunks, digest: expectedContentDigest },
    };
  }));
  const result = await Effect.runPromise(Effect.provide(program, NodeRecordLive));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (mode === "before-seal") await holdAtPreSeal();
else if (mode === "after-seal") await sealAndHold();
else if (mode === "heavy") await heavyStreamingBoundary();
else throw new Error(`unknown record-host mode: ${mode}`);
