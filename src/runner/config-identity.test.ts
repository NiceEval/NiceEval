// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「超时、缓存与指纹」:配置身份的字段级投影——哈希输入本身、字段路径怎样比对出具名差异、
// 授权跨过一条差异时的反事实身份怎样只动被点名的那些字段。
// 判据面是「哪些路径算差异 / 换回历史值之后的身份长什么样」,不是某个中间函数的返回值形状。

import { Effect } from "effect";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { defineAgent, defineEval } from "../define.ts";
import {
  configDeltas,
  configIdentityForRun,
  configIdentityFromResult,
  counterfactualConfigIdentity,
} from "./config-identity.ts";
import { computeConfigHash } from "./fingerprint.ts";
import { prepareRunSandboxes, type PreparedRunPair } from "./sandbox-selection.ts";
import { discoverEval, type AgentRun } from "./types.ts";
import type { EvalResult } from "../types.ts";
import type { ConfigFieldDelta, ConfigIdentity } from "./config-identity.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";

const DIRECT_RUN_INFO = {
  sandboxLayer: { kind: "direct" },
  sandboxPlansByEval: {},
  agentInstalls: [],
};

function makeRun(over: Partial<AgentRun> = {}): AgentRun {
  return {
    agent: defineAgent({
      name: "codex",
      evidenceCoverage: completeEvidenceCoverage,
      send: async () => ({ events: [], status: "completed" }),
    }),
    flags: {},
    attempts: 1,
    earlyExit: false,
    selectedEvalIds: ["e"],
    experimentId: "exp",
    experimentBaseDir: "/project",
    experimentSourcePath: "/project/experiments/exp.ts",
    ...over,
  };
}

function makeResult(over: Partial<EvalResult> = {}): EvalResult {
  return {
    id: "e",
    experimentId: "exp",
    agent: "codex",
    verdict: "passed",
    attempt: 0,
    durationMs: 1,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
    experiment: { ...DIRECT_RUN_INFO, attempts: 1, earlyExit: false, flags: {} },
    ...over,
  };
}

const evalDef = discoverEval(defineEval({ test() {} }), {
  id: "e",
  baseDir: "/project/evals/e",
  sourcePath: fileURLToPath(import.meta.url),
  loaderDataPaths: [],
  criteriaPaths: [],
  privatePaths: [],
  source: { path: "src/runner/config-identity.test.ts", content: "", sha256: "0".repeat(64) },
});

if (false) {
  // @ts-expect-error Added 只有新值，不能同时伪造历史值。
  const contradictoryAdded: ConfigFieldDelta = { _tag: "Added", selector: "config:model", from: "a", to: "b" };
  // @ts-expect-error Removed 必须带历史值。
  const incompleteRemoved: ConfigFieldDelta = { _tag: "Removed", selector: "config:model" };
  void contradictoryAdded;
  void incompleteRemoved;
}

async function prepared(run: AgentRun): Promise<PreparedRunPair> {
  const [pair] = await Effect.runPromise(prepareRunSandboxes([evalDef], [run]));
  if (pair === undefined) throw new Error("expected one prepared run pair");
  return pair;
}

async function identityFor(run: AgentRun, judge = run.judge): Promise<ConfigIdentity> {
  const pair = await prepared(run);
  return configIdentityForRun(run, pair.plan, judge);
}

async function configHashFor(run: AgentRun): Promise<string> {
  return computeConfigHash(await prepared(run));
}

describe("configIdentityForRun:就是 configHash 的哈希输入", () => {
  it("身份相同则 configHash 相同,任一进哈希的字段变了就换一个哈希", async () => {
    const base = makeRun({ flags: { webSearch: true }, model: "opus" });
    expect(await configHashFor(makeRun({ flags: { webSearch: true }, model: "opus" }))).toBe(await configHashFor(base));
    expect(await configHashFor(makeRun({ flags: { webSearch: false }, model: "opus" }))).not.toBe(await configHashFor(base));
    // labels / attempts 一类不进身份的字段不出现在投影里,自然也改不动哈希。
    expect(await configHashFor(makeRun({ flags: { webSearch: true }, model: "opus", attempts: 5 }))).toBe(
      await configHashFor(base),
    );
  });

  it("省略的可选字段有确定缺省:sandboxReuse / strict 省略等价于 false", async () => {
    expect(await identityFor(makeRun())).toMatchObject({ sandboxReuse: false, strict: false });
    expect(await configHashFor(makeRun())).toBe(await configHashFor(makeRun({ sandboxReuse: false, strict: false })));
  });

  it("Judge identity 包含解析后的 model/baseUrl/timeoutMs，但不包含凭据选择器", async () => {
    const first = await identityFor(makeRun(), {
      model: "judge-a",
      baseUrl: "https://judge.example/v1",
      apiKeyEnv: "KEY_A",
      timeoutMs: 90_000,
    });
    const second = await identityFor(makeRun(), {
      model: "judge-a",
      baseUrl: "https://judge.example/v1",
      apiKeyEnv: "KEY_B",
      timeoutMs: 90_000,
    });
    expect(first.judge).toEqual({
      _tag: "Configured",
      model: { _tag: "Configured", value: "judge-a" },
      baseUrl: { _tag: "Configured", value: "https://judge.example/v1" },
      timeoutMs: { _tag: "Configured", value: 90_000 },
    });
    expect(first).toEqual(second);
    expect(configDeltas(first, await identityFor(makeRun(), {
      model: "judge-a",
      baseUrl: "https://judge.example/v1",
      timeoutMs: 120_000,
    }))).toEqual([{
      _tag: "Changed",
      selector: "config:judge.timeoutMs",
      from: "90000",
      to: "120000",
    }]);
  });
});

