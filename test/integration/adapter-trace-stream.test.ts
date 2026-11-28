import { randomInt } from "node:crypto";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import fc from "fast-check";
import { experimentHost } from "niceeval/experiment/host";
import { withInspectionQuery } from "niceeval/inspection/host";
import { runHost } from "niceeval/run/host";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createFixtureProject, readJson } from "./fixtures/adapter-trace-usage-harness/harness.ts";

const ADAPTER = `
import { defineAdapter } from "niceeval/adapter";
import { writeFileSync } from "node:fs";
const file = (name) => new URL("../" + name, import.meta.url);
const pending = () => new Promise(() => {});
const complete = { state: "complete", limitations: [] };
const end = { kind: "end", collection: complete };
const partial = { state: "partial", limitations: [{ code: "known-gap", message: "Known gap" }] };
const event = (key, targetKey, relation = "see") => ({
  key, type: "tick", source: { id: "fixture" }, summary: key,
  ...(targetKey === undefined ? {} : { links: [{ relation, targetKey }] }),
});
const item = (value) => ({ kind: "event", event: value });
const header = (traceId) => ({ traceId, schema: { id: "example.ticks" } });
const archive = { system: "fixture", locator: { match: "synthetic" } };
const error = async (pending) => {
  try { return await pending; }
  catch (cause) { return { code: cause.code }; }
};
const defer = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

export const adapter = defineAdapter({
  name: "trace-stream",
  behaviorRevision: "1",
  cleanupTimeoutMs: 40,
  create(ctx) {
    const play = async (id, input) => {
      const outcomes = file(id + "-outcomes.json");
      const stream = (traceId, factory, signal) => ctx.recordTrace({
        ...header(traceId), archive, events: { stream: factory }, ...(signal ? { signal } : {}),
      });
      const array = (traceId, values) => ctx.recordTrace({
        ...header(traceId), archive, scopes: [], events: values, collection: complete,
      });
      const receipts = {};
      if (input.kind === "basic") {
        const first = event(input.key);
        let returned = 0;
        receipts.original = await array("same", [first]);
        receipts.replayed = await stream("same", async function* () {
          try {
            yield item(first);
            yield end;
            throw new Error("Pulled beyond end");
          } finally {
            returned += 1;
          }
        });
        receipts.identicalOriginal = await array("same", [first]) === receipts.original;
        receipts.returned = returned;
        receipts.changed = await error(stream("same", async function* () { yield item(event("changed")); yield end; }));
        receipts.duplicate = await error(stream("same", async function* () {
          yield item(first); yield item(first); yield end;
        }));
        receipts.partial = await stream("partial", async function* () {
          yield item(event("partial"));
          yield { kind: "end", collection: partial };
        });
        receipts.producerError = await stream("producer", async function* () {
          yield item(event("first"));
          throw new Error("producer stopped");
        });
        receipts.prefix = await stream("prefix", async function* () {
          for (let index = 1; index <= 11; index++) {
            yield item(event("event-" + index, index === 10 ? "event-12" : undefined));
          }
        });
        receipts.closure = await stream("fixed-point", async function* () {
          yield item(event("stays"));
          yield item(event("refers-to-fourth", "fourth"));
          yield item(event("refers-to-missing", "missing"));
          yield item(event("fourth"));
        });
        receipts.missing = await error(stream("missing", async function* () {
          yield item(event("first", "missing")); yield end;
        }));
        receipts.cycle = await error(stream("cycle", async function* () {
          yield item(event("a", "b", "causes"));
          yield item(event("b", "a", "causes"));
        }));
        const caller = new AbortController();
        receipts.aborted = await stream("abort", (managed) => {
          let first = true;
          return {
            [Symbol.asyncIterator]() {
              return {
                next() {
                  if (first) { first = false; return Promise.resolve({ done: false, value: item(event("first")) }); }
                  caller.abort();
                  receipts.managedAborted = managed.aborted;
                  return pending();
                },
                return() { return pending(); },
              };
            },
          };
        }, caller.signal);
      }
      if (input.kind === "capacity") {
        const release = defer();
        const started = [];
        const pulls = Array.from({ length: 5 }, (_, index) => stream("stream-" + index, async function* () {
          started.push(index);
          await release.promise;
          yield end;
        }));
        await Promise.resolve();
        receipts.before = [...started];
        receipts.duplicate = await error(stream("stream-0", async function* () { started.push(99); yield end; }));
        release.resolve();
        receipts.finished = (await Promise.all(pulls)).map(({ ending }) => ending.kind);
        receipts.after = started;
      }
      if (input.kind === "admission") {
        const entered = defer();
        let managedAbort = false;
        let returnCalled = false;
        let at = 0;
        const finished = stream("admission", (managed) => {
          managed.addEventListener("abort", () => { managedAbort = true; });
          return {
            [Symbol.asyncIterator]() {
              return {
                next() {
                  if (at++ === 0) return Promise.resolve({ done: false, value: item(event("retained")) });
                  entered.resolve();
                  return pending();
                },
                return() { returnCalled = true; return pending(); },
              };
            },
          };
        });
        void finished.then((receipt) => {
          writeFileSync(outcomes, JSON.stringify({ receipt, managedAbort, returnCalled }));
        });
        await entered.promise;
        return true;
      }
      if (input.kind === "scopes") {
        const scope = { scopeId: "scope", label: "Measured", boundary: { from: 0 } };
        const scopedEvent = { ...event("start"), scopeMemberships: [{ scopeId: "scope", state: "included" }] };
        receipts.stream = await stream("scoped", async function* () {
          yield item(scopedEvent);
          yield { kind: "scope", scope };
          yield end;
        });
        receipts.array = await ctx.recordTrace({
          ...header("scoped"), archive, scopes: [scope], events: [scopedEvent], collection: complete,
        });
      }
      if (input.kind === "content") {
        const attached = await ctx.attach({
          name: "proof.json", mediaType: "application/json", body: JSON.stringify({ proof: ["observed"] }),
        });
        receipts.stream = await stream("content", async function* () {
          yield item({
            ...event("large-content"),
            payload: { text: "界".repeat(60_000) },
            evidence: [{ key: "proof", label: "Observed evidence", artifactId: attached.artifactId, pointer: "/proof/0" }],
          });
          yield end;
        });
      }
      if (input.kind === "large") {
        const samples = [];
        const sample = (emitted) => {
          globalThis.gc();
          const { heapUsed, rss } = process.memoryUsage();
          samples.push({ emitted, heapUsed, rss });
        };
        receipts.stream = await stream("long", async function* () {
          for (let index = 0; index < input.count; index++) {
            if (index % 25_000 === 0) sample(index);
            yield item(event("tick-" + index));
          }
          sample(input.count);
          yield end;
        });
        sample(input.count);
        receipts.samples = samples;
      }
      writeFileSync(outcomes, JSON.stringify(receipts));
      return true;
    };
    return { play };
  },
});
`;

