// cases: docs/engineering/testing/unit/experiments-runner.md
// `accept` 的资格门与重锚落盘：只复制一条历史终态，不派发 Agent/Sandbox。

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { defineAgent, defineEval, defineExperiment } from "../define.ts";
import { encodeAttemptLocator } from "../record/locator.ts";
import { MANIFESTS_FILE } from "../record/manifest.ts";
import type { AttemptHandle, Run } from "../record/types.ts";
import { createWriter } from "../record/writer.ts";
import {
  acceptLocators,
  acceptPreparedAttempt,
  AcceptError,
  prepareAcceptedAttempt,
  prepareAcceptLocator,
  writeAcceptedAttempts,
} from "./accept.ts";
import { planCarry as planCarryEffect } from "./fingerprint.ts";
import { discoverEval, discoverExperiment } from "./types.ts";
import type { AgentRun, DiscoveredEval, EvalResult } from "./types.ts";
import type { CapturedEvalSource } from "./eval-source.ts";

function planCarry(...args: Parameters<typeof planCarryEffect>) {
  return Effect.runPromise(planCarryEffect(...args));
}

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function makePair(
  over: Partial<{ sandboxReuse: boolean; timeoutMs: number; plan: unknown; experimentId: string; agentName: string }> = {},
  evalId = "e",
) {
  const experimentId = over.experimentId ?? "exp";
  const run = {
    agent: { name: over.agentName ?? "current-agent" },
    flags: {},
    attempts: 1,
    earlyExit: false,
    selectedEvalIds: [evalId],
    experimentId,
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
    key: `${experimentId}|${evalId}`,
    run,
    evalDef,
    plan: over.plan ?? ({} as never),
    identity: {},
  } as never;
}

