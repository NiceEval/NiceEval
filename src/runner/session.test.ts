// cases: docs/engineering/testing/unit/experiments-runner.md
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SESSION_STALE_MS,
  SessionTracker,
  isSessionStale,
  listSessions,
  sessionListDocument,
  showSession,
} from "./session.ts";
import type { AgentRun } from "./types.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-session-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    agent: { name: "fake" } as AgentRun["agent"],
    model: "fake-model",
    flags: {},
    attempts: 2,
    earlyExit: false,
    sandbox: undefined,
    selectedEvalIds: ["eval/a"],
    experimentId: "compare/fake",
    ...overrides,
  } as AgentRun;
}

describe("SessionTracker", () => {
  it("创建原子记录、按反馈更新计数并在完成时封口", async () => {
    const root = await makeRoot();
    const tracker = new SessionTracker(join(root, ".niceeval"), "s_test");
    await tracker.start({
      runIds: new Map([["compare/fake", "run-test"]]),
      agentRuns: [run()],
      carriedAttemptsByKey: new Map([["compare/fake|eval/a", new Set([0])]]),
      startedAt: "2026-08-02T00:00:00.000Z",
      pid: 123,
    });

    const path = join(root, ".niceeval", "sessions", "s_test.json");
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      sessionId: "s_test",
      status: "active",
      experiments: [{ experimentId: "compare/fake", runId: "run-test", queued: 1, running: 0 }],
    });

    tracker.onFeedback({
      type: "attempt:start",
      at: Date.now(),
      identity: { experimentId: "compare/fake", evalId: "eval/a", attempt: 1 },
      who: "fake",
      phase: "eval.run",
    });
    await tracker.heartbeat();
    expect(tracker.current?.experiments[0]).toMatchObject({ running: 1, queued: 0, state: "running" });

    await tracker.close({ status: "complete", paths: new Map([["compare/fake", ".niceeval/compare/fake/run"]]) });
    const closed = await showSession(join(root, ".niceeval"), "s_test");
    expect(closed.session).toMatchObject({ status: "completed", experiments: [{ path: ".niceeval/compare/fake/run" }] });
    expect(closed.session).not.toHaveProperty("heartbeatAt");
  });

  it("默认只返回活动 Session，--all 保留完成项并将过期心跳放入 stale", async () => {
    const root = await makeRoot();
    const niceevalRoot = join(root, ".niceeval");
    const stale = new SessionTracker(niceevalRoot, "s_stale");
    await stale.start({
      runIds: new Map([["compare/a", "run-a"]]),
      agentRuns: [run({ experimentId: "compare/a" })],
      startedAt: "2026-08-02T00:00:00.000Z",
      pid: 456,
    });
    await stale.close({ status: "complete" });

    const active = new SessionTracker(niceevalRoot, "s_active");
    await active.start({
      runIds: new Map([["compare/b", "run-b"]]),
      agentRuns: [run({ experimentId: "compare/b" })],
      startedAt: new Date(Date.now() - SESSION_STALE_MS - 1).toISOString(),
      pid: 789,
    });
    await active.heartbeat();
    // 通过纯函数验证 stale 边界；实际文件的 heartbeat 是当前时刻，避免篡改记录的测试依赖。
    expect(isSessionStale({ ...active.current!, heartbeatAt: new Date(0).toISOString() }, SESSION_STALE_MS + 1)).toBe(true);
    const records = await listSessions(niceevalRoot, { all: true });
    expect(records.sessions.map((session) => session.sessionId)).toEqual(["s_stale", "s_active"]);
    expect(records.stale).toHaveLength(0);
    const projected = sessionListDocument([
      { ...active.current!, heartbeatAt: new Date(0).toISOString() },
      ...await (async () => {
        const current = active.current!;
        return [{ ...current, status: "completed" as const, heartbeatAt: undefined }];
      })(),
    ], { all: true, nowMs: SESSION_STALE_MS + 1 });
    expect(projected.stale).toHaveLength(1);
    await active.close({ status: "incomplete" });
  });
});
