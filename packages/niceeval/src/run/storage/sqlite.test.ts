// cases: docs/engineering/testing/unit/record.md
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { encodeAttemptLocator } from "../../attempt-locator.ts";
import { closeRecordDatabase, openRecordWriter } from "../../record/sqlite/database.ts";
import { admitAttachment, admitAttempt, beginRun } from "../../record/sqlite/storage.ts";
import { createRunResourceOnConnection, publishOriginAttemptOnConnection } from "./sqlite.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Attempt publication fencing", () => {
  it("freezes a published aggregate against late and old-generation writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-publication-"));
    roots.push(root);
    const connection = openRecordWriter(join(root, "record.sqlite"));
    const runId = "run-publication";
    const attemptId = "00000000-0000-4000-8000-000000000001";
    const slotId = "slot-publication";
    const generation = "generation-current";
    const locator = encodeAttemptLocator(attemptId as never);
    const core = Buffer.from("{}");
    const digest = createHash("sha256").update(core).digest("hex");
    const deadlineEpochMs = Date.now() + 5_000;

    beginRun(connection, { runId, writerGeneration: generation, startedAt: "2026-01-01T00:00:00.000Z", deadlineEpochMs });
    createRunResourceOnConnection(connection, {
      runId,
      invocationId: "invocation-publication",
      experimentId: "experiment-publication",
      writerGeneration: generation,
      startedAt: "2026-01-01T00:00:00.000Z",
      expectedSlots: [{ slotId, evalId: "eval-publication", attemptOrdinal: 0, executionIdentityDigest: "a".repeat(64) }],
      deadlineEpochMs,
    });
    admitAttempt(connection, { runId, writerGeneration: generation, attemptId: attemptId as never, attemptLocator: locator, deadlineEpochMs });
    connection.db.prepare("INSERT INTO slots(run_id,slot_id,ordinal,core_payload,core_digest) VALUES (?,?,?,?,?)")
      .run(runId, slotId, 0, core, digest);
    connection.db.prepare(`UPDATE attempts SET core_payload=?,core_digest=?,publication_state='sealing'
      WHERE origin_run_id=? AND attempt_id=?`).run(core, digest, runId, attemptId);
    connection.db.prepare(`INSERT INTO members(target_run_id,slot_id,origin_run_id,attempt_id,action,core_payload,core_digest)
      VALUES (?,?,?,?,'executed',?,?)`).run(runId, slotId, runId, attemptId, core, digest);
    expect(connection.db.prepare("SELECT revision FROM run_publication_clock WHERE singleton=1").get())
      .toMatchObject({ revision: 1n });
    publishOriginAttemptOnConnection(connection, {
      runId,
      writerGeneration: generation,
      slotId,
      attemptId,
      attemptLocator: locator,
      closureBytes: core,
      closureDigest: digest,
      deadlineEpochMs,
    });
    expect(connection.db.prepare("SELECT revision FROM run_publication_clock WHERE singleton=1").get())
      .toMatchObject({ revision: 2n });

    expect(() => admitAttachment(connection, {
      runId,
      writerGeneration: generation,
      attachmentId: "late-attachment",
      ownerKind: "attempt",
      ownerRunId: runId,
      ownerAttemptId: attemptId as never,
      family: "late",
      familyRevision: 1,
      deadlineEpochMs,
    })).toThrow();
    expect(() => admitAttachment(connection, {
      runId,
      writerGeneration: "generation-old",
      attachmentId: "old-generation-attachment",
      ownerKind: "attempt",
      ownerRunId: runId,
      ownerAttemptId: attemptId as never,
      family: "old",
      familyRevision: 1,
      deadlineEpochMs,
    })).toThrow();
    closeRecordDatabase(connection);
  });
});
