// cases: docs/engineering/testing/unit/record.md
// 覆盖类别:
// - 开放 activity key 的往返与未知 key 读取
// - Run / attempt 双时钟域
// - TimingOrigin 的 attempt / run 两支
// - publish / carry 对 timing 引用的忠实保留
// - sandboxBuilds 与 timingNodeId 引用完整性

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  RECORD_SCHEMA_VERSION,
  createWriter,
  openRecord,
  publish,
  type EvalResult,
  type SandboxBuildRecord,
  type TimingActivity,
} from "./index.ts";
import { attemptOrigin, createRunTimingRecorder, createTimingRecorder, runOrigin } from "../runner/timing.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-timing-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function officialTurn(over: Partial<TimingActivity> = {}): TimingActivity {
  return {
    id: "n1",
    key: "agent.turn",
    label: "turn1",
    startOffsetMs: 10,
    durationMs: 100,
    sessionIndex: 1,
    turnIndex: 1,
    ...over,
  };
}

describe("开放 activity key 往返与未知 key 读取", () => {
  it("writer 接受第三方未知 key 原样落盘;openRecord 读回同一棵树,不因 key 不在官方词表而拒绝", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "third-party-harness", version: "1.0.0" } });
    const snap = await writer.run({
      experimentId: "timing/unknown-key",
      agent: "custom",
      startedAt: "2026-07-30T10:00:00.000Z",
    });
    const unknownChild: TimingActivity = {
      id: "u1",
      key: "acme.provider.image.pull",
      label: "pull acme/base:latest",
      startOffsetMs: 5,
      durationMs: 40,
      children: [officialTurn({ id: "n2", startOffsetMs: 12 })],
    };
    await snap.writeAttempt({
      id: "q1",
      attempt: 1,
      verdict: "passed",
      durationMs: 200,
      executionMs: 180,
      assertions: [],
      phases: [
        {
          name: "sandbox.create",
          durationMs: 50,
          children: [unknownChild],
        },
        { name: "eval.run", durationMs: 130 },
      ],
    });
    await snap.finish({
      timings: [
        {
          id: "r1",
          key: "vendor.cache.warm",
          label: "warm vendor cache",
          startOffsetMs: 0,
          durationMs: 25,
        },
      ],
    });

    const record = await openRecord(root);
    expect(record.unreadable).toHaveLength(0);
    const run = record.experiments[0]!.latestRun;
    expect(run.schemaVersion).toBe(RECORD_SCHEMA_VERSION);
    expect(run.timings).toEqual([
      { id: "r1", key: "vendor.cache.warm", label: "warm vendor cache", startOffsetMs: 0, durationMs: 25 },
    ]);
    const attempt = run.attempts[0]!;
    const createPhase = attempt.result.phases?.find((p) => p.name === "sandbox.create");
    expect(createPhase?.children?.[0]).toMatchObject({
      key: "acme.provider.image.pull",
      label: "pull acme/base:latest",
      children: [{ key: "agent.turn", id: "n2" }],
    });
    // 未知 key 不进口径:executionMs 仍是写入值,不因子树变化重算。
    expect(attempt.result.executionMs).toBe(180);
    expect(attempt.result.verdict).toBe("passed");
  });
});

describe("Run / attempt 双时钟域", () => {
  it("两边 activity 同刻写入后读回各自相对本域起点;共享构建只在 Run 域", async () => {
    const root = await makeRoot();
    const runClock = createRunTimingRecorder(() => 1_000);
    const attemptClock = createTimingRecorder(() => 5_000);
    attemptClock.enter("sandbox.create");
    const attemptChild = attemptClock.child({
      key: "provider.image.pull",
      label: "pull",
      startOffsetMs: attemptClock.offsetNow(),
      durationMs: 10,
    });
    attemptClock.closeCurrent();
    const phases = attemptClock.finalize();

    const buildNode = runClock.child({
      key: "sandbox.build",
      label: "build Dockerfile",
      startOffsetMs: runClock.offsetNow(),
      durationMs: 600_000,
    });
    const runTimings = runClock.finalize();

    expect(attemptChild?.startOffsetMs).toBe(0);
    expect(buildNode.startOffsetMs).toBe(0);
    // 两域各自从 0 起算——同刻墙钟不同域不能混加。
    expect(attemptChild?.startOffsetMs).toBe(buildNode.startOffsetMs);

    const writer = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });
    const snap = await writer.run({
      experimentId: "timing/dual-clock",
      agent: "codex",
      startedAt: "2026-07-30T11:00:00.000Z",
    });
    await snap.writeAttempt({
      id: "q1",
      attempt: 1,
      verdict: "passed",
      durationMs: 50,
      executionMs: 40,
      assertions: [],
      phases,
    });
    const builds: SandboxBuildRecord[] = [
      {
        buildKey: "bk-1",
        provider: "docker",
        status: "built",
        timingNodeId: buildNode.id,
        inputs: { dockerfile: "Dockerfile" },
      },
    ];
    await snap.finish({ timings: runTimings, sandboxBuilds: builds });

    const run = (await openRecord(root)).experiments[0]!.latestRun;
    expect(run.timings?.[0]?.key).toBe("sandbox.build");
    expect(run.timings?.[0]?.durationMs).toBe(600_000);
    expect(run.attempts[0]!.result.executionMs).toBe(40);
    expect(run.attempts[0]!.result.phases?.some((p) => p.children?.some((c) => c.key === "sandbox.build"))).toBe(false);
  });
});

