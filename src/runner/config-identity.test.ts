// cases: docs/engineering/testing/unit/experiments-runner.md
// 分区「超时、缓存与指纹」:配置身份的字段级投影——哈希输入本身、字段路径怎样比对出具名差异、
// 授权跨过一条差异时的反事实身份怎样只动被点名的那些字段。
// 判据面是「哪些路径算差异 / 换回历史值之后的身份长什么样」,不是某个中间函数的返回值形状。

import { describe, expect, it } from "vitest";
import { defineDirectAgent } from "../define.ts";
import { configDeltas, configIdentityForRun, configIdentityFromResult, rollBackAccepted } from "./config-identity.ts";
import { computeConfigHash } from "./fingerprint.ts";
import type { AgentRun } from "./types.ts";
import type { EvalResult } from "../types.ts";

function makeRun(over: Partial<AgentRun> = {}): AgentRun {
  return {
    agent: defineDirectAgent({ name: "codex", send: async () => ({ events: [], status: "completed" }) }),
    flags: {},
    attempts: 1,
    earlyExit: false,
    selectedEvalIds: ["e"],
    experimentId: "exp",
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
    experiment: { attempts: 1, earlyExit: false, selectedEvalIds: ["e"], flags: {} },
    ...over,
  };
}

describe("configIdentityForRun:就是 configHash 的哈希输入", () => {
  it("身份相同则 configHash 相同,任一进哈希的字段变了就换一个哈希", () => {
    const base = makeRun({ flags: { webSearch: true }, model: "opus" });
    expect(computeConfigHash(makeRun({ flags: { webSearch: true }, model: "opus" }))).toBe(computeConfigHash(base));
    expect(computeConfigHash(makeRun({ flags: { webSearch: false }, model: "opus" }))).not.toBe(computeConfigHash(base));
    // labels / attempts 一类不进身份的字段不出现在投影里,自然也改不动哈希。
    expect(computeConfigHash(makeRun({ flags: { webSearch: true }, model: "opus", attempts: 5 }))).toBe(
      computeConfigHash(base),
    );
  });

  it("省略的可选字段有确定缺省:sandboxReuse / strict 省略等价于 false", () => {
    expect(configIdentityForRun(makeRun())).toMatchObject({ sandboxReuse: false, strict: false });
    expect(computeConfigHash(makeRun())).toBe(computeConfigHash(makeRun({ sandboxReuse: false, strict: false })));
  });

  it("Judge identity 包含解析后的 model/baseUrl/timeoutMs，但不包含凭据选择器", () => {
    const first = configIdentityForRun(makeRun(), undefined, {
      model: "judge-a",
      baseUrl: "https://judge.example/v1",
      apiKeyEnv: "KEY_A",
      timeoutMs: 90_000,
    });
    const second = configIdentityForRun(makeRun(), undefined, {
      model: "judge-a",
      baseUrl: "https://judge.example/v1",
      apiKeyEnv: "KEY_B",
      timeoutMs: 90_000,
    });
    expect(first.judge).toEqual({
      model: "judge-a",
      baseUrl: "https://judge.example/v1",
      timeoutMs: 90_000,
    });
    expect(first).toEqual(second);
    expect(configDeltas(first, configIdentityForRun(makeRun(), undefined, {
      model: "judge-a",
      baseUrl: "https://judge.example/v1",
      timeoutMs: 120_000,
    }))).toEqual([{ selector: "config:judge.timeoutMs", from: "90000", to: "120000" }]);
  });
});

describe("configDeltas:哈希回答不了「哪里变了」,字段路径回答", () => {
  it("嵌套字段用点路径,flags 逐键比对,键的增删同样是一条差异", () => {
    const historical = configIdentityFromResult(
      makeResult({
        model: "opus",
        experiment: {
          attempts: 1,
          earlyExit: false,
          selectedEvalIds: ["e"],
          flags: { webSearch: true, endpoint: "https://old" },
          judge: { model: "gpt-5.6" },
        },
      }),
    )!;
    const current = configIdentityForRun(
      makeRun({ model: "sonnet", flags: { webSearch: true, region: "eu" }, judge: { model: "gpt-5.6-sol" } }),
    );

    expect(configDeltas(historical, current)).toEqual([
      { selector: "config:flags.endpoint", from: "https://old" },
      { selector: "config:flags.region", to: "eu" },
      { selector: "config:judge.model", from: "gpt-5.6", to: "gpt-5.6-sol" },
      { selector: "config:model", from: "opus", to: "sonnet" },
    ]);
  });

  it("落盘缺 ExperimentRunInfo 时配置面无从重建,差异算不出", () => {
    expect(configIdentityFromResult(makeResult({ experiment: undefined }))).toBeUndefined();
  });
});

describe("rollBackAccepted:只动被点名的字段", () => {
  const historical = configIdentityFromResult(
    makeResult({
      model: "opus",
      experiment: {
        attempts: 1,
        earlyExit: false,
        selectedEvalIds: ["e"],
        flags: { endpoint: "https://old" },
        judge: { model: "gpt-5.6", baseUrl: "https://old-gw" },
      },
    }),
  )!;
  const current = configIdentityForRun(
    makeRun({ model: "sonnet", flags: {}, judge: { model: "gpt-5.6-sol", baseUrl: "https://new-gw" } }),
  );

  it("授权 config:flags.<key> 把该键换回历史值,没点名的字段保持本次值", () => {
    const rolled = rollBackAccepted(current, historical, new Set(["config:flags.endpoint"]));
    expect(rolled.flags).toEqual({ endpoint: "https://old" });
    expect(rolled.model).toBe("sonnet");
    expect(rolled.judge).toEqual({ model: "gpt-5.6-sol", baseUrl: "https://new-gw" });
  });

  it("整对象进哈希的分组要每条差异都被授权才整体换回,少一条就保持本次值", () => {
    const partial = rollBackAccepted(current, historical, new Set(["config:judge.model"]));
    expect(partial.judge).toEqual({ model: "gpt-5.6-sol", baseUrl: "https://new-gw" });

    const full = rollBackAccepted(current, historical, new Set(["config:judge.model", "config:judge.baseUrl"]));
    expect(full.judge).toEqual({ model: "gpt-5.6", baseUrl: "https://old-gw" });
  });

  it("全部差异都被授权时,反事实身份与历史身份再无差异——「相等本身就是证明」的那一步", () => {
    const all = new Set(configDeltas(historical, current).map((delta) => delta.selector));
    expect(configDeltas(historical, rollBackAccepted(current, historical, all))).toEqual([]);
  });
});
