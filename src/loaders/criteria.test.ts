// cases: docs/engineering/testing/unit/experiments-runner.md
// 覆盖「loadCriteria 的登记面」那一格。走真实链路:captureLoadedFiles 登记出来的
// criteriaPaths 原样当作 DiscoveredEval.criteriaPaths(discover.ts 的接法),再交给
// computeFingerprint / planCarry 算,因此断言的是「树变了谁重跑」,不是登记表本身。
// 每个改动之后都重新调一次 loadCriteria:发现期在每次运行开头重跑,删文件那一格只有
// 重新枚举才有意义(旧清单里还挂着已删的路径)。

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineDirectAgent, defineEval } from "../define.ts";
import { t } from "../i18n/index.ts";
import { computeFingerprint, planCarry as planCarryEffect } from "../runner/fingerprint.ts";
import { prepareRunSandboxes, type PreparedRunPair } from "../runner/sandbox-selection.ts";
import { discoverEval, type AgentRun, type DiscoveredEval } from "../runner/types.ts";
import type { EvalResult } from "../types.ts";
import type { CapturedEvalSource } from "../runner/eval-source.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { captureLoadedFiles, loadCriteria, type CriteriaPattern } from "./index.ts";

const source: CapturedEvalSource = { path: "evals/sqlite.eval.ts", content: "", sha256: "0".repeat(64) };
const PATTERNS = ["evals/fixtures/tests/**", "!**/__pycache__/**"] as const;

const repoCwd = process.cwd();
const roots: string[] = [];

function planCarry(...args: Parameters<typeof planCarryEffect>) {
  return Effect.runPromise(planCarryEffect(...args));
}

