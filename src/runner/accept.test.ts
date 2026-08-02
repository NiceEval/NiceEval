// cases: docs/engineering/testing/unit/experiments-runner.md
// `accept` 的资格门与重锚落盘：只复制一条历史终态，不派发 Agent/Sandbox。

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { encodeAttemptLocator } from "../record/locator.ts";
import type { AttemptHandle, Run } from "../record/types.ts";
import { acceptPreparedAttempt, AcceptError } from "./accept.ts";
import type { AgentRun, DiscoveredEval, EvalResult } from "./types.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function makePair(over: Partial<{ sandboxReuse: boolean; timeoutMs: number }> = {}) {
  const run = {
    agent: { name: "current-agent" },
    flags: {},
    attempts: 1,
    earlyExit: false,
    selectedEvalIds: ["e"],
    experimentId: "exp",
    experimentBaseDir: "/project",
    experimentSourcePath: "/project/experiments/exp.ts",
    ...(over.sandboxReuse === undefined ? {} : { sandboxReuse: over.sandboxReuse }),
    ...(over.timeoutMs === undefined ? {} : { timeoutMs: over.timeoutMs }),
  } as unknown as AgentRun;
  const evalDef = {
    id: "e",
    ...(over.timeoutMs === undefined ? {} : { timeoutMs: undefined }),
  } as unknown as DiscoveredEval;
  return {
    key: "exp|e",
    run,
    evalDef,
    plan: {} as never,
    identity: {},
  } as never;
}

function makeSource(root: string, over: Partial<EvalResult> = {}): AttemptHandle {
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
    id: "e",
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
    evalId: "e",
    experimentId: "exp",
    result,
    ref: { run: "exp/old-run", attempt: "e/a0" },
    run,
    locator: encodeAttemptLocator({ runId: "old-run", evalId: "e", attempt: 0 }),
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
  run.evals = [{ id: "e", attempts: [source] }];
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
    currentManifest: { config: {}, source: {}, data: {} },
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

  it("导出可判别的 AcceptError 类型", () => {
    const error = new AcceptError("timeout", "too slow");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("timeout");
  });
});
