// cases: docs/engineering/testing/unit/experiments-runner.md
// 覆盖「缓存」分区新增两行:携带以 attempt 为粒度、未收尾快照是合法来源(见 docs/runner.md
// 「缓存:指纹去重」)。受控模拟代替真实 `runs:5` + `kill -9`——直接构造"跑到一半"的
// priorResults fixture(部分终态 attempt + 缺失序号),断言 planCarry 只把逐条确实终态匹配的
// 序号规划为携带,缺失的序号必须留给调度真正派发;errored/skipped 永不携带,即使同一个 eval
// 的其它序号是终态——不能因为"这个 (experiment, eval) 组合有过携带"就把它也捎带进去。

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { defineAgent } from "../define.ts";
import { computeFingerprint, planCarry } from "./fingerprint.ts";
import type { AgentRun, DiscoveredEval } from "./types.ts";
import type { EvalResult } from "../types.ts";
import type { CapturedEvalSource } from "./eval-source.ts";

// 判断指纹需要一个真实可读文件(computeFingerprint 无条件 readFile(evalDef.sourcePath));
// 内容不重要,指向本测试文件自己,永远存在。
const sourcePath = fileURLToPath(import.meta.url);
const source: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };

function makeEval(id: string): DiscoveredEval {
  return { id, baseDir: "/project", sourcePath, source, test: () => {} };
}

function makeRun(experimentId: string, selectedEvalIds: string[], runs: number, timeoutMs?: number): AgentRun {
  return {
    agent: defineAgent({ name: `agent-${experimentId}`, send: async () => ({ events: [], status: "completed" }) }),
    flags: {},
    runs,
    earlyExit: false,
    selectedEvalIds,
    experimentId,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function result(over: Partial<EvalResult> & Pick<EvalResult, "id" | "attempt" | "verdict">): EvalResult {
  return {
    experimentId: "exp",
    agent: "agent-exp",
    durationMs: 1,
    assertions: [],
    ...over,
  };
}

describe("planCarry · 携带以 attempt 为粒度", () => {
  it("runs:5、上一轮只落盘 3 条终态 attempt(序号 1/2/4):只把这 3 个具体序号规划为携带,缺失的 0/3 必须真正派发", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 5);
    const fingerprint = await computeFingerprint(evals[0]!, run);

    const priorResults: EvalResult[] = [
      result({ id: "e", attempt: 1, verdict: "passed", fingerprint }),
      result({ id: "e", attempt: 2, verdict: "failed", fingerprint }),
      result({ id: "e", attempt: 4, verdict: "passed", fingerprint }),
      // 序号 0、3 从未落盘(上一轮被强杀 / 中断时还没跑到),必须真正派发,不能被"这个组合有过携带"整段跳过。
    ];

    const plan = await planCarry(evals, [run], priorResults);

    expect(plan.carriedAttemptsByKey.get("exp|e")).toEqual(new Set([1, 2, 4]));
    expect(plan.carriedResults.map((r) => r.attempt).sort()).toEqual([1, 2, 4]);
    // 分母 = 携带(3) + 新跑(缺失的 0、3,共 2 个)= 5,与 runs:5 请求的总量一致。
    expect(plan.carriedResults.length + 2).toBe(5);
  });

  it("同一个 eval 里,errored 的那个具体 attempt 永不携带,即使另一个序号是终态且指纹匹配", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 2);
    const fingerprint = await computeFingerprint(evals[0]!, run);

    const priorResults: EvalResult[] = [
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint }),
      result({ id: "e", attempt: 1, verdict: "errored", fingerprint }), // 同 key,但自己不是终态
    ];

    const plan = await planCarry(evals, [run], priorResults);

    // 只有序号 0 被携带;序号 1(errored)不能因为序号 0 命中就被连带携带进去。
    expect(plan.carriedAttemptsByKey.get("exp|e")).toEqual(new Set([0]));
    expect(plan.carriedResults.map((r) => r.attempt)).toEqual([0]);
  });

  it("skipped 判定同样永不携带", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 2);
    const fingerprint = await computeFingerprint(evals[0]!, run);

    const priorResults: EvalResult[] = [result({ id: "e", attempt: 0, verdict: "skipped", fingerprint })];

    const plan = await planCarry(evals, [run], priorResults);

    expect(plan.carriedAttemptsByKey.get("exp|e")).toBeUndefined();
    expect(plan.carriedResults).toEqual([]);
  });

  it("指纹不匹配(fixture / 配置变了)时,即使 verdict 终态也不携带——携带来源不看快照有没有收尾,只看每条 attempt 自己的指纹", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 1);

    // 未收尾快照的合法来源语义:这里模拟"上一轮的 result.json 已经落盘、但所属快照缺
    // completedAt"的场景——planCarry 不检查快照收尾与否,只逐条比较 attempt 自己的指纹,
    // 所以指纹匹配的终态 attempt 照常携带(fingerprint 不匹配的这条不携带,验证的是另一条边界)。
    const priorResults: EvalResult[] = [result({ id: "e", attempt: 0, verdict: "passed", fingerprint: "stale-fingerprint-from-before-a-code-change" })];

    const plan = await planCarry(evals, [run], priorResults);

    expect(plan.carriedAttemptsByKey.get("exp|e")).toBeUndefined();
    expect(plan.carriedResults).toEqual([]);
  });

  it("未收尾快照产出的终态 attempt 是合法携带来源:只要该条自己指纹匹配就携带,不因缺 completedAt 被拒绝", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 3);
    const fingerprint = await computeFingerprint(evals[0]!, run);

    // priorResults 的形状与"完整收尾的快照"和"被强杀、缺 completedAt 的未收尾快照"完全相同——
    // loadLatestResultsPerEval 按落盘的 result.json 逐条读,不检查 snapshot.json 的
    // completedAt(见 view/data.ts)。这里直接验证 planCarry 这一侧对这类结果一视同仁。
    const priorResults: EvalResult[] = [result({ id: "e", attempt: 0, verdict: "passed", fingerprint })];

    const plan = await planCarry(evals, [run], priorResults);

    expect(plan.carriedAttemptsByKey.get("exp|e")).toEqual(new Set([0]));
    expect(plan.carriedResults).toHaveLength(1);
  });
});