type TraceInput =
  | { readonly kind: "basic"; readonly key: string }
  | { readonly kind: "capacity" | "admission" | "scopes" | "content" }
  | { readonly kind: "large"; readonly count: number };

const traceKey = fc.string({ minLength: 1 });
const propertyOptions = {
  seed: randomInt(-(2 ** 31), 2 ** 31),
  numRuns: Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 1),
  examples: [["a"]] satisfies [string][],
};
const basicCases = fc.sample(fc.tuple(traceKey), propertyOptions).map(([key], index) => ({
  id: `basic-${index}`,
  key,
}));

async function runTraceCases(cases: Readonly<Record<string, TraceInput>>) {
  const evalFiles = Object.fromEntries(
    Object.entries(cases).map(([id, input]) => [
      `evals/${id}.eval.ts`,
      `import { equals } from "niceeval/expect";
import { adapter } from "../adapters/stream.ts";
export default adapter.defineEval({ async test(t) {
  t.check(await t.play(${JSON.stringify(id)}, ${JSON.stringify(input)}), equals(true));
} });`,
    ]),
  );
  const project = await createFixtureProject("niceeval-trace-stream", {
    ...evalFiles,
    "adapters/stream.ts": ADAPTER,
    "experiments/stream.ts": `import { defineExperiment } from "niceeval";
import { adapter } from "../adapters/stream.ts";
export default defineExperiment({ adapter, evals: ${JSON.stringify(Object.keys(cases))} });`,
  });
  const { cwd } = project;
  try {
    const planned = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd,
        experimentSelector: "stream",
        config: { maxConcurrency: 1 },
        overrides: { rerun: "all" },
      }),
    );
    if (planned.status !== "ready") throw new Error(`Could not plan stream: ${JSON.stringify(planned)}`);
    const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
    const [runId] = receipt.createdRunIds;
    if (runId === undefined) throw new Error("No Run was created for the stream Experiment");
    const { run } = await Effect.runPromise(runHost.get({ cwd, runId }));
    return { project, slots: run.slots };
  } catch (error) {
    await project.dispose();
    throw error;
  }
}

