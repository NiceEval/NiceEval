// cases: docs/engineering/testing/unit/experiments-runner.md
// discoverEvals 的 eval 源码捕获:同一文件(数组默认导出)共享一份 CapturedEvalSource,
// 内容/路径/哈希与 captureEvalSource() 直接调出来的一致(定稿见 docs/concepts.md「标注 Eval 源码」)。
// 「目录入口与重名冲突」归 eval.md。

import { describe, expect, it, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DiscoveryError, discoverEvals, discoverExperiments, makeFilter } from "./discover.ts";
import { captureEvalSource } from "./eval-source.ts";

const roots: string[] = [];
const defineUrl = pathToFileURL(resolve(process.cwd(), "src", "define.ts")).href;
const sandboxUrl = pathToFileURL(resolve(process.cwd(), "src", "sandbox", "index.ts")).href;

function evalModule(expression = "defineEval({ test() {} })"): string {
  return `import { defineEval, defineScoreEval } from ${JSON.stringify(defineUrl)};\nexport default ${expression};\n`;
}
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-discover-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("discoverEvals · 源码捕获", () => {
  // bug: memory/exp-eval-prefix-segment-drift.md
  it("eval 位置参数按裸字面前缀命中 sibling，不要求路径段边界", () => {
    const filter = makeFilter(["memory/terminal-swe-bench"]);
    expect(filter("memory/terminal-swe-bench-astropy-1")).toBe(true);
    expect(filter("memory/terminal-swe-bench-astropy-2")).toBe(true);
    expect(filter("memory/other")).toBe(false);
  });

  it("单个默认导出:source 与 captureEvalSource() 直接调出来的一致(路径/内容/哈希)", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    const file = join(root, "evals", "hello.eval.ts");
    await writeFile(file, evalModule(), "utf-8");

    const evals = await discoverEvals(root);
    expect(evals).toHaveLength(1);
    const expected = await captureEvalSource(file, { root });
    expect(evals[0]!.source).toEqual(expected);
    expect(evals[0]!.source.path).toBe("evals/hello.eval.ts");
  });

  it("数组默认导出:多个 eval 共享同一份 CapturedEvalSource 引用(同哈希,同一个文件只读一次)", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    const file = join(root, "evals", "batch.eval.ts");
    await writeFile(
      file,
      evalModule("[defineEval({ test() {} }), defineEval({ test() {} })]"),
      "utf-8",
    );

    const evals = await discoverEvals(root);
    expect(evals.map((e) => e.id)).toEqual(["batch/0000", "batch/0001"]);
    expect(evals[0]!.source).toBe(evals[1]!.source); // 同一份引用,不是内容相等的两份拷贝
    expect(evals[0]!.source.sha256).toHaveLength(64);
  });

  it("keyed record 默认导出:业务 key 进入 id，按 key 字典序稳定排列并共享源码引用", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    const file = join(root, "evals", "issues.eval.ts");
    await writeFile(
      file,
      evalModule("{ '25901': defineEval({ test() {} }), '15193': defineEval({ test() {} }) }"),
      "utf-8",
    );

    const evals = await discoverEvals(root);
    expect(evals.map((e) => e.id)).toEqual(["issues/15193", "issues/25901"]);
    expect(evals[0]!.source).toBe(evals[1]!.source);
  });

  it("空 keyed record 合法且不产生 eval", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    await writeFile(join(root, "evals", "empty.eval.ts"), evalModule("{}"), "utf-8");

    await expect(discoverEvals(root)).resolves.toEqual([]);
  });

  it("裸对象即使字段同形也在发现期拒绝，并要求 factory Definition", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    await writeFile(join(root, "evals", "bad-score.eval.ts"), 'export default { scoring: "points", test() {} };\n', "utf-8");
    await expect(discoverEvals(root)).rejects.toThrow(/defineEval\(\).*defineScoreEval\(\)/s);
  });

  it("整批聚合多个文件的 typed DiscoveryIssue，而不是首错即停", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    await writeFile(join(root, "evals", "a.eval.ts"), "export default { test() {} };\n", "utf-8");
    await writeFile(join(root, "evals", "b.eval.ts"), "export default { test() {} };\n", "utf-8");

    const error = await discoverEvals(root).then(() => undefined, (cause) => cause);
    expect(error).toBeInstanceOf(DiscoveryError);
    expect(error.issues).toHaveLength(2);
    expect(error.issues.map((entry: { file: string }) => entry.file)).toEqual([
      "evals/a.eval.ts",
      "evals/b.eval.ts",
    ]);
  });

  it.each(["", ".", "..", "a/b", "a\\b", "line\nbreak"])(
    "keyed record 拒绝非法业务 key %j",
    async (key) => {
      const root = await makeRoot();
      await mkdir(join(root, "evals"), { recursive: true });
      await writeFile(
        join(root, "evals", "bad.eval.ts"),
        evalModule(`Object.fromEntries([[${JSON.stringify(key)}, defineEval({ test() {} })]])`),
        "utf-8",
      );

      await expect(discoverEvals(root)).rejects.toThrow(/Invalid keyed eval dataset key/);
    },
  );

  it("keyed record 的每个值都必须是品牌化 EvalDefinition", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals"), { recursive: true });
    await writeFile(join(root, "evals", "bad-value.eval.ts"), "export default { issue: {} };\n", "utf-8");

    await expect(discoverEvals(root)).rejects.toThrow(/EvalDefinition/);
  });

  it("CRLF 源码归一化后哈希与 LF 版本一致(discovery 侧与 collectSources/annotated-source 共用归一化)", async () => {
    const rootLf = await makeRoot();
    const rootCrlf = await makeRoot();
    await mkdir(join(rootLf, "evals"), { recursive: true });
    await mkdir(join(rootCrlf, "evals"), { recursive: true });
    const body = evalModule();
    await writeFile(join(rootLf, "evals", "a.eval.ts"), body, "utf-8");
    await writeFile(join(rootCrlf, "evals", "a.eval.ts"), body.replace(/\n/g, "\r\n"), "utf-8");

    const [lf] = await discoverEvals(rootLf);
    const [crlf] = await discoverEvals(rootCrlf);
    expect(lf!.source.sha256).toBe(crlf!.source.sha256);
    expect(crlf!.source.content).toBe(body); // 归一化后不含 \r
  });
});

