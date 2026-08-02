// cases: docs/engineering/testing/unit/experiments-runner.md
// 纯选题边界:EvalDescriptor 投影 + resolveExperimentEvals 求值(定稿见
// docs/feature/eval/library.md「EvalDescriptor」、docs/feature/experiments/library.md「evals」)。

import { describe, expect, it } from "vitest";
import { evalDescriptorOf, resolveExperimentEvals, selectedEvalsForRun, splitByScoring } from "./eval-selection.ts";
import { defineEval, defineScoreEval } from "../define.ts";
import { discoverEval, type DiscoveredEval, type EvalScoring } from "./types.ts";
import type { JsonValue } from "../shared/types.ts";

const source = { path: "evals/fake.eval.ts", content: "export default { test() {} };\n", sha256: "fake" };

function makeEval(id: string, overrides: {
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly scoring?: EvalScoring;
} = {}): DiscoveredEval {
  const input = {
    ...(overrides.description !== undefined ? { description: overrides.description } : {}),
    ...(overrides.tags !== undefined ? { tags: [...overrides.tags] } : {}),
    ...(overrides.metadata !== undefined ? { metadata: { ...overrides.metadata } } : {}),
    test() {},
  };
  const definition = overrides.scoring === "points" ? defineScoreEval(input) : defineEval(input);
  return discoverEval(definition, {
    id,
    baseDir: "/project/evals",
    sourcePath: `/project/evals/${id}.eval.ts`,
    source,
    loaderDataPaths: Object.freeze([]),
    criteriaPaths: Object.freeze([]),
    privatePaths: Object.freeze([]),
  });
}

describe("evalDescriptorOf", () => {
  it("显式白名单投影:不暴露 sourcePath / baseDir / test 等内部字段", () => {
    const evalDef = makeEval("coding/fix-button", {
      description: "fix the button",
      tags: ["coding", "frontend"],
      metadata: { owner: "team-a" },
    });
    const descriptor = evalDescriptorOf(evalDef);
    expect(descriptor).toEqual({
      id: "coding/fix-button",
      description: "fix the button",
      tags: ["coding", "frontend"],
      scoring: "pass",
      metadata: { owner: "team-a" },
    });
    expect(descriptor).not.toHaveProperty("sourcePath");
    expect(descriptor).not.toHaveProperty("baseDir");
    expect(descriptor).not.toHaveProperty("source");
    expect(descriptor).not.toHaveProperty("test");
  });

  it("未声明 tags 得到只读空数组;冻结,mutation 不影响下一次读取", () => {
    const evalDef = makeEval("bare/eval");
    const d1 = evalDescriptorOf(evalDef);
    expect(d1.tags).toEqual([]);
    expect(Object.isFrozen(d1)).toBe(true);
    expect(Object.isFrozen(d1.tags)).toBe(true);

    // 每次投影都是新对象,一次调用拿到的引用被 mutate(TS 层本应拒绝,这里模拟无类型 JS)
    // 不会影响下一次对同一 evalDef 的投影。
    const mutable = d1 as unknown as { tags: string[] };
    expect(() => mutable.tags.push("x")).toThrow(); // 冻结数组:push 直接抛错
    const d2 = evalDescriptorOf(evalDef);
    expect(d2.tags).toEqual([]);
  });
});

