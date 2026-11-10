// cases: docs/engineering/testing/architecture/unit/record.md
import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Result, Schema } from "effect";
import { expect, it } from "vitest";
import { defineRecordAttachment, defineRecordAttachmentPersistence, RecordOwner } from "../attachment/index.ts";
import { recordContributionFromAttachmentPersistence } from "../authoring.ts";
import { attemptPublicationClosure, RecordSlotIdentitySchema } from "../codec/core.ts";
import { encodeAttemptLocator } from "../../attempt-locator.ts";
import { createRunResource, publishOriginAttempt, closeRunResource } from "../../run/storage/index.ts";
import { ExperimentIdSchema, UtcMillisSchema } from "../codec/identifiers.ts";
import { NodeRecordLive } from "../platform/node.ts";
import { makeRecordRoot } from "../platform/root.ts";
import { makeRecordHost } from "./sqlite-host.ts";
import { openInspectionSource } from "../../inspection/source.ts";
import { decodeInspectionRun } from "../../inspection/facts.ts";

// @feature docs/feature/run/README.md
it("seals large Attempt payloads as chunks and reads the complete value after later Attempts finish", async () => {
  const path = await mkdtemp(join(tmpdir(), "niceeval-cold-payload-"));
  try {
    const root = Result.getOrThrow(makeRecordRoot(path));
    const attachment = defineRecordAttachment({
      owner: RecordOwner.attempt,
      family: "test.cold-payload",
      schema: Schema.Struct({ prompt: Schema.String, tokens: Schema.Number }),
    });
    const host = makeRecordHost({ records: [recordContributionFromAttachmentPersistence(
      defineRecordAttachmentPersistence({ attachment, revision: 1 }),
    )] });
    const experimentId = Schema.decodeUnknownSync(ExperimentIdSchema)("cold-payload");
    const slots = [0, 1].map((attemptOrdinal) => Schema.decodeUnknownSync(RecordSlotIdentitySchema)({
      slotId: `slot-${attemptOrdinal}`, evalId: "cold-payload", attemptOrdinal,
      executionIdentityDigest: "a".repeat(64),
    }));
    const prompt = "检索 evidence 🌳\n".repeat(35_000);
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const startedAt = Schema.decodeUnknownSync(UtcMillisSchema)(Date.now());
      const writerGeneration = "cold-payload-writer";
      const context = { experimentId, execution: { adapter: null, model: null, reasoningEffort: null, flags: {} }, labels: {} };
      const run = yield* host.current.createRun({ root, experimentId, startedAt, expectedSlots: slots,
        writerGeneration, context,
      });
      yield* createRunResource(path, { runId: run.runId, invocationId: "cold-payload-invocation", experimentId,
        writerGeneration, startedAt: new Date(startedAt).toISOString(), expectedSlots: slots, deadlineEpochMs: Date.now() + 10_000 });
      for (const slot of slots) {
        const attempt = yield* run.createAttempt({ slotId: slot.slotId });
        yield* attempt.records.write(attachment, { prompt, tokens: 123 });
        yield* attempt.complete("completed");
        const closureBytes = new TextEncoder().encode(JSON.stringify(attemptPublicationClosure({
          runId: run.runId, experimentId, context, startedAt, completedAt: Date.now(), expectedSlots: slots,
        })));
        yield* publishOriginAttempt(path, { runId: run.runId, writerGeneration, slotId: slot.slotId,
          attemptId: attempt.attemptId, attemptLocator: encodeAttemptLocator(attempt.attemptId),
          closureBytes, closureDigest: createHash("sha256").update(closureBytes).digest("hex"), deadlineEpochMs: Date.now() + 10_000 });
      }
      yield* run.seal({ completedAt: Schema.decodeUnknownSync(UtcMillisSchema)(Date.now()) });
      yield* closeRunResource(path, { runId: run.runId, writerGeneration, state: "completed",
        completedAt: new Date().toISOString(), absences: [], deadlineEpochMs: Date.now() + 10_000 });
      const db = new DatabaseSync(join(path, "record.sqlite"), { readOnly: true });
      try {
        const rows = db.prepare("SELECT length(canonical_payload) AS bytes FROM ne19_attachments WHERE family=?").all(attachment.family);
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => Number(row.bytes) < 128)).toBe(true);
        expect(Number(db.prepare("SELECT count(*) AS count FROM ne19_content_chunks").get()!.count)).toBeGreaterThan(2);
      } finally { db.close(); }
      const reader = yield* host.current.openRead({ root });
      const selection = yield* reader.selectRuns({ runIds: [run.runId] });
      expect(selection.runRefs).toHaveLength(1);
      const readRun = yield* reader.readRun(selection.runRefs[0]!);
      if (readRun.state !== "available") throw new Error("Run is unavailable");
      for (const member of readRun.value.members) {
        if (member.attempt === null) throw new Error("Attempt is absent");
        const readAttempt = yield* reader.readAttempt(member.attempt);
        if (readAttempt.state !== "available") throw new Error("Attempt is unavailable");
        const value = yield* reader.read(readAttempt.value.owner, attachment);
        if (value.state !== "available") throw new Error(`Attachment is ${value.state}`);
        expect(value.value).toEqual({ prompt, tokens: 123 });
      }
      const source = yield* openInspectionSource({ kind: "project-record", databasePath: join(path, "record.sqlite") });
      const core = source.readSealedRunCore(run.runId);
      if (core === undefined) throw new Error("Inspection Run is unavailable");
      let coldReads = 0;
      const decoded = decodeInspectionRun({ ...source, readContentPage: (...args) => {
        coldReads += 1;
        return source.readContentPage(...args);
      } }, core);
      expect(coldReads).toBe(0);
      for (const value of decoded.attachments) {
        expect(value.physical.contents).toEqual([]);
        expect(value.value).toEqual({ prompt, tokens: 123 });
      }
      expect(coldReads).toBeGreaterThan(0);
    })).pipe(Effect.provide(NodeRecordLive)));
  } finally { await rm(path, { recursive: true, force: true }); }
}, 30_000);