describe("discoverEvals · 目录入口与重名冲突", () => {
  it("发现 evals/foo/eval.ts，只加入路径与完整 capture 事实", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals", "foo"), { recursive: true });
    await writeFile(join(root, "evals", "foo", "eval.ts"), evalModule(), "utf-8");

    const evals = await discoverEvals(root);
    expect(evals).toHaveLength(1);
    expect(evals[0]!.id).toBe("foo");
    expect(evals[0]!.source.path).toBe("evals/foo/eval.ts");
    expect(evals[0]!.loaderDataPaths).toEqual([]);
    expect(evals[0]!.criteriaPaths).toEqual([]);
    expect(evals[0]!.privatePaths).toEqual([]);
    expect(Object.isFrozen(evals[0])).toBe(true);
    expect(Object.isFrozen(evals[0]!.loaderDataPaths)).toBe(true);
  });

  it("目录入口扇出时只由位置形成 id，不附加旧 profile 状态", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals", "suite"), { recursive: true });
    await writeFile(
      join(root, "evals", "suite", "eval.ts"),
      evalModule("[defineEval({ test() {} }), defineEval({ test() {} })]"),
      "utf-8",
    );

    const evals = await discoverEvals(root);
    expect(evals.map((e) => e.id)).toEqual(["suite/0000", "suite/0001"]);
    expect(evals.every((e) => e.scoring === "pass")).toBe(true);
  });

  it("无 eval.ts 的目录(_lib)不被发现", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals", "_lib"), { recursive: true });
    await writeFile(join(root, "evals", "_lib", "helper.ts"), "export const x = 1;\n", "utf-8");
    await mkdir(join(root, "evals", "real"), { recursive: true });
    await writeFile(join(root, "evals", "real", "eval.ts"), evalModule(), "utf-8");

    const evals = await discoverEvals(root);
    expect(evals.map((e) => e.id)).toEqual(["real"]);
  });

  it("foo.eval.ts 与 foo/eval.ts 同 id 时报重名，点名两条路径", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals", "foo"), { recursive: true });
    await writeFile(join(root, "evals", "foo.eval.ts"), evalModule(), "utf-8");
    await writeFile(join(root, "evals", "foo", "eval.ts"), evalModule(), "utf-8");

    await expect(discoverEvals(root)).rejects.toThrow(/Duplicate eval id "foo"/);
    await expect(discoverEvals(root)).rejects.toThrow(/foo\.eval\.ts/);
    await expect(discoverEvals(root)).rejects.toThrow(/foo\/eval\.ts/);
  });

  it("目录入口只携带品牌化 SandboxLayer，不产生 environment/profile 兼容字段", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "evals", "compose-task"), { recursive: true });
    await writeFile(
      join(root, "evals", "compose-task", "eval.ts"),
      `import { defineEval } from ${JSON.stringify(defineUrl)};\n` +
        `import { dockerComposeSandbox } from ${JSON.stringify(sandboxUrl)};\n` +
        "export default defineEval({ sandbox: dockerComposeSandbox({ file: 'docker-compose.yaml', workspaceService: 'app' }), test() {} });\n",
      "utf-8",
    );

    const evals = await discoverEvals(root);
    expect(evals).toHaveLength(1);
    expect(evals[0]!.id).toBe("compose-task");
    expect(evals[0]!.sandbox).toBeDefined();
    expect(evals[0]).not.toHaveProperty("environment");
    expect(evals[0]).not.toHaveProperty("defaultProfileId");
  });
});

describe("discoverExperiments · Definition 边界", () => {
  it("只发现 defineExperiment 产物，并把路径事实加入 DiscoveredExperiment", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "experiments", "compare"), { recursive: true });
    await writeFile(
      join(root, "experiments", "compare", "baseline.experiment.ts"),
      `import { defineExperiment } from ${JSON.stringify(defineUrl)};\n` +
        'export default defineExperiment({ agent: { name: "fixture" } });\n',
      "utf-8",
    );

    const experiments = await discoverExperiments(root);
    expect(experiments).toHaveLength(1);
    expect(experiments[0]).toMatchObject({
      id: "compare/baseline",
      baseDir: join(root, "experiments", "compare"),
      sourcePath: join(root, "experiments", "compare", "baseline.experiment.ts"),
    });
  });

  it("允许 experiments/shared 下没有 default export 的普通 helper", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "experiments", "shared"), { recursive: true });
    await writeFile(join(root, "experiments", "shared", "helpers.ts"), "export const answer = 42;\n", "utf-8");
    await expect(discoverExperiments(root)).resolves.toEqual([]);
  });

  it("拒绝 plain object 与类型断言绕过，明确要求 defineExperiment", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "experiments"), { recursive: true });
    await writeFile(
      join(root, "experiments", "forged.experiment.ts"),
      'export default ({ agent: { name: "forged" } } as unknown);\n',
      "utf-8",
    );
    await expect(discoverExperiments(root)).rejects.toThrow(/defineExperiment/);
  });
});
