import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { PassThrough, Readable } from "node:stream";
import { afterAll, beforeAll, expect, test } from "vitest";
import { decodeInspectionDocument } from "niceeval/inspection";
import { withInspectionQuery } from "niceeval/inspection/host";
import { runCliInProcess } from "../../packages/niceeval/src/cli/in-process.ts";
import {
  createFixtureProject,
  runSingleAttempt,
  selectInspectionOperation,
  withOperational,
  type FixtureProject,
} from "./fixtures/adapter-trace-usage-harness/harness.ts";

const files = {
  "adapters/trace.ts": `
import { defineAdapter } from "niceeval/adapter";
const complete = { state: "complete", limitations: [] };
const event = (index) => ({
  key: "tick-" + index, type: index % 4 === 0 ? "beat" : "tick", summary: "Tick marker " + index,
  source: { id: "fixture", sequence: index },
  actor: { id: index % 2 === 0 ? "north" : "south" },
  time: { clockId: index % 2 === 0 ? "odd" : "even", value: 9_000 - index, unit: "tick" },
});
const header = (traceId) => ({ traceId, schema: { id: "fixture/v1" } });
const archive = {
  system: "arena-replay",
  locator: { matchId: "fixture", eventId: "ee_not_a_navigation_link" },
  sha256: "a".repeat(64),
  byteLength: 42,
};
export const adapter = defineAdapter({
  name: "trace-navigation",
  behaviorRevision: "1",
  create(ctx) {
    return {
      async stream() {
        const proof = await ctx.attach({ name: "fixture.json", mediaType: "application/json", body: '{"proof":true}' });
        for (const [name, count] of [["short", 512], ["long", 8192]]) {
          await ctx.recordTrace({
            ...header(name), archive,
            events: {
              stream: async function* () {
                for (let index = 0; index < count; index += 1) {
                  if (index === 1)
                    yield { kind: "scope", scope: { scopeId: "region", label: "Scope marker", boundary: { x: 4 } } };
                  const value = event(index);
                  if (name === "short" && index === 400) value.key = "match-�";
                  if (name === "long" && (index === count - 49 || index === count - 48)) {
                    const long = index === count - 48;
                    value.evidence = Array.from({ length: long ? 270 : 300 }, (_, i) => ({
                      key: "proof-" + i + (long ? "-" + "界".repeat(120) : ""),
                      label: "Proof", artifactId: proof.artifactId, pointer: "/proof",
                    }));
                  }
                  yield { kind: "event", event: value };
                }
                yield { kind: "end", collection: complete };
              },
            },
          });
        }
        await ctx.recordTrace({
          ...header("cut"), archive,
          events: { stream: async function* () { yield { kind: "event", event: event(0) }; } },
        });
      },
      async array() {
        await ctx.recordTrace({
          ...header("array"), collection: complete,
          scopes: [{ scopeId: "stored", label: "Array scope", boundary: null }],
          events: [event(0), event(1), event(2)],
        });
      },
    };
  },
});
`,
  "evals/stream.eval.ts": `
import { adapter } from "../adapters/trace.ts";
export default adapter.defineEval({ async test(t) { await t.stream(); } });
`,
  "evals/array.eval.ts": `
import { adapter } from "../adapters/trace.ts";
export default adapter.defineEval({ async test(t) { await t.array(); } });
`,
  ...Object.fromEntries(["stream", "array"].map((name) => [`experiments/${name}.ts`, `
import { defineExperiment } from "niceeval";
import { adapter } from "../adapters/trace.ts";
export default defineExperiment({ adapter, evals: ["${name}"] });
`])),
};

let project: FixtureProject;
let locator: string;
let arrayLocator: string;
let earlierCutoffContinuation: string;

beforeAll(async () => {
  project = await createFixtureProject("niceeval-trace-navigation", files);
  locator = await runSingleAttempt(project.cwd, "stream");
  earlierCutoffContinuation = await withInspectionQuery({ cwd: project.cwd }, async (query) => {
    const page = await query.inspect({ kind: "attempt.trace.keys", locator, traceId: "long" });
    if (page.continuation === undefined) throw new Error("Expected a key continuation.");
    return page.continuation;
  });
  arrayLocator = await runSingleAttempt(project.cwd, "array");
}, 45_000);

afterAll(async () => {
  await project?.dispose();
});

function host<A>(read: Parameters<typeof withInspectionQuery<A>>[1]) {
  return withInspectionQuery({ cwd: project.cwd }, read);
}