describe("planCarry · timeoutMs 是携带资格判据,不进指纹哈希", () => {
  it("指纹不受 timeoutMs 影响:同一个 eval 在不同 timeoutMs 的 run 下算出相同指纹", async () => {
    const evals = [makeEval("e")];
    const shortRun = makeRun("exp", ["e"], 1, 1_200_000); // 20m
    const longRun = makeRun("exp", ["e"], 1, 2_400_000); // 40m

    const fpShort = await computeFingerprint(evals[0]!, shortRun);
    const fpLong = await computeFingerprint(evals[0]!, longRun);

    expect(fpShort).toBe(fpLong);
  });

  it("调高 timeoutMs 上限:旧终态 attempt(含贴着旧线的耗时)全部照常携带,不重跑", async () => {
    const evals = [makeEval("e")];
    // 旧一轮在 20m 上限下跑完;新一轮把上限提到 40m。
    const oldRun = makeRun("exp", ["e"], 1, 1_200_000);
    const newRun = makeRun("exp", ["e"], 1, 2_400_000);
    const fingerprint = await computeFingerprint(evals[0]!, oldRun);

    const priorResults: EvalResult[] = [
      // 19m,贴着旧线但仍是终态(没撞线),新线(40m)下应恒可携带。
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint, durationMs: 19 * 60_000 }),
    ];

    const plan = await planCarry(evals, [newRun], priorResults);

    expect(plan.carriedAttemptsByKey.get("exp|e")).toEqual(new Set([0]));
    expect(plan.carriedResults).toHaveLength(1);
  });

  it("调低 timeoutMs 上限:耗时超过新线的旧终态不可携带,必须重新调度", async () => {
    const evals = [makeEval("e")];
    const oldRun = makeRun("exp", ["e"], 1, 2_400_000); // 40m
    const newRun = makeRun("exp", ["e"], 1, 600_000); // 10m
    const fingerprint = await computeFingerprint(evals[0]!, oldRun);

    const priorResults: EvalResult[] = [
      // 19m 在旧的 40m 线下是正常终态,在新的 10m 线下超线,不可在新配置下复现。
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint, durationMs: 19 * 60_000 }),
    ];

    const plan = await planCarry(evals, [newRun], priorResults);

    expect(plan.carriedAttemptsByKey.get("exp|e")).toBeUndefined();
    expect(plan.carriedResults).toEqual([]);
  });

  it("调低 timeoutMs 上限但旧耗时仍在新线以内:照常携带", async () => {
    const evals = [makeEval("e")];
    const oldRun = makeRun("exp", ["e"], 1, 2_400_000); // 40m
    const newRun = makeRun("exp", ["e"], 1, 600_000); // 10m
    const fingerprint = await computeFingerprint(evals[0]!, oldRun);

    const priorResults: EvalResult[] = [
      // 5m,新线(10m)以内,即使上限被调低也不受影响。
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint, durationMs: 5 * 60_000 }),
    ];

    const plan = await planCarry(evals, [newRun], priorResults);

    expect(plan.carriedAttemptsByKey.get("exp|e")).toEqual(new Set([0]));
    expect(plan.carriedResults).toHaveLength(1);
  });

  it("run/evalDef/config 三层都未设 timeoutMs:视为无穷,不论 durationMs 多大都恒可携带", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 1); // 无 timeoutMs
    const fingerprint = await computeFingerprint(evals[0]!, run);

    const priorResults: EvalResult[] = [
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint, durationMs: 10 * 60 * 60_000 }), // 10 小时
    ];

    const plan = await planCarry(evals, [run], priorResults);

    expect(plan.carriedAttemptsByKey.get("exp|e")).toEqual(new Set([0]));
  });

  it("项目级 Config.timeoutMs 兜底生效:run/evalDef 都未设时按 configTimeoutMs 判定", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 1); // run.timeoutMs 未设
    const fingerprint = await computeFingerprint(evals[0]!, run);

    const priorResults: EvalResult[] = [
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint, durationMs: 19 * 60_000 }), // 19m
    ];

    // configTimeoutMs = 10m,低于 19m 的旧耗时:即使 run/evalDef 都没显式设置,project 级兜底也要拦下。
    const planLow = await planCarry(evals, [run], priorResults, undefined, 600_000);
    expect(planLow.carriedAttemptsByKey.get("exp|e")).toBeUndefined();

    // configTimeoutMs = 40m,高于 19m:照常携带。
    const planHigh = await planCarry(evals, [run], priorResults, undefined, 2_400_000);
    expect(planHigh.carriedAttemptsByKey.get("exp|e")).toEqual(new Set([0]));
  });

  it("旧记录 durationMs 缺失(磁盘数据损坏)时保守判不可携带,不当作 0 处理", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 1, 1_200_000);
    const fingerprint = await computeFingerprint(evals[0]!, run);

    const priorResults: EvalResult[] = [
      { ...result({ id: "e", attempt: 0, verdict: "passed", fingerprint }), durationMs: undefined as unknown as number },
    ];

    const plan = await planCarry(evals, [run], priorResults);

    expect(plan.carriedAttemptsByKey.get("exp|e")).toBeUndefined();
    expect(plan.carriedResults).toEqual([]);
  });
});
