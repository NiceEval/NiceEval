// cases: docs/engineering/testing/unit/record.md
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeRecordDatabase, finalizeInvocationPortable, openRecordReader, openRecordWriter } from "../../record/sqlite/database.ts";
import {
  acquireCaseLockOnConnection,
  beginInvocationRecoveryOnConnection,
  closeInvocationOnConnection,
  createInvocationOnConnection,
  heartbeatCaseLockOnConnection,
  readCaseLockProjectionOnConnection,
  readCaseLockOnConnection,
  readInvocationOnConnection,
  takeoverDeadCaseLockOnConnection,
  updateInvocationActiveProjectionOnConnection,
  type ProcessOwnerIdentity,
} from "./sqlite-coordination.ts";

const roots: string[] = [];
const deadline = () => Date.now() + 5_000;
const owner = (ownerId: string, pid: number): ProcessOwnerIdentity => ({
  ownerId, host: "host-a", pid, bootId: "boot-a", processStart: `start-${pid}`,
});

async function project(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-coordination-"));
  roots.push(root);
  return { root, path: join(root, ".niceeval", "record.sqlite") };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("canonical SQLite coordination", () => {
  it("fences stale case owners and never takes over from heartbeat age", async () => {
    const { path } = await project();
    const db = openRecordWriter(path);
    const first = acquireCaseLockOnConnection(db, "case-a", owner("worker-a", 11), "2026-01-01T00:00:00Z", deadline());
    expect(() => acquireCaseLockOnConnection(db, "case-a", owner("worker-b", 12), "2030-01-01T00:00:00Z", deadline())).toThrow(/already owned/u);
    expect(() => takeoverDeadCaseLockOnConnection(db, "case-a", { ...first, processStart: "wrong" }, owner("worker-b", 12), "2030-01-01T00:00:00Z", deadline())).toThrow(/exact dead/u);
    const second = takeoverDeadCaseLockOnConnection(db, "case-a", first, owner("worker-b", 12), "2030-01-01T00:00:00Z", deadline());
    expect(second.generation).toBe(2);
    expect(() => heartbeatCaseLockOnConnection(db, "case-a", first, "2031-01-01T00:00:00Z", deadline())).toThrow(/fenced/u);
    expect(readCaseLockOnConnection(db, "case-a")).toEqual(second);
    expect(readCaseLockProjectionOnConnection(db, "case-a")).toEqual({
      owner: second,
      acquiredAt: "2030-01-01T00:00:00Z",
      heartbeatAt: "2030-01-01T00:00:00Z",
    });
    closeRecordDatabase(db);
  });

  it("atomically creates invocation Runs and retains terminal projection through portable reopen", async () => {
    const { path } = await project();
    const db = openRecordWriter(path);
    const session = createInvocationOnConnection(db, {
      invocationId: "inv-a", owner: owner("worker-a", 11), startedAt: "2026-01-01T00:00:00Z",
      runs: [],
      deadlineEpochMs: deadline(),
    });
    updateInvocationActiveProjectionOnConnection(
      db, "inv-a", session.owner, "2026-01-01T00:00:30Z", new TextEncoder().encode("active"), deadline(),
    );
    expect(new TextDecoder().decode(readInvocationOnConnection(db, "inv-a")?.activeProjection)).toBe("active");
    closeInvocationOnConnection(db, "inv-a", session.owner, "completed", "2026-01-01T00:01:00Z", new TextEncoder().encode("portable-terminal"), deadline());
    expect(readInvocationOnConnection(db, "inv-a")?.activeProjection).toBeUndefined();
    closeRecordDatabase(db);
    expect(finalizeInvocationPortable(path)).toBe(true);
    const reader = openRecordReader(path);
    expect(new TextDecoder().decode(readInvocationOnConnection(reader, "inv-a")?.terminalProjection)).toBe("portable-terminal");
    closeRecordDatabase(reader);
  });

  it("uses exact owner CAS for active to recovering to interrupted", async () => {
    const { path } = await project();
    const db = openRecordWriter(path);
    const active = createInvocationOnConnection(db, { invocationId: "inv-r", owner: owner("dead", 21), startedAt: "2026-01-01T00:00:00Z", runs: [], deadlineEpochMs: deadline() });
    expect(() => beginInvocationRecoveryOnConnection(db, "inv-r", { ...active.owner, bootId: "wrong" }, owner("recovery", 22), "2026-01-02T00:00:00Z", deadline())).toThrow(/exact dead/u);
    const recovery = beginInvocationRecoveryOnConnection(db, "inv-r", active.owner, owner("recovery", 22), "2026-01-02T00:00:00Z", deadline());
    closeInvocationOnConnection(db, "inv-r", recovery, "interrupted", "2026-01-02T00:01:00Z", new Uint8Array([1]), deadline());
    expect(readInvocationOnConnection(db, "inv-r")?.state).toBe("interrupted");
    closeRecordDatabase(db);
  });

  it.each(["locks", "sessions"])("fails closed on legacy %s entries but ignores an empty directory", async (legacyName) => {
    const { root, path } = await project();
    await mkdir(join(root, ".niceeval", legacyName), { recursive: true });
    expect(() => closeRecordDatabase(openRecordWriter(path))).not.toThrow();
    await writeFile(join(root, ".niceeval", legacyName, "entry"), "legacy");
    expect(() => openRecordWriter(path)).toThrow(new RegExp(`legacy ${legacyName}`, "u"));
  });
});
