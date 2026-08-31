// cases: docs/engineering/testing/unit/experiments-runner.md
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { listSessions, SessionTracker, showSession } from "./session.ts";
import { ProjectStateDatabase, ProjectStateDatabaseLive } from "../record/sqlite/project-state-database.ts";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("SQLite invocation session projection", () => {
  it("keeps active and terminal CLI documents in the canonical database", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-session-sqlite-"));
    roots.push(root);
    const niceevalRoot = join(root, ".niceeval");
    const shown = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* ProjectStateDatabase;
      const tracker = new SessionTracker(niceevalRoot, database, "s_projection");
      yield* tracker.start({
        runIds: new Map(),
        agentRuns: [],
        invocationRuns: [],
        startedAt: "2026-01-01T00:00:00.000Z",
      });
      expect((yield* listSessions(niceevalRoot)).sessions[0]?.status).toBe("active");
      yield* tracker.close({ status: "complete", completedAt: "2026-01-01T00:01:00.000Z" });
      return yield* showSession(niceevalRoot, "s_projection");
    })).pipe(Effect.provide(ProjectStateDatabaseLive)));
    expect(shown.session).toMatchObject({ sessionId: "s_projection", status: "completed" });
  });
});