// @use-case docs/feature/adapters/use-case/long-trace-stream.md#jump
test("keys keeps request order and gives precise mappings for streamed and array traces", async () => {
  await host(async (query) => {
    const keys = Array.from({ length: 64 }, (_, index) => index % 2 === 0 ? "tick-" + (200 - index) : "missing-" + index);
    const page = await query.inspect({ kind: "attempt.trace.keys", locator, traceId: "long", keys });
    expect(page.rows.map(({ key }) => key)).toEqual(keys);
    expect(page.rows.map(({ kind }) => kind)).toEqual(keys.map((_, index) => index % 2 === 0 ? "event" : "missing"));
    expect(page.rows[0]).toMatchObject({ ordinal: 200 });
    expect(page.continuation).toBeUndefined();

    const distinct = await query.inspect({
      kind: "attempt.trace.keys", locator, traceId: "short", keys: ["match-\uD800", "match-�"],
    });
    expect(distinct.rows.map(({ kind }) => kind)).toEqual(["missing", "event"]);

    const array = await query.inspect({ kind: "attempt.trace.keys", locator: arrayLocator, traceId: "array" });
    expect(array.rows.map(({ key }) => key)).toEqual(["tick-0", "tick-1", "tick-2"]);
    const outline = await query.inspect({ kind: "attempt.trace", locator: arrayLocator });
    expect(outline.trace.execution.scopeItems).toBeUndefined();
    expect(outline.trace.execution.traces[0]?.scopes).toEqual([{ scopeId: "stored", label: "Array scope", boundary: null }]);
    await expect(query.inspect({ kind: "attempt.trace.keys", locator, traceId: "missing" }))
      .rejects.toMatchObject({ code: "inspection-selection-missing" });
    await expect(query.inspect({ kind: "attempt.trace.keys", locator, traceId: "long", keys: ["a", "a"] }))
      .rejects.toMatchObject({ code: "inspection-request-invalid" });
  });
});

// @feature docs/feature/inspection/cli.md#按导入-key-查找
test("keys resumes inside an event's evidence at both row and UTF-8 page limits", async () => {
  await host(async (query) => {
    for (const [ordinal, evidenceCount, suffix] of [[8143, 300, ""], [8144, 270, "-" + "界".repeat(120)]] as const) {
      const operation = { kind: "attempt.trace.keys", locator, traceId: "long", keys: ["tick-" + ordinal, "missing"] } as const;
      const first = await query.inspect(operation);
      expect(first.rows[0]).toMatchObject({ kind: "event", ordinal });
      expect(first.rows.length).toBeLessThanOrEqual(256);
      if (suffix === "") expect(first.rows).toHaveLength(256);
      else expect(first.rows.length).toBeLessThan(256);
      expect(Buffer.byteLength(JSON.stringify(first.rows))).toBeLessThanOrEqual(64 * 1024);
      expect(first.continuation).toEqual(expect.any(String));
      const second = await query.inspect({ ...operation, continuation: first.continuation });
      expect(second.continuation).toBeUndefined();
      const rows = [...first.rows, ...second.rows];
      expect(rows.slice(1, -1).map(({ key }) => key)).toEqual(
        Array.from({ length: evidenceCount }, (_, index) => "proof-" + index + suffix),
      );
      expect(new Set(rows.flatMap((row) => row.kind === "evidence" ? [row.evidenceId] : [])).size).toBe(evidenceCount);
      expect(rows.at(-1)).toEqual({ kind: "missing", key: "missing" });
    }
  });
});

// @use-case docs/feature/adapters/use-case/long-trace-stream.md#continue
test("outline and keys enforce cutoff, Attempt, trace, ordered keys, and starting event bindings", async () => {
  await host(async (query) => {
    const keys = { kind: "attempt.trace.keys", locator, traceId: "long" } as const;
    await expect(query.inspect({ ...keys, continuation: earlierCutoffContinuation }))
      .rejects.toMatchObject({ code: "restart-required" });
    const keysPage = await query.inspect({ ...keys, keys: ["tick-8143", "missing"] });
    const keysContinuation = keysPage.continuation;
    if (keysContinuation === undefined) throw new Error("Expected a key continuation.");
    for (const change of [{ keys: ["missing", "tick-8143"] }, { locator: arrayLocator }, { traceId: "short" }]) {
      await expect(query.inspect({ ...keys, keys: ["tick-8143", "missing"], ...change, continuation: keysContinuation }))
        .rejects.toMatchObject({ code: "restart-required" });
    }
    const from = await query.inspect({ ...keys, keys: ["tick-8121"] });
    const target = from.rows[0];
    if (target?.kind !== "event") throw new Error("Expected a stable starting event.");
    const operation = { kind: "attempt.trace", locator, traceId: "long", fromEventId: target.eventId } as const;
    const all: number[] = [];
    let continuation: string | undefined;
    do {
      const { trace: { execution } } = await query.inspect({ ...operation, continuation });
      expect(execution.events.length).toBeLessThanOrEqual(32);
      all.push(...execution.events.map(({ ordinal }) => ordinal));
      continuation = execution.continuation;
      if (all.length === 32) {
        if (continuation === undefined) throw new Error("Expected an outline continuation.");
        for (const change of [{ fromEventId: "ee_missing" }, { locator: arrayLocator }, { eventType: "beat" }]) {
          await expect(query.inspect({ ...operation, ...change, continuation }))
            .rejects.toMatchObject({ code: "restart-required" });
        }
      }
    } while (continuation !== undefined);
    expect(all).toEqual(Array.from({ length: 71 }, (_, index) => 8121 + index));
    for (const change of [{ traceId: "short" }, { traceId: undefined }, { actorId: "north" }]) {
      await expect(query.inspect({ ...operation, ...change }))
        .rejects.toMatchObject({ code: "inspection-selection-missing" });
    }
  });
});

