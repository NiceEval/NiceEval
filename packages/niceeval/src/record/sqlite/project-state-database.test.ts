// owner: docs/engineering/testing/unit/record.md
// cases: docs/engineering/testing/unit/record.md

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectStateDatabase, ProjectStateDatabaseLive } from "./project-state-database.ts";
import { currentProcessOwnerIdentity } from "../../runner/node-process-identity.ts";
import {
  closeRecordDatabase,
  openRecordReader,
  openRecordWriter,
  recordSqlitePath,
} from "./database.ts";
import { NodeRecordLive } from "../platform/node.ts";
import { makeRecordRoot } from "../platform/root.ts";
import { RecordCoordination } from "../../coordination/record-leases.ts";

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "niceeval-project-state-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("ProjectStateDatabase scoped composition", () => {
  it("shares one worker-backed instance across frozen facets", async () => {
    const portableRoot = await root();
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* ProjectStateDatabase;
      const first = yield* database.bind(portableRoot);
      const second = yield* database.bind(portableRoot);
      yield* Effect.promise(() => first.teardown.put({
        _tag: "teardown-put",
        id: "one",
        experimentId: "experiment",
        ownerPid: 42,
        ownerHost: "host",
        payload: new TextEncoder().encode("payload"),
      }));
      return {
        sameRecordFacet: first.record === second.record,
        frozen: Object.isFrozen(first) && Object.isFrozen(first.teardown) && Object.isFrozen(first.keep),
        row: yield* Effect.promise(() => second.teardown.get("one")),
      };
    })).pipe(Effect.provide(ProjectStateDatabaseLive)));

    expect(result.sameRecordFacet).toBe(true);
    expect(result.frozen).toBe(true);
    expect(result.row?.generation).toBe(1);
  });

  it("fails closed instead of rebinding one composition to another root", async () => {
    const firstRoot = await root();
    const secondRoot = await root();
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
      const database = yield* ProjectStateDatabase;
      yield* database.bind(firstRoot);
      yield* database.bind(secondRoot);
    })).pipe(Effect.provide(ProjectStateDatabaseLive)));
    expect(exit._tag).toBe("Failure");
  });

  it("serializes FIFO admission and fences writer and barrier identities", async () => {
    const portableRoot = await root();
    const identity = currentProcessOwnerIdentity();
    const owner = {
      host: identity.host,
      pid: identity.pid,
      bootId: identity.bootId,
      processStart: identity.processStart,
    } as const;
    const deadline = Date.now() + 5_000;
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* ProjectStateDatabase;
      const facets = yield* database.bind(portableRoot);
      const first = yield* Effect.promise(() => facets.admission.execute<{ state: "queued"; sequence: number }>({
        operation: "enqueue", ...owner, ticketId: "first", deadline, enqueuedAt: Date.now(),
      }));
      const second = yield* Effect.promise(() => facets.admission.execute<{ state: "queued"; sequence: number }>({
        operation: "enqueue", ...owner, ticketId: "second", deadline, enqueuedAt: Date.now(),
      }));
      const secondBeforeFirst = yield* Effect.promise(() => facets.admission.execute<boolean>({
        operation: "try-admit", ...owner, ticketId: "second", sequence: second.sequence, deadline, now: Date.now(),
      }));
      const firstAdmitted = yield* Effect.promise(() => facets.admission.execute<boolean>({
        operation: "try-admit", ...owner, ticketId: "first", sequence: first.sequence, deadline, now: Date.now(),
      }));
      yield* Effect.promise(() => facets.admission.execute({
        operation: "release-writer", ...owner, ticketId: "first", sequence: first.sequence, deadline, now: Date.now(),
      }));
      const secondAdmitted = yield* Effect.promise(() => facets.admission.execute<boolean>({
        operation: "try-admit", ...owner, ticketId: "second", sequence: second.sequence, deadline, now: Date.now(),
      }));
      yield* Effect.promise(() => facets.admission.execute({
        operation: "release-writer", ...owner, ticketId: "second", sequence: second.sequence, deadline, now: Date.now(),
      }));
      const barrierOwner = { ...owner, barrierId: "barrier", nonce: "barrier-nonce", deadline } as const;
      const requested = yield* Effect.promise(() => facets.admission.execute<boolean>({
        operation: "request-barrier", ...barrierOwner, requestedAt: Date.now(),
      }));
      const blocked = yield* Effect.promise(() => facets.admission.execute<{ state: string }>({
        operation: "enqueue", ...owner, ticketId: "blocked", deadline, enqueuedAt: Date.now(),
      }));
      const activated = yield* Effect.promise(() => facets.admission.execute<boolean>({
        operation: "try-activate-barrier", ...barrierOwner, now: Date.now(),
      }));
      yield* Effect.promise(() => facets.admission.execute({
        operation: "cancel-barrier", ...barrierOwner, now: Date.now(),
      }));
      return { first, second, secondBeforeFirst, firstAdmitted, secondAdmitted, requested, blocked, activated };
    })).pipe(Effect.provide(ProjectStateDatabaseLive)));

    expect(result.first.sequence).toBeLessThan(result.second.sequence);
    expect(result.secondBeforeFirst).toBe(false);
    expect(result.firstAdmitted).toBe(true);
    expect(result.secondAdmitted).toBe(true);
    expect(result.requested).toBe(true);
    expect(result.blocked.state).toBe("blocked-by-barrier");
    expect(result.activated).toBe(true);
  });

  it("stops all facets when the Invocation owner closes the operational worker", async () => {
    const portableRoot = await root();
    const rejected = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* ProjectStateDatabase;
      const facets = yield* database.bind(portableRoot);
      yield* database.closeOperational(portableRoot);
      return yield* Effect.promise(() => facets.teardown.list().then(
        () => false,
        () => true,
      ));
    })).pipe(Effect.provide(ProjectStateDatabaseLive)));
    expect(rejected).toBe(true);
  });

  it("does not use an expired deadline to take over a remote unknown owner", async () => {
    const portableRoot = await root();
    const identity = currentProcessOwnerIdentity();
    const local = { host: identity.host, pid: identity.pid, bootId: identity.bootId, processStart: identity.processStart } as const;
    const remote = { host: "remote.example", pid: 44, bootId: "remote-boot", processStart: "91" } as const;
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* ProjectStateDatabase;
      const facets = yield* database.bind(portableRoot);
      const old = yield* Effect.promise(() => facets.admission.execute<{ state: "queued"; sequence: number }>({
        operation: "enqueue", ...remote, ticketId: "remote", deadline: Date.now() + 50, enqueuedAt: Date.now(),
      }));
      yield* Effect.sleep("60 millis");
      const currentDeadline = Date.now() + 5_000;
      const current = yield* Effect.promise(() => facets.admission.execute<{ state: "queued"; sequence: number }>({
        operation: "enqueue", ...local, ticketId: "local", deadline: currentDeadline, enqueuedAt: Date.now(),
      }));
      const admitted = yield* Effect.promise(() => facets.admission.execute<boolean>({
        operation: "try-admit", ...local, ticketId: "local", sequence: current.sequence, deadline: currentDeadline, now: Date.now(),
      }));
      yield* Effect.promise(() => facets.admission.execute({
        operation: "cancel-writer", ...remote, ticketId: "remote", deadline: Date.now() + 5_000, now: Date.now(),
      }));
      return { old, current, admitted };
    })).pipe(Effect.provide(ProjectStateDatabaseLive)));
    expect(result.old.sequence).toBeLessThan(result.current.sequence);
    expect(result.admitted).toBe(false);
  });

  it("applies the absolute deadline when an admission command reaches the worker queue", async () => {
    const portableRoot = await root();
    const identity = currentProcessOwnerIdentity();
    const failed = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* ProjectStateDatabase;
      const facets = yield* database.bind(portableRoot);
      return yield* Effect.promise(() => facets.admission.execute({
        operation: "enqueue",
        host: identity.host,
        pid: identity.pid,
        bootId: identity.bootId,
        processStart: identity.processStart,
        ticketId: "expired",
        deadline: Date.now() - 1,
        enqueuedAt: Date.now(),
      }).then(() => false, () => true));
    })).pipe(Effect.provide(ProjectStateDatabaseLive)));
    expect(failed).toBe(true);
  });

  it("keeps generic close operational and gates portable only after explicit Invocation shutdown", async () => {
    const portableRoot = await root();
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* ProjectStateDatabase;
      yield* database.bind(portableRoot);
    })).pipe(Effect.provide(ProjectStateDatabaseLive)));

    const path = recordSqlitePath(portableRoot);
    const operational = openRecordWriter(path);
    const before = operational.db.prepare("SELECT barrier_state FROM record_metadata WHERE singleton=1").get() as { barrier_state: string };
    closeRecordDatabase(operational);
    expect(before.barrier_state).toBe("open");

    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* ProjectStateDatabase;
      yield* database.bind(portableRoot);
      yield* database.closeInvocationPortable(portableRoot);
      // Repeated owner cleanup is idempotent and cannot run a second gate.
      yield* database.closeInvocationPortable(portableRoot);
    })).pipe(Effect.provide(ProjectStateDatabaseLive)));
    const hostile = openRecordReader(path);
    const after = hostile.db.prepare("SELECT barrier_state FROM record_metadata WHERE singleton=1").get() as { barrier_state: string };
    closeRecordDatabase(hostile);
    expect(after.barrier_state).toBe("portable");
  });

  it("shares the bootstrap worker between coordination admission and registry facets", async () => {
    const portableRoot = await root();
    const recordRoot = Result.getOrThrow(makeRecordRoot(portableRoot));
    const row = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* ProjectStateDatabase;
      const coordination = yield* RecordCoordination;
      const facets = yield* database.bind(portableRoot);
      yield* coordination.enterRecordWriteBatch({ root: recordRoot, deadlineEpochMs: Date.now() + 5_000 });
      yield* Effect.promise(() => facets.teardown.put({
        _tag: "teardown-put",
        id: "cross-facet",
        experimentId: "experiment",
        ownerPid: process.pid,
        ownerHost: "host",
        payload: new Uint8Array([1]),
      }));
      return yield* Effect.promise(() => facets.teardown.get("cross-facet"));
    })).pipe(Effect.provide(NodeRecordLive)));
    expect(row?.generation).toBe(1);
  });
});