afterEach(async () => {
  process.chdir(repoCwd);
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/**
 * 建一棵临时项目树并 chdir 进去(pattern 与登记都相对「项目根 = process.cwd()」)。
 * 返回 chdir 之后的 process.cwd():macOS 上 mkdtemp 的 /var/... 与它的 /private/var/... 不是
 * 同一个字符串,拿前者当项目根会与 realpath 出来的路径对不上。
 */
async function makeProject(files: Iterable<readonly [string, string]>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-criteria-"));
  roots.push(dir);
  process.chdir(dir);
  await write("evals/sqlite.eval.ts", "export default {};\n");
  for (const [path, content] of files) await write(path, content);
  return process.cwd();
}

async function write(path: string, content: string): Promise<void> {
  const absolute = join(process.cwd(), path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf-8");
}

const TREE: ReadonlyArray<readonly [string, string]> = [
  ["evals/fixtures/tests/run-tests.sh", "pytest -q\n"],
  ["evals/fixtures/tests/test_gcov.py", "def test_one(): assert True\n"],
  ["evals/fixtures/tests/helpers/env.py", "PATHS = []\n"],
];

/** 重新展开一次判据树,拿到这一刻的登记表(绝对路径)与返回值(项目根相对路径)。 */
async function enumerate(...patterns: CriteriaPattern[]): Promise<{ registered: string[]; returned: string[] }> {
  const { value, criteriaPaths } = await captureLoadedFiles(() => loadCriteria(...(patterns.length > 0 ? patterns : [...PATTERNS])));
  return { registered: criteriaPaths, returned: value };
}

/** 发现期展开一次判据树并期待它报错,返回报错文案(逐条 pattern 的点名要能被断言)。 */
async function loadCriteriaError(...patterns: string[]): Promise<string> {
  const thrown = await captureLoadedFiles(() => loadCriteria(...patterns)).then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof Error)) throw new Error(`expected loadCriteria(${patterns.join(" ")}) to reject`);
  return thrown.message;
}

function makeEval(id: string, criteriaPaths?: readonly string[]): DiscoveredEval {
  return discoverEval(defineEval({ test() {} }), {
    id,
    baseDir: join(process.cwd(), "evals"),
    sourcePath: join(process.cwd(), "evals/sqlite.eval.ts"),
    source,
    loaderDataPaths: [],
    criteriaPaths: criteriaPaths ?? [],
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
  selectedEvalIds: ["with-criteria", "plain"],
  experimentId: "exp",
  experimentBaseDir: "/project/experiments",
  experimentSourcePath: "/project/experiments/exp.ts",
};

function passed(id: string, fingerprint: string): EvalResult {
  return {
    experimentId: "exp",
    agent: "agent-exp",
    id,
    attempt: 0,
    verdict: "passed",
    fingerprint,
    durationMs: 1,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
  };
}

async function preparedPairs(evals: readonly DiscoveredEval[], agentRun: AgentRun = run): Promise<readonly PreparedRunPair[]> {
  return Effect.runPromise(prepareRunSandboxes(evals, [agentRun]));
}

async function fingerprint(evalDef: DiscoveredEval): Promise<string> {
  const [pair] = await preparedPairs([evalDef]);
  if (pair === undefined) throw new Error("expected one prepared run pair");
  return computeFingerprint(pair);
}

/**
 * 上一轮两条 eval 全绿(一条引用判据树、一条不引用),做一次改动,返回这一轮还能携带的 key。
 * 引用它的那条重跑 = 它的 key 不在返回值里;未引用的那条照常携带 = 它的 key 在。
 */
async function carriedKeysAfter(mutate: () => Promise<void>): Promise<string[]> {
  const before = await enumerate();
  const priorResults = [
    passed("with-criteria", await fingerprint(makeEval("with-criteria", before.registered))),
    passed("plain", await fingerprint(makeEval("plain"))),
  ];

  await mutate();

  const after = await enumerate();
  const plan = await planCarry([makeEval("with-criteria", after.registered), makeEval("plain")], [run], priorResults);
  return [...plan.carriedAttemptsByKey.keys()].sort();
}

describe("loadCriteria · 判据树的登记面", () => {
  it("树内一个文件改一字节:只有引用这棵树的 eval 重跑,未引用的照常携带", async () => {
    await makeProject(TREE);
    const carried = await carriedKeysAfter(() => write("evals/fixtures/tests/test_gcov.py", "def test_one(): assert False\n"));
    expect(carried).toEqual(["exp|plain"]);
  });

  it("往匹配集加一个文件:只有引用这棵树的 eval 重跑", async () => {
    await makeProject(TREE);
    const carried = await carriedKeysAfter(() => write("evals/fixtures/tests/test_extra.py", "def test_two(): assert True\n"));
    expect(carried).toEqual(["exp|plain"]);
  });

  it("从匹配集删一个文件:只有引用这棵树的 eval 重跑", async () => {
    await makeProject(TREE);
    const carried = await carriedKeysAfter(() => rm(join(process.cwd(), "evals/fixtures/tests/helpers/env.py")));
    expect(carried).toEqual(["exp|plain"]);
  });

  it("只改权限位与修改时间:两条 eval 都照常携带(重新 clone 一份工作树不作废)", async () => {
    await makeProject(TREE);
    const carried = await carriedKeysAfter(async () => {
      const path = join(process.cwd(), "evals/fixtures/tests/run-tests.sh");
      await chmod(path, 0o700);
      await utimes(path, new Date(Date.now() + 86_400_000), new Date(Date.now() + 86_400_000));
    });
    expect(carried).toEqual(["exp|plain", "exp|with-criteria"]);
  });

  it("`!` 排除命中的生成物:增、改、删都不作废", async () => {
    await makeProject([...TREE, ["evals/fixtures/tests/__pycache__/env.cpython-311.pyc", "stale\n"]]);

    const add = await carriedKeysAfter(() => write("evals/fixtures/tests/__pycache__/test_gcov.cpython-311.pyc", "fresh\n"));
    expect(add).toEqual(["exp|plain", "exp|with-criteria"]);

    const change = await carriedKeysAfter(() => write("evals/fixtures/tests/__pycache__/env.cpython-311.pyc", "rebuilt\n"));
    expect(change).toEqual(["exp|plain", "exp|with-criteria"]);

    const remove = await carriedKeysAfter(() => rm(join(process.cwd(), "evals/fixtures/tests/__pycache__/env.cpython-311.pyc")));
    expect(remove).toEqual(["exp|plain", "exp|with-criteria"]);
  });
});

describe("loadCriteria · 遍历序不影响指纹", () => {
  it("登记表逆序传入算出同一个指纹(路径排序保证)", async () => {
    await makeProject(TREE);
    const { registered } = await enumerate();
    expect(registered.length).toBeGreaterThan(1);

    const ordered = await fingerprint(makeEval("with-criteria", registered));
    const reversed = await fingerprint(makeEval("with-criteria", [...registered].reverse()));

    expect(reversed).toBe(ordered);
  });

  it("同一棵树按相反的建立顺序落盘,算出同一个指纹", async () => {
    await makeProject(TREE);
    const forward = await fingerprint(makeEval("with-criteria", (await enumerate()).registered));

    process.chdir(repoCwd);
    await makeProject([...TREE].reverse());
    const backward = await fingerprint(makeEval("with-criteria", (await enumerate()).registered));

    expect(backward).toBe(forward);
  });
});

describe("loadCriteria · 返回值", () => {
  it("返回排序后的项目根相对路径清单,不含内容,排除项不在里面", async () => {
    await makeProject([...TREE, ["evals/fixtures/tests/__pycache__/env.cpython-311.pyc", "stale\n"]]);

    const { returned } = await enumerate();

    expect(returned).toEqual([
      "evals/fixtures/tests/helpers/env.py",
      "evals/fixtures/tests/run-tests.sh",
      "evals/fixtures/tests/test_gcov.py",
    ]);
    // 内容不进内存:返回值里除了路径没有别的东西(拿文件正文比对能直接证伪)。
    expect(returned.some((path) => path.includes("pytest"))).toBe(false);
  });
});

describe("loadCriteria · eval 文件相对 glob", () => {
  it("pattern 与基准 URL 分开传递,保留 `?` 与 `{a,b}` 语义且等价于项目根写法", async () => {
    await makeProject([
      ["evals/local/eval.ts", "export default {};\n"],
      ["evals/local/tests/file1.ts", "one\n"],
      ["evals/local/tests/a.ts", "a\n"],
      ["evals/local/tests/b.ts", "b\n"],
      ["evals/local/tests/skip.js", "skip\n"],
    ]);
    const relativeTo = pathToFileURL(join(process.cwd(), "evals/local/eval.ts"));

    const local = await enumerate({ pattern: "tests/{file?,a,b}.ts", relativeTo });
    const rooted = await enumerate("evals/local/tests/{file?,a,b}.ts");

    expect(local).toEqual(rooted);
    expect(local.returned).toEqual([
      "evals/local/tests/a.ts",
      "evals/local/tests/b.ts",
      "evals/local/tests/file1.ts",
    ]);
  });

  it("相对对象只表示 include,排除仍要求项目根相对字符串", async () => {
    await makeProject(TREE);
    const relativeTo = pathToFileURL(join(process.cwd(), "evals/sqlite.eval.ts"));

    await expect(
      captureLoadedFiles(() => loadCriteria({ pattern: "!fixtures/tests/**", relativeTo })),
    ).rejects.toThrow(/exclusions must be project-root-relative strings/);
  });
});

describe("loadCriteria · 用法错误", () => {
  it("某条 include pattern 匹配不到任何文件:别的 pattern 有命中也报错,并点名是哪条", async () => {
    await makeProject(TREE);

    // evals/scripts/run.sh 被搬走了,tests/** 照旧有命中——按整次调用判空的实现会整体放行,
    // 判据悄悄从「树 + 跑测脚本」变窄成「树」。
    const patterns = ["evals/fixtures/tests/**", "evals/scripts/run.sh", "!**/__pycache__/**"];
    const message = await loadCriteriaError(...patterns);

    expect(message).toBe(t("loaders.criteriaNoMatch", { patterns: "evals/scripts/run.sh", root: process.cwd() }));
    // 点名的是缺的那条,不是把整串 pattern 一起念一遍。
    expect(message).not.toContain("evals/fixtures/tests/**");
    // 下一步在文案里:对着磁盘核对这几条。
    expect(t("loaders.criteriaNoMatch", { patterns: "p", root: "/r" })).toContain("pattern");
  });

  it("include pattern 命中的文件全被后写的 `!` 排除:同样报错(这条 pattern 对判据零贡献)", async () => {
    await makeProject([...TREE, ["evals/fixtures/tests/__pycache__/env.cpython-311.pyc", "stale\n"]]);

    // 第二条只命中 __pycache__ 下的文件,全被第三条排掉;第一条另有命中,所以只该点名第二条。
    const message = await loadCriteriaError("evals/fixtures/tests/**", "evals/fixtures/tests/__pycache__/**", "!**/__pycache__/**");

    expect(message).toBe(t("loaders.criteriaNoMatch", { patterns: "evals/fixtures/tests/__pycache__/**", root: process.cwd() }));
  });

  it("符号链接穿出项目根:报错并给出下一步", async () => {
    await makeProject(TREE);
    const outside = await mkdtemp(join(tmpdir(), "niceeval-criteria-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "leaked_test.py"), "def test(): assert True\n", "utf-8");
    await symlink(join(outside, "leaked_test.py"), join(process.cwd(), "evals/fixtures/tests/leaked_test.py"));

    await expect(captureLoadedFiles(() => loadCriteria(...PATTERNS))).rejects.toThrow(/evals\/fixtures\/tests\/leaked_test\.py/);
    await expect(captureLoadedFiles(() => loadCriteria(...PATTERNS))).rejects.toThrow(/(项目根|project root)/);
  });

  it("发现期之外调用:直接报错,不静默漏登记", async () => {
    await makeProject(TREE);
    await expect(loadCriteria(...PATTERNS)).rejects.toThrow(t("loaders.outsideDiscovery", { path: PATTERNS.join(" ") }));
  });
});