describe("resolveExperimentEvals", () => {
  const codingFixButton = makeEval("coding/fix-button", { tags: ["coding", "frontend"] });
  const researchGpu = makeEval("research/gpu-literature", { tags: ["research", "gpu"] });
  const evals = [codingFixButton, researchGpu];

  it("谓词同时可读 id / tags / metadata,只命中匹配的 eval", () => {
    const { selectedEvalIds } = resolveExperimentEvals({
      experimentId: "exp/coding-only",
      selector: (e) => e.id.startsWith("coding/") && e.tags.includes("coding") && !e.tags.includes("gpu"),
      cliPatterns: [],
      evals,
    });
    expect(selectedEvalIds).toEqual(["coding/fix-button"]);
  });

  it("selectorEvals 是未经 CLI 前缀收窄的发现集:交集为空时仍分得清「前缀写错」与「实验没选中任何 eval」", () => {
    // 前缀写错:实验本身选中了两条,交集才是空的 —— CLI 据此报「前缀零匹配」。
    const typo = resolveExperimentEvals({ experimentId: "e", selector: "*", cliPatterns: ["compare/gpt"], evals });
    expect(typo.selectedEvalIds).toEqual([]);
    expect(typo.selectorEvals.map((e) => e.id)).toEqual(["coding/fix-button", "research/gpu-literature"]);

    // 实验自己就没选中任何 eval:两个集合都空,不该被报成前缀的错。
    const empty = resolveExperimentEvals({ experimentId: "e", selector: () => false, cliPatterns: ["coding/"], evals });
    expect(empty.selectedEvalIds).toEqual([]);
    expect(empty.selectorEvals).toEqual([]);
  });

  it('"*" 或省略 selector 全选;数组按裸前缀;CLI patterns 与 selector 取交集', () => {
    expect(
      resolveExperimentEvals({ experimentId: "e", selector: "*", cliPatterns: [], evals }).selectedEvalIds,
    ).toEqual(["coding/fix-button", "research/gpu-literature"]);
    expect(
      resolveExperimentEvals({ experimentId: "e", selector: undefined, cliPatterns: [], evals }).selectedEvalIds,
    ).toEqual(["coding/fix-button", "research/gpu-literature"]);
    expect(
      resolveExperimentEvals({ experimentId: "e", selector: ["coding/"], cliPatterns: [], evals }).selectedEvalIds,
    ).toEqual(["coding/fix-button"]);
    // selector 选中两条,CLI 追加前缀再收窄到一条:两层是交集。
    expect(
      resolveExperimentEvals({ experimentId: "e", selector: "*", cliPatterns: ["research/"], evals }).selectedEvalIds,
    ).toEqual(["research/gpu-literature"]);
  });

  it("零命中时 selectedEvalIds 为空(不报错)", () => {
    const { selectedEvals, selectedEvalIds } = resolveExperimentEvals({
      experimentId: "e",
      selector: () => false,
      cliPatterns: [],
      evals,
    });
    expect(selectedEvals).toEqual([]);
    expect(selectedEvalIds).toEqual([]);
  });

  it("返回顺序 = discovery 稳定顺序,不随谓词命中顺序改变;id 去重", () => {
    const a = makeEval("z/a");
    const b = makeEval("a/b");
    const { selectedEvalIds } = resolveExperimentEvals({
      experimentId: "e",
      selector: "*",
      cliPatterns: [],
      evals: [a, b],
    });
    expect(selectedEvalIds).toEqual(["z/a", "a/b"]); // discovery 顺序,不是字典序
  });

  it("每个候选 eval 只求值谓词恰好一次", () => {
    let calls = 0;
    resolveExperimentEvals({
      experimentId: "e",
      selector: () => {
        calls += 1;
        return true;
      },
      cliPatterns: [],
      evals,
    });
    expect(calls).toBe(evals.length);
  });

  it("谓词返回非 boolean:报错携带 experiment id 与 eval id", () => {
    expect(() =>
      resolveExperimentEvals({
        experimentId: "exp/bad-return",
        selector: () => "yes" as unknown as boolean,
        cliPatterns: [],
        evals: [codingFixButton],
      }),
    ).toThrow(/exp\/bad-return.*coding\/fix-button/s);
  });

  it("谓词返回 Promise:不按 truthy 接受,报错说明必须同步", () => {
    expect(() =>
      resolveExperimentEvals({
        experimentId: "exp/async",
        selector: () => Promise.resolve(true) as unknown as boolean,
        cliPatterns: [],
        evals: [codingFixButton],
      }),
    ).toThrow(/Promise/);
  });

  it("谓词抛错:错误携带 experiment id + eval id,并保留原 cause", () => {
    const original = new Error("boom");
    let thrown: unknown;
    try {
      resolveExperimentEvals({
        experimentId: "exp/throws",
        selector: (): boolean => {
          throw original;
        },
        cliPatterns: [],
        evals: [codingFixButton],
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/exp\/throws/);
    expect((thrown as Error).message).toMatch(/coding\/fix-button/);
    expect((thrown as Error).cause).toBe(original);
  });
});

describe("selectedEvalsForRun", () => {
  it("按已解析的 selectedEvalIds 取 eval,保持 discovery 顺序", () => {
    const a = makeEval("a");
    const b = makeEval("b");
    const c = makeEval("c");
    const picked = selectedEvalsForRun([a, b, c], { selectedEvalIds: ["c", "a"] });
    expect(picked.map((e) => e.id)).toEqual(["a", "c"]); // 顺序随 all,不随 selectedEvalIds 声明序
  });
});

describe("evalDescriptorOf: scoring 投影", () => {
  it("defineEval 产物(scoring: \"pass\")投影为 \"pass\"", () => {
    const evalDef = makeEval("pass/one", { scoring: "pass" });
    expect(evalDescriptorOf(evalDef).scoring).toBe("pass");
  });

  it("defineScoreEval 产物(scoring: \"points\")投影为 \"points\"", () => {
    const evalDef = makeEval("points/one", { scoring: "points" });
    expect(evalDescriptorOf(evalDef).scoring).toBe("points");
  });

});

describe("splitByScoring", () => {
  it("全通过制:points 桶为空", () => {
    const a = makeEval("a", { scoring: "pass" });
    const b = makeEval("b", { scoring: "pass" });
    expect(splitByScoring([a, b])).toEqual({ pass: ["a", "b"], points: [] });
  });

  it("全计分制:pass 桶为空", () => {
    const a = makeEval("a", { scoring: "points" });
    const b = makeEval("b", { scoring: "points" });
    expect(splitByScoring([a, b])).toEqual({ pass: [], points: ["a", "b"] });
  });

  it("混合题型:两桶都非空且各自列出对应 id", () => {
    const a = makeEval("pass-eval", { scoring: "pass" });
    const b = makeEval("points-eval", { scoring: "points" });
    const split = splitByScoring([a, b]);
    expect(split.pass).toEqual(["pass-eval"]);
    expect(split.points).toEqual(["points-eval"]);
  });
});
