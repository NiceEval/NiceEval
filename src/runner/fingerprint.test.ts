// cases: docs/engineering/testing/unit/experiments-runner.md
// 覆盖「缓存」分区新增两行:携带以 attempt 为粒度、未收尾快照是合法来源(见 docs/runner.md
// 「缓存:指纹去重」)。受控模拟代替真实 `attempts: 5` + `kill -9`——直接构造"跑到一半"的
// priorResults fixture(部分终态 attempt + 缺失序号),断言 planCarry 只把逐条确实终态匹配的
// 序号规划为携带,缺失的序号必须留给调度真正派发;errored/skipped 永不携带,即使同一个 eval
// 的其它序号是终态——不能因为"这个 (experiment, eval) 组合有过携带"就把它也捎带进去。

import { afterEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineDirectAgent, defineEval, defineSandboxAgent } from "../define.ts";
import { defineSandboxCommand } from "../sandbox/commands.ts";
import { createBuiltinSandboxFactories, type SandboxLayer } from "../sandbox/layer.ts";
import { SandboxPhysicalPlanningError } from "../sandbox/plan.ts";
import {
  computeConfigHash,
  computeFingerprint,
  carryGateFor,
  fingerprintWithManifest,
  planCarry as planCarryEffect,
  type CarryPlan,
} from "./fingerprint.ts";
import {
  compareFingerprints,
  FINGERPRINT_ALGORITHM_VERSION,
  FINGERPRINT_COVERAGE_VERSION,
  manifestDeltas,
  type EvalManifest,
} from "./manifest.ts";
import { parseRunManifests } from "../record/manifest.ts";
import { prepareRunSandboxes, type PreparedRunPair } from "./sandbox-selection.ts";
import { discoverEval, type AgentRun, type DiscoveredEval } from "./types.ts";
import type { EvalResult, JudgeConfig } from "../types.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import { interpolate } from "../i18n/core.ts";
import { en } from "../i18n/en.ts";
import { zhCN } from "../i18n/zh-CN.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";

// 判断指纹需要一个真实可读文件(computeFingerprint 无条件 readFile(evalDef.sourcePath));
// 内容不重要,指向本测试文件自己,永远存在。
const sourcePath = fileURLToPath(import.meta.url);
const source: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };
const sandboxFactories = createBuiltinSandboxFactories({
  dockerBuildPlatform: Effect.succeed("linux/amd64"),
  hostPlatform: { _tag: "Darwin", os: "darwin", arch: "arm64" },
});
const DIRECT_RUN_INFO = {
  sandboxLayer: { kind: "direct" },
  sandboxPlansByEval: {},
  agentInstalls: [],
};
const tempRoots: string[] = [];

function planCarry(...args: Parameters<typeof planCarryEffect>) {
  return Effect.runPromise(planCarryEffect(...args));
}