// @use-case docs/feature/adapters/use-case/long-trace-stream.md#jump
test("late keys and --from read sublinear index pages and bounded primary payload", async () => {
  const measurements = await withOperational(project.cwd, (source) => {
    const reads = { indexPages: 0, indexBytes: 0, primaryPages: 0, primaryBytes: 0 };
    const measured = {
      ...source,
      readCollectionPage(...request: Parameters<typeof source.readCollectionPage>) {
        const page = source.readCollectionPage(...request);
        const first = page.items[0];
        if (first === undefined) throw new Error("Expected collection item.");
        const index = Buffer.from(first.canonicalBytes.subarray(0, 16)).toString().startsWith('{"entries":');
        const bytes = page.items.reduce((total, item) => total + item.canonicalBytes.byteLength, 0);
        if (index) {
          reads.indexPages += 1;
          reads.indexBytes += bytes;
        } else {
          reads.primaryPages += 1;
          reads.primaryBytes += bytes;
        }
        return page;
      },
    };
    return ([["short", 512], ["long", 8192]] as const).map(([traceId, count]) => {
      const ordinal = count - 33;
      const lookup = selectInspectionOperation(measured, {
        kind: "attempt.trace.keys", locator, traceId, keys: ["tick-" + ordinal, "missing"],
      });
      const target = lookup.rows[0];
      if (target?.kind !== "event") throw new Error("Expected a stable starting event.");
      expect(target.ordinal).toBe(ordinal);
      const keys = { ...reads };
      Object.assign(reads, { indexPages: 0, indexBytes: 0, primaryPages: 0, primaryBytes: 0 });
      const outline = selectInspectionOperation(measured, {
        kind: "attempt.trace", locator, traceId, fromEventId: target.eventId,
      });
      expect(outline.trace.execution.events[0]?.ordinal).toBe(ordinal);
      expect(outline.trace.execution.omittedEventCount).toBe(1);
      const from = { ...reads };
      Object.assign(reads, { indexPages: 0, indexBytes: 0, primaryPages: 0, primaryBytes: 0 });
      return { keys, from };
    });
  });
  for (const { keys, from } of measurements) {
    expect(keys).toMatchObject({ primaryPages: 0, primaryBytes: 0 });
    expect(keys.indexPages).toBeLessThanOrEqual(40);
    expect(keys.indexBytes).toBeLessThanOrEqual(40 * 48 * 1024);
    expect(from.indexPages).toBeLessThanOrEqual(40);
    expect(from.indexBytes).toBeLessThanOrEqual(40 * 48 * 1024);
    expect(from.primaryPages).toBe(2);
    expect(from.primaryBytes).toBeLessThan(24 * 1024);
  }
  expect(measurements[1]!.keys.indexPages).toBeLessThanOrEqual(measurements[0]!.keys.indexPages + 16);
  expect(measurements[1]!.from.indexPages).toBeLessThanOrEqual(measurements[0]!.from.indexPages + 16);
});