describe("TimingOrigin 的 attempt / run 两支", () => {
  it("attempt 支带锚点;run 支指向同一 timing node;缺失 origin 的 Run diagnostic 三态可区分", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });
    const snap = await writer.run({
      experimentId: "timing/origin",
      agent: "codex",
      startedAt: "2026-07-30T12:00:00.000Z",
    });
    const buildId = "n-build-1";
    await snap.writeAttempt({
      id: "dep-a",
      attempt: 1,
      verdict: "errored",
      durationMs: 0,
      assertions: [],
      error: {
        code: "sandbox-build-failed",
        message: "build failed",
        origin: runOrigin(buildId),
      },
    });
    await snap.writeAttempt({
      id: "dep-b",
      attempt: 1,
      verdict: "errored",
      durationMs: 0,
      assertions: [],
      error: {
        code: "sandbox-build-failed",
        message: "build failed",
        origin: runOrigin(buildId),
      },
    });
    await snap.writeAttempt({
      id: "local-fail",
      attempt: 1,
      verdict: "errored",
      durationMs: 5,
      assertions: [],
      error: {
        code: "unexpected-error",
        message: "boom",
        origin: attemptOrigin("eval.run", "n-cmd"),
      },
      diagnostics: [{ code: "teardown-failed", level: "warning", detail: "cleanup hiccup", origin: attemptOrigin("sandbox.cleanup") }],
    });
    await snap.finish({
      timings: [{ id: buildId, key: "sandbox.build", label: "build", startOffsetMs: 0, durationMs: 12, failed: true }],
      diagnostics: [
        { code: "build-failed", level: "error", detail: "shared build failed", origin: runOrigin(buildId) },
        { code: "orphan-note", level: "warning", detail: "no origin on purpose" },
      ],
      sandboxBuilds: [
        {
          buildKey: "bk-fail",
          provider: "docker",
          status: "failed",
          timingNodeId: buildId,
          inputs: { dockerfile: "Dockerfile" },
          error: { code: "build-failed", message: "exit 1" },
        },
      ],
    });

    const run = (await openRecord(root)).experiments[0]!.latestRun;
    const deps = run.attempts.filter((a) => a.evalId.startsWith("dep-"));
    expect(deps).toHaveLength(2);
    expect(deps.every((a) => a.result.error?.origin.scope === "run" && a.result.error.origin.timingNodeId === buildId)).toBe(true);
    const local = run.attempts.find((a) => a.evalId === "local-fail")!;
    expect(local.result.error?.origin).toEqual({ scope: "attempt", phase: "eval.run", timingNodeId: "n-cmd" });
    expect(run.diagnostics).toEqual([
      { code: "build-failed", level: "error", detail: "shared build failed", origin: { scope: "run", timingNodeId: buildId } },
      { code: "orphan-note", level: "warning", detail: "no origin on purpose" },
    ]);
  });
});

describe("publish / carry 对 timing 引用的忠实保留", () => {
  it("publish 恒复制 timings、sandboxBuilds 与 attempt phases;携带条目 phases 原样保留且不继承本 Run timings", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });
    const original = await writer.run({
      experimentId: "timing/publish",
      agent: "codex",
      startedAt: "2026-07-30T13:00:00.000Z",
    });
    const buildId = "n-b";
    await original.writeAttempt({
      id: "q1",
      attempt: 1,
      verdict: "passed",
      durationMs: 30,
      assertions: [],
      phases: [{ name: "eval.run", durationMs: 30, children: [officialTurn()] }],
    });
    await original.finish({
      timings: [{ id: buildId, key: "sandbox.build", label: "build", startOffsetMs: 0, durationMs: 9 }],
      sandboxBuilds: [
        { buildKey: "bk", provider: "docker", status: "hit", timingNodeId: buildId, inputs: { dockerfile: "Dockerfile" } },
      ],
    });

    const source = await openRecord(root);
    const sourceRun = source.experiments[0]!.latestRun;
    const dest = await makeRoot();
    await publish([sourceRun], dest);

    const published = await openRecord(dest);
    const pubRun = published.experiments[0]!.latestRun;
    expect(pubRun.timings).toEqual(sourceRun.timings);
    expect(pubRun.sandboxBuilds).toEqual(sourceRun.sandboxBuilds);
    expect(pubRun.attempts[0]!.result.phases).toEqual(sourceRun.attempts[0]!.result.phases);

    // 携带:新 Run 有自己的 timings;携带条目的 phases 仍是原 attempt 树,不出现本 Run 的 activity key。
    const writer2 = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });
    const next = await writer2.run({
      experimentId: "timing/publish",
      agent: "codex",
      startedAt: "2026-07-30T14:00:00.000Z",
    });
    const snapName = basename(original.dir);
    const expDir = basename(join(original.dir, ".."));
    const prior = sourceRun.attempts[0]!.result;
    await writer2.writeAttemptFor({
      ...prior,
      agent: "codex",
      experimentId: "timing/publish",
      artifactBase: `${expDir}/${snapName}/q1/a1`,
    } as EvalResult);
    await next.finish({
      timings: [{ id: "new-only", key: "agent.artifact.prepare", label: "prepare", startOffsetMs: 0, durationMs: 3 }],
    });

    const after = await openRecord(root);
    const latest = after.experiments.find((e) => e.id === "timing/publish")!.latestRun;
    expect(latest.timings?.[0]?.key).toBe("agent.artifact.prepare");
    const carriedAttempt = latest.attempts.find((a) => a.carried)!;
    expect(carriedAttempt.result.phases?.[0]?.children?.[0]?.key).toBe("agent.turn");
    expect(JSON.stringify(carriedAttempt.result.phases)).not.toContain("agent.artifact.prepare");
  });
});