if (false) {
  const plan = undefined as unknown as CarryPlan;
  // @ts-expect-error CarryPlan 只暴露 ReadonlyMap，派发期不能反向改规划。
  plan.plannedFingerprints.set("pair", "fingerprint");
}
afterEach(async () => Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

interface EvalFixtureOptions {
  readonly baseDir?: string;
  readonly sourcePath?: string;
  readonly judge?: JudgeConfig;
  readonly sandbox?: SandboxLayer;
}

function makeEval(id: string, options: EvalFixtureOptions = {}): DiscoveredEval {
  return discoverEval(defineEval({
    ...(options.judge === undefined ? {} : { judge: options.judge }),
    ...(options.sandbox === undefined ? {} : { sandbox: options.sandbox }),
    test() {},
  }), {
    id,
    baseDir: options.baseDir ?? "/project",
    sourcePath: options.sourcePath ?? sourcePath,
    source,
    loaderDataPaths: [],
    criteriaPaths: [],
    privatePaths: [],
  });
}

function makeRun(experimentId: string, selectedEvalIds: string[], attempts: number, timeoutMs?: number): AgentRun {
  return {
    agent: defineDirectAgent({
      name: `agent-${experimentId}`,
      evidenceCoverage: completeEvidenceCoverage,
      send: async () => ({ events: [], status: "completed" }),
    }),
    flags: {},
    attempts,
    earlyExit: false,
    selectedEvalIds,
    experimentId,
    experimentBaseDir: "/project",
    experimentSourcePath: sourcePath,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function makeSandboxRun(experimentId: string, selectedEvalIds: string[], attempts: number): AgentRun {
  return {
    ...makeRun(experimentId, selectedEvalIds, attempts),
    agent: defineSandboxAgent({
      name: "sandbox-agent",
      evidenceCoverage: completeEvidenceCoverage,
      ensure: {
        identity: { agent: "sandbox-agent", version: "0.0.0-test", revision: "1" },
        probe: defineSandboxCommand(
          { id: "test.sandbox.probe", revision: "1", inputs: {} },
          async () => {},
        ),
      },
      installers: [],
      send: async () => ({ events: [], status: "completed" }),
    }),
  };
}

function result(over: Partial<EvalResult> & Pick<EvalResult, "id" | "attempt" | "verdict">): EvalResult {
  return {
    experimentId: "exp",
    agent: "agent-exp",
    durationMs: 1,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
    ...over,
  };
}

async function preparedPair(evalDef: DiscoveredEval, run: AgentRun): Promise<PreparedRunPair> {
  const [pair] = await Effect.runPromise(prepareRunSandboxes([evalDef], [run]));
  if (pair === undefined) throw new Error("expected one prepared run pair");
  return pair;
}

async function fingerprintFor(evalDef: DiscoveredEval, run: AgentRun): Promise<string> {
  return computeFingerprint(await preparedPair(evalDef, run));
}

async function fingerprintWithManifestFor(evalDef: DiscoveredEval, run: AgentRun) {
  return fingerprintWithManifest(await preparedPair(evalDef, run));
}

async function configHashFor(evalDef: DiscoveredEval, run: AgentRun): Promise<string> {
  return computeConfigHash(await preparedPair(evalDef, run));
}

describe("fingerprint manifest comparison", () => {
  it("新清单持久化独立的 algorithm/coverage 版本", async () => {
    const { manifest } = await fingerprintWithManifestFor(makeEval("e"), makeRun("exp", ["e"], 1));

    expect(manifest.algorithmVersion).toBe(FINGERPRINT_ALGORITHM_VERSION);
    expect(manifest.coverageVersion).toBe(FINGERPRINT_COVERAGE_VERSION);
  });

  it("旧清单缺少版本字段时按 legacy 0 读取", () => {
    const manifests = parseRunManifests({
      e: { config: {}, source: {}, data: {} },
    });

    expect(manifests.e).toMatchObject({ algorithmVersion: 0, coverageVersion: 0 });
  });

  it("相同版本有具名差异时产出非空 changed comparison", () => {
    const historical: EvalManifest = {
      algorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
      coverageVersion: FINGERPRINT_COVERAGE_VERSION,
      config: { model: "old" },
      source: {},
      data: {},
    };
    const current: EvalManifest = { ...historical, config: { model: "new" } };

    expect(compareFingerprints("old", "new", historical, current)).toEqual({
      kind: "changed",
      deltas: [{ _tag: "Changed", selector: "config:model", from: "old", to: "new" }],
    });
  });

  it("manifestDeltas 为空但 fingerprint 不同时产出 unexplained", () => {
    const manifest: EvalManifest = {
      algorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
      coverageVersion: FINGERPRINT_COVERAGE_VERSION,
      config: {},
      source: {},
      data: {},
    };

    expect(compareFingerprints("old", "new", manifest, manifest)).toEqual({
      kind: "unexplained",
      reason: "fingerprint-invariant-violation",
    });
  });

  it("版本不同时产出闭集的 fingerprint-version-changed reason", () => {
    const current: EvalManifest = {
      algorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
      coverageVersion: FINGERPRINT_COVERAGE_VERSION,
      config: {},
      source: {},
      data: {},
    };

    expect(compareFingerprints("old", "new", { ...current, algorithmVersion: 0, coverageVersion: 0 }, current)).toEqual({
      kind: "unexplained",
      reason: "fingerprint-version-changed",
      fromVersion: 0,
      toVersion: FINGERPRINT_ALGORITHM_VERSION,
    });
  });
});

describe("按需构建进入指纹", () => {
  it("Dockerfile context 内容变化会改变 fingerprint，阻止携带旧环境结果", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-fingerprint-build-"));
    tempRoots.push(root);
    await writeFile(join(root, "Dockerfile"), `FROM node@sha256:${"a".repeat(64)}\nCOPY payload /payload\n`);
    await writeFile(join(root, "payload"), "first\n");
    const evalDef = makeEval("e", {
      baseDir: root,
      sandbox: sandboxFactories.dockerfileSandbox({ context: "." }),
    });
    const run: AgentRun = {
      ...makeRun("exp", ["e"], 1),
      agent: defineSandboxAgent({
        name: "sandbox",
        evidenceCoverage: completeEvidenceCoverage,
        ensure: {
          identity: { agent: "sandbox", version: "0.0.0-test", revision: "1" },
          probe: defineSandboxCommand(
            { id: "test.sandbox.probe", revision: "1", inputs: {} },
            async () => {},
          ),
        },
        installers: [],
        send: async () => ({ events: [], status: "completed" }),
      }),
    };

    const first = await fingerprintFor(evalDef, run);
    await writeFile(join(root, "payload"), "second\n");
    expect(await fingerprintFor(evalDef, run)).not.toBe(first);
  });

  it("Compose bytes 与各 service BuildKey 在携带前进入 pair identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-fingerprint-compose-"));
    tempRoots.push(root);
    await mkdir(join(root, "client"));
    await writeFile(
      join(root, "client", "Dockerfile"),
      `FROM node@sha256:${"b".repeat(64)}\nCOPY payload /payload\n`,
    );
    await writeFile(join(root, "client", "payload"), "first\n");
    await writeFile(
      join(root, "compose.yaml"),
      `services:\n  client:\n    build: ./client\n`,
    );
    const evalDef = makeEval("compose", {
      baseDir: root,
      sandbox: sandboxFactories.dockerComposeSandbox({
        file: "compose.yaml",
        workspaceService: "client",
      }),
    });
    const run: AgentRun = {
      ...makeRun("exp-compose", ["compose"], 1),
      agent: defineSandboxAgent({
        name: "sandbox",
        evidenceCoverage: completeEvidenceCoverage,
        ensure: {
          identity: { agent: "sandbox", version: "0.0.0-test", revision: "1" },
          probe: defineSandboxCommand(
            { id: "test.sandbox.probe", revision: "1", inputs: {} },
            async () => {},
          ),
        },
        installers: [],
        send: async () => ({ events: [], status: "completed" }),
      }),
    };

    const first = await fingerprintFor(evalDef, run);
    await writeFile(join(root, "client", "payload"), "second\n");
    expect(await fingerprintFor(evalDef, run)).not.toBe(first);
  });

  it("Compose 外部 bind/env_file/config/secret 内容进入 Case identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-fingerprint-compose-case-"));
    tempRoots.push(root);
    await writeFile(join(root, "mounted.txt"), "mounted:first\n");
    await writeFile(join(root, "runtime.env"), "VALUE=first\n");
    await writeFile(join(root, "app.conf"), "config:first\n");
    await writeFile(join(root, "secret.txt"), "secret:first\n");
    await writeFile(
      join(root, "compose.yaml"),
      `services:\n  client:\n    image: node@sha256:${"c".repeat(64)}\n    volumes:\n      - ./mounted.txt:/fixture/mounted.txt:ro\n    env_file: ./runtime.env\n    configs:\n      - app_config\n    secrets:\n      - app_secret\nconfigs:\n  app_config:\n    file: ./app.conf\nsecrets:\n  app_secret:\n    file: ./secret.txt\n`,
    );
    const evalDef = makeEval("compose-case", {
      baseDir: root,
      sandbox: sandboxFactories.dockerComposeSandbox({
        file: "compose.yaml",
        workspaceService: "client",
      }),
    });
    const run: AgentRun = {
      ...makeRun("exp-compose-case", ["compose-case"], 1),
      agent: defineSandboxAgent({
        name: "sandbox",
        evidenceCoverage: completeEvidenceCoverage,
        ensure: {
          identity: { agent: "sandbox", version: "0.0.0-test", revision: "1" },
          probe: defineSandboxCommand(
            { id: "test.sandbox.probe", revision: "1", inputs: {} },
            async () => {},
          ),
        },
        installers: [],
        send: async () => ({ events: [], status: "completed" }),
      }),
    };

    let previous = await fingerprintFor(evalDef, run);
    for (const [path, content] of [
      ["mounted.txt", "mounted:second\n"],
      ["runtime.env", "VALUE=second\n"],
      ["app.conf", "config:second\n"],
      ["secret.txt", "secret:second\n"],
    ] as const) {
      await writeFile(join(root, path), content);
      const current = await fingerprintFor(evalDef, run);
      expect(current).not.toBe(previous);
      previous = current;
    }
  });
});