describe("configDeltas:哈希回答不了「哪里变了」,字段路径回答", () => {
  it("嵌套字段用点路径,flags 逐键比对,键的增删同样是一条差异", async () => {
    const historical = configIdentityFromResult(
      makeResult({
        model: "opus",
        experiment: {
          ...DIRECT_RUN_INFO,
          attempts: 1,
          earlyExit: false,
          flags: { webSearch: true, endpoint: "https://old" },
          judge: { model: "gpt-5.6" },
        },
      }),
    )!;
    const current = await identityFor(
      makeRun({ model: "sonnet", flags: { webSearch: true, region: "eu" }, judge: { model: "gpt-5.6-sol" } }),
    );

    expect(configDeltas(historical, current)).toEqual([
      { _tag: "Removed", selector: "config:flags.endpoint", from: "https://old" },
      { _tag: "Added", selector: "config:flags.region", to: "eu" },
      { _tag: "Changed", selector: "config:judge.model", from: "gpt-5.6", to: "gpt-5.6-sol" },
      { _tag: "Changed", selector: "config:model", from: "opus", to: "sonnet" },
    ]);
  });

  it("落盘缺 ExperimentRunInfo 时配置面无从重建,差异算不出", () => {
    expect(configIdentityFromResult(makeResult({ experiment: undefined }))).toBeUndefined();
  });

  it("差异值是完整值,不做 80 字符截断——独立截断会把两侧压成同一份省略串", async () => {
    // bug: memory/config-delta-value-truncated-before-diff.md
    const sharedPrefix = "x".repeat(90);
    const from = `${sharedPrefix}-old-value`;
    const to = `${sharedPrefix}-new-value`;
    const historical = configIdentityFromResult(
      makeResult({
        model: "opus",
        experiment: {
          ...DIRECT_RUN_INFO,
          attempts: 1,
          earlyExit: false,
          flags: { endpoint: from },
        },
      }),
    )!;
    const current = await identityFor(makeRun({ model: "opus", flags: { endpoint: to } }));

    const [delta] = configDeltas(historical, current).filter((d) => d.selector === "config:flags.endpoint");
    expect(delta?.from).toBe(from);
    expect(delta?.to).toBe(to);
    expect(delta?.from).not.toBe(delta?.to); // 旧的 80 字符截断在这一格会红:两侧都截在差异点之前
  });
});

describe("counterfactualConfigIdentity:只动被点名的字段", () => {
  let historical: ConfigIdentity;
  let current: ConfigIdentity;

  beforeAll(async () => {
    historical = configIdentityFromResult(
      makeResult({
        model: "opus",
        experiment: {
          ...DIRECT_RUN_INFO,
          attempts: 1,
          earlyExit: false,
          flags: { endpoint: "https://old" },
          judge: { model: "gpt-5.6", baseUrl: "https://old-gw" },
        },
      }),
    )!;
    current = await identityFor(
      makeRun({ model: "sonnet", flags: {}, judge: { model: "gpt-5.6-sol", baseUrl: "https://new-gw" } }),
    );
  });

  it("授权 config:flags.<key> 把该键换回历史值,没点名的字段保持本次值", () => {
    const rolled = counterfactualConfigIdentity(current, historical, new Set(["config:flags.endpoint"]));
    expect(rolled.flags).toEqual({ endpoint: "https://old" });
    expect(rolled.model).toEqual({ _tag: "Configured", value: "sonnet" });
    expect(rolled.judge).toEqual({
      _tag: "Configured",
      model: { _tag: "Configured", value: "gpt-5.6-sol" },
      baseUrl: { _tag: "Configured", value: "https://new-gw" },
      timeoutMs: { _tag: "Omitted" },
    });
  });

  it("整对象进哈希的分组要每条差异都被授权才整体换回,少一条就保持本次值", () => {
    const partial = counterfactualConfigIdentity(current, historical, new Set(["config:judge.model"]));
    expect(partial.judge).toEqual({
      _tag: "Configured",
      model: { _tag: "Configured", value: "gpt-5.6-sol" },
      baseUrl: { _tag: "Configured", value: "https://new-gw" },
      timeoutMs: { _tag: "Omitted" },
    });

    const full = counterfactualConfigIdentity(
      current,
      historical,
      new Set(["config:judge.model", "config:judge.baseUrl"]),
    );
    expect(full.judge).toEqual({
      _tag: "Configured",
      model: { _tag: "Configured", value: "gpt-5.6" },
      baseUrl: { _tag: "Configured", value: "https://old-gw" },
      timeoutMs: { _tag: "Omitted" },
    });
  });

  it("全部差异都被授权时,反事实身份与历史身份再无差异——「相等本身就是证明」的那一步", () => {
    const all = new Set(configDeltas(historical, current).map((delta) => delta.selector));
    expect(configDeltas(historical, counterfactualConfigIdentity(current, historical, all))).toEqual([]);
  });

  it("本次、历史与反事实身份都是深冻结快照", () => {
    const counterfactual = counterfactualConfigIdentity(
      current,
      historical,
      new Set(["config:flags.endpoint"]),
    );
    for (const identity of [historical, current, counterfactual]) {
      expect(Object.isFrozen(identity)).toBe(true);
      expect(Object.isFrozen(identity.flags)).toBe(true);
      expect(Object.isFrozen(identity.agentInstalls)).toBe(true);
      expect(Object.isFrozen(identity.judge)).toBe(true);
    }
  });
});
