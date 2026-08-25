// owner: docs/engineering/testing/e2e/migrate.md#sqlite-record-collection-and-portable-snapshot

import { cpSync, existsSync, writeFileSync } from "node:fs";
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
  readonly diagnostic: () => string;
  readonly json: () => unknown;
};

type E2EContext = {
  readonly case: (
    name: string,
    body: (input: {
      readonly paths: { readonly projectRoot: string };
      readonly commands: { readonly candidate: { readonly run: (argv: readonly string[]) => Promise<CommandResult> } };
    }) => Promise<void>,
  ) => Promise<void>;
};

const testkitModule = "@niceeval/" + "testkit";
const { createE2EContext } = await import(testkitModule) as unknown as {
  readonly createE2EContext: (input: unknown) => E2EContext;
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

function availableAttempt(readableRun: unknown): Record<string, unknown> {
  const run = requiredObject(readableRun, "sealed Run read");
  if (run.state !== "available") throw new Error("Record journey expected its sealed Run to be available.");
  const value = requiredObject(run.value, "sealed Run value");
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

test("Record collection 在封口后保持 immutable 顺序并只以 snapshot 交给 CLI", async () => {
  await e2e.case(
    "sqlite-record-collection-and-portable-snapshot",
    async ({ paths, commands: { candidate } }) => {
      const recordModule = "niceeval/" + "record";
      const record = await import(recordModule) as unknown as RecordModule;
      const api = requiredObject(record, "niceeval/record module");
      const RecordApi = requiredObject(api.Record, "Record");
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

      const turnMetrics = attemptCollection({
        family: "e2e.turn-metrics",
        item: Schema.Struct({
          sessionIndex: Schema.Number,
          turnIndex: Schema.Number,
          latencyMs: Schema.Number,
        }),
      });
      const host = requiredObject(makeRecordHost({ records: [turnMetrics] }), "Record Host");
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
        const attempt = yield* requiredEffect<Record<string, unknown>>(
          createAttempt({ slotId: slot.slotId }),
          "RunWriteSession.createAttempt",
        );
        const records = requiredObject(attempt.records, "AttemptWriteSession.records");
        const append = requiredMethod(records.append, "AttemptWriteSession.records.append");
        const appendAll = requiredMethod(records.appendAll, "AttemptWriteSession.records.appendAll");
        const close = requiredMethod(records.close, "AttemptWriteSession.records.close");

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
        const attemptRef = availableAttempt(yield* requiredEffect(
          readRun(refs[0]),
          "RecordReadSession.readRun",
        ));
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
        return { runId: runId as string };
      }));

      const written = await Effect.runPromise(
        Effect.provide(program, nodeRecordLive as never) as Effect.Effect<{ runId: string }, never, never>,
      );
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
        readonly selection: { readonly runIds: readonly string[] };
      };
      expect(snapshotDocument.selection.runIds).toEqual([written.runId]);

      const operationalCopy = join(paths.projectRoot, "operational-copy.sqlite");
      cpSync(join(recordRoot, "record.sqlite"), operationalCopy);
      const fromOperationalCopy = await candidate.run([
        "query", "run", "--record", operationalCopy, "--request", requestPath,
      ]);
      expect(fromOperationalCopy.exitCode, fromOperationalCopy.diagnostic()).toBe(1);
      expect(fromOperationalCopy.stdout, fromOperationalCopy.diagnostic()).not.toContain('"selection"');
    },
  );
});