describe("planCarry · physical capability barrier", () => {
  it("keep / reuse 要求经 planCarry 接线到全 Run 规划，不进入携带与构建", async () => {
    const evalDef = makeEval("local", { sandbox: sandboxFactories.localSandbox() });
    const run: AgentRun = {
      ...makeRun("exp-local", ["local"], 1),
      sandboxReuse: true,
      agent: defineSandboxAgent({
        name: "sandbox",
        evidenceCoverage: completeEvidenceCoverage,
        ensure: {
          identity: { agent: "sandbox", version: "0.0.0-test", revision: "1" },
          probe: defineSandboxCommand(
            { id: "test.sandbox.probe", revision: "1", inputs: {} },
            async () => {},
          ),
        },
        installers: [],
        send: async () => ({ events: [], status: "completed" }),
      }),
    };

    const failure = await Effect.runPromise(Effect.flip(planCarryEffect(
      [evalDef],
      [run],
      [],
      undefined,
      { keepSandbox: "all" },
    )));
    expect(failure).toBeInstanceOf(SandboxPhysicalPlanningError);
    if (!(failure instanceof SandboxPhysicalPlanningError)) throw new Error("expected physical planning failure");
    expect(failure.issues.map(({ providerCode }) => providerCode)).toEqual([
      "sandbox.reuse-unavailable",
      "sandbox.retention-unavailable",
    ]);
  });
});

describe("planCarry · 携带以 attempt 为粒度", () => {
  it("携带门用 Eligible | Blocked 穷尽表达，不以 undefined 代表成功", () => {
    const passed = result({ id: "e", attempt: 0, verdict: "passed", fingerprint: "fp" });
    expect(carryGateFor(passed, undefined, new Set(["fp"]), Infinity)).toEqual({ _tag: "Eligible" });
    expect(carryGateFor(
      { ...passed, verdict: "errored" },
      undefined,
      new Set(["fp"]),
      Infinity,
    )).toEqual({ _tag: "Blocked", gate: "terminal", reason: "errored" });
  });

  it("attempts: 5、上一轮只落盘 3 条终态 attempt(序号 1/2/4):只把这 3 个具体序号规划为携带,缺失的 0/3 必须真正派发", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 5);
    const fingerprint = await fingerprintFor(evals[0]!, run);

    const priorResults: EvalResult[] = [
      result({ id: "e", attempt: 1, verdict: "passed", fingerprint }),
      result({ id: "e", attempt: 2, verdict: "failed", fingerprint }),
      result({ id: "e", attempt: 4, verdict: "passed", fingerprint }),
      // 序号 0、3 从未落盘(上一轮被强杀 / 中断时还没跑到),必须真正派发,不能被"这个组合有过携带"整段跳过。
    ];

    const plan = await planCarry(evals, [run], priorResults);

    expect([...(plan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([1, 2, 4]);
    expect(plan.carriedResults.map((r) => r.attempt).sort()).toEqual([1, 2, 4]);
    // 分母 = 携带(3) + 新跑(缺失的 0、3,共 2 个)= 5,与 attempts: 5 请求的总量一致。
    expect(plan.carriedResults.length + 2).toBe(5);
    expect(Object.isFrozen(plan)).toBe(true);
    expect("set" in plan.plannedFingerprints).toBe(false);
    expect("add" in plan.carriedAttemptsByKey.get("exp|e")!).toBe(false);
  });

  it("同一个 eval 里,errored 的那个具体 attempt 永不携带,即使另一个序号是终态且指纹匹配", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 2);
    const fingerprint = await fingerprintFor(evals[0]!, run);

    const priorResults: EvalResult[] = [
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint }),
      result({ id: "e", attempt: 1, verdict: "errored", fingerprint }), // 同 key,但自己不是终态
    ];

    const plan = await planCarry(evals, [run], priorResults);

    // 只有序号 0 被携带;序号 1(errored)不能因为序号 0 命中就被连带携带进去。
    expect([...(plan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(plan.carriedResults.map((r) => r.attempt)).toEqual([0]);
  });

  it("skipped 判定同样永不携带", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 2);
    const fingerprint = await fingerprintFor(evals[0]!, run);

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
    const fingerprint = await fingerprintFor(evals[0]!, run);

    // priorResults 的形状与"完整收尾的快照"和"被强杀、缺 completedAt 的未收尾快照"完全相同——
    // loadLatestResultsPerEval 按落盘的 result.json 逐条读,不检查 run.json 的
    // completedAt(见 view/data.ts)。这里直接验证 planCarry 这一侧对这类结果一视同仁。
    const priorResults: EvalResult[] = [result({ id: "e", attempt: 0, verdict: "passed", fingerprint })];

    const plan = await planCarry(evals, [run], priorResults);

    expect([...(plan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(plan.carriedResults).toHaveLength(1);
  });
});

describe("planCarry · timeoutMs 是携带资格判据,不进指纹哈希", () => {
  it("指纹不受 timeoutMs 影响:同一个 eval 在不同 timeoutMs 的 run 下算出相同指纹", async () => {
    const evals = [makeEval("e")];
    const shortRun = makeRun("exp", ["e"], 1, 1_200_000); // 20m
    const longRun = makeRun("exp", ["e"], 1, 2_400_000); // 40m

    const fpShort = await fingerprintFor(evals[0]!, shortRun);
    const fpLong = await fingerprintFor(evals[0]!, longRun);

    expect(fpShort).toBe(fpLong);
  });

  it("调高 timeoutMs 上限:旧终态 attempt(含贴着旧线的耗时)全部照常携带,不重跑", async () => {
    const evals = [makeEval("e")];
    // 旧一轮在 20m 上限下跑完;新一轮把上限提到 40m。
    const oldRun = makeRun("exp", ["e"], 1, 1_200_000);
    const newRun = makeRun("exp", ["e"], 1, 2_400_000);
    const fingerprint = await fingerprintFor(evals[0]!, oldRun);

    const priorResults: EvalResult[] = [
      // 19m,贴着旧线但仍是终态(没撞线),新线(40m)下应恒可携带。
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint, durationMs: 19 * 60_000 }),
    ];

    const plan = await planCarry(evals, [newRun], priorResults);

    expect([...(plan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(plan.carriedResults).toHaveLength(1);
  });

  it("调低 timeoutMs 上限:耗时超过新线的旧终态不可携带,必须重新调度", async () => {
    const evals = [makeEval("e")];
    const oldRun = makeRun("exp", ["e"], 1, 2_400_000); // 40m
    const newRun = makeRun("exp", ["e"], 1, 600_000); // 10m
    const fingerprint = await fingerprintFor(evals[0]!, oldRun);

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
    const fingerprint = await fingerprintFor(evals[0]!, oldRun);

    const priorResults: EvalResult[] = [
      // 5m,新线(10m)以内,即使上限被调低也不受影响。
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint, durationMs: 5 * 60_000 }),
    ];

    const plan = await planCarry(evals, [newRun], priorResults);

    expect([...(plan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(plan.carriedResults).toHaveLength(1);
  });

  it("run/evalDef/config 三层都未设 timeoutMs:视为无穷,不论 durationMs 多大都恒可携带", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 1); // 无 timeoutMs
    const fingerprint = await fingerprintFor(evals[0]!, run);

    const priorResults: EvalResult[] = [
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint, durationMs: 10 * 60 * 60_000 }), // 10 小时
    ];

    const plan = await planCarry(evals, [run], priorResults);

    expect([...(plan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
  });

  it("项目级 Config.timeoutMs 兜底生效:run/evalDef 都未设时按 configTimeoutMs 判定", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 1); // run.timeoutMs 未设
    const fingerprint = await fingerprintFor(evals[0]!, run);

    const priorResults: EvalResult[] = [
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint, durationMs: 19 * 60_000 }), // 19m
    ];

    // configTimeoutMs = 10m,低于 19m 的旧耗时:即使 run/evalDef 都没显式设置,project 级兜底也要拦下。
    const planLow = await planCarry(evals, [run], priorResults, 600_000);
    expect(planLow.carriedAttemptsByKey.get("exp|e")).toBeUndefined();

    // configTimeoutMs = 40m,高于 19m:照常携带。
    const planHigh = await planCarry(evals, [run], priorResults, 2_400_000);
    expect([...(planHigh.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
  });

  it("旧记录 durationMs 缺失(磁盘数据损坏)时保守判不可携带,不当作 0 处理", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 1, 1_200_000);
    const fingerprint = await fingerprintFor(evals[0]!, run);

    const priorResults: EvalResult[] = [
      { ...result({ id: "e", attempt: 0, verdict: "passed", fingerprint }), durationMs: undefined as unknown as number },
    ];

    const plan = await planCarry(evals, [run], priorResults);

    expect(plan.carriedAttemptsByKey.get("exp|e")).toBeUndefined();
    expect(plan.carriedResults).toEqual([]);
  });
});

