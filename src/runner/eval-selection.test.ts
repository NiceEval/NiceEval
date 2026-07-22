// cases: docs/engineering/testing/unit/experiments-runner.md
// 纯选题边界:EvalDescriptor 投影 + resolveExperimentEvals 求值(定稿见
// docs/feature/eval/library.md「EvalDescriptor」、docs/feature/experiments/library.md「evals」)。

import { describe, expect, it } from "vitest";
import { evalDescriptorOf, resolveExperimentEvals, selectedEvalsForRun, splitByScoring } from "./eval-selection.ts";
import type { DiscoveredEval, EvalDescriptor } from "./types.ts";
import { interpolate } from "../i18n/core.ts";
import { en } from "../i18n/en.ts";
import { zhCN } from "../i18n/zh-CN.ts";

const source = { path: "evals/fake.eval.ts", content: "export default { test() {} };\n", sha256: "fake" };

function makeEval(id: string, overrides: Partial<DiscoveredEval> = {}): DiscoveredEval {
  return {
    id,
    baseDir: "/project/evals",
    sourcePath: `/project/evals/${id}.eval.ts`,
    source,
    test() {},
    ...overrides,
  };
}

describe("evalDescriptorOf", () => {
  it("显式白名单投影:不暴露 sourcePath / baseDir / test 等内部字段", () => {
    const evalDef = makeEval("coding/fix-button", {
      description: "fix the button",
      tags: ["coding", "frontend"],
      environment: "node-22",
      metadata: { owner: "team-a" },
    });
    const descriptor = evalDescriptorOf(evalDef);
    expect(descriptor).toEqual({
      id: "coding/fix-button",
      description: "fix the button",
      tags: ["coding", "frontend"],
      scoring: "pass",
      environment: "node-22",
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
  const codingFixButton = makeEval("coding/fix-button", { tags: ["coding", "frontend"], environment: "node-22" });
  const researchGpu = makeEval("research/gpu-literature", { tags: ["research"], environment: "gpu" });
  const evals = [codingFixButton, researchGpu];

  it("谓词同时可读 id / tags / environment / metadata,只命中匹配的 eval", () => {
    const { selectedEvalIds } = resolveExperimentEvals({
      experimentId: "exp/coding-only",
      selector: (e) => e.id.startsWith("coding/") && e.tags.includes("coding") && e.environment !== "gpu",
      cliPatterns: [],
      evals,
    });
    expect(selectedEvalIds).toEqual(["coding/fix-button"]);
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

describe("EvalDescriptor 类型可从公开入口导入", () => {
  it("类型层守卫:占位断言(真正的推断检查在 pnpm typecheck)", () => {
    const descriptor: EvalDescriptor = { id: "x", tags: [], scoring: "pass" };
    expect(descriptor.id).toBe("x");
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

  it("未经 defineEval/defineScoreEval 处理的裸对象(scoring 缺失)兜底按 \"pass\" 投影,不是 undefined", () => {
    const evalDef = makeEval("bare/no-scoring");
    expect(evalDef.scoring).toBeUndefined(); // fixture 本身没设 scoring,模拟裸对象
    expect(evalDescriptorOf(evalDef).scoring).toBe("pass");
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

// CLI 混型启动校验的报错文案(cli.experiment.mixedScoring)：splitByScoring 只做检测,
// 格式化职责在 CLI(见 eval-selection.ts 顶部注释);这里直接对 i18n 消息模板断言,
// 不需要起一个真实 CLI 进程(见 docs/engineering/testing/e2e/cli.md「边界」:错误文案的
// 语义广度归单元测试)。
describe("cli.experiment.mixedScoring 报错文案", () => {
  it("列出两侧 eval id、各自计数,并给出收窄建议(zh-CN 与 en 都要有区分力)", () => {
    const split = splitByScoring([
      makeEval("evals/pass-a", { scoring: "pass" }),
      makeEval("evals/points-b", { scoring: "points" }),
      makeEval("evals/points-c", { scoring: "points" }),
    ]);
    const vars = {
      experimentId: "agents/codex",
      passCount: split.pass.length,
      passIds: split.pass.join(", "),
      pointsCount: split.points.length,
      pointsIds: split.points.join(", "),
    };

    const zh = interpolate(zhCN["cli.experiment.mixedScoring"], vars);
    expect(zh).toContain("agents/codex");
    expect(zh).toContain("evals/pass-a");
    expect(zh).toContain("evals/points-b");
    expect(zh).toContain("evals/points-c");
    expect(zh).toContain(String(split.pass.length));
    expect(zh).toContain(String(split.points.length));
    expect(zh).toMatch(/tags|前缀|scoring/); // 收窄建议:按 tags/id 前缀/scoring 字段收窄,或拆两个实验文件
    expect(zh).toMatch(/两个实验文件/);

    const enText = interpolate(en["cli.experiment.mixedScoring"], vars);
    expect(enText).toContain("agents/codex");
    expect(enText).toContain("evals/pass-a");
    expect(enText).toContain("evals/points-b");
    expect(enText).toContain("evals/points-c");
    expect(enText).toContain(String(split.pass.length));
    expect(enText).toContain(String(split.points.length));
    expect(enText).toMatch(/tags|prefix|scoring/);
    expect(enText).toMatch(/two experiment files/);
  });
});
