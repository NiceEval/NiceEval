import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Effect, Result, Schema } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import {
  openInspectionSource,
  operationalInspectionSource,
  selectInspectionOperation,
} from "../../packages/niceeval/src/inspection/index.ts";
import { makeRecordRoot, NodeRecordLive, recordHost, RunIdSchema } from "../../packages/niceeval/src/record/index.ts";
import { createRunWriterGeneration } from "../../packages/niceeval/src/run/storage/owner-identity.ts";
import {
  bindAttemptReference,
  closeRunResource,
  createRunResource,
} from "../../packages/niceeval/src/run/storage/sqlite.ts";
import { createRecordProject } from "./fixtures/record-harness/project.ts";

let cwd: string;
let locator: string;
let targetRunIds: readonly string[];

beforeAll(async () => {
  cwd = await createRecordProject("niceeval-inspection-attempt-fanout-", { held: false });
  const config = { maxConcurrency: 1, maxRetries: 0 };
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({ cwd, experimentSelector: "runs", config, overrides: { rerun: "all" } }),
  );
  if (planned.status !== "ready") throw new Error(JSON.stringify(planned));
  const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  const originRunId = Schema.decodeUnknownSync(RunIdSchema)(receipt.createdRunIds[0]);
  const { run } = await Effect.runPromise(runHost.get({ cwd, runId: originRunId }));
  const { publication } = run.slots[0]!;
  if (publication.state !== "published") throw new Error("Expected a published Attempt");
  locator = publication.attemptLocator;
  const storageRoot = join(cwd, ".niceeval");
  const root = makeRecordRoot(storageRoot);
  if (Result.isFailure(root)) throw new Error(JSON.stringify(root.failure));

  // Stage real Run and Member publications without replanning the same project for each reference.
  targetRunIds = await Effect.runPromise(
    Effect.gen(function* () {
      const reader = yield* recordHost.openRead({ root: root.success });
      const selection = yield* reader.selectRuns({ runIds: [originRunId] });
      const origin = yield* reader.readRun(selection.runRefs[0]!);
      if (origin.state !== "available") throw new Error("Expected a readable origin Run");
      const reference = origin.value.members[0]?.attempt;
      const publicationIdentity = reference?.publicationIdentity;
      if (reference === undefined || publicationIdentity === undefined) throw new Error("Missing publication identity");
      const { completedAt, context, expectedSlots, experimentId, runId, startedAt } = origin.value.document;
      const started = new Date(startedAt).toISOString();
      const completed = new Date(completedAt).toISOString();
      const carried = yield* Effect.forEach(
        Array.from({ length: 64 }, (_, index) => index),
        (index) =>
          Effect.scoped(
            Effect.gen(function* () {
              const invocationId = `inspection-fanout-${index}`;
              const writerGeneration = createRunWriterGeneration(invocationId);
              const target = yield* recordHost.createReferenceRun({
                root: root.success, context, expectedSlots, experimentId, startedAt, writerGeneration,
              });
              yield* createRunResource(storageRoot, {
                runId: target.runId,
                invocationId,
                experimentId,
                writerGeneration,
                startedAt: started,
                expectedSlots,
                deadlineEpochMs: Date.now() + 30_000,
              });
              const slotId = expectedSlots[0]!.slotId;
              yield* target.referenceAttempt({ slotId, action: "carried", attempt: reference });
              yield* bindAttemptReference(storageRoot, {
                runId: target.runId, writerGeneration, slotId, action: "carried", publicationIdentity,
                deadlineEpochMs: Date.now() + 30_000,
              });
              yield* target.seal({ completedAt });
              yield* closeRunResource(storageRoot, {
                runId: target.runId, writerGeneration, state: "completed", completedAt: completed, absences: [],
                deadlineEpochMs: Date.now() + 30_000,
              });
              return target.runId;
            }),
          ),
      );
      return [runId, ...carried];
    }).pipe(Effect.scoped, Effect.provide(NodeRecordLive)),
  );
}, 60_000);

afterAll(async () => {
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
test("reads every sealed target of an Attempt referenced across many Runs", async () => {
  const document = await Effect.runPromise(
    Effect.scoped(
      openInspectionSource(operationalInspectionSource(cwd)).pipe(
        Effect.map((facts) => selectInspectionOperation<"attempt.get">(facts, { kind: "attempt.get", locator })),
      ),
    ),
  );
  expect(document.attempt.locator).toBe(locator);
  const expectedRunIds = [...targetRunIds].sort();
  expect(document.attempt.targets.map(({ runId }) => runId).sort()).toEqual(expectedRunIds);
  expect(document.links.filter((link) => link.rel === "run").map((link) => link.command).sort()).toEqual(
    expectedRunIds.map((runId) => `niceeval show run:${runId}`).sort(),
  );
});
