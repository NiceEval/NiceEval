// owner: docs/engineering/testing/e2e/migrate.md#attempt-record-collection

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Either, Schema } from "effect";
import {
  defineAttemptRecordCollection,
  makeRecordHost,
  makeRecordRoot,
  NodeRecordLive,
} from "niceeval/record";
import { expect, test } from "vitest";

const turnMetrics = defineAttemptRecordCollection({
  family: "acme.turn-metrics",
  item: Schema.Struct({
    sessionIndex: Schema.Number,
    turnIndex: Schema.Number,
    latencyMs: Schema.Number,
  }),
});

test("Attempt producer 多次 append 后发布有序 immutable collection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "niceeval-attempt-collection-"));
  const host = makeRecordHost({ records: [turnMetrics] });
  const slot = {
    slotId: "slot-0" as never,
    evalId: "turn-metrics" as never,
    attemptOrdinal: 0,
    executionIdentityDigest: "0".repeat(64) as never,
  };

  try {
    const rootResult = makeRecordRoot(join(directory, "record"));
    if (Either.isLeft(rootResult)) throw new Error("root invalid");
    const root = rootResult.right;

    const result = await Effect.runPromise(Effect.gen(function* () {
      const write = yield* Effect.scoped(Effect.gen(function* () {
        const run = yield* host.current.createRun({
          root,
          experimentId: "attempt-collection" as never,
          context: {
            experimentId: "attempt-collection" as never,
            execution: {
              agentId: "fixture",
              model: null,
              reasoningEffort: null,
              flags: {},
            },
            labels: {},
          },
          startedAt: 1 as never,
          expectedSlots: [slot],
        });
        const attempt = yield* run.createAttempt({ slotId: slot.slotId });
        yield* attempt.record.start(turnMetrics);

        const first = { sessionIndex: 0, turnIndex: 0, latencyMs: 12 };
        const firstReceipt = yield* attempt.record.append(turnMetrics(first));
        first.latencyMs = 999;
        const secondReceipt = yield* attempt.record.append(turnMetrics({
          sessionIndex: 1,
          turnIndex: 0,
          latencyMs: 34,
        }));

        yield* attempt.complete("completed");
        yield* run.seal({ completedAt: 2 as never });
        return { runId: run.runId, firstReceipt, secondReceipt };
      }));

      const collection = yield* Effect.scoped(Effect.gen(function* () {
        const reader = yield* host.current.openRead({ root });
        const selection = yield* reader.selectRuns({ runIds: [write.runId] });
        const run = yield* reader.readRun(selection.runRefs[0]!);
        if (run.state !== "available") return yield* Effect.die("sealed Run unavailable");
        const attemptRef = run.value.members[0]?.attempt;
        if (attemptRef === null || attemptRef === undefined) {
          return yield* Effect.die("executed Attempt unavailable");
        }
        const attempt = yield* reader.readAttempt(attemptRef);
        if (attempt.state !== "available") return yield* Effect.die("sealed Attempt unavailable");
        return yield* reader.read(attempt.value.owner, turnMetrics);
      }));

      return { ...write, collection };
    }).pipe(Effect.provide(NodeRecordLive)));

    expect(result.firstReceipt).toEqual({ state: "retained" });
    expect(result.secondReceipt).toEqual({ state: "retained" });
    expect(result.collection).toEqual({
      state: "available",
      value: {
        collection: { state: "complete", limitations: [] },
        items: [
          { sessionIndex: 0, turnIndex: 0, latencyMs: 12 },
          { sessionIndex: 1, turnIndex: 0, latencyMs: 34 },
        ],
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
