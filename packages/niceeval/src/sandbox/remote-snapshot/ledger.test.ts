// cases: docs/engineering/testing/architecture/unit/sandbox.md
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { afterAll, beforeAll, expect, test } from "vitest";
import { userDatabaseHost, type UserDatabase } from "../../user-database/index.ts";
import {
  BEFORE_CACHE_SNAPSHOTS_REPOSITORY,
  SNAPSHOT_LEASE_MS,
  SnapshotRepositoryRequest,
  snapshotLedgerRequest as send,
  type SnapshotLedgerRequest,
} from "./ledger.ts";

const initialExecArgv = [...process.execArgv];
beforeAll(() => {
  process.execArgv.push("--import", "tsx");
});
afterAll(() => {
  process.execArgv.splice(0, process.execArgv.length, ...initialExecArgv);
});
// Keep fixtures concise without sending unrelated fields across the closed worker protocol.
const snapshotLedgerRequest = (database: UserDatabase, input: SnapshotLedgerRequest) =>
  send(
    database,
    Schema.decodeUnknownSync(SnapshotRepositoryRequest)({ repository: BEFORE_CACHE_SNAPSHOTS_REPOSITORY, ...input }),
  );

const withDatabase = async (run: (home: string) => Promise<void>) => {
  const home = await mkdtemp(join(tmpdir(), "niceeval-snapshot-race-"));
  try {
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
};
const reservation = (key = "prefix:one", scope = "position:one") => ({
  provider: "test/snapshot",
  executionDomainId: "domain-a",
  now: 1_000,
  operation: "lookup-reserve" as const,
  beforeCacheKey: key,
  baseIdentity: "immutable-base",
  declarationJson: "{}",
  replacementScope: scope,
  artifactId: randomUUID(),
  token: randomUUID(),
  holdId: randomUUID(),
});

// @feature docs/feature/sandbox/architecture/remote-snapshot-cache.md
test.concurrent("concurrent invocations reserve one writer before any snapshot request", {
  timeout: 30_000,
}, async () => {
  await withDatabase(async (home) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const first = yield* userDatabaseHost.open({ home });
          const second = yield* userDatabaseHost.open({ home });
          const inputs = [reservation(), reservation()];
          const results = yield* Effect.all(
            [snapshotLedgerRequest(first, inputs[0]!), snapshotLedgerRequest(second, inputs[1]!)],
            { concurrency: "unbounded" },
          );
          expect(results.map((r) => r._tag).sort()).toEqual(["Busy", "Reserved"]);
          const winner = results.find((r) => r._tag === "Reserved")!;
          const writer = inputs[results.indexOf(winner)]!;
          const published = yield* snapshotLedgerRequest(first, {
            ...writer,
            operation: "publish",
            snapshotId: "snapshot-only-writer",
            now: 1_001,
          });
          expect(published._tag).toBe("Published");
          // Content hits preserve the first publisher's lineage, including v1 rows.
          const follower = yield* snapshotLedgerRequest(second, {
            ...reservation("prefix:one", "position:other-owner-v2"),
            now: 1_002,
          });
          expect(follower._tag).toBe("Hit");
          if (follower._tag === "Hit") expect(follower.entry.artifact_id).toBe(writer.artifactId);
        }),
      ),
    );
  });
});

