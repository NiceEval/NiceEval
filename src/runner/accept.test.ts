// cases: docs/engineering/testing/unit/experiments-runner.md
// `accept` 的资格门与重锚落盘：只复制一条历史终态，不派发 Agent/Sandbox。

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { encodeAttemptLocator } from "../record/locator.ts";
import type { AttemptHandle, Run } from "../record/types.ts";
import {
  acceptPreparedAttempt,
  AcceptError,
  prepareAcceptedAttempt,
  writeAcceptedAttempts,
} from "./accept.ts";
import type { AgentRun, DiscoveredEval, EvalResult } from "./types.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function makePair(
  over: Partial<{ sandboxReuse: boolean; timeoutMs: number; plan: unknown }> = {},
  evalId = "e",
) {
  const run = {
    agent: { name: "current-agent" },
    flags: {},
    attempts: 1,
    earlyExit: false,
    selectedEvalIds: [evalId],
    experimentId: "exp",
    experimentBaseDir: "/project",
    experimentSourcePath: "/project/experiments/exp.ts",
    ...(over.sandboxReuse === undefined ? {} : { sandboxReuse: over.sandboxReuse }),
    ...(over.timeoutMs === undefined ? {} : { timeoutMs: over.timeoutMs }),
  } as unknown as AgentRun;
  const evalDef = {
    id: evalId,
    ...(over.timeoutMs === undefined ? {} : { timeoutMs: undefined }),
  } as unknown as DiscoveredEval;
  return {
    key: "exp|e",
    run,
    evalDef,
    plan: over.plan ?? ({} as never),
    identity: {},
  } as never;
}

function makeSource(root: string, over: Partial<EvalResult> = {}): AttemptHandle {
  const evalId = over.id ?? "e";
  const run = {
    runId: "old-run",
    experimentId: "exp",
    startedAt: "2026-01-01T00:00:00.000Z",
    agent: "old-agent",
    producer: { name: "niceeval" },
    schemaVersion: 14,
    evals: [],
    attempts: [],
    dir: root,
  } as unknown as Run;
  const result = {
    id: evalId,
    experimentId: "exp",
    agent: "old-agent",
    verdict: "passed",
    fingerprint: "old-fingerprint",
    configHash: "old-config",
    attempt: 0,
    durationMs: 10,
    executionMs: 10,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
    ...over,
  } as EvalResult;
  const source: AttemptHandle = {
    evalId,
    experimentId: "exp",
    result,
    ref: { run: "exp/old-run", attempt: "e/a0" },
    run,
    locator: encodeAttemptLocator({ runId: "old-run", evalId, attempt: result.attempt }),
    carried: false,
    evidenceState: "local",
    commands: async () => null,
    events: async () => null,
    trace: async () => null,
    o11y: async () => null,
    agentSetup: async () => null,
    diff: async () => null,
    sources: async () => null,
  };
  run.evals = [{ id: evalId, attempts: [source] }];
  run.attempts = [source];
  return source;
}

async function accept(source: AttemptHandle, pair = makePair(), configTimeoutMs?: number) {
  const root = await mkdtemp(join(tmpdir(), "niceeval-accept-unit-"));
  roots.push(root);
  return acceptPreparedAttempt({
    recordRoot: root,
    source,
    pair,
    currentFingerprint: "new-fingerprint",
    currentManifest: { algorithmVersion: 2, coverageVersion: 1, config: {}, source: {}, data: {} },
    currentConfigHash: "new-config",
    ...(configTimeoutMs === undefined ? {} : { configTimeoutMs }),
    now: () => "2026-01-02T00:00:00.000Z",
  });
}