type TraceRun = Awaited<ReturnType<typeof runTraceCases>>;
let batch: TraceRun;
let portablePath: string;

beforeAll(async () => {
  // Separate Attempts share discovery and Record setup in one Invocation.
  const generated = Object.fromEntries<TraceInput>(basicCases.map(({ id, key }) => [id, { kind: "basic", key }]));
  batch = await runTraceCases({
    ...generated,
    portable: { kind: "basic", key: "portable" },
    scopes: { kind: "scopes" },
    capacity: { kind: "capacity" },
    admission: { kind: "admission" },
    content: { kind: "content" },
  });
  const { cwd } = batch.project;
  portablePath = join(cwd, "portable-trace.sqlite");
  await copyFile(join(cwd, ".niceeval", "record.sqlite"), portablePath);
}, 60_000);

afterAll(async () => {
  await batch?.project.dispose();
});

function publishedLocator({ slots }: TraceRun, id: string) {
  const publication = slots.find(({ evalId }) => evalId === id)?.publication;
  if (publication?.state !== "published") throw new Error(`Slot for ${id} was not published`);
  return publication.attemptLocator;
}

async function readCase(run: TraceRun, id: string) {
  const locator = publishedLocator(run, id);
  const outcomes = await readJson<Record<string, unknown>>(run.project.cwd, `${id}-outcomes.json`);
  return { locator, outcomes };
}

async function runTraceCase(input: TraceInput) {
  const run = await runTraceCases({ stream: input });
  try {
    return await readCase(run, "stream");
  } finally {
    await run.project.dispose();
  }
}

const invalid = { code: "execution-trace-invalid" };
const conflict = { code: "execution-trace-conflict" };

// @feature docs/feature/adapters/library/README.md#流式提交事件
test("the explicit end and the closed prefix determine the published trace", async () => {
  let index = 0;
  await fc.assert(
    fc.asyncProperty(traceKey, async (key) => {
      // Use the prepared Attempts for exploration. A new shrink candidate runs in a fresh Attempt.
      const sample = basicCases[index++];
      const { outcomes } =
        sample?.key === key ? await readCase(batch, sample.id) : await runTraceCase({ kind: "basic", key });
      expect(outcomes).toMatchObject({
        original: { traceId: expect.any(String), events: [{ key }] },
        replayed: { ending: { kind: "declared" }, eventCount: 1 },
        identicalOriginal: true,
        returned: 1,
        changed: conflict,
        duplicate: invalid,
        partial: { ending: { kind: "declared" }, collection: { state: "partial" } },
        producerError: { ending: { kind: "cut", reason: "producer-error", droppedItems: 0 }, eventCount: 1 },
        prefix: { ending: { kind: "cut", reason: "unterminated", droppedItems: 2 }, eventCount: 9 },
        closure: { ending: { kind: "cut", reason: "unterminated", droppedItems: 3 }, eventCount: 1 },
        missing: invalid,
        cycle: invalid,
        aborted: { ending: { kind: "cut", reason: "aborted", droppedItems: 0 }, eventCount: 1 },
        managedAborted: true,
      });
      expect(outcomes.replayed).toMatchObject({
        traceId: (outcomes.original as { traceId: string }).traceId,
      });
    }),
    propertyOptions,
  );
}, 60_000);