describe("sandboxBuilds 与 timingNodeId 引用完整性", () => {
  it("四 status 各可往返;timingNodeId 指向同份 timings;本表不复制 duration", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });
    const snap = await writer.run({
      experimentId: "timing/builds",
      agent: "codex",
      startedAt: "2026-07-30T15:00:00.000Z",
    });
    await snap.writeAttempt({ id: "q1", attempt: 1, verdict: "passed", durationMs: 1, assertions: [] });
    const timings: TimingActivity[] = [
      { id: "t-hit", key: "sandbox.build", label: "query hit", startOffsetMs: 0, durationMs: 2 },
      { id: "t-built", key: "sandbox.build", label: "cold build", startOffsetMs: 2, durationMs: 100 },
      { id: "t-failed", key: "sandbox.build", label: "failed build", startOffsetMs: 102, durationMs: 5, failed: true },
      { id: "t-cancelled", key: "sandbox.build", label: "cancelled", startOffsetMs: 107, durationMs: 1, failed: true },
    ];
    const builds: SandboxBuildRecord[] = [
      { buildKey: "k-hit", provider: "docker", status: "hit", timingNodeId: "t-hit", inputs: { tag: "a" }, locator: "sha256:aaa" },
      { buildKey: "k-built", provider: "docker", status: "built", timingNodeId: "t-built", inputs: { tag: "b" }, locator: "sha256:bbb" },
      {
        buildKey: "k-failed",
        provider: "docker",
        status: "failed",
        timingNodeId: "t-failed",
        inputs: { tag: "c" },
        error: { code: "build-failed", message: "exit 1" },
      },
      { buildKey: "k-cancelled", provider: "docker", status: "cancelled", timingNodeId: "t-cancelled", inputs: { tag: "d" } },
    ];
    await snap.finish({ timings, sandboxBuilds: builds });

    const onDisk = JSON.parse(await readFile(join(snap.dir, "run.json"), "utf-8"));
    expect(onDisk.sandboxBuilds.every((b: SandboxBuildRecord) => !("durationMs" in b))).toBe(true);
    const run = (await openRecord(root)).experiments[0]!.latestRun;
    expect(run.sandboxBuilds?.map((b) => b.status)).toEqual(["hit", "built", "failed", "cancelled"]);
    for (const b of run.sandboxBuilds ?? []) {
      expect(run.timings?.some((t) => t.id === b.timingNodeId && t.key === "sandbox.build")).toBe(true);
    }
  });
});

describe("双时钟 recorder", () => {
  it("attempt recorder 把 children 挂到当前锚点;Run recorder 把 activity 挂到根", () => {
    let t = 0;
    const attempt = createTimingRecorder(() => t);
    attempt.enter("eval.run");
    t = 10;
    const turn = attempt.child({
      key: "agent.turn",
      label: "turn1",
      startOffsetMs: attempt.offsetNow(),
      durationMs: 5,
      sessionIndex: 1,
      turnIndex: 1,
    });
    attempt.closeCurrent();
    const phases = attempt.finalize();
    expect(phases?.[0]?.children?.[0]?.id).toBe(turn?.id);
    expect(phases?.[0]?.children?.[0]?.key).toBe("agent.turn");

    t = 0;
    const run = createRunTimingRecorder(() => t);
    t = 3;
    const build = run.child({
      key: "sandbox.build",
      label: "build",
      startOffsetMs: run.offsetNow(),
      durationMs: 7,
    });
    expect(run.finalize()).toEqual([expect.objectContaining({ id: build.id, key: "sandbox.build", startOffsetMs: 3 })]);
  });
});