describe("planCarry · --accept:授权跨过一条精确差异", () => {
  const OLD_FLAGS = { memory: "nowledge", endpoint: "https://old.example" };
  const NEW_FLAGS = { memory: "nowledge" };

  function runWith(over: Partial<AgentRun>): AgentRun {
    return { ...makeRun("exp", ["e"], 1), flags: {}, ...over };
  }

  /**
   * 产出那一轮的落盘:指纹按当轮配置算,清单按同一份输入算(那一轮的 `manifests.json`),
   * 快照记下当轮的配置身份(run.json 的落盘面)。差异解释读的就是这份清单。
   */
  const priorManifests = new Map<string, EvalManifest>();

  it("每个 Experiment × Eval pair 用三层解析后的 Judge 身份生成 hash 与 manifest", async () => {
    const evalDef = makeEval("e", { judge: { model: "eval-model", baseUrl: "https://eval.example/v1" } });
    const run = runWith({ judge: { model: "experiment-model", timeoutMs: 90_000 } });
    const plan = await planCarry([evalDef], [run], [], undefined, {
      configJudge: { model: "config-model", apiKeyEnv: "SECRET_SELECTOR", timeoutMs: 180_000 },
    });
    expect(plan.manifestsByKey.get("exp|e")?.config).toMatchObject({
      "judge.model": "experiment-model",
      "judge.baseUrl": "https://eval.example/v1",
      "judge.timeoutMs": 90_000,
    });
    expect(plan.manifestsByKey.get("exp|e")?.config).not.toHaveProperty("judge.apiKeyEnv");
    const prepared = plan.preparedPairsByKey.get("exp|e");
    expect(prepared).toBeDefined();
    expect(plan.manifestsByKey.get("exp|e")?.plan).toEqual(prepared?.identity);

    const other = await planCarry(
      [evalDef],
      [runWith({ judge: { model: "other-experiment-model", timeoutMs: 90_000 } })],
      [],
      undefined,
      { configJudge: { model: "config-model", apiKeyEnv: "SECRET_SELECTOR" } },
    );
    expect(other.plannedConfigHashes.get("exp|e")).not.toBe(plan.plannedConfigHashes.get("exp|e"));
  });
  async function priorFrom(evalDef: DiscoveredEval, run: AgentRun, over: Partial<EvalResult> = {}): Promise<EvalResult> {
    const { fingerprint, manifest } = await fingerprintWithManifestFor(evalDef, run);
    priorManifests.set("exp|e", manifest);
    return result({
      id: "e",
      attempt: 0,
      verdict: "passed",
      fingerprint,
      configHash: await configHashFor(evalDef, run),
      agent: run.agent.name,
      ...(run.model !== undefined ? { model: run.model } : {}),
      experiment: {
        ...DIRECT_RUN_INFO,
        flags: run.flags,
        attempts: 1,
        earlyExit: false,
        selectedEvalIds: ["e"],
        ...(run.judge !== undefined
          ? { judge: { model: run.judge.model, baseUrl: run.judge.baseUrl, timeoutMs: run.judge.timeoutMs } }
          : {}),
      },
      ...over,
    });
  }

  it("授权 config:flags.<key> 后跨过该差异携带,并按本次口径重锚 + 留下 carriedAccepting 痕迹", async () => {
    const evals = [makeEval("e")];
    const prior = await priorFrom(evals[0]!, runWith({ flags: OLD_FLAGS }));
    const run = runWith({ flags: NEW_FLAGS });

    // 不授权时,flags 袋子变化照常作废历史结果。
    const without = await planCarry(evals, [run], [prior], undefined, { priorManifests });
    expect(without.carriedAttemptsByKey.get("exp|e")).toBeUndefined();

    const withAccept = await planCarry(evals, [run], [prior], undefined, {
      accept: ["config:flags.endpoint"],
      priorManifests,
    });
    expect([...(withAccept.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    // 留痕带上跨过的那条差异与旧值新值(新侧没有这个键,只有 from)。
    expect(withAccept.carriedAcceptingByResult!.get(prior)).toEqual([
      { _tag: "Removed", selector: "config:flags.endpoint", from: "https://old.example" },
    ]);
  });

  it("被授权携入的条目按本 Run 口径重锚,下一次不带 --accept 也照常命中", async () => {
    const evals = [makeEval("e")];
    const run = runWith({ flags: NEW_FLAGS });
    // 上一轮授权携入后,结果已按本次口径重打指纹与 configHash(run.ts 的 restampCarried)。
    const restamped = await priorFrom(evals[0]!, run);

    const plan = await planCarry(evals, [run], [restamped], undefined, { priorManifests });

    expect([...(plan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(plan.carriedAcceptingByResult!.size).toBe(0);
  });

  it("其余差异有任一没被授权则照旧作废——放行只限点名的那一条", async () => {
    const evals = [makeEval("e")];
    const prior = await priorFrom(evals[0]!, runWith({ flags: OLD_FLAGS }));
    // endpoint 被授权,但 memory 这个真影响行为的键也变了:不能携带。
    const run = runWith({ flags: { memory: "baseline" } });

    const plan = await planCarry(evals, [run], [prior], undefined, {
      accept: ["config:flags.endpoint"],
      priorManifests,
    });

    expect(plan.carriedAttemptsByKey.get("exp|e")).toBeUndefined();
  });

  it("嵌套字段用点路径:授权 config:judge.model 跨过换裁判模型,不授权就重跑", async () => {
    const evals = [makeEval("e")];
    const prior = await priorFrom(evals[0]!, runWith({ judge: { model: "gpt-5.6" } }));
    const run = runWith({ judge: { model: "gpt-5.6-sol" } });

    expect((await planCarry(evals, [run], [prior], undefined, { priorManifests }))
      .carriedAttemptsByKey.get("exp|e")).toBeUndefined();

    const plan = await planCarry(evals, [run], [prior], undefined, {
      accept: ["config:judge.model"],
      priorManifests,
    });
    expect([...(plan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(plan.carriedAcceptingByResult!.get(prior)).toEqual([
      { _tag: "Changed", selector: "config:judge.model", from: "gpt-5.6", to: "gpt-5.6-sol" },
    ]);
  });

  it("同一分组里另一条差异没被授权时不整体换回历史值(judge.baseUrl 也变了)", async () => {
    const evals = [makeEval("e")];
    const prior = await priorFrom(evals[0]!, runWith({ judge: { model: "gpt-5.6", baseUrl: "https://old" } }));
    const run = runWith({ judge: { model: "gpt-5.6-sol", baseUrl: "https://new" } });

    const plan = await planCarry(evals, [run], [prior], undefined, {
      accept: ["config:judge.model"],
      priorManifests,
    });

    expect(plan.carriedAttemptsByKey.get("exp|e")).toBeUndefined();
  });

  it("历史侧缺清单时差异算不出,如实给 opaque:no-manifest,只有显式采信它才携带", async () => {
    const evals = [makeEval("e")];
    const prior = result({
      id: "e",
      attempt: 0,
      verdict: "passed",
      fingerprint: await fingerprintFor(evals[0]!, runWith({ flags: OLD_FLAGS })),
    });
    const run = runWith({ flags: NEW_FLAGS });

    // 差异算不出就是算不出:具名 selector 在这里不成立,授权它也不放行。
    const named = await planCarry(evals, [run], [prior], undefined, {
      accept: ["config:flags.endpoint"],
    });
    expect(named.carriedAttemptsByKey.get("exp|e")).toBeUndefined();
    expect(named.availableDeltas).toEqual([{ _tag: "Unknown", selector: "opaque:no-manifest" }]);

    // 明知旧结果仍然成立的人显式采信这条不透明差异 → 携带,并留下同一条留痕。
    const opaque = await planCarry(evals, [run], [prior], undefined, {
      accept: ["opaque:no-manifest"],
    });
    expect([...(opaque.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(opaque.carriedAcceptingByResult!.get(prior)).toEqual([
      { _tag: "Unknown", selector: "opaque:no-manifest" },
    ]);
  });

  it("缺清单但有 run.json 时配置面照常给具名差异,opaque 只盖源码面与数据面", async () => {
    const evals = [makeEval("e")];
    // 落盘只有 run.json 的那一半(experiment 快照),没有 manifests.json。
    const oldRun = runWith({ judge: { model: "gpt-5.6" } });
    const prior = result({
      id: "e",
      attempt: 0,
      verdict: "passed",
      fingerprint: await fingerprintFor(evals[0]!, oldRun),
      configHash: await configHashFor(evals[0]!, oldRun),
      agent: oldRun.agent.name,
      experiment: {
        ...DIRECT_RUN_INFO,
        flags: oldRun.flags,
        attempts: 1,
        earlyExit: false,
        selectedEvalIds: ["e"],
        judge: { model: "gpt-5.6" },
      },
    });
    const run = runWith({ judge: { model: "gpt-5.6-sol" } });

    const dry = await planCarry(evals, [run], [prior], undefined, {});
    expect(dry.availableDeltas.map((d) => d.selector)).toEqual(["config:judge.model", "opaque:no-manifest"]);
    expect(dry.dispatchByKey.get("exp|e")).toEqual([
      {
        gate: "fingerprint",
        reason: "stale",
        attempts: [0],
        comparison: { kind: "unexplained", reason: "manifest-missing" },
      },
    ]);

    // 源码面没变时,单独授权那条具名配置差异就够:反事实重算出的指纹与历史指纹相等,
    // 这份相等本身就证明清单看不见的那两面没变,不必再要人采信 opaque。
    const plan = await planCarry(evals, [run], [prior], undefined, {
      accept: ["config:judge.model"],
    });
    expect([...(plan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(plan.carriedAcceptingByResult!.get(prior)).toEqual([
      { _tag: "Changed", selector: "config:judge.model", from: "gpt-5.6", to: "gpt-5.6-sol" },
    ]);
  });

  it("缺清单且源码面也变了时,只授权配置差异不放行,连 opaque 一起授权才携带", async () => {
    // 上一轮的 eval 源码是另一份文件内容(指纹的源码面因此对不上本轮)。
    const oldEval = makeEval("e", {
      sourcePath: fileURLToPath(new URL("./manifest.ts", import.meta.url)),
    });
    const oldRun = runWith({ judge: { model: "gpt-5.6" } });
    const prior = result({
      id: "e",
      attempt: 0,
      verdict: "passed",
      fingerprint: await fingerprintFor(oldEval, oldRun),
      configHash: await configHashFor(oldEval, oldRun),
      agent: oldRun.agent.name,
      experiment: {
        ...DIRECT_RUN_INFO,
        flags: oldRun.flags,
        attempts: 1,
        earlyExit: false,
        selectedEvalIds: ["e"],
        judge: { model: "gpt-5.6" },
      },
    });
    const evals = [makeEval("e")]; // 本轮的 eval 源码已换过内容
    const run = runWith({ judge: { model: "gpt-5.6-sol" } });

    const configOnly = await planCarry(evals, [run], [prior], undefined, {
      accept: ["config:judge.model"],
    });
    expect(configOnly.carriedAttemptsByKey.get("exp|e")).toBeUndefined();

    const both = await planCarry(evals, [run], [prior], undefined, {
      accept: ["config:judge.model", "opaque:no-manifest"],
    });
    expect([...(both.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(both.carriedAcceptingByResult!.get(prior)!.map((d) => d.selector)).toEqual([
      "config:judge.model",
      "opaque:no-manifest",
    ]);
  });

  it("availableDeltas 列出本次计划里真实存在的差异,与授不授权无关(校验空转读它)", async () => {
    const evals = [makeEval("e")];
    const prior = await priorFrom(evals[0]!, runWith({ flags: OLD_FLAGS }));
    const run = runWith({ flags: NEW_FLAGS });

    const before = await planCarry(evals, [run], [prior], undefined, { priorManifests });
    expect(before.availableDeltas.map((d) => d.selector)).toEqual(["config:flags.endpoint"]);

    // 授权成功之后同一条差异照样在表里——否则「授权一次之后再跑就说这个 selector 空转」。
    const after = await planCarry(evals, [run], [prior], undefined, {
      accept: ["config:flags.endpoint"],
      priorManifests,
    });
    expect(after.availableDeltas.map((d) => d.selector)).toEqual(["config:flags.endpoint"]);
  });

  it("--accept 只打开指纹门；终态 / 资格 / 留存模式的拦截不受授权影响", async () => {
    const evals = [makeEval("e")];
    const oldRun = runWith({ flags: OLD_FLAGS });
    const newRun = runWith({ flags: NEW_FLAGS, timeoutMs: 600_000 });
    const accept = { accept: ["config:flags.endpoint"], priorManifests };

    // 终态门:errored 的那条即使配置差异被授权也不携带。
    const errored = await priorFrom(evals[0]!, oldRun, { verdict: "errored" });
    expect((await planCarry(evals, [newRun], [errored], undefined, accept))
      .carriedAttemptsByKey.get("exp|e")).toBeUndefined();

    // 资格门:执行耗时超过当前上限。
    const slow = await priorFrom(evals[0]!, oldRun, { durationMs: 19 * 60_000, executionMs: 19 * 60_000 });
    expect((await planCarry(evals, [newRun], [slow], undefined, accept))
      .carriedAttemptsByKey.get("exp|e")).toBeUndefined();

    // sandbox reuse 是执行策略，不是结果携带的出身门。
    const reused = await priorFrom(evals[0]!, oldRun, { sandbox: { provider: "docker", sandboxId: "s1", reused: true } });
    expect([...(await planCarry(evals, [newRun], [reused], undefined, accept))
      .carriedAttemptsByKey.get("exp|e") ?? []]).toEqual([0]);

    // 当前 sandboxReuse 同样不改变结果携带资格；留存现场仍必须真实执行。
    const fine = await priorFrom(evals[0]!, oldRun);
    const fineManifest = priorManifests.get("exp|e");
    const reuseRun = runWith({ flags: NEW_FLAGS, sandboxReuse: true });
    const reusedFine = await priorFrom(evals[0]!, runWith({ flags: OLD_FLAGS, sandboxReuse: true }));
    expect([...(await planCarry(evals, [reuseRun], [reusedFine], undefined, accept))
      .carriedAttemptsByKey.get("exp|e") ?? []]).toEqual([0]);
    expect((await planCarry(evals, [runWith({ flags: NEW_FLAGS })], [fine], undefined, {
      ...accept,
      keepSandbox: "all",
    })).carriedAttemptsByKey.get("exp|e")).toBeUndefined();

    // 同一份 fixture 在默认模式下同样会被授权携入。
    // 上面的 sandboxReuse fixture 共用 key，恢复 fine 对应的历史 manifest，避免把
    // sandboxReuse 差异误算到这条普通 Experiment 的 --accept 结果上。
    if (fineManifest === undefined) throw new Error("expected fine manifest");
    priorManifests.set("exp|e", fineManifest);
    expect([...((await planCarry(evals, [runWith({ flags: NEW_FLAGS })], [fine], undefined, accept))
      .carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
  });
});

describe("planCarry · dispatch:逐条未携带原因按门分组", () => {
  it("每个未携带序号落在它卡住的那道门上,gate 与人读词同源", async () => {
    const evals = [makeEval("e")];
    const run = { ...makeRun("exp", ["e"], 4, 600_000), flags: { a: 1 } as globalThis.Record<string, number> };
    const fingerprint = await fingerprintFor(evals[0]!, run);

    const priorResults: EvalResult[] = [
      result({ id: "e", attempt: 0, verdict: "passed", fingerprint }), // 携带,不进 dispatch
      result({ id: "e", attempt: 1, verdict: "errored", fingerprint }), // 终态门
      result({ id: "e", attempt: 2, verdict: "passed", fingerprint: "stale-fp" }), // 指纹门
      // 序号 3 从未落盘 → missing
    ];

    const plan = await planCarry(evals, [run], priorResults);

    expect([...(plan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(plan.dispatchByKey.get("exp|e")).toEqual([
      { gate: "terminal", reason: "errored", attempts: [1] },
      // 这条 fixture 没有历史清单(手写的落盘),差异如实算不出。
      {
        gate: "fingerprint",
        reason: "stale",
        attempts: [2],
        comparison: { kind: "unexplained", reason: "manifest-missing" },
      },
      { gate: "missing", reason: "new", attempts: [3] },
    ]);
  });

  it("Sandbox pair 的 opaque command/lifecycle 不产生 blocker，仍按其它指纹输入携带", async () => {
    const opaqueCommand = async (): Promise<void> => {};
    const opaqueHook = async (): Promise<void> => {};
    const evalDef = makeEval("opaque", {
      sandbox: sandboxFactories.dockerImageSandbox({ image: `node@sha256:${"a".repeat(64)}` })
        .prepare(opaqueCommand)
        .setup(opaqueHook),
    });
    const run = makeSandboxRun("exp", ["opaque"], 1);
    const historical = await fingerprintWithManifestFor(evalDef, run);
    const historicalAgain = await fingerprintWithManifestFor(evalDef, run);

    // opaque marker 仍保留在 fingerprint/manifest projection，但不再触发 carry epoch。
    expect(historical.manifest).toEqual(historicalAgain.manifest);
    expect(historical.fingerprint).toBe(historicalAgain.fingerprint);

    const plan = await planCarry(
      [evalDef],
      [run],
      [result({ id: "opaque", attempt: 0, verdict: "passed", fingerprint: historical.fingerprint })],
      undefined,
      { priorManifests: new Map([["exp|opaque", historical.manifest]]) },
    );

    expect([...((plan.carriedAttemptsByKey.get("exp|opaque")) ?? [])]).toEqual([0]);
    expect(plan.dispatchByKey.get("exp|opaque")).toBeUndefined();

    const mixedRun = makeSandboxRun("exp", ["opaque"], 4);
    const mixedHistorical = await fingerprintWithManifestFor(evalDef, mixedRun);
    const mixedPlan = await planCarry(
      [evalDef],
      [mixedRun],
      [
        result({ id: "opaque", attempt: 0, verdict: "passed", fingerprint: mixedHistorical.fingerprint }),
        result({ id: "opaque", attempt: 1, verdict: "failed", fingerprint: mixedHistorical.fingerprint }),
        result({ id: "opaque", attempt: 2, verdict: "errored", fingerprint: mixedHistorical.fingerprint }),
        result({ id: "opaque", attempt: 3, verdict: "skipped", fingerprint: mixedHistorical.fingerprint }),
      ],
      undefined,
      { priorManifests: new Map([["exp|opaque", mixedHistorical.manifest]]) },
    );
    expect([...((mixedPlan.carriedAttemptsByKey.get("exp|opaque")) ?? [])]).toEqual([0, 1]);
    // carryGateFor 的既有 terminal 词表把 errored/skipped 都归为 terminal/errored。
    expect(mixedPlan.dispatchByKey.get("exp|opaque")).toMatchObject([
      { gate: "terminal", reason: "errored", attempts: [2, 3] },
    ]);
  });

  it("只迁移 v0 opaque carryEpoch 到当前确定性指纹并保存来源", async () => {
    const opaqueCommand = async (): Promise<void> => {};
    const evalDef = makeEval("opaque", {
      sandbox: sandboxFactories.dockerImageSandbox({ image: `node@sha256:${"a".repeat(64)}` })
        .prepare(opaqueCommand),
    });
    const run = makeSandboxRun("exp", ["opaque"], 1);
    const current = await fingerprintWithManifestFor(evalDef, run);
    const legacyManifest: EvalManifest = {
      ...current.manifest,
      algorithmVersion: 0,
      coverageVersion: 0,
    };
    const prior = result({ id: "opaque", attempt: 0, verdict: "passed", fingerprint: "legacy-opaque-fingerprint" });

    const plan = await planCarry([evalDef], [run], [prior], undefined, {
      priorManifests: new Map([["exp|opaque", legacyManifest]]),
    });

    expect([...((plan.carriedAttemptsByKey.get("exp|opaque")) ?? [])]).toEqual([0]);
    expect(plan.dispatchByKey.get("exp|opaque")).toBeUndefined();
    expect(plan.migratedFromByResult?.get(prior)).toEqual({
      kind: "opaque-carry-epoch",
      fingerprint: "legacy-opaque-fingerprint",
      algorithmVersion: 0,
      coverageVersion: 0,
    });
  });

  it("其它 v0 manifest 即使等价也不自动放行", async () => {
    const evalDef = makeEval("e");
    const run = makeRun("exp", ["e"], 1);
    const current = await fingerprintWithManifestFor(evalDef, run);
    const legacyManifest: EvalManifest = {
      ...current.manifest,
      algorithmVersion: 0,
      coverageVersion: 0,
    };
    const prior = result({ id: "e", attempt: 0, verdict: "passed", fingerprint: "legacy-v0-fingerprint" });

    const plan = await planCarry([evalDef], [run], [prior], undefined, {
      priorManifests: new Map([["exp|e", legacyManifest]]),
    });

    expect(plan.carriedAttemptsByKey.get("exp|e")).toBeUndefined();
    expect(plan.migratedFromByResult?.get(prior)).toBeUndefined();
    expect(plan.dispatchByKey.get("exp|e")).toEqual([
      {
        gate: "fingerprint",
        reason: "stale",
        attempts: [0],
        comparison: {
          kind: "unexplained",
          reason: "fingerprint-version-changed",
          fromVersion: 0,
          toVersion: FINGERPRINT_ALGORITHM_VERSION,
        },
      },
    ]);
  });

  it("有历史但格式读不动的坐标标 incompatible,不与真没跑过的 new 混为一谈", async () => {
    const evals = [makeEval("e"), makeEval("f")];
    const run = makeRun("exp", ["e", "f"], 1, 600_000);
    // e 的历史躺在一份 schemaVersion 不同的快照里(读不进 priorResults,但盘上有);f 从没跑过。
    const plan = await planCarry(evals, [run], [], undefined, {
      incompatibleKeys: new Set(["exp|e"]),
    });

    expect(plan.dispatchByKey.get("exp|e")).toEqual([{ gate: "missing", reason: "incompatible", attempts: [0] }]);
    expect(plan.dispatchByKey.get("exp|f")).toEqual([{ gate: "missing", reason: "new", attempts: [0] }]);
  });

  it("指纹门的分组带上可复制进 --accept 的差异明细", async () => {
    const evals = [makeEval("e")];
    const base = makeRun("exp", ["e"], 1);
    const oldRun: AgentRun = { ...base, flags: { endpoint: "https://old.example" } };
    const run: AgentRun = { ...base, flags: {} };
    const old = await fingerprintWithManifestFor(evals[0]!, oldRun);
    const prior = result({
      id: "e",
      attempt: 0,
      verdict: "passed",
      fingerprint: old.fingerprint,
      configHash: await configHashFor(evals[0]!, oldRun),
      agent: base.agent.name,
      experiment: { ...DIRECT_RUN_INFO, flags: oldRun.flags, attempts: 1, earlyExit: false, selectedEvalIds: ["e"] },
    });

    const plan = await planCarry(evals, [run], [prior], undefined, {
      priorManifests: new Map([["exp|e", old.manifest]]),
    });

    expect(plan.dispatchByKey.get("exp|e")).toEqual([
      {
        gate: "fingerprint",
        reason: "stale",
        attempts: [0],
        comparison: {
          kind: "changed",
          deltas: [{ _tag: "Removed", selector: "config:flags.endpoint", from: "https://old.example" }],
        },
      },
    ]);
  });

  it("全部携带的行不出现在 dispatch 表里", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 1);
    const fingerprint = await fingerprintFor(evals[0]!, run);

    const plan = await planCarry(evals, [run], [result({ id: "e", attempt: 0, verdict: "passed", fingerprint })]);

    expect(plan.dispatchByKey.get("exp|e")).toBeUndefined();
  });

  it("--rerun failed 下失败项落口径门,passed 照常携带", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 2);
    const fingerprint = await fingerprintFor(evals[0]!, run);

    const plan = await planCarry(
      evals,
      [run],
      [
        result({ id: "e", attempt: 0, verdict: "passed", fingerprint }),
        result({ id: "e", attempt: 1, verdict: "failed", fingerprint }),
      ],
      undefined,
      { rerun: "failed" },
    );

    expect([...(plan.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(plan.dispatchByKey.get("exp|e")).toEqual([{ gate: "rerun", reason: "rerun", attempts: [1] }]);
  });
});

describe("非 TTY 下不带值的 --accept:报错列出本次可授权的原因", () => {
  it("报错文案带上 availableDeltas 的枚举,两个语言都给得出「这次能填什么」", async () => {
    const evals = [makeEval("e")];
    const base = makeRun("exp", ["e"], 1);
    const oldRun: AgentRun = { ...base, flags: { endpoint: "https://old.example" } };
    const run: AgentRun = { ...base, flags: {} };
    const old = await fingerprintWithManifestFor(evals[0]!, oldRun);
    const prior = result({
      id: "e",
      attempt: 0,
      verdict: "passed",
      fingerprint: old.fingerprint,
      configHash: await configHashFor(evals[0]!, oldRun),
      agent: base.agent.name,
      experiment: { ...DIRECT_RUN_INFO, flags: oldRun.flags, attempts: 1, earlyExit: false, selectedEvalIds: ["e"] },
    });

    const plan = await planCarry(evals, [run], [prior], undefined, {
      priorManifests: new Map([["exp|e", old.manifest]]),
    });
    // cli.ts 拼这条错误用的就是这份枚举(与 selector 空转报错同源)。
    const available = plan.availableDeltas.map((delta) => delta.selector).join(", ");
    expect(available).toBe("config:flags.endpoint");

    for (const dict of [en, zhCN]) {
      const text = interpolate(dict["cli.flag.acceptNeedsSelector"], { available });
      expect(text).toContain("config:flags.endpoint"); // 光说「必须带 selector」还要人再跑一趟 --dry
      expect(text).toContain("--accept");
    }
  });
});

describe("planCarry · manifest 相减:配置面之外的源码面与数据面", () => {
  /** 历史侧的清单 = 本次清单换掉某一项:模拟「那一轮之后这个文件改了 / 加了 / 删了」。 */
  function mutated(manifest: EvalManifest, over: Partial<EvalManifest>): EvalManifest {
    return { ...manifest, ...over };
  }

  it("升级前 manifest 没有 pair plan 时保守报告物理计划差异，不把旧清单丢掉", async () => {
    const evalDef = makeEval("e");
    const run = makeRun("exp", ["e"], 1);
    const { manifest } = await fingerprintWithManifestFor(evalDef, run);
    const historical = { ...manifest, plan: undefined };
    const deltas = manifestDeltas(historical, manifest);
    expect(deltas.map((delta) => delta.selector)).toEqual(["plan:physical"]);
    expect(deltas[0]).not.toHaveProperty("from");
    expect(deltas[0]?.to).toBeDefined();
  });

  it("源码面单文件的内容差异给 source:<路径>,授权它才携带", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 1);
    const { manifest } = await fingerprintWithManifestFor(evals[0]!, run);
    const [path] = Object.keys(manifest.source);
    const historical = mutated(manifest, { source: { ...manifest.source, [path!]: "a".repeat(64) } });
    const prior = result({ id: "e", attempt: 0, verdict: "passed", fingerprint: "fp-from-old-source" });
    const priorManifests = new Map([["exp|e", historical]]);

    const plan = await planCarry(evals, [run], [prior], undefined, { priorManifests });
    expect(plan.availableDeltas).toEqual([
      {
        _tag: "Changed",
        selector: `source:${path}`,
        from: "aaaaaaaaaaaa",
        to: manifest.source[path!]!.slice(0, 12),
      },
    ]);
    expect(plan.carriedAttemptsByKey.get("exp|e")).toBeUndefined();

    const accepted = await planCarry(evals, [run], [prior], undefined, {
      priorManifests,
      accept: [`source:${path}`],
    });
    expect([...(accepted.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
    expect(accepted.carriedAcceptingByResult!.get(prior)!.map((d) => d.selector)).toEqual([`source:${path}`]);
  });

  it("数据面文件的增删各是一条差异;只授权其中一条时仍照旧重跑", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 1);
    const { manifest } = await fingerprintWithManifestFor(evals[0]!, run);
    // 历史那一轮有一个数据文件,本轮没有;同时本轮多了一个——两条差异,方向相反。
    const historical = mutated(manifest, { data: { "evals/data/cases.yaml": "b".repeat(64) } });
    const current = { ...manifest, data: { "evals/data/rows.yaml": "c".repeat(64) } };
    const prior = result({ id: "e", attempt: 0, verdict: "passed", fingerprint: "fp-from-old-data" });
    const priorManifests = new Map([["exp|e", historical]]);
    // 本次清单由 planCarry 自己算,这里只需要「本轮没有那个文件」这一半;另一半用 manifestDeltas 直接验。
    expect(manifestDeltas(historical, current).map((d) => d.selector)).toEqual([
      "data:evals/data/cases.yaml",
      "data:evals/data/rows.yaml",
    ]);

    const plan = await planCarry(evals, [run], [prior], undefined, { priorManifests });
    expect(plan.availableDeltas).toEqual([{
      _tag: "Removed",
      selector: "data:evals/data/cases.yaml",
      from: "bbbbbbbbbbbb",
    }]);

    // 只授权一条(这里 fixture 只有一条,所以授权它就携带);换成不相干的 selector 则照旧重跑。
    const partial = await planCarry(evals, [run], [prior], undefined, {
      priorManifests,
      accept: ["data:evals/data/rows.yaml"],
    });
    expect(partial.carriedAttemptsByKey.get("exp|e")).toBeUndefined();

    const accepted = await planCarry(evals, [run], [prior], undefined, {
      priorManifests,
      accept: ["data:evals/data/cases.yaml"],
    });
    expect([...(accepted.carriedAttemptsByKey.get("exp|e") ?? [])]).toEqual([0]);
  });

  it("清单与指纹同一份输入:源码面逐文件给出「路径 × 内容哈希」", async () => {
    const evals = [makeEval("e")];
    const run = makeRun("exp", ["e"], 1);
    const { manifest } = await fingerprintWithManifestFor(evals[0]!, run);

    // 配置面的键就是 --accept config:<路径> 里那个路径。
    expect(manifest.config).toMatchObject({ agent: "agent-exp", sandboxReuse: false, strict: false });
    // 源码面含 eval 文件自己,值是 64 位十六进制内容哈希(不是内容)。
    const entries = Object.entries(manifest.source);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, hash] of entries) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