// @feature docs/feature/adapters/library/README.md#没有到达-end-的流
test("hostile Record read preserves accepted prefixes and excludes rejected snapshots", async () => {
  const locator = publishedLocator(batch, "portable");
  const { trace, attempt } = await withInspectionQuery({ cwd: batch.project.cwd, recordPath: portablePath }, async (query) => ({
    trace: (await query.inspect({ kind: "attempt.trace", locator })).trace.execution,
    attempt: (await query.inspect({ kind: "attempt.get", locator })).attempt,
  }));
  expect(attempt.verdict).toBe("passed");
  expect(attempt.diagnostics.items.filter(({ code }) => code === "niceeval.trace-stream-cut")).toHaveLength(4);
  expect(trace.traces.map(({ sourceTraceId, eventCount }) => [sourceTraceId, eventCount])).toEqual([
    ["same", 1], ["partial", 1], ["producer", 1], ["prefix", 9], ["fixed-point", 1], ["abort", 1],
  ]);
});

// @feature docs/feature/adapters/library/README.md#取消与接纳时段
test("four producers run concurrently and a duplicate reservation never enters its factory", async () => {
  const { outcomes } = await readCase(batch, "capacity");
  expect(outcomes).toEqual({
    before: [0, 1, 2, 3],
    duplicate: conflict,
    finished: Array.from({ length: 5 }, () => "declared"),
    after: [0, 1, 2, 3, 4],
  });
});

// @feature docs/feature/adapters/library/README.md#取消与接纳时段
test("hung next and return settle the trace at admission close without changing a passed outcome", async () => {
  const { locator, outcomes } = await readCase(batch, "admission");
  expect(outcomes).toMatchObject({
    receipt: { ending: { kind: "cut", reason: "admission-closed", droppedItems: 0 }, eventCount: 1 },
    managedAbort: true,
    returnCalled: true,
  });
  const attempt = await withInspectionQuery({ cwd: batch.project.cwd }, async (query) =>
    (await query.inspect({ kind: "attempt.get", locator })).attempt,
  );
  expect(attempt.verdict).toBe("passed");
  expect(attempt.diagnostics.items.map(({ code }) => code)).toContain("niceeval.trace-stream-cut");
});

// @feature docs/feature/adapters/library/README.md#幂等与重交
test("a forward scope reference yields the same normalized snapshot and array receipt identities", async () => {
  const { outcomes: scopedReceipts } = await readCase(batch, "scopes");
  expect(scopedReceipts.stream).toMatchObject({
    scopeCount: 1, eventCount: 1, ending: { kind: "declared" }, traceId: expect.any(String),
  });
  expect(scopedReceipts.array).toMatchObject({
    traceId: (scopedReceipts.stream as { traceId: string }).traceId,
    events: [{ key: "start", eventId: expect.any(String), evidence: [] }],
  });
});

// @feature docs/feature/adapters/library/README.md#规模与回执
test("a streamed event above the inline threshold retains its attachment evidence", async () => {
  const { outcomes } = await readCase(batch, "content");
  expect(outcomes.stream).toMatchObject({ eventCount: 1, evidenceCount: 1, ending: { kind: "declared" } });
});

// @feature docs/feature/adapters/library/README.md#规模与回执
test.runIf(process.env.NICEEVAL_TRACE_SCALE === "1")(
  "publishes 200,000 streamed events without retaining item-proportional JS heap",
  async () => {
    const count = 200_000;
    const { outcomes } = await runTraceCase({ kind: "large", count });
    expect(outcomes.stream).toMatchObject({ eventCount: count, ending: { kind: "declared" } });
    const samples = outcomes.samples as readonly { emitted: number; heapUsed: number; rss: number }[];
    expect(samples.map(({ emitted }) => emitted)).toEqual([
      ...Array.from({ length: 9 }, (_, index) => index * 25_000), count,
    ]);
    const warmHeap = samples.slice(2).map(({ heapUsed }) => heapUsed);
    const heapSpread = Math.max(...warmHeap) - Math.min(...warmHeap);
    console.log(JSON.stringify({ heapSpread, samples }));
    expect(heapSpread, JSON.stringify(samples)).toBeLessThan(24 * 1024 * 1024);
  },
  240_000,
);