function makeSource(root: string, over: Partial<EvalResult> = {}, experimentId = "exp"): AttemptHandle {
  const evalId = over.id ?? "e";
  const run = {
    runId: "old-run",
    experimentId,
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
    experimentId,
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
    experimentId,
    result,
    ref: { run: `${experimentId}/old-run`, attempt: "e/a0" },
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
    // 模拟 prepareAcceptTarget 的真实形状:每条 locator 的 currentExperiment 只带自己的 pair plan。
    const prepared = await Promise.all(sources.map((source) => prepareAcceptedAttempt({
      recordRoot: root,
      source,
      pair: makePair({}, source.evalId),
      currentFingerprint: `current-${source.evalId}`,
      currentManifest,
      currentConfigHash: "shared-config",
      currentExperiment: {
        attempts: 1,
        earlyExit: true,
        sandboxLayer: {},
        sandboxPlansByEval: { [source.evalId]: { plan: source.evalId } },
        agentInstalls: [],
      },
      knownEvalIds: [source.evalId],
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

    // 快照级覆盖声明必须是整组,不能只剩 groupFirst 的单题——否则 currentSample / view 塌成 1 题。
    const runMeta = JSON.parse(
      await readFile(join(accepted[0]!.run.dir, "run.json"), "utf-8"),
    ) as {
      experiment?: { sandboxPlansByEval?: globalThis.Record<string, unknown> };
      knownEvalIds?: string[];
    };
    expect(runMeta.experiment).not.toHaveProperty("selectedEvalIds");
    expect(runMeta.experiment).not.toHaveProperty("evalFilterFingerprint");
    expect(Object.keys(runMeta.experiment?.sandboxPlansByEval ?? {}).sort()).toEqual(["e", "f"]);
    expect(runMeta.knownEvalIds?.slice().sort()).toEqual(["e", "f"]);

    // 读面:currentSample 必须看到两条,只消费物理 attempts。
    const { currentSample } = await import("../sample/index.ts");
    const sample = currentSample(accepted[0]!.record);
    expect(sample.attempts.map((a) => a.evalId).sort()).toEqual(["e", "f"]);
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

// cases: docs/engineering/testing/unit/experiments-runner.md「接受的重锚与留痕」
// bug: memory/accept-drops-eval-level-judge-from-fingerprint.md
// prepareAcceptLocator 必须与 planCarry(fingerprint.ts)用同一份 Judge 解析链(experiment >
// eval > config)重算当前身份;只有 experiment 级 judge 走默认单层投影时,eval 级(或 config
// 级)judge 会在 accept 落盘的 fingerprint/configHash 里悄悄消失,下一次 exp 用完整链重算出
// 不同指纹,accept 之后立刻又被判 stale——本组证明接受的新结果与 planCarry 独立算出的口径
// 完全相同,因此真的会被下一轮携带,而不是一次性豁免。
describe("prepareAcceptLocator · 与 planCarry 同口径的 Judge 解析链", () => {
  it("只有 eval 级 judge(experiment/config 都未声明)时,accept 的指纹仍与 planCarry 一致并被下一轮携带", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-judge-chain-"));
    roots.push(root);

    const sourcePath = fileURLToPath(import.meta.url);
    const source: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };
    const evalDef = discoverEval(defineEval({
      judge: { model: "eval-model", baseUrl: "https://eval.example/v1" },
      test() {},
    }), {
      id: "e",
      baseDir: "/project",
      sourcePath,
      source,
      loaderDataPaths: [],
      criteriaPaths: [],
      privatePaths: [],
    });
    const experiment = discoverExperiment(defineExperiment({
      agent: defineAgent({
        name: "agent-exp",
        evidenceCoverage: completeEvidenceCoverage,
        send: async () => ({ events: [], status: "completed" }),
      }),
      evals: "*",
    }), {
      id: "exp",
      baseDir: "/project",
      sourcePath,
    });

    // 一条早已 stale 的历史结果:指纹与配置身份都是任意旧值,人打算 accept 它。
    const historicalRunId = "historical-run-id";
    const historicalLocator = encodeAttemptLocator({ runId: historicalRunId, evalId: "e", attempt: 0 });
    const historicalWriter = createWriter(root, { producer: { name: "niceeval" } });
    const historicalRun = await historicalWriter.run({
      runId: historicalRunId,
      experimentId: "exp",
      agent: "old-agent",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    await historicalRun.writeAttempt({
      id: "e",
      verdict: "passed",
      fingerprint: "stale-fingerprint",
      configHash: "stale-config",
      attempt: 0,
      durationMs: 5,
      executionMs: 5,
      assertions: [],
      evidenceCoverage: completeEvidenceCoverage,
    });
    await historicalRun.finish();

    const prepared = await prepareAcceptLocator({
      cwd: root,
      recordRoot: root,
      locator: historicalLocator,
      config: {},
      evals: [evalDef],
      experiments: [experiment],
      now: () => "2026-01-02T00:00:00.000Z",
    });

    // planCarry 是调度真正会走的路径;`prepared.pair.run` 就是 accept 内部按 experiment 派生出的
    // 同一个 AgentRun,喂给 planCarry 重算一次,得到的指纹/配置哈希必须与 accept 落盘的完全相同。
    const independentPlan = await planCarry([evalDef], [prepared.pair.run], undefined);
    expect(prepared.currentFingerprint).toBe(independentPlan.plannedFingerprints.get("exp|e"));
    expect(prepared.currentConfigHash).toBe(independentPlan.plannedConfigHashes.get("exp|e"));

    const [accepted] = await writeAcceptedAttempts([prepared]);
    if (accepted === undefined) throw new Error("expected one accepted attempt");

    // 下一次不带参数的 exp 命中这条新结果——证明接受是重锚而不是一次豁免。
    const nextPlan = await planCarry([evalDef], [prepared.pair.run], [accepted.attempt.result]);
    expect([...(nextPlan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
  });
});

// cases: docs/engineering/testing/unit/experiments-runner.md「`niceeval accept @<locator>...` 的对象与资格」
// 多 locator 不再要求同一 experiment(docs/feature/experiments/cache.md「accept」)：命令按 experiment
// 分组，每组各自封口一个 snapshot。本组证明分组后快照级字段(agent/configHash/manifests)互不串仓、
// 返回值顺序与调用方传入的 prepared 顺序一致(分组会打乱内部处理顺序)。
describe("writeAcceptedAttempts · 跨 experiment 分组提交", () => {
  it("按 experiment 分组各自封口 snapshot,快照级字段互不串仓,返回值顺序与入参一致", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-cross-experiment-write-"));
    roots.push(root);
    // 同名 eval id "e"分属两个不同 experiment——真实案例(toggl-cli/04-billing-doc)正是这种形状。
    const sourceA = makeSource(root, { id: "e" }, "exp-a");
    const sourceB = makeSource(root, { id: "e" }, "exp-b");
    const manifestA = { algorithmVersion: 2, coverageVersion: 1, config: { "agent.name": "agent-a" }, source: {}, data: {} };
    const manifestB = { algorithmVersion: 2, coverageVersion: 1, config: { "agent.name": "agent-b" }, source: {}, data: {} };

    const preparedA = await prepareAcceptedAttempt({
      recordRoot: root,
      source: sourceA,
      pair: makePair({ experimentId: "exp-a", agentName: "agent-a" }, "e"),
      currentFingerprint: "current-a",
      currentManifest: manifestA,
      currentConfigHash: "config-a",
      knownEvalIds: ["e"],
      now: () => "2026-01-02T00:00:00.000Z",
    });
    const preparedB = await prepareAcceptedAttempt({
      recordRoot: root,
      source: sourceB,
      pair: makePair({ experimentId: "exp-b", agentName: "agent-b" }, "e"),
      currentFingerprint: "current-b",
      currentManifest: manifestB,
      currentConfigHash: "config-b",
      knownEvalIds: ["e"],
      now: () => "2026-01-02T00:00:00.000Z",
    });

    // 传入顺序 B, A——返回值必须还原成 B, A,不能被内部按 experiment 分组打乱。
    const accepted = await writeAcceptedAttempts([preparedB, preparedA]);

    expect(accepted).toHaveLength(2);
    expect(accepted[0]!.sourceLocator).toBe(preparedB.sourceLocator);
    expect(accepted[1]!.sourceLocator).toBe(preparedA.sourceLocator);
    expect(accepted[0]!.run.runId).not.toBe(accepted[1]!.run.runId);
    expect(accepted[0]!.run.dir).not.toBe(accepted[1]!.run.dir);
    expect(accepted[0]!.run.agent).toBe("agent-b");
    expect(accepted[1]!.run.agent).toBe("agent-a");
    expect(accepted[0]!.run.configHash).toBe("config-b");
    expect(accepted[1]!.run.configHash).toBe("config-a");

    const manifestsB = JSON.parse(await readFile(join(accepted[0]!.run.dir, MANIFESTS_FILE), "utf8")) as Record<string, unknown>;
    const manifestsA = JSON.parse(await readFile(join(accepted[1]!.run.dir, MANIFESTS_FILE), "utf8")) as Record<string, unknown>;
    expect(Object.keys(manifestsB)).toEqual(["e"]);
    expect(Object.keys(manifestsA)).toEqual(["e"]);
    expect(manifestsB.e).not.toEqual(manifestsA.e);
  });
});

function discoverFixture(sourcePath: string, evalId: string, experimentId: string, agentName: string) {
  const evalSource: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };
  const evalDef = discoverEval(defineEval({ test() {} }), {
    id: evalId,
    baseDir: "/project",
    sourcePath,
    source: evalSource,
    loaderDataPaths: [],
    criteriaPaths: [],
    privatePaths: [],
  });
  const experiment = discoverExperiment(defineExperiment({
    agent: defineAgent({
      name: agentName,
      evidenceCoverage: completeEvidenceCoverage,
      send: async () => ({ events: [], status: "completed" }),
    }),
    evals: "*",
  }), { id: experimentId, baseDir: "/project", sourcePath });
  return { evalDef, experiment };
}

async function seedHistoricalPassed(root: string, experimentId: string, evalId: string, agent: string): Promise<string> {
  const runId = `${experimentId}-historical`;
  const writer = createWriter(root, { producer: { name: "niceeval" } });
  const run = await writer.run({ runId, experimentId, agent, startedAt: "2026-01-01T00:00:00.000Z" });
  await run.writeAttempt({
    id: evalId,
    verdict: "passed",
    fingerprint: "stale-fingerprint",
    configHash: "stale-config",
    attempt: 0,
    durationMs: 5,
    executionMs: 5,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
  });
  await run.finish();
  return encodeAttemptLocator({ runId, evalId, attempt: 0 });
}

// cases: docs/engineering/testing/unit/experiments-runner.md「`niceeval accept @<locator>...` 的对象与资格」
// bug: memory/accept-batch-per-locator-planning-oom.md
// acceptLocators 曾在多 locator 时逐条并发重跑一遍完整 discovery + sandbox planning，137 条
// locator 撑爆 4GB 堆；本组证明 discovery 只 hoist 一次、sandbox planning 按 experiment
// 记忆化后，端到端接受跨 experiment 的批次仍能正确按 experiment 分组，且同名 eval 跨
// experiment 不误判重复(toggl-cli/04 的真实形状)。
describe("acceptLocators · 跨 experiment 批量", () => {
  it("跨 experiment 的同名 eval 各自独立接受,不判重复,discovery 与 planning 只 hoist 一次", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-locators-cross-experiment-"));
    roots.push(root);
    const sourcePath = fileURLToPath(import.meta.url);
    const { evalDef: evalA, experiment: experimentA } = discoverFixture(sourcePath, "e", "exp-a", "agent-a");
    const { evalDef: evalB, experiment: experimentB } = discoverFixture(sourcePath, "e", "exp-b", "agent-b");

    const locatorA = await seedHistoricalPassed(root, "exp-a", "e", "old-agent-a");
    const locatorB = await seedHistoricalPassed(root, "exp-b", "e", "old-agent-b");

    const accepted = await acceptLocators({
      cwd: root,
      recordRoot: root,
      locators: [locatorA, locatorB],
      config: {},
      evals: [evalA, evalB],
      experiments: [experimentA, experimentB],
      now: () => "2026-01-02T00:00:00.000Z",
    });

    expect(accepted).toHaveLength(2);
    expect(accepted[0]!.sourceLocator).toBe(locatorA);
    expect(accepted[1]!.sourceLocator).toBe(locatorB);
    expect(accepted[0]!.run.runId).not.toBe(accepted[1]!.run.runId);
    expect(accepted[0]!.attempt.run.agent).toBe("agent-a");
    expect(accepted[1]!.attempt.run.agent).toBe("agent-b");
  });

  it("同一 experiment 内两个 locator 解析到同一个当前 (eval, attempt) 目标仍拒绝为重复", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-locators-same-experiment-duplicate-"));
    roots.push(root);
    const sourcePath = fileURLToPath(import.meta.url);
    const { evalDef, experiment } = discoverFixture(sourcePath, "e", "exp", "agent");

    // 两条历史结果各自跑在不同的旧 run 下，但都会重锚到同一个当前 (exp, e, attempt 0) 目标。
    // writer.run() 按 experimentId 记忆化同一个 RunWriter,两条历史各自需要独立 finish(),
    // 因此每次 seed 都建一个新 writer(与 seedHistoricalPassed 同一纪律)。
    async function seed(runId: string): Promise<string> {
      const writer = createWriter(root, { producer: { name: "niceeval" } });
      const run = await writer.run({ runId, experimentId: "exp", agent: "old-agent", startedAt: "2026-01-01T00:00:00.000Z" });
      await run.writeAttempt({
        id: "e",
        verdict: "passed",
        fingerprint: `stale-${runId}`,
        configHash: "stale-config",
        attempt: 0,
        durationMs: 5,
        executionMs: 5,
        assertions: [],
        evidenceCoverage: completeEvidenceCoverage,
      });
      await run.finish();
      return encodeAttemptLocator({ runId, evalId: "e", attempt: 0 });
    }
    const locatorFirst = await seed("historical-1");
    const locatorSecond = await seed("historical-2");

    await expect(acceptLocators({
      cwd: root,
      recordRoot: root,
      locators: [locatorFirst, locatorSecond],
      config: {},
      evals: [evalDef],
      experiments: [experiment],
      now: () => "2026-01-02T00:00:00.000Z",
    })).rejects.toMatchObject({ name: "AcceptError", code: "batch-mismatch" });
  });

  it("跨 experiment 批里任一条不合格(errored)时整批零写入", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-accept-locators-cross-experiment-atomic-"));
    roots.push(root);
    const sourcePath = fileURLToPath(import.meta.url);
    const { evalDef: evalA, experiment: experimentA } = discoverFixture(sourcePath, "e", "exp-a", "agent-a");
    const { evalDef: evalB, experiment: experimentB } = discoverFixture(sourcePath, "e", "exp-b", "agent-b");

    const locatorA = await seedHistoricalPassed(root, "exp-a", "e", "old-agent-a");
    const writerB = createWriter(root, { producer: { name: "niceeval" } });
    const runB = await writerB.run({ runId: "exp-b-historical", experimentId: "exp-b", agent: "old-agent-b", startedAt: "2026-01-01T00:00:00.000Z" });
    await runB.writeAttempt({
      id: "e",
      verdict: "errored",
      fingerprint: "stale-fingerprint-b",
      configHash: "stale-config-b",
      attempt: 0,
      durationMs: 5,
      assertions: [],
      evidenceCoverage: completeEvidenceCoverage,
    });
    await runB.finish();
    const locatorB = encodeAttemptLocator({ runId: "exp-b-historical", evalId: "e", attempt: 0 });

    // 两个 experiment 目录此刻各自只有一份历史(seed 用的)快照;接受失败后不应该多出新的。
    const beforeA = await readdir(join(root, "exp-a"));
    const beforeB = await readdir(join(root, "exp-b"));

    await expect(acceptLocators({
      cwd: root,
      recordRoot: root,
      locators: [locatorA, locatorB],
      config: {},
      evals: [evalA, evalB],
      experiments: [experimentA, experimentB],
      now: () => "2026-01-02T00:00:00.000Z",
    })).rejects.toMatchObject({ name: "AcceptError", code: "not-terminal" });

    // exp-a 本可以独立成功,但跨 experiment 批的预检仍是全批原子:一条不合格,整批零写入,
    // 即使不合格的那一条属于另一个 experiment。
    expect(await readdir(join(root, "exp-a"))).toEqual(beforeA);
    expect(await readdir(join(root, "exp-b"))).toEqual(beforeB);
  });
});
