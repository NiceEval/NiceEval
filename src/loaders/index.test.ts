// cases: docs/engineering/testing/unit/experiments-runner.md
// 覆盖「eval 源码闭包的构成」里判据文件那一格:loadText 读入的文件改一字节即作废引用它的
// 那条 eval,同一个文件换 fs 直读则不触发。两个方向都走真实链路——captureLoadedFiles 登记
// 出来的路径原样当作 DiscoveredEval.loaderDataPaths(discover.ts 的接法),再交给
// computeFingerprint 算,因此断言的是「读入方式决定进不进指纹」,不是登记表本身。

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { relative } from "node:path";
import { defineDirectAgent, defineEval } from "../define.ts";
import { t } from "../i18n/index.ts";
import { computeFingerprint } from "../runner/fingerprint.ts";
import { prepareRunSandboxes, type PreparedRunPair } from "../runner/sandbox-selection.ts";
import { discoverEval, type AgentRun, type DiscoveredEval } from "../runner/types.ts";
import type { CapturedEvalSource } from "../runner/eval-source.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { STATELESS } from "../state/plan.ts";
import { captureLoadedFiles, loadJson, loadText, loadYaml } from "./index.ts";

// computeFingerprint 无条件读 evalDef.sourcePath;内容不重要,指向本测试文件自己,永远存在。
const sourcePath = fileURLToPath(import.meta.url);
const source: CapturedEvalSource = { path: "fake.eval.ts", content: "", sha256: "0".repeat(64) };

const roots: string[] = [];
async function criterionFile(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-loaders-"));
  roots.push(root);
  const path = join(root, "hidden-test.sh");
  await writeFile(path, content, "utf-8");
  return path;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function makeEval(loaderDataPaths: readonly string[]): DiscoveredEval {
  return discoverEval(defineEval({ test() {} }), {
    id: "e",
    baseDir: "/project",
    sourcePath,
    source,
    loaderDataPaths,
    criteriaPaths: [],
    privatePaths: [],
  });
}

const run: AgentRun = {
  agent: defineDirectAgent({
    name: "agent-exp",
    evidenceCoverage: completeEvidenceCoverage,
    send: async () => ({ events: [], status: "completed" }),
  }),
  flags: {},
  attempts: 1,
  earlyExit: false,
  selectedEvalIds: ["e"],
  experimentId: "exp",
  experimentBaseDir: "/project/experiments",
  experimentSourcePath: "/project/experiments/exp.ts",
  state: STATELESS,
};

async function preparedPair(evalDef: DiscoveredEval): Promise<PreparedRunPair> {
  const [pair] = await Effect.runPromise(prepareRunSandboxes([evalDef], [run]));
  if (pair === undefined) throw new Error("expected one prepared run pair");
  return pair;
}

describe("loadText · 判据文件进 eval 源码闭包", () => {
  it("loadText 读入的判据文件改一字节,引用它的那条 eval 指纹就变", async () => {
    const path = await criterionFile("exit 0\n");

    const { value, paths } = await captureLoadedFiles(() => loadText(path));
    expect(value).toBe("exit 0\n");
    expect(paths).toEqual([path]);

    const before = await computeFingerprint(await preparedPair(makeEval(paths)));
    await writeFile(path, "exit 1\n", "utf-8");
    const after = await computeFingerprint(await preparedPair(makeEval(paths)));

    expect(after).not.toBe(before);
  });

  it("同一个判据文件换 fs 直读:登记不到,改一字节指纹不变", async () => {
    const path = await criterionFile("exit 0\n");

    const { paths } = await captureLoadedFiles(() => readFile(path, "utf-8"));
    expect(paths).toEqual([]);

    const before = await computeFingerprint(await preparedPair(makeEval(paths)));
    await writeFile(path, "exit 1\n", "utf-8");
    const after = await computeFingerprint(await preparedPair(makeEval(paths)));

    expect(after).toBe(before);
  });
});

describe("loader 的调用面", () => {
  it("JSON 动态值必须经 decoder 验证后才返回领域类型", async () => {
    const path = await criterionFile('{"cases":[{"prompt":"hello"}]}\n');
    const decode = (value: unknown): { cases: Array<{ prompt: string }> } => {
      if (typeof value !== "object" || value === null || !("cases" in value) || !Array.isArray(value.cases)) {
        throw new TypeError("cases must be an array");
      }
      const cases = value.cases.map((entry) => {
        if (typeof entry !== "object" || entry === null || !("prompt" in entry) || typeof entry.prompt !== "string") {
          throw new TypeError("case.prompt must be a string");
        }
        return { prompt: entry.prompt };
      });
      return { cases };
    };

    const loaded = await captureLoadedFiles(() => loadJson(path, decode));
    expect(loaded.value.cases).toEqual([{ prompt: "hello" }]);
    expect(loaded.paths).toEqual([path]);

    if (false) {
      // @ts-expect-error 外部 JSON 不允许用泛型直接信任，必须提供 decoder。
      void loadJson<{ cases: Array<{ prompt: string }> }>(path);
    }
  });

  it("同一份判据文件:字符串路径与 URL 两种入参登记与指纹等价", async () => {
    const path = await criterionFile("exit 0\n");

    // 字符串按进程 cwd 解析,URL 按 file: 解析,两条都落到同一个绝对路径。
    const viaString = await captureLoadedFiles(() => loadText(relative(process.cwd(), path)));
    const viaUrl = await captureLoadedFiles(() => loadText(pathToFileURL(path)));

    expect(viaUrl.value).toBe(viaString.value);
    expect(viaUrl.paths).toEqual(viaString.paths);

    const stringFingerprint = await computeFingerprint(await preparedPair(makeEval(viaString.paths)));
    const urlFingerprint = await computeFingerprint(await preparedPair(makeEval(viaUrl.paths)));
    expect(urlFingerprint).toBe(stringFingerprint);
  });

  it("capture 不在场时调用任一 loader 直接报错,文案给出下一步", async () => {
    const path = await criterionFile("exit 0\n");
    const identity = (value: unknown) => value;

    await expect(loadText(path)).rejects.toThrow(t("loaders.outsideDiscovery", { path }));
    await expect(loadJson(path, identity)).rejects.toThrow(t("loaders.outsideDiscovery", { path }));
    await expect(loadYaml(path, identity)).rejects.toThrow(t("loaders.outsideDiscovery", { path }));
    // 下一步指引在文案里:把读取挪走,别在 test(t) 运行期调 loader。
    expect(t("loaders.outsideDiscovery", { path })).toContain("test(t)");
  });
});