describe("acceptPreparedAttempt", () => {
  it("为一条终态结果创建新 locator 并保留原证据引用与 acceptedFrom", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-source-"));
    roots.push(root);
    const source = makeSource(root);
    const accepted = await accept(source);

    expect(accepted.locator).not.toBe(accepted.sourceLocator);
    expect(accepted.attempt.result.locator).toBe(accepted.locator);
    expect(accepted.attempt.result.artifactBase).toBe("exp/old-run/e/a0");
    expect(accepted.attempt.result.acceptedFrom).toEqual({
      locator: accepted.sourceLocator,
      fingerprint: "old-fingerprint",
      acceptedFingerprint: "new-fingerprint",
      differences: [{ selector: "opaque:no-manifest" }],
    });
    expect(accepted.run.completedAt).toBeDefined();
  });

  it.each([
    ["errored", { verdict: "errored" }, "not-terminal"],
    ["kept sandbox", { sandbox: { provider: "docker", sandboxId: "s", kept: true } }, "sandbox-kept"],
  ] as const)("拒绝 %s 结果", async (_label, result, code) => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-gate-"));
    roots.push(root);
    await expect(accept(makeSource(root, result))).rejects.toMatchObject({ name: "AcceptError", code });
  });

  it("接受复用 Sandbox 的结果与目标 Experiment，并拒绝缺失 attempt 序号与超时结果", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-gate-"));
    roots.push(root);
    await expect(accept(
      makeSource(root, { sandbox: { provider: "docker", sandboxId: "s", reused: true } }),
      makePair({ sandboxReuse: true }),
    )).resolves.toMatchObject({ attempt: { result: { verdict: "passed" } } });
    await expect(accept(makeSource(root, { attempt: 1 }))).rejects.toMatchObject({
      name: "AcceptError",
      code: "missing-attempt",
    });
    await expect(accept(makeSource(root, { executionMs: 20 }), makePair(), 10)).rejects.toMatchObject({
      name: "AcceptError",
      code: "timeout",
    });
  });

  it("缺失历史 fingerprint 时拒绝重锚", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-gate-"));
    roots.push(root);
    await expect(accept(makeSource(root, { fingerprint: undefined }))).rejects.toMatchObject({
      name: "AcceptError",
      code: "fingerprint-missing",
    });
  });

  it("多条 prepared attempt 成功时只写一个 snapshot且逐条保留 acceptedFrom", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-batch-success-"));
    roots.push(root);
    const currentManifest = { algorithmVersion: 2, coverageVersion: 1, config: {}, source: {}, data: {} };
    const sources = [makeSource(root, { id: "e" }), makeSource(root, { id: "f" })];
    const prepared = await Promise.all(sources.map((source) => prepareAcceptedAttempt({
      recordRoot: root,
      source,
      pair: makePair({}, source.evalId),
      currentFingerprint: `current-${source.evalId}`,
      currentManifest,
      currentConfigHash: `config-${source.evalId}`,
      knownEvalIds: ["e", "f"],
      now: () => "2026-01-02T00:00:00.000Z",
    })));

    const accepted = await writeAcceptedAttempts(prepared);

    expect(accepted).toHaveLength(2);
    expect(new Set(accepted.map((entry) => entry.run.runId)).size).toBe(1);
    expect(accepted.map((entry) => entry.attempt.evalId)).toEqual(["e", "f"]);
    expect(accepted.map((entry) => entry.attempt.result.acceptedFrom?.locator)).toEqual(
      accepted.map((entry) => entry.sourceLocator),
    );
    expect(accepted[0]!.record.experiments[0]!.runs).toHaveLength(1);
  });

  it("批量 prepare 中任一条失败时不创建 snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-batch-preflight-"));
    roots.push(root);
    const currentManifest = { algorithmVersion: 2, coverageVersion: 1, config: {}, source: {}, data: {} };
    const valid = makeSource(root, { id: "e" });
    const invalid = makeSource(root, { id: "f", verdict: "errored" });

    await expect(Promise.all([
      prepareAcceptedAttempt({
        recordRoot: root,
        source: valid,
        pair: makePair({}, "e"),
        currentFingerprint: "current-e",
        currentManifest,
        currentConfigHash: "config-e",
      }),
      prepareAcceptedAttempt({
        recordRoot: root,
        source: invalid,
        pair: makePair({}, "f"),
        currentFingerprint: "current-f",
        currentManifest,
        currentConfigHash: "config-f",
      }),
    ])).rejects.toMatchObject({ name: "AcceptError", code: "not-terminal" });
    expect(await readdir(root)).toEqual([]);
  });

  it("批量来源不能重锚到同一个当前 attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-batch-target-duplicate-"));
    roots.push(root);
    const currentManifest = { algorithmVersion: 2, coverageVersion: 1, config: {}, source: {}, data: {} };
    const prepared = await Promise.all([makeSource(root), makeSource(root)].map((source) => prepareAcceptedAttempt({
      recordRoot: root,
      source,
      pair: makePair(),
      currentFingerprint: "current",
      currentManifest,
      currentConfigHash: "config",
    })));

    await expect(writeAcceptedAttempts(prepared)).rejects.toMatchObject({
      name: "AcceptError",
      code: "batch-mismatch",
    });
    expect(await readdir(root)).toEqual([]);
  });

  it("accept 资格门优先于其它路径,既有错误不被吞掉且仍不写 snapshot", async () => {
    const cases: readonly {
      label: string;
      result: Partial<EvalResult>;
      timeoutMs?: number;
      code: "not-terminal" | "sandbox-kept" | "missing-attempt" | "timeout";
    }[] = [
      { label: "errored", result: { verdict: "errored" }, code: "not-terminal" },
      { label: "kept sandbox", result: { sandbox: { provider: "docker", sandboxId: "s", kept: true } }, code: "sandbox-kept" },
      { label: "missing attempt", result: { attempt: 1 }, code: "missing-attempt" },
      { label: "timeout", result: { executionMs: 20 }, timeoutMs: 10, code: "timeout" },
    ];

    for (const testCase of cases) {
      const root = await mkdtemp(join(tmpdir(), `niceeval-accept-gate-priority-${testCase.label.replaceAll(" ", "-")}-`));
      roots.push(root);
      await expect(accept(
        makeSource(root, testCase.result),
        makePair(),
        testCase.timeoutMs,
      )).rejects.toMatchObject({ name: "AcceptError", code: testCase.code });
      expect(await readdir(root)).toEqual([]);
    }
  });

  it("导出可判别的 AcceptError 类型", () => {
    const error = new AcceptError("timeout", "too slow");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("timeout");
  });
});