// @feature docs/feature/sandbox/architecture/remote-snapshot-cache.md
test.concurrent("a resumed writer cannot renew, publish or abandon a lease taken over by another invocation", {
  timeout: 30_000,
}, async () => {
  await withDatabase(async (home) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* userDatabaseHost.open({ home });
          const original = reservation();
          expect((yield* snapshotLedgerRequest(database, original))._tag).toBe("Reserved");
          const takeover = { ...reservation(), now: original.now + SNAPSHOT_LEASE_MS + 1 };
          const taken = yield* snapshotLedgerRequest(database, takeover);
          expect(taken._tag).toBe("TakenOver");
          if (taken._tag !== "TakenOver") throw new Error("Expected takeover");
          const current = { ...takeover, artifactId: taken.entry.artifact_id };
          expect(
            (yield* snapshotLedgerRequest(database, {
              ...current,
              operation: "publish",
              snapshotId: "recovered-snapshot",
            }))._tag,
          ).toBe("Published");
          for (const operation of ["renew", "uncertain"] as const) {
            expect(
              (yield* snapshotLedgerRequest(database, { ...original, operation, now: takeover.now + 1 }))._tag,
            ).toBe("LeaseLost");
          }
          expect(
            (yield* snapshotLedgerRequest(database, {
              ...original,
              operation: "publish",
              snapshotId: "stale-snapshot",
              now: takeover.now + 1,
            }))._tag,
          ).toBe("LeaseLost");
          const hit = yield* snapshotLedgerRequest(database, { ...reservation(), now: takeover.now + 2 });
          expect(hit._tag).toBe("Hit");
          if (hit._tag === "Hit") expect(hit.entry.snapshot_id).toBe("recovered-snapshot");
        }),
      ),
    );
  });
});

// @feature docs/feature/sandbox/architecture/remote-snapshot-cache.md
test.concurrent("Run handoff protects a retired artifact until the consumer is confirmed deleted", {
  timeout: 30_000,
}, async () => {
  await withDatabase(async (home) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* userDatabaseHost.open({ home });
          const old = reservation();
          yield* snapshotLedgerRequest(database, old);
          yield* snapshotLedgerRequest(database, { ...old, operation: "publish", snapshotId: "old-snapshot" });
          const replacement = { ...reservation("prefix:changed"), now: 1_001 };
          yield* snapshotLedgerRequest(database, replacement);
          yield* snapshotLedgerRequest(database, { ...replacement, operation: "publish", snapshotId: "new-snapshot" });
          const claim = { ...old, operation: "claim-delete" as const, token: "deletion", now: 1_002 };
          expect((yield* snapshotLedgerRequest(database, claim))._tag).toBe("Empty");
          const sandboxHoldId = randomUUID();
          const handed = yield* snapshotLedgerRequest(database, {
            ...old,
            operation: "handoff",
            holdId: sandboxHoldId,
            runHoldId: old.holdId,
            releaseRunHold: true,
            now: 1_003,
          });
          expect(handed._tag).toBe("Updated");
          expect((yield* snapshotLedgerRequest(database, { ...claim, now: 1_004 + SNAPSHOT_LEASE_MS * 10 }))._tag).toBe(
            "Empty",
          );
          yield* snapshotLedgerRequest(database, {
            ...old,
            operation: "release-sandbox",
            holdId: sandboxHoldId,
            now: 1_005 + SNAPSHOT_LEASE_MS * 10,
          });
          const claimed = yield* snapshotLedgerRequest(database, { ...claim, now: 1_006 + SNAPSHOT_LEASE_MS * 10 });
          expect(claimed._tag).toBe("Claimed");
          if (claimed._tag !== "Claimed") throw new Error("Expected deletion claim");
          expect(claimed.entry.snapshot_id).toBe("old-snapshot");
          // A different domain cannot settle this deletion or obtain this artifact.
          expect(
            (yield* snapshotLedgerRequest(database, {
              ...claim,
              operation: "settle-delete",
              executionDomainId: "domain-b",
              artifactId: old.artifactId,
              deleted: true,
            }))._tag,
          ).toBe("LeaseLost");
          yield* snapshotLedgerRequest(database, {
            ...claim,
            operation: "settle-delete",
            artifactId: old.artifactId,
            deleted: true,
          });
          // A tombstone remains a generation fence for late publications.
          const next = yield* snapshotLedgerRequest(database, { ...reservation("prefix:third"), now: 2_000_000 });
          expect(next._tag).toBe("Reserved");
          if (next._tag === "Reserved") expect(next.entry.generation).toBe(3);
        }),
      ),
    );
  });
});
