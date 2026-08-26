// owner: docs/engineering/testing/e2e/migrate.md#sqlite-record-collection-and-portable-snapshot

import { cpSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Schema, Stream } from "effect";
import { expect, test } from "vitest";

type Metric = {
  readonly sessionIndex: number;
  readonly turnIndex: number;
  readonly latencyMs: number;
};

type RecordModule = Record<string, unknown>;

type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly diagnostic: () => string;
  readonly json: () => unknown;
};

type ManagedProcess = {
  readonly done: Promise<{
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly diagnostic: () => string;
  }>;
  readonly signal: (signal: NodeJS.Signals) => boolean;
};

type E2EContext = {
  readonly case: (
    name: string,
    body: (input: {
      readonly paths: { readonly projectRoot: string };
      readonly commands: { readonly candidate: { readonly run: (argv: readonly string[]) => Promise<CommandResult> } };
      readonly start: (
        argv: readonly [string, ...string[]],
        options?: { readonly env?: NodeJS.ProcessEnv },
      ) => ManagedProcess;
    }) => Promise<void>,
  ) => Promise<void>;
};

const testkitModule = "@niceeval/" + "testkit";
const { createE2EContext, waitForOutput } = await import(testkitModule) as unknown as {
  readonly createE2EContext: (input: unknown) => E2EContext;
  readonly waitForOutput: (
    process: ManagedProcess,
    stream: "stdout" | "stderr",
    pattern: RegExp,
    options: { readonly timeoutMs: number; readonly label: string },
  ) => Promise<string>;
};

const installedNiceeval = [
  process.execPath,
  join(process.cwd(), "node_modules", "niceeval", "bin", "niceeval.js"),
] as const;

const e2e = createE2EContext({
  repoId: "migrate",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-record-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { candidate: installedNiceeval },
});

function requiredObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Record journey requires public ${name}.`);
  }
  return value as Record<string, unknown>;
}

function requiredMethod(value: unknown, name: string): (...args: any[]) => any {
  if (typeof value !== "function") {
    throw new Error(`Record journey requires public ${name}().`);
  }
  return value as (...args: any[]) => any;
}

function requiredEffect<T>(value: unknown, name: string): Effect.Effect<T, unknown, never> {
  if (value === undefined || value === null) {
    throw new Error(`Record journey expected ${name}() to return an Effect.`);
  }
  return value as Effect.Effect<T, unknown, never>;
}

function rightOf(value: unknown): unknown {
  const result = requiredObject(value, "makeRecordRoot result");
  if (result._tag === "Right") return result.right;
  throw new Error("Record journey could not create its public ProjectRecordStore root.");
}

function availableRun(readableRun: unknown): Record<string, unknown> {
  const run = requiredObject(readableRun, "sealed Run read");
  if (run.state !== "available") throw new Error("Record journey expected its sealed Run to be available.");
  return requiredObject(run.value, "sealed Run value");
}

function availableAttempt(readableRun: Record<string, unknown>): Record<string, unknown> {
  const value = readableRun;
  const members = value.members;
  if (!Array.isArray(members) || members.length !== 1) {
    throw new Error("Record journey expected one sealed Attempt member.");
  }
  const attempt = requiredObject(members[0], "sealed Attempt member").attempt;
  if (attempt === null || attempt === undefined) {
    throw new Error("Record journey expected an executed Attempt.");
  }
  return requiredObject(attempt, "sealed Attempt reference");
}

function lastJsonLine<T>(output: string, label: string): T {
  const line = output.trim().split("\n").at(-1);
  if (line === undefined || line.length === 0) throw new Error(`${label} did not emit JSON.`);
  return JSON.parse(line) as T;
}

function writeInspectionRequest(
  projectRoot: string,
  name: string,
  operation: Record<string, unknown>,
): string {
  const path = join(projectRoot, name);
  writeFileSync(path, `${JSON.stringify({ protocol: "niceeval.query/v1", operation })}\n`, "utf8");
  return path;
}

test("Record rich facts 与 collection 在封口后可读，并只以 snapshot 交给 CLI", async () => {
  await e2e.case(
    "sqlite-record-collection-and-portable-snapshot",
    async ({ paths, commands: { candidate } }) => {
      const recordModule = "niceeval/" + "record";
      const record = await import(recordModule) as unknown as RecordModule;
      const api = requiredObject(record, "niceeval/record module");
      const RecordApi = requiredObject(api.Record, "Record");
      const attemptRecord = requiredMethod(RecordApi.attempt, "Record.attempt");
      const runRecord = requiredMethod(RecordApi.run, "Record.run");
      const attemptCollection = requiredMethod(
        RecordApi.attemptCollection,
        "Record.attemptCollection",
      );
      const makeRecordHost = requiredMethod(api.makeRecordHost, "makeRecordHost");
      const makeRecordRoot = requiredMethod(api.makeRecordRoot, "makeRecordRoot");
      const nodeRecordLive = api.NodeRecordLive;
      if (nodeRecordLive === undefined) {
        throw new Error("Record journey requires public NodeRecordLive.");
      }

      const attemptNote = attemptRecord({
        family: "e2e.attempt-note",
        schema: Schema.Struct({ marker: Schema.String }),
      });
      const runNote = runRecord({
        family: "e2e.run-note",
        schema: Schema.Struct({ marker: Schema.String }),
      });
      const turnMetrics = attemptCollection({
        family: "e2e.turn-metrics",
        item: Schema.Struct({
          sessionIndex: Schema.Number,
          turnIndex: Schema.Number,
          latencyMs: Schema.Number,
        }),
      });
      const host = requiredObject(
        makeRecordHost({ records: [attemptNote, runNote, turnMetrics] }),
        "Record Host",
      );
      const createRun = requiredMethod(host.createRun, "RecordHostSDK.createRun");
      const openRead = requiredMethod(host.openRead, "RecordHostSDK.openRead");
      const recordRoot = join(paths.projectRoot, ".niceeval", "record");
      const root = rightOf(makeRecordRoot(recordRoot));
      const slot = {
        slotId: "turn-metrics-slot",
        evalId: "turn-metrics",
        attemptOrdinal: 0,
        executionIdentityDigest: "0".repeat(64),
      };

      const program = Effect.scoped(Effect.gen(function* () {
        const run = yield* requiredEffect<Record<string, unknown>>(
          createRun({
            root,
            core: {
              experimentId: "record-collection",
              context: {
                experimentId: "record-collection",
                execution: {
                  agentId: "e2e",
                  model: null,
                  reasoningEffort: null,
                  flags: {},
                },
                labels: {},
              },
              startedAt: 1,
              expectedSlots: [slot],
            },
          }),
          "RecordHostSDK.createRun",
        );
        const createAttempt = requiredMethod(run.createAttempt, "RunWriteSession.createAttempt");
        const runRecords = requiredObject(run.records, "RunWriteSession.records");
        const writeRunRecord = requiredMethod(runRecords.write, "RunWriteSession.records.write");
        yield* requiredEffect<unknown>(
          writeRunRecord(runNote, { marker: "sealed-run-note" }),
          "RunWriteSession.records.write",
        );
        const attempt = yield* requiredEffect<Record<string, unknown>>(
          createAttempt({ slotId: slot.slotId }),
          "RunWriteSession.createAttempt",
        );
        const records = requiredObject(attempt.records, "AttemptWriteSession.records");
        const writeAttemptRecord = requiredMethod(records.write, "AttemptWriteSession.records.write");
        const append = requiredMethod(records.append, "AttemptWriteSession.records.append");
        const appendAll = requiredMethod(records.appendAll, "AttemptWriteSession.records.appendAll");
        const close = requiredMethod(records.close, "AttemptWriteSession.records.close");

        yield* requiredEffect<unknown>(
          writeAttemptRecord(attemptNote, { marker: "sealed-attempt-note" }),
          "AttemptWriteSession.records.write",
        );
        const first = { sessionIndex: 0, turnIndex: 0, latencyMs: 12 };
        const firstReceipt = yield* requiredEffect<unknown>(
          append(turnMetrics, first),
          "AttemptWriteSession.records.append",
        );
        first.latencyMs = 999;
        yield* requiredEffect<unknown>(
          appendAll(turnMetrics, Stream.fromIterable([
            { sessionIndex: 0, turnIndex: 1, latencyMs: 34 },
            { sessionIndex: 1, turnIndex: 0, latencyMs: 56 },
          ])),
          "AttemptWriteSession.records.appendAll",
        );
        yield* requiredEffect<unknown>(
          close(turnMetrics, { state: "complete" }),
          "AttemptWriteSession.records.close",
        );
        const complete = requiredMethod(attempt.complete, "AttemptWriteSession.complete");
        yield* requiredEffect<unknown>(complete("completed"), "AttemptWriteSession.complete");
        const seal = requiredMethod(run.seal, "RunWriteSession.seal");
        const receipt = yield* requiredEffect<Record<string, unknown>>(
          seal({ completedAt: 2 }),
          "RunWriteSession.seal",
        );

        expect(firstReceipt).toEqual({ state: "retained" });
        const runId = receipt.runId;
        expect(typeof runId).toBe("string");

        const reader = yield* requiredEffect<Record<string, unknown>>(
          openRead({ root }),
          "RecordHostSDK.openRead",
        );
        const selectRuns = requiredMethod(reader.selectRuns, "RecordReadSession.selectRuns");
        const selection = yield* requiredEffect<Record<string, unknown>>(
          selectRuns({ runIds: [runId] }),
          "RecordReadSession.selectRuns",
        );
        const refs = selection.runRefs;
        if (!Array.isArray(refs) || refs.length !== 1) {
          throw new Error("Record journey expected its sealed Run to be selectable.");
        }
        const readRun = requiredMethod(reader.readRun, "RecordReadSession.readRun");
        const sealedRun = availableRun(yield* requiredEffect(
          readRun(refs[0]),
          "RecordReadSession.readRun",
        ));
        const attemptRef = availableAttempt(sealedRun);
        const readAttempt = requiredMethod(reader.readAttempt, "RecordReadSession.readAttempt");
        const sealedAttempt = requiredObject(yield* requiredEffect(
          readAttempt(attemptRef),
          "RecordReadSession.readAttempt",
        ), "sealed Attempt read");
        if (sealedAttempt.state !== "available") {
          throw new Error("Record journey expected its sealed Attempt to be available.");
        }
        const attemptOwner = requiredObject(sealedAttempt.value, "sealed Attempt value").owner;
        const read = requiredMethod(reader.read, "RecordReadSession.read");
        const runFact = requiredObject(yield* requiredEffect(
          read(requiredObject(sealedRun.owner, "sealed Run owner"), runNote),
          "RecordReadSession.read run record",
        ), "Run record read");
        expect(runFact).toMatchObject({
          state: "available",
          value: { marker: "sealed-run-note" },
        });
        const attemptFact = requiredObject(yield* requiredEffect(
          read(attemptOwner, attemptNote),
          "RecordReadSession.read attempt record",
        ), "Attempt record read");
        expect(attemptFact).toMatchObject({
          state: "available",
          value: { marker: "sealed-attempt-note" },
        });
        const bounded = requiredObject(yield* requiredEffect(
          read(attemptOwner, turnMetrics),
          "RecordReadSession.read",
        ), "bounded collection read");
        expect(bounded).toMatchObject({
          state: "available",
          value: {
            collection: { state: "complete", limitations: [] },
            items: [
              { sessionIndex: 0, turnIndex: 0, latencyMs: 12 },
              { sessionIndex: 0, turnIndex: 1, latencyMs: 34 },
              { sessionIndex: 1, turnIndex: 0, latencyMs: 56 },
            ],
          },
        });

        const openCollection = requiredMethod(reader.openCollection, "RecordReadSession.openCollection");
        const opened = requiredObject(yield* requiredEffect(
          openCollection(attemptOwner, turnMetrics),
          "RecordReadSession.openCollection",
        ), "opened collection");
        expect(opened).toMatchObject({
          state: "available",
          collection: expect.objectContaining({ state: "complete" }),
        });
        const items = opened.items;
        if (items === undefined) throw new Error("Record journey expected an openCollection item Stream.");
        const streamed: Metric[] = [];
        yield* Stream.runForEach(items as Stream.Stream<Metric>, (item) =>
          Effect.sync(() => streamed.push(item)),
        );
        expect(streamed).toEqual([
          { sessionIndex: 0, turnIndex: 0, latencyMs: 12 },
          { sessionIndex: 0, turnIndex: 1, latencyMs: 34 },
          { sessionIndex: 1, turnIndex: 0, latencyMs: 56 },
        ]);

        const unclosedSlot = {
          ...slot,
          slotId: "unclosed-collection-slot",
          evalId: "unclosed-collection",
        };
        const unclosedRun = yield* requiredEffect<Record<string, unknown>>(
          createRun({
            root,
            core: {
              experimentId: "record-unclosed-collection",
              context: {
                experimentId: "record-unclosed-collection",
                execution: {
                  agentId: "e2e",
                  model: null,
                  reasoningEffort: null,
                  flags: {},
                },
                labels: {},
              },
              startedAt: 3,
              expectedSlots: [unclosedSlot],
            },
          }),
          "RecordHostSDK.createRun for unclosed collection",
        );
        const unclosedAttempt = yield* requiredEffect<Record<string, unknown>>(
          requiredMethod(unclosedRun.createAttempt, "RunWriteSession.createAttempt")({
            slotId: unclosedSlot.slotId,
          }),
          "RunWriteSession.createAttempt for unclosed collection",
        );
        const unclosedRecords = requiredObject(
          unclosedAttempt.records,
          "unclosed AttemptWriteSession.records",
        );
        yield* requiredEffect<unknown>(
          requiredMethod(unclosedRecords.append, "AttemptWriteSession.records.append")(
            turnMetrics,
            { sessionIndex: 9, turnIndex: 9, latencyMs: 9 },
          ),
          "AttemptWriteSession.records.append for unclosed collection",
        );
        const completion = yield* Effect.either(requiredEffect<unknown>(
          requiredMethod(unclosedAttempt.complete, "AttemptWriteSession.complete")("completed"),
          "AttemptWriteSession.complete for unclosed collection",
        ));
        expect(completion).toMatchObject({
          _tag: "Left",
          left: {
            code: "record-collection-not-closed",
            family: "e2e.turn-metrics",
          },
        });
        return { runId: runId as string };
      }));

      const written = await Effect.runPromise(
        Effect.provide(program, nodeRecordLive as never) as Effect.Effect<{ runId: string }, never, never>,
      );
      expect(readdirSync(recordRoot).sort()).toEqual(["record.sqlite"]);
      expect(existsSync(join(paths.projectRoot, ".niceeval", "runs"))).toBe(false);
      expect(existsSync(join(paths.projectRoot, ".niceeval", "content"))).toBe(false);
      const snapshot = join(paths.projectRoot, "record-snapshot.sqlite");
      const exported = await candidate.run(["record", "snapshot", "--output", snapshot]);
      expect(exported.exitCode, exported.diagnostic()).toBe(0);
      expect(existsSync(snapshot), exported.diagnostic()).toBe(true);

      const requestPath = join(paths.projectRoot, "run-summary.request.json");
      writeFileSync(
        requestPath,
        `${JSON.stringify({
          protocol: "niceeval.query/v1",
          operation: { kind: "run.summary", runId: written.runId },
        })}\n`,
        "utf8",
      );
      const fromSnapshot = await candidate.run([
        "query", "run", "--record", snapshot, "--request", requestPath,
      ]);
      expect(fromSnapshot.exitCode, fromSnapshot.diagnostic()).toBe(0);
      const snapshotDocument = fromSnapshot.json() as {
        readonly selection: { readonly selectedRunIds: readonly string[] };
      };
      expect(snapshotDocument.selection.selectedRunIds).toEqual([written.runId]);

      const operationalCopy = join(paths.projectRoot, "operational-copy.sqlite");
      cpSync(join(recordRoot, "record.sqlite"), operationalCopy);
      const fromOperationalCopy = await candidate.run([
        "query", "run", "--record", operationalCopy, "--request", requestPath,
      ]);
      expect(fromOperationalCopy.exitCode, fromOperationalCopy.diagnostic()).toBe(2);
      expect(fromOperationalCopy.json()).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "run.summary",
        outcome: "failure",
        failure: {
          code: "inspection-source-invalid",
          correction: "fix-record-source",
        },
      });
      expect(fromOperationalCopy.stderr.trim(), fromOperationalCopy.diagnostic()).toBe(
        "niceeval query failed: inspection-source-invalid",
      );
    },
  );
});

test("Record 以受限 whole read 和流式 Content 处理大型已封口事实", async () => {
  await e2e.case(
    "sqlite-record-streaming-admission",
    async ({ paths, start }) => {
      const recordRoot = join(paths.projectRoot, ".niceeval", "record");
      const host = start([
        process.execPath,
        "--max-old-space-size=96",
        "--max-semi-space-size=8",
        join(paths.projectRoot, "fixtures", "record-host.mjs"),
        "heavy",
        recordRoot,
      ]);
      const receipt = await host.done;
      expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
      expect(receipt.signal, receipt.diagnostic()).toBeNull();
      const result = lastJsonLine<{
        readonly peakRss: number;
        readonly rss: readonly { readonly phase: string; readonly rss: number }[];
        readonly collection: { readonly count: number; readonly first: { readonly ordinal: number }; readonly last: { readonly ordinal: number }; readonly digest: string };
        readonly content: { readonly byteLength: number; readonly chunks: number; readonly digest: string };
      }>(receipt.stdout, "installed Record Host");
      expect(result.collection.count).toBe(50_000);
      expect(result.collection.first.ordinal).toBe(0);
      expect(result.collection.last.ordinal).toBe(49_999);
      expect(result.collection.digest).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.content).toMatchObject({
        byteLength: 144 * 1024 * 1024,
        digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(result.content.chunks).toBeGreaterThan(1);
      expect(result.rss.map((sample) => sample.phase)).toEqual([
        "started", "sealed", "collection-read", "content-read",
      ]);
      const startingRss = result.rss[0]?.rss;
      if (startingRss === undefined) throw new Error("installed Record Host omitted its starting RSS sample");
      for (const sample of result.rss) {
        expect(
          sample.rss - startingRss,
          `installed Record Host RSS growth at ${sample.phase}`,
        ).toBeLessThan(result.content.byteLength);
        expect(result.peakRss).toBeGreaterThanOrEqual(sample.rss);
      }
      expect(
        result.peakRss - startingRss,
        "installed Record Host observed peak RSS growth",
      ).toBeLessThan(result.content.byteLength);
    },
  );
});

test("Record Host 崩溃时只公开完整封口后的 Run", async () => {
  await e2e.case(
    "sqlite-record-crash-publication",
    async ({ paths, commands: { candidate }, start }) => {
      const recordRoot = join(paths.projectRoot, ".niceeval", "record");
      const fixture = join(paths.projectRoot, "fixtures", "record-host.mjs");
      const beforeSeal = start([process.execPath, fixture, "before-seal", recordRoot]);
      await waitForOutput(beforeSeal, "stdout", /"event":"before-seal"/u, {
        timeoutMs: 30_000,
        label: "Record Host before seal handshake",
      });
      expect(beforeSeal.signal("SIGKILL")).toBe(true);
      const beforeSealReceipt = await beforeSeal.done;
      expect(beforeSealReceipt.signal, beforeSealReceipt.diagnostic()).toBe("SIGKILL");

      const emptySnapshot = join(paths.projectRoot, "empty-after-crash.snapshot.sqlite");
      const emptyExport = await candidate.run(["record", "snapshot", "--output", emptySnapshot]);
      expect(emptyExport.exitCode, emptyExport.diagnostic()).toBe(0);
      const listRequest = writeInspectionRequest(paths.projectRoot, "runs-list.request.json", { kind: "runs.list" });
      const emptyQuery = await candidate.run(["query", "run", "--record", emptySnapshot, "--request", listRequest]);
      expect(emptyQuery.exitCode, emptyQuery.diagnostic()).toBe(0);
      const emptyDocument = emptyQuery.json() as { readonly selection: { readonly selectedRunIds: readonly string[] } };
      expect(emptyDocument.selection.selectedRunIds).toEqual([]);

      const afterSeal = start([process.execPath, fixture, "after-seal", recordRoot]);
      const sealedOutput = await waitForOutput(afterSeal, "stdout", /"event":"sealed"/u, {
        timeoutMs: 30_000,
        label: "Record Host after seal handshake",
      });
      const sealed = lastJsonLine<{ readonly event: "sealed"; readonly runId: string }>(sealedOutput, "sealed Record Host");
      expect(sealed.runId).toEqual(expect.any(String));
      expect(afterSeal.signal("SIGKILL")).toBe(true);
      const afterSealReceipt = await afterSeal.done;
      expect(afterSealReceipt.signal, afterSealReceipt.diagnostic()).toBe("SIGKILL");

      const sealedSnapshot = join(paths.projectRoot, "sealed-after-crash.snapshot.sqlite");
      const sealedExport = await candidate.run(["record", "snapshot", "--output", sealedSnapshot]);
      expect(sealedExport.exitCode, sealedExport.diagnostic()).toBe(0);
      const sealedQuery = await candidate.run(["query", "run", "--record", sealedSnapshot, "--request", listRequest]);
      expect(sealedQuery.exitCode, sealedQuery.diagnostic()).toBe(0);
      const sealedDocument = sealedQuery.json() as { readonly selection: { readonly selectedRunIds: readonly string[] } };
      expect(sealedDocument.selection.selectedRunIds).toEqual([sealed.runId]);

      const summaryRequest = writeInspectionRequest(paths.projectRoot, "sealed-run-summary.request.json", {
        kind: "run.summary",
        runId: sealed.runId,
      });
      const summary = await candidate.run(["query", "run", "--record", sealedSnapshot, "--request", summaryRequest]);
      expect(summary.exitCode, summary.diagnostic()).toBe(0);
      expect((summary.json() as { readonly selection: { readonly selectedRunIds: readonly string[] } }).selection.selectedRunIds).toEqual([sealed.runId]);
    },
  );
});