// @use-case docs/feature/adapters/use-case/long-trace-stream.md#outline
test("Show renders archive provenance and interleaves streamed scopes while JSON keeps the sealed fields", async () => {
  async function show(...argv: string[]) {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    stdout.on("data", (chunk: Buffer) => output.push(chunk));
    stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    const code = await runCliInProcess({ argv: ["show", locator, ...argv], cwd: project.cwd, env: { NO_COLOR: "1" },
      stdin: Readable.from([]), stdout, stderr });
    const message = Buffer.concat(errors).toString("utf8");
    expect(code, message).toBe(0);
    return Buffer.concat(output).toString("utf8");
  }

  const text = await show("execution", "--trace", "short");
  expect(text).toContain("arena-replay");
  expect(text).toContain("matchId");
  expect(text).toContain("Archive bytes");
  expect(text.indexOf("Tick marker 0")).toBeLessThan(text.indexOf("Scope marker"));
  expect(text.indexOf("Scope marker")).toBeLessThan(text.indexOf("Tick marker 1"));
  expect(text).not.toMatch(/niceeval show\s+@\S+\s+ee_not_a_navigation_link/);
  const json = decodeInspectionDocument(JSON.parse(await show("execution", "--trace", "short", "--json")));
  if (!json.success || json.value.outcome !== "success" || json.value.operation !== "attempt.trace")
    throw new Error("Expected a trace document.");
  expect(json.value.trace.execution.traces[0]).toMatchObject({
    eventCount: 512, scopeCount: 1, evidenceCount: 0, scopes: [],
    archive: { system: "arena-replay", locator: { matchId: "fixture", eventId: "ee_not_a_navigation_link" }, byteLength: 42 },
  });
  expect(json.value.trace.execution.scopeItems).toMatchObject([{ ordinal: 0, beforeEvent: 1, scope: { scopeId: "region" } }]);
  const keyJson = decodeInspectionDocument(JSON.parse(
    await show("execution", "keys", "--trace", "short", "--key", "tick-9", "--key", "missing", "--json"),
  ));
  if (!keyJson.success || keyJson.value.outcome !== "success" || keyJson.value.operation !== "attempt.trace.keys")
    throw new Error("Expected a mapping document.");
  const [hit, missing] = keyJson.value.rows;
  if (hit?.kind !== "event") throw new Error("Expected a stable starting event.");
  expect(missing).toEqual({ kind: "missing", key: "missing" });
  expect(await show("execution", "keys", "--trace", "short", "--key", "tick-9")).toContain(`show ${locator} ${hit.eventId}`);
  const dashPage = await show("execution", "keys", "--trace", "long", "--key", "tick-8143", "--key=--missing");
  expect(dashPage).toContain("--key=--missing");
  const cut = await show("execution", "--trace", "cut");
  expect(cut).toContain("niceeval.trace-stream-cut");
  expect(cut).toContain("Tick marker 0");
  expect(await show(hit.eventId)).toContain("arena-replay");
});


// @feature docs/feature/inspection/cli.md#按导入-key-查找
test("a sealed Record produced before index publication supports historical keys, seeking, and detail", async () => {
  // The fixture was created by the NiceEval CLI built from c899cbe6c and contains 74 array events.
  const fixture = await readFile(new URL("fixtures/execution-trace-navigation/record-3-without-index.sqlite.gz", import.meta.url));
  const recordPath = join(project.cwd, "historical.sqlite");
  await writeFile(recordPath, gunzipSync(fixture));
  await withInspectionQuery({ cwd: project.cwd, recordPath }, async (query) => {
    const locator = "@1TFHGJDDX8MF7";
    const traceId = "historical";
    const index = { state: "not-published", reason: "historical" };
    const lookup = await query.inspect({
      kind: "attempt.trace.keys", locator, traceId, keys: ["historical-39", "absent", "historical-0"],
    });
    expect(lookup.index).toEqual(index);
    expect(lookup.rows.map(({ kind, key }) => [kind, key])).toEqual([
      ["event", "historical-39"], ["missing", "absent"], ["event", "historical-0"],
    ]);
    const target = lookup.rows[0];
    if (target?.kind !== "event") throw new Error("Expected a historical event identity.");
    const request = { kind: "attempt.trace", locator, traceId, fromEventId: target.eventId } as const;
    const { trace: { execution: first } } = await query.inspect(request);
    expect(first.index).toEqual(index);
    expect(first.traces[0]?.scopes).toEqual([{ scopeId: "fixture", label: "Historical scope", boundary: null }]);
    expect(first.events.map(({ ordinal }) => ordinal)).toEqual(Array.from({ length: 32 }, (_, i) => i + 39));
    expect(first.continuation).toEqual(expect.any(String));
    const { trace: { execution: last } } = await query.inspect({ ...request, continuation: first.continuation });
    expect(last.events.map(({ ordinal }) => ordinal)).toEqual([71, 72, 73]);
    expect(last.continuation).toBeUndefined();
    const detail = await query.inspect({
      kind: "attempt.trace.detail", locator, selector: { kind: "execution-event", eventId: target.eventId },
    });
    expect(detail.detail).toMatchObject({ kind: "execution-event", index, event: { key: "historical-39" } });
  });
});
